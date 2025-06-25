// AM2Z v4.0 - Answer Question Processor
// Atomic processor that answers a single question

import { createProcessor, Success, Failure } from "../../../src/lib/core";
import {
  type ConversationExplorerState,
  type QuestionTask,
  type AIService,
} from "../types";
import { ProcessorExecutionError } from "../../../src/lib/core/errors";

/**
 * Answer Question Processor
 * Takes a question task and generates a response for it
 */
export function createAnswerQuestionProcessor(aiService: AIService) {
  return createProcessor<ConversationExplorerState>("answerQuestion")
    .withDescription("Generate AI response for a single question")
    .withTimeout(10000)
    .withRetryPolicy({
      maxAttempts: 3,
      backoffMs: 1000,
      shouldRetry: (error) => error.retryable,
    })

    .process(async (state, ctx) => {
      // Get question task from metadata (passed by calling processor)
      const questionTask = (state.metadata as any).questionTask as QuestionTask;
      ctx.log.info(`Question task: ${JSON.stringify(questionTask)}`);
      if (!questionTask) {
        return Failure(
          new ProcessorExecutionError(
            "answerQuestion",
            ctx.meta.executionId,
            new Error("No question task provided")
          )
        );
      }

      ctx.log.info(`Answering question: ${questionTask.id}`, {
        prompt: questionTask.prompt.substring(0, 50) + "...",
        persona: questionTask.persona.name,
        depth: questionTask.depth,
      });

      const startTime = Date.now();

      try {
        // Generate response using AI service
        const aiResponse = await aiService.generateResponse(
          questionTask.prompt,
          questionTask.persona
        );

        const processingTime = Date.now() - startTime;

        // Find the node to update
        const nodeIndex = state.nodes.findIndex(
          (node) => node.id === questionTask.id
        );
        if (nodeIndex === -1) {
          return Failure(
            new ProcessorExecutionError(
              "answerQuestion",
              ctx.meta.executionId,
              new Error(`Node not found: ${questionTask.id}`)
            )
          );
        }

        // Create updated state with completed node
        const updatedNodes = [...state.nodes];
        updatedNodes[nodeIndex] = {
          ...updatedNodes[nodeIndex]!,
          response: aiResponse.text,
          isComplete: true,
          completedAt: new Date().toISOString(),
          metrics: {
            processingTimeMs: processingTime,
            tokenCount: aiResponse.tokenCount,
          },
        };

        // Remove question from pending tasks
        const updatedPendingQuestions = state.pendingQuestions.filter(
          (q) => q.id !== questionTask.id
        );

        const updatedState: ConversationExplorerState = {
          ...state,
          nodes: updatedNodes,
          pendingQuestions: updatedPendingQuestions,
        };

        ctx.log.info(`Question answered successfully`, {
          questionId: questionTask.id,
          processingTime,
          tokenCount: aiResponse.tokenCount,
        });

        // Emit completion event
        ctx.emit("question:answered", {
          questionId: questionTask.id,
          processingTime,
          tokenCount: aiResponse.tokenCount,
        });

        return Success(updatedState);
      } catch (error) {
        const processingTime = Date.now() - startTime;

        ctx.log.error(`Question answering failed`, {
          questionId: questionTask.id,
          error: error instanceof Error ? error.message : String(error),
          processingTime,
        });

        // Emit failure event
        ctx.emit("question:failed", {
          questionId: questionTask.id,
          error: error instanceof Error ? error.message : String(error),
          processingTime,
        });

        return Failure(
          new ProcessorExecutionError(
            "answerQuestion",
            ctx.meta.executionId,
            error instanceof Error ? error : new Error(String(error))
          )
        );
      }
    });
}
