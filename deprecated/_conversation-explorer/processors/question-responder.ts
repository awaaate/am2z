// AM2Z v4.0 - Question Responder Processor
// Individual processor for generating AI responses to specific questions

import { createProcessor, Success, Failure } from "../../../src/lib/core";
import {
  type ConversationExplorerState,
  type QuestionRequest,
  type ResponseResult,
  type AIService,
} from "../types";
import { ProcessorExecutionError } from "../../../src/lib/core/errors";

/**
 * Service dependency injection
 */
interface QuestionResponderDependencies {
  readonly aiService: AIService;
}

/**
 * Input for the question responder processor
 */
export interface QuestionResponderInput {
  readonly question: QuestionRequest;
  readonly dependencies: QuestionResponderDependencies;
}

/**
 * Single question response processor
 * This processor takes one question and generates a response
 */
export const questionResponderProcessor =
  createProcessor<ConversationExplorerState>("questionResponder")
    .withDescription(
      "Generate AI response for a single question with persona context"
    )
    .withTimeout(15000)
    .withRetryPolicy({
      maxAttempts: 3,
      backoffMs: 1000,
      shouldRetry: (error) => error.retryable,
    })

    .process(async (state, ctx) => {
      // Extract question data from state metadata or context
      const questionData = (ctx.meta as any)
        .questionData as QuestionResponderInput;

      if (!questionData?.question || !questionData?.dependencies?.aiService) {
        return Failure(
          new ProcessorExecutionError(
            "questionResponder",
            ctx.meta.executionId,
            new Error("Missing question data or AI service dependency")
          )
        );
      }

      const { question, dependencies } = questionData;
      const { aiService } = dependencies;

      ctx.log.info(`Processing question: ${question.id}`, {
        prompt: question.prompt.substring(0, 50) + "...",
        persona: question.persona.name,
        depth: question.depth,
      });

      const startTime = Date.now();

      try {
        // Get parent response for context if available
        const parentNode = question.parentId
          ? state.conversationTree.find((node) => node.id === question.parentId)
          : undefined;

        const context = parentNode?.response
          ? { parentResponse: parentNode.response }
          : undefined;

        // Generate response using AI service
        const aiResponse = await aiService.generateResponse(
          question.prompt,
          question.persona,
          context
        );

        const processingTime = Date.now() - startTime;

        // Create response result
        const responseResult: ResponseResult = {
          questionId: question.id,
          response: aiResponse.text,
          metrics: {
            processingTimeMs: processingTime,
            tokenCount: aiResponse.tokenCount,
            confidenceScore: aiResponse.confidenceScore,
          },
          success: true,
        };

        ctx.log.info(`Question processed successfully`, {
          questionId: question.id,
          processingTime,
          tokenCount: aiResponse.tokenCount,
          confidenceScore: aiResponse.confidenceScore.toFixed(2),
        });

        // Emit event for monitoring
        ctx.emit("question:completed", {
          questionId: question.id,
          processingTime,
          success: true,
        });

        // Store result in state metadata for retrieval by batch processor
        const updatedState = {
          ...state,
          metadata: {
            ...state.metadata,
            lastProcessedQuestion: responseResult,
          },
        } as ConversationExplorerState;

        return Success(updatedState);
      } catch (error) {
        const processingTime = Date.now() - startTime;

        ctx.log.error(`Question processing failed`, {
          questionId: question.id,
          error: error instanceof Error ? error.message : String(error),
          processingTime,
        });

        // Emit failure event
        ctx.emit("question:failed", {
          questionId: question.id,
          error: error instanceof Error ? error.message : String(error),
          processingTime,
        });

        // Create failure response result
        const failureResult: ResponseResult = {
          questionId: question.id,
          response: "",
          metrics: {
            processingTimeMs: processingTime,
            tokenCount: 0,
            confidenceScore: 0,
          },
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };

        // Store failure result in state
        const updatedState = {
          ...state,
          metadata: {
            ...state.metadata,
            lastProcessedQuestion: failureResult,
          },
        } as ConversationExplorerState;

        // Return success with failure result stored (don't fail the entire pipeline)
        return Success(updatedState);
      }
    });

/**
 * Factory function to create a question responder with dependencies
 */
export function createQuestionResponder(
  dependencies: QuestionResponderDependencies
) {
  return createProcessor<ConversationExplorerState>("questionResponder")
    .withDescription(
      "Generate AI response for a single question with persona context"
    )
    .withTimeout(15000)
    .withRetryPolicy({
      maxAttempts: 3,
      backoffMs: 1000,
      shouldRetry: (error) => error.retryable,
    })
    .process(async (state, ctx) => {
      // This would be used by the batch processor or directly
      // Implementation details would be similar to above
      return Success(state);
    });
}

/**
 * Utility function to process a single question independently
 * Useful for testing or direct usage
 */
export async function processQuestion(
  question: QuestionRequest,
  aiService: AIService,
  logger?: any
): Promise<ResponseResult> {
  const startTime = Date.now();

  try {
    logger?.info?.(`Processing question: ${question.id}`);

    // Generate response
    const aiResponse = await aiService.generateResponse(
      question.prompt,
      question.persona,
      question.context
    );

    const processingTime = Date.now() - startTime;

    return {
      questionId: question.id,
      response: aiResponse.text,
      metrics: {
        processingTimeMs: processingTime,
        tokenCount: aiResponse.tokenCount,
        confidenceScore: aiResponse.confidenceScore,
      },
      success: true,
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger?.error?.(`Question processing failed: ${error}`);

    return {
      questionId: question.id,
      response: "",
      metrics: {
        processingTimeMs: processingTime,
        tokenCount: 0,
        confidenceScore: 0,
      },
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
