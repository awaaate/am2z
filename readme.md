# AM2Z

A modern TypeScript framework for building scalable, type-safe processor workflows that run **locally** or **distributed** with **complete session isolation**.

## Table of Contents

- [Why AM2Z?](#why-am2z)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Step-by-Step Guide](#step-by-step-guide)
- [Processor Composition](#processor-composition)
- [Session Management](#session-management)
- [Monitoring & Observability](#monitoring--observability)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Real-World Examples](#real-world-examples)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Performance](#performance)

## Why AM2Z?

### 🎯 **One Codebase, Two Runtimes**
Write once, run anywhere - same processors work locally (in-memory) or distributed (Redis/BullMQ)

### 🔒 **Complete Session Isolation**
Every workflow gets isolated queues, workers, and state - perfect for multi-tenant applications

### 🛡️ **Type-Safe & Robust**
Full TypeScript support with Rust-style Result types that eliminate exceptions

### 📊 **Production Ready**
Built-in monitoring, resource limits, error recovery, and Bull Board integration

### ⚡ **Composable Architecture**
Chain, parallelize, route, and batch processors with powerful composition patterns

---

## Quick Start

### Installation

```bash
npm install am2z bullmq ioredis zod
```

### Hello World

```typescript
import { createProcessor, LocalRuntime, createAppState, Success } from "am2z";

// 1. Define your state interface
interface MyState extends AppState {
  count: number;
  message: string;
}

// 2. Create a processor
const incrementer = createProcessor<MyState>("increment")
  .process(async (state, ctx) => {
    ctx.log.info(`Processing count: ${state.count}`);
    
    return Success({
      ...state,
      count: state.count + 1,
      message: `Count is now ${state.count + 1}`
    });
  });

// 3. Create runtime and execute
const runtime = new LocalRuntime<MyState>();
runtime.register(incrementer);
await runtime.start();

const initialState = createAppState("my-session", {
  count: 0,
  message: "Starting"
});

const result = await runtime.execute("increment", initialState);

if (result.success) {
  console.log(result.state.message); // "Count is now 1"
} else {
  console.error("Failed:", result.error);
}

await runtime.stop();
```

---

## Core Concepts

### 🏗️ **Architecture Overview**

AM2Z follows a **React-inspired** functional architecture:

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                    │
├─────────────────────────────────────────────────────────┤
│  Processors (like React Components)                    │
│  ├── State Transformations                             │
│  ├── Business Logic                                    │
│  └── Error Handling                                    │
├─────────────────────────────────────────────────────────┤
│  Composition Layer                                      │
│  ├── Chains (Sequential)                               │
│  ├── Parallel (Concurrent)                             │
│  ├── Routes (Conditional)                              │
│  └── Batches (Multiple Payloads)                       │
├─────────────────────────────────────────────────────────┤
│  Runtime Layer                                          │
│  ├── LocalRuntime (In-Memory)                          │
│  └── QueueRuntime (Distributed)                        │
├─────────────────────────────────────────────────────────┤
│  Infrastructure Layer                                   │
│  ├── Session Isolation                                 │
│  ├── State Management                                  │
│  ├── Error Recovery                                    │
│  └── Monitoring                                        │
└─────────────────────────────────────────────────────────┘
```

### 📦 **State Management**

All state in AM2Z is **immutable** and **versioned**:

```typescript
interface AppState {
  metadata: {
    version: number;
    sessionId: string;
    lastUpdated: string;
    createdAt: string;
  };
}

// Your state extends AppState
interface OrderState extends AppState {
  orderId: string;
  items: OrderItem[];
  total: number;
  status: "pending" | "processing" | "completed" | "failed";
}
```

### 🎯 **Result Types (No Exceptions)**

AM2Z uses **Rust-style Result types** for error handling:

```typescript
import { Success, Failure, ValidationError } from "am2z";

// Instead of throwing exceptions
const processor = createProcessor<OrderState>("validate-order")
  .process(async (state, ctx) => {
    if (state.items.length === 0) {
      return Failure(new ValidationError("items", [], "Order must have items"));
    }
    
    if (state.total <= 0) {
      return Failure(new ValidationError("total", state.total, "Total must be positive"));
    }
    
    return Success({
      ...state,
      status: "processing"
    });
  });
```

### 🔧 **Processors**

Processors are **pure functions** that transform state:

```typescript
const processor = createProcessor<MyState>("my-processor")
  .withDescription("What this processor does")
  .withTimeout(30000)                    // 30 second timeout
  .withRetryPolicy({                     // Retry configuration
    maxAttempts: 3,
    backoffMs: 1000,
    shouldRetry: (error) => !error.isCritical
  })
  .withQueueConfig({                     // Distributed queue settings
    concurrency: 5,
    priority: 10
  })
  .process(async (state, ctx) => {
    // Your business logic here
    // ctx provides: log, metadata, call, emit
    
    return Success(newState);
  });
```

---

## Step-by-Step Guide

### Step 1: Local Development

Start with **LocalRuntime** for development and simple use cases:

```typescript
import { LocalRuntime, createProcessor, Success } from "am2z";

interface UserState extends AppState {
  userId: string;
  email: string;
  isVerified: boolean;
}

const emailValidator = createProcessor<UserState>("validate-email")
  .process(async (state, ctx) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(state.email)) {
      return Failure(new ValidationError("email", state.email, "Invalid email format"));
    }
    
    return Success({
      ...state,
      isVerified: true
    });
  });

// Create and run
const runtime = new LocalRuntime<UserState>();
runtime.register(emailValidator);
await runtime.start();

const state = createAppState("user-123", {
  userId: "123",
  email: "user@example.com",
  isVerified: false
});

const result = await runtime.execute("validate-email", state);
console.log("Email verified:", result.success);

await runtime.stop();
```

### Step 2: Scale to Distributed

**Zero code changes** - just swap the runtime:

```typescript
import { createQueueRuntimeWithDefaults } from "am2z";

// Same processors, different runtime
const runtime = createQueueRuntimeWithDefaults<UserState>({
  host: "localhost",
  port: 6379
});

// Same registration
runtime.register(emailValidator);
await runtime.start();

// Same execution API
const result = await runtime.execute("validate-email", state);
```

### Step 3: Add Session Isolation

For **multi-tenant** or **concurrent** workloads:

```typescript
const sessionId = `user-${userId}-${Date.now()}`;

// Each session gets isolated infrastructure
const result = await runtime.executeInSession(
  "validate-email", 
  state, 
  sessionId
);

// Clean up when done
await runtime.stopSession(sessionId);
```

### Step 4: Chain Multiple Processors

Build **workflows** with multiple steps:

```typescript
const userRegistration = chainProcessors<UserState>({
  name: "user-registration",
  processors: [
    emailValidator,
    passwordValidator,
    userCreator,
    welcomeEmailSender
  ],
  timeout: 60000 // 1 minute total
});

runtime.register(userRegistration);

const result = await runtime.executeInSession(
  "user-registration", 
  initialState, 
  sessionId
);
```

---

## Processor Composition

### 🔗 **Sequential Chains**

Execute processors **one after another**:

```typescript
const orderProcessing = chainProcessors<OrderState>({
  name: "process-order",
  processors: [
    validateOrder,
    calculateTax,
    processPayment,
    createShipment,
    sendConfirmation
  ],
  timeout: 300000 // 5 minutes total
});
```

### ⚡ **Parallel Execution**

Run processors **concurrently**:

```typescript
const imageProcessing = parallelProcessors<ImageState>({
  name: "process-image",
  processors: [
    generateThumbnail,
    extractMetadata,
    virusScan,
    generateAltText
  ],
  mergeFunction: (results) => ({
    ...results[0].state,
    thumbnail: results[0].state.thumbnail,
    metadata: results[1].state.metadata,
    scanResult: results[2].state.scanResult,
    altText: results[3].state.altText
  })
});
```

### 🔀 **Dynamic Routing**

**Conditionally** execute different processors:

```typescript
const documentProcessor = routeProcessor<DocumentState>(
  "process-document",
  (state) => state.documentType, // Route selector
  {
    "pdf": pdfProcessor,
    "image": imageProcessor,
    "text": textProcessor,
    "video": videoProcessor
  },
  fallbackProcessor // Optional default
);
```

### 📦 **Batch Processing**

Process **multiple payloads** with the same processor:

```typescript
const batchEmailSender = batchProcessor<EmailState>({
  name: "send-batch-emails",
  processorName: "send-email",
  payloads: [
    createAppState("email-1", { to: "user1@example.com", subject: "Welcome" }),
    createAppState("email-2", { to: "user2@example.com", subject: "Welcome" }),
    createAppState("email-3", { to: "user3@example.com", subject: "Welcome" })
  ]
});
```

### 🔄 **Nested Composition**

Combine **composition patterns**:

```typescript
// Parallel preprocessing
const preprocessing = parallelProcessors<DataState>({
  name: "preprocess",
  processors: [validateData, enrichData, sanitizeData]
});

// Sequential main processing
const mainProcessing = chainProcessors<DataState>({
  name: "main-process",
  processors: [transformData, analyzeData, storeResults]
});

// Final workflow
const dataWorkflow = chainProcessors<DataState>({
  name: "complete-workflow",
  processors: [preprocessing, mainProcessing, sendNotification]
});
```

---

## Session Management

### 🏢 **Multi-Tenant Applications**

Perfect for **SaaS applications** where each tenant needs isolation:

```typescript
class TenantProcessor {
  private runtime: QueueRuntime<TenantState>;
  
  constructor() {
    this.runtime = createQueueRuntimeWithDefaults<TenantState>();
  }
  
  async processTenantData(tenantId: string, data: any) {
    const sessionId = `tenant-${tenantId}-${Date.now()}`;
    
    try {
      const state = createAppState(sessionId, {
        tenantId,
        data,
        processedAt: new Date().toISOString()
      });
      
      const result = await this.runtime.executeInSession(
        "process-tenant-data",
        state,
        sessionId
      );
      
      return result;
    } finally {
      // Always clean up tenant session
      await this.runtime.stopSession(sessionId);
    }
  }
}
```

### 🔄 **Concurrent Processing**

Handle **multiple concurrent workflows** safely:

```typescript
class WorkflowManager {
  private activeSessions = new Map<string, SessionInfo>();
  
  async startWorkflow(workflowId: string, data: any): Promise<string> {
    const sessionId = `workflow-${workflowId}-${Date.now()}`;
    
    // Track session
    this.activeSessions.set(sessionId, {
      workflowId,
      startedAt: Date.now(),
      status: "running"
    });
    
    // Start processing
    this.processWorkflow(sessionId, data).catch(error => {
      this.handleWorkflowError(sessionId, error);
    });
    
    return sessionId;
  }
  
  private async processWorkflow(sessionId: string, data: any) {
    try {
      const result = await this.runtime.executeInSession(
        "main-workflow",
        createAppState(sessionId, data),
        sessionId
      );
      
      this.activeSessions.get(sessionId)!.status = "completed";
    } catch (error) {
      this.activeSessions.get(sessionId)!.status = "failed";
      throw error;
    } finally {
      await this.runtime.stopSession(sessionId);
      this.activeSessions.delete(sessionId);
    }
  }
  
  async getSessionStatus(sessionId: string) {
    return this.activeSessions.get(sessionId);
  }
  
  async listActiveSessions() {
    return Array.from(this.activeSessions.entries());
  }
}
```

### 💾 **Session State Persistence**

In distributed mode, **session state persists** in Redis:

```typescript
// State automatically persists between processor calls
const processor1 = createProcessor<MyState>("step-1")
  .process(async (state, ctx) => {
    return Success({
      ...state,
      step1Complete: true,
      dataFromStep1: "important data"
    });
  });

const processor2 = createProcessor<MyState>("step-2")
  .process(async (state, ctx) => {
    // State includes updates from step-1
    console.log(state.dataFromStep1); // "important data"
    
    return Success({
      ...state,
      step2Complete: true
    });
  });

const workflow = chainProcessors({
  name: "persistent-workflow",
  processors: [processor1, processor2]
});

// State persists across the entire chain
await runtime.executeInSession("persistent-workflow", initialState, sessionId);
```

---

## Monitoring & Observability

### 📊 **Built-in Metrics**

Get **real-time statistics** about your workflows:

```typescript
// Overall runtime stats
const stats = await runtime.getStats();
console.log({
  registeredProcessors: stats.registeredProcessors,
  runningJobs: stats.runningJobs,
  completedJobs: stats.completedJobs,
  failedJobs: stats.failedJobs,
  uptime: stats.uptime
});

// Session-specific stats
const sessionStats = await runtime.getSessionStats("my-session");
console.log("Session queue status:", sessionStats);

// Queue statistics per processor
const queueStats = await runtime.getQueueStats();
Object.entries(queueStats).forEach(([processor, stats]) => {
  console.log(`${processor}:`, {
    waiting: stats.waiting,
    active: stats.active,
    completed: stats.completed,
    failed: stats.failed
  });
});
```

### 🎛️ **Bull Board Dashboard**

Visual **queue monitoring** with Bull Board:

```typescript
import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

const app = express();
const serverAdapter = new ExpressAdapter();

// Get all queues from runtime
const queues = runtime.getQueues();

createBullBoard({
  queues: queues.map(queue => new BullMQAdapter(queue)),
  serverAdapter
});

serverAdapter.setBasePath("/admin/queues");
app.use("/admin/queues", serverAdapter.getRouter());

app.listen(3000, () => {
  console.log("Bull Board available at http://localhost:3000/admin/queues");
});
```

### 📡 **Event System**

Listen to **real-time events**:

```typescript
// Global events
runtime.on("processor:job:completed", (data) => {
  console.log(`✅ Job ${data.executionId} completed in ${data.executionTime}ms`);
});

runtime.on("processor:job:failed", (data) => {
  console.log(`❌ Job ${data.executionId} failed:`, data.error.message);
});

runtime.on("session:created", (data) => {
  console.log(`🔄 Session ${data.sessionId} created`);
});

runtime.on("session:cleanup", (data) => {
  console.log(`🗑️ Session ${data.sessionId} cleaned up`);
});

// Custom events from processors
const processor = createProcessor<MyState>("event-emitter")
  .process(async (state, ctx) => {
    // Emit custom events
    ctx.emit("business:order:created", { 
      orderId: state.orderId,
      total: state.total 
    });
    
    return Success(state);
  });

runtime.on("business:order:created", (data) => {
  console.log("New order created:", data.orderId);
});
```

### 🔍 **Logging**

Structured **logging** throughout your workflows:

```typescript
const processor = createProcessor<MyState>("logger-example")
  .process(async (state, ctx) => {
    // Structured logging with context
    ctx.log.info("Processing started", {
      userId: state.userId,
      operation: "data-processing"
    });
    
    ctx.log.debug("Detailed processing info", {
      step: 1,
      dataSize: state.data.length
    });
    
    try {
      // Your processing logic
      const result = await processData(state.data);
      
      ctx.log.info("Processing completed", {
        resultSize: result.length,
        processingTime: Date.now() - startTime
      });
      
      return Success({ ...state, result });
    } catch (error) {
      ctx.log.error("Processing failed", {
        error: error.message,
        stack: error.stack
      });
      
      return Failure(error);
    }
  });
```

---

## API Reference

### Core Functions

#### `createProcessor<T>(name: string)`
Creates a new processor with the specified name and type.

```typescript
const processor = createProcessor<MyState>("my-processor")
  .withDescription("What this processor does")
  .withTimeout(30000)
  .withRetryPolicy({ maxAttempts: 3, backoffMs: 1000 })
  .withQueueConfig({ concurrency: 5, priority: 10 })
  .process(async (state, ctx) => {
    // Your logic here
    return Success(newState);
  });
```

#### `chainProcessors<T>(config)`
Creates a sequential chain of processors.

```typescript
const chain = chainProcessors<MyState>({
  name: "my-chain",
  processors: [processor1, processor2, processor3],
  timeout: 60000 // Optional: total timeout for the chain
});
```

#### `parallelProcessors<T>(config)`
Creates parallel execution of processors.

```typescript
const parallel = parallelProcessors<MyState>({
  name: "parallel-work",
  processors: [task1, task2, task3],
  mergeFunction: (results) => {
    // Custom merge logic for results
    return combinedState;
  }
});
```

#### `batchProcessor<T>(config)`
Processes multiple payloads with the same processor.

```typescript
const batch = batchProcessor<MyState>({
  name: "batch-job",
  processorName: "single-processor",
  payloads: [state1, state2, state3]
});
```

#### `routeProcessor<T>(name, selector, routes, fallback?)`
Routes to different processors based on state.

```typescript
const router = routeProcessor<MyState>(
  "my-router",
  (state) => state.type,
  {
    "typeA": processorA,
    "typeB": processorB
  },
  fallbackProcessor // Optional
);
```

### Runtime Classes

#### `LocalRuntime<T>`
In-memory runtime for development and simple use cases.

```typescript
const runtime = new LocalRuntime<MyState>();
await runtime.start();
const result = await runtime.execute("processor-name", state);
await runtime.stop();
```

#### `QueueRuntime<T>`
Distributed runtime with Redis/BullMQ backend.

```typescript
const runtime = createQueueRuntimeWithDefaults<MyState>({
  host: "localhost",
  port: 6379
});

// Session-isolated execution
const result = await runtime.executeInSession("processor", state, sessionId);
await runtime.stopSession(sessionId);
```

### Runtime Methods

| Method | Description |
|--------|-------------|
| `execute(name, state, sessionId?)` | Execute processor (optionally in session) |
| `executeInSession(name, state, sessionId)` | Execute with guaranteed session isolation |
| `executeMany(name, states, sessionId?)` | Execute processor with multiple states |
| `register(processor)` | Register a processor |
| `registerMany(processors)` | Register multiple processors |
| `unregister(name)` | Unregister a processor |
| `start()` | Start the runtime |
| `stop()` | Stop the runtime |
| `stopSession(sessionId)` | Stop specific session |
| `getStats()` | Get runtime statistics |
| `getSessionStats(sessionId)` | Get session-specific statistics |
| `getActiveSessions()` | List all active sessions |
| `getQueues()` | Get all queue instances (for Bull Board) |
| `syncProcessors()` | Sync processor infrastructure (distributed only) |

### Result Types

```typescript
interface ProcessorResult<T> {
  success: boolean;
  state: T;
  error?: AM2ZError;
  executionTime: number;
  metadata: ExecutionMetadata;
}

// Usage with type guards
if (result.success) {
  // TypeScript knows result.state is available
  console.log(result.state);
} else {
  // TypeScript knows result.error is available
  console.error(result.error);
}
```

### Error Types

```typescript
// Base error class
class AM2ZError extends Error {
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  processorName?: string;
  executionId?: string;
}

// Specific error types
class ValidationError extends AM2ZError
class ProcessorNotFoundError extends AM2ZError
class ProcessorExecutionError extends AM2ZError
class TimeoutError extends AM2ZError
class ResourceError extends AM2ZError
class NetworkError extends AM2ZError
class ConfigurationError extends AM2ZError
class BusinessError extends AM2ZError
```

---

## Configuration

### Runtime Configuration

```typescript
const runtime = createQueueRuntimeWithDefaults(
  // Redis Configuration
  {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD,
    db: 0,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    connectTimeout: 10000,
    commandTimeout: 5000
  },
  // Runtime Configuration
  {
    defaultTimeout: 300000,        // 5 minutes default timeout
    maxCallDepth: 15,              // Max nested processor calls
    autoCleanupInterval: 60000,    // 1 minute cleanup interval
    staleExecutionTimeout: 900000  // 15 minutes stale timeout
  }
);
```

### Advanced Queue Configuration

```typescript
const runtime = new QueueRuntime({
  queuePrefix: "my-app",
  redis: {
    host: "localhost",
    port: 6379
  },
  worker: {
    concurrency: 10,               // Max concurrent jobs per worker
    stalledInterval: 30000,        // Check for stalled jobs every 30s
    maxStalledCount: 1,            // Max times a job can be stalled
    removeOnComplete: {            // Auto-cleanup completed jobs
      count: 100,                  // Keep last 100 completed
      age: 24 * 60 * 60 * 1000    // Keep for 24 hours
    },
    removeOnFail: {                // Auto-cleanup failed jobs
      count: 50,                   // Keep last 50 failed
      age: 7 * 24 * 60 * 60 * 1000 // Keep for 7 days
    }
  },
  monitoring: {
    enableQueueEvents: true,       // Enable Bull Board events
    enableMetrics: true,           // Enable metrics collection
    metricsInterval: 30000         // Collect metrics every 30s
  },
  errorHandling: {
    enableGlobalHandlers: true,    // Global error handlers
    logUnhandledRejections: true,  // Log unhandled promise rejections
    logUncaughtExceptions: true    // Log uncaught exceptions
  }
});
```

### Environment Variables

```bash
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password
REDIS_DB=0

# AM2Z Configuration
AM2Z_DEFAULT_TIMEOUT=300000
AM2Z_MAX_CALL_DEPTH=15
AM2Z_QUEUE_PREFIX=my-app
AM2Z_AUTO_CLEANUP_INTERVAL=60000

# Monitoring
AM2Z_ENABLE_METRICS=true
AM2Z_METRICS_INTERVAL=30000
AM2Z_BULL_BOARD_PORT=3000

# Performance
AM2Z_WORKER_CONCURRENCY=10
AM2Z_STALLED_INTERVAL=30000
```

### Processor-Level Configuration

```typescript
const processor = createProcessor<MyState>("configured-processor")
  .withDescription("A well-configured processor")
  .withTimeout(45000)                    // 45 second timeout
  .withRetryPolicy({
    maxAttempts: 5,                      // Retry up to 5 times
    backoffMs: 2000,                     // Start with 2s delay
    backoffType: "exponential",          // Exponential backoff
    shouldRetry: (error) => {            // Custom retry logic
      return !error.isCritical && error.category !== "validation";
    }
  })
  .withQueueConfig({
    concurrency: 3,                      // Max 3 concurrent executions
    priority: 10,                        // Higher number = higher priority
    rateLimitRpm: 100,                   // Rate limit: 100 executions per minute
    delay: 1000                          // Delay execution by 1 second
  })
  .process(async (state, ctx) => {
    // Your processor logic
    return Success(state);
  });
```

---

## Real-World Examples

### 🛒 E-commerce Order Processing

```typescript
interface OrderState extends AppState {
  orderId: string;
  customerId: string;
  items: OrderItem[];
  total: number;
  paymentInfo: PaymentInfo;
  shippingAddress: Address;
  status: OrderStatus;
}

// Individual processors
const validateOrder = createProcessor<OrderState>("validate-order")
  .withTimeout(10000)
  .process(async (state, ctx) => {
    ctx.log.info("Validating order", { orderId: state.orderId });
    
    if (state.items.length === 0) {
      return Failure(new ValidationError("items", [], "Order must contain items"));
    }
    
    if (state.total <= 0) {
      return Failure(new ValidationError("total", state.total, "Invalid total"));
    }
    
    return Success({ ...state, status: "validated" });
  });

const checkInventory = createProcessor<OrderState>("check-inventory")
  .withTimeout(15000)
  .withRetryPolicy({ maxAttempts: 3, backoffMs: 1000 })
  .process(async (state, ctx) => {
    ctx.log.info("Checking inventory", { orderId: state.orderId });
    
    for (const item of state.items) {
      const available = await inventoryService.checkAvailability(item.sku);
      
      if (available < item.quantity) {
        return Failure(new BusinessError(
          `Insufficient inventory for ${item.sku}`,
          "inventory_shortage",
          { available, requested: item.quantity }
        ));
      }
    }
    
    return Success({ ...state, status: "inventory_confirmed" });
  });

const processPayment = createProcessor<OrderState>("process-payment")
  .withTimeout(30000)
  .withRetryPolicy({ 
    maxAttempts: 2, 
    backoffMs: 5000,
    shouldRetry: (error) => error.code === "network_timeout"
  })
  .process(async (state, ctx) => {
    ctx.log.info("Processing payment", { 
      orderId: state.orderId,
      amount: state.total 
    });
    
    try {
      const paymentResult = await paymentGateway.processPayment({
        amount: state.total,
        paymentMethod: state.paymentInfo
      });
      
      return Success({
        ...state,
        status: "payment_processed",
        paymentId: paymentResult.transactionId
      });
    } catch (error) {
      return Failure(new BusinessError(
        "Payment processing failed",
        "payment_failed",
        { originalError: error.message }
      ));
    }
  });

// Parallel fulfillment tasks
const createShipment = createProcessor<OrderState>("create-shipment")
  .process(async (state, ctx) => {
    const shipment = await shippingService.createShipment({
      orderId: state.orderId,
      address: state.shippingAddress,
      items: state.items
    });
    
    return Success({
      ...state,
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber
    });
  });

const sendConfirmation = createProcessor<OrderState>("send-confirmation")
  .process(async (state, ctx) => {
    await emailService.sendOrderConfirmation({
      customerId: state.customerId,
      orderId: state.orderId,
      trackingNumber: state.trackingNumber
    });
    
    return Success({ ...state, confirmationSent: true });
  });

const updateInventory = createProcessor<OrderState>("update-inventory")
  .process(async (state, ctx) => {
    for (const item of state.items) {
      await inventoryService.reserveItem(item.sku, item.quantity);
    }
    
    return Success({ ...state, inventoryReserved: true });
  });

// Compose the complete workflow
const fulfillmentTasks = parallelProcessors<OrderState>({
  name: "fulfillment",
  processors: [createShipment, sendConfirmation, updateInventory]
});

const orderProcessingWorkflow = chainProcessors<OrderState>({
  name: "process-order",
  processors: [
    validateOrder,
    checkInventory,
    processPayment,
    fulfillmentTasks
  ],
  timeout: 120000 // 2 minutes total
});

// Usage
export class OrderProcessor {
  private runtime: QueueRuntime<OrderState>;
  
  constructor() {
    this.runtime = createQueueRuntimeWithDefaults<OrderState>();
    this.runtime.register(orderProcessingWorkflow);
    this.runtime.start();
  }
  
  async processOrder(order: OrderData): Promise<ProcessorResult<OrderState>> {
    const sessionId = `order-${order.orderId}-${Date.now()}`;
    
    try {
      const state = createAppState(sessionId, {
        ...order,
        status: "pending"
      });
      
      return await this.runtime.executeInSession(
        "process-order",
        state,
        sessionId
      );
    } finally {
      await this.runtime.stopSession(sessionId);
    }
  }
}
```

### 🤖 AI Content Generation Pipeline

```typescript
interface ContentState extends AppState {
  prompt: string;
  contentType: "blog" | "email" | "social";
  generatedContent?: string;
  optimizedContent?: string;
  seoScore?: number;
  publishedUrl?: string;
}

const generateContent = createProcessor<ContentState>("generate-content")
  .withTimeout(60000) // AI calls can be slow
  .withRetryPolicy({ maxAttempts: 2, backoffMs: 5000 })
  .process(async (state, ctx) => {
    ctx.log.info("Generating content", { 
      contentType: state.contentType,
      promptLength: state.prompt.length 
    });
    
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `Generate ${state.contentType} content based on the user's prompt.`
        },
        {
          role: "user",
          content: state.prompt
        }
      ],
      max_tokens: 2000
    });
    
    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      return Failure(new BusinessError("No content generated", "ai_generation_failed"));
    }
    
    return Success({
      ...state,
      generatedContent: content
    });
  });

const optimizeContent = createProcessor<ContentState>("optimize-content")
  .process(async (state, ctx) => {
    if (!state.generatedContent) {
      return Failure(new ValidationError("generatedContent", undefined, "No content to optimize"));
    }
    
    // Content optimization logic
    const optimized = await contentOptimizer.optimize(state.generatedContent, {
      targetAudience: "general",
      tone: "professional",
      maxLength: 1000
    });
    
    return Success({
      ...state,
      optimizedContent: optimized.text,
      seoScore: optimized.seoScore
    });
  });

// Route based on content type
const publishContent = routeProcessor<ContentState>(
  "publish-content",
  (state) => state.contentType,
  {
    "blog": blogPublisher,
    "email": emailSender,
    "social": socialMediaPoster
  }
);

const contentPipeline = chainProcessors<ContentState>({
  name: "content-generation-pipeline",
  processors: [generateContent, optimizeContent, publishContent],
  timeout: 180000 // 3 minutes
});
```

### 🏢 Multi-Tenant SaaS Data Processing

```typescript
interface TenantState extends AppState {
  tenantId: string;
  organizationId: string;
  dataType: string;
  rawData: any[];
  processedData?: any[];
  validationErrors?: string[];
  features: string[]; // Feature flags per tenant
}

class MultiTenantProcessor {
  private runtime: QueueRuntime<TenantState>;
  private tenantConfigs = new Map<string, TenantConfig>();
  
  constructor() {
    this.runtime = createQueueRuntimeWithDefaults<TenantState>();
    this.setupProcessors();
  }
  
  private setupProcessors() {
    // Dynamic processor registration based on tenant features
    const baseProcessor = createProcessor<TenantState>("process-data")
      .process(async (state, ctx) => {
        const config = this.tenantConfigs.get(state.tenantId);
        
        if (!config) {
          return Failure(new ValidationError("tenantId", state.tenantId, "Unknown tenant"));
        }
        
        // Apply tenant-specific processing
        const processed = await this.processDataForTenant(state.rawData, config);
        
        return Success({
          ...state,
          processedData: processed
        });
      });
    
    // Feature-specific processors
    const advancedAnalytics = createProcessor<TenantState>("advanced-analytics")
      .process(async (state, ctx) => {
        if (!state.features.includes("advanced-analytics")) {
          ctx.log.info("Skipping advanced analytics - feature not enabled");
          return Success(state);
        }
        
        // Advanced analytics processing
        const analytics = await this.runAdvancedAnalytics(state.processedData);
        
        return Success({
          ...state,
          analyticsResults: analytics
        });
      });
    
    // Compose workflow with conditional features
    const tenantWorkflow = chainProcessors<TenantState>({
      name: "tenant-data-processing",
      processors: [baseProcessor, advancedAnalytics]
    });
    
    this.runtime.register(tenantWorkflow);
  }
  
  async processTenantData(
    tenantId: string, 
    organizationId: string, 
    data: any[]
  ): Promise<ProcessorResult<TenantState>> {
    // Each tenant gets isolated session
    const sessionId = `tenant-${tenantId}-${Date.now()}`;
    
    try {
      const tenantConfig = await this.getTenantConfig(tenantId);
      this.tenantConfigs.set(tenantId, tenantConfig);
      
      const state = createAppState(sessionId, {
        tenantId,
        organizationId,
        dataType: "user_data",
        rawData: data,
        features: tenantConfig.enabledFeatures
      });
      
      return await this.runtime.executeInSession(
        "tenant-data-processing",
        state,
        sessionId
      );
    } finally {
      await this.runtime.stopSession(sessionId);
      this.tenantConfigs.delete(tenantId);
    }
  }
  
  private async getTenantConfig(tenantId: string): Promise<TenantConfig> {
    // Fetch tenant-specific configuration
    return await configService.getTenantConfig(tenantId);
  }
  
  private async processDataForTenant(data: any[], config: TenantConfig): Promise<any[]> {
    // Apply tenant-specific data processing rules
    return data.map(item => this.applyTenantRules(item, config));
  }
}
```

---

## AI Integration

AM2Z provides powerful patterns for integrating AI services into your workflows. The framework's architecture is particularly well-suited for AI applications due to its support for long-running operations, parallel processing, and robust error handling.

### 🤖 **Why AM2Z for AI Applications?**

- **Long-Running Operations**: AI calls can take time - AM2Z handles timeouts and retries gracefully
- **Parallel AI Processing**: Run multiple AI operations concurrently with automatic result merging
- **Session Isolation**: Each AI workflow runs in isolation, perfect for multi-user applications
- **Cost Control**: Built-in rate limiting and resource management for expensive AI operations
- **Observability**: Monitor AI pipelines with Bull Board and comprehensive logging
- **Type Safety**: Full TypeScript support for AI inputs and outputs

### 📋 **AI Integration Patterns**

#### **1. Basic AI Processor**

```typescript
import { createProcessor, Success, Failure, ProcessorExecutionError } from "am2z";
import { openai } from "@ai-sdk/openai";
import { generateText, generateObject } from "ai";
import { z } from "zod";

interface AIState extends AppState {
  prompt: string;
  generatedContent?: string;
  metadata?: {
    model: string;
    tokens: number;
    duration: number;
  };
}

const aiTextGenerator = createProcessor<AIState>("ai-text-generator")
  .withDescription("Generate text using OpenAI")
  .withTimeout(30000) // 30 seconds for AI operations
  .withRetryPolicy({
    maxAttempts: 2,
    backoffMs: 5000,
    shouldRetry: (error) => {
      // Retry on rate limits and network errors
      return error.code === "rate_limit" || error.category === "network";
    }
  })
  .process(async (state, ctx) => {
    const startTime = Date.now();
    
    ctx.log.info("Starting AI text generation", {
      promptLength: state.prompt.length,
      model: "gpt-4o"
    });
    
    try {
      const { text, usage } = await generateText({
        model: openai("gpt-4o"),
        prompt: state.prompt,
        maxTokens: 2000,
        temperature: 0.7,
        abortSignal: ctx.signal // Cooperative cancellation
      });
      
      const duration = Date.now() - startTime;
      
      ctx.log.info("AI generation completed", {
        outputLength: text.length,
        tokensUsed: usage.totalTokens,
        duration
      });
      
      return Success({
        ...state,
        generatedContent: text,
        metadata: {
          model: "gpt-4o",
          tokens: usage.totalTokens,
          duration
        }
      });
    } catch (error) {
      ctx.log.error("AI generation failed", error);
      return Failure(
        new ProcessorExecutionError(
          "ai-text-generator",
          ctx.meta.executionId,
          error instanceof Error ? error : new Error("AI generation failed")
        )
      );
    }
  });
```

#### **2. Structured AI Output with Zod**

```typescript
// Define structured output schema
const AnalysisResultSchema = z.object({
  summary: z.string(),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  keyPoints: z.array(z.string()),
  score: z.number().min(0).max(100),
  recommendations: z.array(z.object({
    action: z.string(),
    priority: z.enum(["high", "medium", "low"]),
    reasoning: z.string()
  }))
});

type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

interface AnalysisState extends AppState {
  textToAnalyze: string;
  analysis?: AnalysisResult;
}

const aiAnalyzer = createProcessor<AnalysisState>("ai-analyzer")
  .withDescription("Analyze text and extract structured insights")
  .process(async (state, ctx) => {
    ctx.log.info("Analyzing text with AI");
    
    try {
      const { object } = await generateObject({
        model: openai("gpt-4o"),
        schema: AnalysisResultSchema,
        system: "You are an expert analyst. Analyze the provided text and extract structured insights.",
        prompt: state.textToAnalyze,
        abortSignal: ctx.signal
      });
      
      return Success({
        ...state,
        analysis: object
      });
    } catch (error) {
      return Failure(error);
    }
  });
```

#### **3. Parallel AI Processing**

```typescript
interface ContentGenerationState extends AppState {
  topic: string;
  targetAudience: string;
  // Results from parallel generation
  blogPost?: string;
  socialMediaPosts?: string[];
  emailNewsletter?: string;
  videoScript?: string;
}

// Individual AI processors
const blogPostGenerator = createProcessor<ContentGenerationState>("generate-blog")
  .process(async (state, ctx) => {
    const { text } = await generateText({
      model: openai("gpt-4o"),
      system: "You are an expert blog writer.",
      prompt: `Write a comprehensive blog post about ${state.topic} for ${state.targetAudience}`,
      maxTokens: 3000
    });
    
    return Success({ ...state, blogPost: text });
  });

const socialMediaGenerator = createProcessor<ContentGenerationState>("generate-social")
  .process(async (state, ctx) => {
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema: z.object({
        posts: z.array(z.string()).length(5)
      }),
      prompt: `Create 5 social media posts about ${state.topic} for ${state.targetAudience}`
    });
    
    return Success({ ...state, socialMediaPosts: object.posts });
  });

const emailGenerator = createProcessor<ContentGenerationState>("generate-email")
  .process(async (state, ctx) => {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt: `Write an email newsletter about ${state.topic} for ${state.targetAudience}`
    });
    
    return Success({ ...state, emailNewsletter: text });
  });

// Parallel execution of all content generation
const contentGenerationPipeline = parallelProcessors<ContentGenerationState>({
  name: "parallel-content-generation",
  processors: [
    blogPostGenerator,
    socialMediaGenerator,
    emailGenerator
  ],
  timeout: 60000, // 1 minute for all parallel operations
  mergeFunction: (results) => {
    // Merge all parallel results into final state
    const finalState = results[0].state;
    
    results.forEach(result => {
      if (result.state.blogPost) finalState.blogPost = result.state.blogPost;
      if (result.state.socialMediaPosts) finalState.socialMediaPosts = result.state.socialMediaPosts;
      if (result.state.emailNewsletter) finalState.emailNewsletter = result.state.emailNewsletter;
    });
    
    return finalState;
  }
});
```

#### **4. AI Workflow with Quality Assurance**

```typescript
interface AIWorkflowState extends AppState {
  requirements: string;
  generatedCode?: string;
  qualityScore?: number;
  issues?: string[];
  approved?: boolean;
}

// Generate code based on requirements
const codeGenerator = createProcessor<AIWorkflowState>("generate-code")
  .process(async (state, ctx) => {
    const { text } = await generateText({
      model: openai("gpt-4o"),
      system: "You are an expert programmer. Generate clean, well-documented code.",
      prompt: `Generate code for: ${state.requirements}`,
      maxTokens: 4000
    });
    
    return Success({ ...state, generatedCode: text });
  });

// AI-powered code review
const codeReviewer = createProcessor<AIWorkflowState>("review-code")
  .process(async (state, ctx) => {
    if (!state.generatedCode) {
      return Failure(new ValidationError("generatedCode", undefined, "No code to review"));
    }
    
    const { object } = await generateObject({
      model: openai("gpt-4o"),
      schema: z.object({
        qualityScore: z.number().min(0).max(100),
        issues: z.array(z.string()),
        suggestions: z.array(z.string())
      }),
      system: "You are a senior code reviewer. Analyze the code for quality, security, and best practices.",
      prompt: state.generatedCode
    });
    
    return Success({
      ...state,
      qualityScore: object.qualityScore,
      issues: object.issues,
      approved: object.qualityScore >= 80
    });
  });

// Conditional improvement based on review
const codeImprover = createProcessor<AIWorkflowState>("improve-code")
  .process(async (state, ctx) => {
    if (state.approved) {
      ctx.log.info("Code approved, skipping improvement");
      return Success(state);
    }
    
    const { text } = await generateText({
      model: openai("gpt-4o"),
      system: "Improve the code based on the review feedback.",
      prompt: `Code: ${state.generatedCode}\n\nIssues: ${state.issues?.join("\n")}`,
      maxTokens: 4000
    });
    
    return Success({
      ...state,
      generatedCode: text,
      approved: true
    });
  });

// Complete AI workflow with quality gates
const aiCodeWorkflow = chainProcessors<AIWorkflowState>({
  name: "ai-code-generation-workflow",
  processors: [
    codeGenerator,
    codeReviewer,
    codeImprover
  ]
});
```

### 🌐 **Real-World AI Example: Website Analysis Pipeline**

Here's the complete website analysis example you provided, showcasing advanced AI patterns:

```typescript
import {
  createProcessor,
  chainProcessors,
  parallelProcessors,
  Failure,
  NetworkError,
  ProcessorExecutionError,
  Success,
  createAppState,
} from "am2z";
import type { AppState } from "am2z";
import FirecrawlApp from "@mendable/firecrawl-js";
import { AI } from "@/lib/ai/client";

const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

export interface WebsiteAnalysisState extends AppState {
  url: string;
  scrapedContent?: string;
  jsonContent?: any;
  markdownContent?: string;
  scrapingDuration?: number;
  // Individual AI analysis sections
  companyOverview?: string;
  productsAndServices?: string;
  brandIdentity?: string;
  targetAudience?: string;
  competitiveLandscape?: string;
  businessModel?: string;
  technologyAndInnovation?: string;
  cultureAndValues?: string;
  // Combined analysis
  analysisData?: string;
  content?: string;
  title?: string;
  description?: string;
  extractedAt: string;
  isComplete?: boolean;
}

// Base prompt template with language detection
const createSectionPrompt = (sectionName: string, instructions: string) => {
  return `You are an expert business analyst specializing in ${sectionName} analysis. 

${instructions}

IMPORTANT: Analyze the website content and respond in the SAME LANGUAGE as the website content.`;
};

// Step 1: Website Scraping
export const scrapeWebsiteContent = createProcessor<WebsiteAnalysisState>(
  "scrape-website-content"
)
  .withDescription("Scrape website content using Firecrawl")
  .withRetryPolicy({
    maxAttempts: 3,
    backoffMs: 5000,
    shouldRetry: (error: any) => error.category === "network",
  })
  .process(async (state, context) => {
    const startTime = Date.now();
    
    context.log.info("Starting website scraping", { url: state.url });
    
    context.emit("website:scraping:started", {
      sessionId: state.metadata.sessionId,
      url: state.url,
      timestamp: new Date().toISOString(),
    });
    
    try {
      const firecrawlResponse = await app.scrapeUrl(state.url, {
        location: { country: "ES", languages: ["es"] },
        maxAge: 1000 * 60 * 60 * 24, // 24 hours cache
      });
      
      if (!firecrawlResponse.success) {
        return Failure(new NetworkError(state.url, 400, new Error("Scraping failed")));
      }
      
      const scrapingDuration = Date.now() - startTime;
      
      context.emit("website:scraping:completed", {
        sessionId: state.metadata.sessionId,
        duration: scrapingDuration,
        contentLength: firecrawlResponse.markdown?.length || 0,
      });
      
      return Success({
        ...state,
        scrapedContent: firecrawlResponse.markdown || "",
        jsonContent: firecrawlResponse.json,
        markdownContent: firecrawlResponse.markdown,
        scrapingDuration,
      });
    } catch (error) {
      context.log.error("Scraping failed", error);
      return Failure(error);
    }
  });

// Individual AI Analysis Processors
const analyzeCompanyOverview = createProcessor<WebsiteAnalysisState>("analyze-company")
  .process(async (state, ctx) => {
    const { text } = await AI.generateText({
      input: {
        model: "gpt-4o",
        system: createSectionPrompt("Company Overview", 
          "Extract company name, industry, history, location, size, and structure."),
        user: `Analyze: ${state.url}\n\n${state.scrapedContent}`,
      },
      abortSignal: ctx.signal,
    });
    
    return Success({ ...state, companyOverview: text });
  });

// ... Additional section analyzers (products, brand, audience, etc.)

// Step 2: Parallel AI Analysis
export const parallelSectionAnalysis = parallelProcessors<WebsiteAnalysisState>({
  name: "parallel-section-analysis",
  processors: [
    analyzeCompanyOverview,
    analyzeProductsAndServices,
    analyzeBrandIdentity,
    analyzeTargetAudience,
    analyzeCompetitiveLandscape,
    analyzeBusinessModel,
    analyzeTechnologySection,
    analyzeCultureAndValues,
  ],
  timeout: 180000, // 3 minutes for all parallel analyses
  mergeFunction: (results, originalState) => {
    // Merge all AI analysis results
    const finalState = { ...originalState };
    
    results.forEach(result => {
      Object.assign(finalState, result.state);
    });
    
    // Combine all sections into comprehensive analysis
    finalState.analysisData = `
# Website Analysis

## Company Overview
${finalState.companyOverview || "N/A"}

## Products & Services  
${finalState.productsAndServices || "N/A"}

## Brand Identity
${finalState.brandIdentity || "N/A"}

## Target Audience
${finalState.targetAudience || "N/A"}

## Competitive Landscape
${finalState.competitiveLandscape || "N/A"}

## Business Model
${finalState.businessModel || "N/A"}

## Technology & Innovation
${finalState.technologyAndInnovation || "N/A"}

## Culture & Values
${finalState.cultureAndValues || "N/A"}
`;
    
    return finalState;
  }
});

// Step 3: Format Final Content
const formatAnalysisContent = createProcessor<WebsiteAnalysisState>("format-content")
  .process(async (state, ctx) => {
    return Success({
      ...state,
      content: state.analysisData,
      title: state.scrapingMetadata?.title || "Website Analysis",
      extractedAt: new Date().toISOString(),
      isComplete: true,
    });
  });

// Complete Website Analysis Pipeline
export const analyzeWebsiteContent = chainProcessors<WebsiteAnalysisState>({
  name: "analyze-website-content",
  processors: [
    scrapeWebsiteContent,
    parallelSectionAnalysis,
    formatAnalysisContent,
  ],
  timeout: 300000, // 5 minutes total
});

// Usage
const runtime = createQueueRuntimeWithDefaults<WebsiteAnalysisState>();
runtime.register(analyzeWebsiteContent);
await runtime.start();

const result = await runtime.executeInSession(
  "analyze-website-content",
  createAppState("analysis-123", {
    url: "https://example.com",
    extractedAt: new Date().toISOString(),
  }),
  "website-analysis-session"
);
```

### 💡 **Best Practices for AI Integration**

#### **1. Cost Management**

```typescript
// Implement token counting and limits
const costAwareProcessor = createProcessor<AIState>("cost-aware-ai")
  .process(async (state, ctx) => {
    const estimatedTokens = state.prompt.length / 4; // Rough estimate
    
    if (estimatedTokens > 1000) {
      ctx.log.warn("Large prompt detected", { estimatedTokens });
      
      // Use cheaper model for large prompts
      const model = estimatedTokens > 2000 ? "gpt-3.5-turbo" : "gpt-4o";
      
      const { text, usage } = await generateText({
        model: openai(model),
        prompt: state.prompt,
        maxTokens: Math.min(2000, 4000 - estimatedTokens),
      });
      
      // Track costs
      ctx.emit("ai:token:usage", {
        model,
        tokens: usage.totalTokens,
        estimatedCost: calculateCost(model, usage),
      });
      
      return Success({ ...state, output: text });
    }
  });
```

#### **2. Rate Limiting**

```typescript
// Configure rate limiting for AI processors
const rateLimitedAI = createProcessor<AIState>("rate-limited-ai")
  .withQueueConfig({
    concurrency: 2, // Max 2 concurrent AI calls
    rateLimitRpm: 20, // 20 requests per minute
  })
  .withRetryPolicy({
    maxAttempts: 3,
    backoffMs: 60000, // 1 minute backoff for rate limits
    shouldRetry: (error) => error.code === "rate_limit_exceeded",
  })
  .process(async (state, ctx) => {
    // Your AI logic here
  });
```

#### **3. Caching AI Results**

```typescript
interface CachedAIState extends AppState {
  prompt: string;
  cacheKey?: string;
  cachedResult?: string;
  generatedContent?: string;
}

const cachedAIProcessor = createProcessor<CachedAIState>("cached-ai")
  .process(async (state, ctx) => {
    // Generate cache key from prompt
    const cacheKey = crypto
      .createHash("sha256")
      .update(state.prompt)
      .digest("hex");
    
    // Check cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      ctx.log.info("Using cached AI result");
      return Success({
        ...state,
        cacheKey,
        cachedResult: cached,
        generatedContent: cached,
      });
    }
    
    // Generate new content
    const { text } = await generateText({
      model: openai("gpt-4o"),
      prompt: state.prompt,
    });
    
    // Cache the result
    await cacheService.set(cacheKey, text, 3600); // 1 hour TTL
    
    return Success({
      ...state,
      cacheKey,
      generatedContent: text,
    });
  });
```

#### **4. Monitoring AI Performance**

```typescript
// Track AI performance metrics
runtime.on("processor:job:completed", (data) => {
  if (data.processorName.includes("ai-")) {
    metrics.record({
      processor: data.processorName,
      duration: data.executionTime,
      timestamp: Date.now(),
      success: true,
    });
  }
});

runtime.on("processor:job:failed", (data) => {
  if (data.processorName.includes("ai-")) {
    metrics.record({
      processor: data.processorName,
      error: data.error.message,
      timestamp: Date.now(),
      success: false,
    });
    
    // Alert on repeated AI failures
    if (metrics.getFailureRate(data.processorName) > 0.2) {
      alerting.send({
        severity: "high",
        message: `High AI failure rate for ${data.processorName}`,
      });
    }
  }
});
```

### 🚀 **Advanced AI Patterns**

#### **1. Multi-Model Orchestration**

```typescript
// Use different models for different tasks
const multiModelPipeline = chainProcessors<AIState>({
  name: "multi-model-pipeline",
  processors: [
    // Fast model for initial analysis
    createProcessor("quick-analysis")
      .process(async (state, ctx) => {
        const { text } = await generateText({
          model: openai("gpt-3.5-turbo"),
          prompt: `Quickly analyze: ${state.input}`,
          maxTokens: 500,
        });
        return Success({ ...state, quickAnalysis: text });
      }),
    
    // Powerful model for detailed work
    createProcessor("detailed-analysis")
      .process(async (state, ctx) => {
        const { text } = await generateText({
          model: openai("gpt-4o"),
          prompt: `Based on ${state.quickAnalysis}, provide detailed analysis`,
          maxTokens: 2000,
        });
        return Success({ ...state, detailedAnalysis: text });
      }),
    
    // Specialized model for specific tasks
    createProcessor("code-generation")
      .process(async (state, ctx) => {
        const { text } = await generateText({
          model: openai("gpt-4o"), // Best for code
          system: "You are an expert programmer.",
          prompt: `Generate code based on: ${state.detailedAnalysis}`,
        });
        return Success({ ...state, generatedCode: text });
      }),
  ],
});
```

#### **2. AI with Human-in-the-Loop**

```typescript
interface ReviewState extends AppState {
  aiGenerated: string;
  humanReviewRequired: boolean;
  approved?: boolean;
  feedback?: string;
  revised?: string;
}

const humanInLoopWorkflow = chainProcessors<ReviewState>({
  name: "human-in-loop-ai",
  processors: [
    // AI generates initial content
    aiGenerator,
    
    // Check if human review needed
    createProcessor("check-review-needed")
      .process(async (state, ctx) => {
        // Complex logic to determine if review needed
        const needsReview = await checkComplexity(state.aiGenerated);
        return Success({ ...state, humanReviewRequired: needsReview });
      }),
    
    // Route based on review requirement
    routeProcessor(
      "review-router",
      (state) => state.humanReviewRequired ? "human" : "auto",
      {
        "human": createProcessor("await-human-review")
          .process(async (state, ctx) => {
            // Send for human review
            await notificationService.requestReview({
              content: state.aiGenerated,
              sessionId: state.metadata.sessionId,
            });
            
            // Wait for review (would be triggered by external event)
            ctx.log.info("Awaiting human review");
            return Success(state);
          }),
        
        "auto": createProcessor("auto-approve")
          .process(async (state, ctx) => {
            return Success({ ...state, approved: true });
          }),
      }
    ),
    
    // Revise based on feedback if needed
    createProcessor("revise-content")
      .process(async (state, ctx) => {
        if (!state.feedback || state.approved) {
          return Success(state);
        }
        
        const { text } = await generateText({
          model: openai("gpt-4o"),
          prompt: `Revise this content based on feedback:\n\nOriginal: ${state.aiGenerated}\n\nFeedback: ${state.feedback}`,
        });
        
        return Success({ ...state, revised: text, approved: true });
      }),
  ],
});
```

#### **3. Streaming AI Responses**

```typescript
// For real-time AI applications
const streamingAIProcessor = createProcessor<AIState>("streaming-ai")
  .process(async (state, ctx) => {
    const stream = await openai("gpt-4o").stream({
      messages: [{ role: "user", content: state.prompt }],
    });
    
    let fullResponse = "";
    
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      fullResponse += content;
      
      // Emit progress events
      ctx.emit("ai:stream:chunk", {
        sessionId: state.metadata.sessionId,
        chunk: content,
        accumulated: fullResponse.length,
      });
    }
    
    return Success({
      ...state,
      generatedContent: fullResponse,
    });
  });

// Client can listen to streaming events
runtime.on("ai:stream:chunk", (data) => {
  // Update UI with streaming content
  updateStreamingUI(data.sessionId, data.chunk);
});
```

---

## Best Practices

### 🏗️ **Design Patterns**

#### **1. Single Responsibility Processors**

```typescript
// ❌ Bad: One processor doing too much
const badProcessor = createProcessor<OrderState>("process-everything")
  .process(async (state, ctx) => {
    // Validates order
    // Processes payment  
    // Ships order
    // Sends email
    // Updates inventory
    // ... too much!
  });

// ✅ Good: Focused, single-purpose processors
const validateOrder = createProcessor<OrderState>("validate-order")
  .process(async (state, ctx) => {
    // Only validates the order
  });

const processPayment = createProcessor<OrderState>("process-payment")
  .process(async (state, ctx) => {
    // Only processes payment
  });
```

#### **2. Immutable State Updates**

```typescript
// ❌ Bad: Mutating state directly
const badProcessor = createProcessor<MyState>("mutator")
  .process(async (state, ctx) => {
    state.items.push(newItem); // Mutation!
    state.total += newItem.price;
    return Success(state);
  });

// ✅ Good: Immutable updates
const goodProcessor = createProcessor<MyState>("immutable")
  .process(async (state, ctx) => {
    return Success({
      ...state,
      items: [...state.items, newItem],
      total: state.total + newItem.price
    });
  });
```

#### **3. Proper Error Handling**

```typescript
// ❌ Bad: Throwing exceptions
const badProcessor = createProcessor<MyState>("thrower")
  .process(async (state, ctx) => {
    if (invalid) {
      throw new Error("Something went wrong"); // Don't throw!
    }
    return Success(state);
  });

// ✅ Good: Using Result types
const goodProcessor = createProcessor<MyState>("safe")
  .process(async (state, ctx) => {
    if (invalid) {
      return Failure(new ValidationError("field", value, "Validation failed"));
    }
    return Success(state);
  });
```

### 🚀 **Performance Optimization**

#### **1. Use Session Isolation for Concurrent Workloads**

```typescript
// ❌ Bad: No session isolation in multi-tenant app
async function processUserData(userId: string, data: any) {
  return await runtime.execute("process-data", createState(data));
}

// ✅ Good: Session isolation prevents resource conflicts
async function processUserData(userId: string, data: any) {
  const sessionId = `user-${userId}-${Date.now()}`;
  
  try {
    return await runtime.executeInSession(
      "process-data", 
      createState(data), 
      sessionId
    );
  } finally {
    await runtime.stopSession(sessionId);
  }
}
```

#### **2. Configure Appropriate Concurrency**

```typescript
// Adjust concurrency based on resource requirements
const cpuIntensiveProcessor = createProcessor<MyState>("cpu-heavy")
  .withQueueConfig({ 
    concurrency: 2 // Low concurrency for CPU-bound work
  })
  .process(async (state, ctx) => {
    // CPU-intensive processing
  });

const ioProcessor = createProcessor<MyState>("io-bound")
  .withQueueConfig({ 
    concurrency: 20 // Higher concurrency for I/O-bound work
  })
  .process(async (state, ctx) => {
    // Network calls, database queries, etc.
  });
```

#### **3. Use Parallel Processing When Possible**

```typescript
// ❌ Slow: Sequential processing
const slowWorkflow = chainProcessors({
  name: "slow",
  processors: [taskA, taskB, taskC] // Each waits for previous
});

// ✅ Fast: Parallel processing when tasks are independent
const fastWorkflow = parallelProcessors({
  name: "fast",
  processors: [taskA, taskB, taskC] // All run concurrently
});
```

### 🛡️ **Error Recovery**

#### **1. Implement Retry Policies**

```typescript
const resilientProcessor = createProcessor<MyState>("resilient")
  .withRetryPolicy({
    maxAttempts: 3,
    backoffMs: 1000,
    backoffType: "exponential",
    shouldRetry: (error) => {
      // Don't retry validation errors
      if (error instanceof ValidationError) return false;
      
      // Don't retry critical business errors
      if (error.severity === "critical") return false;
      
      // Retry network and temporary errors
      return error.retryable;
    }
  })
  .process(async (state, ctx) => {
    // Your logic here
  });
```

#### **2. Handle Timeouts Gracefully**

```typescript
const timeoutProcessor = createProcessor<MyState>("timeout-aware")
  .withTimeout(30000) // 30 second timeout
  .process(async (state, ctx) => {
    try {
      // Long-running operation
      const result = await longRunningOperation(state.data);
      return Success({ ...state, result });
    } catch (error) {
      if (error.name === "TimeoutError") {
        // Handle timeout specifically
        ctx.log.warn("Operation timed out, scheduling retry");
        return Failure(new TimeoutError("Operation timed out", 30000));
      }
      
      return Failure(error);
    }
  });
```

### 🔧 **Resource Management**

#### **1. Always Clean Up Sessions**

```typescript
class WorkflowManager {
  async executeWorkflow(workflowId: string, data: any) {
    const sessionId = `workflow-${workflowId}`;
    
    try {
      const result = await this.runtime.executeInSession(
        "main-workflow",
        createState(data),
        sessionId
      );
      
      return result;
    } finally {
      // Always clean up, even if execution fails
      await this.runtime.stopSession(sessionId);
    }
  }
}
```

#### **2. Monitor Resource Usage**

```typescript
// Set up resource monitoring
setInterval(async () => {
  const stats = await runtime.getStats();
  const activeSessions = runtime.getActiveSessions();
  
  console.log({
    runningJobs: stats.runningJobs,
    activeSessions: activeSessions.length,
    memoryUsage: process.memoryUsage()
  });
  
  // Alert if too many active sessions
  if (activeSessions.length > 100) {
    console.warn("High number of active sessions:", activeSessions.length);
  }
}, 60000); // Check every minute
```

### 📝 **Code Organization**

#### **1. Group Related Processors**

```typescript
// processors/order/validation.ts
export const validateOrder = createProcessor<OrderState>("validate-order")
  .process(async (state, ctx) => { /* ... */ });

export const validatePayment = createProcessor<OrderState>("validate-payment")
  .process(async (state, ctx) => { /* ... */ });

// processors/order/fulfillment.ts
export const createShipment = createProcessor<OrderState>("create-shipment")
  .process(async (state, ctx) => { /* ... */ });

// workflows/order.ts
import { validateOrder, validatePayment } from '../processors/order/validation';
import { createShipment } from '../processors/order/fulfillment';

export const orderWorkflow = chainProcessors({
  name: "process-order",
  processors: [validateOrder, validatePayment, createShipment]
});
```

#### **2. Use TypeScript Effectively**

```typescript
// Define clear interfaces
interface UserRegistrationState extends AppState {
  email: string;
  password: string;
  profile: UserProfile;
  verificationToken?: string;
  isVerified: boolean;
}

// Use generic constraints
function createValidationProcessor<T extends AppState>(
  name: string,
  validator: (state: T) => ValidationResult
) {
  return createProcessor<T>(name)
    .process(async (state, ctx) => {
      const validation = validator(state);
      
      if (!validation.isValid) {
        return Failure(new ValidationError(
          validation.field,
          validation.value,
          validation.message
        ));
      }
      
      return Success(state);
    });
}
```

---

## Troubleshooting

### 🐛 **Common Issues**

#### **Problem: Jobs Never Complete**

```typescript
// ❌ Symptom: Jobs get stuck in "active" state
const stuckProcessor = createProcessor<MyState>("stuck")
  .process(async (state, ctx) => {
    // Missing return statement!
    await doSomething();
    // No Success() or Failure() returned
  });

// ✅ Solution: Always return a Result
const fixedProcessor = createProcessor<MyState>("fixed")
  .process(async (state, ctx) => {
    await doSomething();
    return Success(state); // Always return!
  });
```

#### **Problem: Memory Leaks with Sessions**

```typescript
// ❌ Symptom: Memory usage grows over time
class LeakyService {
  async processData(data: any) {
    const sessionId = `session-${Date.now()}`;
    await runtime.executeInSession("processor", state, sessionId);
    // Missing session cleanup!
  }
}

// ✅ Solution: Always clean up sessions
class CleanService {
  async processData(data: any) {
    const sessionId = `session-${Date.now()}`;
    
    try {
      return await runtime.executeInSession("processor", state, sessionId);
    } finally {
      await runtime.stopSession(sessionId); // Always cleanup!
    }
  }
}
```

#### **Problem: Redis Connection Issues**

```typescript
// ❌ Symptom: "Connection is closed" errors
const runtime = createQueueRuntimeWithDefaults({
  host: "localhost",
  port: 6379,
  // Missing connection resilience settings
});

// ✅ Solution: Configure connection resilience
const resilientRuntime = createQueueRuntimeWithDefaults({
  host: "localhost",
  port: 6379,
  connectTimeout: 10000,
  lazyConnect: true,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  keepAlive: 30000
});
```

### 📊 **Debugging Techniques**

#### **1. Enable Debug Logging**

```typescript
const processor = createProcessor<MyState>("debug-processor")
  .process(async (state, ctx) => {
    ctx.log.debug("Processor starting", { 
      sessionId: ctx.metadata.sessionId,
      executionId: ctx.metadata.executionId,
      stateKeys: Object.keys(state)
    });
    
    // Your logic
    const result = await doProcessing(state);
    
    ctx.log.debug("Processor completed", {
      resultType: typeof result,
      processingTime: Date.now() - ctx.metadata.startTime
    });
    
    return Success(result);
  });
```

#### **2. Monitor Queue Health**

```typescript
// Check queue statistics
async function diagnoseQueues() {
  const queueStats = await runtime.getQueueStats();
  
  for (const [queueName, stats] of Object.entries(queueStats)) {
    console.log(`Queue: ${queueName}`);
    console.log(`  Waiting: ${stats.waiting}`);
    console.log(`  Active: ${stats.active}`);
    console.log(`  Failed: ${stats.failed}`);
    
    // Alert on issues
    if (stats.failed > stats.completed) {
      console.warn(`⚠️ Queue ${queueName} has more failures than completions!`);
    }
    
    if (stats.waiting > 1000) {
      console.warn(`⚠️ Queue ${queueName} has ${stats.waiting} waiting jobs!`);
    }
  }
}
```

#### **3. Trace Execution Flow**

```typescript
// Add execution tracing
runtime.on("processor:job:started", (data) => {
  console.log(`🔄 Started: ${data.processorName} (${data.executionId})`);
});

runtime.on("processor:job:completed", (data) => {
  console.log(`✅ Completed: ${data.processorName} in ${data.executionTime}ms`);
});

runtime.on("processor:job:failed", (data) => {
  console.log(`❌ Failed: ${data.processorName} - ${data.error.message}`);
});
```

### 🔧 **Performance Debugging**

#### **1. Identify Bottlenecks**

```typescript
// Add performance monitoring to processors
const monitoredProcessor = createProcessor<MyState>("monitored")
  .process(async (state, ctx) => {
    const startTime = performance.now();
    
    try {
      // Your processing logic
      const result = await heavyProcessing(state);
      
      const duration = performance.now() - startTime;
      ctx.log.info("Processing completed", { 
        duration,
        inputSize: JSON.stringify(state).length,
        outputSize: JSON.stringify(result).length
      });
      
      return Success(result);
    } catch (error) {
      const duration = performance.now() - startTime;
      ctx.log.error("Processing failed", { 
        duration,
        error: error.message 
      });
      
      return Failure(error);
    }
  });
```

#### **2. Monitor System Resources**

```typescript
// System resource monitoring
setInterval(() => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();
  
  console.log({
    memory: {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + "MB",
      rss: Math.round(memUsage.rss / 1024 / 1024) + "MB"
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system
    }
  });
}, 30000); // Every 30 seconds
```

---

## Performance

### 📈 **Benchmarks**

Based on comprehensive testing with 85+ tests:

| Operation | Local Runtime | Distributed Runtime |
|-----------|---------------|-------------------|
| Simple processor execution | ~1-5ms | ~6-20ms |
| Parallel execution (3 processors) | ~10-30ms | ~100-500ms |
| Session isolation overhead | N/A | ~15-50ms |
| Redis state persistence | N/A | ~2-10ms |
| Queue operations | N/A | ~5-15ms |

### ⚡ **Optimization Strategies**

#### **1. Choose the Right Runtime**

```typescript
// For development and simple use cases
const localRuntime = new LocalRuntime<MyState>();

// For production and distributed scenarios
const distributedRuntime = createQueueRuntimeWithDefaults<MyState>();

// For high-concurrency scenarios with isolation needs
const sessionRuntime = createQueueRuntimeWithDefaults<MyState>();
```

#### **2. Optimize Processor Configuration**

```typescript
// CPU-intensive tasks
const cpuProcessor = createProcessor<MyState>("cpu-intensive")
  .withQueueConfig({ 
    concurrency: Math.max(1, os.cpus().length - 1) // Leave one CPU core free
  })
  .process(async (state, ctx) => {
    // CPU-bound work
  });

// I/O-intensive tasks  
const ioProcessor = createProcessor<MyState>("io-intensive")
  .withQueueConfig({ 
    concurrency: 50 // Higher concurrency for I/O waiting
  })
  .process(async (state, ctx) => {
    // Network calls, file operations, etc.
  });

// Memory-intensive tasks
const memoryProcessor = createProcessor<MyState>("memory-intensive")
  .withQueueConfig({ 
    concurrency: 2 // Low concurrency to prevent OOM
  })
  .process(async (state, ctx) => {
    // Large data processing
  });
```

#### **3. Use Batch Processing for High Throughput**

```typescript
// Instead of processing items one by one
for (const item of largeDataset) {
  await runtime.execute("process-item", createState(item));
}

// Process in batches for better performance
const batches = chunk(largeDataset, 100); // Groups of 100

for (const batch of batches) {
  const batchStates = batch.map(item => createState(item));
  
  const batchProcessor = batchProcessor({
    name: "process-batch",
    processorName: "process-item", 
    payloads: batchStates
  });
  
  await runtime.execute("process-batch", createState({}));
}
```

#### **4. Implement Connection Pooling**

```typescript
// Configure Redis connection pooling
const runtime = createQueueRuntimeWithDefaults({
  host: "localhost",
  port: 6379,
  family: 4,
  keepAlive: true,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableReadyCheck: true,
  lazyConnect: true,
  // Connection pool settings
  connectTimeout: 10000,
  commandTimeout: 5000
});
```

### 📊 **Performance Monitoring**

#### **1. Built-in Metrics**

```typescript
// Real-time performance monitoring
setInterval(async () => {
  const stats = await runtime.getStats();
  const queueStats = await runtime.getQueueStats();
  
  // Calculate throughput
  const totalProcessed = stats.completedJobs + stats.failedJobs;
  const uptimeSeconds = stats.uptime / 1000;
  const throughputPerSecond = totalProcessed / uptimeSeconds;
  
  console.log({
    throughput: `${throughputPerSecond.toFixed(2)} jobs/sec`,
    successRate: `${(stats.completedJobs / totalProcessed * 100).toFixed(1)}%`,
    activeJobs: stats.runningJobs,
    queueBacklog: Object.values(queueStats).reduce((sum, q) => sum + q.waiting, 0)
  });
}, 10000); // Every 10 seconds
```

#### **2. Custom Performance Tracking**

```typescript
class PerformanceTracker {
  private metrics = new Map<string, number[]>();
  
  recordExecutionTime(processorName: string, duration: number) {
    if (!this.metrics.has(processorName)) {
      this.metrics.set(processorName, []);
    }
    
    this.metrics.get(processorName)!.push(duration);
    
    // Keep only last 100 measurements
    const measurements = this.metrics.get(processorName)!;
    if (measurements.length > 100) {
      measurements.shift();
    }
  }
  
  getStatistics(processorName: string) {
    const measurements = this.metrics.get(processorName) || [];
    
    if (measurements.length === 0) return null;
    
    const sorted = [...measurements].sort((a, b) => a - b);
    
    return {
      count: measurements.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: measurements.reduce((a, b) => a + b) / measurements.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }
}

// Integrate with processors
const tracker = new PerformanceTracker();

const trackedProcessor = createProcessor<MyState>("tracked")
  .process(async (state, ctx) => {
    const start = performance.now();
    
    try {
      const result = await yourProcessingLogic(state);
      
      return Success(result);
    } finally {
      const duration = performance.now() - start;
      tracker.recordExecutionTime("tracked", duration);
    }
  });
```

---

## Contributing

We welcome contributions to AM2Z! Here's how to get started:

### 🛠️ **Development Setup**

```bash
# Clone the repository
git clone https://github.com/awaaate/am2z.git
cd am2z

# Install dependencies
npm install

# Run tests
bun test

# Run linting
bun run lint

# Build the library
bun run build
```

### 📝 **Code Guidelines**

1. **Type Safety**: All code must be fully typed with TypeScript
2. **Testing**: Add tests for new features (aim for 85%+ coverage)
3. **Error Handling**: Use Result types, never throw exceptions
4. **Documentation**: Update README for new features
5. **Session Isolation**: Ensure new features work with session isolation

### 🔍 **Running Tests**

```bash
# Run all tests
bun test

# Run specific test suite
bun test src/tests/distributed/queue-runtime-lifecycle.test.ts

# Run tests with Redis (for distributed tests)
docker run -d --name redis-test -p 6379:6379 redis:7-alpine
bun test src/tests/distributed/
docker stop redis-test && docker rm redis-test
```

### 📋 **Pull Request Process**

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes with tests
4. Ensure all tests pass: `bun test`
5. Run linting: `bun run lint`
6. Commit with clear message
7. Push and create pull request

### 🐛 **Reporting Issues**

When reporting issues, please include:

- AM2Z version
- Node.js/Bun version  
- Runtime type (Local/Queue)
- Minimal reproduction code
- Error messages and stack traces
- Expected vs actual behavior

---

## License

MIT © 2025 AM2Z Contributors

Built with ❤️ for the TypeScript community