import { createLogger, type Logger, type LoggerOptions } from "./logging";

/**
 * Factory function to create component-specific loggers
 * Eliminates duplication of createLogger({ component: "ComponentName" }) pattern
 */
export function createComponentLogger(
  component: string,
  additionalOptions?: Partial<LoggerOptions>
): Logger {
  return createLogger({
    baseContext: { component },
    ...additionalOptions,
  });
}

/**
 * Pre-configured component loggers for common components
 */
export const ComponentLoggers = {
  Runtime: () => createComponentLogger("Runtime"),
  LocalRuntime: () => createComponentLogger("LocalRuntime"),
  QueueRuntime: () => createComponentLogger("QueueRuntime"),
  QueueManager: () => createComponentLogger("QueueManager"),
  WorkerManager: () => createComponentLogger("WorkerManager"),
  ConnectionManager: () => createComponentLogger("ConnectionManager"),
  ResultCollector: () => createComponentLogger("ResultCollector"),
  RedisStateManager: () => createComponentLogger("RedisStateManager"),
  ProcessorExecutor: () => createComponentLogger("ProcessorExecutor"),
  ContextFactory: () => createComponentLogger("ContextFactory"),
  MetadataFactory: () => createComponentLogger("MetadataFactory"),
} as const;

/**
 * Create a logger with contextual information
 */
export function createContextualLogger(
  component: string,
  context: Record<string, unknown>
): Logger {
  const baseLogger = createComponentLogger(component);
  return baseLogger.withContext(context);
}
