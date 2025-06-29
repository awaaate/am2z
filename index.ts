// AM2Z v4.0 - A Clean, Type-Safe Framework for Building AI Processor Systems
// Simplified architecture inspired by functional programming and React patterns

// === Core Framework ===
export {
  // State Management
  type AppState,
  type BrandedState,
  type NonEmptyArray,
  createNonEmptyArray,
  isBrandedState,
  createAppState,
  updateStateMetadata,

  // Result System
  type Result,
  Success,
  Failure,
  isSuccess,
  isFailure,
  matchResult,
  chainResult,
  mapResult,
  mapError,
  unwrapResult,
  unwrapOr,
  combineResults,
  safeAsync,
  safeSync,

  // Error System
  AM2ZError,
  ValidationError,
  ProcessorNotFoundError,
  ProcessorExecutionError,
  TimeoutError,
  ResourceError,
  NetworkError,
  ConfigurationError,
  BusinessError,
  type ErrorCategory,
  type ErrorSeverity,
  type ErrorDetails,
  isRetryableError,
  isCriticalError,
  extractErrorDetails,
  wrapAsProcessorError,

  // Logging
  type LogLevel,
  type LogEntry,
  type Logger,
  type LogFormatter,
  createLogger,
  createColoredFormatter,
  createJsonFormatter,
  createSilentLogger,

  // Processor System
  type ProcessorFunction,
  type ImmerProcessorFunction,
  type ProcessorContext,
  type ProcessorMetadata,
  type ProcessorCaller,
  type EventEmitter,
  type ProcessorConfig,
  type RetryPolicy,
  type QueueConfig,
  type ProcessorDefinition,
  type ProcessorResult,
  ProcessorBuilder,
  createProcessor,
  chainProcessors,
  parallelProcessors,
  routeProcessor,
  batchProcessor,

  // Runtime System
  type ProcessorRuntime,
  type RuntimeStats,
  LocalRuntime,
  validateRuntimeConfig,
} from "./src/lib/core";

// === Distributed Runtime (Node.js) ===
export {
  QueueRuntime,
  createQueueRuntime,
  createQueueRuntimeWithDefaults,
  type QueueRuntimeConfig,
  type MonitoringConfig,
  type ErrorHandlingConfig,
} from "./src/lib/node/queue-runtime";

// === Framework Info ===
export const AM2Z = {
  VERSION: "4.0.0",
  FEATURES: [
    "Type-safe processor architecture",
    "Immutable state management with Immer",
    "Result-based error handling",
    "Composable processor chains",
    "Local and distributed execution",
    "Comprehensive logging and metrics",
    "BullMQ integration with best practices",
    "React-inspired functional design",
  ] as const,
} as const;

// === Default Export for Simple Usage ===
export default AM2Z;
