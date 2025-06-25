// src/test/core/runtime.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LocalRuntime } from "../../lib/core/runtime";
import {
  createTestProcessor,
  createTestState,
  testLogger,
  type TestState,
} from "../test-utils";
import { ProcessorNotFoundError } from "../../lib/core/errors";

describe("LocalRuntime", () => {
  let runtime: LocalRuntime<TestState>;

  beforeEach(() => {
    runtime = new LocalRuntime<TestState>(testLogger);
  });

  afterEach(async () => {
    await runtime.stop();
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
});
