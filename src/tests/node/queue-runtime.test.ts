import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
} from "bun:test";
import { createQueueRuntimeWithDefaults } from "../../lib/node/queue-runtime";
import {
  createTestProcessor,
  createTestState,
  testLogger,
  type TestState,
} from "../test-utils";
import { ProcessorNotFoundError } from "../../lib/core/errors";
import { createProcessor } from "../../lib/core/processor";
import { Success } from "../../lib/core/result";

describe("QueueRuntime", () => {
  let runtime: ReturnType<typeof createQueueRuntimeWithDefaults<TestState>>;

  beforeEach(async () => {
    runtime = createQueueRuntimeWithDefaults<TestState>({}, testLogger);
  });

  afterEach(async () => {
    // Clean up queues after each test
    try {
      const queues = runtime.getQueues();
      for (const queue of queues) {
        await queue.obliterate({ force: true });
      }
      await runtime.stop();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    try {
      await runtime.stop();
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it("should register and execute processor", async () => {
    const processor = createTestProcessor("test-processor", "success");
    runtime.register(processor);

    await runtime.start();

    const initialState = createTestState(0, []);
    const result = await runtime.execute("test-processor", initialState);
    expect(result.success).toBe(true);
    expect(result.state.counter).toBe(1);
    expect(result.state.messages).toContain("Processed by test-processor");
    expect(result.executionTime).toBeGreaterThan(0);
  });

  it("should handle processor not found", async () => {
    await runtime.start();

    const initialState = createTestState(0, []);
    const result = await runtime.execute("non-existent", initialState);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ProcessorNotFoundError);
  });

  it("should handle processor failure", async () => {
    const processor = createTestProcessor("failing-processor", "failure");
    runtime.register(processor);

    await runtime.start();

    // Add a small delay to ensure connections are fully established
    await new Promise((resolve) => setTimeout(resolve, 100));

    const initialState = createTestState(0, []);
    const result = await runtime.execute("failing-processor", initialState);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.state.counter).toBe(0); // State unchanged on failure
  });

  it("should support ctx.call between processors", async () => {
    const processor1 = createTestProcessor("processor-1", "success");
    const processor2 = createProcessor<TestState>("processor-2")
      .withDescription("Calls processor-1")
      .process(async (state, ctx) => {
        const result = await ctx.call("processor-1", state);
        if (!result.success) {
          throw new Error(
            `Failed to call processor-1: ${result.error?.message}`
          );
        }

        return Success({
          ...result.data,
          messages: [...(result.data.messages || []), "Called by processor-2"],
        });
      });

    runtime.register(processor1);
    runtime.register(processor2);

    await runtime.start();

    const initialState = createTestState(0, []);
    const result = await runtime.execute("processor-2", initialState);

    expect(result.success).toBe(true);
    expect(result.state.counter).toBe(1);
    expect(result.state.messages).toContain("Processed by processor-1");
    expect(result.state.messages).toContain("Called by processor-2");
  });

  it("should collect runtime statistics", async () => {
    const processor = createTestProcessor("stats-processor", "success");
    runtime.register(processor);

    await runtime.start();

    // Add a small delay to ensure uptime is measurable
    await new Promise((resolve) => setTimeout(resolve, 10));

    const stats = await runtime.getStats();

    expect(stats.registeredProcessors).toContain("stats-processor");
    expect(stats.runningJobs).toBe(0);
    expect(stats.completedJobs).toBe(0);
    expect(stats.failedJobs).toBe(0);
    expect(stats.uptime).toBeGreaterThan(0);
  });

  it("should emit events on processor execution", async () => {
    const processor = createTestProcessor("event-processor", "success");
    runtime.register(processor);

    await runtime.start();

    let completedEvent: any = null;
    runtime.on("processor:completed", (data) => {
      completedEvent = data;
    });

    const initialState = createTestState(0, []);
    await runtime.execute("event-processor", initialState);

    expect(completedEvent).toBeDefined();
    expect(completedEvent.processorName).toBe("event-processor");
    expect(completedEvent.executionTime).toBeGreaterThan(0);
  });

  it("should execute many jobs in bulk", async () => {
    const processor = createTestProcessor("bulk-processor", "success");
    runtime.register(processor);

    await runtime.start();

    const states = [
      createTestState(0, []),
      createTestState(1, []),
      createTestState(2, []),
    ];

    await runtime.executeMany("bulk-processor", states);

    // This only tests that the jobs are enqueued, not that they are executed.
    // To test execution, we would need to wait for the jobs to complete.
    const queue = runtime.getQueues()[0];
    const jobCounts = await queue!.getJobCounts();

    // Jobs might be waiting, active, or completed due to timing
    const totalJobs =
      (jobCounts.waiting || 0) +
      (jobCounts.active || 0) +
      (jobCounts.completed || 0);
    expect(totalJobs).toBeGreaterThanOrEqual(3);
  });
});
