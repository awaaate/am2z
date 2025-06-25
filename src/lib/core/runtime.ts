// src/lib/core/runtime.ts - Updated
import { type AppState } from "./state";
import { createLogger, type Logger } from "./logging";
import { ProcessorNotFoundError } from "./errors";
import { type ProcessorDefinition, type ProcessorResult } from "./processor";
import {
  ProcessorExecutor,
  ContextFactory,
  MetadataFactory,
} from "./processor-executor";

export interface ProcessorRuntime<TState extends AppState = AppState> {
  register(processor: ProcessorDefinition<TState>): this;
  unregister(processorName: string): this;
  execute(
    processorName: string,
    state: TState,
    sessionId?: string
  ): Promise<ProcessorResult<TState>>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStats(): Promise<RuntimeStats>;
}

export interface RuntimeStats {
  registeredProcessors: string[];
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  uptime: number;
}

/**
 * Refactored Local Runtime using shared execution logic
 */
export class LocalRuntime<TState extends AppState = AppState>
  implements ProcessorRuntime<TState>
{
  private readonly processors = new Map<string, ProcessorDefinition<TState>>();
  private readonly eventHandlers = new Map<
    string,
    Array<(data: unknown) => void>
  >();
  private readonly stats = {
    runningJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    startedAt: Date.now(),
  };

  // Shared components
  private readonly executor = new ProcessorExecutor<TState>();
  private readonly contextFactory = new ContextFactory<TState>();
  private readonly metadataFactory = new MetadataFactory();

  constructor(
    private readonly logger: Logger = createLogger({
      component: "LocalRuntime",
    })
  ) {}

  register(processor: ProcessorDefinition<TState>): this {
    this.processors.set(processor.name, processor);
    this.logger.info(`Registered processor: ${processor.name}`, {
      description: processor.config.description,
    });
    return this;
  }

  unregister(processorName: string): this {
    const removed = this.processors.delete(processorName);
    if (removed) {
      this.logger.info(`Unregistered processor: ${processorName}`);
    }
    return this;
  }

  async execute(
    processorName: string,
    state: TState,
    sessionId = "local-session"
  ): Promise<ProcessorResult<TState>> {
    const processor = this.processors.get(processorName);
    if (!processor) {
      const availableProcessors = Array.from(this.processors.keys());
      const error = new ProcessorNotFoundError(
        processorName,
        availableProcessors
      );

      return {
        state,
        executionTime: 0,
        success: false,
        error,
        metadata: this.metadataFactory.createMetadata(processorName, sessionId),
      };
    }

    const executionId = this.metadataFactory.generateExecutionId(processorName);
    const metadata = this.metadataFactory.createMetadata(
      processorName,
      sessionId,
      executionId,
      Date.now()
    );

    this.stats.runningJobs++;

    try {
      const context = this.contextFactory.createContext(
        processor,
        metadata,
        async (targetProcessorName, targetState) => {
          const result = await this.execute(
            targetProcessorName,
            targetState,
            sessionId
          );
          return result.success
            ? Success(result.state)
            : Failure(result.error!);
        },
        (eventType, data) => this.emit(eventType, data),
        this.logger
      );

      // Use shared executor
      const result = await this.executor.executeProcessor(
        processor,
        state,
        context
      );

      if (result.success) {
        this.stats.completedJobs++;
        this.emit("processor:completed", {
          processorName,
          executionId,
          executionTime: result.executionTime,
        });
      } else {
        this.stats.failedJobs++;
        this.emit("processor:failed", {
          processorName,
          executionId,
          error: result.error,
          executionTime: result.executionTime,
        });
      }

      return result;
    } finally {
      this.stats.runningJobs--;
    }
  }

  async start(): Promise<void> {
    this.logger.info("Local runtime started", {
      registeredProcessors: Array.from(this.processors.keys()),
    });
  }

  async stop(): Promise<void> {
    this.logger.info("Local runtime stopped", {
      stats: await this.getStats(),
    });
  }

  async getStats(): Promise<RuntimeStats> {
    return {
      registeredProcessors: Array.from(this.processors.keys()),
      runningJobs: this.stats.runningJobs,
      completedJobs: this.stats.completedJobs,
      failedJobs: this.stats.failedJobs,
      uptime: Date.now() - this.stats.startedAt,
    };
  }

  on(eventType: string, handler: (data: unknown) => void): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  off(eventType: string, handler: (data: unknown) => void): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit(eventType: string, data: unknown): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          this.logger.warn("Event handler error", { error, eventType });
        }
      });
    }
  }
}
