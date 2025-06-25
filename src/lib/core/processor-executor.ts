// src/lib/core/processor-executor.ts
import { type Result } from "./result";
import { type AppState, type StateManager } from "./state";
import { TimeoutError, AM2ZError, ProcessorExecutionError } from "./errors";
import {
  type ProcessorDefinition,
  type ProcessorContext,
  type ProcessorResult,
  type ProcessorMetadata,
} from "./processor";

/**
 * Shared processor execution logic between Local and Distributed runtimes
 */
export class ProcessorExecutor<TState extends AppState = AppState> {
  constructor(private readonly stateManager?: StateManager<TState>) {}

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
      context.log.info(`Executing processor: ${processor.name}`, {
        executionId: context.meta.executionId,
        timeout: processor.config.timeout,
      });

      // If a state manager is provided, use it to update the state.
      if (this.stateManager) {
        const newSate = await this.stateManager.update(
          context.meta.sessionId,
          (currentState) => {
            const result = processor.config.timeout
              ? this.executeWithTimeout(processor, currentState, context)
              : processor.fn(currentState, context);
            // This is not ideal, as we are in a sync function. But it will work for now.
            return result.then((r) => {
              if (r.success) {
                return r.data;
              }
              throw r.error;
            });
          }
        );

        const executionTime = Date.now() - startTime;

        return {
          state: newSate,
          executionTime,
          success: true,
          metadata: context.meta,
        };
      }

      // Execute with timeout if configured
      const result = await (processor.config.timeout
        ? this.executeWithTimeout(processor, state, context)
        : processor.fn(state, context));

      const executionTime = Date.now() - startTime;

      if (result.success) {
        context.log.info(`Processor completed: ${processor.name}`, {
          executionId: context.meta.executionId,
          executionTime,
        });

        return {
          state: result.data,
          executionTime,
          success: true,
          metadata: context.meta,
        };
      } else {
        context.log.error(`Processor failed: ${processor.name}`, result.error, {
          executionId: context.meta.executionId,
          executionTime,
        });

        return {
          state,
          executionTime,
          success: false,
          error: result.error,
          metadata: context.meta,
        };
      }
    } catch (error) {
      const executionTime = Date.now() - startTime;

      const am2zError =
        error instanceof AM2ZError
          ? error
          : new ProcessorExecutionError(
              processor.name,
              context.meta.executionId,
              error instanceof Error ? error : new Error(String(error))
            );

      context.log.error(`Processor crashed: ${processor.name}`, am2zError, {
        executionId: context.meta.executionId,
        executionTime,
      });

      return {
        state,
        executionTime,
        success: false,
        error: am2zError,
        metadata: context.meta,
      };
    }
  }

  /**
   * Execute processor with timeout
   */
  private async executeWithTimeout(
    processor: ProcessorDefinition<TState>,
    state: TState,
    context: ProcessorContext<TState>
  ): Promise<Result<TState, AM2ZError>> {
    const timeoutMs = processor.config.timeout!;

    return Promise.race([
      processor.fn(state, context),
      new Promise<Result<TState, AM2ZError>>((_, reject) =>
        setTimeout(
          () => reject(new TimeoutError(processor.name, timeoutMs)),
          timeoutMs
        )
      ),
    ]);
  }
}

/**
 * Shared context creation logic
 */
export class ContextFactory<TState extends AppState = AppState> {
  createContext(
    processor: ProcessorDefinition<TState>,
    metadata: ProcessorMetadata,
    caller: (
      processorName: string,
      state: TState
    ) => Promise<Result<TState, AM2ZError>>,
    emitter: (eventType: string, data?: unknown) => void,
    logger: any
  ): ProcessorContext<TState> {
    return {
      log: logger.withSource(processor.name),
      meta: metadata,
      call: caller,
      emit: emitter,
    };
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
    startedAt?: number
  ): ProcessorMetadata {
    return {
      processorName,
      executionId: executionId || this.generateExecutionId(processorName),
      sessionId,
      attempt: 1,
      startedAt: startedAt || Date.now(),
    };
  }

  generateExecutionId(processorName: string): string {
    return `${processorName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
