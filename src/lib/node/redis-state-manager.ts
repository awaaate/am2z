import Redis from "ioredis";
import crypto from "crypto";
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

  private getVersionKey(sessionId: string): string {
    return `${this.keyPrefix}:${sessionId}:version`;
  }

  private getHashKey(sessionId: string): string {
    return `${this.keyPrefix}:${sessionId}:hash`;
  }

  private hashState(state: T): string {
    // Sort keys for deterministic hashing
    const sortedState = this.sortObjectKeys(state);
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(sortedState))
      .digest("hex");
  }

  private sortObjectKeys(obj: any): any {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) return obj.map((item) => this.sortObjectKeys(item));

    const sorted: any = {};
    Object.keys(obj)
      .sort()
      .forEach((key) => {
        sorted[key] = this.sortObjectKeys(obj[key]);
      });
    return sorted;
  }

  async get(sessionId: string): Promise<Versioned<T> | null> {
    const key = this.getKey(sessionId);
    const versionKey = this.getVersionKey(sessionId);

    const [data, versionStr] = await this.redis.mget(key, versionKey);
    if (!data) {
      return null;
    }

    const state = JSON.parse(data) as T;
    const version = parseInt(versionStr || "1", 10);

    return { state, version };
  }

  async set(sessionId: string, state: T): Promise<void> {
    const key = this.getKey(sessionId);
    const versionKey = this.getVersionKey(sessionId);
    const hashKey = this.getHashKey(sessionId);

    const stateHash = this.hashState(state);

    // Always set version to 1 for new states (don't auto-increment)
    const multi = this.redis.multi();
    multi.set(key, JSON.stringify(state));
    multi.set(versionKey, "1"); // Always start at 1
    multi.set(hashKey, stateHash);
    await multi.exec();
  }

  async update(
    sessionId: string,
    updateFn: (currentState: T) => Promise<T> | T
  ): Promise<T> {
    const key = this.getKey(sessionId);
    const versionKey = this.getVersionKey(sessionId);
    const hashKey = this.getHashKey(sessionId);

    // Retry loop for optimistic locking with strict CAS
    for (let attempt = 0; attempt < 10; attempt++) {
      // Watch state, version, and hash keys for changes
      await this.redis.watch(key, versionKey, hashKey);

      const [stateData, versionStr, currentHash] = await this.redis.mget(
        key,
        versionKey,
        hashKey
      );

      if (!stateData) {
        await this.redis.unwatch();
        throw new Error(`State for session ${sessionId} not found.`);
      }

      const currentState = JSON.parse(stateData) as T;
      const currentVersion = parseInt(versionStr || "1", 10);

      // Verify hash integrity for strict CAS
      const expectedHash = this.hashState(currentState);
      if (currentHash && currentHash !== expectedHash) {
        await this.redis.unwatch();
        throw new Error(
          `State integrity check failed for session ${sessionId}. Expected hash: ${expectedHash}, got: ${currentHash}`
        );
      }

      try {
        const newState = await updateFn(currentState);
        const newVersion = currentVersion + 1;
        const newHash = this.hashState(newState);

        const multi = this.redis.multi();
        multi.set(key, JSON.stringify(newState));
        multi.set(versionKey, newVersion.toString());
        multi.set(hashKey, newHash);

        const result = await multi.exec();

        if (
          result &&
          result.length > 0 &&
          result.every(([err]) => err === null)
        ) {
          // Success - transaction completed with strict CAS
          return newState;
        }
        // If result is null or has errors, the watched keys were modified by another client. Retry.
      } catch (error) {
        await this.redis.unwatch();
        throw error;
      }
    }

    throw new Error(
      `Failed to update state for session ${sessionId} after 10 retries due to concurrent modifications.`
    );
  }

  /**
   * Additional utility method to check if a session exists
   */
  async exists(sessionId: string): Promise<boolean> {
    const key = this.getKey(sessionId);
    const result = await this.redis.exists(key);
    return result === 1;
  }

  /**
   * Additional utility method to delete a session
   */
  async delete(sessionId: string): Promise<void> {
    const key = this.getKey(sessionId);
    const versionKey = this.getVersionKey(sessionId);
    const hashKey = this.getHashKey(sessionId);
    await this.redis.del(key, versionKey, hashKey);
  }

  /**
   * Get the current version without the full state
   */
  async getVersion(sessionId: string): Promise<number | null> {
    const versionKey = this.getVersionKey(sessionId);
    const versionStr = await this.redis.get(versionKey);
    return versionStr ? parseInt(versionStr, 10) : null;
  }
}
