import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { 
  setupTestRuntime, 
  cleanupTestRuntime, 
  createTestProcessor,
  createTestState,
  createCounterProcessor,
  waitForCondition,
  type TestState 
} from "./test-helpers";
import { type QueueRuntime } from "../../lib/node/queue-runtime";
import { createProcessor } from "../../lib/core/processor";
import { Success } from "../../lib/core/result";

describe("Session Isolation", () => {
  let runtime: QueueRuntime<TestState>;

  beforeEach(async () => {
    runtime = await setupTestRuntime();
  });

  afterEach(async () => {
    await cleanupTestRuntime(runtime);
  });

  test("should execute processor in isolated session", async () => {
    const processor = createTestProcessor("session-test");
    runtime.register(processor);
    await runtime.start();
    
    const sessionId = "test-session-123";
    const state = await createTestState({ count: 5 });
    
    const result = await runtime.executeInSession("session-test", state, sessionId);
    
    expect(result.success).toBe(true);
    expect(result.metadata.sessionId).toBe(sessionId);
  });

  test("should isolate state between sessions", async () => {
    const processor = createCounterProcessor("counter");
    runtime.register(processor);
    await runtime.start();
    
    const session1 = "session-1";
    const session2 = "session-2";
    
    const state1 = await createTestState({ count: 10 });
    const state2 = await createTestState({ count: 20 });
    
    const result1 = await runtime.executeInSession("counter", state1, session1);
    const result2 = await runtime.executeInSession("counter", state2, session2);
    
    expect(result1.success).toBe(true);
    expect(result1.state.count).toBe(11);
    
    expect(result2.success).toBe(true);
    expect(result2.state.count).toBe(21);
  });

  test("should create session-specific infrastructure", async () => {
    const processor = createTestProcessor("infra-test");
    runtime.register(processor);
    await runtime.start();
    
    const sessionId = "infra-session";
    const state = await createTestState();
    
    await runtime.executeInSession("infra-test", state, sessionId);
    
    const queues = runtime.getQueues();
    const sessionQueue = queues.find(q => q.name.includes(sessionId));
    
    expect(sessionQueue).toBeDefined();
    expect(sessionQueue?.name).toBe(`am2z_infra-test_${sessionId}`);
  });

  test("should handle multiple processors in same session", async () => {
    const processor1 = createProcessor<TestState>("proc-1")
      .process(async (state) => Success({ ...state, items: [...(state.items || []), "A"] }));
    
    const processor2 = createProcessor<TestState>("proc-2")
      .process(async (state) => Success({ ...state, items: [...(state.items || []), "B"] }));
    
    runtime.register(processor1);
    runtime.register(processor2);
    await runtime.start();
    
    const sessionId = "multi-processor-session";
    const state = await createTestState({ items: [] });
    
    const result1 = await runtime.executeInSession("proc-1", state, sessionId);
    const result2 = await runtime.executeInSession("proc-2", result1.state, sessionId);
    
    expect(result2.success).toBe(true);
    expect(result2.state.items).toEqual(["A", "B"]);
  });

  test("should stop specific session", async () => {
    const processor = createTestProcessor("stop-test");
    runtime.register(processor);
    await runtime.start();
    
    const sessionId = "stop-session";
    const state = await createTestState();
    
    await runtime.executeInSession("stop-test", state, sessionId);
    
    const sessionsBefore = runtime.getActiveSessions();
    expect(sessionsBefore).toContain(sessionId);
    
    await runtime.stopSession(sessionId);
    
    const sessionsAfter = runtime.getActiveSessions();
    expect(sessionsAfter).not.toContain(sessionId);
  });

  test("should get session-specific statistics", async () => {
    const processor = createTestProcessor("stats-test");
    runtime.register(processor);
    await runtime.start();
    
    const sessionId = "stats-session";
    const states = await Promise.all([
      createTestState({ count: 1 }),
      createTestState({ count: 2 }),
      createTestState({ count: 3 }),
    ]);
    
    for (const state of states) {
      await runtime.executeInSession("stats-test", state, sessionId);
    }
    
    await waitForCondition(async () => {
      const stats = await runtime.getSessionStats(sessionId);
      return (stats["stats-test"]?.completed || 0) >= 3;
    });
    
    const sessionStats = await runtime.getSessionStats(sessionId);
    expect(sessionStats["stats-test"]).toBeDefined();
    expect(sessionStats["stats-test"].completed).toBeGreaterThanOrEqual(3);
  });

  test("should clean all sessions", async () => {
    const processor = createTestProcessor("cleanup-test");
    runtime.register(processor);
    await runtime.start();
    
    const sessions = ["session-1", "session-2", "session-3"];
    const state = await createTestState();
    
    for (const sessionId of sessions) {
      await runtime.executeInSession("cleanup-test", state, sessionId);
    }
    
    const activeSessions = runtime.getActiveSessions();
    expect(activeSessions.length).toBeGreaterThanOrEqual(3);
    
    await runtime.cleanAllSessions();
    
    const sessionsAfterClean = runtime.getActiveSessions();
    expect(sessionsAfterClean).toHaveLength(0);
  });

  test("should handle concurrent session executions", async () => {
    const processor = createProcessor<TestState>("concurrent-session")
      .withDescription("Adds session ID to items")
      .process(async (state, ctx) => {
        const items = state.items || [];
        items.push(ctx.metadata.sessionId);
        return Success({ ...state, items });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const sessions = ["session-1", "session-2", "session-3"];
    const state = await createTestState({ items: [] });
    
    const results = await Promise.all(
      sessions.map(sessionId => 
        runtime.executeInSession("concurrent-session", state, sessionId)
      )
    );
    
    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
    
    results.forEach((result, index) => {
      expect(result.state.items).toContain(sessions[index]);
      expect(result.state.items).toHaveLength(1);
    });
  });

  test("should handle session processor errors gracefully", async () => {
    const processor = createProcessor<TestState>("error-session")
      .process(async () => {
        throw new Error("Session processor error");
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const sessionId = "error-session-123";
    const state = await createTestState();
    
    const result = await runtime.executeInSession("error-session", state, sessionId);
    
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Session processor error");
    
    await expect(runtime.stopSession(sessionId)).resolves.toBeUndefined();
  });

  test("should maintain session isolation with nested calls", async () => {
    const childProcessor = createProcessor<TestState>("session-child")
      .process(async (state, ctx) => {
        return Success({ 
          ...state, 
          items: [...(state.items || []), ctx.metadata.sessionId] 
        });
      });
    
    const parentProcessor = createProcessor<TestState>("session-parent")
      .process(async (state, ctx) => {
        const result = await ctx.call("session-child", state);
        if (!result.success) return result;
        
        return Success({
          ...result.state,
          items: [...(result.state.items || []), "parent-" + ctx.metadata.sessionId]
        });
      });
    
    runtime.register(childProcessor);
    runtime.register(parentProcessor);
    await runtime.start();
    
    const session1 = "nested-session-1";
    const session2 = "nested-session-2";
    
    const state = await createTestState({ items: [] });
    
    const result1 = await runtime.executeInSession("session-parent", state, session1);
    const result2 = await runtime.executeInSession("session-parent", state, session2);
    
    expect(result1.success).toBe(true);
    expect(result1.state.items).toContain(session1);
    expect(result1.state.items).toContain("parent-" + session1);
    
    expect(result2.success).toBe(true);
    expect(result2.state.items).toContain(session2);
    expect(result2.state.items).toContain("parent-" + session2);
    
    expect(result1.state.items).not.toContain(session2);
    expect(result2.state.items).not.toContain(session1);
  });
});