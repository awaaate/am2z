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
  createQueue(processor: ProcessorDefinition<TState>): Queue {
    const queueName = this.getQueueName(processor.name);

    if (this.queues.has(processor.name)) {
      return this.queues.get(processor.name)!;
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
        ...this.config.defaultJobOptions,
      },
    });

    this.queues.set(processor.name, queue);

    this.logger.debug(`Created queue for processor: ${processor.name}`, {
      queueName,
    });

    return queue;
  }

  /**
   * Get existing queue
   */
  getQueue(processorName: string): Queue | undefined {
    return this.queues.get(processorName);
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
  async removeQueue(processorName: string): Promise<void> {
    const queue = this.queues.get(processorName);
    if (queue) {
      await queue.close();
      this.queues.delete(processorName);
      this.logger.debug(`Removed queue for processor: ${processorName}`);
    }
  }

  /**
   * Close all queues
   */
  async closeAll(): Promise<void> {
    const closings = Array.from(this.queues.values()).map((queue) =>
      queue.close()
    );
    await Promise.all(closings);
    this.queues.clear();
    this.logger.info("All queues closed");
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(processorName?: string): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};

    const queuesToCheck = processorName
      ? [this.queues.get(processorName)].filter((q) => q !== undefined)
      : Array.from(this.queues.values());

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

  private getQueueName(processorName: string): string {
    return `${this.queuePrefix}_${processorName}`;
  }
}
