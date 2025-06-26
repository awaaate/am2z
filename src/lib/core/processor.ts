// AM2Z v4.0 - Processor System
// Clean, type-safe processor architecture with immutable state updates

import { type Draft } from "immer";
import {
  AM2ZError,
  ProcessorExecutionError,
  wrapAsProcessorError,
} from "./errors";
import { type Logger } from "./logging";
import type { ProcessorCaller } from "./processor-executor";
import { Failure, type Result, Success } from "./result";
import { type AppState } from "./state";

/**
 * Context provided to each processor execution
 * Contains tools and metadata for processing
 */
export interface ProcessorContext<TState extends AppState = AppState> {
  readonly log: Logger;
  readonly meta: ProcessorMetadata;
  readonly call: ProcessorCaller<TState>;
  readonly emit: EventEmitter;
  readonly callDepth: number;
  readonly signal?: AbortSignal;
  readonly debug?: {
    readonly callStack: string[];
    readonly parentExecutionId?: string;
  };
}

export interface ProcessorMetadata {
  readonly processorName: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly attempt: number;
  readonly startedAt: number;
}

export type EventEmitter = (eventType: string, data?: unknown) => void;

/**
 * Core processor function signature
 * Processes state and returns a result
 *
 * COOPERATIVE CANCELLATION:
 * Processors should check `context.signal?.aborted` periodically for long-running operations.
 *
 * @example
 * ```typescript
 * const longRunningProcessor = createProcessor<MyState>("longRunning")
 *   .process(async (state, context) => {
 *     for (let i = 0; i < 1000; i++) {
 *       // Check for cancellation before expensive work
 *       if (context.signal?.aborted) {
 *         return Failure(new Error("Operation was cancelled"));
 *       }
 *
 *       await doSomeWork();
 *
 *       // Check periodically during loops
 *       if (i % 10 === 0 && context.signal?.aborted) {
 *         return Failure(new Error("Operation was cancelled"));
 *       }
 *     }
 *
 *     return Success(state);
 *   });
 * ```
 *
 * FOR HTTP REQUESTS:
 * ```typescript
 * const httpProcessor = createProcessor<MyState>("httpCall")
 *   .process(async (state, context) => {
 *     try {
 *       const response = await fetch('/api/data', {
 *         signal: context.signal // Pass signal to fetch for automatic cancellation
 *       });
 *       const data = await response.json();
 *       return Success({ ...state, data });
 *     } catch (error) {
 *       if (error.name === 'AbortError') {
 *         return Failure(new Error("HTTP request was cancelled"));
 *       }
 *       throw error;
 *     }
 *   });
 * ```
 */
export type ProcessorFunction<TState extends AppState = AppState> = (
  state: TState,
  context: ProcessorContext<TState>
) => Promise<Result<TState, AM2ZError>>;

/**
 * Immer-based processor function for easier state mutations
 * Only supports synchronous functions for safety with Immer producers
 *
 * NOTE: AbortSignal cancellation is not available in Immer processors
 * since they must be synchronous. Use .process() for cancellable operations.
 */
export type ImmerProcessorFunction<TState extends AppState = AppState> = (
  draft: Draft<TState>,
  context: ProcessorContext<TState>
) => void;

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

type ProcessorTypes = "chain" | "processor" | "router" | "parallel";

/**
 * Complete processor definition
 */
export interface ProcessorDefinition<TState extends AppState = AppState> {
  readonly name: string;
  readonly fn: ProcessorFunction<TState>;
  readonly config: ProcessorConfig;
  readonly deps?: ProcessorDefinition<TState>[];
  readonly type?: ProcessorTypes;
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

// === Timeout Overhead ===
export const SERVER_OVERHEAD_MS = 2000;

// === Processor Builder ===

/**
 * Builder for creating processors with fluent API
 */
export class ProcessorBuilder<TState extends AppState = AppState> {
  private config: ProcessorConfig = {};

  constructor(
    private readonly name: string,
    private readonly type?: ProcessorTypes,
    private readonly deps?: ProcessorDefinition<TState>[]
  ) {}

  /**
   * Add description for documentation
   */
  withDescription(description: string): this {
    this.config = { ...this.config, description };
    return this;
  }

  /**
   * Set execution timeout (raw business timeout, overhead added by executor)
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
      deps: this.deps,
      type: this.type,
    };
  }

  /**
   * Build processor with Immer-based function (synchronous only)
   */
  /*   processWithImmer(
    fn: ImmerProcessorFunction<TState>
  ): ProcessorDefinition<TState> {
    const wrappedFn: ProcessorFunction<TState> = async (state, context) => {
      try {
        const result = produce(state, (draft) => {
          // Call the synchronous function
          fn(draft, context);
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
  } */
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

interface ChainProcessorInput<TState extends AppState = AppState> {
  name: string;
  processors?: ProcessorDefinition<TState>[];
  timeout?: number;
}

/**
 * Chain processors sequentially
 * Each processor receives the output of the previous one
 */
export function chainProcessors<TState extends AppState = AppState>({
  name,
  processors = [],
  timeout,
}: ChainProcessorInput<TState>): ProcessorDefinition<TState> {
  if (processors.length === 0) {
    throw new Error("chainProcessors requires at least one processor");
  }

  // Suma de los timeouts de los hijos (o default 60000 si no tienen) - SIN overhead
  const childTimeouts = processors.map((p) => p.config.timeout ?? 60000);
  const calculatedTimeout = childTimeouts.reduce((a, b) => a + b, 0);
  const rawTimeout = timeout ?? calculatedTimeout;

  const builder = new ProcessorBuilder<TState>(name, "chain", processors);
  builder.withDescription(
    `Sequential chain: ${processors.map((p) => p.name).join(" → ")}`
  );

  // Solo configurar timeout si tenemos uno calculado o explícito
  if (rawTimeout > 0) {
    builder.withTimeout(rawTimeout);
  }

  return builder.process(async (state, context) => {
    let currentState = state;

    for (let i = 0; i < processors.length; i++) {
      const processor = processors[i];
      if (!processor) {
        return Failure(
          new ProcessorExecutionError(
            name,
            context.meta.executionId,
            new Error(`Processor at index ${i} is undefined`)
          )
        );
      }

      context.log.info("[CHAIN] Llamando a context.call", {
        chainName: name,
        chainPosition: i + 1,
        processor: processor.name,
        parentExecutionId: context.meta.executionId,
        callDepth: context.callDepth,
      });

      // ✅ IMPROVED: Use context.call instead of direct processor.fn
      const callResult = await context.call(processor.name, currentState);

      context.log.info("[CHAIN] context.call result", {
        chainName: name,
        chainPosition: i + 1,
        processor: processor.name,
        resultExecutionId: callResult.metadata.executionId,
        callResultSuccess: callResult.success,
      });

      if (!callResult.success) {
        const chainError = new ProcessorExecutionError(
          name,
          context.meta.executionId,
          callResult.error,
          {
            failedProcessor: processor.name,
            partialState: currentState,
            completedSteps: i,
          }
        );

        context.log.error(
          `Chain failed at step ${i + 1}: ${processor.name}`,
          chainError
        );
        return Failure(chainError);
      }

      currentState = callResult.state;

      context.emit("processor:completed", {
        processorName: processor.name,
        chainName: name,
        chainPosition: i + 1,
        totalProcessors: processors.length,
        stepCompleted: true,
      });

      context.log.debug(`Chain step completed: ${processor.name}`, {
        stepPosition: i + 1,
        remainingSteps: processors.length - i - 1,
      });
    }

    context.log.info(`Chain completed successfully: ${name}`, {
      totalSteps: processors.length,
      finalStateSize: JSON.stringify(currentState).length,
    });

    return Success(currentState);
  });
}

interface ParallelProcessorsInput<TState extends AppState> {
  name: string;
  processors?: ProcessorDefinition<TState>[];
  timeout?: number;
}

/**
 * Run processors in parallel and merge results
 * All processors receive the same input state
 */
export function parallelProcessors<TState extends AppState = AppState>({
  name,
  processors = [],
  timeout,
}: ParallelProcessorsInput<TState>): ProcessorDefinition<TState> {
  if (processors.length === 0) {
    throw new Error("parallelProcessors requires at least one processor");
  }

  // Máximo de los timeouts de los hijos (o default 60000 si no tienen) - SIN overhead
  const childTimeouts = processors.map((p) => p.config.timeout ?? 60000);
  const calculatedTimeout = Math.max(...childTimeouts);
  const rawTimeout = timeout ?? calculatedTimeout;

  const builder = new ProcessorBuilder<TState>(name, "parallel", processors);
  builder.withDescription(
    `Parallel execution: ${processors.map((p) => p.name).join(" || ")}`
  );

  // Solo configurar timeout si tenemos uno calculado o explícito
  if (rawTimeout > 0) {
    builder.withTimeout(rawTimeout);
  }

  return builder.process(async (state, context) => {
    context.log.debug(
      `Starting parallel execution: ${processors.length} processors`,
      {
        parallelName: name,
        processorNames: processors.map((p) => p.name),
      }
    );

    // ✅ IMPROVED: Use context.call for parallel execution
    const results = await Promise.allSettled(
      processors.map(async (processor, index) => {
        context.log.debug(
          `Starting parallel processor ${index + 1}: ${processor.name}`
        );

        // Each processor runs as separate BullMQ job
        const result = await context.call(processor.name, state);

        context.emit("processor:completed", {
          processorName: processor.name,
          parallelName: name,
          parallelPosition: index + 1,
          totalProcessors: processors.length,
          stepCompleted: true,
        });

        return result;
      })
    );

    // Check for failures
    const failures = results
      .map((result, index) => ({ result, processor: processors[index], index }))
      .filter(
        ({ result }) =>
          result.status === "rejected" ||
          (result.status === "fulfilled" && !result.value.success)
      );

    if (failures.length > 0) {
      const firstFailure = failures[0];
      context.log.error(`Parallel execution failed`, {
        failedProcessor: firstFailure?.processor?.name,
        failureIndex: firstFailure?.index,
        totalFailures: failures.length,
      });

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
        return Failure(firstFailure.result.value.error!);
      }
    }

    // Merge successful results
    const successfulResults = results
      .filter(
        (result): result is PromiseFulfilledResult<ProcessorResult<TState>> =>
          result.status === "fulfilled" && result.value.success
      )
      .map((result) => {
        return result.value.state;
      });

    context.log.info(`Parallel execution completed successfully`, {
      totalProcessors: processors.length,
      successfulResults: successfulResults.length,
    });

    // Smart merge strategy - same as before
    const mergedState = successfulResults.reduce((merged, result) => {
      const newState = { ...merged };
      for (const [key, value] of Object.entries(result)) {
        if (
          key === "messages" &&
          Array.isArray(value) &&
          Array.isArray(merged[key as keyof TState])
        ) {
          (newState as any)[key] = [
            ...(merged[key as keyof TState] as any),
            ...value,
          ];
        } else {
          (newState as any)[key] = value;
        }
      }
      return newState;
    }, state);

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
  const processors = [...Object.values(routes), fallback].filter(
    (p): p is ProcessorDefinition<TState> => p !== undefined
  );

  const builder = new ProcessorBuilder<TState>(name, "router", processors);

  builder.withDescription(`Router: ${Object.keys(routes).join(" | ")}`);

  return builder.process(async (state, context) => {
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

    const callResult = await context.call(targetProcessor.name, state);
    return callResult.success
      ? Success(callResult.state)
      : Failure(callResult.error!);
  });
}
