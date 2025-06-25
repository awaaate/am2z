// AM2Z v4.0 - State Management System
// Clean, type-safe state management with immutability

/**
 * Base state that all AM2Z states must extend
 * Provides essential metadata for tracking and debugging
 */
export interface AppState {
  readonly metadata: {
    readonly version: number;
    readonly sessionId: string;
    readonly lastUpdated: string;
    readonly createdAt: string;
  };
}

/**
 * Wraps a state object with a version for optimistic locking.
 */
export type Versioned<T> = {
  state: T;
  version: number;
};

/**
 * Manages the lifecycle of a state object, providing methods for safe concurrent updates.
 */
export interface StateManager<T extends AppState> {
  /**
   * Retrieves the latest version of the state.
   * @param sessionId The ID of the session to retrieve the state for.
   */
  get(sessionId: string): Promise<Versioned<T> | null>;

  /**
   * Sets the state, overwriting any existing state. Should only be used for initialization.
   * @param sessionId The ID of the session to set the state for.
   * @param state The state object to set.
   */
  set(sessionId: string, state: T): Promise<void>;

  /**
   * Updates the state using an update function. Implements optimistic locking to handle concurrent updates.
   * @param sessionId The ID of the session to update the state for.
   * @param updateFn A function that takes the current state and returns the new state.
   */
  update(
    sessionId: string,
    updateFn: (currentState: T) => Promise<T> | T
  ): Promise<T>;
}

/**
 * State with branded type for compile-time safety
 * Prevents mixing different state types accidentally
 */
export type BrandedState<TBrand extends string, TData> = AppState & {
  readonly __brand: TBrand;
} & TData;

/**
 * Non-empty array type for better type safety
 * Eliminates runtime checks for empty arrays
 */
export type NonEmptyArray<T> = [T, ...T[]];

/**
 * Create a non-empty array with runtime validation
 */
export function createNonEmptyArray<T>(items: T[]): NonEmptyArray<T> {
  if (items.length === 0) {
    throw new Error("Array must contain at least one element");
  }
  return items as NonEmptyArray<T>;
}

/**
 * Type guard for branded states
 */
export function isBrandedState<TBrand extends string>(
  state: AppState,
  brand: TBrand
): state is BrandedState<TBrand, any> {
  return "__brand" in state && (state as any).__brand === brand;
}

/**
 * Helper to create initial app state
 */
export function createAppState(
  sessionId: string,
  additionalData: Record<string, unknown> = {}
): AppState {
  const now = new Date().toISOString();

  return {
    metadata: {
      version: 1,
      sessionId,
      lastUpdated: now,
      createdAt: now,
    },
    ...additionalData,
  };
}

/**
 * Update state metadata (called automatically by processors)
 */
export function updateStateMetadata<T extends AppState>(state: T): T {
  return {
    ...state,
    metadata: {
      ...state.metadata,
      version: state.metadata.version + 1,
      lastUpdated: new Date().toISOString(),
    },
  };
}
