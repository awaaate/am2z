import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { 
  setupTestRuntime, 
  cleanupTestRuntime, 
  createTestProcessor,
  createTestState,
  createDelayProcessor,
  createCounterProcessor,
  waitForCondition,
  type TestState 
} from "./test-helpers";
import { type QueueRuntime } from "../../lib/node/queue-runtime";
import { createProcessor } from "../../lib/core/processor";
import { Success, Failure } from "../../lib/core/result";
import { ProcessorNotFoundError } from "../../lib/core/errors";
import { chainProcessors, parallelProcessors, batchProcessor } from "../../lib/core/processor";

describe("Distributed Execution", () => {
  let runtime: QueueRuntime<TestState>;

  beforeEach(async () => {
    runtime = await setupTestRuntime();
  });

  afterEach(async () => {
    await cleanupTestRuntime(runtime);
  });

  test("should execute a simple processor", async () => {
    const processor = createProcessor<TestState>("simple")
      .withDescription("Simple processor")
      .process(async (state) => Success({ ...state, processed: true }));
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState({ count: 0 });
    const result = await runtime.execute("simple", state);
    
    expect(result.success).toBe(true);
    expect(result.state.processed).toBe(true);
    expect(result.executionTime).toBeGreaterThan(0);
    expect(result.metadata).toBeDefined();
  });

  test("should handle processor not found", async () => {
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("non-existent", state);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ProcessorNotFoundError);
  });

  test("should execute multiple processors in parallel", async () => {
    const processor1 = createDelayProcessor("delay-1", 100);
    const processor2 = createDelayProcessor("delay-2", 100);
    const processor3 = createDelayProcessor("delay-3", 100);
    
    runtime.register(processor1);
    runtime.register(processor2);
    runtime.register(processor3);
    await runtime.start();
    
    const state = await createTestState();
    const startTime = Date.now();
    
    const results = await Promise.all([
      runtime.execute("delay-1", state),
      runtime.execute("delay-2", state),
      runtime.execute("delay-3", state),
    ]);
    
    const duration = Date.now() - startTime;
    
    expect(results).toHaveLength(3);
    expect(results.every(r => r.success)).toBe(true);
    expect(duration).toBeLessThan(300);
  });

  test("should execute many states in batch", async () => {
    const processor = createCounterProcessor("counter");
    
    runtime.register(processor);
    await runtime.start();
    
    const states = await Promise.all([
      createTestState({ count: 1 }),
      createTestState({ count: 2 }),
      createTestState({ count: 3 }),
    ]);
    
    const results = await runtime.executeMany("counter", states);
    
    expect(results).toHaveLength(3);
    expect(results[0]?.state.count).toBe(2);
    expect(results[1]?.state.count).toBe(3);
    expect(results[2]?.state.count).toBe(4);
    expect(results.every(r => r.success)).toBe(true);
  });

  test("should handle partial failures in batch execution", async () => {
    const processor = createProcessor<TestState>("conditional")
      .withDescription("Fails on even counts")
      .process(async (state) => {
        if (state.count % 2 === 0) {
          return Failure(new Error("Even count not allowed"));
        }
        return Success({ ...state, processed: true });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const states = await Promise.all([
      createTestState({ count: 1 }),
      createTestState({ count: 2 }),
      createTestState({ count: 3 }),
    ]);
    
    const results = await runtime.executeMany("conditional", states);
    
    expect(results).toHaveLength(3);
    expect(results[0]?.success).toBe(true);
    expect(results[1]?.success).toBe(false);
    expect(results[2]?.success).toBe(true);
  });

  test("should execute chained processors", async () => {
    const step1 = createProcessor<TestState>("step-1")
      .process(async (state) => Success({ ...state, count: state.count + 1 }));
    
    const step2 = createProcessor<TestState>("step-2")
      .process(async (state) => Success({ ...state, count: state.count * 2 }));
    
    const step3 = createProcessor<TestState>("step-3")
      .process(async (state) => Success({ ...state, count: state.count + 10 }));
    
    const chain = chainProcessors("math-chain", [step1, step2, step3]);
    
    runtime.register(chain);
    await runtime.start();
    
    const state = await createTestState({ count: 5 });
    const result = await runtime.execute("math-chain", state);
    
    expect(result.success).toBe(true);
    expect(result.state.count).toBe(22); // (5 + 1) * 2 + 10
  });

  test("should execute parallel processors", async () => {
    const processor1 = createProcessor<TestState>("parallel-1")
      .process(async (state) => Success({ ...state, items: [...(state.items || []), "A"] }));
    
    const processor2 = createProcessor<TestState>("parallel-2")
      .process(async (state) => Success({ ...state, items: [...(state.items || []), "B"] }));
    
    const processor3 = createProcessor<TestState>("parallel-3")
      .process(async (state) => Success({ ...state, items: [...(state.items || []), "C"] }));
    
    const parallel = parallelProcessors("parallel-group", [processor1, processor2, processor3]);
    
    runtime.register(parallel);
    await runtime.start();
    
    const state = await createTestState({ items: [] });
    const result = await runtime.execute("parallel-group", state);
    
    expect(result.success).toBe(true);
    expect(result.state.items).toHaveLength(3);
    expect(result.state.items).toContain("A");
    expect(result.state.items).toContain("B");
    expect(result.state.items).toContain("C");
  });

  test("should execute batch processor", async () => {
    const sumProcessor = createProcessor<TestState>("sum")
      .process(async (state) => Success({ ...state, total: (state.total || 0) + state.count }));
    
    const batchSum = batchProcessor("batch-sum", sumProcessor);
    
    runtime.register(batchSum);
    await runtime.start();
    
    const states = await Promise.all([
      createTestState({ count: 10, total: 0 }),
      createTestState({ count: 20, total: 0 }),
      createTestState({ count: 30, total: 0 }),
    ]);
    
    const state = await createTestState({ items: states as any });
    const result = await runtime.execute("batch-sum", state);
    
    expect(result.success).toBe(true);
    const processedStates = result.state.items as TestState[];
    expect(processedStates[0]?.total).toBe(10);
    expect(processedStates[1]?.total).toBe(20);
    expect(processedStates[2]?.total).toBe(30);
  });

  test("should handle nested processor calls via context", async () => {
    const childProcessor = createProcessor<TestState>("child")
      .process(async (state) => Success({ ...state, count: state.count * 2 }));
    
    const parentProcessor = createProcessor<TestState>("parent")
      .process(async (state, ctx) => {
        const childResult = await ctx.call("child", state);
        if (!childResult.success) {
          return childResult;
        }
        return Success({ ...childResult.state, count: childResult.state.count + 10 });
      });
    
    runtime.register(childProcessor);
    runtime.register(parentProcessor);
    await runtime.start();
    
    const state = await createTestState({ count: 5 });
    const result = await runtime.execute("parent", state);
    
    expect(result.success).toBe(true);
    expect(result.state.count).toBe(20); // (5 * 2) + 10
  });

  test("should respect processor timeout", async () => {
    const slowProcessor = createProcessor<TestState>("slow")
      .withTimeout(100)
      .process(async (state) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return Success(state);
      });
    
    runtime.register(slowProcessor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("slow", state);
    
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("timeout");
  });

  test("should track job statistics correctly", async () => {
    const processor = createTestProcessor("stats-test");
    runtime.register(processor);
    await runtime.start();
    
    const initialStats = await runtime.getStats();
    const initialCompleted = initialStats.completedJobs;
    
    const states = await Promise.all([
      createTestState({ count: 1 }),
      createTestState({ count: 2 }),
      createTestState({ count: 3 }),
    ]);
    
    await runtime.executeMany("stats-test", states);
    
    await waitForCondition(async () => {
      const stats = await runtime.getStats();
      return stats.completedJobs >= initialCompleted + 3;
    });
    
    const finalStats = await runtime.getStats();
    expect(finalStats.completedJobs).toBeGreaterThanOrEqual(initialCompleted + 3);
  });

  test("should handle concurrent executions", async () => {
    const processor = createDelayProcessor("concurrent", 50);
    runtime.register(processor);
    await runtime.start();
    
    const concurrentCount = 10;
    const states = await Promise.all(
      Array.from({ length: concurrentCount }, (_, i) => 
        createTestState({ count: i })
      )
    );
    
    const startTime = Date.now();
    const results = await Promise.all(
      states.map(state => runtime.execute("concurrent", state))
    );
    const duration = Date.now() - startTime;
    
    expect(results).toHaveLength(concurrentCount);
    expect(results.every(r => r.success)).toBe(true);
    
    expect(duration).toBeLessThan(concurrentCount * 50);
  });
});