// AM2Z v4.0 - Batch Answerer Processor
// Processes multiple questions using call to delegate to individual processors

import {
  createProcessor,
  Success,
  Failure,
  parallelProcessors,
} from "../../../src/lib/core";
import {
  type ConversationExplorerState,
  type QuestionTask,
  type AIService,
} from "../types";
import { ProcessorExecutionError } from "../../../src/lib/core/errors";

/**
 * Batch Answerer Processor
 * Takes pending questions and processes them using parallel calls to answerQuestion
 */
export function createBatchAnswererProcessor(aiService: AIService) {
  return createProcessor<ConversationExplorerState>("batchAnswerer")
    .withDescription(
      "Process multiple questions in parallel using call delegation"
    )
    .withTimeout(30000)
    .withRetryPolicy({
      maxAttempts: 2,
      backoffMs: 2000,
      shouldRetry: (error) => error.retryable,
    })

    .process(async (state, ctx) => {
      ctx.log.info("🚀 Starting batch question processing...");

      // Get pending questions to process
      const questionsToProcess = state.pendingQuestions.slice(
        0,
        state.config.batchSize
      );

      if (questionsToProcess.length === 0) {
        ctx.log.info("No pending questions to process");
        return Success(state);
      }

      ctx.log.info(
        `Processing ${questionsToProcess.length} questions in parallel`
      );

      try {
        // Process questions in parallel using call
        const results = await Promise.allSettled(
          questionsToProcess.map(async (questionTask) => {
            // Use call to delegate to answerQuestion processor
            // Pass questionTask in metadata for the processor
            const tempState = {
              ...state,
              metadata: {
                ...state.metadata,
                questionTask,
              },
            } as ConversationExplorerState;

            // Call the answer processor with the question task in meta
            return ctx.call("answerQuestion", tempState);
          })
        );

        // Process results
        let currentState = state;
        let successCount = 0;
        let failureCount = 0;

        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const questionTask = questionsToProcess[i];

          if (!result || !questionTask) continue;

          if (result.status === "fulfilled" && result.value.success) {
            // Update state with successful result
            currentState = result.value.data;
            successCount++;

            ctx.log.debug(`Question ${questionTask.id} processed successfully`);
          } else {
            failureCount++;

            if (result.status === "rejected") {
              ctx.log.error(
                `Question ${questionTask.id} processing rejected:`,
                result.reason
              );
            } else if (result.status === "fulfilled" && !result.value.success) {
              ctx.log.error(
                `Question ${questionTask.id} processing failed:`,
                result.value.error
              );
            }
          }
        }

        ctx.log.info(`Batch processing completed`, {
          total: questionsToProcess.length,
          successful: successCount,
          failed: failureCount,
          successRate: `${((successCount / questionsToProcess.length) * 100).toFixed(1)}%`,
        });

        // Emit batch completion event
        ctx.emit("batch:completed", {
          total: questionsToProcess.length,
          successful: successCount,
          failed: failureCount,
        });

        return Success(currentState);
      } catch (error) {
        ctx.log.error("Batch processing failed:", error);

        return Failure(
          new ProcessorExecutionError(
            "batchAnswerer",
            ctx.meta.executionId,
            error instanceof Error ? error : new Error(String(error))
          )
        );
      }
    });
}

/**
 * Simple Batch Processor (Alternative approach)
 * Processes questions sequentially to avoid complex parallel state management
 */
export function createSimpleBatchProcessor(aiService: AIService) {
  return createProcessor<ConversationExplorerState>("simpleBatch")
    .withDescription("Process questions sequentially using call")
    .withTimeout(45000)

    .process(async (state, ctx) => {
      const questionsToProcess = state.pendingQuestions.slice(
        0,
        state.config.batchSize
      );

      if (questionsToProcess.length === 0) {
        return Success(state);
      }

      ctx.log.info(
        `Processing ${questionsToProcess.length} questions sequentially`
      );

      let currentState = state;

      // Process questions one by one using call
      for (const questionTask of questionsToProcess) {
        try {
          // Create state with question task in metadata
          const tempState = {
            ...currentState,
            metadata: {
              ...currentState.metadata,
              questionTask,
            },
          } as ConversationExplorerState;

          const result = await ctx.call("answerQuestion", tempState);

          if (result.success) {
            currentState = result.data;
            ctx.log.debug(`Question ${questionTask.id} completed`);
          } else {
            ctx.log.error(`Question ${questionTask.id} failed:`, result.error);
            // Continue with other questions even if one fails
          }
        } catch (error) {
          ctx.log.error(`Question ${questionTask.id} error:`, error);
          // Continue processing other questions
        }
      }

      return Success(currentState);
    });
}
