// src/test/test-utils.ts
import { type AppState } from "../lib/core/state";
import { type ProcessorDefinition } from "../lib/core/processor";
import { createProcessor, Success, Failure } from "../lib/core";
import { createLogger } from "../lib/core/logging";
import {
  type RuntimeConfig,
  DEFAULT_RUNTIME_CONFIG,
} from "../lib/core/runtime";
import {
  ProcessorExecutionError,
  wrapAsProcessorError,
} from "../lib/core/errors";

export interface TestState extends AppState {
  readonly counter: number;
  readonly messages: string[];
  readonly data?: Record<string, unknown>;
}

export function createTestState(
  counter = 0,
  messages: string[] = [],
  sessionId = "test-session",
  data?: Record<string, unknown>
): TestState {
  return {
    counter,
    messages,
    data,
    metadata: {
      version: 1,
      sessionId,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  };
}

export function createTestRuntimeConfig(
  overrides?: Partial<RuntimeConfig>
): RuntimeConfig {
  return {
    ...DEFAULT_RUNTIME_CONFIG,
    ...overrides,
  };
}

export function createTestProcessor(
  name: string,
  behavior:
    | "success"
    | "failure"
    | "timeout"
    | "abort-check"
    | "slow" = "success",
  options?: {
    timeout?: number;
    delay?: number;
    throwAfterDelay?: boolean;
  }
): ProcessorDefinition<TestState> {
  const timeout = options?.timeout ?? (behavior === "timeout" ? 25 : 5000);
  const delay = options?.delay ?? (behavior === "slow" ? 100 : 1);

  return createProcessor<TestState>(name)
    .withDescription(`Test processor - ${behavior}`)
    .withTimeout(timeout)
    .process(async (state, ctx) => {
      ctx.log.debug(`Starting processor ${name} with behavior ${behavior}`, {
        callDepth: ctx.callDepth,
        hasSignal: !!ctx.signal,
      });

      if (behavior === "abort-check") {
        // Test cooperative cancellation
        for (let i = 0; i < 10; i++) {
          if (ctx.signal?.aborted) {
            return Failure(
              wrapAsProcessorError(
                new Error(`${name} was cancelled at iteration ${i}`),
                name,
                ctx.meta.executionId
              )
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      if (behavior === "failure") {
        if (options?.throwAfterDelay && delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        throw new Error(`Test failure in ${name}`);
      }

      if (behavior === "timeout") {
        // Simulate long-running operation that will timeout
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return Success(state); // This should never be reached due to timeout
      }

      // Add configurable delay
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Check for abort during processing
      if (ctx.signal?.aborted) {
        return Failure(
          wrapAsProcessorError(
            new Error(`${name} was cancelled during processing`),
            name,
            ctx.meta.executionId
          )
        );
      }

      ctx.log.info(`Test processor ${name} executed successfully`);

      return Success({
        ...state,
        counter:
          (typeof state.counter === "number"
            ? state.counter
            : parseInt(String(state.counter), 10) || 0) + 1,
        messages: [...(state.messages || []), `Processed by ${name}`],
      });
    });
}

export function createAbortableProcessor(
  name: string,
  iterations = 100,
  iterationDelay = 5
): ProcessorDefinition<TestState> {
  return createProcessor<TestState>(name)
    .withDescription(`Abortable test processor with ${iterations} iterations`)
    .process(async (state, ctx) => {
      for (let i = 0; i < iterations; i++) {
        // Check for cancellation every 10 iterations
        if (i % 10 === 0 && ctx.signal?.aborted) {
          return Failure(
            wrapAsProcessorError(
              new Error(`${name} cancelled at iteration ${i}/${iterations}`),
              name,
              ctx.meta.executionId
            )
          );
        }

        await new Promise((resolve) => setTimeout(resolve, iterationDelay));
      }

      return Success({
        ...state,
        counter: state.counter + iterations,
        messages: [
          ...state.messages,
          `${name} completed ${iterations} iterations`,
        ],
      });
    });
}

export function createCallDepthTestProcessor(
  name: string,
  maxRecursion = 5
): ProcessorDefinition<TestState> {
  return createProcessor<TestState>(name)
    .withDescription(
      `Call depth test processor - max recursion: ${maxRecursion}`
    )
    .process(async (state, ctx) => {
      const newState = {
        ...state,
        counter: state.counter + 1,
        messages: [...state.messages, `${name} at depth ${ctx.callDepth}`],
      };

      if (state.counter < maxRecursion) {
        // Recursive call to test call depth limiting
        const result = await ctx.call(name, newState);
        return result;
      }

      return Success(newState);
    });
}

export function createHttpMockProcessor(
  name: string,
  shouldFail = false,
  delay = 10
): ProcessorDefinition<TestState> {
  return createProcessor<TestState>(name)
    .withDescription(`HTTP mock processor - fail: ${shouldFail}`)
    .process(async (state, ctx) => {
      try {
        // Simulate HTTP request with AbortSignal support
        const response = await mockFetch("/api/test", {
          signal: ctx.signal,
          delay,
          shouldFail,
        });

        return Success({
          ...state,
          data: { ...state.data, httpResponse: response },
          messages: [...state.messages, `${name} HTTP request successful`],
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return Failure(
            wrapAsProcessorError(
              new Error(`${name} HTTP request was cancelled`),
              name,
              ctx.meta.executionId
            )
          );
        }
        throw error;
      }
    });
}

// Mock fetch that supports AbortSignal
export async function mockFetch(
  url: string,
  options: {
    signal?: AbortSignal;
    delay?: number;
    shouldFail?: boolean;
  } = {}
): Promise<{ url: string; status: number; data: string }> {
  const { signal, delay = 10, shouldFail = false } = options;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (shouldFail) {
        reject(new Error("Mock HTTP request failed"));
        return;
      }

      resolve({
        url,
        status: 200,
        data: "Mock response data",
      });
    }, delay);

    // Handle abort signal
    if (signal) {
      const onAbort = () => {
        clearTimeout(timeoutId);
        const abortError = new Error("The operation was aborted");
        abortError.name = "AbortError";
        reject(abortError);
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export const testLogger = createLogger(
  { component: "Test" },
  "debug" // Enable debug logs for tests
);

export function createTestProcessorWithChainError(
  name: string,
  partialState?: Partial<TestState>
): ProcessorDefinition<TestState> {
  return createProcessor<TestState>(name)
    .withDescription(
      "Test processor that creates chain error with partial state"
    )
    .process(async (state) => {
      const partial = partialState ? { ...state, ...partialState } : state;
      const error = new ProcessorExecutionError(
        name,
        "test-execution-id",
        new Error("Test chain error"),
        {
          partialState: partial,
          completedSteps: 2,
          failedProcessor: name,
        }
      );

      return Failure(error);
    });
}

// Helper to wait for a condition with timeout
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 10
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

// Helper to test memory leaks
export function createMemoryTestHelper() {
  const allocations: any[] = [];

  return {
    allocate: (data: any) => {
      allocations.push(data);
      return data;
    },
    getAllocationCount: () => allocations.length,
    clear: () => {
      allocations.length = 0;
    },
  };
}
