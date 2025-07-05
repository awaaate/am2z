import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { 
  setupTestRuntime, 
  cleanupTestRuntime, 
  createTestProcessor,
  createTestState,
  TestEventCollector,
  waitForCondition,
  type TestState 
} from "./test-helpers";
import { type QueueRuntime } from "../../lib/node/queue-runtime";
import { createProcessor } from "../../lib/core/processor";
import { Success, Failure } from "../../lib/core/result";

describe("Event System", () => {
  let runtime: QueueRuntime<TestState>;
  let eventCollector: TestEventCollector;

  beforeEach(async () => {
    runtime = await setupTestRuntime();
    eventCollector = new TestEventCollector(runtime);
  });

  afterEach(async () => {
    await cleanupTestRuntime(runtime);
  });

  test("should emit processor lifecycle events", async () => {
    const processor = createTestProcessor("event-test");
    runtime.register(processor);
    
    eventCollector.start([
      "processor:active",
      "processor:job:completed",
      "processor:job:failed"
    ]);
    
    await runtime.start();
    
    const state = await createTestState();
    await runtime.execute("event-test", state);
    
    await waitForCondition(() => 
      eventCollector.getEvents("processor:job:completed").length > 0
    );
    
    const activeEvents = eventCollector.getEvents("processor:active");
    const completedEvents = eventCollector.getEvents("processor:job:completed");
    
    expect(activeEvents.length).toBeGreaterThan(0);
    expect(completedEvents.length).toBe(1);
    expect(completedEvents[0]?.data.processorName).toBe("event-test");
  });

  test("should emit job progress events", async () => {
    const processor = createProcessor<TestState>("progress-test")
      .process(async (state, ctx) => {
        await ctx.updateProgress(25);
        await new Promise(resolve => setTimeout(resolve, 50));
        await ctx.updateProgress(50);
        await new Promise(resolve => setTimeout(resolve, 50));
        await ctx.updateProgress(75);
        await new Promise(resolve => setTimeout(resolve, 50));
        await ctx.updateProgress(100);
        return Success(state);
      });
    
    runtime.register(processor);
    eventCollector.start(["job:progress"]);
    
    await runtime.start();
    
    const state = await createTestState();
    await runtime.execute("progress-test", state);
    
    const progressEvents = eventCollector.getEvents("job:progress");
    expect(progressEvents.length).toBe(4);
    expect(progressEvents.map(e => e.data.progress)).toEqual([25, 50, 75, 100]);
  });

  test("should emit queue events", async () => {
    const processor = createTestProcessor("queue-events");
    runtime.register(processor);
    
    eventCollector.start([
      "queue:completed",
      "queue:failed"
    ]);
    
    await runtime.start();
    
    const state = await createTestState();
    await runtime.execute("queue-events", state);
    
    await waitForCondition(() => 
      eventCollector.getEvents("queue:completed").length > 0
    );
    
    const queueEvents = eventCollector.getEvents("queue:completed");
    expect(queueEvents.length).toBe(1);
    expect(queueEvents[0]?.data.processorName).toBe("queue-events");
  });

  test("should emit failure events", async () => {
    const processor = createProcessor<TestState>("fail-test")
      .process(async () => Failure(new Error("Test failure")));
    
    runtime.register(processor);
    eventCollector.start([
      "processor:job:failed",
      "queue:failed"
    ]);
    
    await runtime.start();
    
    const state = await createTestState();
    await runtime.execute("fail-test", state);
    
    await waitForCondition(() => 
      eventCollector.getEvents("processor:job:failed").length > 0
    );
    
    const failedEvents = eventCollector.getEvents("processor:job:failed");
    expect(failedEvents.length).toBeGreaterThan(0);
    expect(failedEvents[0]?.data.error.message).toContain("Test failure");
  });

  test("should emit metrics collection events", async () => {
    const config = {
      queuePrefix: "am2z",
      redis: { host: "localhost", port: 6379 },
      monitoring: {
        enableMetrics: true,
        metricsInterval: 100
      }
    };
    
    const metricsRuntime = await setupTestRuntime();
    const metricsCollector = new TestEventCollector(metricsRuntime);
    
    metricsCollector.start(["metrics:collected"]);
    
    const processor = createTestProcessor("metrics-test");
    metricsRuntime.register(processor);
    await metricsRuntime.start();
    
    await waitForCondition(() => 
      metricsCollector.getEvents("metrics:collected").length > 0,
      2000
    );
    
    const metricsEvents = metricsCollector.getEvents("metrics:collected");
    expect(metricsEvents.length).toBeGreaterThan(0);
    
    const metrics = metricsEvents[0]?.data;
    expect(metrics).toHaveProperty("registeredProcessors");
    expect(metrics).toHaveProperty("runningJobs");
    expect(metrics).toHaveProperty("completedJobs");
    expect(metrics).toHaveProperty("uptime");
    
    await cleanupTestRuntime(metricsRuntime);
  });

  test("should handle multiple event listeners", async () => {
    const processor = createTestProcessor("multi-listener");
    runtime.register(processor);
    
    const listener1Results: any[] = [];
    const listener2Results: any[] = [];
    
    runtime.on("processor:job:completed", (data) => {
      listener1Results.push(data);
    });
    
    runtime.on("processor:job:completed", (data) => {
      listener2Results.push(data);
    });
    
    await runtime.start();
    
    const state = await createTestState();
    await runtime.execute("multi-listener", state);
    
    await waitForCondition(() => 
      listener1Results.length > 0 && listener2Results.length > 0
    );
    
    expect(listener1Results).toHaveLength(1);
    expect(listener2Results).toHaveLength(1);
    expect(listener1Results[0]).toEqual(listener2Results[0]);
  });

  test("should remove event listeners", async () => {
    const processor = createTestProcessor("remove-listener");
    runtime.register(processor);
    
    const results: any[] = [];
    const handler = (data: any) => {
      results.push(data);
    };
    
    runtime.on("processor:job:completed", handler);
    
    await runtime.start();
    
    const state = await createTestState();
    await runtime.execute("remove-listener", state);
    
    await waitForCondition(() => results.length > 0);
    expect(results).toHaveLength(1);
    
    runtime.off("processor:job:completed", handler);
    
    await runtime.execute("remove-listener", state);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    expect(results).toHaveLength(1);
  });

  test("should emit custom events from processors", async () => {
    const processor = createProcessor<TestState>("custom-events")
      .process(async (state, ctx) => {
        ctx.emit("custom:started", { timestamp: Date.now() });
        await new Promise(resolve => setTimeout(resolve, 50));
        ctx.emit("custom:progress", { step: 1 });
        await new Promise(resolve => setTimeout(resolve, 50));
        ctx.emit("custom:progress", { step: 2 });
        ctx.emit("custom:completed", { finalState: state });
        return Success(state);
      });
    
    runtime.register(processor);
    eventCollector.start([
      "custom:started",
      "custom:progress",
      "custom:completed"
    ]);
    
    await runtime.start();
    
    const state = await createTestState({ count: 42 });
    await runtime.execute("custom-events", state);
    
    const startedEvents = eventCollector.getEvents("custom:started");
    const progressEvents = eventCollector.getEvents("custom:progress");
    const completedEvents = eventCollector.getEvents("custom:completed");
    
    expect(startedEvents).toHaveLength(1);
    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[0]?.data.step).toBe(1);
    expect(progressEvents[1]?.data.step).toBe(2);
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]?.data.finalState.count).toBe(42);
  });

  test("should handle event handler errors gracefully", async () => {
    const processor = createTestProcessor("error-handler");
    runtime.register(processor);
    
    const goodResults: any[] = [];
    const errorHandler = () => {
      throw new Error("Handler error");
    };
    const goodHandler = (data: any) => {
      goodResults.push(data);
    };
    
    runtime.on("processor:job:completed", errorHandler);
    runtime.on("processor:job:completed", goodHandler);
    
    await runtime.start();
    
    const state = await createTestState();
    await runtime.execute("error-handler", state);
    
    await waitForCondition(() => goodResults.length > 0);
    
    expect(goodResults).toHaveLength(1);
  });

  test("should emit session-specific events", async () => {
    const processor = createTestProcessor("session-events");
    runtime.register(processor);
    
    eventCollector.start([
      "queue:completed",
      "processor:job:completed"
    ]);
    
    await runtime.start();
    
    const session1 = "session-1";
    const session2 = "session-2";
    
    const state1 = await createTestState({ count: 1 });
    const state2 = await createTestState({ count: 2 });
    
    await runtime.executeInSession("session-events", state1, session1);
    await runtime.executeInSession("session-events", state2, session2);
    
    await waitForCondition(() => 
      eventCollector.getEvents("processor:job:completed").length >= 2
    );
    
    const events = eventCollector.getEvents("processor:job:completed");
    const sessions = events.map(e => e.data.result?.metadata?.sessionId);
    
    expect(sessions).toContain(session1);
    expect(sessions).toContain(session2);
  });

  test("should wait for specific events", async () => {
    const processor = createProcessor<TestState>("wait-event")
      .process(async (state, ctx) => {
        setTimeout(() => {
          ctx.emit("delayed:event", { message: "Hello from processor" });
        }, 100);
        return Success(state);
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const executePromise = runtime.execute("wait-event", state);
    
    const eventPromise = eventCollector.waitForEvent("delayed:event");
    
    const [result, eventData] = await Promise.all([executePromise, eventPromise]);
    
    expect(result.success).toBe(true);
    expect(eventData.message).toBe("Hello from processor");
  });
});