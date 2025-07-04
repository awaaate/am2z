# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build & Development
```bash
# Main build pipeline
bun run build               # Full build: clean → type-check → build:js → build:types

# Individual build steps
bun run build:js            # Bundle JavaScript with Bun
bun run build:types         # Generate TypeScript declarations
bun run type-check          # TypeScript type checking
bun run clean               # Remove dist folder

# Development
bun run dev                 # Watch mode (runs effect-pipeline example)
```

### Examples & Testing
```bash
# Run example workflows
bun run example:functional  # Basic functional pipeline
bun run example:agent       # Agent-based pipeline
bun run example:effect      # Effect-based pipeline

# Testing & Quality
bun run test                # Run tests with Bun
bun run lint                # ESLint validation
bun run format              # Prettier formatting
```

### Documentation & Monitoring
```bash
bun run docs:serve          # Serve documentation on port 8080
# Bull Board dashboard available when running QueueRuntime examples
```

## Runtime Requirements

- **Bun** (primary runtime) - Use `bun` instead of `node` per project configuration
- **Node.js 18+** - Required for BullMQ distributed features
- **Redis** - Required for QueueRuntime (distributed processing)

## Core Architecture

### Framework Structure
AM2Z is a React-inspired functional framework with two main execution modes:

1. **LocalRuntime** (`am2z/core`) - In-process execution for development/simple workflows
2. **QueueRuntime** (`am2z/node`) - Distributed execution using BullMQ + Redis

### Key Design Patterns

#### State Management
- All state extends `AppState` interface with immutable updates
- SHA-256 integrity checking for distributed state
- Optimistic locking for concurrent updates

#### Error Handling
- Rust-style `Result<T, E>` pattern with `Success()` and `Failure()`
- Hierarchical error taxonomy: `ValidationError`, `BusinessError`, `ResourceError`, etc.
- Automatic retry policies with exponential backoff

#### Processor Composition
- **Chain**: Sequential pipeline (`chainProcessors`)
- **Parallel**: Concurrent execution (`parallelProcessors`)  
- **Route**: Dynamic branching (`routeProcessor`)
- **Batch**: Same processor, multiple payloads (`batchProcessor`)

## Project Structure

```
src/
├── lib/
│   ├── core/           # Core framework (works everywhere)
│   │   ├── state.ts    # AppState interface & management
│   │   ├── result.ts   # Result monad for error handling
│   │   ├── processor.ts # Processor creation & composition
│   │   └── runtime.ts  # LocalRuntime implementation
│   └── node/           # Node.js distributed features
│       ├── queue-runtime.ts      # QueueRuntime with BullMQ
│       ├── connection-manager.ts # Redis connection handling
│       └── redis-state-manager.ts # Distributed state persistence
├── examples/           # Usage examples (not included in build)
└── tests/             # Test files (not included in build)
```

## Development Workflow

### Creating Processors
```typescript
interface MyState extends AppState {
  userId: string;
  data: any;
}

const processor = createProcessor<MyState>("my-processor")
  .withDescription("Process user data")
  .withTimeout(10000)
  .withRetryPolicy({ maxAttempts: 3, backoffMs: 1000 })
  .withQueueConfig({ concurrency: 5 })  // For QueueRuntime
  .process(async (state, ctx) => {
    // Your processing logic
    return Success({ ...state, processed: true });
  });
```

### Runtime Usage
```typescript
// Local development
const runtime = new LocalRuntime<MyState>();
runtime.register(processor);
await runtime.start();

// Distributed production
const runtime = createQueueRuntimeWithDefaults<MyState>();
runtime.register(processor);
await runtime.start();
await runtime.syncProcessors(); // Create Redis infrastructure
```

## TypeScript Configuration

- **Target**: ESNext with modern features
- **Module**: Preserve (for bundler compatibility)
- **Strict mode**: Enabled with additional safety checks
- **Bundler resolution**: Optimized for Bun's bundler

## Key Dependencies

### Core Framework
- **Zod** - Schema validation
- **BullMQ** - Distributed queue management
- **IORedis** - Redis client for distributed state

### AI Integration
- **@ai-sdk/openai** - OpenAI API integration
- **ai** - AI SDK for text generation

### Development Tools
- **Bun** - Primary runtime and bundler
- **TypeScript** - Type safety
- **ESLint** - Code linting
- **Prettier** - Code formatting

## Important Notes

### Dynamic Processor Registration
The framework supports registering processors after runtime startup:
```typescript
runtime.register(newProcessor);
await runtime.syncProcessors(); // Required for QueueRuntime
```

### State Persistence
- LocalRuntime: In-memory state
- QueueRuntime: Redis-backed with SHA-256 integrity verification
- All state updates are immutable

### Monitoring & Debugging
- Use Bull Board for QueueRuntime monitoring (see examples/ai-server.ts)
- Structured logging with context propagation
- Metrics collection for processor execution

### Error Recovery
- Processors can be marked as retryable vs non-retryable
- Failed processors preserve partial state for debugging
- Cooperative cancellation with AbortSignal propagation

## Export Structure

The framework provides multiple entry points:
- `am2z` - Main exports (core + node)
- `am2z/core` - Core framework only
- `am2z/node` - Node.js distributed features only

This allows flexible deployment: use `core` for lightweight applications, `node` for distributed systems.