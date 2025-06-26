# AM2Z v4.0 – **Autonomous Modular Orchestrator & Zero‑friction runtime**

AM2Z is a **strongly‑typed, event‑driven task‑orchestration framework** for TypeScript/Node that lets you compose highly‑concurrent, failure‑resilient workflows that can run **locally** _or_ at **cloud‑scale** on top of [BullMQ](https://docs.bullmq.io/).
It brings the ergonomics of **Rust‑style **\`\`** handling**, an **Elm‑like immutable App State**, and **builder‑style processors** to the JavaScript ecosystem without sacrificing DX.

---

## ✨ Features

- 🧩 **Declarative processors** – chain, parallel‑merge, route or nest processors with one‑liner helpers.
- 🚦 **Granular error taxonomy** – retryable vs non‑retryable, business vs resource, rich metadata.
- ⏱️ **Co‑operative cancellation & time‑outs** – abort signals propagate automatically through nested calls.
- 🔗 **Local \*\*\***and**\*** Distributed runtimes** – swap between `LocalRuntime` and `QueueRuntime` by changing **one line\*\*.
- 📜 **Strict typing everywhere** – generic `AppState`, branded states, typed contexts and results.
- 🔄 **Exactly‐once state persistence** – optimistic‑locked, SHA‑256‑hashed `RedisStateManager`.
- 📊 **Metrics & Bull Board integration** – drop‑in queue dashboard via `@bull‑board`.
- 🌈 **Pluggable logging** – colored console, JSON, or silent; create child loggers with extra context.

---

\## Installation

```bash
npm install am2z bullmq ioredis zod @ai-sdk/openai express
```

> **Node 18 +** is recommended.

---

\## Quick Start (Local Runtime)

```ts
import { createProcessor, chainProcessors } from "am2z/core";
import { LocalRuntime, createAppState } from "am2z/core";

// 1️⃣ Define a processor
const hello = createProcessor("hello")
  .withDescription("Greets the user")
  .process(async (state, ctx) => {
    ctx.log.info("Saying hello …");
    return Success({ ...state, greeting: `Hello ${state.user}!` });
  });

// 2️⃣ Chain processors (can be parallel, routed, etc.)
const workflow = chainProcessors({ name: "demo", processors: [hello] });

// 3️⃣ Create a runtime and register
const runtime = new LocalRuntime();
runtime.register(workflow);

await runtime.start();

const base = createAppState("session‑1", { user: "Tomas" });
const result = await runtime.execute("demo", base);

console.log(result.state.greeting); // → "Hello Tomas"
await runtime.stop();
```

---

\## Distributed Runtime with BullMQ

```ts
import { createQueueRuntimeWithDefaults } from "am2z/node/queue-runtime";
import { createProcessor } from "am2z/core";

const ping = createProcessor("ping").process(async (s) => Success(s));
const runtime = createQueueRuntimeWithDefaults();

runtime.register(ping);
await runtime.start();

const result = await runtime.execute("ping", createAppState("s"));
console.log(result.executionTime);
await runtime.stop();
await runtime.disconnect();
```

---

# Architecture Overview

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

# Core Concepts & API Reference

| Function                                                                | Description                       |
| ----------------------------------------------------------------------- | --------------------------------- |
| `Success(data)`                                                         | Wrap successful payload.          |
| `Failure(err)`                                                          | Wrap error payload.               |
| `isSuccess(result)` / `isFailure(result)`                               | Type guards.                      |
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
createProcessor<TState>(name)
  .withDescription(text)
  .withTimeout(ms)          // adds SERVER_OVERHEAD_MS automatically
  .withRetryPolicy({ maxAttempts, backoffMs, shouldRetry?, … })
  .withQueueConfig({ priority?, concurrency?, rateLimitRpm? })
  .process(async (state, ctx) => Result)
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

- `createAppState(sessionId, extra?)` → initial immutable state.
- `updateStateMetadata(state)` → bump version/timestamps.
- Generic `StateManager` interface – implementations:
  - In‑memory (implicit) for `LocalRuntime`.
  - \`\` (distributed, SHA‑256 integrity, optimistic CAS).

- Helpers: `createNonEmptyArray`, `isBrandedState`, branded types.

### 6.1 LocalRuntime (`core/runtime.ts`)

| Method                             | Purpose                           |
| ---------------------------------- | --------------------------------- |
| `register(proc)`                   | Add processor (& deps).           |
| `unregister(name)`                 | Remove.                           |
| `start()` / `stop()`               |                                   |
| `execute(name, state, sessionId?)` |                                   |
| `getStats()`                       | Running/completed/failed, uptime. |

### 6.2 QueueRuntime (`node/queue-runtime.ts`)

Extends `ProcessorRuntime` + distributed goodies.

| Method                                                                | Purpose                                             |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| `register`, `unregister`, `start`, `stop`, `execute`, _same as Local_ |                                                     |
| `executeMany(name, states, sessionId?)`                               | Bulk fan‑out.                                       |
| `cleanAllQueues()`                                                    |                                                     |
| `disconnect()`                                                        | Close Redis.                                        |
| `getQueues()` / `getProcessors()`                                     |                                                     |
| `getStats()` → includes per‑queue counts.                             |                                                     |
| `on(event, fn)` / `off(event, fn)`                                    | Subscribe to `processor:*`, `queue:*`, `metrics:*`. |

**Factory helpers**:
`createQueueRuntime(config, logger?)`  |  `createQueueRuntimeWithDefaults(redisOverrides?, runtimeOverrides?, logger?)`

### Config objects

- `QueueRuntimeConfig`: `{ queuePrefix?, redis, worker?, queue?, monitoring?, errorHandling?, runtime? }`
- `MonitoringConfig`: enable queue events, metrics, interval.
- `WorkerConfig`, `QueueConfig` (per‑queue defaults), `RuntimeConfig` (timeouts, depth).

| Component             | Key Methods                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **ConnectionManager** | `getConnection(purpose)`, `healthCheck()`, `disconnect()`, `getStatus()`                                                         |
| **QueueManager**      | `createQueue(proc)`, `getQueue(name)`, `getAllQueues()`, `removeQueue(name)`, `closeAll()`, `getQueueStats(name?)`, `cleanAll()` |
| **WorkerManager**     | `createWorker(proc)`, `getWorker(name)`, `removeWorker(name)`, `closeAll()`                                                      |
| **ResultCollector**   | `waitForResult(executionId, timeout?)`, `getStats()`, `cleanup()`, `cleanupStale(maxAge)`                                        |
| **JobOptionsBuilder** | fluent: `withPriority`, `withAttempts`, `withBackoff`, `withDelay`, `withJobId`, `withTimeout`, `withMetadata`, `build()`        |
| **RedisStateManager** | `get`, `set`, `update`, `exists`, `delete`, `getVersion`                                                                         |

---

\## Examples (`src/examples/`)

### 1. `ai-app-generator.ts` – _End‑to‑end workflow_

- Analyses natural‑language requirements via OpenAI.
- Generates **frontend**, **backend**, **database schema** in parallel.
- Produces docs, deployment config, QA score, and final assembly.
- Shows nested chains (`chainProcessors`) + parallel fan‑out (`parallelProcessors`).

> Run it standalone:
>
> ```bash
> npx ts-node src/examples/ai-app-generator.ts
> ```

### 2. `ai-server.ts` – _Express + Bull Board_

- Exposes REST endpoints `/api/generate`, `/api/status`, `/admin/queues`.
- Shares a single `QueueRuntime` across requests.
- Demonstrates **Bull Board** integration for live monitoring.

---

\## Advanced Usage

### Parallel throttling & rate‑limits

Use `QueueConfig.rateLimitRpm` or the runtime‑wide `QueueConfig` to prevent API over‑use.

### Automatic retries

Configure at processor‑level via `withRetryPolicy({ maxAttempts, backoffMs, shouldRetry })` – failures bubble up as `ProcessorExecutionError` preserving partial state.

### Call depth safety

Recursive workflows are limited by `RuntimeConfig.maxCallDepth` (default 10) – exceeding throws `CallDepthExceededError`.

### Cooperative cancellation

`context.signal.aborted` is set when a parent times out (local) or when a BullMQ timeout is hit (distributed).

---

\## Troubleshooting

| Symptom                     | Resolution                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| **Jobs stuck in "waiting"** | Check Redis connectivity; ensure `QueueRuntime.start()` has been awaited.                         |
| **"Processor … not found"** | Call `runtime.register()` for every processor (deps are auto‑registered).                         |
| **Timeouts too aggressive** | Adjust `processor.withTimeout(ms)` **plus** overhead, or increase `RuntimeConfig.defaultTimeout`. |
| **Call depth exceeded**     | Redesign workflow or raise `RuntimeConfig.maxCallDepth`.                                          |

---

\## Contributing

1. Fork ✂️ & clone.
2. `npm ci`
3. Run tests (coming soon).
4. Send PR with conventional commits.

Please read `CONTRIBUTING.md` for coding guidelines and our code of conduct.

---

\## License

MIT © 2025 AM2Z Contributors – do *amazing* things.
