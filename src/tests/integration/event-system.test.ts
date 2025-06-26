import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createQueueRuntimeWithDefaults } from "../../lib/node/queue-runtime";
import { LocalRuntime } from "../../lib/core/runtime";
import {
  createTestProcessor,
  createTestState,
  testLogger,
  type TestState,
} from "../test-utils";
import { createProcessor, chainProcessors } from "../../lib/core/processor";
import { Success } from "../../lib/core/result";

// Test both runtime types
const runtimeConfigs = [
  {
    name: "LocalRuntime",
    createRuntime: () => new LocalRuntime<TestState>(testLogger),
    needsCleanup: false,
  },
  {
    name: "QueueRuntime",
    createRuntime: () =>
      createQueueRuntimeWithDefaults<TestState>({}, testLogger),
    needsCleanup: true,
  },
];

for (const config of runtimeConfigs) {
  describe(`${config.name} - Event System & Real-World Scenarios`, () => {
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

    describe("Event Emission and Handling", () => {
      it("should emit and handle processor lifecycle events", async () => {
        const eventProcessor = createTestProcessor("event-emitter", "success");
        runtime.register(eventProcessor);

        const events: any[] = [];

        // Listen to various events
        runtime.on("processor:completed", (data: any) => {
          events.push({ type: "completed", data });
        });

        runtime.on("processor:failed", (data: any) => {
          events.push({ type: "failed", data });
        });

        runtime.on("processor:active", (data: any) => {
          events.push({ type: "active", data });
        });

        await runtime.start();

        const result = await runtime.execute(
          "event-emitter",
          createTestState(0, [])
        );
        expect(result.success).toBe(true);

        // Wait a bit for events to propagate
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Should have received completion event
        const completedEvents = events.filter((e) => e.type === "completed");
        expect(completedEvents.length).toBeGreaterThan(0);

        if (completedEvents.length > 0) {
          expect(completedEvents[0].data.processorName).toBe("event-emitter");
          expect(completedEvents[0].data.executionTime).toBeGreaterThan(0);
        }
      });

      it("should handle custom events in processors", async () => {
        const customEvents: string[] = [];

        const customEventProcessor = createProcessor<TestState>("custom-events")
          .withDescription("Emits custom events")
          .process(async (state, ctx) => {
            ctx.emit("custom:start", { step: "beginning" });
            ctx.emit("custom:processing", { progress: 50 });
            ctx.emit("custom:end", { step: "completion" });

            return Success({
              ...state,
              messages: [...(state.messages || []), "Custom events emitted"],
            });
          });

        runtime.register(customEventProcessor);

        // Listen to custom events
        runtime.on("custom:start", (data: any) => {
          customEvents.push(`start:${data.step}`);
        });

        runtime.on("custom:processing", (data: any) => {
          customEvents.push(`processing:${data.progress}`);
        });

        runtime.on("custom:end", (data: any) => {
          customEvents.push(`end:${data.step}`);
        });

        await runtime.start();

        const result = await runtime.execute(
          "custom-events",
          createTestState(0, [])
        );
        expect(result.success).toBe(true);

        // Wait for events
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(customEvents).toContain("start:beginning");
        expect(customEvents).toContain("processing:50");
        expect(customEvents).toContain("end:completion");
      });

      it("should handle event listener removal", async () => {
        const eventProcessor = createTestProcessor(
          "removable-events",
          "success"
        );
        runtime.register(eventProcessor);

        let eventCount = 0;
        const eventHandler = () => {
          eventCount++;
        };

        // Add listener
        runtime.on("processor:completed", eventHandler);
        await runtime.start();

        // Execute once
        await runtime.execute("removable-events", createTestState(0, []));
        await new Promise((resolve) => setTimeout(resolve, 50));

        const firstCount = eventCount;
        expect(firstCount).toBeGreaterThan(0);

        // Remove listener
        runtime.off("processor:completed", eventHandler);

        // Execute again
        await runtime.execute("removable-events", createTestState(1, []));
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Event count should not have increased
        expect(eventCount).toBe(firstCount);
      });
    });

    describe("Real-World Workflow Scenarios", () => {
      it("should handle user registration workflow", async () => {
        interface UserState extends TestState {
          user?: {
            email: string;
            isValidated: boolean;
            isNotified: boolean;
            profile?: {
              name: string;
              preferences: Record<string, any>;
            };
          };
        }

        const validateEmail = createProcessor<UserState>("validate-email")
          .withDescription("Validates user email")
          .process(async (state) => {
            const email = state.user?.email || "";
            const isValid = email.includes("@") && email.includes(".");

            if (!isValid) {
              throw new Error("Invalid email format");
            }

            return Success({
              ...state,
              user: {
                ...state.user!,
                isValidated: true,
              },
              messages: [...(state.messages || []), "Email validated"],
            });
          });

        const sendWelcomeEmail = createProcessor<UserState>("send-welcome")
          .withDescription("Sends welcome email")
          .process(async (state) => {
            return Success({
              ...state,
              user: {
                ...state.user!,
                isNotified: true,
              },
              messages: [...(state.messages || []), "Welcome email sent"],
            });
          });

        const createProfile = createProcessor<UserState>("create-profile")
          .withDescription("Creates user profile")
          .process(async (state) => {
            return Success({
              ...state,
              user: {
                ...state.user!,
                profile: {
                  name: "New User",
                  preferences: { theme: "light", notifications: true },
                },
              },
              messages: [...(state.messages || []), "Profile created"],
            });
          });

        const registrationWorkflow = chainProcessors({
          name: "user-registration",
          timeoutStrategy: validateEmail,
          processors: [sendWelcomeEmail, createProfile],
        });

        runtime.register(registrationWorkflow);
        await runtime.start();

        const userState: UserState = {
          ...createTestState(0, []),
          user: {
            email: "test@example.com",
            isValidated: false,
            isNotified: false,
          },
        };

        const result = await runtime.execute("user-registration", userState);

        expect(result.success).toBe(true);
        expect(result.state.user?.isValidated).toBe(true);
        expect(result.state.user?.isNotified).toBe(true);
        expect(result.state.user?.profile?.name).toBe("New User");
        expect(result.state.messages).toContain("Email validated");
        expect(result.state.messages).toContain("Welcome email sent");
        expect(result.state.messages).toContain("Profile created");
      });

      it("should handle order processing workflow", async () => {
        interface OrderState extends TestState {
          order: {
            id: string;
            items: Array<{ id: string; quantity: number; price: number }>;
            total: number;
            status:
              | "pending"
              | "validated"
              | "charged"
              | "shipped"
              | "delivered";
            paymentProcessed: boolean;
            inventoryReserved: boolean;
          };
        }

        const validateOrder = createProcessor<OrderState>(
          "validate-order"
        ).process(async (state) => {
          const { order } = state;
          if (order.items.length === 0) {
            throw new Error("Order has no items");
          }

          const calculatedTotal = order.items.reduce(
            (sum, item) => sum + item.quantity * item.price,
            0
          );

          return Success({
            ...state,
            order: {
              ...order,
              total: calculatedTotal,
              status: "validated" as const,
            },
            messages: [
              ...(state.messages || []),
              `Order validated - Total: $${calculatedTotal}`,
            ],
          });
        });

        const reserveInventory = createProcessor<OrderState>(
          "reserve-inventory"
        ).process(async (state) => {
          // Simulate inventory check
          return Success({
            ...state,
            order: {
              ...state.order,
              inventoryReserved: true,
            },
            messages: [...(state.messages || []), "Inventory reserved"],
          });
        });

        const processPayment = createProcessor<OrderState>(
          "process-payment"
        ).process(async (state) => {
          return Success({
            ...state,
            order: {
              ...state.order,
              paymentProcessed: true,
              status: "charged" as const,
            },
            messages: [
              ...(state.messages || []),
              `Payment processed - $${state.order.total}`,
            ],
          });
        });

        const orderWorkflow = chainProcessors({
          name: "order-processing",
          timeoutStrategy: validateOrder,
          processors: [reserveInventory, processPayment],
        });

        runtime.register(orderWorkflow);
        await runtime.start();

        const orderState: OrderState = {
          ...createTestState(0, []),
          order: {
            id: "order-123",
            items: [
              { id: "item-1", quantity: 2, price: 25.99 },
              { id: "item-2", quantity: 1, price: 15.5 },
            ],
            total: 0,
            status: "pending",
            paymentProcessed: false,
            inventoryReserved: false,
          },
        };

        const result = await runtime.execute("order-processing", orderState);

        expect(result.success).toBe(true);
        expect(result.state.order.status).toBe("charged");
        expect(result.state.order.total).toBe(67.48); // (2 * 25.99) + 15.50
        expect(result.state.order.paymentProcessed).toBe(true);
        expect(result.state.order.inventoryReserved).toBe(true);
      });

      it("should handle data processing pipeline", async () => {
        interface DataState extends TestState {
          pipeline: {
            rawData: string[];
            cleanedData: string[];
            processedData: Record<string, number>;
            insights: string[];
          };
        }

        const cleanData = createProcessor<DataState>("clean-data").process(
          async (state) => {
            const cleaned = state.pipeline.rawData
              .filter((item) => item.trim().length > 0)
              .map((item) => item.toLowerCase().trim());

            return Success({
              ...state,
              pipeline: {
                ...state.pipeline,
                cleanedData: cleaned,
              },
              messages: [
                ...(state.messages || []),
                `Cleaned ${cleaned.length} records`,
              ],
            });
          }
        );

        const analyzeData = createProcessor<DataState>("analyze-data").process(
          async (state) => {
            const wordCounts: Record<string, number> = {};

            state.pipeline.cleanedData.forEach((item) => {
              const words = item.split(/\s+/);
              words.forEach((word) => {
                wordCounts[word] = (wordCounts[word] || 0) + 1;
              });
            });

            return Success({
              ...state,
              pipeline: {
                ...state.pipeline,
                processedData: wordCounts,
              },
              messages: [
                ...(state.messages || []),
                `Analyzed ${Object.keys(wordCounts).length} unique words`,
              ],
            });
          }
        );

        const generateInsights = createProcessor<DataState>(
          "generate-insights"
        ).process(async (state) => {
          const { processedData } = state.pipeline;
          const insights: string[] = [];

          const totalWords = Object.values(processedData).reduce(
            (sum, count) => sum + count,
            0
          );
          const uniqueWords = Object.keys(processedData).length;
          const mostCommon = Object.entries(processedData).sort(
            ([, a], [, b]) => b - a
          )[0];

          insights.push(`Total words: ${totalWords}`);
          insights.push(`Unique words: ${uniqueWords}`);
          if (mostCommon) {
            insights.push(
              `Most common word: "${mostCommon[0]}" (${mostCommon[1]} times)`
            );
          }

          return Success({
            ...state,
            pipeline: {
              ...state.pipeline,
              insights,
            },
            messages: [
              ...(state.messages || []),
              `Generated ${insights.length} insights`,
            ],
          });
        });

        const dataWorkflow = chainProcessors({
          name: "data-pipeline",
          timeoutStrategy: cleanData,
          processors: [analyzeData, generateInsights],
        });

        runtime.register(dataWorkflow);
        await runtime.start();

        const dataState: DataState = {
          ...createTestState(0, []),
          pipeline: {
            rawData: [
              "Hello World",
              "  ",
              "Hello Universe",
              "World of Code",
              "",
              "Code is Beautiful",
            ],
            cleanedData: [],
            processedData: {},
            insights: [],
          },
        };

        const result = await runtime.execute("data-pipeline", dataState);

        expect(result.success).toBe(true);
        expect(result.state.pipeline.cleanedData).toHaveLength(4);
        expect(result.state.pipeline.processedData).toHaveProperty("hello");
        expect(result.state.pipeline.processedData).toHaveProperty("world");
        expect(result.state.pipeline.insights.length).toBeGreaterThan(0);
      });
    });

    describe("Inter-Processor Communication", () => {
      it("should support complex ctx.call patterns", async () => {
        const mathService = createProcessor<TestState>("math-service")
          .withDescription("Provides math operations")
          .process(async (state) => {
            return Success({
              ...state,
              counter: state.counter * 2,
              messages: [
                ...(state.messages || []),
                "Math service: doubled counter",
              ],
            });
          });

        const validationService = createProcessor<TestState>(
          "validation-service"
        )
          .withDescription("Validates data")
          .process(async (state) => {
            if (state.counter < 0) {
              throw new Error("Counter cannot be negative");
            }
            return Success({
              ...state,
              messages: [...(state.messages || []), "Validation passed"],
            });
          });

        const orchestrator = createProcessor<TestState>("orchestrator")
          .withDescription("Orchestrates multiple services")
          .process(async (state, ctx) => {
            // First validate
            const validationResult = await ctx.call(
              "validation-service",
              state
            );
            if (!validationResult.success) {
              throw new Error(
                `Validation failed: ${validationResult.error?.message}`
              );
            }

            // Then perform math operation
            const mathResult = await ctx.call(
              "math-service",
              validationResult.data
            );
            if (!mathResult.success) {
              throw new Error(
                `Math operation failed: ${mathResult.error?.message}`
              );
            }

            // Final validation
            const finalValidation = await ctx.call(
              "validation-service",
              mathResult.data
            );
            if (!finalValidation.success) {
              throw new Error(
                `Final validation failed: ${finalValidation.error?.message}`
              );
            }

            return Success({
              ...finalValidation.data,
              messages: [
                ...(finalValidation.data.messages || []),
                "Orchestration completed",
              ],
            });
          });

        runtime.register(mathService);
        runtime.register(validationService);
        runtime.register(orchestrator);
        await runtime.start();

        const result = await runtime.execute(
          "orchestrator",
          createTestState(5, [])
        );

        expect(result.success).toBe(true);
        expect(result.state.counter).toBe(10); // 5 * 2
        expect(result.state.messages).toContain("Validation passed");
        expect(result.state.messages).toContain(
          "Math service: doubled counter"
        );
        expect(result.state.messages).toContain("Orchestration completed");
      });

      it("should handle circular dependencies gracefully", async () => {
        let callCount = 0;

        const processorA = createProcessor<TestState>("processor-a").process(
          async (state, ctx) => {
            callCount++;
            if (callCount > 3) {
              return Success({
                ...state,
                messages: [
                  ...(state.messages || []),
                  "A: Terminating to prevent infinite loop",
                ],
              });
            }

            const result = await ctx.call("processor-b", {
              ...state,
              messages: [...(state.messages || []), "A: Called B"],
            });

            return result.success ? result : Success(state);
          }
        );

        const processorB = createProcessor<TestState>("processor-b").process(
          async (state, ctx) => {
            if (callCount <= 2) {
              const result = await ctx.call("processor-a", {
                ...state,
                messages: [...(state.messages || []), "B: Called A"],
              });
              return result.success ? result : Success(state);
            }

            return Success({
              ...state,
              messages: [...(state.messages || []), "B: Breaking cycle"],
            });
          }
        );

        runtime.register(processorA);
        runtime.register(processorB);
        await runtime.start();

        const result = await runtime.execute(
          "processor-a",
          createTestState(0, [])
        );

        expect(result.success).toBe(true);
        expect(
          result.state.messages.some((msg: string) =>
            msg.includes("Terminating to prevent infinite loop")
          )
        ).toBe(true);
        expect(callCount).toBeLessThanOrEqual(4);
      });
    });

    describe("Advanced Error Scenarios", () => {
      it("should handle cascading failures gracefully", async () => {
        const unstableService = createProcessor<TestState>(
          "unstable-service"
        ).process(async (state) => {
          if (state.counter > 2) {
            throw new Error("Service overloaded");
          }
          return Success(state);
        });

        const dependentService = createProcessor<TestState>(
          "dependent-service"
        ).process(async (state, ctx) => {
          try {
            const result = await ctx.call("unstable-service", state);
            return result.success
              ? Success({
                  ...result.data,
                  messages: [
                    ...(result.data.messages || []),
                    "Dependent service succeeded",
                  ],
                })
              : Success({
                  ...state,
                  messages: [
                    ...(state.messages || []),
                    "Dependent service handled failure",
                  ],
                });
          } catch (error) {
            return Success({
              ...state,
              messages: [
                ...(state.messages || []),
                "Dependent service caught error",
              ],
            });
          }
        });

        runtime.register(unstableService);
        runtime.register(dependentService);
        await runtime.start();

        // Test with low counter (should succeed)
        const lowResult = await runtime.execute(
          "dependent-service",
          createTestState(1, [])
        );
        expect(lowResult.success).toBe(true);
        expect(lowResult.state.messages).toContain(
          "Dependent service succeeded"
        );

        // Test with high counter (should handle failure)
        const highResult = await runtime.execute(
          "dependent-service",
          createTestState(5, [])
        );
        expect(highResult.success).toBe(true);
        expect(highResult.state.messages).toContain(
          "Dependent service handled failure"
        );
      });
    });
  });
}
