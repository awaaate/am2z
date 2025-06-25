// AM2Z v4.0 - Generate Questions Processor
// Generates follow-up questions from completed conversation nodes

import { createProcessor, Success, Failure } from "../../../src/lib/core";
import {
  type ConversationExplorerState,
  type QuestionTask,
  type AIService,
} from "../types";
import { ProcessorExecutionError } from "../../../src/lib/core/errors";

/**
 * Generate Questions Processor
 * Finds completed nodes and generates follow-up questions for expansion
 */
export function createGenerateQuestionsProcessor(aiService: AIService) {
  return createProcessor<ConversationExplorerState>("generateQuestions")
    .withDescription(
      "Generate follow-up questions from completed conversation nodes"
    )
    .withTimeout(15000)
    .withRetryPolicy({
      maxAttempts: 2,
      backoffMs: 1500,
      shouldRetry: (error) => error.retryable,
    })

    .process(async (state, ctx) => {
      ctx.log.info("🔍 Generating follow-up questions...");

      // Check if we can still expand
      if (state.nodes.length >= state.config.maxTotalNodes) {
        ctx.log.info("Maximum nodes reached, no new questions generated");
        return Success({
          ...state,
          currentStage: "completed",
        });
      }

      // Find completed nodes that can be expanded (no children yet)
      const expandableNodes = state.nodes.filter(
        (node) =>
          node.isComplete &&
          node.response &&
          node.depth < state.config.maxDepth - 1 &&
          !state.nodes.some((child) => child.parentId === node.id) // No children yet
      );

      if (expandableNodes.length === 0) {
        ctx.log.info("No expandable nodes found");
        return Success({
          ...state,
          currentStage:
            state.pendingQuestions.length > 0 ? "processing" : "completed",
        });
      }

      ctx.log.info(`Found ${expandableNodes.length} expandable nodes`);

      try {
        const newQuestions: QuestionTask[] = [];
        const newNodes = [...state.nodes];

        // Generate questions for each expandable node
        for (const parentNode of expandableNodes) {
          if (!parentNode.response) continue;

          // Calculate how many children to generate
          const remainingCapacity =
            state.config.maxTotalNodes - newNodes.length;
          const maxChildren = Math.min(
            state.config.branchingFactor,
            remainingCapacity
          );

          if (maxChildren <= 0) break;

          // Generate follow-up questions using AI
          const followUpPrompts = await aiService.generateFollowUpQuestions(
            parentNode.response,
            parentNode.persona,
            maxChildren
          );

          // Create question tasks and nodes for each follow-up
          for (let i = 0; i < followUpPrompts.length; i++) {
            const prompt = followUpPrompts[i];
            if (!prompt) continue;

            const persona = state.personas[i % state.personas.length];
            if (!persona) continue;

            const questionId = `${parentNode.id}_child_${i}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

            // Create question task
            const questionTask: QuestionTask = {
              id: questionId,
              prompt,
              persona,
              parentId: parentNode.id,
              depth: parentNode.depth + 1,
            };

            // Create conversation node
            const newNode = {
              id: questionId,
              parentId: parentNode.id,
              depth: parentNode.depth + 1,
              prompt,
              persona,
              isComplete: false,
              createdAt: new Date().toISOString(),
            };

            newQuestions.push(questionTask);
            newNodes.push(newNode);
          }
        }

        if (newQuestions.length === 0) {
          ctx.log.info("No new questions generated");
          return Success({
            ...state,
            currentStage:
              state.pendingQuestions.length > 0 ? "processing" : "completed",
          });
        }

        // Update state with new questions and nodes
        const updatedState: ConversationExplorerState = {
          ...state,
          nodes: newNodes,
          pendingQuestions: [...state.pendingQuestions, ...newQuestions],
          currentStage: "processing", // Move to processing stage
        };

        ctx.log.info(`Generated ${newQuestions.length} new questions`, {
          newQuestionsCount: newQuestions.length,
          totalNodes: newNodes.length,
          pendingQuestions: updatedState.pendingQuestions.length,
        });

        // Emit generation event
        ctx.emit("questions:generated", {
          count: newQuestions.length,
          totalNodes: newNodes.length,
          expandedFrom: expandableNodes.length,
        });

        return Success(updatedState);
      } catch (error) {
        ctx.log.error("Question generation failed:", error);

        return Failure(
          new ProcessorExecutionError(
            "generateQuestions",
            ctx.meta.executionId,
            error instanceof Error ? error : new Error(String(error))
          )
        );
      }
    });
}
