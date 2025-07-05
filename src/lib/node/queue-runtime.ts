// src/lib/node/distributed-runtime.ts - Completely Refactored
import { Queue, QueueEvents } from "bullmq";
import { ProcessorNotFoundError } from "../core/errors";
import { type Logger } from "../core/logging";
import { createComponentLogger } from "../core/component-logger";
import {
  type ProcessorDefinition,
  type ProcessorResult,
} from "../core/processor";
import {
  validateRuntimeConfig,
  type ProcessorRuntime,
  type RuntimeStats,
} from "../core/runtime";
import { type AppState, type StateManager } from "../core/state";
import { ConnectionManager, type RedisConfig } from "./connection-manager";
import { QueueManager, type QueueConfig } from "./queue-manager";
import { ResultCollector } from "./result-collector";
import { WorkerManager, type WorkerConfig } from "./worker-manager";

import {
  MetadataFactory,
  type ProcessorCallContext,
} from "../core/processor-executor";
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from "../core/runtime";
import { handleError } from "./handle-error";
import {
  JobOptionsBuilder,
  type EnhancedJobData,
  type JobData,
} from "./job-data";
import { RedisStateManager } from "./redis-state-manager";

// === Configuration ===
export interface QueueRuntimeConfig {
  readonly queuePrefix?: string;
  readonly redis: RedisConfig;
  readonly worker?: WorkerConfig;
  readonly queue?: QueueConfig;
  readonly monitoring?: MonitoringConfig;
  readonly errorHandling?: ErrorHandlingConfig;
  readonly runtime?: RuntimeConfig;
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
  private readonly runtimeConfig: RuntimeConfig;

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

  private _isStarted = false;
  private metricsInterval?: NodeJS.Timeout;

  constructor(
    private readonly config: QueueRuntimeConfig,
    private readonly logger: Logger = createComponentLogger("QueueRuntime")
  ) {
    // Merge runtime config with defaults
    this.runtimeConfig = validateRuntimeConfig({
      ...DEFAULT_RUNTIME_CONFIG,
      ...config.runtime,
    });
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
      (processorName, state, callContext) =>
        this.executeViaCall(processorName, state, callContext),
      this.runtimeConfig,
      this
    );
    this.resultCollector = new ResultCollector(
      logger,
      this.runtimeConfig.autoCleanupInterval,
      this.runtimeConfig.staleExecutionTimeout
    );
    this.metadataFactory = new MetadataFactory();

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
      timeout: processor.config.timeout,
      retryPolicy: processor.config.retryPolicy,
      queueConfig: processor.config.queueConfig,
    });

    // Register dependencies if any
    if (processor.deps) {
      for (const dep of processor.deps) {
        this.register(dep as unknown as ProcessorDefinition<TState>);
      }
    }

    return this;
  }

  registerMany(processors: ProcessorDefinition<TState>[]): this {
    for (const processor of processors) {
      this.register(processor);
    }
    return this;
  }

  /**
   * Synchronize all registered processors - creates queues, workers and queue events
   * This is the same logic used in start() but can be called independently
   * Only creates infrastructure that doesn't already exist
   */
  async syncProcessors(): Promise<void> {
    this.logger.info("Synchronizing processors...");

    // Create infrastructure for all registered processors in parallel
    const syncPromises = Array.from(this.processors.values()).map(
      async (processor) => {
        // ✅ 1. Check if queue already exists
        const existingQueue = this.queueManager.getQueue(processor.name);
        if (!existingQueue) {
          this.queueManager.createQueue(processor);
          this.logger.debug(`Created queue for: ${processor.name}`);
        } else {
          this.logger.debug(`Queue already exists for: ${processor.name}`);
        }

        // ✅ 2. Check if worker already exists
        const existingWorker = this.workerManager.getWorker(processor.name);
        if (!existingWorker) {
          await this.workerManager.createWorker(processor);
          this.logger.debug(`Created worker for: ${processor.name}`);
        } else {
          this.logger.debug(`Worker already exists for: ${processor.name}`);
        }

        // ✅ 3. Check if queue events already setup
        const hasQueueEvents = this.queueEvents.has(processor.name);
        if (
          this.config.monitoring?.enableQueueEvents !== false &&
          !hasQueueEvents
        ) {
          this.setupQueueEvents(processor.name);
          this.logger.debug(`Setup queue events for: ${processor.name}`);
        } else if (hasQueueEvents) {
          this.logger.debug(
            `Queue events already setup for: ${processor.name}`
          );
        }
      }
    );
    await Promise.all(syncPromises);

    this.logger.info("Processor synchronization completed", {
      processorsCount: this.processors.size,
    });
  }

  isProcessorRegistered(processorName: string): boolean {
    return this.processors.has(processorName);
  }

  getRegisteredProcessorNames(): string[] {
    return Array.from(this.processors.keys());
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
    if (this._isStarted) {
      this.logger.warn("Runtime already started");
      return;
    }

    this.logger.info("Starting distributed runtime...");

    // Sync all processors (workers + queue events)
    await this.syncProcessors();

    // Setup monitoring if enabled
    if (this.config.monitoring?.enableMetrics) {
      this.startMetricsCollection();
    }

    this._isStarted = true;

    this.logger.info("Distributed runtime started", {
      registeredProcessors: Array.from(this.processors.keys()),
    });
  }

  /**
   * Check if the runtime is started
   */
  isStarted(): boolean {
    return this._isStarted;
  }

  /**
   * Get list of registered processor names
   */
  listProcessors(): string[] {
    return Array.from(this.processors.keys());
  }

  /**
   * Get queue statistics for all processors
   */
  async getQueueStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    for (const processorName of this.processors.keys()) {
      const queue = this.queueManager.getQueue(processorName);
      if (queue) {
        const counts = await queue.getJobCounts();
        stats[processorName] = {
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          completed: counts.completed || 0,
          failed: counts.failed || 0,
          delayed: counts.delayed || 0,
          paused: counts.paused || 0,
        };
      }
    }

    return stats;
  }

  /**
   * Event-driven execution with proper stats tracking
   */
  async execute(
    processorName: string,
    state: TState,
    sessionId = "distributed-session"
  ): Promise<ProcessorResult<TState>> {
    if (!this._isStarted) {
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

    // Increment stats at the start and ensure decrement in finally
    this.stats.runningJobs++;

    try {
      await this.stateManager.set(sessionId, state);

      // Create simplified job data
      const jobData: JobData<TState> = {
        processorName,
        state,
        sessionId,
        executionId,
      };

      // Build job options (timeout manejado por ProcessorExecutor)
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

      // Wait for result via events (timeout manejado por ProcessorExecutor)
      const result = await this.resultCollector.waitForResult(
        executionId,
        undefined,
        sessionId
      );

      // Update stats for successful/failed jobs (but don't modify runningJobs here)
      if (result.success) {
        this.stats.completedJobs++;
      } else {
        this.stats.failedJobs++;
      }

      return result;
    } finally {
      // Always decrement runningJobs counter
      this.stats.runningJobs--;
    }
  }

  async executeMany(
    processorName: string,
    states: TState[],
    sessionId = "distributed-session"
  ): Promise<ProcessorResult<TState>[]> {
    if (!this._isStarted) {
      throw new Error("Runtime not started. Call start() first.");
    }

    const processor = this.processors.get(processorName);
    if (!processor) {
      throw new ProcessorNotFoundError(
        processorName,
        Array.from(this.processors.keys())
      );
    }

    const queue = this.queueManager.getQueue(processorName);
    if (!queue) {
      throw new Error(`Queue not found for processor: ${processorName}`);
    }

    // Generate execution IDs and register with ResultCollector
    const executionData = states.map((state) => {
      const executionId =
        this.metadataFactory.generateExecutionId(processorName);

      // Save state for each execution
      this.stateManager.set(sessionId, state).catch((error) => {
        this.logger.warn(`Failed to save state for execution ${executionId}`, {
          error,
        });
      });

      const jobData: JobData<TState> = {
        processorName,
        state,
        sessionId,
        executionId,
      };

      return {
        executionId,
        jobData,
        state,
      };
    });

    // Build job options (timeout manejado por ProcessorExecutor)
    const jobOptions = new JobOptionsBuilder()
      .withPriority(processor.config.queueConfig?.priority || 0)
      .withAttempts(processor.config.retryPolicy?.maxAttempts || 3)
      .withBackoff(processor.config.retryPolicy?.backoffMs || 2000)
      .build();

    // Prepare jobs for bulk insert
    const jobs = executionData.map(({ jobData }) => ({
      name: processorName,
      data: jobData,
      opts: jobOptions,
    }));

    // Add all jobs to queue
    await queue.addBulk(jobs);

    // Update running jobs counter
    this.stats.runningJobs += executionData.length;

    this.logger.debug(`Enqueued ${jobs.length} jobs for ${processorName}`, {
      sessionId,
      executionIds: executionData.map((ed) => ed.executionId),
    });

    // Wait for all results using Promise.allSettled for better error handling
    const resultPromises = executionData.map(async ({ executionId, state }) => {
      try {
        const result = await this.resultCollector.waitForResult(
          executionId,
          undefined,
          sessionId
        );

        // Update stats
        if (result.success) {
          this.stats.completedJobs++;
        } else {
          this.stats.failedJobs++;
        }

        return result;
      } catch (error) {
        // Create failed result for timeout/error cases
        this.stats.failedJobs++;

        return {
          state,
          executionTime: 0, // Sin timeout explícito, se maneja en ProcessorExecutor
          success: false,
          error: handleError(error, processorName, executionId),
          metadata: this.metadataFactory.createMetadata(
            processorName,
            sessionId,
            executionId
          ),
        } as ProcessorResult<TState>;
      } finally {
        // Decrement running jobs counter
        this.stats.runningJobs--;
      }
    });

    // Wait for all executions to complete
    const results = await Promise.allSettled(resultPromises);

    // Return all results, converting rejected promises to failed results
    return results.map((result, index) => {
      if (result.status === "fulfilled") {
        return result.value;
      } else {
        const executionInfo = executionData[index];
        if (!executionInfo) {
          throw new Error(`Missing execution info for index ${index}`);
        }

        const { state, executionId } = executionInfo;
        return {
          state,
          executionTime: 0,
          success: false,
          error: handleError(result.reason, processorName, executionId),
          metadata: this.metadataFactory.createMetadata(
            processorName,
            sessionId,
            executionId
          ),
        } as ProcessorResult<TState>;
      }
    });
  }

  /**
   * ctx.call implementation - event-driven with context propagation
   */
  private async executeViaCall(
    processorName: string,
    state: TState,
    callContext?: Partial<ProcessorCallContext>
  ): Promise<ProcessorResult<TState>> {
    try {
      // ✅ IMPROVED: Pass context to execute and return full result
      return await this.executeWithContext(processorName, state, callContext);
    } catch (error) {
      const am2zError = handleError(error, processorName, "call-execution");

      // Return a failed ProcessorResult
      return {
        state,
        executionTime: 0,
        success: false,
        error: am2zError,
        metadata: this.metadataFactory.createMetadata(
          processorName,
          callContext?.sessionId || "unknown-session",
          callContext?.parentExecutionId
        ),
      };
    }
  }

  // ✅ NEW: executeWithContext method
  private async executeWithContext(
    processorName: string,
    state: TState,
    callContext?: Partial<ProcessorCallContext>
  ): Promise<ProcessorResult<TState>> {
    if (!this._isStarted) {
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
        metadata: this.metadataFactory.createMetadata(
          processorName,
          callContext?.sessionId || "call-session"
        ),
      };
    }

    const queue = this.queueManager.getQueue(processorName);
    if (!queue) {
      throw new Error(`Queue not found for processor: ${processorName}`);
    }

    // ✅ IMPROVED: Generate execution ID with context
    const executionId = this.metadataFactory.generateExecutionId(
      processorName,
      callContext?.parentExecutionId
    );

    this.stats.runningJobs++;

    try {
      // ✅ IMPROVED: Use provided sessionId or generate
      const sessionId = callContext?.sessionId || `call-session-${Date.now()}`;
      await this.stateManager.set(sessionId, state);

      // ✅ IMPROVED: Enhanced job data with context
      const jobData: EnhancedJobData<TState> = {
        processorName,
        state,
        sessionId,
        executionId,
        // ✅ NEW: Context propagation
        callContext: {
          callDepth: callContext?.callDepth || 0,
          parentExecutionId: callContext?.parentExecutionId,
          chainName: callContext?.chainName,
          chainPosition: callContext?.chainPosition,
          isRetry: callContext?.isRetry || false,
          retryAttempt: callContext?.retryAttempt || 1,
        },
      };

      // Enhanced job options (timeout manejado por ProcessorExecutor)
      const jobOptions = new JobOptionsBuilder()
        .withJobId(executionId)
        .withPriority(processor.config.queueConfig?.priority || 0)
        .withAttempts(processor.config.retryPolicy?.maxAttempts || 3)
        .withBackoff(processor.config.retryPolicy?.backoffMs || 2000)
        // ✅ NEW: Chain metadata for BullMQ UI
        .withMetadata({
          chainName: callContext?.chainName,
          chainPosition: callContext?.chainPosition,
          parentExecutionId: callContext?.parentExecutionId,
        })
        .build();

      const job = await queue.add(processorName, jobData, jobOptions);

      this.logger.debug(`Enqueued nested job: ${job.id}`, {
        processorName,
        sessionId,
        executionId,
        callDepth: callContext?.callDepth,
        chainName: callContext?.chainName,
      });

      const result = await this.resultCollector.waitForResult(
        executionId,
        undefined,
        sessionId
      );

      if (result.success) {
        this.stats.completedJobs++;
      } else {
        this.stats.failedJobs++;
      }

      return result;
    } finally {
      this.stats.runningJobs--;
    }
  }

  async cleanAllQueues(): Promise<void> {
    await this.queueManager.cleanAll();
  }

  async stop(): Promise<void> {
    if (!this._isStarted) {
      this.logger.warn("Runtime not started");
      return;
    }

    this.logger.info("Stopping distributed runtime...");

    try {
      // Get stats before we start closing things
      const finalStats = await this.getStats();

      // Stop metrics collection
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = undefined;
      }

      // Clean up stale executions before shutdown
      this.resultCollector.cleanupStale(
        this.runtimeConfig.staleExecutionTimeout
      );

      // Close all components and clean up resources
      await Promise.allSettled([
        this.workerManager.closeAll(),
        this.queueManager.closeAll(),
        this.closeQueueEvents(),
        this.resultCollector.cleanup(),
      ]);

      // Clean up event handlers to prevent memory leaks
      this.eventHandlers.clear();

      // Set stopped state before disconnecting
      this._isStarted = false;

      this.logger.info("Distributed runtime stopped", {
        stats: finalStats,
      });
    } catch (error) {
      this.logger.error("Error during runtime stop", error);
      this._isStarted = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.connectionManager.disconnect();
  }

  getProcessors(): ProcessorDefinition<TState>[] {
    return Array.from(this.processors.values());
  }

  async getStats(): Promise<
    RuntimeStats & { queueStats: Record<string, any> }
  > {
    // Calculate accurate stats from BullMQ for distributed systems
    let totalRunningJobs = 0;
    let totalCompletedJobs = 0;
    let totalFailedJobs = 0;

    const queueStats = await this.queueManager.getQueueStats();

    // Aggregate stats from all queues
    for (const queueName in queueStats) {
      const stats = queueStats[queueName];
      totalRunningJobs +=
        (stats.active || 0) + (stats.waiting || 0) + (stats.delayed || 0);
      totalCompletedJobs += stats.completed || 0;
      totalFailedJobs += stats.failed || 0;
    }

    return {
      registeredProcessors: Array.from(this.processors.keys()),
      runningJobs: totalRunningJobs,
      completedJobs: totalCompletedJobs,
      failedJobs: totalFailedJobs,
      uptime: Date.now() - this.stats.startedAt,
      queueStats,
    };
  }

  // === Session Management ===

  /**
   * Execute processor with session isolation
   */
  async executeInSession(
    processorName: string,
    state: TState,
    sessionId: string
  ): Promise<ProcessorResult<TState>> {
    // Create session-specific infrastructure if needed
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
        metadata: this.metadataFactory.createMetadata(
          processorName,
          sessionId,
          "failed",
          Date.now(),
          1
        ),
      };
    }

    // Ensure session-specific queue and worker exist
    await this.ensureSessionInfrastructure(processor, sessionId);

    // Execute with session-specific queue
    const sessionQueue = this.queueManager.getQueue(processorName, sessionId);
    if (!sessionQueue) {
      throw new Error(
        `Session queue not found for processor: ${processorName}, session: ${sessionId}`
      );
    }

    const executionId = this.metadataFactory.generateExecutionId(processorName);
    this.stats.runningJobs++;

    try {
      // Save state to Redis with session isolation
      await this.stateManager.set(sessionId, state);

      // Create job data with session context
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

      // Add job to session-specific queue
      await sessionQueue.add(processorName, jobData, jobOptions);

      // Wait for result
      const result = await this.resultCollector.waitForResult(
        executionId,
        undefined,
        sessionId
      );

      if (result.success) {
        this.stats.completedJobs++;
      } else {
        this.stats.failedJobs++;
      }

      return result;
    } finally {
      this.stats.runningJobs--;
    }
  }

  /**
   * Stop and clean up a specific session
   */
  async stopSession(sessionId: string): Promise<void> {
    this.logger.info(`Stopping session: ${sessionId}`);

    try {
      // Clean up session-specific workers and queues
      await Promise.all([
        this.workerManager.cleanSession(sessionId),
        this.queueManager.cleanSession(sessionId),
      ]);

      // Clean up session-specific result collection
      this.resultCollector.cleanupSession(sessionId);

      // Note: StateManager doesn't provide delete method
      // Session state will be cleaned up by Redis TTL or manual cleanup
      this.logger.debug(
        `Session state cleanup skipped for: ${sessionId} (no delete method available)`
      );

      this.logger.info(`Session stopped: ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to stop session: ${sessionId}`, error);
      throw error;
    }
  }

  /**
   * Get statistics for a specific session
   */
  async getSessionStats(sessionId: string): Promise<Record<string, any>> {
    return await this.queueManager.getQueueStats(undefined, sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    const queueSessions = this.queueManager.getActiveSessions();
    const workerSessions = this.workerManager.getActiveSessions();

    // Combine and deduplicate
    const allSessions = new Set([...queueSessions, ...workerSessions]);
    return Array.from(allSessions);
  }

  /**
   * Clean up all sessions
   */
  async cleanAllSessions(): Promise<void> {
    const activeSessions = this.getActiveSessions();

    const cleanupPromises = activeSessions.map((sessionId) =>
      this.stopSession(sessionId).catch((error) =>
        this.logger.warn(`Failed to clean session ${sessionId}`, { error })
      )
    );

    await Promise.all(cleanupPromises);
    this.logger.info(`Cleaned up ${activeSessions.length} sessions`);
  }

  /**
   * Ensure session-specific infrastructure exists
   */
  private async ensureSessionInfrastructure(
    processor: ProcessorDefinition<TState>,
    sessionId: string
  ): Promise<void> {
    // Check if session-specific queue exists
    const existingQueue = this.queueManager.getQueue(processor.name, sessionId);
    if (!existingQueue) {
      this.queueManager.createQueue(processor, sessionId);
    }

    // Check if session-specific worker exists
    const existingWorker = this.workerManager.getWorker(
      processor.name,
      sessionId
    );
    if (!existingWorker) {
      await this.workerManager.createWorker(processor, sessionId);
    }

    // Setup session-specific queue events if monitoring is enabled
    const sessionQueueKey = `${processor.name}_${sessionId}`;
    if (
      this.config.monitoring?.enableQueueEvents !== false &&
      !this.queueEvents.has(sessionQueueKey)
    ) {
      this.setupQueueEvents(processor.name, sessionId);
    }
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

  emit(eventType: string, data: unknown): void {
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
    if (this.config.errorHandling?.enableGlobalHandlers !== false) {
      // Global error handlers setup would go here
    }
  }

  private setupEventListeners(): void {
    // Listen to the correct events emitted by the worker
    this.on("processor:job:completed", (data: any) => {
      this.logger.debug("Forwarding job:completed to ResultCollector", {
        executionId: data.executionId,
        processorName: data.processorName,
      });

      // Forward to result collector with the correct event name
      this.resultCollector.emit("job:completed", {
        executionId: data.executionId,
        result: data.result, // Worker already sends the complete result
      });
    });

    this.on("processor:job:failed", (data: any) => {
      this.logger.debug("Forwarding job:failed to ResultCollector", {
        executionId: data.executionId,
        processorName: data.processorName,
      });

      // Forward to result collector with the correct event name
      this.resultCollector.emit("job:failed", {
        executionId: data.executionId,
        error: data.error,
        result: data.result,
      });
    });

    this.on("processor:active", () => {
      // Don't modify runningJobs here - it's handled in execute()
    });
  }

  private setupQueueEvents(processorName: string, sessionId?: string): void {
    const queueName = sessionId
      ? `${this.config.queuePrefix || "am2z"}_${processorName}_${sessionId}`
      : `${this.config.queuePrefix || "am2z"}_${processorName}`;

    const queueEvents = new QueueEvents(queueName, {
      connection: this.connectionManager.getConnection("events"),
    });

    // Use different key for session-specific events
    const eventsKey = sessionId
      ? `${processorName}_${sessionId}`
      : processorName;
    this.queueEvents.set(eventsKey, queueEvents);

    queueEvents.on("completed", ({ jobId, returnvalue }) => {
      this.emit("queue:completed", {
        jobId,
        processorName,
        sessionId,
        returnvalue,
      });
    });

    queueEvents.on("failed", ({ jobId, failedReason }) => {
      this.emit("queue:failed", {
        jobId,
        processorName,
        sessionId,
        reason: failedReason,
      });
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
  runtimeConfig?: Partial<RuntimeConfig>,
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
    runtime: {
      ...DEFAULT_RUNTIME_CONFIG,
      ...runtimeConfig,
    },
  };

  return new QueueRuntime<TState>(config, logger);
}
