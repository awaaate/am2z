// src/lib/core/processor-executor.ts
import {
  CallDepthExceededError,
  extractPartialState,
  TimeoutError,
  wrapAsProcessorError,
} from "./errors";
import { type Logger } from "./logging";
import {
  type ProcessorContext,
  type ProcessorDefinition,
  type ProcessorMetadata,
  type ProcessorResult,
  SERVER_OVERHEAD_MS,
} from "./processor";
import { type AppState, type StateManager } from "./state";

/**
 * Shared processor execution logic between Local and Distributed runtimes
 */
export class ProcessorExecutor<TState extends AppState = AppState> {
  constructor(
    private readonly stateManager?: StateManager<TState>,
    private readonly defaultTimeout: number = 60000
  ) {}

  /**
   * Execute a processor with shared logic for timeouts, errors, and metrics
   */
  async executeProcessor(
    processor: ProcessorDefinition<TState>,
    state: TState,
    context: ProcessorContext<TState>
  ): Promise<ProcessorResult<TState>> {
    const startTime = Date.now();

    try {
      // Create timeout management - único lugar donde se maneja el timeout
      const rawTimeout = processor.config.timeout ?? this.defaultTimeout;
      const effectiveTimeout = rawTimeout + SERVER_OVERHEAD_MS;
      const controller = new AbortController();

      // Use the enhanced context with proper signal propagation
      const enhancedContext: ProcessorContext<TState> = {
        ...context,
        signal: context.signal || controller.signal,
      };

      // Set up timeout with proper cleanup
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, effectiveTimeout);

      const timeoutPromise = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          //check if the timout is 60s (default) and alter that maybe it's thowing bc of that
          if (effectiveTimeout === 60000) {
            reject(
              new TimeoutError(
                `Processor ${processor.name} timed out after 60ms which is the default timeout. Maybe you should set a higher timeout.`,
                effectiveTimeout
              )
            );
          }

          reject(
            new TimeoutError(
              `Processor ${processor.name} timed out after ${effectiveTimeout}ms`,
              effectiveTimeout
            )
          );
        });
      });

      const executionPromise = processor.fn(state, enhancedContext);

      let result;
      try {
        result = await Promise.race([executionPromise, timeoutPromise]);
      } finally {
        // **Muy importante** - siempre limpiar el timeout para evitar fugas
        clearTimeout(timeoutId);
      }
      const executionTime = Date.now() - startTime;

      if (result.success) {
        // Update state manager with successful result
        await this.stateManager?.set(context.meta.sessionId, result.data);
        return {
          state: result.data,
          executionTime,
          success: true,
          metadata: enhancedContext.meta,
        };
      } else {
        // Handle failure with potential partial state using standardized extraction
        const partialState = extractPartialState<TState>(result.error);
        const effectiveState = partialState || state;

        await this.stateManager?.set(context.meta.sessionId, effectiveState);
        return {
          state: effectiveState,
          executionTime,
          success: false,
          error: result.error,
          metadata: enhancedContext.meta,
        };
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const wrappedError = wrapAsProcessorError(
        error as Error,
        processor.name,
        context.meta.executionId
      );

      // Check if this is a chain processor error with partial state using standardized extraction
      const partialState = extractPartialState<TState>(wrappedError);
      const stateToReturn = partialState || state;

      await this.stateManager?.set(context.meta.sessionId, stateToReturn);
      return {
        state: stateToReturn,
        executionTime,
        success: false,
        error: wrappedError,
        metadata: context.meta,
      };
    }
  }
}

/**
 * Shared context creation logic
 */
export class ContextFactory<TState extends AppState = AppState> {
  createContext(
    processor: ProcessorDefinition<TState>,
    metadata: ProcessorMetadata,
    caller: ProcessorCaller<TState>,
    emitter: (eventType: string, data?: unknown) => void,
    logger: Logger,
    callDepth: number = 0,
    maxCallDepth: number = 10,
    signal?: AbortSignal
  ): ProcessorContext<TState> {
    // Enhanced caller with full context propagation
    const limitedCaller = async (
      processorName: string,
      state: TState
    ): Promise<ProcessorResult<TState>> => {
      // Check call depth limit
      if (callDepth >= maxCallDepth) {
        const error = new CallDepthExceededError(
          `Maximum call depth exceeded: ${callDepth} >= ${maxCallDepth}`,
          maxCallDepth,
          callDepth
        );
        return {
          state,
          executionTime: 0,
          success: false,
          error,
          metadata: new MetadataFactory().createMetadata(
            processorName,
            metadata.sessionId,
            metadata.executionId
          ),
        };
      }

      // ✅ IMPROVED: Full context propagation
      const nestedContext: ProcessorCallContext = {
        callDepth: callDepth + 1,
        signal,
        sessionId: metadata.sessionId,
        parentExecutionId: metadata.executionId,
        chainName: processor.name,
        chainPosition: callDepth,
        inheritedTimeout: processor.config.timeout,
        isRetry: false,
        retryAttempt: 1,
      };

      return caller(processorName, state, nestedContext);
    };

    return {
      log: logger.withSource ? logger.withSource(processor.name) : logger,
      meta: metadata,
      call: limitedCaller,
      emit: emitter,
      callDepth,
      signal,
      debug: {
        callStack: this.buildCallStack(metadata, callDepth),
        parentExecutionId: metadata.executionId,
      },
      processor: processor.name,
      sessionId: metadata.sessionId,
      executionId: metadata.executionId,
      updateProgress: undefined, // Will be set by WorkerManager when needed
      runtime: undefined, // Will be set by QueueRuntime when needed
    };
  }

  private buildCallStack(
    metadata: ProcessorMetadata,
    callDepth: number
  ): string[] {
    // Build a simple call stack representation
    const stack = [`${metadata.processorName}[${metadata.executionId}]`];
    for (let i = 0; i < callDepth; i++) {
      stack.unshift(`  depth-${i}`);
    }
    return stack;
  }
}

/**
 * Shared metadata creation logic
 */
export class MetadataFactory {
  createMetadata(
    processorName: string,
    sessionId: string,
    executionId?: string,
    startedAt?: number,
    attempt: number = 1
  ): ProcessorMetadata {
    return {
      processorName,
      sessionId,
      executionId: executionId ?? this.generateExecutionId(processorName),
      attempt,
      startedAt: startedAt ?? Date.now(),
    };
  }

  generateExecutionId(
    processorName: string,
    parentExecutionId?: string
  ): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const prefix = parentExecutionId
      ? `${parentExecutionId.split("-")[0]}-`
      : "";
    return `${prefix}${processorName}-${timestamp}-${random}`;
  }
}

export interface ProcessorCallContext {
  readonly callDepth: number;
  readonly signal?: AbortSignal;
  readonly sessionId: string;
  readonly parentExecutionId: string;
  // ✅ NEW: Chain-specific context
  readonly chainName?: string;
  readonly chainPosition?: number;
  readonly inheritedTimeout?: number;
  // ✅ NEW: Retry context
  readonly isRetry?: boolean;
  readonly retryAttempt?: number;
}

export type ProcessorCaller<TState extends AppState> = (
  processorName: string,
  state: TState,
  callContext?: Partial<ProcessorCallContext>
) => Promise<ProcessorResult<TState>>;
