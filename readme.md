# AM2Z

A modern TypeScript framework for building scalable, type-safe processor workflows that run locally or distributed.

## Why AM2Z?

- **🔒 Session Isolation**: Complete isolation between concurrent workflows
- **⚡ Local & Distributed**: Same code runs in-process or across Redis/BullMQ
- **🛡️ Type Safety**: Full TypeScript support with generic state management
- **🔄 Robust Error Handling**: Rust-style Result types with comprehensive error taxonomy
- **📊 Built-in Monitoring**: Bull Board integration and detailed metrics

## Quick Start

### Installation

```bash
npm install am2z bullmq ioredis zod
```

### Basic Example

```typescript
import { createProcessor, chainProcessors, LocalRuntime, createAppState, Success, Failure } from "am2z";

// Define your state
interface OrderState extends AppState {
  orderId: string;
  total: number;
  status: "pending" | "completed" | "failed";
}

// Create processors
const validateOrder = createProcessor<OrderState>("validate-order")
  .withTimeout(5000)
  .process(async (state, ctx) => {
    ctx.log.info(`Validating order ${state.orderId}`);
    
    if (state.total <= 0) {
      return Failure(new Error("Invalid order total"));
    }
    
    return Success({
      ...state,
      status: "completed"
    });
  });

// Chain processors
const orderFlow = chainProcessors<OrderState>({
  name: "process-order",
  processors: [validateOrder],
  timeout: 30000
});

// Execute
const runtime = new LocalRuntime<OrderState>();
runtime.register(orderFlow);
await runtime.start();

const initialState = createAppState("order-123", {
  orderId: "ORD-001",
  total: 99.99,
  status: "pending"
});

const result = await runtime.execute("process-order", initialState);

if (result.success) {
  console.log("Order processed:", result.state);
} else {
  console.error("Failed:", result.error);
}

await runtime.stop();
```

## Distributed Processing

Switch to distributed processing by changing one line:

```typescript
import { createQueueRuntimeWithDefaults } from "am2z";

// Distributed runtime with Redis/BullMQ
const runtime = createQueueRuntimeWithDefaults<OrderState>({
  host: "localhost",
  port: 6379
});

runtime.register(orderFlow);
await runtime.start();

// Same execution API
const result = await runtime.execute("process-order", initialState);
```

## Session Isolation

**NEW**: Complete isolation between concurrent sessions:

```typescript
// Each session gets isolated queues and workers
const sessionId = "session-123";

const result = await runtime.executeInSession(
  "process-order", 
  initialState, 
  sessionId
);

// Clean up session when done
await runtime.stopSession(sessionId);
```

### Batch Processing with Session Isolation

```typescript
import { batchProcessor } from "am2z";

const batchFlow = batchProcessor<OrderState>({
  name: "process-multiple-orders",
  processorName: "validate-order",
  payloads: [order1, order2, order3],
  sessionId: "batch-session-456",
  isolateSession: true // Creates dedicated queues for this batch
});

runtime.register(batchFlow);
const result = await runtime.executeInSession("process-multiple-orders", initialState, "batch-session-456");
```

## Core Concepts

### State Management

All state extends `AppState` and is immutable:

```typescript
interface MyState extends AppState {
  userId: string;
  data: any;
}

// State is automatically versioned and tracked
const state = createAppState("session-1", { userId: "123", data: {} });
```

### Error Handling

Built-in Result types prevent exceptions:

```typescript
import { Success, Failure, ValidationError } from "am2z";

const processor = createProcessor<MyState>("validator")
  .process(async (state, ctx) => {
    if (!state.userId) {
      return Failure(new ValidationError("userId", "", "User ID required"));
    }
    
    return Success(state);
  });
```

### Processor Composition

Chain, parallelize, route, or batch processors:

```typescript
// Sequential chain
const chain = chainProcessors({ name: "workflow", processors: [step1, step2, step3] });

// Parallel execution
const parallel = parallelProcessors({ name: "parallel-work", processors: [task1, task2] });

// Dynamic routing
const router = routeProcessor("router", 
  (state) => state.type, 
  { "typeA": processorA, "typeB": processorB }
);

// Batch processing
const batch = batchProcessor({
  name: "batch-job",
  processorName: "single-processor",
  payloads: [payload1, payload2, payload3],
  sessionId: "batch-123",
  isolateSession: true
});
```

## Monitoring

### Bull Board Integration

```typescript
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

const serverAdapter = new ExpressAdapter();
const queues = runtime.getQueues();

createBullBoard({
  queues: queues.map(queue => new BullMQAdapter(queue)),
  serverAdapter
});

// Access dashboard at /admin/queues
```

### Runtime Statistics

```typescript
// Get overall stats
const stats = await runtime.getStats();
console.log("Running jobs:", stats.runningJobs);
console.log("Completed:", stats.completedJobs);

// Get session-specific stats
const sessionStats = await runtime.getSessionStats("session-123");
console.log("Session queues:", sessionStats);

// List active sessions
const activeSessions = runtime.getActiveSessions();
console.log("Active sessions:", activeSessions);
```

## Advanced Features

### Dynamic Processor Registration

Register processors at runtime:

```typescript
const newProcessor = createProcessor<MyState>("dynamic-feature")
  .process(async (state, ctx) => {
    // New functionality
    return Success(state);
  });

runtime.register(newProcessor);
await runtime.syncProcessors(); // Creates infrastructure
```

### Retry Policies & Timeouts

```typescript
const resilientProcessor = createProcessor<MyState>("resilient")
  .withTimeout(30000)
  .withRetryPolicy({ 
    maxAttempts: 3, 
    backoffMs: 2000,
    shouldRetry: (error) => error.code !== "PERMANENT_FAILURE"
  })
  .withQueueConfig({ 
    concurrency: 5,
    rateLimitRpm: 100 
  });
```

### Event System

```typescript
// Listen to processor events
runtime.on("processor:job:completed", (data) => {
  console.log("Job completed:", data.executionId);
});

runtime.on("processor:job:failed", (data) => {
  console.log("Job failed:", data.error);
});

// Custom events within processors
const processor = createProcessor<MyState>("event-emitter")
  .process(async (state, ctx) => {
    ctx.emit("custom:event", { message: "Hello from processor" });
    return Success(state);
  });
```

## Session Management Best Practices

### Concurrent Sessions

```typescript
class SessionManager {
  private activeSessions = new Map();
  
  async createSession(config: any): Promise<string> {
    const sessionId = `session-${Date.now()}`;
    const runtime = createQueueRuntimeWithDefaults();
    
    // Register session-specific processors
    runtime.register(myProcessor);
    await runtime.start();
    
    this.activeSessions.set(sessionId, { runtime, config });
    return sessionId;
  }
  
  async executeInSession(sessionId: string, processorName: string, state: any) {
    const session = this.activeSessions.get(sessionId);
    return await session.runtime.executeInSession(processorName, state, sessionId);
  }
  
  async cleanupSession(sessionId: string) {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      await session.runtime.stopSession(sessionId);
      await session.runtime.disconnect();
      this.activeSessions.delete(sessionId);
    }
  }
}
```

### Error Recovery

```typescript
// Handle session failures gracefully
try {
  const result = await runtime.executeInSession(processorName, state, sessionId);
} catch (error) {
  if (error instanceof TimeoutError) {
    // Session timed out - clean up
    await runtime.stopSession(sessionId);
  } else if (error instanceof ProcessorExecutionError) {
    // Processor failed - retry or clean up
    await runtime.stopSession(sessionId);
  }
  throw error;
}
```

## Configuration

### Runtime Configuration

```typescript
const runtime = createQueueRuntimeWithDefaults(
  // Redis config
  {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD
  },
  // Runtime config
  {
    defaultTimeout: 300000, // 5 minutes
    maxCallDepth: 15,
    autoCleanupInterval: 60000 // 1 minute
  }
);
```

### Environment Variables

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-password
AM2Z_DEFAULT_TIMEOUT=300000
AM2Z_MAX_CALL_DEPTH=15
```

## API Reference

### Core Functions

| Function | Description |
|----------|-------------|
| `createProcessor<T>(name)` | Create a new processor |
| `chainProcessors({ processors })` | Sequential execution |
| `parallelProcessors({ processors })` | Parallel execution |
| `batchProcessor({ processorName, payloads })` | Batch execution |
| `routeProcessor(name, selector, routes)` | Dynamic routing |

### Runtime Methods

| Method | Description |
|--------|-------------|
| `runtime.execute(name, state, sessionId?)` | Execute processor |
| `runtime.executeInSession(name, state, sessionId)` | Session-isolated execution |
| `runtime.stopSession(sessionId)` | Stop specific session |
| `runtime.getSessionStats(sessionId)` | Get session statistics |
| `runtime.getActiveSessions()` | List active sessions |

### Result Types

```typescript
type ProcessorResult<T> = {
  success: boolean;
  state: T;
  error?: AM2ZError;
  executionTime: number;
  metadata: ExecutionMetadata;
};

// Use with type guards
if (result.success) {
  // result.state is available
} else {
  // result.error is available
}
```

## Migration from v3.x

### Breaking Changes

1. **Session Isolation**: Add `sessionId` parameter to executions
2. **New APIs**: `executeInSession()`, `stopSession()`, `getSessionStats()`
3. **Batch Processor**: New `sessionId` and `isolateSession` options

### Migration Example

```typescript
// v3.x
const result = await runtime.execute("processor", state);

// v4.x - backward compatible
const result = await runtime.execute("processor", state);

// v4.x - with session isolation (recommended)
const result = await runtime.executeInSession("processor", state, sessionId);
```

## Examples

See `src/examples/` for complete examples:

- **Order Processing**: E-commerce workflow with validation and payment
- **Image Processing**: Parallel image operations with thumbnails and watermarks
- **Multi-tenant SaaS**: Dynamic processor registration with feature flags
- **Batch Processing**: Financial transaction processing at scale

## Performance Tips

1. **Use Session Isolation**: Prevents resource conflicts in concurrent workloads
2. **Configure Concurrency**: Set appropriate `concurrency` limits per processor
3. **Implement Timeouts**: Always set realistic timeout values
4. **Monitor Queues**: Use Bull Board to monitor queue health
5. **Clean Up Sessions**: Always call `stopSession()` when done

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `bun test`
4. Run linting: `bun run lint`
5. Submit a pull request

## License

MIT © 2025 AM2Z Contributors