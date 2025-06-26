// src/test/core/runtime.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LocalRuntime, DEFAULT_RUNTIME_CONFIG } from "../../lib/core/runtime";
import {
  createTestProcessor,
  createTestState,
  createCallDepthTestProcessor,
  createTestRuntimeConfig,
  testLogger,
  waitFor,
  type TestState,
} from "../test-utils";
import { ProcessorNotFoundError } from "../../lib/core/errors";

describe("LocalRuntime", () => {
  let runtime: LocalRuntime<TestState>;

  beforeEach(() => {
    runtime = new LocalRuntime<TestState>(DEFAULT_RUNTIME_CONFIG, testLogger);
  });

  afterEach(async () => {
    await runtime.stop();
  });

  describe("Basic Functionality", () => {
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

    it("should handle processor failure gracefully", async () => {
      const processor = createTestProcessor("failing-processor", "failure");
      runtime.register(processor);

      await runtime.start();

      const initialState = createTestState(0, []);
      const result = await runtime.execute("failing-processor", initialState);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain(
        "Test failure in failing-processor"
      );
      expect(result.state.counter).toBe(0); // State unchanged on failure
    });
  });

  describe("Runtime Configuration", () => {
    it("should use custom runtime configuration", async () => {
      const customConfig = createTestRuntimeConfig({
        maxCallDepth: 3,
        defaultTimeout: 2000,
      });

      const customRuntime = new LocalRuntime<TestState>(
        customConfig,
        testLogger
      );

      try {
        const processor = createCallDepthTestProcessor("recursive-test", 5);
        customRuntime.register(processor);
        await customRuntime.start();

        const initialState = createTestState(0, []);
        const result = await customRuntime.execute(
          "recursive-test",
          initialState
        );

        // Should fail due to call depth limit
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("Maximum call depth exceeded");
      } finally {
        await customRuntime.stop();
      }
    });

    it("should respect call depth limits", async () => {
      const config = createTestRuntimeConfig({ maxCallDepth: 2 });
      const depthRuntime = new LocalRuntime<TestState>(config, testLogger);

      try {
        const processor = createCallDepthTestProcessor("depth-test", 5);
        depthRuntime.register(processor);
        await depthRuntime.start();

        const initialState = createTestState(0, []);
        const result = await depthRuntime.execute("depth-test", initialState);

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("Maximum call depth exceeded");
      } finally {
        await depthRuntime.stop();
      }
    });
  });

  describe("Timeout Handling", () => {
    it("should handle processor timeout", async () => {
      const processor = createTestProcessor("timeout-test", "timeout");
      runtime.register(processor);
      await runtime.start();

      const initialState = createTestState(0, []);
      const result = await runtime.execute("timeout-test", initialState);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timed out");
    });

    it("should execute processor within timeout limits", async () => {
      const processor = createTestProcessor("fast-processor", "success", {
        timeout: 1000,
        delay: 10,
      });
      runtime.register(processor);
      await runtime.start();

      const initialState = createTestState(0, []);
      const result = await runtime.execute("fast-processor", initialState);

      expect(result.success).toBe(true);
      expect(result.executionTime).toBeLessThan(1000);
    });
  });

  describe("Event System", () => {
    it("should emit processor completion events", async () => {
      const processor = createTestProcessor("event-test", "success");
      runtime.register(processor);

      let completionEvent: any = null;
      runtime.on("processor:completed", (data) => {
        completionEvent = data;
      });

      await runtime.start();

      const initialState = createTestState(0, []);
      await runtime.execute("event-test", initialState);

      await waitFor(() => completionEvent !== null);
      expect(completionEvent).toBeDefined();
      expect(completionEvent.processorName).toBe("event-test");
    });

    it("should emit processor failure events", async () => {
      const processor = createTestProcessor("fail-event-test", "failure");
      runtime.register(processor);

      let failureEvent: any = null;
      runtime.on("processor:failed", (data) => {
        failureEvent = data;
      });

      await runtime.start();

      const initialState = createTestState(0, []);
      await runtime.execute("fail-event-test", initialState);

      await waitFor(() => failureEvent !== null);
      expect(failureEvent).toBeDefined();
      expect(failureEvent.processorName).toBe("fail-event-test");
      expect(failureEvent.error).toBeDefined();
    });
  });

  describe("Stats and Monitoring", () => {
    it("should track runtime statistics", async () => {
      const processor1 = createTestProcessor("stats-test-1", "success");
      const processor2 = createTestProcessor("stats-test-2", "failure");

      runtime.register(processor1);
      runtime.register(processor2);
      await runtime.start();

      const initialState = createTestState(0, []);

      // Execute successful processor
      await runtime.execute("stats-test-1", initialState);

      // Execute failing processor
      await runtime.execute("stats-test-2", initialState);

      const stats = await runtime.getStats();
      expect(stats.registeredProcessors).toContain("stats-test-1");
      expect(stats.registeredProcessors).toContain("stats-test-2");
      expect(stats.completedJobs).toBe(1);
      expect(stats.failedJobs).toBe(1);
      expect(stats.runningJobs).toBe(0);
      expect(stats.uptime).toBeGreaterThan(0);
    });
  });

  describe("Memory Management", () => {
    it("should clean up event handlers on stop", async () => {
      const processor = createTestProcessor("cleanup-test", "success");
      runtime.register(processor);

      let eventCount = 0;
      const handler = () => eventCount++;
      runtime.on("processor:completed", handler);

      await runtime.start();
      const initialState = createTestState(0, []);
      await runtime.execute("cleanup-test", initialState);

      await waitFor(() => eventCount > 0);
      expect(eventCount).toBe(1);

      // Stop runtime (should clean up handlers)
      await runtime.stop();

      // Create new runtime and execute - old handler shouldn't be called
      const newRuntime = new LocalRuntime<TestState>(
        DEFAULT_RUNTIME_CONFIG,
        testLogger
      );
      try {
        newRuntime.register(processor);
        await newRuntime.start();
        await newRuntime.execute("cleanup-test", initialState);

        // Should still be 1, not 2
        expect(eventCount).toBe(1);
      } finally {
        await newRuntime.stop();
      }
    });
  });
});
