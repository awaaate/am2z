// src/lib/node/distributed-runtime.ts - Completely Refactored
import { Queue, QueueEvents, FlowProducer } from "bullmq";
import { type Result, Success, Failure } from "../core/result";
import { type AppState, type StateManager } from "../core/state";
import { createLogger, type Logger } from "../core/logging";
import { ProcessorNotFoundError, AM2ZError } from "../core/errors";
import { type ProcessorRuntime, type RuntimeStats } from "../core/runtime";
import {
  type ProcessorDefinition,
  type ProcessorResult,
} from "../core/processor";
import { ConnectionManager, type RedisConfig } from "./connection-manager";
import { QueueManager, type QueueConfig } from "./queue-manager";
import { WorkerManager, type WorkerConfig } from "./worker-manager";
import { ResultCollector } from "./result-collector";

import { type JobData, JobOptionsBuilder } from "./job-data";
import { MetadataFactory } from "../core/processor-executor";
import { handleError } from "./handle-error";
import { RedisStateManager } from "./redis-state-manager";

// === Configuration ===
export interface QueueRuntimeConfig {
  readonly queuePrefix?: string;
  readonly redis: RedisConfig;
  readonly worker?: WorkerConfig;
  readonly queue?: QueueConfig;
  readonly monitoring?: MonitoringConfig;
  readonly errorHandling?: ErrorHandlingConfig;
}

export interface MonitoringConfig {
  readonly enableQueueEvents?: boolean;
  readonly enableMetrics?: boolean;
  readonly metricsInterval?: number;
}

export interface ErrorHandlingConfig {
  readonly enableGlobalHandlers?: boolean;
  readonly logUnhandledRejections?: boolean;
  readonly logUncaughtExceptions?: boolean;
}

/**
 * Refactored Distributed Runtime - Event-Driven, Component-Based
 */
export class QueueRuntime<TState extends AppState = AppState>
  implements ProcessorRuntime<TState>
{
  // Component managers
  private readonly connectionManager: ConnectionManager;
  private readonly queueManager: QueueManager<TState>;
  private readonly workerManager: WorkerManager<TState>;
  private readonly resultCollector: ResultCollector<TState>;
  
  private readonly metadataFactory: MetadataFactory;
  private readonly stateManager: StateManager<TState>;

  private readonly flowProducer: FlowProducer;
  private readonly processors = new Map<string, ProcessorDefinition<TState>>();
  private readonly queueEvents = new Map<string, QueueEvents>();
  private readonly eventHandlers = new Map<
    string,
    Array<(data: unknown) => void>
  >();

  private readonly stats = {
    runningJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    startedAt: Date.now(),
  };

  private isStarted = false;
  private metricsInterval?: NodeJS.Timeout;

  constructor(
    private readonly config: QueueRuntimeConfig,
    private readonly logger: Logger = createLogger({
      component: "QueueRuntime",
    })
  ) {
    // Initialize component managers
    this.connectionManager = new ConnectionManager(config.redis, logger);
    this.stateManager = new RedisStateManager<TState>(
      this.connectionManager.getConnection("state")
    );
    this.queueManager = new QueueManager(
      this.connectionManager,
      config.queue || {},
      config.queuePrefix || "am2z",
      logger
    );
    this.workerManager = new WorkerManager(
      this.connectionManager,
      this.queueManager,
      this.stateManager,
      config.worker || {},
      config.queuePrefix || "am2z",
      logger,
      (eventType, data) => this.emit(eventType, data),
      (processorName, state) => this.executeViaCall(processorName, state)
    );
    this.resultCollector = new ResultCollector(logger);
    this.metadataFactory = new MetadataFactory();

    // Initialize FlowProducer
    this.flowProducer = new FlowProducer({
      connection: this.connectionManager.getConnection("main"),
    });

    this.setupErrorHandlers();
    this.setupEventListeners();

    this.logger.info("QueueRuntime initialized", {
      queuePrefix: config.queuePrefix || "am2z",
      redisHost: config.redis.host || "localhost",
      redisPort: config.redis.port || 6379,
    });
  }

  register(processor: ProcessorDefinition<TState>): this {
    this.processors.set(processor.name, processor);
    this.logger.info(`Registered processor: ${processor.name}`, {
      description: processor.config.description,
    });

    // Create dedicated queue for this processor
    this.queueManager.createQueue(processor);

    return this;
  }

  getQueues(): Queue[] {
    return this.queueManager.getAllQueues();
  }

  unregister(processorName: string): this {
    const processor = this.processors.get(processorName);
    if (processor) {
      this.processors.delete(processorName);
      // Cleanup resources async
      this.cleanupProcessorResources(processorName);
      this.logger.info(`Unregistered processor: ${processorName}`);
    }
    return this;
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn("Runtime already started");
      return;
    }

    this.logger.info("Starting distributed runtime...");

    // Start workers for all registered processors
    for (const processor of this.processors.values()) {
      await this.workerManager.createWorker(processor);

      // Setup queue events if monitoring enabled
      if (this.config.monitoring?.enableQueueEvents !== false) {
        this.setupQueueEvents(processor.name);
      }
    }

    // Setup monitoring if enabled
    if (this.config.monitoring?.enableMetrics) {
      this.startMetricsCollection();
    }

    this.isStarted = true;

    this.logger.info("Distributed runtime started", {
      registeredProcessors: Array.from(this.processors.keys()),
    });
  }

  /**
   * Event-driven execution - no waitUntilFinished
   */
  async execute(
    processorName: string,
    state: TState,
    sessionId = "distributed-session"
  ): Promise<ProcessorResult<TState>> {
    if (!this.isStarted) {
      throw new Error("Runtime not started. Call start() first.");
    }

    const processor = this.processors.get(processorName);
    if (!processor) {
      const availableProcessors = Array.from(this.processors.keys());
      const error = new ProcessorNotFoundError(
        processorName,
        availableProcessors
      );

      return {
        state,
        executionTime: 0,
        success: false,
        error,
        metadata: this.metadataFactory.createMetadata(processorName, sessionId),
      };
    }

    const queue = this.queueManager.getQueue(processorName);
    if (!queue) {
      throw new Error(`Queue not found for processor: ${processorName}`);
    }

    const executionId = this.metadataFactory.generateExecutionId(processorName);
    const startTime = Date.now();

    await this.stateManager.set(sessionId, state);

    try {
      // Create simplified job data
      const jobData: JobData<TState> = {
        processorName,
        state,
        sessionId,
        executionId,
      };

      // Build job options
      const jobOptions = new JobOptionsBuilder()
        .withJobId(executionId)
        .withPriority(processor.config.queueConfig?.priority || 0)
        .withAttempts(processor.config.retryPolicy?.maxAttempts || 3)
        .withBackoff(processor.config.retryPolicy?.backoffMs || 2000)
        .build();

      // Add job to queue
      const job = await queue.add(processorName, jobData, jobOptions);

      this.logger.debug(`Enqueued job: ${job.id}`, {
        processorName,
        sessionId,
        executionId,
      });

      // Wait for result via events (no waitUntilFinished)
      const timeout = processor.config.timeout || 30000;
      return await this.resultCollector.waitForResult(executionId, timeout);
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const am2zError = handleError(error, processorName, executionId);

      return {
        state,
        executionTime,
        success: false,
        error: am2zError,
        metadata: this.metadataFactory.createMetadata(
          processorName,
          sessionId,
          executionId,
          startTime
        ),
      };
    }
  }

  async executeMany(
    processorName: string,
    states: TState[],
    sessionId = "distributed-session"
  ): Promise<void> {
    if (!this.isStarted) {
      throw new Error("Runtime not started. Call start() first.");
    }

    const processor = this.processors.get(processorName);
    if (!processor) {
      throw new ProcessorNotFoundError(processorName, Array.from(this.processors.keys()));
    }

    const queue = this.queueManager.getQueue(processorName);
    if (!queue) {
      throw new Error(`Queue not found for processor: ${processorName}`);
    }

    const jobs = states.map(state => {
      const executionId = this.metadataFactory.generateExecutionId(processorName);
      const jobData: JobData<TState> = {
        processorName,
        state,
        sessionId,
        executionId,
      };
      return { name: processorName, data: jobData };
    });

    await queue.addBulk(jobs);
  }

  /**
   * ctx.call implementation - event-driven
   */
  private async executeViaCall(
    processorName: string,
    state: TState
  ): Promise<Result<TState, AM2ZError>> {
    try {
      const result = await this.execute(processorName, state);
      return result.success ? Success(result.state) : Failure(result.error!);
    } catch (error) {
      return Failure(handleError(error, processorName, "call-execution"));
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      this.logger.warn("Runtime not started");
      return;
    }

    this.logger.info("Stopping distributed runtime...");

    // Stop metrics collection
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Close all components
    await Promise.all([
      this.workerManager.closeAll(),
      this.queueManager.closeAll(),
      this.closeQueueEvents(),
      this.flowProducer.close(),
      this.resultCollector.cleanup(),
    ]);

    // Disconnect Redis
    await this.connectionManager.disconnect();

    this.isStarted = false;

    this.logger.info("Distributed runtime stopped", {
      stats: await this.getStats(),
    });
  }

  async getStats(): Promise<
    RuntimeStats & { queueStats: Record<string, any> }
  > {
    return {
      registeredProcessors: Array.from(this.processors.keys()),
      runningJobs: this.stats.runningJobs,
      completedJobs: this.stats.completedJobs,
      failedJobs: this.stats.failedJobs,
      uptime: Date.now() - this.stats.startedAt,
      queueStats: await this.queueManager.getQueueStats(),
    };
  }

  // === Event System ===
  on(eventType: string, handler: (data: unknown) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  off(eventType: string, handler: (data: unknown) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit(eventType: string, data: unknown): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          this.logger.warn("Event handler error", { error, eventType });
        }
      });
    }
  }

  // === Private Methods ===

  private setupErrorHandlers(): void {
    this.flowProducer.on("error", (err) => {
      this.logger.error("FlowProducer error:", err);
    });

    if (this.config.errorHandling?.enableGlobalHandlers !== false) {
      // Global error handlers setup would go here
    }
  }

  private setupEventListeners(): void {
    // Listen to worker events and forward to result collector
    this.on("processor:completed", (data: any) => {
      this.stats.completedJobs++;
      this.resultCollector.emit("job:completed", {
        executionId: data.executionId || data.jobId,
        result: data.returnvalue,
      });
    });

    this.on("processor:failed", (data: any) => {
      this.stats.failedJobs++;
      this.resultCollector.emit("job:failed", {
        executionId: data.executionId || data.jobId,
        error: new Error(data.error),
      });
    });

    this.on("processor:active", () => {
      this.stats.runningJobs++;
    });
  }

  private setupQueueEvents(processorName: string): void {
    const queueName = `${this.config.queuePrefix || "am2z"}_${processorName}`;

    const queueEvents = new QueueEvents(queueName, {
      connection: this.connectionManager.getConnection("events"),
    });

    this.queueEvents.set(processorName, queueEvents);

    queueEvents.on("completed", ({ jobId, returnvalue }) => {
      this.emit("queue:completed", { jobId, processorName, returnvalue });
    });

    queueEvents.on("failed", ({ jobId, failedReason }) => {
      this.emit("queue:failed", { jobId, processorName, reason: failedReason });
    });
  }

  private async closeQueueEvents(): Promise<void> {
    const closings = Array.from(this.queueEvents.values()).map((qe) =>
      qe.close()
    );
    await Promise.all(closings);
    this.queueEvents.clear();
  }

  private async cleanupProcessorResources(
    processorName: string
  ): Promise<void> {
    await Promise.all([
      this.workerManager.removeWorker(processorName),
      this.queueManager.removeQueue(processorName),
    ]);

    const queueEvents = this.queueEvents.get(processorName);
    if (queueEvents) {
      await queueEvents.close();
      this.queueEvents.delete(processorName);
    }
  }

  private startMetricsCollection(): void {
    const interval = this.config.monitoring?.metricsInterval || 30000;

    this.metricsInterval = setInterval(async () => {
      try {
        const stats = await this.getStats();
        this.emit("metrics:collected", stats);
      } catch (error) {
        this.logger.warn("Failed to collect metrics", { error });
      }
    }, interval);
  }
}

// === Factory Functions ===
export function createQueueRuntime<TState extends AppState = AppState>(
  config: QueueRuntimeConfig,
  logger?: Logger
): QueueRuntime<TState> {
  return new QueueRuntime<TState>(config, logger);
}

export function createQueueRuntimeWithDefaults<
  TState extends AppState = AppState,
>(
  redisConfig?: Partial<RedisConfig>,
  logger?: Logger
): QueueRuntime<TState> {
  const config: QueueRuntimeConfig = {
    queuePrefix: "am2z",
    redis: {
      host: "localhost",
      port: 6379,
      lazyConnect: true,
      ...redisConfig,
    },
    worker: {
      concurrency: 5,
      stalledInterval: 30000,
      maxStalledCount: 1,
      removeOnComplete: { count: 100, age: 24 * 60 * 60 * 1000 },
      removeOnFail: { count: 50, age: 24 * 60 * 60 * 1000 },
    },
    monitoring: {
      enableQueueEvents: true,
      enableMetrics: true,
      metricsInterval: 30000,
    },
    errorHandling: {
      enableGlobalHandlers: true,
      logUnhandledRejections: true,
      logUncaughtExceptions: true,
    },
  };

  return new QueueRuntime<TState>(config, logger);
}
