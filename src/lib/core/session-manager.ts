/**
 * Session management utility to handle session-based resource tracking
 * Eliminates duplication between QueueManager and WorkerManager
 */
export class SessionManager<T = string> {
  private sessions = new Map<string, Set<T>>();

  /**
   * Create a new session if it doesn't exist
   */
  createSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, new Set());
    }
  }

  /**
   * Add an item to a session
   */
  addToSession(sessionId: string, item: T): void {
    this.createSession(sessionId);
    this.sessions.get(sessionId)!.add(item);
  }

  /**
   * Remove an item from a session
   */
  removeFromSession(sessionId: string, item: T): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.delete(item);
      if (session.size === 0) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Check if a session has a specific item
   */
  hasInSession(sessionId: string, item: T): boolean {
    const session = this.sessions.get(sessionId);
    return session ? session.has(item) : false;
  }

  /**
   * Clean up an entire session
   */
  cleanSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get all items in a session
   */
  getSessionItems(sessionId: string): T[] {
    return Array.from(this.sessions.get(sessionId) || []);
  }

  /**
   * Get total count of sessions
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get total count of items across all sessions
   */
  getTotalItemCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      count += session.size;
    }
    return count;
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    this.sessions.clear();
  }
}

/**
 * Naming utility for consistent queue/worker naming
 */
export class NamingUtility {
  constructor(private readonly prefix: string) {}

  /**
   * Get resource name with optional session ID
   */
  getResourceName(baseName: string, sessionId?: string): string {
    const fullName = `${this.prefix}_${baseName}`;
    return sessionId ? `${fullName}_${sessionId}` : fullName;
  }

  /**
   * Extract base name from resource name
   */
  extractBaseName(resourceName: string): string {
    const prefix = `${this.prefix}_`;
    if (!resourceName.startsWith(prefix)) {
      return resourceName;
    }
    const withoutPrefix = resourceName.substring(prefix.length);
    // Remove session ID if present
    const parts = withoutPrefix.split("_");
    return parts[0] || resourceName;
  }

  /**
   * Extract session ID from resource name
   */
  extractSessionId(resourceName: string): string | undefined {
    const parts = resourceName.split("_");
    return parts.length > 2 ? parts[parts.length - 1] : undefined;
  }
}
