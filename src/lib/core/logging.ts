// AM2Z v4.0 - Logging System
// Structured, contextual logging with proper levels

/**
 * Log level for logger entries.
 * - debug: Detailed debug information
 * - info: General information
 * - warn: Warnings
 * - error: Errors
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Structured log entry.
 * @example
 * const entry: LogEntry = {
 *   level: 'info',
 *   message: 'Started',
 *   context: { foo: 1 },
 *   timestamp: new Date().toISOString(),
 *   source: 'my-module'
 * };
 */
export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly context: Record<string, unknown>;
  readonly timestamp: string;
  readonly source?: string;
}

/**
 * Logger interface for structured logging.
 * @example
 * const logger: Logger = createLogger();
 * logger.info('Hello');
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(
    message: string,
    error?: unknown,
    context?: Record<string, unknown>
  ): void;

  withContext(additionalContext: Record<string, unknown>): Logger;
  withSource(source: string): Logger;
}

/**
 * Formatter function for log entries.
 * @example
 * const formatter: LogFormatter = entry => console.log(entry.message);
 */
export type LogFormatter = (entry: LogEntry) => void;

/**
 * Create a logger instance with optional base context.
 * @param baseContext - Default context for all log entries.
 * @param minLevel - Minimum log level to output.
 * @param formatter - Optional custom formatter.
 * @param source - Optional source string.
 * @returns Logger instance.
 * @example
 * const logger = createLogger({ app: 'my-app' }, 'debug');
 * logger.info('Started');
 */
export function createLogger(
  baseContext: Record<string, unknown> = {},
  minLevel: LogLevel = "info",
  formatter?: LogFormatter,
  source?: string
): Logger {
  const levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  const shouldLog = (level: LogLevel): boolean =>
    levels[level] >= levels[minLevel];

  const defaultFormatter: LogFormatter = (entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const contextStr =
      Object.keys(entry.context).length > 0
        ? ` ${JSON.stringify(entry.context, null, 2)}`
        : "";

    const sourceStr = entry.source ? `[${entry.source}] ` : "";
    const levelStr = entry.level.toUpperCase().padEnd(5);

    console.log(
      `${time} ${sourceStr}${levelStr} ${entry.message}${contextStr}`
    );
  };

  const log = (
    level: LogLevel,
    message: string,
    context: Record<string, unknown> = {}
  ) => {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      message,
      context: { ...baseContext, ...context },
      timestamp: new Date().toISOString(),
      source,
    };

    const logFormatter = formatter || defaultFormatter;
    logFormatter(entry);
  };

  return {
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),

    error: (message, error, context = {}) => {
      const errorContext =
        error instanceof Error
          ? {
              error: {
                name: error.name,
                message: error.message,
                stack: error.stack,
              },
            }
          : { error };

      log("error", message, { ...errorContext, ...context });
    },

    withContext: (additionalContext) =>
      createLogger(
        { ...baseContext, ...additionalContext },
        minLevel,
        formatter,
        source
      ),

    withSource: (newSource) =>
      createLogger(baseContext, minLevel, formatter, newSource),
  };
}

/**
 * Console formatter with colors (Node.js only).
 * @returns LogFormatter
 * @example
 * const logger = createLogger({}, 'info', createColoredFormatter());
 */
export function createColoredFormatter(): LogFormatter {
  // Simple colored output - will enhance with chalk if needed
  const colors = {
    debug: "\x1b[36m", // cyan
    info: "\x1b[34m", // blue
    warn: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
    reset: "\x1b[0m",
  };

  return (entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const color = colors[entry.level];
    const contextStr =
      Object.keys(entry.context).length > 0
        ? ` ${JSON.stringify(entry.context, null, 2)}`
        : "";

    const sourceStr = entry.source ? `[${entry.source}] ` : "";
    const levelStr = entry.level.toUpperCase().padEnd(5);

    console.log(
      `${time} ${sourceStr}${color}${levelStr}${colors.reset} ${entry.message}${contextStr}`
    );
  };
}

/**
 * JSON formatter for structured logging.
 * @returns LogFormatter
 * @example
 * const logger = createLogger({}, 'info', createJsonFormatter());
 */
export function createJsonFormatter(): LogFormatter {
  return (entry) => {
    console.log(JSON.stringify(entry));
  };
}

/**
 * Silent logger for testing (no output).
 * @returns Logger
 * @example
 * const logger = createSilentLogger();
 * logger.info('This will not be shown');
 */
export function createSilentLogger(): Logger {
  return createLogger({}, "error", () => {}); // No-op formatter
}
