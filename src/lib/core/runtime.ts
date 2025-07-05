// src/lib/core/runtime.ts - Updated
import { type AppState } from "./state";
import { type Logger } from "./logging";
import { createComponentLogger } from "./component-logger";
import { type ResourceLimits } from "./resource-monitor";
import { ConfigurationError, ProcessorNotFoundError } from "./errors";
import { type ProcessorDefinition, type ProcessorResult } from "./processor";
import {
  ProcessorExecutor,
  ContextFactory,
  MetadataFactory,
} from "./processor-executor";

export interface RuntimeConfig {
  readonly maxCallDepth: number;
  readonly defaultTimeout: number;
  readonly staleExecutionTimeout: number;
  readonly autoCleanupInterval: number;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  maxCallDepth: 10,
  defaultTimeout: 60000, // 60 segundos por defecto
  staleExecutionTimeout: 5 * 60 * 1000, // 5 minutes
  autoCleanupInterval: 2 * 60 * 1000, // 2 minutes
};

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
  private readonly executor: ProcessorExecutor<TState>;
  private readonly contextFactory = new ContextFactory<TState>();
  private readonly metadataFactory = new MetadataFactory();

  constructor(
    private readonly config: RuntimeConfig = DEFAULT_RUNTIME_CONFIG,
    private readonly logger: Logger = createComponentLogger("LocalRuntime")
  ) {
    this.executor = new ProcessorExecutor<TState>(
      undefined,
      this.config.defaultTimeout
    );
  }

  register(processor: ProcessorDefinition<TState>): this {
    this.processors.set(processor.name, processor);
    this.logger.info(`Registered processor: ${processor.name}`, {
      description: processor.config.description,
    });

    if (processor.deps) {
      for (const dep of processor.deps) {
        this.register(dep as unknown as ProcessorDefinition<TState>);
      }
    }

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
          return await this.execute(
            targetProcessorName,
            targetState,
            sessionId
          );
        },
        (eventType, data) => this.emit(eventType, data),
        this.logger,
        0, // Start with depth 0 for LocalRuntime
        this.config.maxCallDepth
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
      config: this.config,
    });
  }

  async stop(): Promise<void> {
    // Clean up event handlers to prevent memory leaks
    this.eventHandlers.clear();

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

// runtime.ts
export function validateRuntimeConfig(
  config: Partial<RuntimeConfig>
): RuntimeConfig {
  const validated = { ...DEFAULT_RUNTIME_CONFIG, ...config };

  if (validated.maxCallDepth <= 0) {
    throw new ConfigurationError("maxCallDepth", "Must be greater than 0");
  }

  if (validated.defaultTimeout <= 0) {
    throw new ConfigurationError("defaultTimeout", "Must be greater than 0");
  }

  if (validated.staleExecutionTimeout <= validated.autoCleanupInterval) {
    throw new ConfigurationError(
      "staleExecutionTimeout",
      "Must be greater than autoCleanupInterval"
    );
  }

  return validated;
}
