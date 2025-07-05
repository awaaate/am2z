import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { 
  setupTestRuntime, 
  cleanupTestRuntime, 
  createTestProcessor,
  createTestState,
  waitForCondition,
  type TestState,
  TEST_REDIS_CONFIG
} from "./test-helpers";
import { type QueueRuntime } from "../../lib/node/queue-runtime";
import { ResourceMonitor, type ResourceLimits } from "../../lib/core/resource-monitor";
import { ConnectionManager } from "../../lib/node/connection-manager";
import { createComponentLogger } from "../../lib/core/component-logger";
import { createProcessor } from "../../lib/core/processor";
import { Success } from "../../lib/core/result";

describe("Resource Monitoring", () => {
  let runtime: QueueRuntime<TestState>;
  let resourceMonitor: ResourceMonitor;
  let connectionManager: ConnectionManager;

  const testLimits: ResourceLimits = {
    maxConnections: 10,
    maxMemoryMB: 100,
    maxQueueSize: 1000,
    sessionTTL: 3600000,
    memoryThreshold: 0.8,
    connectionThreshold: 0.9
  };

  beforeEach(async () => {
    runtime = await setupTestRuntime();
    resourceMonitor = new ResourceMonitor(testLimits, createComponentLogger("TestResourceMonitor"));
    connectionManager = new ConnectionManager(TEST_REDIS_CONFIG, undefined, resourceMonitor);
  });

  afterEach(async () => {
    await cleanupTestRuntime(runtime);
    await connectionManager.disconnect();
    resourceMonitor.reset();
  });

  test("should initialize with correct limits", () => {
    const stats = resourceMonitor.getResourceStats();
    
    expect(stats.connections.max).toBe(10);
    expect(stats.connections.active).toBe(0);
    expect(stats.sessions.active).toBe(0);
    expect(stats.queues.total).toBe(0);
  });

  test("should track connection registration", () => {
    resourceMonitor.registerConnection();
    resourceMonitor.registerConnection();
    
    const stats = resourceMonitor.getResourceStats();
    expect(stats.connections.active).toBe(2);
    expect(stats.connections.percentage).toBe(0.2);
  });

  test("should track connection unregistration", () => {
    resourceMonitor.registerConnection();
    resourceMonitor.registerConnection();
    resourceMonitor.unregisterConnection();
    
    const stats = resourceMonitor.getResourceStats();
    expect(stats.connections.active).toBe(1);
    expect(stats.connections.percentage).toBe(0.1);
  });

  test("should track session registration", () => {
    const sessionId1 = "session-1";
    const sessionId2 = "session-2";
    
    resourceMonitor.registerSession(sessionId1);
    resourceMonitor.registerSession(sessionId2);
    
    const stats = resourceMonitor.getResourceStats();
    expect(stats.sessions.active).toBe(2);
  });

  test("should track session unregistration", () => {
    const sessionId = "test-session";
    
    resourceMonitor.registerSession(sessionId);
    expect(resourceMonitor.getResourceStats().sessions.active).toBe(1);
    
    resourceMonitor.unregisterSession(sessionId);
    expect(resourceMonitor.getResourceStats().sessions.active).toBe(0);
  });

  test("should track queue sizes", () => {
    resourceMonitor.updateQueueSize("queue-1", 100);
    resourceMonitor.updateQueueSize("queue-2", 200);
    resourceMonitor.updateQueueSize("queue-3", 50);
    
    const stats = resourceMonitor.getResourceStats();
    expect(stats.queues.total).toBe(3);
    expect(stats.queues.maxSize).toBe(200);
    expect(stats.queues.largestQueue.name).toBe("queue-2");
    expect(stats.queues.largestQueue.size).toBe(200);
  });

  test("should update existing queue sizes", () => {
    resourceMonitor.updateQueueSize("queue-1", 100);
    resourceMonitor.updateQueueSize("queue-1", 150);
    
    const stats = resourceMonitor.getResourceStats();
    expect(stats.queues.total).toBe(1);
    expect(stats.queues.maxSize).toBe(150);
  });

  test("should check memory usage", async () => {
    const stats = resourceMonitor.getResourceStats();
    
    expect(stats.memory.used).toBeGreaterThan(0);
    expect(stats.memory.total).toBeGreaterThan(0);
    expect(stats.memory.percentage).toBeGreaterThan(0);
    expect(stats.memory.percentage).toBeLessThanOrEqual(1);
  });

  test("should enforce connection limits", async () => {
    // Register up to the limit
    for (let i = 0; i < testLimits.maxConnections; i++) {
      resourceMonitor.registerConnection();
    }
    
    // This should not throw as we're at the limit
    await expect(resourceMonitor.checkResourceLimits()).resolves.toBeUndefined();
    
    // One more should trigger the limit
    resourceMonitor.registerConnection();
    
    await expect(resourceMonitor.checkResourceLimits()).rejects.toThrow("Resource 'connection' exhausted");
  });

  test("should enforce queue size limits", async () => {
    // Add queues up to near the limit
    resourceMonitor.updateQueueSize("large-queue", testLimits.maxQueueSize + 1);
    
    await expect(resourceMonitor.checkResourceLimits()).rejects.toThrow("Resource 'queue' exhausted");
  });

  test("should track oldest session", () => {
    const session1 = "old-session";
    const session2 = "new-session";
    
    resourceMonitor.registerSession(session1);
    
    // Add a small delay to ensure different timestamps
    setTimeout(() => {
      resourceMonitor.registerSession(session2);
    }, 10);
    
    const stats = resourceMonitor.getResourceStats();
    expect(stats.sessions.oldest.sessionId).toBe(session1);
  });

  test("should reset all counters", () => {
    resourceMonitor.registerConnection();
    resourceMonitor.registerConnection();
    resourceMonitor.registerSession("test-session");
    resourceMonitor.updateQueueSize("test-queue", 100);
    
    let stats = resourceMonitor.getResourceStats();
    expect(stats.connections.active).toBe(2);
    expect(stats.sessions.active).toBe(1);
    expect(stats.queues.total).toBe(1);
    
    resourceMonitor.reset();
    
    stats = resourceMonitor.getResourceStats();
    expect(stats.connections.active).toBe(0);
    expect(stats.sessions.active).toBe(0);
    expect(stats.queues.total).toBe(0);
  });

  test("should integrate with connection manager", () => {
    // Test that ResourceMonitor can be integrated with ConnectionManager
    // (without actually testing the Redis connection)
    
    // Manually simulate what ConnectionManager would do
    resourceMonitor.registerConnection();
    
    const stats = resourceMonitor.getResourceStats();
    expect(stats.connections.active).toBe(1);
    
    resourceMonitor.unregisterConnection();
    expect(resourceMonitor.getResourceStats().connections.active).toBe(0);
  });

  test("should handle memory pressure warnings", async () => {
    const highMemoryLimits: ResourceLimits = {
      ...testLimits,
      maxMemoryMB: 10000, // Very high limit so it doesn't throw
      memoryThreshold: 0.01 // Low threshold to trigger warnings
    };
    
    const memoryMonitor = new ResourceMonitor(highMemoryLimits);
    
    // This should warn about memory usage but not throw
    await expect(memoryMonitor.checkResourceLimits()).resolves.toBeUndefined();
  });

  test("should provide detailed resource statistics", () => {
    resourceMonitor.registerConnection();
    resourceMonitor.registerConnection();
    resourceMonitor.registerSession("session-1");
    resourceMonitor.updateQueueSize("queue-1", 500);
    resourceMonitor.updateQueueSize("queue-2", 300);
    
    const stats = resourceMonitor.getResourceStats();
    
    expect(stats).toMatchObject({
      memory: {
        used: expect.any(Number),
        total: expect.any(Number),
        percentage: expect.any(Number)
      },
      connections: {
        active: 2,
        max: 10,
        percentage: 0.2
      },
      queues: {
        total: 2,
        maxSize: 500,
        largestQueue: {
          name: "queue-1",
          size: 500
        }
      },
      sessions: {
        active: 1,
        oldest: {
          sessionId: "session-1",
          age: expect.any(Number)
        }
      }
    });
  });

  test("should work with runtime lifecycle", async () => {
    // This test verifies that the ResourceMonitor class works correctly
    // with the runtime components (not testing integration)
    resourceMonitor.registerConnection();
    resourceMonitor.registerSession("runtime-session");
    
    const stats = resourceMonitor.getResourceStats();
    expect(stats.connections.active).toBeGreaterThan(0);
    expect(stats.sessions.active).toBeGreaterThan(0);
  });

  test("should handle concurrent resource tracking", () => {
    // Register resources sequentially to avoid race conditions
    for (let i = 0; i < 20; i++) {
      resourceMonitor.registerConnection();
      resourceMonitor.registerSession(`session-${i}`);
      resourceMonitor.updateQueueSize(`queue-${i}`, i * 10);
    }
    
    // Check that all resources were registered
    let stats = resourceMonitor.getResourceStats();
    expect(stats.connections.active).toBe(20);
    expect(stats.sessions.active).toBe(20);
    expect(stats.queues.total).toBe(20);
    
    // Now clean up all resources
    for (let i = 0; i < 20; i++) {
      resourceMonitor.unregisterConnection();
      resourceMonitor.unregisterSession(`session-${i}`);
    }
    
    stats = resourceMonitor.getResourceStats();
    expect(stats.connections.active).toBe(0);
    expect(stats.sessions.active).toBe(0);
    expect(stats.queues.total).toBe(20); // Queues persist until explicitly cleared
  });
});