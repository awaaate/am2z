// src/lib/node/worker-manager.ts
import { Worker, type Job } from "bullmq";
import {
  type ProcessorDefinition,
  type ProcessorResult,
  type ProcessorContext,
} from "../core/processor";
import { type AppState, type StateManager } from "../core/state";
import { type Logger } from "../core/logging";
import { createComponentLogger } from "../core/component-logger";
import { SessionManager, NamingUtility } from "../core/session-manager";
import { type ConnectionManager } from "./connection-manager";
import { type QueueManager } from "./queue-manager";
import {
  ProcessorExecutor,
  ContextFactory,
  MetadataFactory,
  type ProcessorCallContext,
} from "../core/processor-executor";
import { type AM2ZError } from "../core/errors";
import { type RuntimeConfig, DEFAULT_RUNTIME_CONFIG } from "../core/runtime";

export interface WorkerConfig {
  readonly concurrency?: number;
  readonly stalledInterval?: number;
  readonly maxStalledCount?: number;
  readonly removeOnComplete?: number | { count: number; age: number };
  readonly removeOnFail?: number | { count: number; age: number };
}

export class WorkerManager<TState extends AppState = AppState> {
  private workers = new Map<string, Worker>();
  private readonly sessionManager = new SessionManager<string>(); // Track workers per session
  private readonly namingUtility: NamingUtility;
  private executor: ProcessorExecutor<TState>;
  private contextFactory = new ContextFactory<TState>();
  private metadataFactory = new MetadataFactory();
  private readonly runtimeConfig: RuntimeConfig;

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly queueManager: QueueManager<TState>,
    private readonly stateManager: StateManager<TState>,
    private readonly config: WorkerConfig,
    private readonly queuePrefix: string = "am2z",
    private readonly logger: Logger = createComponentLogger("WorkerManager"),
    private readonly eventEmitter: (
      eventType: string,
      data: unknown
    ) => void = () => {},
    private readonly processorCaller: (
      processorName: string,
      state: TState,
      callContext?: Partial<ProcessorCallContext>
    ) => Promise<ProcessorResult<TState>> = async () => ({
      success: false,
      error: new Error("No processor caller provided") as AM2ZError,
      state: {} as TState,
      executionTime: 0,
      metadata: {} as any,
    }),
    runtimeConfig?: RuntimeConfig,
    private readonly runtime?: any
  ) {
    this.runtimeConfig = runtimeConfig || DEFAULT_RUNTIME_CONFIG;
    this.executor = new ProcessorExecutor<TState>(
      this.stateManager,
      this.runtimeConfig.defaultTimeout
    );
    this.namingUtility = new NamingUtility(this.queuePrefix);
  }

  /**
   * Create worker for a processor
   */
  async createWorker(
    processor: ProcessorDefinition<TState>,
    sessionId?: string
  ): Promise<void> {
    const workerKey = this.getWorkerKey(processor.name, sessionId);
    const queueName = this.getQueueName(processor.name, sessionId);

    const worker = new Worker(
      queueName,
      async (job) => {
        // Process job using shared executor (timeout handled internally)
        const result = await this.processJob(job, processor);

        // Critical Fix: If processor returned failure, throw error to mark job as failed in BullMQ
        if (!result.success) {
          const error = result.error || new Error("Processor execution failed");

          // Preserve full result in error data for debugging
          (error as any).jobResult = result;

          this.logger.error(`Job failed: ${job.id}`, error, {
            processorName: processor.name,
            executionId: job.data.executionId,
            executionTime: result.executionTime,
          });

          throw error; // This makes BullMQ treat the job as failed and trigger retry logic
        }

        // Return successful result
        return result;
      },
      {
        concurrency:
          processor.config.queueConfig?.concurrency ??
          this.config.concurrency ??
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

    this.workers.set(workerKey, worker);
    this.setupWorkerEvents(worker, processor.name);

    // Track session-specific workers
    if (sessionId) {
      this.sessionManager.addToSession(sessionId, workerKey);
    }

    this.logger.debug(`Created worker for processor: ${processor.name}`, {
      queueName,
      sessionId,
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
    const { processorName, state, sessionId, executionId, callContext } =
      job.data;

    const metadata = this.metadataFactory.createMetadata(
      processorName,
      sessionId,
      executionId,
      Date.now(),
      callContext?.retryAttempt || 1
    );

    // ✅ IMPROVED: Create logger with chain context if available
    const logger = callContext?.chainName
      ? this.logger.withContext({
          chainName: callContext.chainName,
          chainPosition: callContext.chainPosition,
          parentExecutionId: callContext.parentExecutionId,
        })
      : this.logger;

    // ✅ IMPROVED: Create context with inherited call depth and chain info
    const baseContext = this.contextFactory.createContext(
      processor,
      metadata,
      this.processorCaller,
      this.eventEmitter,
      logger,
      callContext?.callDepth || 0, // ✅ Inherit call depth
      this.runtimeConfig.maxCallDepth
      // AbortSignal is now handled internally by ProcessorExecutor
    );

    // Add updateProgress function and runtime access
    const context: ProcessorContext<TState> = {
      ...baseContext,
      updateProgress: async (progress: number) => {
        await job.updateProgress(progress);
        this.eventEmitter("job:progress", {
          jobId: job.id,
          processorName,
          progress,
          executionId,
        });
      },
      runtime: this.runtime ? {
        emit: (event: string, data: any) => this.runtime.emit(event, data)
      } : undefined,
    };

    return this.executor.executeProcessor(processor, state, context);
  }

  /**
   * Setup worker event listeners
   */
  private setupWorkerEvents(
    worker: Worker,
    processorName: string
  ): void {
    worker.on("completed", (job, returnvalue) => {
      const executionTime = Date.now() - job.processedOn!;
      this.logger.debug(`Worker - job completed: ${job.id}`, {
        processorName,
        executionTime,
      });
      this.logger.info("[WORKER] Job completed", {
        executionId: job.data.executionId,
        processorName: job.data.processorName,
        parentExecutionId: job.data.callContext?.parentExecutionId,
        chainName: job.data.callContext?.chainName,
        chainPosition: job.data.callContext?.chainPosition,
      });
      this.eventEmitter("processor:job:completed", {
        jobId: job.id,
        processorName,
        result: returnvalue,
        executionTime,
        executionId: job.data?.executionId || job.id,
      });
    });

    worker.on("failed", (job, err) => {
      this.logger.error(`Worker - job failed: ${job?.id}`, err, {
        processorName,
        attempts: job?.attemptsMade,
      });
      this.logger.info("[WORKER] Job failed", {
        executionId: job?.data?.executionId,
        processorName: job?.data?.processorName,
        parentExecutionId: job?.data?.callContext?.parentExecutionId,
        chainName: job?.data?.callContext?.chainName,
        chainPosition: job?.data?.callContext?.chainPosition,
      });
      this.eventEmitter("processor:job:failed", {
        jobId: job?.id,
        processorName,
        error: err,
        result: (err as any).jobResult,
        executionId: job?.data?.executionId || job?.id,
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
  getWorker(processorName: string, sessionId?: string): Worker | undefined {
    const workerKey = this.getWorkerKey(processorName, sessionId);
    return this.workers.get(workerKey);
  }

  /**
   * Remove worker
   */
  async removeWorker(processorName: string, sessionId?: string): Promise<void> {
    const workerKey = this.getWorkerKey(processorName, sessionId);
    const worker = this.workers.get(workerKey);
    if (worker) {
      await worker.close();
      this.workers.delete(workerKey);

      // Clean up session tracking
      if (sessionId) {
        this.sessionManager.removeFromSession(sessionId, workerKey);
      }

      this.logger.debug(`Removed worker for processor: ${processorName}`, {
        sessionId,
      });
    }
  }

  /**
   * Close all workers
   */
  async closeAll(): Promise<void> {
    const closings = Array.from(this.workers.entries()).map(
      async ([name, worker]) => {
        try {
          await worker.close();
        } catch (error) {
          this.logger.warn(`Error closing worker for ${name}`, { error });
        }
      }
    );
    await Promise.all(closings);
    this.workers.clear();
    this.logger.info("All workers closed");
  }

  private getQueueName(processorName: string, sessionId?: string): string {
    const baseName = `${this.queuePrefix}_${processorName}`;
    return sessionId ? `${baseName}_${sessionId}` : baseName;
  }

  private getWorkerKey(processorName: string, sessionId?: string): string {
    return sessionId ? `${processorName}_${sessionId}` : processorName;
  }

  /**
   * Check if a worker exists for the given processor
   */
  hasWorker(processorName: string, sessionId?: string): boolean {
    const workerKey = this.getWorkerKey(processorName, sessionId);
    return this.workers.has(workerKey);
  }

  /**
   * Get total number of workers
   */
  getWorkerCount(): number {
    return this.workers.size;
  }

  /**
   * Stop specific worker
   */
  async stopWorker(processorName: string, sessionId?: string): Promise<void> {
    await this.removeWorker(processorName, sessionId);
  }

  /**
   * Stop all workers
   */
  async stopAll(): Promise<void> {
    await this.closeAll();
  }

  /**
   * Create session-specific worker
   */
  async createSessionWorker(processor: ProcessorDefinition<TState>, sessionId: string): Promise<Worker> {
    await this.createWorker(processor, sessionId);
    const worker = this.getWorker(processor.name, sessionId);
    if (!worker) {
      throw new Error(`Failed to create session worker for ${processor.name}`);
    }
    return worker;
  }

  /**
   * Stop all workers for a session
   */
  async stopSessionWorkers(sessionId: string): Promise<void> {
    await this.cleanSession(sessionId);
  }

  /**
   * Clean up all workers for a specific session
   */
  async cleanSession(sessionId: string): Promise<void> {
    const sessionWorkerKeys = this.sessionManager.getSessionItems(sessionId);
    if (sessionWorkerKeys.length === 0) {
      return;
    }

    const cleanupPromises = sessionWorkerKeys.map(
      async (workerKey) => {
        const worker = this.workers.get(workerKey);
        if (worker) {
          await worker.close();
          this.workers.delete(workerKey);
        }
      }
    );

    await Promise.all(cleanupPromises);
    this.sessionManager.cleanSession(sessionId);

    this.logger.info(`Cleaned up session workers: ${sessionId}`, {
      cleanedWorkers: sessionWorkerKeys.length,
    });
  }

  /**
   * Get all sessions with active workers
   */
  getActiveSessions(): string[] {
    return this.sessionManager.getActiveSessions();
  }
}
