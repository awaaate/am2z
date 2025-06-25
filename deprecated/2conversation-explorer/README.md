# AM2Z Conversation Explorer

An advanced conversation exploration system built with AM2Z v4.0, featuring distributed processing, real-time monitoring, and intelligent dialogue generation.

## 🎯 Overview

The Conversation Explorer generates and explores branching conversations using multiple personas, leveraging AM2Z's powerful processor composition and distributed execution capabilities.

### Key Features

- 🎭 **Multi-Persona Conversations**: Simulate discussions from different perspectives
- 🌳 **Branching Dialogue Trees**: Generate follow-up questions dynamically
- 🚀 **Distributed Processing**: Scale across multiple workers with BullMQ
- 📊 **Real-time Monitoring**: Track progress with queue dashboards
- 🔄 **Intelligent Routing**: Automatic stage management and flow control
- 🛡️ **Fault Tolerance**: Built-in retry policies and error recovery

## 🏗️ Architecture

The system uses AM2Z's modular processor architecture:

```
📦 Conversation Explorer
├── 🎭 Types & Domain Models
├── 🤖 AI Service (Mock & Real)
├── ⚡ Processors
│   ├── 🔍 Answer Question (Atomic)
│   ├── 📦 Batch Answerer (Call-based)
│   ├── 🌱 Generate Questions (AI-powered)
│   └── 📊 Analytics (Metrics & Completion)
├── 🎼 Orchestrator
│   ├── 🔀 Stage Router (Route-based)
│   ├── ⛓️ Main Chain (Sequential)
│   └── 🚀 Advanced Chain (Parallel)
└── 📊 Monitoring
    ├── 🎛️ Bull Board Integration
    └── 📈 Simple Queue Monitor
```

### AM2Z Capabilities Utilized

1. **Processor Composition**:
   - `chainProcessors`: Sequential execution
   - `parallelProcessors`: Concurrent processing
   - `routeProcessor`: Conditional routing

2. **Inter-Processor Communication**:
   - `ctx.call()`: Delegate to other processors
   - `ctx.emit()`: Event broadcasting
   - State sharing via immutable updates

3. **Distributed Execution**:
   - BullMQ task distribution
   - Horizontal scaling
   - Fault tolerance

## 🚀 Quick Start

### Prerequisites

```bash
# Install dependencies
bun install

# Start Redis (required for distributed mode)
docker run -d -p 6379:6379 redis:latest
```

### Basic Usage

```typescript
import {
  runConversationExplorer,
  createSamplePersonas,
  createSamplePrompts,
} from "./src/conversation-explorer";

// Run with local runtime
const result = await runConversationExplorer(
  createSamplePersonas(),
  createSamplePrompts(),
  {
    maxDepth: 3,
    maxTotalNodes: 20,
    branchingFactor: 2,
    batchSize: 4,
  }
);

console.log(`Generated ${result.analytics.totalNodes} conversation nodes`);
```

### Distributed Mode

```typescript
// Enable distributed processing
const result = await runConversationExplorer(personas, prompts, {
  maxDepth: 4,
  maxTotalNodes: 50,
  useAdvanced: true, // Use parallel processing
});
```

## 🎮 Running the Demos

### 1. Basic Demo (Local Runtime)

```bash
bun run src/conversation-explorer/index.ts
```

### 2. Distributed Demo (BullMQ)

```bash
# Terminal 1: Start the distributed demo
bun run src/conversation-explorer/examples/distributed-demo.ts

# Terminal 2: Monitor queues (optional)
bun run src/conversation-explorer/examples/distributed-demo.ts monitor
```

### 3. With Bull Board UI

```bash
# Terminal 1: Install Bull Board dependencies
bun add express @bull-board/api @bull-board/express bullmq

# Terminal 2: Start Bull Board server (see monitor/bull-board-setup.md)
bun run src/conversation-explorer/monitor/bull-board-server.ts

# Terminal 3: Run distributed explorer
bun run src/conversation-explorer/examples/distributed-demo.ts

# Open http://localhost:3000/admin/queues for monitoring
```

## 🎭 Creating Personas

```typescript
import { createNonEmptyArray } from "../lib/core";

const personas = createNonEmptyArray([
  {
    id: "tech_expert",
    name: "Alex Chen",
    background:
      "Senior software engineer with expertise in distributed systems",
    interests: ["Scalability", "Performance", "Clean architecture"],
    concerns: ["Technical debt", "Vendor lock-in", "Maintenance overhead"],
  },
  {
    id: "business_user",
    name: "Sarah Johnson",
    background: "Business analyst focused on ROI and practical solutions",
    interests: ["Cost efficiency", "User adoption", "Business value"],
    concerns: [
      "Budget constraints",
      "Training requirements",
      "Implementation time",
    ],
  },
]);
```

## 🔧 Configuration Options

```typescript
interface ExplorationConfig {
  maxDepth: number; // Maximum conversation depth
  maxTotalNodes: number; // Total nodes to generate
  branchingFactor: number; // Children per node
  batchSize: number; // Parallel processing batch size
}

// Predefined configurations
const configs = {
  quick: { maxDepth: 2, maxTotalNodes: 10, branchingFactor: 2, batchSize: 3 },
  standard: {
    maxDepth: 3,
    maxTotalNodes: 25,
    branchingFactor: 3,
    batchSize: 5,
  },
  comprehensive: {
    maxDepth: 4,
    maxTotalNodes: 50,
    branchingFactor: 4,
    batchSize: 8,
  },
};
```

## 📊 Monitoring & Analytics

### Real-time Metrics

- **Node Statistics**: Total, completed, pending nodes
- **Processing Performance**: Average response times, throughput
- **Queue Health**: Backlog, active jobs, failure rates
- **Persona Distribution**: Conversation balance across personas

### Queue Monitoring

1. **Simple Monitor** (CLI):

   ```bash
   bun run src/conversation-explorer/examples/distributed-demo.ts monitor
   ```

2. **Bull Board** (Web UI):
   - Install dependencies: See `monitor/bull-board-setup.md`
   - Access: `http://localhost:3000/admin/queues`

## 🔄 Processor Details

### 1. Answer Question Processor

**Purpose**: Generate AI response for a single question
**Type**: Atomic processor
**Features**:

- Individual question processing
- Persona-aware responses
- Metrics collection
- Error handling with retry

```typescript
const processor = createAnswerQuestionProcessor(aiService);
```

### 2. Batch Answerer Processor

**Purpose**: Process multiple questions using `ctx.call()`
**Type**: Orchestration processor
**Features**:

- Parallel question processing
- State management across calls
- Progress tracking
- Failure isolation

```typescript
const processor = createBatchAnswererProcessor(aiService);
```

### 3. Generate Questions Processor

**Purpose**: Create follow-up questions from completed nodes
**Type**: AI-powered processor
**Features**:

- Context-aware question generation
- Dynamic branching
- Persona rotation
- Depth management

```typescript
const processor = createGenerateQuestionsProcessor(aiService);
```

### 4. Analytics Processor

**Purpose**: Update metrics and determine completion
**Type**: Synchronous processor (uses `processWithImmer`)
**Features**:

- Real-time analytics updates
- Completion detection
- Stage transitions
- Performance metrics

```typescript
const processor = analyticsProcessor; // Pre-configured
```

## 🎼 Orchestration Patterns

### 1. Main Orchestrator (Sequential)

```typescript
const mainChain = chainProcessors(
  "conversationExplorerChain",
  stageRouter, // Route based on current stage
  analyticsProcessor // Always update analytics
);
```

### 2. Advanced Orchestrator (Parallel)

```typescript
const advancedChain = chainProcessors(
  "advancedConversationExplorer",
  advancedRouter, // Intelligent routing
  parallelWorkflow, // Parallel processing
  monitoringProcessor // System health checks
);
```

### 3. Stage Routing

```typescript
const stageRouter = routeProcessor(
  "stageRouter",
  (state) => state.currentStage,
  {
    setup: setupProcessor,
    processing: batchAnswerer,
    expanding: generateQuestions,
    completed: completionProcessor,
  },
  analyticsProcessor // Fallback
);
```

## 🚀 Distributed Scaling

### Local Runtime

- Single process execution
- Perfect for development and testing
- Direct processor calls

### Distributed Runtime (BullMQ)

- Multi-worker scaling
- Task distribution across machines
- Automatic retry and failure handling
- Queue-based job management

```typescript
// Switch runtimes easily
const runtime = useDistributed
  ? createDistributedRuntime(config, logger)
  : createLocalRuntime(logger);
```

## 🛡️ Error Handling

### Retry Policies

```typescript
.withRetryPolicy({
  maxAttempts: 3,
  backoffMs: 1000,
  shouldRetry: (error) => error.retryable,
})
```

### Error Recovery

- Automatic state recovery
- Graceful degradation
- Error event emission
- Comprehensive logging

## 🔍 Debugging

### Logging

```typescript
// Processor context provides structured logging
ctx.log.info("Processing question", {
  questionId: question.id,
  persona: question.persona.name,
  depth: question.depth,
});
```

### Events

```typescript
// Emit custom events for monitoring
ctx.emit("question:answered", {
  questionId,
  processingTime,
  success: true,
});
```

### State Inspection

```typescript
// Access current state at any processor
console.log("Current stage:", state.currentStage);
console.log("Pending questions:", state.pendingQuestions.length);
console.log("Analytics:", state.analytics);
```

## 🎯 Best Practices

### 1. Processor Design

- Keep processors atomic and focused
- Use `processWithImmer` for synchronous operations
- Use `process` for async operations
- Implement proper error handling

### 2. State Management

- Immutable state updates
- Clear data flow
- Minimal state dependencies
- Type safety with branded types

### 3. Monitoring

- Emit events for important operations
- Log with structured data
- Monitor queue health in production
- Set up alerts for failures

### 4. Performance

- Optimize batch sizes for your workload
- Monitor processing times
- Use parallel processing for independent tasks
- Clean up completed jobs regularly

## 📈 Production Deployment

### Infrastructure Requirements

- Redis instance (for distributed mode)
- Worker nodes (for scaling)
- Monitoring dashboard
- Log aggregation

### Configuration

- Adjust concurrency based on resources
- Set appropriate retry policies
- Configure queue cleanup
- Enable authentication for Bull Board

### Monitoring

- Queue backlog alerts
- Processing time thresholds
- Error rate monitoring
- Resource utilization tracking

## 🤝 Contributing

The Conversation Explorer demonstrates AM2Z's capabilities and serves as a reference implementation. When extending:

1. Follow the processor pattern
2. Use AM2Z composition functions
3. Maintain type safety
4. Add comprehensive tests
5. Update documentation

## 📚 Learn More

- [AM2Z Core Documentation](../lib/core/README.md)
- [Distributed Runtime Guide](../lib/node/README.md)
- [Bull Board Setup](./monitor/bull-board-setup.md)
- [Processor Patterns](./docs/processor-patterns.md)

---

**Built with ❤️ using AM2Z v4.0**
