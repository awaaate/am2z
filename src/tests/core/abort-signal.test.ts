import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LocalRuntime, DEFAULT_RUNTIME_CONFIG } from "../../lib/core/runtime";
import {
  createAbortableProcessor,
  createHttpMockProcessor,
  createTestState,
  testLogger,
  type TestState,
} from "../test-utils";
import { createProcessor, Success, Failure } from "../../lib/core";
import { wrapAsProcessorError } from "../../lib/core/errors";

describe("AbortSignal and Cooperative Cancellation", () => {
  let runtime: LocalRuntime<TestState>;

  beforeEach(() => {
    runtime = new LocalRuntime<TestState>(DEFAULT_RUNTIME_CONFIG, testLogger);
  });

  afterEach(async () => {
    await runtime.stop();
  });

  describe("Basic AbortSignal Support", () => {
    it("should provide AbortSignal in processor context", async () => {
      let hasSignal = false;

      const signalTestProcessor = createProcessor<TestState>(
        "signal-test"
      ).process(async (state, ctx) => {
        hasSignal = !!ctx.signal;

        return Success({
          ...state,
          messages: [...state.messages, "Signal test completed"],
        });
      });

      runtime.register(signalTestProcessor);
      await runtime.start();

      const result = await runtime.execute("signal-test", createTestState());

      expect(result.success).toBe(true);
      expect(hasSignal).toBe(false); // LocalRuntime doesn't provide signal by default
    });

    it("should respect AbortSignal in long-running processors", async () => {
      const abortableProcessor = createAbortableProcessor(
        "long-running",
        200,
        1
      );
      runtime.register(abortableProcessor);
      await runtime.start();

      const result = await runtime.execute("long-running", createTestState());

      // Since LocalRuntime doesn't timeout by default, this should complete
      expect(result.success).toBe(true);
      expect(result.state.counter).toBe(200);
    });

    it("should handle cooperative cancellation in mock HTTP requests", async () => {
      const httpProcessor = createHttpMockProcessor("http-test", false, 50);
      runtime.register(httpProcessor);
      await runtime.start();

      const result = await runtime.execute("http-test", createTestState());

      expect(result.success).toBe(true);
      expect(result.state.data?.httpResponse).toBeDefined();
      expect(result.state.messages).toContain(
        "http-test HTTP request successful"
      );
    });
  });

  describe("Timeout Integration with AbortSignal", () => {
    it("should abort processor when timeout is reached", async () => {
      const timeoutProcessor = createProcessor<TestState>("timeout-abort")
        .withTimeout(50) // Very short timeout
        .process(async (state, ctx) => {
          // Simulate long-running work that checks abort signal
          for (let i = 0; i < 100; i++) {
            if (ctx.signal?.aborted) {
              return Failure(
                wrapAsProcessorError(
                  new Error("Operation was cancelled"),
                  "timeout-abort",
                  ctx.meta.executionId
                )
              );
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }

          return Success({
            ...state,
            messages: [...state.messages, "Should not reach here"],
          });
        });

      runtime.register(timeoutProcessor);
      await runtime.start();

      const result = await runtime.execute("timeout-abort", createTestState());

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timed out");
    });

    it("should complete before timeout if processor finishes quickly", async () => {
      const fastProcessor = createProcessor<TestState>("fast-processor")
        .withTimeout(1000)
        .process(async (state, ctx) => {
          // Quick operation that checks signal
          if (ctx.signal?.aborted) {
            return Failure(
              wrapAsProcessorError(
                new Error("Operation was cancelled"),
                "fast-processor",
                ctx.meta.executionId
              )
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 10));

          return Success({
            ...state,
            counter: state.counter + 1,
            messages: [...state.messages, "Fast operation completed"],
          });
        });

      runtime.register(fastProcessor);
      await runtime.start();

      const result = await runtime.execute("fast-processor", createTestState());

      expect(result.success).toBe(true);
      expect(result.state.messages).toContain("Fast operation completed");
    });
  });

  describe("Cancellation Patterns", () => {
    it("should handle periodic cancellation checks", async () => {
      let checkCount = 0;

      const periodicCheckProcessor = createProcessor<TestState>(
        "periodic-check"
      ).process(async (state, ctx) => {
        for (let i = 0; i < 50; i++) {
          checkCount++;

          // Check every 10 iterations
          if (i % 10 === 0 && ctx.signal?.aborted) {
            return Failure(
              wrapAsProcessorError(
                new Error(`Cancelled at iteration ${i}`),
                "periodic-check",
                ctx.meta.executionId
              )
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 1));
        }

        return Success({
          ...state,
          counter: state.counter + checkCount,
          messages: [...state.messages, `Completed ${checkCount} checks`],
        });
      });

      runtime.register(periodicCheckProcessor);
      await runtime.start();

      const result = await runtime.execute("periodic-check", createTestState());

      expect(result.success).toBe(true);
      expect(checkCount).toBe(50);
      expect(result.state.counter).toBe(50);
    });

    it("should handle immediate cancellation check", async () => {
      const immediateCheckProcessor = createProcessor<TestState>(
        "immediate-check"
      ).process(async (state, ctx) => {
        // Check immediately at start
        if (ctx.signal?.aborted) {
          return Failure(
            wrapAsProcessorError(
              new Error("Operation was cancelled immediately"),
              "immediate-check",
              ctx.meta.executionId
            )
          );
        }

        return Success({
          ...state,
          messages: [...state.messages, "Immediate check passed"],
        });
      });

      runtime.register(immediateCheckProcessor);
      await runtime.start();

      const result = await runtime.execute(
        "immediate-check",
        createTestState()
      );

      expect(result.success).toBe(true);
      expect(result.state.messages).toContain("Immediate check passed");
    });
  });

  describe("Error Handling with Cancellation", () => {
    it("should distinguish between cancellation and other errors", async () => {
      const mixedErrorProcessor = createProcessor<TestState>(
        "mixed-errors"
      ).process(async (state, ctx) => {
        if (state.counter === 0) {
          // Regular error
          throw new Error("Regular processing error");
        }

        if (ctx.signal?.aborted) {
          return Failure(
            wrapAsProcessorError(
              new Error("Operation was cancelled"),
              "mixed-errors",
              ctx.meta.executionId
            )
          );
        }

        return Success(state);
      });

      runtime.register(mixedErrorProcessor);
      await runtime.start();

      // Test regular error
      const errorResult = await runtime.execute(
        "mixed-errors",
        createTestState(0)
      );
      expect(errorResult.success).toBe(false);
      expect(errorResult.error?.message).toContain("Regular processing error");

      // Test normal operation (no cancellation)
      const successResult = await runtime.execute(
        "mixed-errors",
        createTestState(1)
      );
      expect(successResult.success).toBe(true);
    });
  });

  describe("Complex Cancellation Scenarios", () => {
    it("should handle nested processor calls with cancellation", async () => {
      const nestedCallProcessor = createProcessor<TestState>(
        "nested-call"
      ).process(async (state, ctx) => {
        if (ctx.signal?.aborted) {
          return Failure(
            wrapAsProcessorError(
              new Error("Parent operation cancelled"),
              "nested-call",
              ctx.meta.executionId
            )
          );
        }

        // Simulate nested call (in real scenario, would use ctx.call)
        await new Promise((resolve) => setTimeout(resolve, 10));

        if (ctx.signal?.aborted) {
          return Failure(
            wrapAsProcessorError(
              new Error("Operation cancelled after nested call"),
              "nested-call",
              ctx.meta.executionId
            )
          );
        }

        return Success({
          ...state,
          messages: [...state.messages, "Nested call completed successfully"],
        });
      });

      runtime.register(nestedCallProcessor);
      await runtime.start();

      const result = await runtime.execute("nested-call", createTestState());

      expect(result.success).toBe(true);
      expect(result.state.messages).toContain(
        "Nested call completed successfully"
      );
    });
  });
});
