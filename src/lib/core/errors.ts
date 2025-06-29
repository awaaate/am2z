// AM2Z v4.0 - Error System
// Class-based errors with proper stack traces and categorization

/**
 * Base error class for all AM2Z errors
 * Provides consistent structure and better debugging
 *
 * @example
 * class MyError extends AM2ZError {
 *   readonly code = "MY_ERROR";
 *   readonly category = "business";
 *   readonly severity = "medium";
 *   readonly retryable = false;
 *   constructor(msg: string) { super(msg); }
 * }
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
   * @returns ErrorDetails object.
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

/**
 * Error category for AM2Z errors
 * - validation: Input validation failures
 * - execution: Runtime execution errors
 * - timeout: Operation timeouts
 * - resource: Resource exhaustion (memory, connections)
 * - network: Network/communication failures
 * - configuration: Setup/config errors
 * - auth: Authentication/authorization
 * - business: Domain-specific business logic errors
 */
export type ErrorCategory =
  | "validation" // Input validation failures
  | "execution" // Runtime execution errors
  | "timeout" // Operation timeouts
  | "resource" // Resource exhaustion (memory, connections)
  | "network" // Network/communication failures
  | "configuration" // Setup/config errors
  | "auth" // Authentication/authorization
  | "business"; // Domain-specific business logic errors

/**
 * Error severity for AM2Z errors
 * - low: Minor issues, system continues
 * - medium: Notable issues, some functionality affected
 * - high: Major issues, significant functionality affected
 * - critical: System-breaking issues
 */
export type ErrorSeverity =
  | "low" // Minor issues, system continues
  | "medium" // Notable issues, some functionality affected
  | "high" // Major issues, significant functionality affected
  | "critical"; // System-breaking issues

/**
 * Structured error details for logging and debugging
 */
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

/**
 * Interface for chain processor errors that contain partial state
 */
export interface ChainError<TState = any> extends AM2ZError {
  readonly partialState?: TState;
  readonly completedSteps: number;
  readonly failedProcessor: string;
}

// === Specific Error Classes ===

/**
 * Validation errors for input data
 *
 * @example
 * throw new ValidationError("email", "foo@bar", "Invalid email");
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
 *
 * @example
 * throw new ProcessorNotFoundError("myProc", ["a", "b"]);
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
 *
 * @example
 * throw new ProcessorExecutionError("proc", "exec-1", new Error("fail"));
 */
export class ProcessorExecutionError extends AM2ZError implements ChainError {
  readonly code = "PROCESSOR_EXECUTION_FAILED";
  readonly category = "execution" as const;
  readonly severity = "high" as const;
  readonly retryable = true;
  readonly partialState?: any;
  readonly completedSteps: number;
  readonly failedProcessor: string;

  constructor(
    public readonly processorName: string,
    public readonly executionId: string,
    cause?: Error,
    context?: Record<string, unknown> & {
      partialState?: any;
      completedSteps?: number;
      failedProcessor?: string;
    }
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

    this.partialState = context?.partialState;
    this.completedSteps = context?.completedSteps || 0;
    this.failedProcessor = context?.failedProcessor || processorName;
  }
}

/**
 * Timeout errors
 *
 * @example
 * throw new TimeoutError("fetchData", 5000);
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
 *
 * @example
 * throw new ResourceError("memory", 1024, 2048);
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
 *
 * @example
 * throw new NetworkError("https://api", 500);
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
 *
 * @example
 * throw new ConfigurationError("REDIS_URL", "Missing value");
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
 *
 * @example
 * throw new BusinessError("BUSINESS_RULE", "Not allowed");
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

/**
 * Call depth exceeded errors
 *
 * @example
 * throw new CallDepthExceededError("Too deep", 10, 15);
 */
export class CallDepthExceededError extends AM2ZError {
  readonly code = "CALL_DEPTH_EXCEEDED";
  readonly category = "execution" as const;
  readonly severity = "high" as const;
  readonly retryable = false;

  constructor(
    message: string,
    public readonly maxDepth: number,
    public readonly currentDepth: number,
    context?: Record<string, unknown>
  ) {
    super(message, {
      maxDepth,
      currentDepth,
      ...context,
    });
  }
}

/**
 * Managed timeout utility for safe timeout handling
 */
export class ManagedTimeout {
  private timeoutId?: NodeJS.Timeout;
  private isCleared = false;

  start(callback: () => void, delay: number): void {
    this.clear();
    this.isCleared = false;
    this.timeoutId = setTimeout(() => {
      if (!this.isCleared) {
        this.timeoutId = undefined;
        callback();
      }
    }, delay);
  }

  clear(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    this.isCleared = true;
  }

  isActive(): boolean {
    return this.timeoutId !== undefined && !this.isCleared;
  }
}

// === Error Utilities ===

/**
 * Check if an error is a ChainError (contains partial state)
 * @param error - The error to check
 * @returns True if error is ChainError
 * @example
 * if (isChainError(err)) { console.log(err.partialState); }
 */
export function isChainError<TState = any>(
  error: AM2ZError
): error is ChainError<TState> {
  return (
    "partialState" in error &&
    "completedSteps" in error &&
    "failedProcessor" in error
  );
}

/**
 * Extract partial state from a ChainError
 * @param error - The error to extract from
 * @returns The partial state or undefined
 * @example
 * const state = extractPartialState(err);
 */
export function extractPartialState<TState = any>(
  error: AM2ZError
): TState | undefined {
  if (isChainError<TState>(error)) {
    return error.partialState;
  }

  // Legacy fallback for existing error patterns
  const anyError = error as any;
  return (
    anyError.context?.partialState ||
    anyError.partialState ||
    anyError.__partialState
  );
}

/**
 * Check if an error is retryable
 * @param error - The error to check
 * @returns True if retryable
 * @example
 * if (isRetryableError(err)) { /* ... * / }
 */
export function isRetryableError(error: Error): boolean {
  return error instanceof AM2ZError && error.retryable;
}

/**
 * Check if an error is critical
 * @param error - The error to check
 * @returns True if severity is 'critical'
 * @example
 * if (isCriticalError(err)) { /* ... * / }
 */
export function isCriticalError(error: Error): boolean {
  return error instanceof AM2ZError && error.severity === "critical";
}

/**
 * Extract structured error details for logging
 * @param error - The error to extract from
 * @returns ErrorDetails object
 * @example
 * const details = extractErrorDetails(err);
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
 * Wrap a generic error as a ProcessorExecutionError
 * @param error - The error to wrap
 * @param processorName - Name of the processor
 * @param executionId - Execution ID
 * @param partialState - Optional partial state
 * @param completedSteps - Optional completed steps
 * @returns ProcessorExecutionError
 * @example
 * throw wrapAsProcessorError(err, "proc", "exec-1");
 */
export function wrapAsProcessorError(
  error: Error,
  processorName: string,
  executionId: string,
  partialState?: any,
  completedSteps?: number
): ProcessorExecutionError {
  if (error instanceof AM2ZError) {
    return new ProcessorExecutionError(processorName, executionId, error, {
      partialState,
      completedSteps,
      failedProcessor: processorName,
    });
  }

  return new ProcessorExecutionError(processorName, executionId, error, {
    originalErrorName: error.name,
    partialState,
    completedSteps,
    failedProcessor: processorName,
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
