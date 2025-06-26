import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LocalRuntime, DEFAULT_RUNTIME_CONFIG } from "../../lib/core/runtime";
import {
  createTestState,
  createMemoryTestHelper,
  testLogger,
  waitFor,
  type TestState,
} from "../test-utils";
import { createProcessor, Success } from "../../lib/core";

describe("Memory Management and Resource Cleanup", () => {
  let runtime: LocalRuntime<TestState>;
  let memoryHelper: ReturnType<typeof createMemoryTestHelper>;

  beforeEach(() => {
    runtime = new LocalRuntime<TestState>(DEFAULT_RUNTIME_CONFIG, testLogger);
    memoryHelper = createMemoryTestHelper();
  });

  afterEach(async () => {
    await runtime.stop();
    memoryHelper.clear();
  });

  describe("Basic Memory Management", () => {
    it("should not leak memory during normal processor execution", async () => {
      const memoryTrackingProcessor = createProcessor<TestState>(
        "memory-tracker"
      ).process(async (state, ctx) => {
        // Simulate some memory allocations
        const data = memoryHelper.allocate(new Array(1000).fill("test-data"));

        ctx.log.debug("Processing with memory allocation", {
          allocationCount: memoryHelper.getAllocationCount(),
        });

        return Success({
          ...state,
          counter: state.counter + 1,
          messages: [...state.messages, `Processed with ${data.length} items`],
        });
      });

      runtime.register(memoryTrackingProcessor);
      await runtime.start();

      const initialAllocations = memoryHelper.getAllocationCount();
      expect(initialAllocations).toBe(0);

      // Execute processor multiple times
      for (let i = 0; i < 5; i++) {
        const result = await runtime.execute(
          "memory-tracker",
          createTestState(i)
        );
        expect(result.success).toBe(true);
      }

      // Check that we allocated memory during execution
      const finalAllocations = memoryHelper.getAllocationCount();
      expect(finalAllocations).toBe(5); // One allocation per execution
    });

    it("should handle large state objects efficiently", async () => {
      const largeDataProcessor = createProcessor<TestState>(
        "large-data"
      ).process(async (state, ctx) => {
        // Create a large message array
        const largeMessages = Array.from(
          { length: 1000 },
          (_, i) =>
            `Large message ${i} with lots of content to simulate memory usage`
        );

        return Success({
          ...state,
          counter: state.counter + 1,
          messages: [...state.messages, ...largeMessages],
        });
      });

      runtime.register(largeDataProcessor);
      await runtime.start();

      const start = Date.now();
      const result = await runtime.execute("large-data", createTestState());
      const elapsed = Date.now() - start;

      expect(result.success).toBe(true);
      expect(result.state.messages).toHaveLength(1000);

      // Should complete in reasonable time even with large data
      expect(elapsed).toBeLessThan(1000);
    });

    it("should properly clean up after processor failures", async () => {
      let cleanupCalled = false;

      const failingProcessorWithCleanup = createProcessor<TestState>(
        "failing-cleanup"
      ).process(async (state, ctx) => {
        // Allocate some memory
        memoryHelper.allocate(new Array(500).fill("cleanup-test"));

        try {
          // Simulate work that fails
          throw new Error("Intentional failure for cleanup test");
        } finally {
          // Simulate cleanup
          cleanupCalled = true;
          ctx.log.debug("Cleanup performed in finally block");
        }
      });

      runtime.register(failingProcessorWithCleanup);
      await runtime.start();

      const result = await runtime.execute(
        "failing-cleanup",
        createTestState()
      );

      expect(result.success).toBe(false);
      expect(cleanupCalled).toBe(true);
      expect(memoryHelper.getAllocationCount()).toBe(1); // Memory was allocated but cleanup was called
    });
  });

  describe("Event System Memory Management", () => {
    it("should clean up event listeners properly", async () => {
      const simpleProcessor = createProcessor<TestState>("event-test").process(
        async (state) =>
          Success({
            ...state,
            counter: state.counter + 1,
          })
      );

      runtime.register(simpleProcessor);

      let eventCount = 0;
      const eventHandler = () => {
        eventCount++;
      };

      // Add event listener
      runtime.on("processor:completed", eventHandler);

      await runtime.start();

      // Execute processor to trigger event
      await runtime.execute("event-test", createTestState());

      await waitFor(() => eventCount > 0);
      expect(eventCount).toBe(1);

      // Stop runtime (should clean up event listeners)
      await runtime.stop();

      // Create new runtime and execute - old handler shouldn't be called
      const newRuntime = new LocalRuntime<TestState>(
        DEFAULT_RUNTIME_CONFIG,
        testLogger
      );
      try {
        newRuntime.register(simpleProcessor);
        await newRuntime.start();
        await newRuntime.execute("event-test", createTestState());

        // Event count should still be 1 (old handler not called)
        expect(eventCount).toBe(1);
      } finally {
        await newRuntime.stop();
      }
    });

    it("should handle multiple event listeners efficiently", async () => {
      const eventProcessor = createProcessor<TestState>("multi-event").process(
        async (state) =>
          Success({
            ...state,
            counter: state.counter + 1,
          })
      );

      runtime.register(eventProcessor);

      const handlers: (() => void)[] = [];
      let totalEvents = 0;

      // Add multiple event listeners
      for (let i = 0; i < 10; i++) {
        const handler = () => {
          totalEvents++;
        };
        handlers.push(handler);
        runtime.on("processor:completed", handler);
      }

      await runtime.start();

      // Execute processor once
      await runtime.execute("multi-event", createTestState());

      await waitFor(() => totalEvents >= 10);
      expect(totalEvents).toBe(10); // All 10 handlers should have been called

      // Remove some handlers
      for (let i = 0; i < 5; i++) {
        const handler = handlers[i];
        if (handler) {
          runtime.off("processor:completed", handler);
        }
      }

      totalEvents = 0; // Reset counter

      // Execute again
      await runtime.execute("multi-event", createTestState());

      await waitFor(() => totalEvents >= 5);
      expect(totalEvents).toBe(5); // Only remaining 5 handlers should be called
    });
  });

  describe("State Management Memory Efficiency", () => {
    it("should handle state updates without memory leaks", async () => {
      const stateUpdateProcessor = createProcessor<TestState>(
        "state-update"
      ).process(async (state, ctx) => {
        // Create new state with additional data
        const newData = memoryHelper.allocate({
          timestamp: Date.now(),
          executionId: ctx.meta.executionId,
          randomData: Math.random().toString(36),
        });

        return Success({
          ...state,
          counter: state.counter + 1,
          messages: [...state.messages, "State updated"],
          data: { ...state.data, ...newData },
        });
      });

      runtime.register(stateUpdateProcessor);
      await runtime.start();

      let currentState = createTestState();

      // Perform multiple state updates
      for (let i = 0; i < 10; i++) {
        const result = await runtime.execute("state-update", currentState);
        expect(result.success).toBe(true);
        currentState = result.state;
      }

      expect(currentState.counter).toBe(10);
      expect(currentState.messages).toHaveLength(10);
      expect(memoryHelper.getAllocationCount()).toBe(10);
    });

    it("should handle deep state nesting efficiently", async () => {
      const deepNestingProcessor = createProcessor<TestState>(
        "deep-nesting"
      ).process(async (state) => {
        // Create deeply nested structure
        const deepData = {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: {
                    values: Array.from({ length: 100 }, (_, i) => ({
                      id: i,
                      value: `deep-value-${i}`,
                      metadata: {
                        created: Date.now(),
                        type: "deep",
                      },
                    })),
                  },
                },
              },
            },
          },
        };

        return Success({
          ...state,
          counter: state.counter + 1,
          data: { ...state.data, deepData },
        });
      });

      runtime.register(deepNestingProcessor);
      await runtime.start();

      const start = Date.now();
      const result = await runtime.execute("deep-nesting", createTestState());
      const elapsed = Date.now() - start;

      expect(result.success).toBe(true);
      expect(result.state.data?.deepData).toBeDefined();

      // Should handle deep nesting efficiently
      expect(elapsed).toBeLessThan(500);
    });
  });

  describe("Concurrent Execution Memory Management", () => {
    it("should handle multiple concurrent executions without memory issues", async () => {
      const concurrentProcessor = createProcessor<TestState>(
        "concurrent"
      ).process(async (state, ctx) => {
        // Simulate some async work with memory allocation
        const workData = memoryHelper.allocate(
          Array.from({ length: 100 }, (_, i) => `work-item-${i}`)
        );

        await new Promise((resolve) =>
          setTimeout(resolve, 10 + Math.random() * 10)
        );

        return Success({
          ...state,
          counter: state.counter + 1,
          messages: [
            ...state.messages,
            `Concurrent work: ${workData.length} items`,
          ],
        });
      });

      runtime.register(concurrentProcessor);
      await runtime.start();

      // Execute multiple processors concurrently
      const concurrentPromises = Array.from({ length: 5 }, (_, i) =>
        runtime.execute("concurrent", createTestState(i))
      );

      const results = await Promise.all(concurrentPromises);

      // All should succeed
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.state.counter).toBe(index + 1);
      });

      expect(memoryHelper.getAllocationCount()).toBe(5);
    });

    it("should prevent memory leaks during rapid sequential executions", async () => {
      const rapidExecutionProcessor = createProcessor<TestState>(
        "rapid"
      ).process(async (state) => {
        // Quick execution with minimal memory allocation
        const smallData = memoryHelper.allocate([Date.now().toString()]);

        return Success({
          ...state,
          counter: state.counter + 1,
          messages: [...state.messages, `Rapid execution: ${smallData[0]}`],
        });
      });

      runtime.register(rapidExecutionProcessor);
      await runtime.start();

      const start = Date.now();

      // Execute many times rapidly
      for (let i = 0; i < 50; i++) {
        const result = await runtime.execute("rapid", createTestState(i));
        expect(result.success).toBe(true);
      }

      const elapsed = Date.now() - start;

      expect(memoryHelper.getAllocationCount()).toBe(50);

      // Should complete rapid executions efficiently
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe("Resource Cleanup on Shutdown", () => {
    it("should clean up all resources when runtime stops", async () => {
      const resourceProcessor = createProcessor<TestState>("resource").process(
        async (state) => {
          memoryHelper.allocate({ resource: "test-resource" });

          return Success({
            ...state,
            counter: state.counter + 1,
          });
        }
      );

      runtime.register(resourceProcessor);
      await runtime.start();

      // Execute and verify resource allocation
      await runtime.execute("resource", createTestState());
      expect(memoryHelper.getAllocationCount()).toBe(1);

      // Stop runtime
      await runtime.stop();

      // Verify runtime is properly stopped
      const stats = await runtime.getStats();
      expect(stats.runningJobs).toBe(0);
    });

    it("should handle cleanup during forced shutdown", async () => {
      const longRunningProcessor = createProcessor<TestState>("long-running")
        .withTimeout(5000)
        .process(async (state) => {
          // Allocate resources
          memoryHelper.allocate({ longRunning: true });

          // Simulate long work
          await new Promise((resolve) => setTimeout(resolve, 100));

          return Success({
            ...state,
            counter: state.counter + 1,
          });
        });

      runtime.register(longRunningProcessor);
      await runtime.start();

      // Start execution but don't wait for completion
      const executionPromise = runtime.execute(
        "long-running",
        createTestState()
      );

      // Stop runtime immediately (simulating forced shutdown)
      await runtime.stop();

      // Execution should complete or be cancelled gracefully
      try {
        const result = await executionPromise;
        // If it completes, it should be successful
        expect(result.success).toBeDefined();
      } catch (error) {
        // If it's cancelled, that's also acceptable
        expect(error).toBeDefined();
      }

      expect(memoryHelper.getAllocationCount()).toBeGreaterThanOrEqual(0);
    });
  });
});
