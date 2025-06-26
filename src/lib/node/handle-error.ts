import {
  AM2ZError,
  ProcessorExecutionError,
  NetworkError,
  TimeoutError,
  ValidationError,
  ConfigurationError,
  ResourceError,
} from "../core/errors";

/**
 * Enhanced error handling that categorizes errors appropriately
 * instead of always returning NetworkError
 */
export function handleError(
  error: unknown,
  processorName: string,
  executionId: string,
  timeoutMs?: number
): AM2ZError {
  // If it's already an AM2Z error, preserve it unless it's already a ProcessorExecutionError
  if (error instanceof AM2ZError) {
    // Don't double-wrap ProcessorExecutionErrors
    if (error instanceof ProcessorExecutionError) {
      return error;
    }
    // Wrap other AM2Z errors to add processor context
    return new ProcessorExecutionError(processorName, executionId, error);
  }

  // Handle standard Error types
  if (error instanceof Error) {
    // Categorize based on error message and type
    const message = error.message.toLowerCase();

    if (message.includes("timeout") || message.includes("timed out")) {
      return new ProcessorExecutionError(
        processorName,
        executionId,
        new TimeoutError(
          `processor:${processorName}`,
          timeoutMs || 30000 // Use actual timeout or default
        ),
        { originalError: error.message }
      );
    }

    if (message.includes("validation") || message.includes("invalid")) {
      return new ProcessorExecutionError(
        processorName,
        executionId,
        new ValidationError("unknown", error.message, "Validation failed"),
        { originalError: error.message }
      );
    }

    if (message.includes("config") || message.includes("configuration")) {
      return new ProcessorExecutionError(
        processorName,
        executionId,
        new ConfigurationError("unknown", error.message),
        { originalError: error.message }
      );
    }

    if (
      message.includes("memory") ||
      message.includes("resource") ||
      message.includes("limit") ||
      message.includes("exhausted")
    ) {
      return new ProcessorExecutionError(
        processorName,
        executionId,
        new ResourceError("unknown", 0, 0),
        { originalError: error.message }
      );
    }

    if (
      message.includes("network") ||
      message.includes("connection") ||
      message.includes("socket") ||
      message.includes("dns") ||
      message.includes("http") ||
      message.includes("fetch")
    ) {
      return new ProcessorExecutionError(
        processorName,
        executionId,
        new NetworkError("queue", undefined, error),
        { originalError: error.message }
      );
    }

    // For other Error types, create a generic ProcessorExecutionError
    return new ProcessorExecutionError(processorName, executionId, error, {
      originalErrorType: error.constructor.name,
    });
  }

  // Handle non-Error types (strings, objects, etc.) with better type preservation
  const errorMessage = typeof error === "string" ? error : String(error);
  const preservedError = new Error(errorMessage);

  // Preserve additional properties if it's an object
  if (typeof error === "object" && error !== null) {
    Object.assign(preservedError, { originalObject: error });
  }

  return new ProcessorExecutionError(
    processorName,
    executionId,
    preservedError,
    {
      originalValue: error,
      originalType: typeof error,
      isObject: typeof error === "object" && error !== null,
      constructorName: error?.constructor?.name,
    }
  );
}
