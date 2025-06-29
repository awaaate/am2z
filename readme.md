# AM2Z v4.0 – **Autonomous Modular Orchestrator & Zero‑friction runtime**

AM2Z is a **strongly‑typed, event‑driven task‑orchestration framework** for TypeScript/Node that lets you compose highly‑concurrent, failure‑resilient workflows that can run **locally** _or_ at **cloud‑scale** on top of [BullMQ](https://docs.bullmq.io/).
It brings the ergonomics of **Rust‑style **\`\`** handling**, an **Elm‑like immutable App State**, and **builder‑style processors** to the JavaScript ecosystem without sacrificing DX.

---

## ✨ Features

- 🧩 **Declarative processors** – chain, parallel‑merge, route, batch or nest processors with one‑liner helpers.
- 🚦 **Granular error taxonomy** – retryable vs non‑retryable, business vs resource, rich metadata.
- ⏱️ **Co‑operative cancellation & time‑outs** – abort signals propagate automatically through nested calls.
- 🔗 **Local \*\*\***and**\*** Distributed runtimes** – swap between `LocalRuntime` and `QueueRuntime` by changing **one line\*\*.
- ⚡ **Dynamic processor registration** – register processors after runtime start, sync infrastructure on-demand.
- 📜 **Strict typing everywhere** – generic `AppState`, branded states, typed contexts and results.
- 🔄 **Exactly‐once state persistence** – optimistic‑locked, SHA‑256‑hashed `RedisStateManager`.
- 📊 **Metrics & Bull Board integration** – drop‑in queue dashboard via `@bull‑board`.
- 🌈 **Pluggable logging** – colored console, JSON, or silent; create child loggers with extra context.

---

\## Installation

```bash
npm install am2z bullmq ioredis zod @ai-sdk/openai express
```

> **Node 18 +** is recommended.

---

\## Quick Start (E-commerce Order Processing)

```ts
import { createProcessor, chainProcessors } from "am2z/core";
import { LocalRuntime, createAppState } from "am2z/core";
import { Success, Failure } from "am2z/core";

// Define your application state interface
interface OrderState extends AppState {
  orderId: string;
  customerId: string;
  items: Array<{ productId: string; quantity: number; price: number }>;
  total: number;
  paymentStatus: "pending" | "completed" | "failed";
  inventoryReserved: boolean;
  shippingLabel?: string;
  notifications: string[];
}

// 1️⃣ Define individual processors
const validateOrder = createProcessor<OrderState>("validate-order")
  .withDescription("Validate order data and check inventory")
  .withTimeout(5000)
  .process(async (state, ctx) => {
    ctx.log.info(`Validating order ${state.orderId}`);

    // Simulate validation logic
    if (state.items.length === 0) {
      return Failure(new Error("Order must contain at least one item"));
    }

    const total = state.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    return Success({
      ...state,
      total,
      notifications: [...state.notifications, "Order validated"],
    });
  });

const processPayment = createProcessor<OrderState>("process-payment")
  .withDescription("Process customer payment")
  .withRetryPolicy({ maxAttempts: 3, backoffMs: 1000 })
  .process(async (state, ctx) => {
    ctx.log.info(`Processing payment for order ${state.orderId}`);

    // Simulate payment processing
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return Success({
      ...state,
      paymentStatus: "completed",
      notifications: [...state.notifications, "Payment processed successfully"],
    });
  });

const reserveInventory = createProcessor<OrderState>("reserve-inventory")
  .withDescription("Reserve inventory for order items")
  .process(async (state, ctx) => {
    ctx.log.info(`Reserving inventory for order ${state.orderId}`);

    // Simulate inventory reservation
    for (const item of state.items) {
      ctx.log.debug(`Reserving ${item.quantity}x ${item.productId}`);
    }

    return Success({
      ...state,
      inventoryReserved: true,
      notifications: [...state.notifications, "Inventory reserved"],
    });
  });

// 2️⃣ Chain processors into a workflow
const orderWorkflow = chainProcessors<OrderState>({
  name: "process-order",
  processors: [validateOrder, processPayment, reserveInventory],
  timeout: 30000,
});

// 3️⃣ Create runtime and execute
const runtime = new LocalRuntime<OrderState>();
runtime.register(orderWorkflow);
await runtime.start();

// Execute the workflow
const initialState = createAppState("order-session-123", {
  orderId: "ORD-001",
  customerId: "CUST-456",
  items: [
    { productId: "PROD-1", quantity: 2, price: 29.99 },
    { productId: "PROD-2", quantity: 1, price: 15.5 },
  ],
  total: 0,
  paymentStatus: "pending" as const,
  inventoryReserved: false,
  notifications: [],
});

const result = await runtime.execute("process-order", initialState);

if (result.success) {
  console.log(`Order ${result.state.orderId} processed successfully!`);
  console.log(`Total: $${result.state.total}`);
  console.log(`Notifications: ${result.state.notifications.join(", ")}`);
} else {
  console.error(`Order processing failed: ${result.error?.message}`);
}

await runtime.stop();
```

---

\## Distributed Runtime (Image Processing Pipeline)

```ts
import { createQueueRuntimeWithDefaults } from "am2z/node/queue-runtime";
import {
  createProcessor,
  parallelProcessors,
  chainProcessors,
} from "am2z/core";
import { Success, Failure } from "am2z/core";

interface ImageProcessingState extends AppState {
  imageUrl: string;
  userId: string;
  originalSize: { width: number; height: number };
  thumbnails: Array<{ size: string; url: string }>;
  watermarkApplied: boolean;
  compressionLevel: number;
  metadata: {
    format: string;
    fileSize: number;
    processedAt: string;
  };
  processingSteps: string[];
}

// Define processors for different image operations
const generateThumbnails = createProcessor<ImageProcessingState>(
  "generate-thumbnails"
)
  .withDescription("Generate multiple thumbnail sizes")
  .withTimeout(15000)
  .withQueueConfig({ concurrency: 3 })
  .process(async (state, ctx) => {
    ctx.log.info(`Generating thumbnails for ${state.imageUrl}`);

    // Simulate thumbnail generation for different sizes
    const sizes = ["150x150", "300x300", "600x600"];
    const thumbnails = sizes.map((size) => ({
      size,
      url: `${state.imageUrl}_thumb_${size}.jpg`,
    }));

    // Simulate processing time
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return Success({
      ...state,
      thumbnails,
      processingSteps: [...state.processingSteps, "Thumbnails generated"],
    });
  });

const applyWatermark = createProcessor<ImageProcessingState>("apply-watermark")
  .withDescription("Apply watermark to image")
  .withTimeout(10000)
  .process(async (state, ctx) => {
    ctx.log.info(`Applying watermark to ${state.imageUrl}`);

    // Simulate watermark application
    await new Promise((resolve) => setTimeout(resolve, 1500));

    return Success({
      ...state,
      watermarkApplied: true,
      processingSteps: [...state.processingSteps, "Watermark applied"],
    });
  });

const optimizeCompression = createProcessor<ImageProcessingState>(
  "optimize-compression"
)
  .withDescription("Optimize image compression")
  .withTimeout(8000)
  .process(async (state, ctx) => {
    ctx.log.info(`Optimizing compression for ${state.imageUrl}`);

    // Simulate compression optimization
    await new Promise((resolve) => setTimeout(resolve, 1000));

    return Success({
      ...state,
      compressionLevel: 85,
      processingSteps: [...state.processingSteps, "Compression optimized"],
    });
  });

const extractMetadata = createProcessor<ImageProcessingState>(
  "extract-metadata"
)
  .withDescription("Extract image metadata")
  .withTimeout(5000)
  .process(async (state, ctx) => {
    ctx.log.info(`Extracting metadata from ${state.imageUrl}`);

    // Simulate metadata extraction
    await new Promise((resolve) => setTimeout(resolve, 500));

    return Success({
      ...state,
      metadata: {
        format: "JPEG",
        fileSize: 1024000,
        processedAt: new Date().toISOString(),
      },
      processingSteps: [...state.processingSteps, "Metadata extracted"],
    });
  });

// Create parallel processing for independent operations
const parallelImageOps = parallelProcessors<ImageProcessingState>({
  name: "parallel-image-processing",
  processors: [applyWatermark, optimizeCompression, extractMetadata],
  timeout: 20000,
});

// Create the complete pipeline
const imageProcessingPipeline = chainProcessors<ImageProcessingState>({
  name: "image-processing-pipeline",
  processors: [generateThumbnails, parallelImageOps],
  timeout: 45000,
});

// Setup distributed runtime
const runtime = createQueueRuntimeWithDefaults<ImageProcessingState>({
  host: "localhost",
  port: 6379,
});

runtime.register(imageProcessingPipeline);
await runtime.start();

// Process an image
const imageState = createAppState("img-session-456", {
  imageUrl: "https://example.com/uploads/photo123.jpg",
  userId: "user-789",
  originalSize: { width: 1920, height: 1080 },
  thumbnails: [],
  watermarkApplied: false,
  compressionLevel: 0,
  metadata: {
    format: "",
    fileSize: 0,
    processedAt: "",
  },
  processingSteps: [],
});

const result = await runtime.execute("image-processing-pipeline", imageState);

if (result.success) {
  console.log(`Image processed in ${result.executionTime}ms`);
  console.log(`Generated ${result.state.thumbnails.length} thumbnails`);
  console.log(`Processing steps: ${result.state.processingSteps.join(" → ")}`);
} else {
  console.error(`Image processing failed: ${result.error?.message}`);
}

await runtime.stop();
await runtime.disconnect();
```

### Dynamic Processor Registration (Multi-tenant SaaS)

```ts
import { createQueueRuntimeWithDefaults } from "am2z/node/queue-runtime";
import { createProcessor, batchProcessor, routeProcessor } from "am2z/core";
import { Success, Failure } from "am2z/core";

interface TenantState extends AppState {
  tenantId: string;
  userId: string;
  action: string;
  data: any;
  notifications: Array<{
    type: "email" | "sms" | "push" | "webhook";
    status: "pending" | "sent" | "failed";
    recipient: string;
  }>;
  features: string[];
}

const runtime = createQueueRuntimeWithDefaults<TenantState>();

// Register core processors available to all tenants
const sendEmail = createProcessor<TenantState>("send-email")
  .withDescription("Send email notification")
  .withRetryPolicy({ maxAttempts: 3, backoffMs: 2000 })
  .process(async (state, ctx) => {
    ctx.log.info(`Sending email for tenant ${state.tenantId}`);

    // Simulate email sending
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const updatedNotifications = state.notifications.map((n) =>
      n.type === "email" ? { ...n, status: "sent" as const } : n
    );

    return Success({
      ...state,
      notifications: updatedNotifications,
    });
  });

const basicAnalytics = createProcessor<TenantState>("basic-analytics")
  .withDescription("Basic analytics processing")
  .process(async (state, ctx) => {
    ctx.log.info(`Processing basic analytics for ${state.tenantId}`);
    return Success(state);
  });

runtime.register(sendEmail);
runtime.register(basicAnalytics);
await runtime.start();

// ✅ Dynamic registration based on tenant configuration
async function enableTenantFeatures(tenantId: string, features: string[]) {
  const newProcessors = [];

  if (features.includes("advanced-analytics")) {
    const advancedAnalytics = createProcessor<TenantState>("advanced-analytics")
      .withDescription("Advanced analytics with ML")
      .withTimeout(30000)
      .withQueueConfig({ concurrency: 2 })
      .process(async (state, ctx) => {
        ctx.log.info(`Running advanced analytics for tenant ${state.tenantId}`);

        // Simulate ML processing
        await new Promise((resolve) => setTimeout(resolve, 5000));

        return Success({
          ...state,
          data: { ...state.data, mlInsights: "Generated insights" },
        });
      });
    newProcessors.push(advancedAnalytics);
  }

  if (features.includes("sms-notifications")) {
    const sendSms = createProcessor<TenantState>("send-sms")
      .withDescription("Send SMS notifications")
      .withRetryPolicy({ maxAttempts: 5, backoffMs: 1000 })
      .process(async (state, ctx) => {
        ctx.log.info(`Sending SMS for tenant ${state.tenantId}`);

        const updatedNotifications = state.notifications.map((n) =>
          n.type === "sms" ? { ...n, status: "sent" as const } : n
        );

        return Success({
          ...state,
          notifications: updatedNotifications,
        });
      });
    newProcessors.push(sendSms);
  }

  if (features.includes("webhook-integration")) {
    const webhookProcessor = createProcessor<TenantState>(
      "webhook-notifications"
    )
      .withDescription("Send webhook notifications")
      .withTimeout(10000)
      .process(async (state, ctx) => {
        ctx.log.info(`Sending webhook for tenant ${state.tenantId}`);

        // Simulate webhook call
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const updatedNotifications = state.notifications.map((n) =>
          n.type === "webhook" ? { ...n, status: "sent" as const } : n
        );

        return Success({
          ...state,
          notifications: updatedNotifications,
        });
      });
    newProcessors.push(webhookProcessor);
  }

  // ✅ Register new processors dynamically
  if (newProcessors.length > 0) {
    runtime.registerMany(newProcessors);
    await runtime.syncProcessors();
    console.log(
      `Enabled features for tenant ${tenantId}: ${features.join(", ")}`
    );
  }
}

// ✅ Batch processing for multiple user actions
const userActionBatch = batchProcessor<TenantState>({
  name: "process-user-actions",
  processorName: "basic-analytics",
  payloads: [
    createAppState("action-1", {
      tenantId: "tenant-123",
      userId: "user-1",
      action: "page_view",
      data: { page: "/dashboard" },
      notifications: [],
      features: [],
    }),
    createAppState("action-2", {
      tenantId: "tenant-123",
      userId: "user-2",
      action: "button_click",
      data: { button: "export" },
      notifications: [],
      features: [],
    }),
  ],
});

runtime.register(userActionBatch);
await runtime.syncProcessors();

// Example usage: Enable features for different tenants
await enableTenantFeatures("tenant-premium", [
  "advanced-analytics",
  "sms-notifications",
]);
await enableTenantFeatures("tenant-enterprise", [
  "advanced-analytics",
  "webhook-integration",
]);

// Check if features are available before using
if (runtime.isProcessorRegistered("advanced-analytics")) {
  const premiumState = createAppState("premium-session", {
    tenantId: "tenant-premium",
    userId: "user-123",
    action: "data_analysis",
    data: { dataset: "sales_data_2024" },
    notifications: [],
    features: ["advanced-analytics"],
  });

  const result = await runtime.execute("advanced-analytics", premiumState);
  console.log("Premium analytics completed:", result.success);
}
```

---

# Architecture Overview

```text
┌────────────────────┐          ┌───────────────────┐
│   Your Processors  │◀────────▶│   Processor API   │
└────────────────────┘          └─────────▲─────────┘
                                         │
          Local                Distributed│(BullMQ)
┌────────────────────┐          ┌─────────┴─────────┐
│   LocalRuntime     │          │   QueueRuntime    │
│ (in‑process)       │          │  + QueueManager   │
└────────┬───────────┘          │  + WorkerManager  │
         │                      │  + ResultCollector│
         ▼                      └─────────┬─────────┘
  ProcessorExecutor ← shared logic        │
         │                                ▼
  StateManager (Mem/Redis)        Redis + BullMQ Queues
```

_Both runtimes share the \***\*ProcessorExecutor\*\***, guaranteeing identical semantics no matter where code runs._

---

# Core Concepts & API Reference

| Function                                                                | Description                       |
| ----------------------------------------------------------------------- | --------------------------------- |
| `Success(data)`                                                         | Wrap successful payload.          |
| `Failure(err)`                                                          | Wrap error payload.               |
| `isSuccess(result)` / `isFailure(result)`                               | Type guards.                      |
| `matchResult`, `mapResult`, `mapError`, `chainResult`, `combineResults` | Functional utilities.             |
| `safeAsync`, `safeSync`                                                 | Turn thrown errors into `Result`. |

Hierarchical classes – all extend \`\`:

- Validation: `ValidationError`
- Execution: `ProcessorNotFoundError`, `ProcessorExecutionError`, `CallDepthExceededError`
- Timeout: `TimeoutError`
- Resource: `ResourceError`
- Network: `NetworkError`
- Configuration: `ConfigurationError`
- Business: `BusinessError`

Utility helpers: `isRetryableError`, `extractErrorDetails`, `wrapAsProcessorError`, `getRootCause`, …

- `createLogger(baseCtx?, level?, formatter?, source?)` → `Logger`
  - Methods: `debug | info | warn | error`, `withContext`, `withSource`.

- Formatters: `createColoredFormatter`, `createJsonFormatter`, `createSilentLogger`.

### Builder

```ts
// Define your state interface extending AppState
interface MyAppState extends AppState {
  userId: string;
  data: any;
  // ... your custom fields
}

createProcessor<MyAppState>(name)
  .withDescription(text)
  .withTimeout(ms)          // adds SERVER_OVERHEAD_MS automatically
  .withRetryPolicy({ maxAttempts, backoffMs, shouldRetry?, … })
  .withQueueConfig({ priority?, concurrency?, rateLimitRpm? })
  .process(async (state, ctx) => Success(updatedState) | Failure(error))
```

### Context (`ProcessorContext`)

| Field                  | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `log`                  | Child `Logger`.                                            |
| `meta`                 | `{ processorName, executionId, sessionId, … }`.            |
| `call(proc, newState)` | Execute _another_ processor (may spawn nested BullMQ job). |
| `emit(event, data)`    | Custom domain events.                                      |
| `callDepth`            | Current depth (auto‑tracked).                              |
| `signal`               | `AbortSignal` for cooperative cancel.                      |

### Composition helpers

| Helper                                                  | Semantics                                       |
| ------------------------------------------------------- | ----------------------------------------------- |
| `chainProcessors({ name, processors, timeout? })`       | Sequential pipeline (short‑circuit on Failure). |
| `parallelProcessors({ name, processors, timeout? })`    | Fan‑out / merge – fails if any child fails.     |
| `routeProcessor(name, selectorFn, routeMap, fallback?)` | Dynamic branch by state.                        |
| `batchProcessor({ name, processorName, payloads })`     | Execute same processor with multiple payloads.  |

- `createAppState(sessionId, extra?)` → initial immutable state.
- `updateStateMetadata(state)` → bump version/timestamps.
- Generic `StateManager` interface – implementations:
  - In‑memory (implicit) for `LocalRuntime`.
  - \`\` (distributed, SHA‑256 integrity, optimistic CAS).

- Helpers: `createNonEmptyArray`, `isBrandedState`, branded types.

### 6.1 LocalRuntime (`core/runtime.ts`)

| Method                             | Purpose                           |
| ---------------------------------- | --------------------------------- |
| `register(proc)`                   | Add processor (& deps).           |
| `unregister(name)`                 | Remove.                           |
| `start()` / `stop()`               |                                   |
| `execute(name, state, sessionId?)` |                                   |
| `getStats()`                       | Running/completed/failed, uptime. |

### 6.2 QueueRuntime (`node/queue-runtime.ts`)

Extends `ProcessorRuntime` + distributed goodies.

| Method                                                                | Purpose                                             |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `register`, `unregister`, `start`, `stop`, `execute`, _same as Local_ |                                                     |
| `executeMany(name, states, sessionId?)`                               | Bulk fan‑out.                                       |
| `syncProcessors()`                                                    | Create infrastructure for registered processors.    |
| `registerMany(processors)`                                            | Register multiple processors at once.               |
| `isProcessorRegistered(name)`                                         | Check if processor is registered.                   |
| `getRegisteredProcessorNames()`                                       | Get list of registered processor names.             |
| `cleanAllQueues()`                                                    |                                                     |
| `disconnect()`                                                        | Close Redis.                                        |
| `getQueues()` / `getProcessors()`                                     |                                                     |
| `getStats()` → includes per‑queue counts.                             |                                                     |
| `on(event, fn)` / `off(event, fn)`                                    | Subscribe to `processor:*`, `queue:*`, `metrics:*`. |

**Factory helpers**:
`createQueueRuntime(config, logger?)` | `createQueueRuntimeWithDefaults(redisOverrides?, runtimeOverrides?, logger?)`

### Config objects

- `QueueRuntimeConfig`: `{ queuePrefix?, redis, worker?, queue?, monitoring?, errorHandling?, runtime? }`
- `MonitoringConfig`: enable queue events, metrics, interval.
- `WorkerConfig`, `QueueConfig` (per‑queue defaults), `RuntimeConfig` (timeouts, depth).

| Component             | Key Methods                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **ConnectionManager** | `getConnection(purpose)`, `healthCheck()`, `disconnect()`, `getStatus()`                                                         |
| **QueueManager**      | `createQueue(proc)`, `getQueue(name)`, `getAllQueues()`, `removeQueue(name)`, `closeAll()`, `getQueueStats(name?)`, `cleanAll()` |
| **WorkerManager**     | `createWorker(proc)`, `getWorker(name)`, `removeWorker(name)`, `closeAll()`                                                      |
| **ResultCollector**   | `waitForResult(executionId, timeout?)`, `getStats()`, `cleanup()`, `cleanupStale(maxAge)`                                        |
| **JobOptionsBuilder** | fluent: `withPriority`, `withAttempts`, `withBackoff`, `withDelay`, `withJobId`, `withTimeout`, `withMetadata`, `build()`        |
| **RedisStateManager** | `get`, `set`, `update`, `exists`, `delete`, `getVersion`                                                                         |

---

\## Examples (`src/examples/`)

### 1. `ai-app-generator.ts` – _End‑to‑end workflow_

- Analyses natural‑language requirements via OpenAI.
- Generates **frontend**, **backend**, **database schema** in parallel.
- Produces docs, deployment config, QA score, and final assembly.
- Shows nested chains (`chainProcessors`) + parallel fan‑out (`parallelProcessors`).

> Run it standalone:
>
> ```bash
> bun run src/examples/ai-app-generator.ts
> ```

### 2. `ai-server.ts` – _Express + Bull Board_

- Exposes REST endpoints `/api/generate`, `/api/status`, `/admin/queues`.
- Shares a single `QueueRuntime` across requests.
- Demonstrates **Bull Board** integration for live monitoring.

---

\## Advanced Usage

### Parallel throttling & rate‑limits

Use `QueueConfig.rateLimitRpm` or the runtime‑wide `QueueConfig` to prevent API over‑use.

### Automatic retries

Configure at processor‑level via `withRetryPolicy({ maxAttempts, backoffMs, shouldRetry })` – failures bubble up as `ProcessorExecutionError` preserving partial state.

### Call depth safety

Recursive workflows are limited by `RuntimeConfig.maxCallDepth` (default 10) – exceeding throws `CallDepthExceededError`.

### Cooperative cancellation

`context.signal.aborted` is set when a parent times out (local) or when a BullMQ timeout is hit (distributed).

### Batch processing

Execute the same processor multiple times with different payloads. Perfect for financial transactions, data migrations, or bulk API calls:

```ts
interface TransactionState extends AppState {
  transactionId: string;
  amount: number;
  currency: string;
  fromAccount: string;
  toAccount: string;
  status: "pending" | "processing" | "completed" | "failed";
  fees: number;
  exchangeRate?: number;
}

const processTransaction = createProcessor<TransactionState>(
  "process-transaction"
)
  .withDescription("Process individual financial transaction")
  .withTimeout(10000)
  .withRetryPolicy({ maxAttempts: 3, backoffMs: 2000, concurrency: 10 })
  .process(async (state, ctx) => {
    ctx.log.info(`Processing transaction ${state.transactionId}`);

    // Simulate transaction validation
    if (state.amount <= 0) {
      return Failure(new Error("Invalid transaction amount"));
    }

    // Simulate processing time based on amount
    const processingTime = Math.min(state.amount / 1000, 3000);
    await new Promise((resolve) => setTimeout(resolve, processingTime));

    // Calculate fees (0.5% of amount)
    const fees = state.amount * 0.005;

    return Success({
      ...state,
      status: "completed" as const,
      fees,
      exchangeRate: state.currency !== "USD" ? 1.1 : undefined,
    });
  });

// Create batch for processing multiple transactions
const transactionBatch = batchProcessor<TransactionState>({
  name: "process-transaction-batch",
  processorName: "process-transaction",
  payloads: [
    createAppState("txn-1", {
      transactionId: "TXN-001",
      amount: 1000,
      currency: "USD",
      fromAccount: "ACC-123",
      toAccount: "ACC-456",
      status: "pending" as const,
      fees: 0,
    }),
    createAppState("txn-2", {
      transactionId: "TXN-002",
      amount: 2500,
      currency: "EUR",
      fromAccount: "ACC-789",
      toAccount: "ACC-012",
      status: "pending" as const,
      fees: 0,
    }),
    createAppState("txn-3", {
      transactionId: "TXN-003",
      amount: 750,
      currency: "USD",
      fromAccount: "ACC-345",
      toAccount: "ACC-678",
      status: "pending" as const,
      fees: 0,
    }),
  ],
});

runtime.register(processTransaction);
runtime.register(transactionBatch);
await runtime.syncProcessors();

// Process all transactions in parallel
const batchResult = await runtime.execute(
  "process-transaction-batch",
  createAppState("batch-session", {})
);

if (batchResult.success) {
  console.log(`Processed ${transactionBatch.payloads.length} transactions`);
  console.log(`Total execution time: ${batchResult.executionTime}ms`);
}
```

### Dynamic registration

Register processors after runtime has started, perfect for plugin architectures, A/B testing, or feature flags:

```ts
interface ContentState extends AppState {
  contentId: string;
  content: string;
  author: string;
  moderationFlags: string[];
  sentiment?: "positive" | "negative" | "neutral";
  aiSummary?: string;
  contentType: "post" | "comment" | "article";
}

// Core content processing (always available)
const basicModeration = createProcessor<ContentState>("basic-moderation")
  .withDescription("Basic content moderation")
  .process(async (state, ctx) => {
    ctx.log.info(`Moderating content ${state.contentId}`);

    // Basic profanity filter
    const hasProfanity = /bad|inappropriate/i.test(state.content);
    const flags = hasProfanity ? ["profanity"] : [];

    return Success({
      ...state,
      moderationFlags: [...state.moderationFlags, ...flags],
    });
  });

runtime.register(basicModeration);
await runtime.start();

// ✅ Register AI-powered features based on configuration
async function enableAIFeatures(aiConfig: {
  sentiment: boolean;
  summarization: boolean;
}) {
  const aiProcessors = [];

  if (aiConfig.sentiment) {
    const sentimentAnalysis = createProcessor<ContentState>(
      "sentiment-analysis"
    )
      .withDescription("AI-powered sentiment analysis")
      .withTimeout(15000)
      .withQueueConfig({ concurrency: 5 })
      .process(async (state, ctx) => {
        ctx.log.info(`Analyzing sentiment for ${state.contentId}`);

        // Simulate AI API call
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Simple sentiment logic (in real app, call AI service)
        const positiveWords = /good|great|awesome|excellent/i;
        const negativeWords = /bad|terrible|awful|horrible/i;

        let sentiment: "positive" | "negative" | "neutral" = "neutral";
        if (positiveWords.test(state.content)) sentiment = "positive";
        if (negativeWords.test(state.content)) sentiment = "negative";

        return Success({ ...state, sentiment });
      });
    aiProcessors.push(sentimentAnalysis);
  }

  if (aiConfig.summarization) {
    const aiSummarization = createProcessor<ContentState>("ai-summarization")
      .withDescription("AI content summarization")
      .withTimeout(20000)
      .withQueueConfig({ concurrency: 3 })
      .process(async (state, ctx) => {
        ctx.log.info(`Summarizing content ${state.contentId}`);

        // Simulate AI summarization
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const summary =
          state.content.length > 100
            ? state.content.substring(0, 100) + "... [AI Summary]"
            : state.content;

        return Success({ ...state, aiSummary: summary });
      });
    aiProcessors.push(aiSummarization);
  }

  if (aiProcessors.length > 0) {
    runtime.registerMany(aiProcessors);
    await runtime.syncProcessors();
    console.log(
      `AI features enabled: ${Object.keys(aiConfig)
        .filter((k) => aiConfig[k])
        .join(", ")}`
    );
  }
}

// ✅ Router for different content types
const contentRouter = routeProcessor<ContentState>(
  "content-router",
  (state) => state.contentType,
  {
    post: basicModeration,
    comment: basicModeration,
    article: runtime.isProcessorRegistered("ai-summarization")
      ? createProcessor<ContentState>("article-workflow").process(
          async (state, ctx) => {
            // Chain: basic moderation → AI summarization
            const moderated = await ctx.call("basic-moderation", state);
            if (!moderated.success) return moderated;

            return await ctx.call("ai-summarization", moderated.state);
          }
        )
      : basicModeration,
  }
);

// Enable AI features based on environment/config
const isProduction = process.env.NODE_ENV === "production";
const hasAIBudget = process.env.AI_ENABLED === "true";

if (hasAIBudget) {
  await enableAIFeatures({
    sentiment: true,
    summarization: isProduction,
  });
}

runtime.register(contentRouter);
await runtime.syncProcessors();

// Usage example
const articleState = createAppState("content-session", {
  contentId: "ART-123",
  content:
    "This is a great article about distributed systems. It covers many important concepts...",
  author: "john@example.com",
  moderationFlags: [],
  contentType: "article" as const,
});

const result = await runtime.execute("content-router", articleState);

if (result.success) {
  console.log(`Content processed: ${result.state.contentId}`);
  console.log(`Moderation flags: ${result.state.moderationFlags.join(", ")}`);
  if (result.state.sentiment)
    console.log(`Sentiment: ${result.state.sentiment}`);
  if (result.state.aiSummary) console.log(`Summary: ${result.state.aiSummary}`);
}
```

---

\## Dashboard & Monitoring

### Bull Board Dashboard

Monitor your AM2Z distributed queues in real-time using Bull Board, a beautiful web interface for BullMQ:

#### Installation

```bash
npm install @bull-board/express @bull-board/api express
# or
bun add @bull-board/express @bull-board/api express
```

#### Basic Setup

Create a monitoring server that connects to your AM2Z queues:

```ts
// dashboard-server.ts
import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { createQueueRuntimeWithDefaults } from "am2z/node/queue-runtime";
import { createProcessor } from "am2z/core";

interface MonitoringState extends AppState {
  taskId: string;
  status: string;
  progress: number;
  result?: any;
}

// Create your AM2Z runtime with processors
const runtime = createQueueRuntimeWithDefaults<MonitoringState>({
  host: "localhost",
  port: 6379,
});

// Example processors for demonstration
const dataProcessor = createProcessor<MonitoringState>("data-processor")
  .withDescription("Process data with progress tracking")
  .withTimeout(30000)
  .withQueueConfig({ concurrency: 5 })
  .process(async (state, ctx) => {
    ctx.log.info(`Processing data for task ${state.taskId}`);

    // Simulate long-running work with progress
    for (let i = 0; i <= 100; i += 10) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      ctx.log.debug(`Progress: ${i}%`);
    }

    return Success({
      ...state,
      status: "completed",
      progress: 100,
      result: { processedAt: new Date().toISOString() },
    });
  });

const emailProcessor = createProcessor<MonitoringState>("email-sender")
  .withDescription("Send email notifications")
  .withRetryPolicy({ maxAttempts: 3, backoffMs: 2000 })
  .process(async (state, ctx) => {
    ctx.log.info(`Sending email for task ${state.taskId}`);

    // Simulate email sending
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return Success({
      ...state,
      status: "email_sent",
    });
  });

runtime.register(dataProcessor);
runtime.register(emailProcessor);

// Start the runtime
await runtime.start();

// Get the BullMQ queues from AM2Z runtime
const queues = runtime.getQueues();

// Create Bull Board dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: queues.map((queue) => new BullMQAdapter(queue)),
  serverAdapter,
});

// Create Express app
const app = express();

// Add Bull Board routes
app.use("/admin/queues", serverAdapter.getRouter());

// Optional: Add basic authentication
app.use("/admin", (req, res, next) => {
  const auth = req.headers.authorization;

  if (!auth) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin"');
    return res.status(401).send("Authentication required");
  }

  const credentials = Buffer.from(auth.split(" ")[1], "base64").toString();
  const [username, password] = credentials.split(":");

  // Change these credentials!
  if (username === "admin" && password === "your-secure-password") {
    next();
  } else {
    res.status(401).send("Invalid credentials");
  }
});

// API endpoints to trigger jobs (for testing)
app.use(express.json());

app.post("/api/process-data", async (req, res) => {
  try {
    const { taskId, data } = req.body;

    const state = createAppState(`task-${taskId}`, {
      taskId,
      status: "pending",
      progress: 0,
      data,
    });

    const result = await runtime.execute("data-processor", state);
    res.json({
      success: result.success,
      executionId: result.metadata.executionId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/send-email", async (req, res) => {
  try {
    const { taskId, recipient } = req.body;

    const state = createAppState(`email-${taskId}`, {
      taskId,
      status: "pending",
      progress: 0,
      recipient,
    });

    const result = await runtime.execute("email-sender", state);
    res.json({
      success: result.success,
      executionId: result.metadata.executionId,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
app.get("/health", async (req, res) => {
  const stats = await runtime.getStats();
  res.json({
    status: "healthy",
    queues: stats.queueStats,
    uptime: stats.uptime,
    registeredProcessors: stats.registeredProcessors,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard server running on http://localhost:${PORT}`);
  console.log(`Bull Board available at http://localhost:${PORT}/admin/queues`);
  console.log(`Health check at http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  await runtime.stop();
  await runtime.disconnect();
  process.exit(0);
});
```

#### Production Configuration

For production environments, add proper security and configuration:

```ts
// production-dashboard.ts
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createQueueRuntimeWithDefaults } from "am2z/node/queue-runtime";

const app = express();

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use("/admin", limiter);

// Configure AM2Z with production settings
const runtime = createQueueRuntimeWithDefaults(
  {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || "0"),
  },
  {
    defaultTimeout: 300000, // 5 minutes
    maxCallDepth: 15,
  }
);

// JWT-based authentication (example)
import jwt from "jsonwebtoken";

app.use("/admin", (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Token required" });
  }

  try {
    jwt.verify(token, process.env.JWT_SECRET!);
    next();
  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }
});

// Environment-specific processor registration
if (process.env.NODE_ENV === "production") {
  // Register only production processors
  runtime.registerMany([criticalProcessor, auditProcessor]);
} else {
  // Register development/testing processors
  runtime.registerMany([testProcessor, debugProcessor]);
}

await runtime.syncProcessors();
```

#### What You'll See

The Bull Board dashboard provides:

- **📊 Queue Overview**: Active, waiting, completed, and failed job counts
- **🔍 Job Details**: Individual job data, progress, logs, and errors
- **⚡ Real-time Updates**: Live monitoring of job status changes
- **🔄 Job Management**: Retry failed jobs, clean old jobs, pause/resume queues
- **📈 Statistics**: Processing rates, job duration metrics
- **🎯 Job Search**: Filter and search jobs by status, date, or custom criteria

#### Access URLs

Once running, you can access:

- **Dashboard**: `http://localhost:3000/admin/queues`
- **API Health**: `http://localhost:3000/health`
- **Trigger Jobs**: `POST http://localhost:3000/api/process-data`

#### Docker Deployment

Create a `docker-compose.yml` for easy deployment:

```yaml
version: "3.8"

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  am2z-dashboard:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - JWT_SECRET=your-super-secret-jwt-key
    depends_on:
      - redis
    restart: unless-stopped

volumes:
  redis_data:
```

#### Security Best Practices

1. **Authentication**: Always require authentication for the dashboard
2. **HTTPS**: Use HTTPS in production with proper SSL certificates
3. **Network**: Restrict dashboard access to internal networks only
4. **Credentials**: Use environment variables for all credentials
5. **Rate Limiting**: Implement rate limiting to prevent abuse
6. **Monitoring**: Set up alerts for queue failures and high loads

---

\## Troubleshooting

| Symptom                            | Resolution                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Jobs stuck in "waiting"**        | Check Redis connectivity; ensure `QueueRuntime.start()` has been awaited.                         |
| **"Processor ... not found"**      | Call `runtime.register()` for every processor (deps are auto‑registered).                         |
| **Timeouts too aggressive**        | Adjust `processor.withTimeout(ms)` **plus** overhead, or increase `RuntimeConfig.defaultTimeout`. |
| **Call depth exceeded**            | Redesign workflow or raise `RuntimeConfig.maxCallDepth`.                                          |
| **Dynamic processors not working** | Call `await runtime.syncProcessors()` after registering new processors.                           |
| **Batch processor fails**          | Ensure target processor is registered and payloads array is not empty.                            |

---

\## Best Practices

### State Management

Always extend `AppState` for your custom state interfaces:

```ts
interface OrderState extends AppState {
  orderId: string;
  customerId: string;
  items: OrderItem[];
  status: OrderStatus;
  // ... other fields
}

// ✅ Good: Strongly typed processors
const processor = createProcessor<OrderState>("process-order").process(
  async (state, ctx) => {
    // state is fully typed as OrderState
    return Success({
      ...state,
      status: "completed", // TypeScript knows this is valid
    });
  }
);
```

### Error Handling

Use specific error types and proper error propagation:

```ts
import { BusinessError, ValidationError } from "am2z/core";

const validator = createProcessor<OrderState>("validate-order").process(
  async (state, ctx) => {
    if (!state.customerId) {
      return Failure(
        new ValidationError(
          "customerId",
          state.customerId,
          "Customer ID is required"
        )
      );
    }

    if (state.items.length === 0) {
      return Failure(
        new BusinessError("EMPTY_ORDER", "Order must contain at least one item")
      );
    }

    return Success(state);
  }
);
```

### Dynamic Registration Patterns

Use feature flags and configuration-driven processor registration:

```ts
// Configuration-driven registration
const features = {
  aiFeatures: process.env.AI_ENABLED === "true",
  premiumFeatures: user.tier === "premium",
  experimentalFeatures: process.env.EXPERIMENTAL === "true",
};

// Register processors based on features
if (features.aiFeatures) {
  runtime.registerMany([sentimentAnalysis, aiSummarization]);
}

if (features.premiumFeatures) {
  runtime.registerMany([advancedAnalytics, prioritySupport]);
}

await runtime.syncProcessors();
```

### Performance Optimization

Configure concurrency and timeouts based on your workload:

```ts
const heavyProcessor = createProcessor<DataState>("heavy-computation")
  .withTimeout(60000) // 1 minute for heavy work
  .withQueueConfig({
    concurrency: 2, // Limit concurrent executions
    rateLimitRpm: 100, // Rate limit API calls
  })
  .withRetryPolicy({
    maxAttempts: 2, // Don't retry expensive operations too much
    backoffMs: 5000, // Longer backoff for heavy work
  });

const lightProcessor = createProcessor<EventState>("log-event")
  .withTimeout(5000) // Quick timeout for simple operations
  .withQueueConfig({
    concurrency: 20, // Higher concurrency for simple tasks
  });
```

---

\## Contributing

1. Fork ✂️ & clone.
2. `npm ci`
3. Run tests (coming soon).
4. Send PR with conventional commits.

Please read `CONTRIBUTING.md` for coding guidelines and our code of conduct.

---

\## License

MIT © 2025 AM2Z Contributors – do _amazing_ things.
