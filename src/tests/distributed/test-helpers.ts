import {
  describe,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import Redis from "ioredis";
import { createAppState, type AppState } from "../../lib/core/state";
import { type RedisConfig } from "../../lib/node/connection-manager";
import {
  createQueueRuntimeWithDefaults,
  type QueueRuntime,
} from "../../lib/node/queue-runtime";
import {
  createProcessor,
  type ProcessorDefinition,
} from "../../lib/core/processor";
import { Success, Failure } from "../../lib/core/result";
import { ValidationError, BusinessError } from "../../lib/core/errors";
import { type ProcessorResult } from "../../lib/core/processor";

export interface TestState extends AppState {
  count: number;
  message: string;
  processed?: boolean;
  error?: string;
  items?: string[];
  total?: number;
}

export const TEST_REDIS_CONFIG: Partial<RedisConfig> = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => Math.min(times * 50, 500),
};

export async function createTestState(
  data: Partial<TestState> = {}
): Promise<TestState> {
  const sessionId = data.metadata?.sessionId || `test-session-${Date.now()}`;
  return createAppState(sessionId, {
    count: 0,
    message: "test",
    ...data,
  }) as TestState;
}

export function createTestProcessor<TState extends AppState = TestState>(
  name: string,
  handler?: (state: TState, ctx: any) => Promise<ProcessorResult<TState>>
): ProcessorDefinition<TState> {
  return createProcessor<TState>(name)
    .withDescription(`Test processor ${name}`)
    .withTimeout(5000)
    .process(handler || (async (state) => Success(state)));
}

export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("Condition not met within timeout");
}

export async function cleanupRedis(
  patterns: string[] = ["am2z*", "bull:*"]
): Promise<void> {
  const redis = new Redis(TEST_REDIS_CONFIG);
  try {
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  } finally {
    redis.disconnect();
  }
}

export async function ensureRedisConnection(): Promise<void> {
  const redis = new Redis(TEST_REDIS_CONFIG);
  try {
    await redis.ping();
  } catch (error) {
    console.error("Redis connection failed:", error);
    throw new Error("Redis must be running for distributed tests");
  } finally {
    redis.disconnect();
  }
}

export function createDelayProcessor(
  name: string,
  delayMs: number
): ProcessorDefinition<TestState> {
  return createProcessor<TestState>(name)
    .withDescription(`Delays for ${delayMs}ms`)
    .withTimeout(delayMs + 1000)
    .process(async (state) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return Success({ ...state, processed: true });
    });
}

export function createErrorProcessor(
  name: string,
  errorType: "validation" | "business" = "validation"
): ProcessorDefinition<TestState> {
  return createProcessor<TestState>(name)
    .withDescription("Always fails")
    .process(async (state) => {
      if (errorType === "validation") {
        return Failure(
          new ValidationError("test", "value", "Test validation error")
        );
      }
      return Failure(new BusinessError("TEST_ERROR", "Test business error"));
    });
}

export function createCounterProcessor(
  name: string
): ProcessorDefinition<TestState> {
  return createProcessor<TestState>(name)
    .withDescription("Increments counter")
    .process(async (state) => {
      return Success({ ...state, count: state.count + 1 });
    });
}

export async function setupTestRuntime(): Promise<QueueRuntime<TestState>> {
  await ensureRedisConnection();
  await cleanupRedis();
  return createQueueRuntimeWithDefaults<TestState>(TEST_REDIS_CONFIG);
}

export async function cleanupTestRuntime(
  runtime: QueueRuntime<TestState>
): Promise<void> {
  if (runtime.isStarted()) {
    await runtime.stop();
  }
  await runtime.disconnect();
  await cleanupRedis();
}

export class TestEventCollector {
  private events: Array<{ type: string; data: any; timestamp: number }> = [];

  constructor(private runtime: QueueRuntime<any>) {}

  start(eventTypes: string[]): void {
    eventTypes.forEach((eventType) => {
      this.runtime.on(eventType, (data) => {
        this.events.push({ type: eventType, data, timestamp: Date.now() });
      });
    });
  }

  getEvents(
    type?: string
  ): Array<{ type: string; data: any; timestamp: number }> {
    return type ? this.events.filter((e) => e.type === type) : this.events;
  }

  clear(): void {
    this.events = [];
  }

  waitForEvent(eventType: string, timeout = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const existing = this.events.find((e) => e.type === eventType);
      if (existing) {
        resolve(existing.data);
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${eventType}`));
      }, timeout);

      const handler = (data: any) => {
        clearTimeout(timeoutId);
        this.runtime.off(eventType, handler);
        resolve(data);
      };

      this.runtime.on(eventType, handler);
    });
  }
}
