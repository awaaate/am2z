// AM2Z v4.0 - Processor System
// Clean, type-safe processor architecture with immutable state updates

import { produce, type Draft } from "immer";
import { type Result, Success, Failure } from "./result";
import { type AppState, updateStateMetadata } from "./state";
import { type Logger } from "./logging";
import {
  AM2ZError,
  ProcessorExecutionError,
  wrapAsProcessorError,
} from "./errors";

/**
 * Context provided to each processor execution
 * Contains tools and metadata for processing
 */
export interface ProcessorContext<TState extends AppState = AppState> {
  readonly log: Logger;
  readonly meta: ProcessorMetadata;
  readonly call: ProcessorCaller<TState>;
  readonly emit: EventEmitter;
}

export interface ProcessorMetadata {
  readonly processorName: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly attempt: number;
  readonly startedAt: number;
}

export type ProcessorCaller<TState extends AppState> = (
  processorName: string,
  state: TState
) => Promise<Result<TState, AM2ZError>>;

export type EventEmitter = (eventType: string, data?: unknown) => void;

/**
 * Core processor function signature
 * Processes state and returns a result
 */
export type ProcessorFunction<TState extends AppState = AppState> = (
  state: TState,
  context: ProcessorContext<TState>
) => Promise<Result<TState, AM2ZError>>;

/**
 * Immer-based processor function for easier state mutations
 * Automatically wraps with produce() for immutability
 */
export type ImmerProcessorFunction<TState extends AppState = AppState> = (
  draft: Draft<TState>,
  context: ProcessorContext<TState>
) => void | Promise<void>;

/**
 * Processor configuration options
 */
export interface ProcessorConfig {
  readonly description?: string;
  readonly timeout?: number;
  readonly retryPolicy?: RetryPolicy;
  readonly queueConfig?: QueueConfig;
}

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly shouldRetry?: (error: AM2ZError) => boolean;
  readonly onRetry?: (error: AM2ZError, attempt: number) => void;
  readonly onExhausted?: (error: AM2ZError, totalAttempts: number) => void;
}

export interface QueueConfig {
  readonly priority?: number;
  readonly concurrency?: number;
  readonly rateLimitRpm?: number;
}

/**
 * Complete processor definition
 */
export interface ProcessorDefinition<TState extends AppState = AppState> {
  readonly name: string;
  readonly fn: ProcessorFunction<TState>;
  readonly config: ProcessorConfig;
}

/**
 * Result of processor execution with metrics
 */
export interface ProcessorResult<TState extends AppState = AppState> {
  readonly state: TState;
  readonly executionTime: number;
  readonly success: boolean;
  readonly error?: AM2ZError;
  readonly metadata: ProcessorMetadata;
}

// === Processor Builder ===

/**
 * Builder for creating processors with fluent API
 */
export class ProcessorBuilder<TState extends AppState = AppState> {
  private config: ProcessorConfig = {};

  constructor(private readonly name: string) {}

  /**
   * Add description for documentation
   */
  withDescription(description: string): this {
    this.config = { ...this.config, description };
    return this;
  }

  /**
   * Set execution timeout
   */
  withTimeout(timeoutMs: number): this {
    this.config = { ...this.config, timeout: timeoutMs };
    return this;
  }

  /**
   * Configure retry behavior
   */
  withRetryPolicy(policy: RetryPolicy): this {
    this.config = { ...this.config, retryPolicy: policy };
    return this;
  }

  /**
   * Configure queue behavior for distributed execution
   */
  withQueueConfig(queueConfig: QueueConfig): this {
    this.config = { ...this.config, queueConfig };
    return this;
  }

  /**
   * Build processor with direct function
   */
  process(fn: ProcessorFunction<TState>): ProcessorDefinition<TState> {
    return {
      name: this.name,
      fn,
      config: this.config,
    };
  }

  /**
   * Build processor with Immer-based function (recommended)
   */
  processWithImmer(
    fn: ImmerProcessorFunction<TState>
  ): ProcessorDefinition<TState> {
    const wrappedFn: ProcessorFunction<TState> = async (state, context) => {
      try {
        const result = produce(state, (draft) => {
          // Handle both sync and async functions
          const fnResult = fn(draft, context);
          if (fnResult instanceof Promise) {
            throw new Error(
              "Async functions in Immer producers not supported. Use .process() instead."
            );
          }
        });

        // Update metadata automatically
        const updatedState = updateStateMetadata(result) as TState;
        return Success(updatedState);
      } catch (error) {
        const am2zError =
          error instanceof AM2ZError
            ? error
            : wrapAsProcessorError(
                error instanceof Error ? error : new Error(String(error)),
                this.name,
                context.meta.executionId
              );

        return Failure(am2zError);
      }
    };

    return this.process(wrappedFn);
  }
}

// === Factory Function ===

/**
 * Create a processor builder
 */
export function createProcessor<TState extends AppState = AppState>(
  name: string
): ProcessorBuilder<TState> {
  return new ProcessorBuilder<TState>(name);
}

// === Composition Functions ===

/**
 * Chain processors sequentially
 * Each processor receives the output of the previous one
 */
export function chainProcessors<TState extends AppState = AppState>(
  name: string,
  ...processors: ProcessorDefinition<TState>[]
): ProcessorDefinition<TState> {
  if (processors.length === 0) {
    throw new Error("chainProcessors requires at least one processor");
  }

  return createProcessor<TState>(name)
    .withDescription(
      `Sequential chain: ${processors.map((p) => p.name).join(" → ")}`
    )
    .process(async (state, context) => {
      let currentState = state;

      for (const processor of processors) {
        context.log.debug(`Executing processor: ${processor.name}`);

        const result = await processor.fn(currentState, {
          ...context,
          meta: {
            ...context.meta,
            processorName: processor.name,
          },
        });

        if (!result.success) {
          // Create a custom error that preserves the partial state
          const chainError = new ProcessorExecutionError(
            name,
            context.meta.executionId,
            result.error,
            {
              failedProcessor: processor.name,
              partialState: currentState,
              completedSteps: processors.indexOf(processor),
            }
          );

          // We can't return partial state via the Result type, but we can throw
          // an error that contains the partial state. The runtime will catch this
          // and the test can check the error context for partial state.
          throw chainError;
        }

        currentState = result.data;

        context.emit("processor:completed", {
          processorName: processor.name,
          chainPosition: processors.indexOf(processor) + 1,
          totalProcessors: processors.length,
        });
      }

      return Success(currentState);
    });
}

/**
 * Run processors in parallel and merge results
 * All processors receive the same input state
 */
export function parallelProcessors<TState extends AppState = AppState>(
  name: string,
  ...processors: ProcessorDefinition<TState>[]
): ProcessorDefinition<TState> {
  if (processors.length === 0) {
    throw new Error("parallelProcessors requires at least one processor");
  }

  return createProcessor<TState>(name)
    .withDescription(
      `Parallel execution: ${processors.map((p) => p.name).join(" || ")}`
    )
    .process(async (state, context) => {
      context.log.debug(`Running ${processors.length} processors in parallel`);

      const results = await Promise.allSettled(
        processors.map((processor) =>
          processor.fn(state, {
            ...context,
            meta: {
              ...context.meta,
              processorName: processor.name,
            },
          })
        )
      );

      // Check for failures
      const failures = results
        .map((result, index) => ({ result, processor: processors[index] }))
        .filter(
          ({ result }) =>
            result.status === "rejected" ||
            (result.status === "fulfilled" && !result.value.success)
        );

      if (failures.length > 0) {
        const firstFailure = failures[0];
        if (!firstFailure) {
          return Failure(
            new ProcessorExecutionError(name, context.meta.executionId)
          );
        }

        if (firstFailure.result.status === "rejected") {
          return Failure(
            wrapAsProcessorError(
              firstFailure.result.reason,
              firstFailure.processor?.name || "unknown",
              context.meta.executionId
            )
          );
        } else {
          return firstFailure.result.value as Result<TState, AM2ZError>;
        }
      }

      // Merge successful results
      const successfulResults = results
        .filter(
          (
            result
          ): result is PromiseFulfilledResult<Result<TState, AM2ZError>> =>
            result.status === "fulfilled" && result.value.success
        )
        .map((result) => {
          const successResult = result.value as { success: true; data: TState };
          return successResult.data;
        });

      // Simple merge strategy - last one wins for conflicting keys
      const mergedState = successfulResults.reduce(
        (merged, result) => ({ ...merged, ...result }),
        state
      );

      return Success(mergedState);
    });
}

/**
 * Conditional processor routing
 */
export function routeProcessor<TState extends AppState = AppState>(
  name: string,
  condition: (state: TState) => string,
  routes: Record<string, ProcessorDefinition<TState>>,
  fallback?: ProcessorDefinition<TState>
): ProcessorDefinition<TState> {
  return createProcessor<TState>(name)
    .withDescription(`Router: ${Object.keys(routes).join(" | ")}`)
    .process(async (state, context) => {
      const route = condition(state);
      const targetProcessor = routes[route] || fallback;

      if (!targetProcessor) {
        return Failure(
          new ProcessorExecutionError(
            name,
            context.meta.executionId,
            new Error(`No route found for: ${route}`)
          )
        );
      }

      context.log.info(`Routing to processor: ${targetProcessor.name}`, {
        route,
      });

      return targetProcessor.fn(state, {
        ...context,
        meta: {
          ...context.meta,
          processorName: targetProcessor.name,
        },
      });
    });
}

/**
 * Add retry logic to any processor
 */
export function withRetry<TState extends AppState = AppState>(
  processor: ProcessorDefinition<TState>,
  retryPolicy: RetryPolicy
): ProcessorDefinition<TState> {
  return createProcessor<TState>(`retry(${processor.name})`)
    .withDescription(`Retry wrapper for ${processor.name}`)
    .withRetryPolicy(retryPolicy)
    .process(async (state, context) => {
      let lastError: AM2ZError | undefined;

      for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt++) {
        try {
          const result = await processor.fn(state, {
            ...context,
            meta: {
              ...context.meta,
              attempt,
            },
          });

          if (result.success) {
            return result;
          }

          lastError = result.error;

          // Check if we should retry this error
          if (
            retryPolicy.shouldRetry &&
            !retryPolicy.shouldRetry(result.error)
          ) {
            break;
          }

          if (attempt === retryPolicy.maxAttempts) {
            break;
          }

          // Call retry callback
          retryPolicy.onRetry?.(result.error, attempt);

          // Wait before retry
          await new Promise((resolve) =>
            setTimeout(resolve, retryPolicy.backoffMs * attempt)
          );
        } catch (error) {
          lastError = wrapAsProcessorError(
            error instanceof Error ? error : new Error(String(error)),
            processor.name,
            context.meta.executionId
          );
          break;
        }
      }

      // All retries exhausted
      retryPolicy.onExhausted?.(lastError!, retryPolicy.maxAttempts);
      return Failure(lastError!);
    });
}
