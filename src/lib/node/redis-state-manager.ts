import Redis from "ioredis";
import {
  type AppState,
  type StateManager,
  type Versioned,
} from "../core/state";

/**
 * A StateManager implementation that uses Redis for distributed state management.
 * It uses optimistic locking to handle concurrent updates safely.
 */
export class RedisStateManager<T extends AppState> implements StateManager<T> {
  private redis: Redis;
  private keyPrefix: string;

  constructor(redisConnection: Redis, keyPrefix = "am2z:state") {
    this.redis = redisConnection;
    this.keyPrefix = keyPrefix;
  }

  private getKey(sessionId: string): string {
    return `${this.keyPrefix}:${sessionId}`;
  }

  async get(sessionId: string): Promise<Versioned<T> | null> {
    const key = this.getKey(sessionId);
    const data = await this.redis.get(key);
    if (!data) {
      return null;
    }
    const state = JSON.parse(data) as T;
    // For Redis implementation, we'll use a simple versioning approach
    // The version is separate from the state.metadata.version
    const version = 1; // Simplified - could be enhanced with Redis operations
    return { state, version };
  }

  async set(sessionId: string, state: T): Promise<void> {
    const key = this.getKey(sessionId);
    await this.redis.set(key, JSON.stringify(state));
  }

  async update(
    sessionId: string,
    updateFn: (currentState: T) => T
  ): Promise<T> {
    const key = this.getKey(sessionId);

    // Retry loop for optimistic locking
    for (let i = 0; i < 10; i++) {
      // Max 10 retries
      await this.redis.watch(key);
      const versionedState = await this.get(sessionId);

      if (!versionedState) {
        throw new Error(`State for session ${sessionId} not found.`);
      }

      const newState = updateFn(versionedState.state);

      const multi = this.redis.multi();
      multi.set(key, JSON.stringify(newState));

      const result = await multi.exec();

      if (result) {
        return newState; // Success
      }
      // If result is null, the key was modified by another client. Retry.
    }

    throw new Error(
      `Failed to update state for session ${sessionId} after multiple retries.`
    );
  }
}
