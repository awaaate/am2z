import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createQueueRuntimeWithDefaults } from "../../lib/node/queue-runtime";
import { DEFAULT_RUNTIME_CONFIG, LocalRuntime } from "../../lib/core/runtime";
import {
  createTestProcessor,
  createTestState,
  testLogger,
  type TestState,
} from "../test-utils";
import {
  createProcessor,
  chainProcessors,
  parallelProcessors,
  routeProcessor,
} from "../../lib/core/processor";
import { Success } from "../../lib/core/result";

// Test both runtime types
const runtimeConfigs = [
  {
    name: "LocalRuntime",
    createRuntime: () =>
      new LocalRuntime<TestState>(DEFAULT_RUNTIME_CONFIG, testLogger),
    needsCleanup: false,
  },
  {
    name: "QueueRuntime",
    createRuntime: () =>
      createQueueRuntimeWithDefaults<TestState>(
        {
          host: "localhost",
          port: 6379,
        },
        {
          maxCallDepth: 10,
          defaultTimeout: 30000,
          staleExecutionTimeout: 5 * 60 * 1000, // 5 minutes
          autoCleanupInterval: 2 * 60 * 1000, // 2 minutes
        },
        testLogger
      ),
    needsCleanup: true,
  },
];

for (const config of runtimeConfigs) {
  describe(`${config.name} - Processor Composition`, () => {
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

    describe("Sequential Chaining", () => {
      it("should chain processors sequentially", async () => {
        const processor1 = createTestProcessor("step-1", "success");
        const processor2 = createTestProcessor("step-2", "success");
        const processor3 = createTestProcessor("step-3", "success");

        const chainedProcessor = chainProcessors({
          name: "sequential-chain",
          processors: [processor1, processor2, processor3],
        });
        console.log("chainedProcessor", chainedProcessor);
        runtime.register(chainedProcessor);
        await runtime.start();

        const initialState = createTestState(0, []);
        const result = await runtime.execute("sequential-chain", initialState);

        expect(result.success).toBe(true);
        expect(result.state.counter).toBe(3);
        expect(result.state.messages).toContain("Processed by step-1");
        expect(result.state.messages).toContain("Processed by step-2");
        expect(result.state.messages).toContain("Processed by step-3");
        // Messages should be in order
        const step1Index = result.state.messages.indexOf("Processed by step-1");
        const step2Index = result.state.messages.indexOf("Processed by step-2");
        const step3Index = result.state.messages.indexOf("Processed by step-3");
        expect(step1Index).toBeLessThan(step2Index);
        expect(step2Index).toBeLessThan(step3Index);
      });

      it("should stop chain execution on failure", async () => {
        const processor1 = createTestProcessor("step-1", "success");
        const processor2 = createTestProcessor("step-2", "failure");
        const processor3 = createTestProcessor("step-3", "success");

        const chainedProcessor = chainProcessors({
          name: "failing-chain",
          processors: [processor1, processor2, processor3],
        });

        runtime.register(chainedProcessor);
        await runtime.start();

        const initialState = createTestState(0, []);
        const result = await runtime.execute("failing-chain", initialState);

        expect(result.success).toBe(false);
        expect(result.state.counter).toBe(1); // Only first processor executed
        expect(result.state.messages).toContain("Processed by step-1");
        expect(result.state.messages).not.toContain("Processed by step-2");
        expect(result.state.messages).not.toContain("Processed by step-3");
      });
    });

    describe("Parallel Execution", () => {
      it("should execute processors in parallel", async () => {
        const processor1 = createTestProcessor("parallel-1", "success");
        const processor2 = createTestProcessor("parallel-2", "success");
        const processor3 = createTestProcessor("parallel-3", "success");

        const parallelProcessor = parallelProcessors({
          name: "parallel-execution",
          processors: [processor1, processor2, processor3],
        });

        runtime.register(parallelProcessor);
        await runtime.start();

        const initialState = createTestState(10, ["initial"]);
        const result = await runtime.execute(
          "parallel-execution",
          initialState
        );

        expect(result.success).toBe(true);
        // Each processor should increment counter by 1, but parallel execution
        // means they all start with the same initial state
        expect(result.state.counter).toBe(11); // Last one wins in merge
        expect(result.state.messages).toContain("Processed by parallel-1");
        expect(result.state.messages).toContain("Processed by parallel-2");
        expect(result.state.messages).toContain("Processed by parallel-3");
      });

      it("should fail if any parallel processor fails", async () => {
        const processor1 = createTestProcessor("parallel-1", "success");
        const processor2 = createTestProcessor("parallel-2", "failure");
        const processor3 = createTestProcessor("parallel-3", "success");

        const parallelProcessor = parallelProcessors({
          name: "parallel-with-failure",
          timeoutStrategy: "max",
          processors: [
            // timeout strategy
            processor1,
            processor2,
            processor3,
          ],
        });

        runtime.register(parallelProcessor);
        await runtime.start();

        const initialState = createTestState(0, []);
        const result = await runtime.execute(
          "parallel-with-failure",
          initialState
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe("Conditional Routing", () => {
      it("should route to correct processor based on condition", async () => {
        const evenProcessor = createProcessor<TestState>("even-handler")
          .withDescription("Handles even numbers")
          .process(async (state) => {
            return Success({
              ...state,
              messages: [...(state.messages || []), "Handled even number"],
            });
          });

        const oddProcessor = createProcessor<TestState>("odd-handler")
          .withDescription("Handles odd numbers")
          .process(async (state) => {
            return Success({
              ...state,
              messages: [...(state.messages || []), "Handled odd number"],
            });
          });

        const routingProcessor = routeProcessor(
          "number-router",
          (state) => (state.counter % 2 === 0 ? "even" : "odd"),
          {
            even: evenProcessor,
            odd: oddProcessor,
          }
        );

        runtime.register(routingProcessor);
        await runtime.start();

        // Test even number routing
        const evenState = createTestState(4, []);
        const evenResult = await runtime.execute("number-router", evenState);
        expect(evenResult.success).toBe(true);
        expect(evenResult.state.messages).toContain("Handled even number");

        // Test odd number routing
        const oddState = createTestState(3, []);
        const oddResult = await runtime.execute("number-router", oddState);
        expect(oddResult.success).toBe(true);
        expect(oddResult.state.messages).toContain("Handled odd number");
      });

      it("should use fallback processor for unmatched routes", async () => {
        const fallbackProcessor = createProcessor<TestState>("fallback")
          .withDescription("Fallback processor")
          .process(async (state) => {
            return Success({
              ...state,
              messages: [...(state.messages || []), "Fallback executed"],
            });
          });

        const routingProcessor = routeProcessor(
          "limited-router",
          (state) => (state.counter > 10 ? "high" : "unknown"),
          {
            high: createTestProcessor("high-handler", "success"),
          },
          fallbackProcessor
        );

        runtime.register(routingProcessor);
        await runtime.start();

        const state = createTestState(5, []);
        const result = await runtime.execute("limited-router", state);
        expect(result.success).toBe(true);
        expect(result.state.messages).toContain("Fallback executed");
      });
    });

    describe("Complex Compositions", () => {
      it("should handle nested chains and parallel execution", async () => {
        // Create parallel processors that will run concurrently
        const parallel1 = createTestProcessor("parallel-branch-1", "success");
        const parallel2 = createTestProcessor("parallel-branch-2", "success");
        const parallelGroup = parallelProcessors({
          name: "parallel-group",
          processors: [parallel1, parallel2],
        });

        // Create a chain that includes the parallel group
        const preProcessor = createTestProcessor("pre-process", "success");
        const postProcessor = createTestProcessor("post-process", "success");

        const complexChain = chainProcessors({
          name: "complex-workflow",
          processors: [preProcessor, parallelGroup, postProcessor],
        });

        runtime.register(complexChain);
        await runtime.start();

        const initialState = createTestState(0, []);
        const result = await runtime.execute("complex-workflow", initialState);

        expect(result.success).toBe(true);
        expect(result.state.messages).toContain("Processed by pre-process");
        expect(result.state.messages).toContain(
          "Processed by parallel-branch-1"
        );
        expect(result.state.messages).toContain(
          "Processed by parallel-branch-2"
        );
        expect(result.state.messages).toContain("Processed by post-process");
      });

      it("should handle routing within chains", async () => {
        const preprocessor = createTestProcessor("pre-route", "success");

        const routingProcessor = routeProcessor(
          "conditional-step",
          (state) => (state.counter > 1 ? "process" : "skip"),
          {
            process: createTestProcessor("conditional-process", "success"),
            skip: createProcessor<TestState>("skip").process(async (state) =>
              Success({
                ...state,
                messages: [...(state.messages || []), "Skipped processing"],
              })
            ),
          }
        );

        const postprocessor = createTestProcessor("post-route", "success");

        const routingChain = chainProcessors({
          name: "routing-chain",
          processors: [preprocessor, routingProcessor, postprocessor],
        });

        runtime.register(routingChain);
        await runtime.start();

        const initialState = createTestState(0, []);
        const result = await runtime.execute("routing-chain", initialState);

        expect(result.success).toBe(true);
        expect(result.state.messages).toContain("Processed by pre-route");
        expect(result.state.messages).toContain("Skipped processing");
        expect(result.state.messages).toContain("Processed by post-route");
      });
    });

    describe("Error Propagation", () => {
      it("should properly propagate errors through complex chains", async () => {
        const step1 = createTestProcessor("chain-step-1", "success");
        const failingStep = createTestProcessor(
          "chain-failing-step",
          "failure"
        );
        const step3 = createTestProcessor("chain-step-3", "success");

        const errorChain = chainProcessors({
          name: "error-chain",
          processors: [step1, failingStep, step3],
        });

        runtime.register(errorChain);
        await runtime.start();

        const initialState = createTestState(0, []);
        const result = await runtime.execute("error-chain", initialState);

        expect(result.success).toBe(false);
        expect(result.error).toBeInstanceOf(Error);
        expect(result.state.messages).toContain("Processed by chain-step-1");
        expect(result.state.messages).not.toContain(
          "Processed by chain-step-3"
        );
      });

      it("should handle timeout scenarios", async () => {
        const timeoutProcessor = createTestProcessor("timeout-step", "timeout");
        const chain = chainProcessors({
          name: "timeout-chain",
          processors: [timeoutProcessor],
        });

        runtime.register(chain);
        await runtime.start();

        const initialState = createTestState(0, []);
        const result = await runtime.execute("timeout-chain", initialState);

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain("timed out");
      });
    });

    describe("State Management", () => {
      it("should maintain state consistency across complex workflows", async () => {
        const incrementer = createProcessor<TestState>("incrementer").process(
          async (state) =>
            Success({
              ...state,
              counter:
                (typeof state.counter === "number" ? state.counter : 0) + 10,
              messages: [...(state.messages || []), "Incremented by 10"],
            })
        );

        const doubler = createProcessor<TestState>("doubler").process(
          async (state) =>
            Success({
              ...state,
              counter:
                (typeof state.counter === "number" ? state.counter : 0) * 2,
              messages: [...(state.messages || []), "Doubled counter"],
            })
        );

        const validator = createProcessor<TestState>("validator").process(
          async (state) => {
            if (state.counter < 50) {
              throw new Error("Counter too low");
            }
            return Success({
              ...state,
              messages: [...(state.messages || []), "Validation passed"],
            });
          }
        );

        const mathChain = chainProcessors({
          name: "math-workflow",
          processors: [incrementer, doubler, validator],
        });

        runtime.register(mathChain);
        await runtime.start();

        const initialState = createTestState(15, []);
        const result = await runtime.execute("math-workflow", initialState);

        expect(result.success).toBe(true);
        expect(result.state.counter).toBe(50); // (15 + 10) * 2 = 50
        expect(result.state.messages).toContain("Incremented by 10");
        expect(result.state.messages).toContain("Doubled counter");
        expect(result.state.messages).toContain("Validation passed");
      });
    });
  });
}
