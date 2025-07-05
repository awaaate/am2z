// src/lib/node/connection-manager.ts
import Redis from "ioredis";
import { type Logger } from "../core/logging";
import { createComponentLogger } from "../core/component-logger";
import { NetworkError } from "../core/errors";
import { type ResourceMonitor } from "../core/resource-monitor";

export interface RedisConfig {
  readonly host?: string;
  readonly port?: number;
  readonly password?: string;
  readonly db?: number;
  readonly maxRetriesPerRequest?: number;
  readonly retryDelayOnFailover?: number;
  readonly lazyConnect?: boolean;
  readonly keyPrefix?: string;
}

export class ConnectionManager {
  private connections: Map<string, Redis> = new Map();
  private isConnected = false;

  constructor(
    private readonly config: RedisConfig,
    private readonly logger: Logger = createComponentLogger("ConnectionManager"),
    private readonly resourceMonitor?: ResourceMonitor
  ) {}

  /**
   * Get or create a Redis connection
   */
  getConnection(
    purpose: "main" | "events" | "metrics" | "state" = "main"
  ): Redis {
    const existing = this.connections.get(purpose);
    if (existing) {
      return existing;
    }

    const connection = this.createConnection(purpose);
    this.connections.set(purpose, connection);
    return connection;
  }

  /**
   * Create a new Redis connection with proper error handling
   */
  private createConnection(purpose: string): Redis {
    const redisConfig = {
      host: this.config.host || "localhost",
      port: this.config.port || 6379,
      password: this.config.password,
      db: this.config.db || 0,
      maxRetriesPerRequest: null, // Recommended for BullMQ
      retryDelayOnFailover: this.config.retryDelayOnFailover || 100,
      lazyConnect: this.config.lazyConnect ?? true,
      keyPrefix: this.config.keyPrefix,
    };

    const redis = new Redis(redisConfig);

    // Setup connection event handlers
    redis.on("connect", () => {
      this.logger.info(`Redis connection established (${purpose})`);
    });

    redis.on("ready", () => {
      this.logger.info(`Redis connection ready (${purpose})`);
      this.isConnected = true;
      this.resourceMonitor?.registerConnection();
    });

    redis.on("error", (err) => {
      this.logger.error(`Redis connection error (${purpose}):`, err);
      this.isConnected = false;
    });

    redis.on("close", () => {
      this.logger.warn(`Redis connection closed (${purpose})`);
      this.isConnected = false;
      this.resourceMonitor?.unregisterConnection();
    });

    redis.on("reconnecting", () => {
      this.logger.info(`Redis reconnecting (${purpose})...`);
    });

    return redis;
  }

  /**
   * Health check for all connections
   */
  async healthCheck(): Promise<boolean> {
    try {
      const checks = Array.from(this.connections.entries()).map(
        async ([purpose, connection]) => {
          const result = await connection.ping();
          if (result !== "PONG") {
            throw new NetworkError(`Redis health check failed for ${purpose}`);
          }
        }
      );

      await Promise.all(checks);
      return true;
    } catch (error) {
      this.logger.error("Redis health check failed:", error);
      return false;
    }
  }

  /**
   * Check health of all connections with detailed status
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    connections: Record<string, string>;
  }> {
    const connections: Record<string, string> = {};
    let healthy = true;

    for (const [purpose, connection] of this.connections.entries()) {
      try {
        if (connection.status === 'ready') {
          const result = await connection.ping();
          connections[purpose] = result === 'PONG' ? 'ready' : 'unhealthy';
          if (result !== 'PONG') healthy = false;
        } else {
          connections[purpose] = 'disconnected';
          healthy = false;
        }
      } catch (error) {
        connections[purpose] = 'error';
        healthy = false;
      }
    }

    return { healthy, connections };
  }

  /**
   * Disconnect all connections
   */
  async disconnect(): Promise<void> {
    const disconnections = Array.from(this.connections.values()).map(
      async (conn) => {
        try {
          await conn.disconnect();
        } catch (error) {
          // Ignore disconnection errors
          this.logger.debug("Error disconnecting Redis connection", { error });
        }
      }
    );

    await Promise.all(disconnections);
    this.connections.clear();
    this.isConnected = false;

    this.logger.info("All Redis connections disconnected");
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      connectionCount: this.connections.size,
      connections: Array.from(this.connections.keys()),
    };
  }
}
