# Distributed Runtime Test Suite & API Updates

## Overview

This document describes the comprehensive test suite created for the AM2Z distributed runtime (QueueRuntime) and the API updates made to support the tests.

## Test Suite Structure

### Test Files Created

1. **`src/tests/distributed/test-helpers.ts`**
   - Common test utilities and helpers
   - Test state interface and factories
   - Redis configuration and cleanup utilities
   - Event monitoring helpers
   - Runtime creation with automatic cleanup

2. **`src/tests/distributed/queue-runtime.test.ts`**
   - Core QueueRuntime functionality tests
   - Processor registration and lifecycle
   - Basic execution and batch execution
   - Session-based execution
   - Event system tests
   - Processor dependencies
   - Cleanup operations

3. **`src/tests/distributed/redis-state-manager.test.ts`**
   - Distributed state management with Redis
   - Optimistic locking and concurrent updates
   - State integrity with SHA-256 hashing
   - Complex state scenarios
   - Multi-session state isolation
   - State expiration and TTL

4. **`src/tests/distributed/worker-manager.test.ts`**
   - Worker creation and management
   - Job processing and concurrency
   - Session-specific workers
   - Event emission
   - Worker configuration
   - Error recovery

5. **`src/tests/distributed/connection-manager.test.ts`**
   - Redis connection lifecycle
   - Multiple connection types
   - Connection events and health checks
   - Connection resilience and recovery
   - Connection pooling
   - Error scenarios

6. **`src/tests/distributed/processor-sync.test.ts`**
   - Dynamic processor registration
   - Processor dependency resolution
   - Processor synchronization
   - Metadata preservation
   - Hot reload support

7. **`src/tests/distributed/distributed-execution.test.ts`**
   - Parallel execution scenarios
   - Load distribution
   - Multi-session execution
   - Complex workflows (map-reduce, pipelines)
   - Performance and scalability
   - Event-driven coordination

8. **`src/tests/distributed/error-recovery.test.ts`**
   - Error categorization
   - Retry policies with exponential backoff
   - Timeout handling
   - Partial failure recovery
   - Circuit breaker pattern
   - Graceful degradation

## API Updates

### QueueRuntime Methods Added

```typescript
// Check if runtime is started
isStarted(): boolean

// Get list of registered processors (alias for getRegisteredProcessorNames)
listProcessors(): string[]

// Get queue statistics for all processors
async getQueueStats(): Promise<Record<string, {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}>>

// Make emit method public (was private)
emit(eventType: string, data: unknown): void
```

### WorkerManager Methods Added

```typescript
// Check if a worker exists
hasWorker(processorName: string, sessionId?: string): boolean

// Get total number of workers
getWorkerCount(): number

// Stop specific worker
async stopWorker(processorName: string, sessionId?: string): Promise<void>

// Stop all workers
async stopAll(): Promise<void>

// Create session-specific worker
async createSessionWorker(
  processor: ProcessorDefinition<TState>, 
  sessionId: string
): Promise<Worker>

// Stop all workers for a session
async stopSessionWorkers(sessionId: string): Promise<void>
```

### ProcessorContext Interface Updates

```typescript
export interface ProcessorContext<TState extends AppState = AppState> {
  // ... existing fields ...
  
  // Progress reporting for long-running processors
  readonly updateProgress?: (progress: number) => Promise<void>;
  
  // Runtime access for emitting custom events
  readonly runtime?: {
    emit: (event: string, data: any) => void;
  };
  
  // Additional context fields
  readonly processor: string;
  readonly sessionId?: string;
  readonly executionId?: string;
}
```

### ConnectionManager Methods Added

```typescript
// Detailed health check with connection status
async checkHealth(): Promise<{
  healthy: boolean;
  connections: Record<string, string>; // 'ready' | 'disconnected' | 'error'
}>
```

### Enhanced Type Definitions

#### RetryPolicy Updates
```typescript
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: number;
  readonly backoffMultiplier?: number; // Added
  readonly shouldRetry?: (error: AM2ZError, attempt: number) => boolean; // Added attempt param
  readonly onRetry?: (error: AM2ZError, attempt: number) => void;
  readonly onExhausted?: (error: AM2ZError, totalAttempts: number) => void;
}
```

#### QueueConfig Updates
```typescript
export interface QueueConfig {
  readonly priority?: number;
  readonly concurrency?: number;
  readonly rateLimitRpm?: number;
  readonly maxStalledCount?: number; // Added
  readonly stalledInterval?: number; // Added
  readonly defaultJobOptions?: { // Added
    readonly attempts?: number;
    readonly backoff?: number | { type: string; delay: number };
    readonly delay?: number;
    readonly removeOnComplete?: boolean | number | { age?: number; count?: number };
    readonly removeOnFail?: boolean | number | { age?: number; count?: number };
    readonly priority?: number;
  };
  readonly limiter?: { // Added
    readonly max: number;
    readonly duration: number;
    readonly bounceBack?: boolean;
  };
}
```

## Running the Tests

### Prerequisites
- Redis must be running locally on port 6379
- Bun runtime installed

### Commands
```bash
# Run all distributed tests
bun test src/tests/distributed/

# Run specific test file
bun test src/tests/distributed/queue-runtime.test.ts

# Run with watch mode
bun test --watch src/tests/distributed/
```

## Test Coverage

The test suite covers:

1. **Core Functionality**
   - Runtime lifecycle management
   - Processor registration and execution
   - State management with Redis
   - Worker and queue management

2. **Advanced Features**
   - Session isolation
   - Processor dependencies
   - Dynamic registration
   - Event system
   - Progress tracking

3. **Error Handling**
   - Timeout management
   - Retry policies
   - Error categorization
   - Graceful degradation
   - Circuit breaker pattern

4. **Performance**
   - High-throughput execution
   - Load distribution
   - Memory pressure handling
   - Rate limiting

5. **Resilience**
   - Connection recovery
   - Partial failure handling
   - Concurrent execution
   - State consistency

## Implementation Notes

1. **Progress Tracking**: The `updateProgress` function is injected by WorkerManager when creating the processor context, allowing long-running processors to report progress.

2. **Custom Events**: Processors can emit custom events through `ctx.runtime.emit()`, enabling event-driven coordination between processors.

3. **Session Isolation**: Each session can have its own queues and workers, providing complete isolation for multi-tenant scenarios.

4. **Health Monitoring**: The ConnectionManager provides detailed health status for all Redis connections, useful for monitoring and alerting.

5. **Graceful Shutdown**: All components support graceful shutdown with proper cleanup of resources.

## Future Enhancements

1. **Metrics Collection**: Add Prometheus/OpenTelemetry metrics export
2. **Dead Letter Queue**: Implement DLQ for permanently failed jobs
3. **Job Scheduling**: Add cron-like scheduling capabilities
4. **Distributed Tracing**: Add trace context propagation
5. **Admin UI**: Create web interface for monitoring and management