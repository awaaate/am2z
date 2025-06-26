// src/lib/node/job-data.ts
import { type AppState } from "../core/state";
import { type JobsOptions } from "bullmq";

/**
 * Simplified job data structure
 */
export interface JobData<TState extends AppState> {
  readonly processorName: string;
  readonly state: TState;
  readonly sessionId: string;
  readonly executionId: string;
}

/**
 * Enhanced job data structure with context propagation
 */
export interface EnhancedJobData<TState extends AppState>
  extends JobData<TState> {
  readonly callContext?: {
    readonly callDepth: number;
    readonly parentExecutionId?: string;
    readonly chainName?: string;
    readonly chainPosition?: number;
    readonly isRetry: boolean;
    readonly retryAttempt: number;
  };
}

/**
 * Job options builder for consistent configuration with proper type safety
 */
export class JobOptionsBuilder {
  private options: JobsOptions & {
    timeout?: number;
    metadata?: Record<string, any>; // ✅ NEW: For BullMQ UI
  } = {};

  withPriority(priority: number): this {
    this.options.priority = priority;
    return this;
  }

  withAttempts(attempts: number): this {
    this.options.attempts = attempts;
    return this;
  }

  withBackoff(delay: number): this {
    this.options.backoff = {
      type: "exponential",
      delay,
    };
    return this;
  }

  withDelay(delayMs: number): this {
    this.options.delay = delayMs;
    return this;
  }

  withJobId(jobId: string): this {
    this.options.jobId = jobId;
    return this;
  }

  withTimeout(timeoutMs: number): this {
    this.options.timeout = timeoutMs;
    return this;
  }

  withMetadata(metadata: Record<string, any>): this {
    this.options.metadata = metadata;
    return this;
  }

  build(): JobsOptions & { timeout?: number; metadata?: Record<string, any> } {
    return { ...this.options };
  }
}
