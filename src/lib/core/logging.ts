// AM2Z v4.0 - Logging System
// Structured, contextual logging with proper levels

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly context: Record<string, unknown>;
  readonly timestamp: string;
  readonly source?: string;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
  
  withContext(additionalContext: Record<string, unknown>): Logger;
  withSource(source: string): Logger;
}

export type LogFormatter = (entry: LogEntry) => void;

/**
 * Create a logger instance with optional base context
 */
export function createLogger(
  baseContext: Record<string, unknown> = {},
  minLevel: LogLevel = 'info',
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
    const contextStr = Object.keys(entry.context).length > 0
      ? ` ${JSON.stringify(entry.context, null, 2)}`
      : '';
    
    const sourceStr = entry.source ? `[${entry.source}] ` : '';
    const levelStr = entry.level.toUpperCase().padEnd(5);
    
    console.log(`${time} ${sourceStr}${levelStr} ${entry.message}${contextStr}`);
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
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    
    error: (message, error, context = {}) => {
      const errorContext = error instanceof Error 
        ? { error: { name: error.name, message: error.message, stack: error.stack } }
        : { error };
      
      log('error', message, { ...errorContext, ...context });
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
 * Console formatter with colors (Node.js only)
 */
export function createColoredFormatter(): LogFormatter {
  // Simple colored output - will enhance with chalk if needed
  const colors = {
    debug: '\x1b[36m', // cyan
    info: '\x1b[34m',  // blue
    warn: '\x1b[33m',  // yellow
    error: '\x1b[31m', // red
    reset: '\x1b[0m',
  };

  return (entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const color = colors[entry.level];
    const contextStr = Object.keys(entry.context).length > 0
      ? ` ${JSON.stringify(entry.context, null, 2)}`
      : '';
    
    const sourceStr = entry.source ? `[${entry.source}] ` : '';
    const levelStr = entry.level.toUpperCase().padEnd(5);
    
    console.log(
      `${time} ${sourceStr}${color}${levelStr}${colors.reset} ${entry.message}${contextStr}`
    );
  };
}

/**
 * JSON formatter for structured logging
 */
export function createJsonFormatter(): LogFormatter {
  return (entry) => {
    console.log(JSON.stringify(entry));
  };
}

/**
 * Silent logger for testing
 */
export function createSilentLogger(): Logger {
  return createLogger({}, 'error', () => {}); // No-op formatter
}