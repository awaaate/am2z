import { EventEmitter } from "events";
import { type ProcessorResult } from "../core/processor";
import { type AppState } from "../core/state";
import { TimeoutError, ManagedTimeout } from "../core/errors";
import { createLogger, type Logger } from "../core/logging";

export interface PendingExecution<TState extends AppState> {
  resolve: (result: ProcessorResult<TState>) => void;
  reject: (error: Error) => void;
  timeout: ManagedTimeout;
  createdAt: number;
  sessionId?: string;
}

export class ResultCollector<
  TState extends AppState = AppState,
> extends EventEmitter {
  private pendingExecutions = new Map<string, PendingExecution<TState>>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private readonly logger: Logger = createLogger({
      component: "ResultCollector",
    }),
    private readonly autoCleanupIntervalMs: number = 2 * 60 * 1000, // 2 minutes
    private readonly maxPendingAgeMs: number = 10 * 60 * 1000 // 10 minutes
  ) {
    super();
    this.setupEventListeners();
    this.startAutoCleanup();
  }

  /**
   * Register a pending execution and return a promise
   */
  waitForResult(
    executionId: string,
    timeoutMs?: number,
    sessionId?: string
  ): Promise<ProcessorResult<TState>> {
    this.logger.debug(`[RESULT] Waiting for executionId: ${executionId}`);

    return new Promise((resolve, reject) => {
      const safeTimeout = new ManagedTimeout();
      const createdAt = Date.now();

      const pendingExecution: PendingExecution<TState> = {
        resolve,
        reject,
        timeout: safeTimeout,
        createdAt,
        sessionId,
      };
      this.pendingExecutions.set(executionId, pendingExecution);

      if (timeoutMs) {
        safeTimeout.start(() => {
          this.handleTimeout(executionId, timeoutMs, createdAt);
        }, timeoutMs);
      }
    });
  }

  private handleTimeout(
    executionId: string,
    timeoutMs: number,
    createdAt: number
  ): void {
    const pending = this.pendingExecutions.get(executionId);
    if (pending) {
      this.logger.warn(`[RESULT] Timeout for executionId: ${executionId}`);
      this.pendingExecutions.delete(executionId);

      const timeoutError = new TimeoutError(
        `execution:${executionId}`,
        timeoutMs
      );

      const result: ProcessorResult<TState> = {
        state: {} as TState,
        executionTime: Date.now() - createdAt,
        success: false,
        error: timeoutError,
        metadata: {
          processorName: executionId.split("-")[0] || "unknown",
          executionId,
          sessionId: "unknown",
          attempt: 1,
          startedAt: createdAt,
        },
      };
      pending.resolve(result);
    }
  }

  private setupEventListeners(): void {
    this.on(
      "job:completed",
      (data: { executionId: string; result: ProcessorResult<TState> }) => {
        this.logger.debug(
          `Received job:completed event for ${data.executionId}`
        );
        this.resolveExecution(data.executionId, data.result);
      }
    );

    this.on(
      "job:failed",
      (data: {
        executionId: string;
        error: Error;
        result?: ProcessorResult<TState>;
      }) => {
        this.logger.debug(`Received job:failed event for ${data.executionId}`);

        if (data.result) {
          // If we have the full result, resolve with it
          this.resolveExecution(data.executionId, data.result);
        } else {
          // Legacy or other failure, reject as before
          this.rejectExecution(data.executionId, data.error);
        }
      }
    );
  }

  /**
   * Resolve a pending execution
   */
  private resolveExecution(
    executionId: string,
    result: ProcessorResult<TState>
  ): void {
    if (!executionId) {
      this.logger.error(
        "[RESULT] CRITICAL: resolveExecution called with undefined executionId",
        {
          stack: new Error().stack,
        }
      );
      return;
    }

    const pending = this.pendingExecutions.get(executionId);
    if (pending) {
      pending.timeout.clear();
      this.pendingExecutions.delete(executionId);
      pending.resolve(result);
      this.logger.debug(`[RESULT] Resolved execution: ${executionId}`);
    } else {
      this.logger.warn(
        `[RESULT] No pending execution found to resolve: ${executionId}. It may have timed out.`
      );
    }
  }

  /**
   * Reject a pending execution
   */
  private rejectExecution(executionId: string, error: Error): void {
    if (!executionId) {
      this.logger.error(
        "[RESULT] CRITICAL: rejectExecution called with undefined executionId",
        {
          stack: new Error().stack,
        }
      );
      return;
    }

    const pending = this.pendingExecutions.get(executionId);
    if (pending) {
      pending.timeout.clear();
      this.pendingExecutions.delete(executionId);
      pending.reject(error);

      this.logger.debug(`[RESULT] Rejected execution: ${executionId}`, {
        error: error.message,
      });
    } else {
      this.logger.warn(
        `[RESULT] No pending execution found to reject: ${executionId}. It may have timed out.`
      );
    }
  }

  /**
   * Get statistics about pending executions
   */
  getStats(): {
    pendingCount: number;
    activeTimeouts: number;
    oldestPending?: { executionId: string; ageMs: number };
  } {
    const now = Date.now();
    let oldestPending: { executionId: string; ageMs: number } | undefined;
    let activeTimeouts = 0;

    for (const [executionId, pending] of this.pendingExecutions) {
      const ageMs = now - pending.createdAt;

      if (pending.timeout.isActive()) {
        activeTimeouts++;
      }

      if (!oldestPending || ageMs > oldestPending.ageMs) {
        oldestPending = { executionId, ageMs };
      }
    }

    return {
      pendingCount: this.pendingExecutions.size,
      activeTimeouts,
      oldestPending,
    };
  }

  /**
   * Start automatic cleanup of stale executions
   */
  private startAutoCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      try {
        this.cleanupStale(this.maxPendingAgeMs);
      } catch (error) {
        this.logger.warn("Auto cleanup failed", { error });
      }
    }, this.autoCleanupIntervalMs);

    this.logger.debug("Auto cleanup started", {
      intervalMs: this.autoCleanupIntervalMs,
      maxAgeMs: this.maxPendingAgeMs,
    });
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Stop auto cleanup
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Clear all pending timeouts and reject promises
    for (const pending of this.pendingExecutions.values()) {
      pending.timeout.clear();
      pending.reject(
        new Error("ResultCollector cleanup - system shutting down")
      );
    }

    this.pendingExecutions.clear();
    this.removeAllListeners();

    this.logger.info("ResultCollector cleanup completed");
  }

  /**
   * Clean up executions for a specific session
   */
  cleanupSession(sessionId: string): void {
    let cleanedCount = 0;
    const toDelete: string[] = [];

    for (const [executionId, pending] of this.pendingExecutions) {
      // Check if execution belongs to this session (simple prefix check)
      if (executionId.includes(sessionId) || pending.sessionId === sessionId) {
        pending.timeout.clear();
        pending.reject(
          new Error(`Session ${sessionId} cleanup - session terminated`)
        );
        toDelete.push(executionId);
        cleanedCount++;
      }
    }

    toDelete.forEach(id => this.pendingExecutions.delete(id));

    if (cleanedCount > 0) {
      this.logger.info(`Cleaned up ${cleanedCount} executions for session: ${sessionId}`);
    }
  }

  /**
   * Force cleanup of stale executions (older than specified age)
   */
  cleanupStale(maxAgeMs: number): void {
    const now = Date.now();
    const staleExecutions: string[] = [];

    for (const [executionId, pending] of this.pendingExecutions) {
      const ageMs = now - pending.createdAt;
      if (ageMs > maxAgeMs) {
        staleExecutions.push(executionId);
        pending.timeout.clear();
        pending.reject(
          new Error(
            `Execution ${executionId} cleaned up as stale (age: ${ageMs}ms)`
          )
        );
      }
    }

    for (const executionId of staleExecutions) {
      this.pendingExecutions.delete(executionId);
    }

    if (staleExecutions.length > 0) {
      this.logger.info(
        `Cleaned up ${staleExecutions.length} stale executions`,
        {
          staleExecutions,
          maxAgeMs,
        }
      );
    }
  }
}
