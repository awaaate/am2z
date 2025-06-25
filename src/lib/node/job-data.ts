// src/lib/node/job-data.ts
import { type AppState } from "../core/state";

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
 * Job options builder for consistent configuration
 */
export class JobOptionsBuilder {
  private options: any = {};

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

  build(): any {
    return { ...this.options };
  }
}
