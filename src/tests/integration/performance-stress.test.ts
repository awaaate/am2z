import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createQueueRuntimeWithDefaults } from "../../lib/node/queue-runtime";
import { LocalRuntime } from "../../lib/core/runtime";
import {
  createTestProcessor,
  createTestState,
  testLogger,
  type TestState,
} from "../test-utils";
import { createProcessor } from "../../lib/core/processor";
import { Success } from "../../lib/core/result";

// Test both runtime types
const runtimeConfigs = [
  {
    name: "LocalRuntime",
    createRuntime: () => new LocalRuntime<TestState>(testLogger),
    needsCleanup: false,
  },
  {
    name: "QueueRuntime",
    createRuntime: () =>
      createQueueRuntimeWithDefaults<TestState>({}, testLogger),
    needsCleanup: true,
  },
];

for (const config of runtimeConfigs) {
  describe(`${config.name} - Performance & Stress Tests`, () => {
    let runtime: any;

    beforeEach(async () => {
      runtime = config.createRuntime();
    });

    afterEach(async () => {
      if (config.needsCleanup && runtime?.getQueues) {
        try {
          const queues = runtime.getQueues();
          for (const queue of queues) {
            await queue.obliterate({ force: true });
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      try {
        await runtime.stop();
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    describe("High Concurrency", () => {
      it("should handle multiple concurrent executions", async () => {
        const fastProcessor = createTestProcessor("fast-concurrent", "success");
        runtime.register(fastProcessor);
        await runtime.start();

        const concurrentExecutions = 20;
        const promises = Array.from(
          { length: concurrentExecutions },
          (_, i) => {
            const state = createTestState(i, [`Request-${i}`]);
            return runtime.execute("fast-concurrent", state);
          }
        );

        const results = await Promise.all(promises);

        // All executions should succeed
        results.forEach((result, i) => {
          expect(result.success).toBe(true);
          expect(result.state.counter).toBe(i + 1);
          expect(result.state.messages).toContain(`Request-${i}`);
          expect(result.state.messages).toContain(
            "Processed by fast-concurrent"
          );
        });
      });

      it("should handle mixed success and failure scenarios", async () => {
        // Create a processor that fails for even numbers
        const conditionalProcessor = createProcessor<TestState>("conditional")
          .withDescription("Fails for even numbers")
          .process(async (state) => {
            if (state.counter % 2 === 0) {
              throw new Error(`Even number failure: ${state.counter}`);
            }
            return Success({
              ...state,
              counter: state.counter + 1,
              messages: [...(state.messages || []), "Odd number processed"],
            });
          });

        runtime.register(conditionalProcessor);
        await runtime.start();

        const promises = Array.from({ length: 10 }, (_, i) => {
          const state = createTestState(i, []);
          return runtime.execute("conditional", state);
        });

        const results = await Promise.all(promises);

        // Check that odd numbers succeeded and even numbers failed
        results.forEach((result, i) => {
          if (i % 2 === 0) {
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain(
              `Even number failure: ${i}`
            );
          } else {
            expect(result.success).toBe(true);
            expect(result.state.counter).toBe(i + 1);
            expect(result.state.messages).toContain("Odd number processed");
          }
        });
      });
    });

    describe("Large State Objects", () => {
      it("should handle large state objects efficiently", async () => {
        const largeDataProcessor = createProcessor<TestState>("large-data")
          .withDescription("Processes large data sets")
          .process(async (state) => {
            // Create a large array to test memory handling
            const largeArray = Array.from(
              { length: 1000 },
              (_, i) => `item-${i}`
            );

            return Success({
              ...state,
              counter: state.counter + largeArray.length,
              messages: [
                ...(state.messages || []),
                `Processed ${largeArray.length} items`,
              ],
            });
          });

        runtime.register(largeDataProcessor);
        await runtime.start();

        // Create initial state with large data
        const largeMessages = Array.from(
          { length: 500 },
          (_, i) => `initial-${i}`
        );
        const initialState = createTestState(0, largeMessages);

        const startTime = Date.now();
        const result = await runtime.execute("large-data", initialState);
        const executionTime = Date.now() - startTime;

        expect(result.success).toBe(true);
        expect(result.state.counter).toBe(1000);
        expect(result.state.messages).toHaveLength(502); // 500 initial + 1 processed + 1 from createTestState
        expect(executionTime).toBeLessThan(5000); // Should complete within 5 seconds
      });

      it("should handle deep nested state structures", async () => {
        interface DeepState extends TestState {
          deep: {
            level1: {
              level2: {
                level3: {
                  data: string[];
                  count: number;
                };
              };
            };
          };
        }

        const deepProcessor = createProcessor<DeepState>(
          "deep-structure"
        ).process(async (state) => {
          return Success({
            ...state,
            deep: {
              level1: {
                level2: {
                  level3: {
                    data: [
                      ...(state.deep?.level1?.level2?.level3?.data || []),
                      "new-item",
                    ],
                    count: (state.deep?.level1?.level2?.level3?.count || 0) + 1,
                  },
                },
              },
            },
            messages: [...(state.messages || []), "Deep structure processed"],
          });
        });

        runtime.register(deepProcessor);
        await runtime.start();

        const deepState: DeepState = {
          ...createTestState(0, []),
          deep: {
            level1: {
              level2: {
                level3: {
                  data: ["initial"],
                  count: 0,
                },
              },
            },
          },
        };

        const result = await runtime.execute("deep-structure", deepState);

        expect(result.success).toBe(true);
        expect(result.state.deep.level1.level2.level3.count).toBe(1);
        expect(result.state.deep.level1.level2.level3.data).toContain(
          "new-item"
        );
        expect(result.state.messages).toContain("Deep structure processed");
      });
    });

    describe("Bulk Operations", () => {
      it("should handle bulk processing efficiently", async () => {
        const bulkProcessor = createTestProcessor("bulk-worker", "success");
        runtime.register(bulkProcessor);
        await runtime.start();

        if (config.needsCleanup && runtime.executeMany) {
          // Test bulk execution for QueueRuntime
          const states = Array.from({ length: 50 }, (_, i) =>
            createTestState(i, [`bulk-${i}`])
          );

          const startTime = Date.now();
          await runtime.executeMany("bulk-worker", states);
          const executionTime = Date.now() - startTime;

          expect(executionTime).toBeLessThan(2000); // Should queue quickly

          // Wait a bit for processing
          await new Promise((resolve) => setTimeout(resolve, 1000));

          const stats = await runtime.getStats();
          expect(stats.registeredProcessors).toContain("bulk-worker");
        } else {
          // Test sequential execution for LocalRuntime
          const states = Array.from({ length: 20 }, (_, i) =>
            createTestState(i, [`bulk-${i}`])
          );

          const startTime = Date.now();
          const results = await Promise.all(
            states.map((state) => runtime.execute("bulk-worker", state))
          );
          const executionTime = Date.now() - startTime;

          expect(results).toHaveLength(20);
          results.forEach((result, i) => {
            expect(result.success).toBe(true);
            expect(result.state.counter).toBe(i + 1);
          });
          expect(executionTime).toBeLessThan(5000);
        }
      });
    });

    describe("Resource Management", () => {
      it("should handle processor registration and cleanup", async () => {
        const processors = Array.from({ length: 10 }, (_, i) =>
          createTestProcessor(`temp-processor-${i}`, "success")
        );

        // Register all processors
        processors.forEach((processor) => runtime.register(processor));
        await runtime.start();

        const stats = await runtime.getStats();
        expect(stats.registeredProcessors).toHaveLength(10);

        // Unregister half of them
        for (let i = 0; i < 5; i++) {
          runtime.unregister(`temp-processor-${i}`);
        }

        const updatedStats = await runtime.getStats();
        expect(updatedStats.registeredProcessors).toHaveLength(5);

        // Test that remaining processors still work
        const result = await runtime.execute(
          "temp-processor-5",
          createTestState(0, [])
        );
        expect(result.success).toBe(true);
      });

      it("should handle rapid start/stop cycles", async () => {
        const quickProcessor = createTestProcessor("quick", "success");
        runtime.register(quickProcessor);

        // Rapid start/stop cycles
        for (let i = 0; i < 3; i++) {
          await runtime.start();
          const result = await runtime.execute("quick", createTestState(i, []));
          expect(result.success).toBe(true);
          await runtime.stop();
        }

        // Final start for cleanup
        await runtime.start();
      });
    });

    describe("Error Resilience", () => {
      it("should recover from processor errors gracefully", async () => {
        let errorCount = 0;
        const unreliableProcessor = createProcessor<TestState>("unreliable")
          .withDescription("Sometimes fails")
          .process(async (state) => {
            errorCount++;
            if (errorCount % 3 === 0) {
              throw new Error("Intermittent failure");
            }
            return Success({
              ...state,
              counter: state.counter + 1,
              messages: [
                ...(state.messages || []),
                `Success attempt ${errorCount}`,
              ],
            });
          });

        runtime.register(unreliableProcessor);
        await runtime.start();

        const results = await Promise.all(
          Array.from({ length: 9 }, (_, i) =>
            runtime.execute("unreliable", createTestState(i, []))
          )
        );

        // Should have 6 successes and 3 failures
        const successes = results.filter((r) => r.success);
        const failures = results.filter((r) => !r.success);

        expect(successes).toHaveLength(6);
        expect(failures).toHaveLength(3);
      });

      it("should handle timeout scenarios gracefully", async () => {
        const timeoutProcessor = createProcessor<TestState>("timeout-test")
          .withTimeout(100) // Very short timeout
          .process(async (state) => {
            // Simulate long-running operation
            await new Promise((resolve) => setTimeout(resolve, 200));
            return Success(state);
          });

        runtime.register(timeoutProcessor);
        await runtime.start();

        const result = await runtime.execute(
          "timeout-test",
          createTestState(0, [])
        );

        expect(result.success).toBe(false);
        expect(result.error?.message).toMatch(/timeout|timed out/i);
      });
    });

    describe("Memory and Performance", () => {
      it("should not leak memory during repeated executions", async () => {
        const memoryProcessor = createTestProcessor("memory-test", "success");
        runtime.register(memoryProcessor);
        await runtime.start();

        // Perform many executions to test for memory leaks
        const iterations = 100;
        const startTime = Date.now();

        for (let i = 0; i < iterations; i++) {
          const result = await runtime.execute(
            "memory-test",
            createTestState(i, [])
          );
          expect(result.success).toBe(true);
        }

        const totalTime = Date.now() - startTime;
        const averageTime = totalTime / iterations;

        // Average execution time should be reasonable
        expect(averageTime).toBeLessThan(100); // Less than 100ms per execution on average
      });

      it("should maintain consistent performance over time", async () => {
        const consistentProcessor = createTestProcessor(
          "consistent",
          "success"
        );
        runtime.register(consistentProcessor);
        await runtime.start();

        const iterations = 50;
        const executionTimes: number[] = [];

        for (let i = 0; i < iterations; i++) {
          const startTime = Date.now();
          const result = await runtime.execute(
            "consistent",
            createTestState(i, [])
          );
          const executionTime = Date.now() - startTime;

          expect(result.success).toBe(true);
          executionTimes.push(executionTime);
        }

        // Calculate performance consistency
        const avgTime = executionTimes.reduce((a, b) => a + b, 0) / iterations;
        const variance =
          executionTimes.reduce(
            (sum, time) => sum + Math.pow(time - avgTime, 2),
            0
          ) / iterations;
        const standardDeviation = Math.sqrt(variance);

        // Performance should be relatively consistent
        expect(standardDeviation).toBeLessThan(avgTime * 0.5); // Less than 50% of average
      });
    });

    describe("Edge Cases", () => {
      it("should handle empty state gracefully", async () => {
        const emptyStateProcessor = createProcessor<TestState>(
          "empty-state"
        ).process(async (state) => {
          return Success({
            ...state,
            counter: (state.counter || 0) + 1,
            messages: [...(state.messages || []), "Handled empty state"],
          });
        });

        runtime.register(emptyStateProcessor);
        await runtime.start();

        // Test with minimal state
        const minimalState: TestState = {
          counter: 0,
          messages: [],
          metadata: {
            version: 1,
            sessionId: "test",
            lastUpdated: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        };

        const result = await runtime.execute("empty-state", minimalState);
        expect(result.success).toBe(true);
        expect(result.state.counter).toBe(1);
        expect(result.state.messages).toContain("Handled empty state");
      });

      it("should handle very long processor names", async () => {
        const longName =
          "very-long-processor-name-that-exceeds-normal-length-expectations-and-continues-for-quite-a-while-to-test-edge-cases";
        const longNameProcessor = createTestProcessor(longName, "success");

        runtime.register(longNameProcessor);
        await runtime.start();

        const result = await runtime.execute(longName, createTestState(0, []));
        expect(result.success).toBe(true);
      });

      it("should handle Unicode in state data", async () => {
        const unicodeProcessor = createProcessor<TestState>(
          "unicode-test"
        ).process(async (state) => {
          return Success({
            ...state,
            messages: [
              ...(state.messages || []),
              "Processed: 🚀 Unicode: café, naïve, 中文, العربية",
            ],
          });
        });

        runtime.register(unicodeProcessor);
        await runtime.start();

        const unicodeState = createTestState(0, ["Initial: 🌟 测试 मैं"]);
        const result = await runtime.execute("unicode-test", unicodeState);

        expect(result.success).toBe(true);
        expect(result.state.messages).toContain("Initial: 🌟 测试 मैं");
        expect(result.state.messages).toContain(
          "Processed: 🚀 Unicode: café, naïve, 中文, العربية"
        );
      });
    });
  });
}
