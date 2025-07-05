import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  setupTestRuntime,
  cleanupTestRuntime,
  createTestProcessor,
  createCounterProcessor,
  type TestState,
} from "./test-helpers";
import { type QueueRuntime } from "../../lib/node/queue-runtime";
import { createProcessor } from "../../lib/core/processor";
import { Success } from "../../lib/core/result";

describe("Processor Registration and Synchronization", () => {
  let runtime: QueueRuntime<TestState>;

  beforeEach(async () => {
    runtime = await setupTestRuntime();
  });

  afterEach(async () => {
    await cleanupTestRuntime(runtime);
  });

  test("should register a single processor", () => {
    const processor = createTestProcessor("test-processor");

    runtime.register(processor);

    expect(runtime.isProcessorRegistered("test-processor")).toBe(true);
    expect(runtime.listProcessors()).toContain("test-processor");
    expect(runtime.getRegisteredProcessorNames()).toContain("test-processor");
  });

  test("should register multiple processors", () => {
    const processor1 = createTestProcessor("processor-1");
    const processor2 = createTestProcessor("processor-2");
    const processor3 = createTestProcessor("processor-3");

    runtime.register(processor1);
    runtime.register(processor2);
    runtime.register(processor3);

    const processors = runtime.listProcessors();
    expect(processors).toHaveLength(3);
    expect(processors).toContain("processor-1");
    expect(processors).toContain("processor-2");
    expect(processors).toContain("processor-3");
  });

  test("should register many processors at once", () => {
    const processors = [
      createTestProcessor("processor-1"),
      createTestProcessor("processor-2"),
      createTestProcessor("processor-3"),
    ];

    runtime.registerMany(processors);

    expect(runtime.listProcessors()).toHaveLength(3);
  });

  test("should override processor on re-registration", () => {
    const processor1 = createProcessor<TestState>("test")
      .withDescription("Original")
      .process(async (state) => Success({ ...state, message: "original" }));

    const processor2 = createProcessor<TestState>("test")
      .withDescription("Updated")
      .process(async (state) => Success({ ...state, message: "updated" }));

    runtime.register(processor1);
    expect(runtime.getProcessors()[0]?.config.description).toBe("Original");

    runtime.register(processor2);
    expect(runtime.getProcessors()[0]?.config.description).toBe("Updated");
  });

  test("should unregister processor", async () => {
    const processor = createTestProcessor("test-processor");

    runtime.register(processor);
    expect(runtime.isProcessorRegistered("test-processor")).toBe(true);

    runtime.unregister("test-processor");
    expect(runtime.isProcessorRegistered("test-processor")).toBe(false);
    expect(runtime.listProcessors()).not.toContain("test-processor");
  });

  test("should handle unregister of non-existent processor", () => {
    expect(() => runtime.unregister("non-existent")).not.toThrow();
  });

  test("should sync processors on start", async () => {
    const processor1 = createTestProcessor("processor-1");
    const processor2 = createTestProcessor("processor-2");

    runtime.register(processor1);
    runtime.register(processor2);

    await runtime.start();

    const queues = runtime.getQueues();
    expect(queues).toHaveLength(2);

    const queueNames = queues.map((q) => q.name);
    expect(queueNames).toContain("am2z_processor-1");
    expect(queueNames).toContain("am2z_processor-2");
  });

  test("should sync processors manually", async () => {
    const processor = createTestProcessor("test-processor");
    runtime.register(processor);

    await runtime.syncProcessors();

    const queues = runtime.getQueues();
    expect(queues).toHaveLength(1);
    expect(queues[0]?.name).toBe("am2z_test-processor");
  });

  test("should handle dynamic processor registration after start", async () => {
    const processor1 = createTestProcessor("processor-1");
    runtime.register(processor1);

    await runtime.start();
    expect(runtime.listProcessors()).toHaveLength(1);

    const processor2 = createTestProcessor("processor-2");
    runtime.register(processor2);

    await runtime.syncProcessors();

    expect(runtime.listProcessors()).toHaveLength(2);
    const queues = runtime.getQueues();
    expect(queues).toHaveLength(2);
  });

  test("should not duplicate infrastructure on multiple syncs", async () => {
    const processor = createTestProcessor("test-processor");
    runtime.register(processor);

    await runtime.syncProcessors();
    const firstQueueCount = runtime.getQueues().length;

    await runtime.syncProcessors();
    const secondQueueCount = runtime.getQueues().length;

    expect(firstQueueCount).toBe(1);
    expect(secondQueueCount).toBe(1);
  });

  test("should register processor with dependencies", () => {
    const dep1 = createTestProcessor("dep-1");
    const dep2 = createTestProcessor("dep-2");

    const mainProcessor = createProcessor<TestState>("main")
      .withDescription("Main processor with deps")
      .withDependencies([dep1, dep2])
      .process(async (state) => Success(state));

    runtime.register(mainProcessor);

    expect(runtime.isProcessorRegistered("main")).toBe(true);
    expect(runtime.isProcessorRegistered("dep-1")).toBe(true);
    expect(runtime.isProcessorRegistered("dep-2")).toBe(true);
    expect(runtime.listProcessors()).toHaveLength(3);
  });

  test.skip("should handle circular dependencies gracefully", () => {
    // Skip - withDependencies method cannot be called after processor creation
    const processorA = createProcessor<TestState>("processor-a").process(
      async (state) => Success(state)
    );

    const processorB = createProcessor<TestState>("processor-b")
      .withDependencies([processorA])
      .process(async (state) => Success(state));

    processorA.withDependencies([processorB]);

    runtime.register(processorA);

    expect(runtime.listProcessors()).toContain("processor-a");
    expect(runtime.listProcessors()).toContain("processor-b");
  });

  test("should preserve processor configuration", () => {
    const processor = createProcessor<TestState>("config-test")
      .withDescription("Test processor with config")
      .withTimeout(10000)
      .withRetryPolicy({ maxAttempts: 5, backoffMs: 1000 })
      .withQueueConfig({ concurrency: 10, priority: 5 })
      .process(async (state) => Success(state));

    runtime.register(processor);

    const registered = runtime
      .getProcessors()
      .find((p) => p.name === "config-test");
    expect(registered).toBeDefined();
    expect(registered?.config.description).toBe("Test processor with config");
    expect(registered?.config.timeout).toBe(10000);
    expect(registered?.config.retryPolicy?.maxAttempts).toBe(5);
    expect(registered?.config.queueConfig?.concurrency).toBe(10);
  });

  test("should get queue stats for registered processors", async () => {
    const processor1 = createTestProcessor("processor-1");
    const processor2 = createTestProcessor("processor-2");

    runtime.register(processor1);
    runtime.register(processor2);

    await runtime.start();

    const stats = await runtime.getQueueStats();

    expect(stats).toHaveProperty("processor-1");
    expect(stats).toHaveProperty("processor-2");

    expect(stats["processor-1"]).toHaveProperty("waiting");
    expect(stats["processor-1"]).toHaveProperty("active");
    expect(stats["processor-1"]).toHaveProperty("completed");
    expect(stats["processor-1"]).toHaveProperty("failed");
  });
});
