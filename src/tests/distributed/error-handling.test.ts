import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { 
  setupTestRuntime, 
  cleanupTestRuntime, 
  createTestProcessor,
  createTestState,
  createErrorProcessor,
  waitForCondition,
  type TestState 
} from "./test-helpers";
import { type QueueRuntime } from "../../lib/node/queue-runtime";
import { createProcessor } from "../../lib/core/processor";
import { Success, Failure } from "../../lib/core/result";
import { 
  ValidationError, 
  BusinessError, 
  ResourceError,
  ProcessorTimeoutError,
  ProcessorNotFoundError 
} from "../../lib/core/errors";
import { chainProcessors } from "../../lib/core/processor";

describe("Error Handling and Recovery", () => {
  let runtime: QueueRuntime<TestState>;

  beforeEach(async () => {
    runtime = await setupTestRuntime();
  });

  afterEach(async () => {
    await cleanupTestRuntime(runtime);
  });

  test("should handle validation errors", async () => {
    const processor = createErrorProcessor("validation-error", "validation");
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("validation-error", state);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error?.message).toContain("Test validation error");
  });

  test("should handle business errors", async () => {
    const processor = createErrorProcessor("business-error", "business");
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("business-error", state);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(BusinessError);
    expect(result.error?.code).toBe("TEST_ERROR");
  });

  test("should handle processor timeout", async () => {
    const processor = createProcessor<TestState>("timeout-test")
      .withTimeout(100)
      .process(async (state) => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return Success(state);
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("timeout-test", state);
    
    expect(result.success).toBe(false);
    expect(result.error?.name).toBe("ProcessorTimeoutError");
    expect(result.error?.message).toContain("timed out after 100ms");
  });

  test("should retry failed processors", async () => {
    let attempts = 0;
    const processor = createProcessor<TestState>("retry-test")
      .withRetryPolicy({ maxAttempts: 3, backoffMs: 50 })
      .process(async (state) => {
        attempts++;
        if (attempts < 3) {
          return Failure(new Error("Temporary failure"));
        }
        return Success({ ...state, processed: true, attempts });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("retry-test", state);
    
    expect(result.success).toBe(true);
    expect(result.state.attempts).toBe(3);
  });

  test("should respect max retry attempts", async () => {
    let attempts = 0;
    const processor = createProcessor<TestState>("max-retry-test")
      .withRetryPolicy({ maxAttempts: 2, backoffMs: 50 })
      .process(async (state) => {
        attempts++;
        return Failure(new Error(`Attempt ${attempts} failed`));
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("max-retry-test", state);
    
    expect(result.success).toBe(false);
    expect(attempts).toBe(2);
    expect(result.error?.message).toContain("Attempt 2 failed");
  });

  test("should handle exponential backoff", async () => {
    const timestamps: number[] = [];
    let attempts = 0;
    
    const processor = createProcessor<TestState>("backoff-test")
      .withRetryPolicy({ 
        maxAttempts: 4, 
        backoffMs: 100,
        backoffMultiplier: 2
      })
      .process(async (state) => {
        timestamps.push(Date.now());
        attempts++;
        if (attempts < 4) {
          return Failure(new Error("Retry me"));
        }
        return Success(state);
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("backoff-test", state);
    
    expect(result.success).toBe(true);
    expect(timestamps).toHaveLength(4);
    
    const delays = timestamps.slice(1).map((t, i) => t - timestamps[i]!);
    expect(delays[0]).toBeGreaterThanOrEqual(90);
    expect(delays[1]).toBeGreaterThanOrEqual(180);
    expect(delays[2]).toBeGreaterThanOrEqual(360);
  });

  test("should handle errors in chained processors", async () => {
    const step1 = createProcessor<TestState>("chain-step-1")
      .process(async (state) => Success({ ...state, count: state.count + 1 }));
    
    const step2 = createProcessor<TestState>("chain-step-2")
      .process(async () => Failure(new Error("Chain failed at step 2")));
    
    const step3 = createProcessor<TestState>("chain-step-3")
      .process(async (state) => Success({ ...state, count: state.count + 1 }));
    
    const chain = chainProcessors("error-chain", [step1, step2, step3]);
    
    runtime.register(chain);
    await runtime.start();
    
    const state = await createTestState({ count: 0 });
    const result = await runtime.execute("error-chain", state);
    
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("Chain failed at step 2");
    expect(result.state.count).toBe(1);
  });

  test("should handle resource errors", async () => {
    const processor = createProcessor<TestState>("resource-error")
      .process(async () => {
        throw new ResourceError("database", "Connection pool exhausted");
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("resource-error", state);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ResourceError);
    expect(result.error?.resourceType).toBe("database");
  });

  test("should handle processor not found error", async () => {
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("non-existent-processor", state);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ProcessorNotFoundError);
    expect(result.error?.processorName).toBe("non-existent-processor");
  });

  test("should preserve error context through retries", async () => {
    let attempts = 0;
    const processor = createProcessor<TestState>("context-retry")
      .withRetryPolicy({ maxAttempts: 3, backoffMs: 50 })
      .process(async (state, ctx) => {
        attempts++;
        if (attempts < 3) {
          return Failure(new BusinessError("RETRY_ME", `Attempt ${attempts}`, {
            sessionId: ctx.metadata.sessionId,
            executionId: ctx.metadata.executionId,
            attempt: attempts
          }));
        }
        return Success({ ...state, finalAttempt: attempts });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("context-retry", state);
    
    expect(result.success).toBe(true);
    expect(result.state.finalAttempt).toBe(3);
  });

  test("should handle custom retry logic", async () => {
    let attempts = 0;
    const processor = createProcessor<TestState>("custom-retry")
      .withRetryPolicy({ 
        maxAttempts: 5, 
        backoffMs: 50,
        shouldRetry: (error, attempt) => {
          return attempt < 3 && error.message.includes("retry");
        }
      })
      .process(async (state) => {
        attempts++;
        if (attempts === 1) {
          return Failure(new Error("Please retry"));
        } else if (attempts === 2) {
          return Failure(new Error("Don't retry this"));
        }
        return Success({ ...state, attempts });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const state = await createTestState();
    const result = await runtime.execute("custom-retry", state);
    
    expect(result.success).toBe(false);
    expect(attempts).toBe(2);
    expect(result.error?.message).toBe("Don't retry this");
  });

  test("should handle concurrent error scenarios", async () => {
    const processor = createProcessor<TestState>("concurrent-errors")
      .withRetryPolicy({ maxAttempts: 2, backoffMs: 50 })
      .process(async (state) => {
        if (state.count % 2 === 0) {
          return Failure(new ValidationError("count", state.count.toString(), "Even numbers not allowed"));
        }
        return Success({ ...state, processed: true });
      });
    
    runtime.register(processor);
    await runtime.start();
    
    const states = await Promise.all([
      createTestState({ count: 1 }),
      createTestState({ count: 2 }),
      createTestState({ count: 3 }),
      createTestState({ count: 4 }),
    ]);
    
    const results = await runtime.executeMany("concurrent-errors", states);
    
    expect(results).toHaveLength(4);
    expect(results[0]?.success).toBe(true);
    expect(results[1]?.success).toBe(false);
    expect(results[2]?.success).toBe(true);
    expect(results[3]?.success).toBe(false);
    
    const failures = results.filter(r => !r.success);
    expect(failures.every(r => r.error instanceof ValidationError)).toBe(true);
  });

  test("should handle graceful degradation", async () => {
    let primaryCalls = 0;
    let fallbackCalls = 0;
    
    const primaryProcessor = createProcessor<TestState>("primary-service")
      .process(async (state) => {
        primaryCalls++;
        if (primaryCalls <= 2) {
          return Failure(new ResourceError("service", "Service unavailable"));
        }
        return Success({ ...state, source: "primary" });
      });
    
    const fallbackProcessor = createProcessor<TestState>("fallback-service")
      .process(async (state) => {
        fallbackCalls++;
        return Success({ ...state, source: "fallback" });
      });
    
    const resilientProcessor = createProcessor<TestState>("resilient")
      .process(async (state, ctx) => {
        const primaryResult = await ctx.call("primary-service", state);
        if (!primaryResult.success) {
          return ctx.call("fallback-service", state);
        }
        return primaryResult;
      });
    
    runtime.register(primaryProcessor);
    runtime.register(fallbackProcessor);
    runtime.register(resilientProcessor);
    await runtime.start();
    
    const state = await createTestState();
    
    const result1 = await runtime.execute("resilient", state);
    expect(result1.success).toBe(true);
    expect(result1.state.source).toBe("fallback");
    
    const result2 = await runtime.execute("resilient", state);
    expect(result2.success).toBe(true);
    expect(result2.state.source).toBe("fallback");
    
    const result3 = await runtime.execute("resilient", state);
    expect(result3.success).toBe(true);
    expect(result3.state.source).toBe("primary");
  });
});