import { AM2ZError, ProcessorExecutionError, NetworkError } from "../core/errors";

export function handleError(
  error: unknown,
  processorName: string,
  executionId: string
): AM2ZError {
  if (error instanceof Error) {
    return new NetworkError("queue", undefined, error);
  }

  return new ProcessorExecutionError(
    processorName,
    executionId,
    new Error(String(error))
  );
}
