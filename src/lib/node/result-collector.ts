import { EventEmitter } from "events";
import { type ProcessorResult } from "../core/processor";
import { type AppState } from "../core/state";
import { TimeoutError } from "../core/errors";
import { createLogger, type Logger } from "../core/logging";

export interface PendingExecution<TState extends AppState> {
  resolve: (result: ProcessorResult<TState>) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

export class ResultCollector<
  TState extends AppState = AppState,
> extends EventEmitter {
  private pendingExecutions = new Map<string, PendingExecution<TState>>();

  constructor(
    private readonly logger: Logger = createLogger({
      component: "ResultCollector",
    })
  ) {
    super();
    this.setupEventListeners();
  }

  /**
   * Register a pending execution and return a promise
   */
  waitForResult(
    executionId: string,
    timeoutMs?: number
  ): Promise<ProcessorResult<TState>> {
    return new Promise((resolve, reject) => {
      // Setup timeout if specified
      const timeout = timeoutMs
        ? setTimeout(() => {
            this.pendingExecutions.delete(executionId);
            reject(new TimeoutError(`execution:${executionId}`, timeoutMs));
          }, timeoutMs)
        : undefined;

      this.pendingExecutions.set(executionId, {
        resolve,
        reject,
        timeout,
      });

      this.logger.debug(`Registered pending execution: ${executionId}`, {
        timeout: timeoutMs,
      });
    });
  }

  /**
   * Setup event listeners for job completion
   */
  private setupEventListeners(): void {
    this.on(
      "job:completed",
      (data: { executionId: string; result: ProcessorResult<TState> }) => {
        this.logger.debug(`Received job:completed event for ${data.executionId}`);
        this.resolveExecution(data.executionId, data.result);
      }
    );

    this.on("job:failed", (data: { executionId: string; error: Error }) => {
      this.logger.debug(`Received job:failed event for ${data.executionId}`);
      this.rejectExecution(data.executionId, data.error);
    });
  }

  /**
   * Resolve a pending execution
   */
  private resolveExecution(
    executionId: string,
    result: ProcessorResult<TState>
  ): void {
    const pending = this.pendingExecutions.get(executionId);
    if (pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      this.pendingExecutions.delete(executionId);
      pending.resolve(result);

      this.logger.debug(`Resolved execution: ${executionId}`);
    }
  }

  /**
   * Reject a pending execution
   */
  private rejectExecution(executionId: string, error: Error): void {
    const pending = this.pendingExecutions.get(executionId);
    if (pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      this.pendingExecutions.delete(executionId);
      pending.reject(error);

      this.logger.debug(`Rejected execution: ${executionId}`, {
        error: error.message,
      });
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Clear all pending timeouts
    for (const [, pending] of this.pendingExecutions) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("ResultCollector cleanup"));
    }

    this.pendingExecutions.clear();
    this.removeAllListeners();
  }
}
