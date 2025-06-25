# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `bun run build` - Full build including type check and JS compilation
- **Type Check**: `bun run type-check` - Run TypeScript type checking without compilation
- **Clean**: `bun run clean` - Remove dist directory
- **Dev**: `bun run dev` - Watch mode development server
- **Test**: `bun test` - Run test suite
- **Lint**: `bun run lint` - ESLint TypeScript files in src/
- **Format**: `bun run format` - Format TypeScript and Markdown files

## Runtime Requirements

**Always use Bun instead of Node.js**:
- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun run <script>` instead of `npm run <script>`
- Use `bun install` instead of `npm install`
- Use `bun test` instead of `jest` or `vitest`

## Architecture Overview

AM2Z v4.0 is a completely rewritten functional framework for building AI processor systems. The architecture follows React-inspired patterns with strong type safety and immutable state management.

### Core Concepts

**Processors**: Functions that transform application state using Immer for immutability
```typescript
// Processor signature with Result type for error handling
(state: AppState, context: ProcessorContext) => Promise<Result<AppState, AM2ZError>>

// Immer-based processor (recommended)
createProcessor<MyState>("processorName")
  .processWithImmer((draft, ctx) => {
    draft.data.items.push(newItem);
    draft.pipeline.stage = "completed";
  });
```

**State Management**: Branded types with required metadata for tracking
```typescript
type MyAppState = BrandedState<'my-app', {
  data: MyData;
  pipeline: PipelineState;
}>;
```

**Error Handling**: Class-based errors with Result types (no throwing exceptions)
```typescript
// Errors are values, not exceptions
const result = await processor.fn(state, context);
if (!result.success) {
  // Handle error: result.error
}
```

### Key Libraries

- **Immer**: All state mutations use Immer producers for immutability
- **BullMQ**: Production-ready distributed execution with proper error handling
- **TypeScript**: Full type safety with branded types and Result types

### Project Structure

- `src/lib/core/` - Core framework (state, processors, runtime, errors, logging)
- `src/lib/node/` - Node.js specific implementations (distributed runtime)
- `src/examples/` - Example implementations and demos

### Processor Creation

Use the builder pattern for processors:
```typescript
const myProcessor = createProcessor<MyState>("dataProcessor")
  .withDescription("Processes incoming data")
  .withTimeout(30000)
  .withRetryPolicy({
    maxAttempts: 3,
    backoffMs: 1000,
    shouldRetry: (error) => error.retryable,
  })
  .processWithImmer((draft, ctx) => {
    // Mutate draft directly - Immer handles immutability
    draft.data.processed = true;
    draft.metadata.lastUpdated = new Date().toISOString();
  });
```

### Processor Composition

- **Sequential**: `chainProcessors("name", processor1, processor2, processor3)`
- **Parallel**: `parallelProcessors("name", processor1, processor2, processor3)`
- **Conditional**: `routeProcessor("name", condition, routes, fallback)`
- **Retry**: `withRetry(processor, retryPolicy)`

### Runtime Modes

- **Local Runtime**: For development and testing (`createLocalRuntime`)
- **Distributed Runtime**: For production with BullMQ + Redis (`createDistributedRuntime`)

### Error Handling

All errors extend `AM2ZError` with specific types:
```typescript
// Specific error types
ProcessorNotFoundError
ProcessorExecutionError  
ValidationError
TimeoutError
NetworkError
ResourceError
ConfigurationError
BusinessError

// Error checking
if (isRetryableError(error)) {
  // Can retry
}
if (isCriticalError(error)) {
  // System-breaking error
}
```

### Logging

Structured logging with context:
```typescript
const logger = createLogger({ component: "MyProcessor" });
logger.info("Processing started", { itemCount: 5 });
logger.error("Processing failed", error, { context: "additional data" });
```

### BullMQ Best Practices

The distributed runtime follows BullMQ best practices:
- Proper error handlers to prevent crashes
- Job validation and timeout handling
- Retry policies with exponential backoff
- Rate limiting and concurrency control
- Comprehensive monitoring and metrics