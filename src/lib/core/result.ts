// AM2Z v4.0 - Result Type System
// Rust-inspired error handling for type-safe operations

/**
 * Result type for operations that can succeed or fail.
 * Prefer this over throwing exceptions for predictable errors.
 *
 * @template TData - The success data type.
 * @template TError - The error type.
 *
 * @example
 * function divide(a: number, b: number): Result<number, string> {
 *   return b === 0 ? Failure("Division by zero") : Success(a / b);
 * }
 */
export type Result<TData, TError> =
  | { readonly success: true; readonly data: TData }
  | { readonly success: false; readonly error: TError };

/**
 * Create a successful result.
 * @param data - The success value.
 * @returns A Result with success=true.
 * @example
 * const ok = Success(42);
 */
export function Success<TData>(data: TData): Result<TData, never> {
  return { success: true, data };
}

/**
 * Create a failed result.
 * @param error - The error value.
 * @returns A Result with success=false.
 * @example
 * const fail = Failure("Something went wrong");
 */
export function Failure<TError>(error: TError): Result<never, TError> {
  return { success: false, error };
}

/**
 * Type guard for successful results.
 * @param result - The result to check.
 * @returns True if result is success.
 * @example
 * if (isSuccess(result)) { console.log(result.data); }
 */
export function isSuccess<TData, TError>(
  result: Result<TData, TError>
): result is { success: true; data: TData } {
  return result.success;
}

/**
 * Type guard for failed results.
 * @param result - The result to check.
 * @returns True if result is failure.
 * @example
 * if (isFailure(result)) { console.error(result.error); }
 */
export function isFailure<TData, TError>(
  result: Result<TData, TError>
): result is { success: false; error: TError } {
  return !result.success;
}

/**
 * Pattern matching for results.
 * @param result - The result to match.
 * @param patterns - Handlers for success and failure.
 * @returns The value returned by the matching handler.
 * @example
 * matchResult(result, {
 *   success: data => `Yay: ${data}`,
 *   failure: err => `Oops: ${err}`
 * });
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
 * Chain operations on successful results (flatMap/bind).
 * @param result - The input result.
 * @param fn - Function to call if success.
 * @returns The chained result.
 * @example
 * const r = chainResult(Success(2), x => Success(x * 2));
 */
export function chainResult<TData, TError, TNewData>(
  result: Result<TData, TError>,
  fn: (data: TData) => Result<TNewData, TError>
): Result<TNewData, TError> {
  return result.success ? fn(result.data) : result;
}

/**
 * Transform the data in a successful result (map).
 * @param result - The input result.
 * @param fn - Function to transform data.
 * @returns The mapped result.
 * @example
 * const r = mapResult(Success(2), x => x * 10); // Success(20)
 */
export function mapResult<TData, TError, TNewData>(
  result: Result<TData, TError>,
  fn: (data: TData) => TNewData
): Result<TNewData, TError> {
  return result.success ? Success(fn(result.data)) : result;
}

/**
 * Transform the error in a failed result.
 * @param result - The input result.
 * @param fn - Function to transform error.
 * @returns The mapped result.
 * @example
 * const r = mapError(Failure("fail"), e => `Error: ${e}`);
 */
export function mapError<TData, TError, TNewError>(
  result: Result<TData, TError>,
  fn: (error: TError) => TNewError
): Result<TData, TNewError> {
  return result.success ? result : Failure(fn(result.error));
}

/**
 * Get data from result or throw error.
 * Use sparingly - prefer pattern matching.
 * @param result - The result to unwrap.
 * @returns The data if success, otherwise throws error.
 * @throws The error if result is failure.
 * @example
 * const value = unwrapResult(Success(1)); // 1
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
 * Get data from result or return default value.
 * @param result - The result to unwrap.
 * @param defaultValue - Value to return if failure.
 * @returns The data or the default value.
 * @example
 * const value = unwrapOr(Failure("fail"), 42); // 42
 */
export function unwrapOr<TData, TError>(
  result: Result<TData, TError>,
  defaultValue: TData
): TData {
  return result.success ? result.data : defaultValue;
}

/**
 * Combine multiple results into one.
 * Fails if any individual result fails.
 * @param results - Array of results.
 * @returns Success with array of data, or first failure.
 * @example
 * const r = combineResults([Success(1), Success(2)]); // Success([1,2])
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
 * Safely execute a function that might throw (async).
 * @param fn - The async function to execute.
 * @returns Success or Failure result.
 * @example
 * const r = await safeAsync(async () => await fetchData());
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
 * Safely execute a synchronous function that might throw.
 * @param fn - The function to execute.
 * @returns Success or Failure result.
 * @example
 * const r = safeSync(() => JSON.parse("bad json")); // Failure(Error)
 */
export function safeSync<TData>(fn: () => TData): Result<TData, Error> {
  try {
    const data = fn();
    return Success(data);
  } catch (error) {
    return Failure(error instanceof Error ? error : new Error(String(error)));
  }
}
