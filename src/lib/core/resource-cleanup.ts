import { type Logger } from "./logging";
import { createCleanupErrorHandler } from "./error-utils";

/**
 * Resource cleanup utilities to reduce duplication across managers
 */

/**
 * Resource that can be cleaned up
 */
export interface Cleanable {
  close(): Promise<void>;
}

/**
 * Resource manager base class for consistent cleanup patterns
 */
export abstract class ResourceManager<T extends Cleanable> {
  protected resources = new Map<string, T>();
  
  constructor(
    protected readonly resourceType: string,
    protected readonly logger: Logger
  ) {}
  
  /**
   * Get a resource by key
   */
  getResource(key: string): T | undefined {
    return this.resources.get(key);
  }
  
  /**
   * Check if a resource exists
   */
  hasResource(key: string): boolean {
    return this.resources.has(key);
  }
  
  /**
   * Get all resource keys
   */
  getResourceKeys(): string[] {
    return Array.from(this.resources.keys());
  }
  
  /**
   * Get resource count
   */
  getResourceCount(): number {
    return this.resources.size;
  }
  
  /**
   * Add a resource
   */
  protected addResource(key: string, resource: T): void {
    this.resources.set(key, resource);
    this.logger.debug(`Added ${this.resourceType}: ${key}`, {
      totalResources: this.resources.size,
    });
  }
  
  /**
   * Remove a specific resource
   */
  async removeResource(key: string): Promise<void> {
    const resource = this.resources.get(key);
    if (!resource) {
      return;
    }
    
    try {
      await resource.close();
      this.resources.delete(key);
      this.logger.debug(`Removed ${this.resourceType}: ${key}`, {
        remainingResources: this.resources.size,
      });
    } catch (error) {
      this.handleCleanupError(key, error);
      // Still remove from map even if close failed
      this.resources.delete(key);
    }
  }
  
  /**
   * Close all resources
   */
  async closeAll(): Promise<void> {
    const errorHandler = createCleanupErrorHandler(this.resourceType, this.logger);
    
    this.logger.info(`Closing all ${this.resourceType}s`, {
      count: this.resources.size,
    });
    
    const closePromises = Array.from(this.resources.entries()).map(
      async ([key, resource]) => {
        try {
          await resource.close();
          this.logger.debug(`Closed ${this.resourceType}: ${key}`);
        } catch (error) {
          errorHandler(error);
        }
      }
    );
    
    await Promise.allSettled(closePromises);
    this.resources.clear();
    
    this.logger.info(`All ${this.resourceType}s closed`);
  }
  
  /**
   * Handle cleanup errors consistently
   */
  protected handleCleanupError(key: string, error: unknown): void {
    this.logger.warn(`Failed to close ${this.resourceType}: ${key}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Session-aware resource manager
 */
export abstract class SessionAwareResourceManager<T extends Cleanable> extends ResourceManager<T> {
  protected sessionManager = new Map<string, Set<string>>();
  
  /**
   * Add a resource with session tracking
   */
  protected addSessionResource(key: string, resource: T, sessionId?: string): void {
    this.addResource(key, resource);
    
    if (sessionId) {
      if (!this.sessionManager.has(sessionId)) {
        this.sessionManager.set(sessionId, new Set());
      }
      this.sessionManager.get(sessionId)!.add(key);
    }
  }
  
  /**
   * Clean up all resources for a session
   */
  async cleanSession(sessionId: string): Promise<void> {
    const sessionResourceKeys = this.sessionManager.get(sessionId);
    if (!sessionResourceKeys || sessionResourceKeys.size === 0) {
      return;
    }
    
    this.logger.info(`Cleaning up session ${this.resourceType}s: ${sessionId}`, {
      count: sessionResourceKeys.size,
    });
    
    const cleanupPromises = Array.from(sessionResourceKeys).map((key) =>
      this.removeResource(key)
    );
    
    await Promise.allSettled(cleanupPromises);
    this.sessionManager.delete(sessionId);
    
    this.logger.info(`Cleaned up session ${this.resourceType}s: ${sessionId}`);
  }
  
  /**
   * Get active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessionManager.keys());
  }
}

/**
 * Create a cleanup function with timeout
 */
export function createTimeoutCleanup<T>(
  cleanup: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): () => Promise<T> {
  return async () => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    
    return Promise.race([cleanup(), timeoutPromise]);
  };
}

/**
 * Batch cleanup with progress tracking
 */
export async function batchCleanup<T>(
  items: T[],
  cleanupFn: (item: T) => Promise<void>,
  options: {
    batchSize?: number;
    onProgress?: (completed: number, total: number) => void;
    logger?: Logger;
  } = {}
): Promise<void> {
  const { batchSize = 10, onProgress, logger } = options;
  const total = items.length;
  let completed = 0;
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    await Promise.allSettled(
      batch.map(async (item) => {
        try {
          await cleanupFn(item);
          completed++;
          onProgress?.(completed, total);
        } catch (error) {
          logger?.warn("Batch cleanup item failed", { error });
        }
      })
    );
  }
}