// AM2Z v4.0 - Result Type System
// Rust-inspired error handling for type-safe operations

/**
 * Result type for operations that can succeed or fail
 * Better than throwing exceptions for predictable errors
 */
export type Result<TData, TError> = 
  | { readonly success: true; readonly data: TData }
  | { readonly success: false; readonly error: TError };

/**
 * Create a successful result
 */
export function Success<TData>(data: TData): Result<TData, never> {
  return { success: true, data };
}

/**
 * Create a failed result
 */
export function Failure<TError>(error: TError): Result<never, TError> {
  return { success: false, error };
}

/**
 * Type guard for successful results
 */
export function isSuccess<TData, TError>(
  result: Result<TData, TError>
): result is { success: true; data: TData } {
  return result.success;
}

/**
 * Type guard for failed results
 */
export function isFailure<TData, TError>(
  result: Result<TData, TError>
): result is { success: false; error: TError } {
  return !result.success;
}

/**
 * Pattern matching for results
 */
export function matchResult<TData, TError, TReturn>(
  result: Result<TData, TError>,
  patterns: {
    success: (data: TData) => TReturn;
    failure: (error: TError) => TReturn;
  }
): TReturn {
  return result.success 
    ? patterns.success(result.data) 
    : patterns.failure(result.error);
}

/**
 * Chain operations on successful results
 * Similar to flatMap/bind in functional programming
 */
export function chainResult<TData, TError, TNewData>(
  result: Result<TData, TError>,
  fn: (data: TData) => Result<TNewData, TError>
): Result<TNewData, TError> {
  return result.success ? fn(result.data) : result;
}

/**
 * Transform the data in a successful result
 * Similar to map in functional programming
 */
export function mapResult<TData, TError, TNewData>(
  result: Result<TData, TError>,
  fn: (data: TData) => TNewData
): Result<TNewData, TError> {
  return result.success 
    ? Success(fn(result.data)) 
    : result;
}

/**
 * Transform the error in a failed result
 */
export function mapError<TData, TError, TNewError>(
  result: Result<TData, TError>,
  fn: (error: TError) => TNewError
): Result<TData, TNewError> {
  return result.success 
    ? result 
    : Failure(fn(result.error));
}

/**
 * Get data from result or throw error
 * Use sparingly - prefer pattern matching
 */
export function unwrapResult<TData, TError>(
  result: Result<TData, TError>
): TData {
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

/**
 * Get data from result or return default value
 */
export function unwrapOr<TData, TError>(
  result: Result<TData, TError>,
  defaultValue: TData
): TData {
  return result.success ? result.data : defaultValue;
}

/**
 * Combine multiple results into one
 * Fails if any individual result fails
 */
export function combineResults<TData, TError>(
  results: Result<TData, TError>[]
): Result<TData[], TError> {
  const data: TData[] = [];
  
  for (const result of results) {
    if (!result.success) {
      return result;
    }
    data.push(result.data);
  }
  
  return Success(data);
}

/**
 * Safely execute a function that might throw
 */
export async function safeAsync<TData>(
  fn: () => Promise<TData>
): Promise<Result<TData, Error>> {
  try {
    const data = await fn();
    return Success(data);
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Safely execute a synchronous function that might throw
 */
export function safeSync<TData>(
  fn: () => TData
): Result<TData, Error> {
  try {
    const data = fn();
    return Success(data);
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}