import { type AM2ZError } from "./errors";
import { type ProcessorResult } from "./processor";
import { type AppState } from "./state";
import { type Logger } from "./logging";

/**
 * Common error handling utilities to reduce duplication across the codebase
 */

/**
 * Extract errors from promise settlement results
 */
export function extractErrorsFromResults<T>(
  results: PromiseSettledResult<T>[],
  errorContext: string
): AM2ZError[] {
  return results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => {
      if (r.reason && typeof r.reason === "object" && "code" in r.reason) {
        return r.reason as AM2ZError;
      }
      return new Error(`${errorContext}: ${r.reason}`) as AM2ZError;
    });
}

/**
 * Extract the first error from processor results
 */
export function extractFirstError<TState extends AppState>(
  results: ProcessorResult<TState>[],
  _compositionName: string,
  _executionId: string
): AM2ZError | null {
  const failedResult = results.find((r) => !r.success);
  if (failedResult?.error) {
    return failedResult.error;
  }
  return null;
}

/**
 * Handle error with logging and optional context
 */
export function handleError(
  error: unknown,
  logger: Logger,
  context: Record<string, unknown> = {}
): AM2ZError {
  const am2zError = error as AM2ZError;
  
  logger.error("Error occurred", {
    ...context,
    error: am2zError,
    code: am2zError.code,
    category: am2zError.category,
  });
  
  return am2zError;
}

/**
 * Wrap an async function with error handling
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  errorContext: string,
  logger?: Logger
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (logger) {
      handleError(error, logger, { context: errorContext });
    }
    throw error;
  }
}

/**
 * Create a standardized error handler for resource cleanup
 */
export function createCleanupErrorHandler(
  resourceName: string,
  logger: Logger
): (error: unknown) => void {
  return (error: unknown) => {
    logger.warn(`Error during ${resourceName} cleanup`, {
      error: error instanceof Error ? error.message : String(error),
    });
  };
}

/**
 * Batch cleanup operations with error handling
 */
export async function cleanupResources(
  resources: Array<{
    name: string;
    cleanup: () => Promise<void>;
  }>,
  logger: Logger
): Promise<void> {
  const errors: Array<{ resource: string; error: unknown }> = [];
  
  await Promise.allSettled(
    resources.map(async ({ name, cleanup }) => {
      try {
        await cleanup();
      } catch (error) {
        errors.push({ resource: name, error });
        logger.warn(`Failed to cleanup ${name}`, { error });
      }
    })
  );
  
  if (errors.length > 0) {
    logger.error("Some resources failed to cleanup", { errors });
  }
}

/**
 * Create a timeout wrapper with proper cleanup
 */
export function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage = "Operation timed out"
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    
    fn()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Retry an operation with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    multiplier?: number;
    shouldRetry?: (error: unknown, attempt: number) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelay = 100,
    maxDelay = 10000,
    multiplier = 2,
    shouldRetry = () => true,
  } = options;
  
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      
      const delay = Math.min(
        initialDelay * Math.pow(multiplier, attempt - 1),
        maxDelay
      );
      
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}