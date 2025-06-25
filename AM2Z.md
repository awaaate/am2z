# AM2Z Library Documentation

This document provides a comprehensive overview of the AM2Z library, a powerful framework for building robust and scalable data processing pipelines and AI agents.

## Core Concepts

The AM2Z library is built around a few core concepts:

*   **Processors**: The fundamental building blocks of the library. A processor is a function that takes a state and a context as input and returns a result.
*   **State**: An immutable object that represents the current state of the system. Each processor can modify the state, but it must do so in an immutable way.
*   **Runtimes**: Responsible for executing processors. The library provides two runtimes: a `LocalRuntime` for local development and testing, and a `QueueRuntime` for distributed execution using BullMQ.
*   **State Management**: The library provides a flexible state management system that can be used with different backends. The `RedisStateManager` is the default implementation for the `QueueRuntime`.

## Core Components

The library is divided into two main modules: `core` and `node`.

### Core Module

The `core` module contains the fundamental building blocks of the library. It is platform-agnostic and can be used in any JavaScript environment.

*   **`processor.ts`**: Defines the `Processor` interface and provides a fluent API for creating processors.
*   **`state.ts`**: Defines the `AppState` interface and provides a `StateManager` interface for managing the state.
*   **`runtime.ts`**: Defines the `ProcessorRuntime` interface and provides a `LocalRuntime` for local development and testing.
*   **`result.ts`**: Defines a `Result` type for handling success and failure cases in a type-safe way.
*   **`errors.ts`**: Defines a set of custom error classes for handling different types of errors.
*   **`logging.ts`**: Provides a flexible logging system with support for different log levels and formatters.
*   **`processor-executor.ts`**: Contains the shared logic for executing processors in both the `LocalRuntime` and the `QueueRuntime`.

### Node Module

The `node` module provides the components for running the library in a Node.js environment. It includes the `QueueRuntime` for distributed execution using BullMQ.

*   **`queue-runtime.ts`**: Implements the `ProcessorRuntime` interface for distributed execution using BullMQ.
*   **`redis-state-manager.ts`**: Implements the `StateManager` interface using Redis for distributed state management.
*   **`connection-manager.ts`**: Manages the Redis connections for the `QueueRuntime`.
*   **`queue-manager.ts`**: Manages the BullMQ queues for the `QueueRuntime`.
*   **`worker-manager.ts`**: Manages the BullMQ workers for the `QueueRuntime`.
*   **`result-collector.ts`**: Collects the results of the jobs executed by the `QueueRuntime`.
*   **`job-data.ts`**: Defines the data structure for the jobs executed by the `QueueRuntime`.
*   **`handle-error.ts`**: Provides a utility function for handling errors in the `QueueRuntime`.

## Getting Started

To get started with the AM2Z library, you need to install it from npm:

```bash
npm install am2z
```

Once you have installed the library, you can start building your data processing pipelines and AI agents.

### Creating a Processor

A processor is the fundamental building block of the AM2Z library. You can create a processor using the `createProcessor` function:

```typescript
import { createProcessor, Success } from "am2z";

const myProcessor = createProcessor("my-processor")
  .withDescription("My first processor")
  .process(async (state, ctx) => {
    ctx.log.info("Executing my processor");
    return Success({ ...state, counter: state.counter + 1 });
  });
```

### Creating a Runtime

Once you have created your processors, you need to create a runtime to execute them. The library provides two runtimes: a `LocalRuntime` for local development and testing, and a `QueueRuntime` for distributed execution using BullMQ.

#### LocalRuntime

The `LocalRuntime` is the simplest way to execute your processors. It runs them in the same process and does not require any external dependencies.

```typescript
import { LocalRuntime } from "am2z";

const runtime = new LocalRuntime();
runtime.register(myProcessor);

await runtime.start();

const initialState = { counter: 0 };
const result = await runtime.execute("my-processor", initialState);

console.log(result);
```

#### QueueRuntime

The `QueueRuntime` is designed for distributed execution using BullMQ. It requires a Redis server to be running.

```typescript
import { createQueueRuntimeWithDefaults } from "am2z";

const runtime = createQueueRuntimeWithDefaults();
runtime.register(myProcessor);

await runtime.start();

const initialState = { counter: 0 };
const result = await runtime.execute("my-processor", initialState);

console.log(result);
```

## Conclusion

The AM2Z library is a powerful framework for building robust and scalable data processing pipelines and AI agents. It provides a clean and type-safe API that makes it easy to build complex systems. The library is still under active development, so you can expect to see more features and improvements in the future.
