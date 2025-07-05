import { describe, test, expect, beforeAll } from "bun:test";
import { ensureRedisConnection, cleanupRedis } from "./test-helpers";

describe("AM2Z Distributed Runtime Test Suite", () => {
  beforeAll(async () => {
    await ensureRedisConnection();
    await cleanupRedis();
  });

  test("should have Redis connection for distributed tests", async () => {
    await expect(ensureRedisConnection()).resolves.toBeUndefined();
  });

  test("should import all test modules", async () => {
    // Test that all modules can be imported without errors
    expect(() => require("./queue-runtime-lifecycle.test")).not.toThrow();
    expect(() => require("./processor-registration.test")).not.toThrow();
    expect(() => require("./distributed-execution.test")).not.toThrow();
    expect(() => require("./session-isolation.test")).not.toThrow();
    expect(() => require("./state-management.test")).not.toThrow();
    expect(() => require("./error-handling.test")).not.toThrow();
    expect(() => require("./event-system.test")).not.toThrow();
    expect(() => require("./resource-monitoring.test")).not.toThrow();
  });
});

// Import all test files to run them
import "./queue-runtime-lifecycle.test";
import "./processor-registration.test";
import "./distributed-execution.test";
import "./session-isolation.test";
import "./state-management.test";
import "./error-handling.test";
import "./event-system.test";
import "./resource-monitoring.test";