// src/test/node/result-collector.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ResultCollector } from "../../lib/node/result-collector";
import { testLogger, createTestState, type TestState } from "../test-utils";
import { TimeoutError } from "../../lib/core/errors";

describe("ResultCollector", () => {
  let resultCollector: ResultCollector<TestState>;

  beforeEach(() => {
    resultCollector = new ResultCollector<TestState>(testLogger);
  });

  afterEach(() => {
    resultCollector.cleanup();
  });

  it("should resolve pending execution on completion", async () => {
    const executionId = "test-execution-1";
    const expectedResult = {
      state: createTestState(1, ["test"]),
      executionTime: 100,
      success: true,
      metadata: {
        processorName: "test",
        executionId,
        sessionId: "test-session",
        attempt: 1,
        startedAt: Date.now(),
      },
    };

    // Start waiting for result
    const resultPromise = resultCollector.waitForResult(executionId);

    // Simulate job completion
    setTimeout(() => {
      resultCollector.emit("job:completed", {
        executionId,
        result: expectedResult,
      });
    }, 50);

    const result = await resultPromise;
    expect(result).toBe(expectedResult);
  });

  it("should reject pending execution on failure", async () => {
    const executionId = "test-execution-2";
    const expectedError = new Error("Test execution failed");

    // Start waiting for result
    const resultPromise = resultCollector.waitForResult(executionId);

    // Simulate job failure
    setTimeout(() => {
      resultCollector.emit("job:failed", {
        executionId,
        error: expectedError,
      });
    }, 50);

    await expect(resultPromise).rejects.toThrow("Test execution failed");
  });

  it("should timeout pending execution", async () => {
    const executionId = "test-execution-3";
    const timeoutMs = 100;

    const resultPromise = resultCollector.waitForResult(executionId, timeoutMs);

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(TimeoutError);
    expect(result.error?.message).toContain("timed out after 100ms");
  });

  it("should handle multiple pending executions", async () => {
    const execution1 = "test-execution-4";
    const execution2 = "test-execution-5";

    const result1 = {
      state: createTestState(1),
      executionTime: 100,
      success: true,
      metadata: {} as any,
    };
    const result2 = {
      state: createTestState(2),
      executionTime: 150,
      success: true,
      metadata: {} as any,
    };

    const promise1 = resultCollector.waitForResult(execution1);
    const promise2 = resultCollector.waitForResult(execution2);

    // Resolve in reverse order
    setTimeout(() => {
      resultCollector.emit("job:completed", {
        executionId: execution2,
        result: result2,
      });
      resultCollector.emit("job:completed", {
        executionId: execution1,
        result: result1,
      });
    }, 50);

    const [resolved1, resolved2] = await Promise.all([promise1, promise2]);

    expect(resolved1).toBe(result1);
    expect(resolved2).toBe(result2);
  });
});
