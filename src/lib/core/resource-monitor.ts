import { ResourceError } from "./errors";
import { type Logger } from "./logging";
import { createComponentLogger } from "./component-logger";

/**
 * Resource limits configuration
 */
export interface ResourceLimits {
  /** Maximum number of connections allowed per pool */
  readonly maxConnections: number;
  /** Maximum memory usage in MB */
  readonly maxMemoryMB: number;
  /** Maximum queue size before rejecting new jobs */
  readonly maxQueueSize: number;
  /** Session TTL in milliseconds */
  readonly sessionTTL: number;
  /** Memory threshold percentage (0-1) for warnings */
  readonly memoryThreshold: number;
  /** Connection threshold percentage (0-1) for warnings */
  readonly connectionThreshold: number;
}

/**
 * Default resource limits
 */
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxConnections: 50,
  maxMemoryMB: 1024, // 1GB
  maxQueueSize: 10000,
  sessionTTL: 24 * 60 * 60 * 1000, // 24 hours
  memoryThreshold: 0.8, // 80%
  connectionThreshold: 0.9, // 90%
};

/**
 * Resource statistics
 */
export interface ResourceStats {
  readonly memory: {
    readonly used: number;
    readonly total: number;
    readonly percentage: number;
  };
  readonly connections: {
    readonly active: number;
    readonly max: number;
    readonly percentage: number;
  };
  readonly queues: {
    readonly total: number;
    readonly maxSize: number;
    readonly largestQueue: {
      readonly name: string;
      readonly size: number;
    } | null;
  };
  readonly sessions: {
    readonly active: number;
    readonly oldest: {
      readonly sessionId: string;
      readonly age: number;
    } | null;
  };
}

/**
 * Resource monitor for tracking and limiting system resources
 */
export class ResourceMonitor {
  private readonly logger: Logger;
  private connectionCount = 0;
  private sessionStartTimes = new Map<string, number>();
  private queueSizes = new Map<string, number>();

  constructor(
    private readonly config: ResourceLimits = DEFAULT_RESOURCE_LIMITS,
    logger?: Logger
  ) {
    this.logger = logger || createComponentLogger("ResourceMonitor");
  }

  /**
   * Check if resource limits are exceeded
   */
  async checkResourceLimits(): Promise<void> {
    // Check memory usage
    const memoryUsage = process.memoryUsage();
    const memoryMB = memoryUsage.heapUsed / (1024 * 1024);
    const memoryPercent = Math.min(memoryMB / this.config.maxMemoryMB, 1);

    if (memoryPercent > this.config.memoryThreshold) {
      this.logger.warn("Memory threshold exceeded", {
        current: memoryPercent,
        threshold: this.config.memoryThreshold,
        usedMB: memoryMB,
      });
    }

    if (memoryMB > this.config.maxMemoryMB) {
      throw new ResourceError(
        "memory",
        this.config.maxMemoryMB,
        memoryMB
      );
    }

    // Check connection count
    const connectionPercent = this.connectionCount / this.config.maxConnections;
    if (connectionPercent > this.config.connectionThreshold) {
      this.logger.warn("Connection threshold exceeded", {
        current: this.connectionCount,
        max: this.config.maxConnections,
        percentage: connectionPercent,
      });
    }

    if (this.connectionCount > this.config.maxConnections) {
      throw new ResourceError(
        "connection",
        this.config.maxConnections,
        this.connectionCount
      );
    }

    // Check queue sizes
    let totalQueueSize = 0;
    let largestQueue: { name: string; size: number } | null = null;

    for (const [name, size] of this.queueSizes) {
      totalQueueSize += size;
      if (!largestQueue || size > largestQueue.size) {
        largestQueue = { name, size };
      }
    }

    if (largestQueue && largestQueue.size > this.config.maxQueueSize) {
      throw new ResourceError(
        "queue",
        this.config.maxQueueSize,
        largestQueue.size,
        { queueName: largestQueue.name }
      );
    }
  }

  /**
   * Register a new connection
   */
  registerConnection(): void {
    this.connectionCount++;
    this.logger.debug("Connection registered", {
      current: this.connectionCount,
      max: this.config.maxConnections,
    });
  }

  /**
   * Unregister a connection
   */
  unregisterConnection(): void {
    this.connectionCount = Math.max(0, this.connectionCount - 1);
    this.logger.debug("Connection unregistered", {
      current: this.connectionCount,
    });
  }

  /**
   * Register a new session
   */
  registerSession(sessionId: string): void {
    this.sessionStartTimes.set(sessionId, Date.now());
    this.cleanupStaleSessions();
  }

  /**
   * Unregister a session
   */
  unregisterSession(sessionId: string): void {
    this.sessionStartTimes.delete(sessionId);
  }

  /**
   * Update queue size
   */
  updateQueueSize(queueName: string, size: number): void {
    if (size === 0) {
      this.queueSizes.delete(queueName);
    } else {
      this.queueSizes.set(queueName, size);
    }
  }

  /**
   * Clean up stale sessions based on TTL
   */
  private cleanupStaleSessions(): void {
    const now = Date.now();
    const staleSessions: string[] = [];

    for (const [sessionId, startTime] of this.sessionStartTimes) {
      if (now - startTime > this.config.sessionTTL) {
        staleSessions.push(sessionId);
      }
    }

    for (const sessionId of staleSessions) {
      this.sessionStartTimes.delete(sessionId);
      this.logger.info("Cleaned up stale session", {
        sessionId,
        age: now - (this.sessionStartTimes.get(sessionId) || 0),
      });
    }
  }

  /**
   * Get current resource statistics
   */
  getResourceStats(): ResourceStats {
    const memoryUsage = process.memoryUsage();
    const memoryMB = memoryUsage.heapUsed / (1024 * 1024);
    const memoryPercent = Math.min(memoryMB / this.config.maxMemoryMB, 1);

    let largestQueue: { name: string; size: number } | null = null;
    let totalQueueSize = 0;

    for (const [name, size] of this.queueSizes) {
      totalQueueSize += size;
      if (!largestQueue || size > largestQueue.size) {
        largestQueue = { name, size };
      }
    }

    let oldestSession: { sessionId: string; age: number } | null = null;
    const now = Date.now();

    for (const [sessionId, startTime] of this.sessionStartTimes) {
      const age = now - startTime;
      if (!oldestSession || age > oldestSession.age) {
        oldestSession = { sessionId, age };
      }
    }

    return {
      memory: {
        used: memoryMB,
        total: this.config.maxMemoryMB,
        percentage: memoryPercent,
      },
      connections: {
        active: this.connectionCount,
        max: this.config.maxConnections,
        percentage: this.connectionCount / this.config.maxConnections,
      },
      queues: {
        total: this.queueSizes.size,
        maxSize: largestQueue?.size || 0,
        largestQueue,
      },
      sessions: {
        active: this.sessionStartTimes.size,
        oldest: oldestSession,
      },
    };
  }

  /**
   * Reset all resource tracking
   */
  reset(): void {
    this.connectionCount = 0;
    this.sessionStartTimes.clear();
    this.queueSizes.clear();
  }
}