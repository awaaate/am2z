// src/test/test-utils.ts
import { type AppState } from "../lib/core/state";
import { type ProcessorDefinition } from "../lib/core/processor";
import { createProcessor, Success } from "../lib/core";
import { createLogger } from "../lib/core/logging";

export interface TestState extends AppState {
  readonly counter: number;
  readonly messages: string[];
}

export function createTestState(
  counter = 0,
  messages: string[] = [],
  sessionId = "test-session"
): TestState {
  return {
    counter,
    messages,
    metadata: {
      version: 1,
      sessionId,
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  };
}

export function createTestProcessor(
  name: string,
  behavior: "success" | "failure" | "timeout" = "success"
): ProcessorDefinition<TestState> {
  return createProcessor<TestState>(name)
    .withDescription(`Test processor - ${behavior}`)
    .withTimeout(behavior === "timeout" ? 100 : 5000)
    .process(async (state, ctx) => {
      if (behavior === "failure") {
        throw new Error(`Test failure in ${name}`);
      }

      if (behavior === "timeout") {
        // Simulate long-running operation
        return new Promise((resolve) => setTimeout(resolve, 200));
      }
      ctx.log.info(`Test processor ${name} executed`);

      // Add a small delay to ensure execution time is greater than 0
      await new Promise((resolve) => setTimeout(resolve, 1));

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

export const testLogger = createLogger({ component: "Test" });
