// src/lib/node/queue-manager.ts
import { Queue, type JobsOptions } from "bullmq";
import { type ProcessorDefinition } from "../core/processor";
import { type AppState } from "../core/state";
import { createLogger, type Logger } from "../core/logging";
import { type ConnectionManager } from "./connection-manager";

export interface QueueConfig {
  readonly defaultJobOptions?: JobsOptions;
  readonly rateLimiter?: {
    readonly max: number;
    readonly duration: number;
  };
}

export class QueueManager<TState extends AppState = AppState> {
  private queues = new Map<string, Queue>();
  private sessionQueues = new Map<string, Set<string>>(); // Track queues per session

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly config: QueueConfig,
    private readonly queuePrefix: string = "am2z",
    private readonly logger: Logger = createLogger({
      component: "QueueManager",
    })
  ) {}

  /**
   * Create queue for a processor
   */
  createQueue(processor: ProcessorDefinition<TState>, sessionId?: string): Queue {
    const queueKey = this.getQueueKey(processor.name, sessionId);
    const queueName = this.getQueueName(processor.name, sessionId);

    if (this.queues.has(queueKey)) {
      return this.queues.get(queueKey)!;
    }

    const queue = new Queue(queueName, {
      connection: this.connectionManager.getConnection("main"),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: processor.config.retryPolicy?.maxAttempts || 3,
        backoff: {
          type: "exponential",
          delay: processor.config.retryPolicy?.backoffMs || 2000,
        },
        // Set job timeout from processor configuration
        ...(processor.config.timeout && { timeout: processor.config.timeout }),
        ...this.config.defaultJobOptions,
      },
      // Apply rate limiter if configured
      ...(this.config.rateLimiter && {
        limiter: {
          max: this.config.rateLimiter.max,
          duration: this.config.rateLimiter.duration,
        },
      }),
    });

    this.queues.set(queueKey, queue);

    // Track session-specific queues
    if (sessionId) {
      if (!this.sessionQueues.has(sessionId)) {
        this.sessionQueues.set(sessionId, new Set());
      }
      this.sessionQueues.get(sessionId)!.add(queueKey);
    }

    this.logger.debug(`Created queue for processor: ${processor.name}`, {
      queueName,
      sessionId,
    });

    return queue;
  }

  /**
   * Get existing queue
   */
  getQueue(processorName: string, sessionId?: string): Queue | undefined {
    const queueKey = this.getQueueKey(processorName, sessionId);
    return this.queues.get(queueKey);
  }

  /**
   * Get all queues
   */
  getAllQueues(): Queue[] {
    return Array.from(this.queues.values());
  }

  /**
   * Remove queue
   */
  async removeQueue(processorName: string, sessionId?: string): Promise<void> {
    const queueKey = this.getQueueKey(processorName, sessionId);
    const queue = this.queues.get(queueKey);
    if (queue) {
      await queue.close();
      this.queues.delete(queueKey);
      
      // Clean up session tracking
      if (sessionId && this.sessionQueues.has(sessionId)) {
        this.sessionQueues.get(sessionId)!.delete(queueKey);
        if (this.sessionQueues.get(sessionId)!.size === 0) {
          this.sessionQueues.delete(sessionId);
        }
      }
      
      this.logger.debug(`Removed queue for processor: ${processorName}`, {
        sessionId,
      });
    }
  }

  /**
   * Close all queues
   */
  async closeAll(): Promise<void> {
    const closings = Array.from(this.queues.values()).map(async (queue) => {
      try {
        await queue.close();
      } catch (error) {
        this.logger.warn(`Error closing queue ${queue.name}`, { error });
      }
    });

    await Promise.all(closings);
    this.queues.clear();
    this.logger.info("All queues closed");
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(processorName?: string, sessionId?: string): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    let queuesToCheck: Queue[];
    if (processorName) {
      const queueKey = this.getQueueKey(processorName, sessionId);
      const queue = this.queues.get(queueKey);
      queuesToCheck = queue ? [queue] : [];
    } else if (sessionId) {
      // Get all queues for this session
      const sessionQueueKeys = this.sessionQueues.get(sessionId) || new Set();
      queuesToCheck = Array.from(sessionQueueKeys)
        .map(key => this.queues.get(key))
        .filter((q): q is Queue => q !== undefined);
    } else {
      queuesToCheck = Array.from(this.queues.values());
    }

    for (const queue of queuesToCheck) {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      stats[queue.name] = {
        waiting,
        active,
        completed,
        failed,
        delayed,
      };
    }

    return stats;
  }

  private getQueueName(processorName: string, sessionId?: string): string {
    const baseName = `${this.queuePrefix}_${processorName}`;
    return sessionId ? `${baseName}_${sessionId}` : baseName;
  }

  private getQueueKey(processorName: string, sessionId?: string): string {
    return sessionId ? `${processorName}_${sessionId}` : processorName;
  }

  async cleanAll(): Promise<void> {
    const queues = this.getAllQueues();
    for (const queue of queues) {
      await queue.clean(0, 1000);
    }
  }

  /**
   * Clean up all queues for a specific session
   */
  async cleanSession(sessionId: string): Promise<void> {
    const sessionQueueKeys = this.sessionQueues.get(sessionId);
    if (!sessionQueueKeys) {
      return;
    }

    const cleanupPromises = Array.from(sessionQueueKeys).map(async (queueKey) => {
      const queue = this.queues.get(queueKey);
      if (queue) {
        // Clean all jobs in the queue
        await queue.clean(0, 1000);
        // Close the queue
        await queue.close();
        // Remove from tracking
        this.queues.delete(queueKey);
      }
    });

    await Promise.all(cleanupPromises);
    this.sessionQueues.delete(sessionId);
    
    this.logger.info(`Cleaned up session queues: ${sessionId}`, {
      cleanedQueues: sessionQueueKeys.size,
    });
  }

  /**
   * Get all sessions with active queues
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessionQueues.keys());
  }
}
