// src/lib/node/worker-manager.ts
import { Worker, type Job } from "bullmq";
import {
  type ProcessorDefinition,
  type ProcessorResult,
} from "../core/processor";
import { type AppState, type StateManager } from "../core/state";
import { createLogger, type Logger } from "../core/logging";
import { type ConnectionManager } from "./connection-manager";
import { type QueueManager } from "./queue-manager";
import {
  ProcessorExecutor,
  ContextFactory,
  MetadataFactory,
} from "../core/processor-executor";

export interface WorkerConfig {
  readonly concurrency?: number;
  readonly stalledInterval?: number;
  readonly maxStalledCount?: number;
  readonly removeOnComplete?: number | { count: number; age: number };
  readonly removeOnFail?: number | { count: number; age: number };
}

export class WorkerManager<TState extends AppState = AppState> {
  private workers = new Map<string, Worker>();
  private executor: ProcessorExecutor<TState>;
  private contextFactory = new ContextFactory<TState>();
  private metadataFactory = new MetadataFactory();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly queueManager: QueueManager<TState>,
    private readonly stateManager: StateManager<TState>,
    private readonly config: WorkerConfig,
    private readonly queuePrefix: string = "am2z",
    private readonly logger: Logger = createLogger({
      component: "WorkerManager",
    }),
    private readonly eventEmitter: (
      eventType: string,
      data: unknown
    ) => void = () => {},
    private readonly processorCaller: (
      processorName: string,
      state: TState
    ) => Promise<any> = async () => ({ success: false })
  ) {
    this.executor = new ProcessorExecutor<TState>(this.stateManager);
  }

  /**
   * Create worker for a processor
   */
  async createWorker(processor: ProcessorDefinition<TState>): Promise<void> {
    const queueName = this.getQueueName(processor.name);

    const worker = new Worker(
      queueName,
      async (job) => this.processJob(job, processor),
      {
        concurrency:
          processor.config.queueConfig?.concurrency ||
          this.config.concurrency ||
          5,
        stalledInterval: this.config.stalledInterval || 30000,
        maxStalledCount: this.config.maxStalledCount || 1,
        removeOnComplete:
          typeof this.config.removeOnComplete === "number"
            ? {
                count: this.config.removeOnComplete,
                age: 24 * 60 * 60 * 1000,
              }
            : this.config.removeOnComplete || {
                count: 100,
                age: 24 * 60 * 60 * 1000,
              },
        removeOnFail:
          typeof this.config.removeOnFail === "number"
            ? {
                count: this.config.removeOnFail,
                age: 24 * 60 * 60 * 1000,
              }
            : this.config.removeOnFail || {
                count: 50,
                age: 24 * 60 * 60 * 1000,
              },
        connection: this.connectionManager.getConnection("main"),
      }
    );

    this.workers.set(processor.name, worker);
    this.setupWorkerEvents(worker, processor.name);

    this.logger.debug(`Created worker for processor: ${processor.name}`, {
      queueName,
      concurrency: worker.opts.concurrency,
    });
  }

  /**
   * Process individual job using shared executor
   */
  private async processJob(
    job: Job,
    processor: ProcessorDefinition<TState>
  ): Promise<ProcessorResult<TState>> {
    const { processorName, state, sessionId, executionId } = job.data;

    const metadata = this.metadataFactory.createMetadata(
      processorName,
      sessionId,
      executionId,
      Date.now()
    );

    const context = this.contextFactory.createContext(
      processor,
      metadata,
      this.processorCaller,
      this.eventEmitter,
      this.logger
    );

    return this.executor.executeProcessor(processor, state, context);
  }

  /**
   * Setup worker event listeners
   */
  private setupWorkerEvents(worker: Worker, processorName: string): void {
    worker.on("completed", (job, returnvalue) => {
      const executionTime = Date.now() - job.processedOn!;
      this.logger.debug(`Worker - job completed: ${job.id}`, {
        processorName,
        executionTime,
      });

      this.eventEmitter("processor:completed", {
        jobId: job.id,
        processorName,
        returnvalue,
        executionTime,
        executionId: job.data?.executionId || job.id,
      });
    });

    worker.on("failed", (job, err) => {
      this.logger.error(`Worker - job failed: ${job?.id}`, err, {
        processorName,
        attempts: job?.attemptsMade,
      });

      this.eventEmitter("processor:failed", {
        jobId: job?.id,
        processorName,
        error: err.message,
        attempts: job?.attemptsMade,
      });
    });

    worker.on("active", (job) => {
      this.logger.debug(`Worker - job active: ${job.id}`, { processorName });

      this.eventEmitter("processor:active", {
        jobId: job.id,
        processorName,
      });
    });

    worker.on("error", (err) => {
      this.logger.error(`Worker error for ${processorName}:`, err);
    });
  }

  /**
   * Get worker for processor
   */
  getWorker(processorName: string): Worker | undefined {
    return this.workers.get(processorName);
  }

  /**
   * Remove worker
   */
  async removeWorker(processorName: string): Promise<void> {
    const worker = this.workers.get(processorName);
    if (worker) {
      await worker.close();
      this.workers.delete(processorName);
      this.logger.debug(`Removed worker for processor: ${processorName}`);
    }
  }

  /**
   * Close all workers
   */
  async closeAll(): Promise<void> {
    const closings = Array.from(this.workers.values()).map((worker) =>
      worker.close()
    );
    await Promise.all(closings);
    this.workers.clear();
    this.logger.info("All workers closed");
  }

  private getQueueName(processorName: string): string {
    return `${this.queuePrefix}_${processorName}`;
  }
}
