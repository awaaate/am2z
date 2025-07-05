import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { 
  setupTestRuntime, 
  cleanupTestRuntime, 
  createTestProcessor,
  createTestState,
  type TestState,
  TEST_REDIS_CONFIG
} from "./test-helpers";
import { type QueueRuntime } from "../../lib/node/queue-runtime";
import { RedisStateManager } from "../../lib/node/redis-state-manager";
import { ConnectionManager } from "../../lib/node/connection-manager";
import { createProcessor } from "../../lib/core/processor";
import { Success } from "../../lib/core/result";
import { createAppState } from "../../lib/core/state";

describe("Distributed State Management", () => {
  let runtime: QueueRuntime<TestState>;
  let stateManager: RedisStateManager<TestState>;
  let connectionManager: ConnectionManager;

  beforeEach(async () => {
    runtime = await setupTestRuntime();
    connectionManager = new ConnectionManager(TEST_REDIS_CONFIG);
    stateManager = new RedisStateManager<TestState>(connectionManager.getConnection("state"));
  });

  afterEach(async () => {
    await cleanupTestRuntime(runtime);
    await connectionManager.disconnect();
  });

  test("should persist state to Redis", async () => {
    const sessionId = "persist-test";
    const state = await createTestState({ count: 42, message: "persisted" });
    
    await stateManager.set(sessionId, state);
    
    const retrieved = await stateManager.get(sessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.count).toBe(42);
    expect(retrieved?.message).toBe("persisted");
  });

  test("should handle state updates with optimistic locking", async () => {
    const sessionId = "optimistic-lock-test";
    const initialState = await createTestState({ count: 0 });
    
    await stateManager.set(sessionId, initialState);
    
    const state1 = await stateManager.get(sessionId);
    const state2 = await stateManager.get(sessionId);
    
    expect(state1).toBeDefined();
    expect(state2).toBeDefined();
    
    const updated1 = { ...state1!, count: 10 };
    await stateManager.set(sessionId, updated1);
    
    const updated2 = { ...state2!, count: 20 };
    await expect(stateManager.set(sessionId, updated2)).rejects.toThrow();
  });

  test("should maintain state integrity across processor executions", async () => {
    const processor = createProcessor<TestState>("state-tracker")
      .process(async (state) => {
        const items = state.items || [];
        items.push(`step-${items.length + 1}`);
        return Success({ ...state, items });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const sessionId = "state-integrity-test";
    let state = await createTestState({ items: [] });
    
    for (let i = 0; i < 3; i++) {
      const result = await runtime.executeInSession("state-tracker", state, sessionId);
      expect(result.success).toBe(true);
      state = result.state;
    }
    
    expect(state.items).toEqual(["step-1", "step-2", "step-3"]);
    
    const persistedState = await stateManager.get(sessionId);
    expect(persistedState?.items).toEqual(["step-1", "step-2", "step-3"]);
  });

  test("should handle concurrent state updates", async () => {
    const processor = createProcessor<TestState>("concurrent-updater")
      .process(async (state, ctx) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return Success({ 
          ...state, 
          count: state.count + 1,
          items: [...(state.items || []), ctx.metadata.executionId]
        });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const sessionId = "concurrent-test";
    const initialState = await createTestState({ count: 0, items: [] });
    
    const concurrentExecutions = 5;
    const results = await Promise.all(
      Array.from({ length: concurrentExecutions }, () => 
        runtime.executeInSession("concurrent-updater", initialState, sessionId)
      )
    );
    
    expect(results.every(r => r.success)).toBe(true);
    
    const finalState = await stateManager.get(sessionId);
    expect(finalState?.items?.length).toBeGreaterThan(0);
  });

  test("should handle state with complex data structures", async () => {
    const complexState = await createTestState({
      count: 100,
      message: "complex",
      items: ["a", "b", "c"],
      metadata: {
        nested: {
          deep: {
            value: "found"
          }
        },
        array: [1, 2, 3],
        bool: true,
        nullValue: null
      } as any
    });
    
    const sessionId = "complex-state-test";
    await stateManager.set(sessionId, complexState);
    
    const retrieved = await stateManager.get(sessionId);
    expect(retrieved).toEqual(complexState);
    expect((retrieved?.metadata as any)?.nested?.deep?.value).toBe("found");
  });

  test("should calculate state checksum correctly", async () => {
    const state = await createTestState({ count: 42, message: "checksum test" });
    const sessionId = "checksum-test";
    
    await stateManager.set(sessionId, state);
    
    const processor = createProcessor<TestState>("checksum-validator")
      .process(async (state) => {
        const checksum = state.metadata?.checksum;
        expect(checksum).toBeDefined();
        expect(typeof checksum).toBe("string");
        expect(checksum?.length).toBe(64);
        return Success(state);
      });
    
    runtime.register(processor);
    await runtime.start();
    
    await runtime.executeInSession("checksum-validator", state, sessionId);
  });

  test("should handle state expiration", async () => {
    const sessionId = "expire-test";
    const state = await createTestState({ count: 1 });
    
    await stateManager.set(sessionId, state, 1);
    
    const immediateGet = await stateManager.get(sessionId);
    expect(immediateGet).toBeDefined();
    
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const expiredGet = await stateManager.get(sessionId);
    expect(expiredGet).toBeUndefined();
  });

  test("should share state between processors in same session", async () => {
    const processor1 = createProcessor<TestState>("state-writer")
      .process(async (state) => {
        return Success({ ...state, message: "written by processor1" });
      });
    
    const processor2 = createProcessor<TestState>("state-reader")
      .process(async (state) => {
        expect(state.message).toBe("written by processor1");
        return Success({ ...state, processed: true });
      });
    
    runtime.register(processor1);
    runtime.register(processor2);
    await runtime.start();
    
    const sessionId = "shared-state-test";
    const initialState = await createTestState();
    
    const result1 = await runtime.executeInSession("state-writer", initialState, sessionId);
    expect(result1.success).toBe(true);
    
    const result2 = await runtime.executeInSession("state-reader", result1.state, sessionId);
    expect(result2.success).toBe(true);
    expect(result2.state.processed).toBe(true);
  });

  test("should isolate state between different sessions", async () => {
    const processor = createProcessor<TestState>("session-state")
      .process(async (state, ctx) => {
        return Success({ 
          ...state, 
          message: `Session: ${ctx.metadata.sessionId}` 
        });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const session1 = "session-state-1";
    const session2 = "session-state-2";
    
    const state1 = await createTestState({ count: 1 });
    const state2 = await createTestState({ count: 2 });
    
    await runtime.executeInSession("session-state", state1, session1);
    await runtime.executeInSession("session-state", state2, session2);
    
    const retrieved1 = await stateManager.get(session1);
    const retrieved2 = await stateManager.get(session2);
    
    expect(retrieved1?.message).toBe(`Session: ${session1}`);
    expect(retrieved2?.message).toBe(`Session: ${session2}`);
    expect(retrieved1?.count).toBe(1);
    expect(retrieved2?.count).toBe(2);
  });

  test("should handle state rollback on processor failure", async () => {
    let callCount = 0;
    const processor = createProcessor<TestState>("rollback-test")
      .withRetryPolicy({ maxAttempts: 3, backoffMs: 100 })
      .process(async (state) => {
        callCount++;
        if (callCount < 3) {
          throw new Error("Simulated failure");
        }
        return Success({ ...state, count: state.count + 1 });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const sessionId = "rollback-test";
    const initialState = await createTestState({ count: 10 });
    
    const result = await runtime.executeInSession("rollback-test", initialState, sessionId);
    
    expect(result.success).toBe(true);
    expect(result.state.count).toBe(11);
    expect(callCount).toBe(3);
  });
});