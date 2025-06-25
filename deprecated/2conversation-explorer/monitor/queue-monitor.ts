// AM2Z v4.0 - Simple Queue Monitor for Conversation Explorer
// Basic monitoring without external dependencies

import { Queue } from "bullmq";
import Redis from "ioredis";
import {
  type Logger,
  createLogger,
  createColoredFormatter,
} from "../../../src/lib/core";

/**
 * Simple Queue Monitor Configuration
 */
export interface QueueMonitorConfig {
  readonly redis: {
    readonly host: string;
    readonly port: number;
    readonly password?: string;
    readonly db?: number;
  };
  readonly queues: readonly string[];
  readonly refreshInterval: number;
}

/**
 * Queue Statistics
 */
export interface QueueStats {
  readonly name: string;
  readonly counts: {
    readonly waiting: number;
    readonly active: number;
    readonly completed: number;
    readonly failed: number;
    readonly delayed: number;
  };
  readonly status: {
    readonly paused: boolean;
    readonly healthy: boolean;
  };
  readonly timestamp: string;
}

/**
 * Simple Queue Monitor
 * Provides basic monitoring capabilities for conversation explorer queues
 */
export class SimpleQueueMonitor {
  private queues: Queue[] = [];
  private redis: Redis;
  private monitoringInterval?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    private readonly config: QueueMonitorConfig,
    private readonly logger: Logger = createLogger(
      { component: "QueueMonitor" },
      "info",
      createColoredFormatter()
    )
  ) {
    // Create Redis connection
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db || 0,
    });

    this.setupQueues();
  }

  /**
   * Setup queues for monitoring
   */
  private setupQueues(): void {
    this.config.queues.forEach((queueName) => {
      const queue = new Queue(queueName, {
        connection: this.redis,
      });

      this.queues.push(queue);

      this.logger.info(`Monitoring queue: ${queueName}`);
    });
  }

  /**
   * Get statistics for all queues
   */
  async getStats(): Promise<QueueStats[]> {
    const stats = await Promise.all(
      this.queues.map(async (queue): Promise<QueueStats> => {
        const [waiting, active, completed, failed, delayed, paused] =
          await Promise.all([
            queue.getWaitingCount(),
            queue.getActiveCount(),
            queue.getCompletedCount(),
            queue.getFailedCount(),
            queue.getDelayedCount(),
            queue.isPaused(),
          ]);

        return {
          name: queue.name,
          counts: {
            waiting,
            active,
            completed,
            failed,
            delayed,
          },
          status: {
            paused,
            healthy: active + waiting > 0 || completed > 0,
          },
          timestamp: new Date().toISOString(),
        };
      })
    );

    return stats;
  }

  /**
   * Display stats in console format
   */
  async displayStats(): Promise<void> {
    const stats = await this.getStats();

    console.clear();
    console.log("📊 Queue Monitor - Conversation Explorer");
    console.log("═".repeat(70));
    console.log(`🕐 ${new Date().toLocaleTimeString()}\n`);

    // Summary
    const totalWaiting = stats.reduce((sum, q) => sum + q.counts.waiting, 0);
    const totalActive = stats.reduce((sum, q) => sum + q.counts.active, 0);
    const totalCompleted = stats.reduce(
      (sum, q) => sum + q.counts.completed,
      0
    );
    const totalFailed = stats.reduce((sum, q) => sum + q.counts.failed, 0);

    console.log("📈 Summary:");
    console.log(
      `  Waiting: ${totalWaiting} | Active: ${totalActive} | Completed: ${totalCompleted} | Failed: ${totalFailed}\n`
    );

    // Individual queue stats
    stats.forEach((stat) => {
      const statusIcon = stat.status.paused
        ? "⏸️"
        : stat.status.healthy
          ? "✅"
          : "⚠️";
      console.log(`${statusIcon} ${stat.name}`);
      console.log(`  📋 Waiting: ${stat.counts.waiting}`);
      console.log(`  🔄 Active: ${stat.counts.active}`);
      console.log(`  ✅ Completed: ${stat.counts.completed}`);
      console.log(`  ❌ Failed: ${stat.counts.failed}`);
      console.log(`  ⏰ Delayed: ${stat.counts.delayed}`);
      console.log("");
    });

    console.log("─".repeat(70));
    console.log("Press Ctrl+C to stop monitoring");
  }

  /**
   * Start monitoring
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Monitor is already running");
      return;
    }

    this.isRunning = true;
    this.logger.info("Starting queue monitor", {
      queues: this.config.queues,
      refreshInterval: this.config.refreshInterval,
    });

    // Initial display
    await this.displayStats();

    // Setup interval
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.displayStats();
      } catch (error) {
        this.logger.error("Error displaying stats:", error);
      }
    }, this.config.refreshInterval);

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      console.log("\n\n🛑 Shutting down monitor...");
      this.stop().then(() => {
        process.exit(0);
      });
    });
  }

  /**
   * Stop monitoring
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    await Promise.all([
      ...this.queues.map((queue) => queue.close()),
      this.redis.disconnect(),
    ]);

    this.logger.info("Queue monitor stopped");
  }

  /**
   * Clear completed jobs from all queues
   */
  async clearCompleted(): Promise<void> {
    this.logger.info("Clearing completed jobs from all queues...");

    await Promise.all(
      this.queues.map(async (queue) => {
        const clearedCount = await queue.clean(0, 100, "completed");
        this.logger.info(
          `Cleared ${clearedCount} completed jobs from ${queue.name}`
        );
      })
    );
  }

  /**
   * Pause all queues
   */
  async pauseAll(): Promise<void> {
    this.logger.info("Pausing all queues...");

    await Promise.all(this.queues.map((queue) => queue.pause()));
  }

  /**
   * Resume all queues
   */
  async resumeAll(): Promise<void> {
    this.logger.info("Resuming all queues...");

    await Promise.all(this.queues.map((queue) => queue.resume()));
  }
}

/**
 * Factory function to create queue monitor
 */
export function createSimpleQueueMonitor(
  config?: Partial<QueueMonitorConfig>,
  logger?: Logger
): SimpleQueueMonitor {
  const defaultConfig: QueueMonitorConfig = {
    redis: {
      host: "localhost",
      port: 6379,
    },
    queues: ["conversation-explorer"],
    refreshInterval: 3000, // 3 seconds
    ...config,
  };

  return new SimpleQueueMonitor(defaultConfig, logger);
}

/**
 * Quick start function for CLI monitoring
 */
export async function startQueueMonitor(
  config?: Partial<QueueMonitorConfig>
): Promise<SimpleQueueMonitor> {
  const monitor = createSimpleQueueMonitor(config);
  await monitor.start();
  return monitor;
}
