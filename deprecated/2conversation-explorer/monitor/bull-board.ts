// AM2Z v4.0 - Bull Board Monitor for Conversation Explorer
// Web UI for monitoring conversation explorer queues and tasks

import express from "express";
import { Queue } from "bullmq";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import Redis from "ioredis";

import {
  type Logger,
  createLogger,
  createColoredFormatter,
} from "../../../src/lib/core";
import { type DistributedRuntimeConfig } from "../../../src/lib/node/distributed-runtime";

/**
 * Bull Board Monitor Configuration
 */
export interface BullBoardConfig {
  readonly port: number;
  readonly basePath: string;
  readonly redis: {
    readonly host: string;
    readonly port: number;
    readonly password?: string;
    readonly db?: number;
  };
  readonly queues: readonly {
    readonly name: string;
    readonly displayName?: string;
  }[];
}

/**
 * Bull Board Monitor for Conversation Explorer
 * Provides web UI to monitor queue tasks and performance
 */
export class ConversationExplorerMonitor {
  private app: express.Application;
  private queues: Queue[] = [];
  private serverAdapter: ExpressAdapter;
  private logger: Logger;
  private redis: Redis;

  constructor(
    private readonly config: BullBoardConfig,
    logger?: Logger
  ) {
    this.logger =
      logger ||
      createLogger(
        { component: "BullBoardMonitor" },
        "info",
        createColoredFormatter()
      );

    this.app = express();
    this.serverAdapter = new ExpressAdapter();
    this.serverAdapter.setBasePath(config.basePath);

    // Create Redis connection
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db || 0,
    });

    this.setupQueues();
    this.setupBullBoard();
    this.setupRoutes();
  }

  /**
   * Setup queues for monitoring
   */
  private setupQueues(): void {
    this.config.queues.forEach((queueConfig) => {
      const queue = new Queue(queueConfig.name, {
        connection: this.redis,
      });

      this.queues.push(queue);

      this.logger.info(`Monitoring queue: ${queueConfig.name}`, {
        displayName: queueConfig.displayName || queueConfig.name,
      });
    });
  }

  /**
   * Setup Bull Board with queue adapters
   */
  private setupBullBoard(): void {
    const queueAdapters = this.queues.map((queue) => new BullMQAdapter(queue));

    const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard(
      {
        queues: queueAdapters,
        serverAdapter: this.serverAdapter,
      }
    );

    this.logger.info("Bull Board configured", {
      queueCount: this.queues.length,
      basePath: this.config.basePath,
    });
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // Bull Board UI
    this.app.use(this.config.basePath, this.serverAdapter.getRouter());

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        queues: this.queues.map((queue) => ({
          name: queue.name,
          connection: "active",
        })),
      });
    });

    // Queue statistics endpoint
    this.app.get("/api/stats", async (req, res) => {
      try {
        const stats = await this.getQueueStats();
        res.json(stats);
      } catch (error) {
        this.logger.error("Failed to get queue stats:", error);
        res.status(500).json({ error: "Failed to get queue statistics" });
      }
    });

    // Clear completed jobs endpoint
    this.app.post(
      "/api/queues/:queueName/clear-completed",
      async (req, res) => {
        try {
          const queueName = req.params.queueName;
          const queue = this.queues.find((q) => q.name === queueName);

          if (!queue) {
            return res.status(404).json({ error: "Queue not found" });
          }

          await queue.clean(0, 100, "completed");

          this.logger.info(`Cleared completed jobs for queue: ${queueName}`);
          res.json({ message: "Completed jobs cleared" });
        } catch (error) {
          this.logger.error("Failed to clear completed jobs:", error);
          res.status(500).json({ error: "Failed to clear completed jobs" });
        }
      }
    );

    // Pause/Resume queue endpoints
    this.app.post("/api/queues/:queueName/pause", async (req, res) => {
      try {
        const queueName = req.params.queueName;
        const queue = this.queues.find((q) => q.name === queueName);

        if (!queue) {
          return res.status(404).json({ error: "Queue not found" });
        }

        await queue.pause();

        this.logger.info(`Queue paused: ${queueName}`);
        res.json({ message: "Queue paused" });
      } catch (error) {
        this.logger.error("Failed to pause queue:", error);
        res.status(500).json({ error: "Failed to pause queue" });
      }
    });

    this.app.post("/api/queues/:queueName/resume", async (req, res) => {
      try {
        const queueName = req.params.queueName;
        const queue = this.queues.find((q) => q.name === queueName);

        if (!queue) {
          return res.status(404).json({ error: "Queue not found" });
        }

        await queue.resume();

        this.logger.info(`Queue resumed: ${queueName}`);
        res.json({ message: "Queue resumed" });
      } catch (error) {
        this.logger.error("Failed to resume queue:", error);
        res.status(500).json({ error: "Failed to resume queue" });
      }
    });
  }

  /**
   * Get comprehensive queue statistics
   */
  private async getQueueStats() {
    const stats = await Promise.all(
      this.queues.map(async (queue) => {
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
          performance: {
            throughput: completed > 0 ? "active" : "idle",
            backlog: waiting + delayed,
          },
        };
      })
    );

    return {
      timestamp: new Date().toISOString(),
      queues: stats,
      summary: {
        totalQueues: stats.length,
        totalWaiting: stats.reduce((sum, q) => sum + q.counts.waiting, 0),
        totalActive: stats.reduce((sum, q) => sum + q.counts.active, 0),
        totalCompleted: stats.reduce((sum, q) => sum + q.counts.completed, 0),
        totalFailed: stats.reduce((sum, q) => sum + q.counts.failed, 0),
      },
    };
  }

  /**
   * Start the monitoring server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.app.listen(this.config.port, () => {
        this.logger.info("🎛️ Bull Board Monitor started", {
          port: this.config.port,
          uiUrl: `http://localhost:${this.config.port}${this.config.basePath}`,
          apiUrl: `http://localhost:${this.config.port}/api/stats`,
          healthUrl: `http://localhost:${this.config.port}/health`,
        });

        console.log("\n📊 Queue Monitoring Dashboard");
        console.log("═".repeat(50));
        console.log(
          `🎛️  UI: http://localhost:${this.config.port}${this.config.basePath}`
        );
        console.log(`📈 API: http://localhost:${this.config.port}/api/stats`);
        console.log(`💚 Health: http://localhost:${this.config.port}/health`);
        console.log("═".repeat(50));

        resolve();
      });

      server.on("error", (error) => {
        this.logger.error("Failed to start Bull Board Monitor:", error);
        throw error;
      });
    });
  }

  /**
   * Stop the monitoring server
   */
  async stop(): Promise<void> {
    await Promise.all([
      ...this.queues.map((queue) => queue.close()),
      this.redis.disconnect(),
    ]);

    this.logger.info("Bull Board Monitor stopped");
  }
}

/**
 * Factory function to create conversation explorer monitor
 */
export function createConversationExplorerMonitor(
  config?: Partial<BullBoardConfig>,
  logger?: Logger
): ConversationExplorerMonitor {
  const defaultConfig: BullBoardConfig = {
    port: 3000,
    basePath: "/admin/queues",
    redis: {
      host: "localhost",
      port: 6379,
    },
    queues: [
      { name: "conversation-explorer", displayName: "Conversation Explorer" },
    ],
    ...config,
  };

  return new ConversationExplorerMonitor(defaultConfig, logger);
}

/**
 * Quick start function for development
 */
export async function startConversationExplorerMonitor(
  config?: Partial<BullBoardConfig>
): Promise<ConversationExplorerMonitor> {
  const monitor = createConversationExplorerMonitor(config);
  await monitor.start();
  return monitor;
}
