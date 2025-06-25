// src/test/core/processor-executor.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import {
  ProcessorExecutor,
  ContextFactory,
  MetadataFactory,
} from "../../lib/core/processor-executor";
import {
  createTestProcessor,
  createTestState,
  testLogger,
  type TestState,
} from "../test-utils";
import { TimeoutError } from "../../lib/core/errors";
import { Success } from "../../lib/core";

describe("ProcessorExecutor", () => {
  let executor: ProcessorExecutor<TestState>;
  let contextFactory: ContextFactory<TestState>;
  let metadataFactory: MetadataFactory;

  beforeEach(() => {
    executor = new ProcessorExecutor<TestState>();
    contextFactory = new ContextFactory<TestState>();
    metadataFactory = new MetadataFactory();
  });

  it("should execute processor successfully", async () => {
    const processor = createTestProcessor("test-success", "success");
    const state = createTestState(0, []);
    const metadata = metadataFactory.createMetadata(
      "test-success",
      "test-session"
    );

    const context = contextFactory.createContext(
      processor,
      metadata,
      async () => ({ success: true, data: state }),
      () => {},
      testLogger
    );

    const result = await executor.executeProcessor(processor, state, context);

    expect(result.success).toBe(true);
    expect(result.state.counter).toBe(1);
    expect(result.state.messages).toContain("Processed by test-success");
    expect(result.executionTime).toBeGreaterThan(0);
  });

  it("should handle processor failure", async () => {
    const processor = createTestProcessor("test-failure", "failure");
    const state = createTestState(0, []);
    const metadata = metadataFactory.createMetadata(
      "test-failure",
      "test-session"
    );

    const context = contextFactory.createContext(
      processor,
      metadata,
      async () => ({ success: true, data: state }),
      () => {},
      testLogger
    );

    const result = await executor.executeProcessor(processor, state, context);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("Test failure in test-failure");
    expect(result.state.counter).toBe(0); // State unchanged on failure
  });

  it("should handle processor timeout", async () => {
    const processor = createTestProcessor("test-timeout", "timeout");
    const state = createTestState(0, []);
    const metadata = metadataFactory.createMetadata(
      "test-timeout",
      "test-session"
    );

    const context = contextFactory.createContext(
      processor,
      metadata,
      async () => ({ success: true, data: state }),
      () => {},
      testLogger
    );

    const result = await executor.executeProcessor(processor, state, context);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(TimeoutError);
    expect(result.executionTime).toBeLessThan(200); // Should timeout before 200ms
  });

  it("should measure execution time accurately", async () => {
    const processor = createTestProcessor("test-timing", "success");
    const state = createTestState(0, []);
    const metadata = metadataFactory.createMetadata(
      "test-timing",
      "test-session"
    );

    const context = contextFactory.createContext(
      processor,
      metadata,
      async () => ({ success: true, data: state }),
      () => {},
      testLogger
    );

    const startTime = Date.now();
    const result = await executor.executeProcessor(processor, state, context);
    const actualTime = Date.now() - startTime;

    expect(result.executionTime).toBeGreaterThan(0);
    expect(result.executionTime).toBeLessThanOrEqual(actualTime + 10); // Allow 10ms tolerance
  });
});

describe("ContextFactory", () => {
  let contextFactory: ContextFactory<TestState>;
  let metadataFactory: MetadataFactory;

  beforeEach(() => {
    contextFactory = new ContextFactory<TestState>();
    metadataFactory = new MetadataFactory();
  });

  it("should create context with proper structure", () => {
    const processor = createTestProcessor("test-context", "success");
    const metadata = metadataFactory.createMetadata(
      "test-context",
      "test-session"
    );

    const mockCaller = async () => Success(createTestState(0, []));
    const mockEmitter = () => {};

    const context = contextFactory.createContext(
      processor,
      metadata,
      mockCaller,
      mockEmitter,
      testLogger
    );

    expect(context.log).toBeDefined();
    expect(context.meta).toBe(metadata);
    expect(context.call).toBe(mockCaller);
    expect(context.emit).toBe(mockEmitter);
  });
});

describe("MetadataFactory", () => {
  let metadataFactory: MetadataFactory;

  beforeEach(() => {
    metadataFactory = new MetadataFactory();
  });

  it("should create metadata with correct structure", () => {
    const metadata = metadataFactory.createMetadata(
      "test-processor",
      "test-session"
    );

    expect(metadata.processorName).toBe("test-processor");
    expect(metadata.sessionId).toBe("test-session");
    expect(metadata.attempt).toBe(1);
    expect(metadata.executionId).toContain("test-processor");
    expect(metadata.startedAt).toBeGreaterThan(0);
  });

  it("should generate unique execution IDs", () => {
    const id1 = metadataFactory.generateExecutionId("test");
    const id2 = metadataFactory.generateExecutionId("test");

    expect(id1).not.toBe(id2);
    expect(id1).toContain("test");
    expect(id2).toContain("test");
  });
});
