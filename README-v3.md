# AM2Z Framework v3.0 🚀

> Simplified Multi-Agent System for AI Applications

AM2Z v3.0 is a complete architectural redesign focused on **simplicity**, **composability**, and **developer experience**. Inspired by React's functional components, every agent is a pure function that transforms global state.

## 🎯 Core Philosophy

```typescript
// An agent is just a function:
(state: GlobalState, context: AgentContext) => Promise<GlobalState>
```

**That's it.** No complex abstractions, no heavy dependencies, no cognitive overhead.

## ✨ Key Features

- **🎯 Simple**: Agents are pure functions - easy to understand, test, and debug
- **🔄 Composable**: Chain, parallelize, route, and retry agents like React components
- **🚀 Flexible**: Run locally for development or distributed with BullMQ for production
- **🛡️ Type-safe**: Full TypeScript support with strong type inference
- **📊 Observable**: Built-in events, metrics, and logging
- **⚡ Fast**: Minimal overhead, maximum performance

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Agent A       │    │   Agent B        │    │   Agent C       │
│                 │    │                  │    │                 │
│ (state) => {    │───▶│ (state) => {     │───▶│ (state) => {    │
│   ...process    │    │   ...transform   │    │   ...finalize   │
│   return state  │    │   return state   │    │   return state  │
│ }               │    │ }                │    │ }               │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                Global State Flow                            │
    │  { user: {...}, data: {...}, pipeline: {...}, ... }        │
    └─────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### Installation

```bash
npm install am2z@3.0.0
# or
bun install am2z@3.0.0
```

### Basic Example

```typescript
import { agent, chain, createLocalRuntime } from 'am2z';

// Define your global state shape
interface AppState {
  user: { name: string; preferences: string[] };
  data: { items: string[]; processed: boolean };
}

// Create agents as pure functions
const dataCollector = agent<AppState>(
  "dataCollector",
  async (state, ctx) => {
    ctx.log.info("🔍 Collecting data...");
    
    // Your logic here
    const items = await fetchDataFromAPI();
    
    return {
      ...state,
      data: { ...state.data, items, processed: false }
    };
  }
);

const dataProcessor = agent<AppState>(
  "dataProcessor", 
  async (state, ctx) => {
    ctx.log.info("⚙️ Processing data...");
    
    const processedItems = state.data.items.map(item => 
      processWithAI(item, state.user.preferences)
    );
    
    return {
      ...state,
      data: { items: processedItems, processed: true }
    };
  }
);

// Compose agents into pipelines
const pipeline = chain(dataCollector, dataProcessor);

// Run locally
const runtime = createLocalRuntime<AppState>();
runtime.register(pipeline);

const result = await runtime.execute("pipeline", {
  user: { name: "Alice", preferences: ["tech"] },
  data: { items: [], processed: false }
});

console.log("✅ Result:", result.state);
```

### Distributed Execution

```typescript
import { createDistributedRuntime } from 'am2z';

// Production-ready distributed runtime with BullMQ
const runtime = createDistributedRuntime<AppState>({
  queueName: "my-agents",
  redis: { host: "localhost", port: 6379 },
  concurrency: 10
});

runtime
  .register(dataCollector)
  .register(dataProcessor);

await runtime.start();

// Each agent runs as a separate job in the queue
const result = await runtime.execute("dataCollector", initialState);
```

## 🔧 Agent Composition

### Sequential Chain

```typescript
const pipeline = chain(
  agentA,  // agentA(state) -> stateA
  agentB,  // agentB(stateA) -> stateB  
  agentC   // agentC(stateB) -> finalState
);
```

### Parallel Execution

```typescript
const parallelAnalysis = parallel(
  sentimentAgent,    // All agents receive same input state
  topicAgent,        // Results are merged into output state
  entityAgent
);
```

### Conditional Routing

```typescript
const smartRouter = router(
  (state) => state.user.plan === "premium" ? "premium" : "standard",
  {
    premium: advancedProcessor,
    standard: basicProcessor
  },
  fallbackAgent  // optional fallback
);
```

### Error Handling & Retry

```typescript
const resilientAgent = withRetry(
  aiAgent,     // agent to retry
  3,           // max attempts  
  1000         // backoff ms
);
```

## 📡 Inter-Agent Communication

```typescript
const orchestrator = agent("orchestrator", async (state, ctx) => {
  // Call another agent
  const processedState = await ctx.call("dataProcessor", state);
  
  // Emit events for observability
  ctx.emit("processing:completed", { itemCount: processedState.data.items.length });
  
  // Make decisions based on results
  if (processedState.data.items.length > 100) {
    return ctx.call("batchProcessor", processedState);
  }
  
  return processedState;
});
```

## 🎮 Runtime Comparison

| Feature | Local Runtime | Distributed Runtime |
|---------|---------------|-------------------|
| **Use Case** | Development, Testing | Production, Scale |
| **Execution** | In-process | BullMQ + Redis |
| **Concurrency** | JavaScript async | Multi-worker |
| **Fault Tolerance** | Process-level | Job-level retry |
| **Monitoring** | Console logs | Full observability |
| **Dependencies** | None | Redis + BullMQ |

## 🔄 Migration from v2.0

### Old Way (v2.0)
```typescript
// Complex Effect-TS based approach
const oldAgent = agent("test", (ctx) => 
  pipe(
    Effect.sync(() => ctx.state),
    Effect.flatMap(state => processData(state)),
    Effect.map(result => ({ continue: true, output: result }))
  )
);
```

### New Way (v3.0)
```typescript
// Simple async function
const newAgent = agent("test", async (state, ctx) => {
  const result = await processData(state);
  return { ...state, processedData: result };
});
```

### Key Changes

1. **No more Effect-TS**: Removed complex functional programming abstractions
2. **Global state only**: No more local state confusion
3. **Simplified context**: Only essential tools (log, call, emit)
4. **Better TypeScript**: Strong inference without type gymnastics
5. **Runtime flexibility**: Same agents, different execution strategies

## 📊 Performance & Observability

### Built-in Metrics
```typescript
const result = await runtime.execute("myAgent", state);

console.log({
  success: result.metrics.success,
  executionTime: result.metrics.executionTime,
  error: result.metrics.error
});
```

### Event Streaming
```typescript
runtime.on("job:completed", (data) => {
  console.log(`✅ Agent ${data.agentName} completed`);
});

runtime.on("job:failed", (data) => {
  console.log(`❌ Agent ${data.agentName} failed: ${data.error}`);
});
```

## 🤔 Why the Rewrite?

### Problems with v2.0
- ❌ **Too complex**: Effect-TS added unnecessary cognitive load
- ❌ **Type confusion**: Multiple state types (local vs global)
- ❌ **Runtime coupling**: Agents tied to specific execution models
- ❌ **Poor DX**: Hard to debug, test, and understand

### Solutions in v3.0
- ✅ **Radically simple**: Pure functions, no abstractions
- ✅ **One state model**: Global state flows through everything
- ✅ **Runtime agnostic**: Same agents, any execution strategy
- ✅ **Great DX**: Easy to reason about, test, and debug

## 🎯 Best Practices

### 1. Keep Agents Pure
```typescript
// ✅ Good: Pure function
const goodAgent = agent("processor", async (state, ctx) => {
  const result = await processData(state.input);
  return { ...state, output: result };
});

// ❌ Bad: Side effects
const badAgent = agent("processor", async (state, ctx) => {
  await saveToDatabase(state.input); // Side effect!
  return state;
});
```

### 2. Use Composition
```typescript
// ✅ Good: Compose small agents
const pipeline = chain(
  validateInput,
  processData, 
  formatOutput
);

// ❌ Bad: Monolithic agent
const monolithAgent = agent("everything", async (state, ctx) => {
  // 200 lines of mixed logic...
});
```

### 3. Type Your State
```typescript
// ✅ Good: Specific state interface
interface MyAppState extends GlobalState {
  user: User;
  session: Session;
  data: ProcessedData;
}

const typedAgent = agent<MyAppState>("typed", async (state, ctx) => {
  // Full TypeScript support!
  return { ...state, user: { ...state.user, lastSeen: Date.now() } };
});
```

## 🛣️ Roadmap

- [ ] **v3.1**: React DevTools integration
- [ ] **v3.2**: Distributed state synchronization
- [ ] **v3.3**: Agent marketplace & plugins
- [ ] **v3.4**: Visual pipeline builder
- [ ] **v3.5**: Multi-language agents (Python, Go)

## 📚 Examples

Check out the `/examples` directory for complete working examples:

- [Simple Agent Pipeline](./src/examples/simple-agent-example.ts)
- [E-commerce Recommendation System](./examples/ecommerce-agents.ts)
- [Content Moderation Pipeline](./examples/content-moderation.ts)
- [Data Processing Workflow](./examples/data-pipeline.ts)

## 🤝 Contributing

We welcome contributions! The new architecture makes it much easier to:

1. **Add new agents**: Just implement the simple function interface
2. **Improve runtimes**: Implement the `AgentRuntime` interface
3. **Add utilities**: Extend the composition functions

## 📜 License

MIT License - see [LICENSE](./LICENSE) for details.

---

**Made with ❤️ by the AM2Z Team**

*"Simplicity is the ultimate sophistication" - Leonardo da Vinci* 