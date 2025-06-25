// AM2Z v4.0 - Error System
// Class-based errors with proper stack traces and categorization

/**
 * Base error class for all AM2Z errors
 * Provides consistent structure and better debugging
 */
export abstract class AM2ZError extends Error {
  abstract readonly code: string;
  abstract readonly category: ErrorCategory;
  abstract readonly severity: ErrorSeverity;
  abstract readonly retryable: boolean;

  constructor(
    public override readonly message: string,
    public readonly context?: Record<string, unknown>,
    public override readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error for logging/debugging
   */
  toJSON(): ErrorDetails {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      category: this.category,
      severity: this.severity,
      retryable: this.retryable,
      context: this.context,
      stack: this.stack,
      timestamp: new Date().toISOString(),
    };
  }
}

export type ErrorCategory =
  | "validation" // Input validation failures
  | "execution" // Runtime execution errors
  | "timeout" // Operation timeouts
  | "resource" // Resource exhaustion (memory, connections)
  | "network" // Network/communication failures
  | "configuration" // Setup/config errors
  | "auth" // Authentication/authorization
  | "business"; // Domain-specific business logic errors

export type ErrorSeverity =
  | "low" // Minor issues, system continues
  | "medium" // Notable issues, some functionality affected
  | "high" // Major issues, significant functionality affected
  | "critical"; // System-breaking issues

export interface ErrorDetails {
  readonly name: string;
  readonly code: string;
  readonly message: string;
  readonly category: ErrorCategory;
  readonly severity: ErrorSeverity;
  readonly retryable: boolean;
  readonly context?: Record<string, unknown>;
  readonly stack?: string;
  readonly timestamp: string;
}

// === Specific Error Classes ===

/**
 * Validation errors for input data
 */
export class ValidationError extends AM2ZError {
  readonly category = "validation" as const;
  readonly severity = "low" as const;
  readonly retryable = false;

  constructor(
    public readonly field: string,
    public readonly value: unknown,
    public readonly reason: string,
    context?: Record<string, unknown>
  ) {
    super(`Validation failed for field '${field}': ${reason}`, {
      field,
      value,
      reason,
      ...context,
    });
  }

  readonly code = "VALIDATION_FAILED";
}

/**
 * Processor not found errors
 */
export class ProcessorNotFoundError extends AM2ZError {
  readonly code = "PROCESSOR_NOT_FOUND";
  readonly category = "execution" as const;
  readonly severity = "high" as const;
  readonly retryable = false;

  constructor(
    public readonly processorName: string,
    public readonly availableProcessors: string[]
  ) {
    super(
      `Processor '${processorName}' not found. Available: ${availableProcessors.join(", ")}`,
      { processorName, availableProcessors }
    );
  }
}

/**
 * Processor execution failures
 */
export class ProcessorExecutionError extends AM2ZError {
  readonly code = "PROCESSOR_EXECUTION_FAILED";
  readonly category = "execution" as const;
  readonly severity = "high" as const;
  readonly retryable = true;

  constructor(
    public readonly processorName: string,
    public readonly executionId: string,
    cause?: Error,
    context?: Record<string, unknown>
  ) {
    // Include the underlying error message in the main message for better visibility
    const causeMessage = cause ? `: ${cause.message}` : "";
    super(
      `Processor '${processorName}' execution failed${causeMessage}`,
      {
        processorName,
        executionId,
        causeType: cause?.constructor.name,
        causeMessage: cause?.message,
        ...context,
      },
      cause
    );
  }
}

/**
 * Timeout errors
 */
export class TimeoutError extends AM2ZError {
  readonly code = "OPERATION_TIMEOUT";
  readonly category = "timeout" as const;
  readonly severity = "medium" as const;
  readonly retryable = true;

  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number,
    context?: Record<string, unknown>
  ) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`, {
      operation,
      timeoutMs,
      ...context,
    });
  }
}

/**
 * Resource exhaustion errors
 */
export class ResourceError extends AM2ZError {
  readonly code = "RESOURCE_EXHAUSTED";
  readonly category = "resource" as const;
  readonly severity = "high" as const;
  readonly retryable = true;

  constructor(
    public readonly resource: string,
    public readonly limit: number,
    public readonly current: number,
    context?: Record<string, unknown>
  ) {
    super(`Resource '${resource}' exhausted: ${current}/${limit}`, {
      resource,
      limit,
      current,
      ...context,
    });
  }
}

/**
 * Network/communication errors
 */
export class NetworkError extends AM2ZError {
  readonly code = "NETWORK_ERROR";
  readonly category = "network" as const;
  readonly severity = "medium" as const;
  readonly retryable = true;

  constructor(
    public readonly endpoint: string,
    public readonly statusCode?: number,
    cause?: Error,
    context?: Record<string, unknown>
  ) {
    super(
      `Network error for endpoint '${endpoint}'${statusCode ? ` (${statusCode})` : ""}`,
      { endpoint, statusCode, ...context },
      cause
    );
  }
}

/**
 * Configuration errors
 */
export class ConfigurationError extends AM2ZError {
  readonly code = "INVALID_CONFIGURATION";
  readonly category = "configuration" as const;
  readonly severity = "critical" as const;
  readonly retryable = false;

  constructor(
    public readonly configKey: string,
    public readonly reason: string,
    context?: Record<string, unknown>
  ) {
    super(`Configuration error for '${configKey}': ${reason}`, {
      configKey,
      reason,
      ...context,
    });
  }
}

/**
 * Business logic errors
 */
export class BusinessError extends AM2ZError {
  readonly category = "business" as const;
  readonly retryable = false;

  constructor(
    public readonly code: string,
    message: string,
    public readonly severity: ErrorSeverity = "medium",
    context?: Record<string, unknown>
  ) {
    super(message, context);
  }
}

// === Error Utilities ===

/**
 * Type guard to check if error is retryable
 */
export function isRetryableError(error: Error): boolean {
  return error instanceof AM2ZError && error.retryable;
}

/**
 * Type guard to check if error is critical
 */
export function isCriticalError(error: Error): boolean {
  return error instanceof AM2ZError && error.severity === "critical";
}

/**
 * Extract error details for logging
 */
export function extractErrorDetails(error: Error): ErrorDetails {
  if (error instanceof AM2ZError) {
    return error.toJSON();
  }

  // Handle unknown errors
  return {
    name: error.name || "UnknownError",
    code: "UNKNOWN_ERROR",
    message: error.message || "An unknown error occurred",
    category: "execution",
    severity: "medium",
    retryable: false,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a processor execution error from any error
 */
export function wrapAsProcessorError(
  error: Error,
  processorName: string,
  executionId: string
): ProcessorExecutionError {
  if (error instanceof AM2ZError) {
    return new ProcessorExecutionError(processorName, executionId, error);
  }

  return new ProcessorExecutionError(processorName, executionId, error, {
    originalErrorName: error.name,
  });
}

/**
 * Extract root cause error from a chain of wrapped errors
 */
export function getRootCause(error: Error): Error {
  let current = error;
  while (current instanceof AM2ZError && current.cause) {
    current = current.cause;
  }
  return current;
}

/**
 * Get full error chain as string
 */
export function getErrorChain(error: Error): string {
  const chain: string[] = [];
  let current: Error | undefined = error;

  while (current) {
    chain.push(`${current.constructor.name}: ${current.message}`);
    current = current instanceof AM2ZError ? current.cause : undefined;
  }

  return chain.join(" → ");
}

/**
 * Enhanced error details extraction with root cause analysis
 */
export function extractEnhancedErrorDetails(error: Error): ErrorDetails & {
  rootCause: ErrorDetails;
  errorChain: string;
} {
  const baseDetails = extractErrorDetails(error);
  const rootCause = getRootCause(error);
  const rootCauseDetails = extractErrorDetails(rootCause);

  return {
    ...baseDetails,
    rootCause: rootCauseDetails,
    errorChain: getErrorChain(error),
  };
}
