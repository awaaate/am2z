// AM2Z v4.0 - Processor System
// Clean, type-safe processor architecture with immutable state updates

import { type Draft } from "immer";
import {
  AM2ZError,
  ConfigurationError,
  ProcessorExecutionError,
  wrapAsProcessorError,
} from "./errors";
import { type Logger } from "./logging";
import type { ProcessorCaller } from "./processor-executor";
import { Failure, type Result, Success } from "./result";
import { type AppState } from "./state";

/**
 * Context provided to each processor execution.
 * Contains logging, metadata, nested call utilities, and cancellation signal.
 *
 * @template TState - The state type handled by the processor.
 *
 * @example
 * processor.process(async (state, context) => {
 *   context.log.info("Processing...");
 *   if (context.signal?.aborted) return Failure(new Error("Cancelled"));
 *   // ...
 * });
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

/**
 * Metadata about the current processor execution.
 */
export interface ProcessorMetadata {
  readonly processorName: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly attempt: number;
  readonly startedAt: number;
}

/**
 * Emits custom events from processors.
 * @param eventType - The event name.
 * @param data - Optional event payload.
 */
export type EventEmitter = (eventType: string, data?: unknown) => void;

/**
 * Main processor function signature.
 * Receives state and context, returns a result asynchronously.
 *
 * Cooperative cancellation: check `context.signal?.aborted` for long-running operations.
 *
 * @example
 * const sum = createProcessor<MyState>("sum")
 *   .process(async (state, ctx) => Success({ ...state, total: state.a + state.b }));
 */
export type ProcessorFunction<TState extends AppState = AppState> = (
  state: TState,
  context: ProcessorContext<TState>
) => Promise<Result<TState, AM2ZError>>;

/**
 * Immer-based processor function for safe, simple state mutations.
 * Only supports synchronous functions.
 *
 * Note: AbortSignal cancellation is not available in Immer processors.
 *
 * @example
 * const mutator = createProcessor<MyState>("mutator")
 *   .immer((draft, ctx) => { draft.value++; });
 */
export type ImmerProcessorFunction<TState extends AppState = AppState> = (
  draft: Draft<TState>,
  context: ProcessorContext<TState>
) => void;

/**
 * Configuration options for a processor.
 */
export interface ProcessorConfig {
  /** Optional description for documentation. */
  readonly description?: string;
  /** Optional execution timeout in milliseconds. */
  readonly timeout?: number;
  /** Optional retry policy for failures. */
  readonly retryPolicy?: RetryPolicy;
  /** Optional queue configuration for distributed execution. */
  readonly queueConfig?: QueueConfig;
}

/**
 * Retry policy for processor failures.
 */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly shouldRetry?: (error: AM2ZError) => boolean;
  readonly onRetry?: (error: AM2ZError, attempt: number) => void;
  readonly onExhausted?: (error: AM2ZError, totalAttempts: number) => void;
}

/**
 * Queue configuration for distributed execution.
 */
export interface QueueConfig {
  readonly priority?: number;
  readonly concurrency?: number;
  readonly rateLimitRpm?: number;
}

type ProcessorTypes = "chain" | "processor" | "router" | "parallel";

/**
 * Complete processor definition, as returned by .process().
 */
export interface ProcessorDefinition<TState extends AppState = AppState> {
  readonly name: string;
  readonly fn: ProcessorFunction<TState>;
  readonly config: ProcessorConfig;
  readonly deps?: ProcessorDefinition<TState>[];
  readonly type?: ProcessorTypes;
}

/**
 * Result of processor execution, including metrics and error info.
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
 * Fluent builder for creating processors.
 *
 * @template TState - The state type handled by the processor.
 *
 * @example
 * const proc = createProcessor<MyState>("my-proc")
 *   .withDescription("Does something")
 *   .withTimeout(5000)
 *   .process(async (state, ctx) => Success(state));
 */
export class ProcessorBuilder<TState extends AppState = AppState> {
  private config: ProcessorConfig = {};

  constructor(
    private readonly name: string,
    private readonly type?: ProcessorTypes,
    private readonly deps?: ProcessorDefinition<TState>[]
  ) {}

  /**
   * Add a description for documentation purposes.
   * @param description - Human-readable description.
   * @returns This builder instance.
   */
  withDescription(description: string): this {
    this.config = { ...this.config, description };
    return this;
  }

  /**
   * Set execution timeout in milliseconds.
   * @param timeoutMs - Timeout in ms.
   * @returns This builder instance.
   */
  withTimeout(timeoutMs: number): this {
    this.config = { ...this.config, timeout: timeoutMs };
    return this;
  }

  /**
   * Configure retry behavior for failures.
   * @param policy - Retry policy.
   * @returns This builder instance.
   */
  withRetryPolicy(policy: RetryPolicy): this {
    this.config = { ...this.config, retryPolicy: policy };
    return this;
  }

  /**
   * Configure queue behavior for distributed execution.
   * @param queueConfig - Queue configuration.
   * @returns This builder instance.
   */
  withQueueConfig(queueConfig: QueueConfig): this {
    this.config = { ...this.config, queueConfig };
    return this;
  }

  /**
   * Finalize the processor definition with the main processing function.
   * @param fn - The processor function.
   * @returns ProcessorDefinition
   *
   * @example
   * const proc = createProcessor<MyState>("my-proc")
   *   .process(async (state, ctx) => Success(state));
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
}

/**
 * Create a new processor builder.
 *
 * @param name - Unique processor name.
 * @returns ProcessorBuilder
 *
 * @example
 * const proc = createProcessor<MyState>("my-proc")
 *   .withDescription("Does something")
 *   .process(async (state, ctx) => Success(state));
 */
export function createProcessor<TState extends AppState = AppState>(
  name: string
): ProcessorBuilder<TState> {
  return new ProcessorBuilder<TState>(name, "processor");
}

/**
 * Input for chainProcessors.
 */
interface ChainProcessorInput<TState extends AppState = AppState> {
  name: string;
  processors?: ProcessorDefinition<TState>[];
  timeout?: number;
}

/**
 * Compose multiple processors into a sequential chain.
 * Each processor receives the output state of the previous one.
 *
 * @param input - ChainProcessorInput
 * @returns ProcessorDefinition
 *
 * @example
 * const chain = chainProcessors({
 *   name: "my-chain",
 *   processors: [procA, procB, procC]
 * });
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

/**
 * Input for parallelProcessors.
 */
interface ParallelProcessorsInput<TState extends AppState> {
  name: string;
  processors?: ProcessorDefinition<TState>[];
  timeout?: number;
  mergeFunction?: (results: TState[], initialState: TState) => TState;
}

/**
 * Run multiple processors in parallel (concurrently).
 * All processors receive the same input state.
 *
 * @param input - ParallelProcessorsInput
 * @returns ProcessorDefinition
 *
 * @example
 * const parallel = parallelProcessors({
 *   name: "my-parallel",
 *   processors: [procA, procB]
 * });
 */
export function parallelProcessors<TState extends AppState = AppState>({
  name,
  processors = [],
  timeout,
  mergeFunction = defaultMergeFunction,
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
    const mergedState = mergeFunction(successfulResults, state);
    return Success(mergedState);
  });
}

/**
 * Create a router processor that dispatches to different processors based on a condition.
 *
 * @param name - Router name.
 * @param condition - Function that returns a route key based on state.
 * @param routes - Map of route keys to processors.
 * @param fallback - Optional fallback processor if no route matches.
 * @returns ProcessorDefinition
 *
 * @example
 * const router = routeProcessor<MyState>(
 *   "my-router",
 *   state => state.type,
 *   {
 *     foo: fooProcessor,
 *     bar: barProcessor
 *   },
 *   fallbackProcessor
 * );
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

/**
 * Merges results from parallel executions into a single state.
 * It uses the initial state as the base.
 *
 * @param results - Array of successful states from processors.
 * @param initialState - The initial state before parallel execution.
 * @returns The merged state.
 */
function defaultMergeFunction<TState extends AppState = AppState>(
  results: TState[],
  initialState: TState
): TState {
  return results.reduce((merged, current) => {
    const newState = { ...merged };
    for (const [key, value] of Object.entries(current)) {
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
  }, initialState);
}

/**
 * Input for batchProcessor.
 */
interface BatchProcessorInput<
  TState extends AppState,
  TPayload extends AppState[] = AppState[],
> {
  name: string;
  processorName: string;
  payloads: TPayload;
  mergeFunction?: (results: TState[], initialState: TState) => TState;
  sessionId?: string; // Optional explicit session ID for isolation
  isolateSession?: boolean; // Whether to create session-specific queues
}

/**
 * Creates a processor that executes another processor multiple times in parallel.
 * All executions receive the same initial state.
 *
 * @param options - Configuration for the batch processor.
 * @returns A processor definition.
 *
 * @example
 * const batch = batchProcessor({
 *   name: 'run-analysis-5-times',
 *   processorName: 'analyze-data',
 *   payloads: [payload1, payload2, payload3, payload4, payload5],
 * });
 */
export function batchProcessor<TState extends AppState = AppState>({
  name,
  processorName,
  mergeFunction = defaultMergeFunction,
  payloads,
  sessionId,
  isolateSession = false,
}: BatchProcessorInput<TState>): ProcessorDefinition<TState> {
  const times = payloads.length;
  if (times <= 0) {
    throw new ConfigurationError(
      "batchProcessor",
      "times must be a positive number"
    );
  }

  const builder = new ProcessorBuilder<TState>(name, "processor");
  builder.withDescription(`Batch execution: ${processorName} x${times}`);

  return builder.process(async (state, context) => {
    context.log.debug(
      `Starting batch execution: ${times} calls to ${processorName}`,
      {
        batchName: name,
        targetProcessor: processorName,
      }
    );

    const calls = Array.from({ length: times }, (_, index) => {
      const payload = payloads[index];
      if (!payload) {
        throw new ConfigurationError(
          "batchProcessor",
          "payloads must be an array of payloads"
        );
      }
      
      // Use explicit session ID if provided, otherwise create batch-specific session IDs
      const batchSessionId = sessionId 
        ? (isolateSession ? `${sessionId}-batch-${index}` : sessionId)
        : context.meta.sessionId + `-${index}`;

      return context.call(processorName, payload as TState, {
        sessionId: batchSessionId,
      });
    });

    const results = await Promise.allSettled(calls);

    const failures = results
      .map((result, index) => ({ result, index }))
      .filter(
        ({ result }) =>
          result.status === "rejected" ||
          (result.status === "fulfilled" && !result.value.success)
      );

    if (failures.length > 0) {
      const firstFailure = failures[0]!;
      context.log.error(
        `Batch execution failed on call ${firstFailure.index}`,
        {
          batchName: name,
          failedProcessor: processorName,
          totalFailures: failures.length,
        }
      );

      if (firstFailure.result.status === "rejected") {
        return Failure(
          wrapAsProcessorError(
            firstFailure.result.reason,
            processorName,
            context.meta.executionId,
            { batchIndex: firstFailure.index }
          )
        );
      }
      // Fulfilled but with success: false
      return Failure(
        new ProcessorExecutionError(
          name,
          context.meta.executionId,
          firstFailure.result.value.error,
          {
            failedProcessor: processorName,
            batchIndex: firstFailure.index,
          }
        )
      );
    }

    const successfulStates = results
      .filter(
        (result): result is PromiseFulfilledResult<ProcessorResult<TState>> =>
          result.status === "fulfilled" && result.value.success
      )
      .map((result) => result.value.state);

    context.log.info(`Batch execution completed successfully`, {
      batchName: name,
      totalCalls: times,
      successfulCalls: successfulStates.length,
    });

    const mergedState = mergeFunction(successfulStates, state);

    return Success(mergedState);
  });
}
