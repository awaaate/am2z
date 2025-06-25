// AM2Z v4.0 - Question Generator Processor
// Generates follow-up questions based on completed conversation nodes

import { createProcessor, Success, Failure } from "../../../src/lib/core";
import {
  type ConversationExplorerState,
  type QuestionRequest,
  type QuestionBatch,
  type AIService,
  type ConversationNode,
} from "../types";
import { ProcessorExecutionError } from "../../../src/lib/core/errors";

/**
 * Question generator dependencies
 */
interface QuestionGeneratorDependencies {
  readonly aiService: AIService;
}

/**
 * Question Generator Processor
 * Finds completed nodes that can be expanded and generates follow-up questions
 */
export function createQuestionGeneratorProcessor(
  dependencies: QuestionGeneratorDependencies
) {
  return createProcessor<ConversationExplorerState>("questionGenerator")
    .withDescription(
      "Generate follow-up questions from completed conversation nodes"
    )
    .withTimeout(20000)
    .withRetryPolicy({
      maxAttempts: 2,
      backoffMs: 1500,
      shouldRetry: (error) => error.retryable,
    })

    .processWithImmer((draft, ctx) => {
      ctx.log.info("🔍 Starting question generation...");

      // Check if we can still expand the tree
      if (draft.conversationTree.length >= draft.config.maxTotalNodes) {
        ctx.log.info(
          "Maximum total nodes reached, skipping question generation"
        );
        draft.pipeline.stage = "analyzing";
        return;
      }

      if (draft.analytics.maxDepthReached >= draft.config.maxDepth - 1) {
        ctx.log.info("Maximum depth reached, skipping question generation");
        draft.pipeline.stage = "analyzing";
        return;
      }

      // Find completed nodes that can be expanded
      const expandableNodes = draft.conversationTree.filter(
        (node) =>
          node.isComplete &&
          node.childIds.length === 0 &&
          node.depth < draft.config.maxDepth - 1
      );

      if (expandableNodes.length === 0) {
        ctx.log.info("No expandable nodes found");
        draft.pipeline.stage = "analyzing";
        return;
      }

      ctx.log.info(
        `Found ${expandableNodes.length} nodes that can be expanded`
      );
      draft.pipeline.stage = "generating_questions";

      // Process each expandable node
      const newQuestions: QuestionRequest[] = [];

      expandableNodes.forEach((parentNode) => {
        // Calculate how many children we can add
        const remainingCapacity =
          draft.config.maxTotalNodes - draft.conversationTree.length;
        const maxChildren = Math.min(
          draft.config.branchingFactor,
          remainingCapacity,
          draft.config.maxNodesPerLevel
        );

        if (maxChildren <= 0) return;

        // Generate questions for this node
        for (let i = 0; i < maxChildren; i++) {
          const persona = draft.personas[i % draft.personas.length];
          if (!persona) continue;

          // Create context from parent node
          const context = {
            parentResponse: parentNode.response,
            conversationHistory: getConversationHistory(
              parentNode,
              draft.conversationTree
            ),
          };

          const questionId = `${parentNode.id}_child_${i}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

          const questionRequest: QuestionRequest = {
            id: questionId,
            prompt: generateFollowUpPrompt(parentNode, persona, i),
            persona,
            parentId: parentNode.id,
            depth: parentNode.depth + 1,
            context,
          };

          newQuestions.push(questionRequest);
        }
      });

      if (newQuestions.length === 0) {
        ctx.log.info("No new questions generated");
        draft.pipeline.stage = "analyzing";
        return;
      }

      // Create question batch
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const questionBatch: QuestionBatch = {
        id: batchId,
        questions: newQuestions,
        priority: 1, // Normal priority
        createdAt: new Date().toISOString(),
        maxConcurrency: Math.min(draft.config.batchSize, newQuestions.length),
      };

      // Add batch to processing queue (cast to allow Immer mutation)
      (draft.processingQueue.pendingBatches as any).push(questionBatch);

      // Update queue metrics
      draft.processingQueue.queueMetrics.totalQueued += newQuestions.length;

      ctx.log.info(
        `Generated ${newQuestions.length} questions in batch: ${batchId}`,
        {
          batchSize: newQuestions.length,
          expandableNodes: expandableNodes.length,
          queuedBatches: draft.processingQueue.pendingBatches.length,
        }
      );

      // Emit event
      ctx.emit("questions:generated", {
        batchId,
        questionCount: newQuestions.length,
        expandedFromNodes: expandableNodes.length,
      });

      // Update pipeline stage
      draft.pipeline.stage = "processing_responses";
      draft.pipeline.iterationCount++;
    });
}

/**
 * Enhanced Question Generator using AI service
 * This version uses the AI service to generate more intelligent follow-up questions
 */
export function createAIQuestionGeneratorProcessor(
  dependencies: QuestionGeneratorDependencies
) {
  return createProcessor<ConversationExplorerState>("aiQuestionGenerator")
    .withDescription(
      "Generate AI-powered follow-up questions from completed nodes"
    )
    .withTimeout(30000)
    .withRetryPolicy({
      maxAttempts: 2,
      backoffMs: 2000,
      shouldRetry: (error) => error.retryable,
    })

    .process(async (state, ctx) => {
      ctx.log.info("🤖 Starting AI-powered question generation...");

      // Check expansion limits
      if (state.conversationTree.length >= state.config.maxTotalNodes) {
        ctx.log.info("Maximum total nodes reached");
        return Success({
          ...state,
          pipeline: { ...state.pipeline, stage: "analyzing" },
        } as ConversationExplorerState);
      }

      // Find expandable nodes
      const expandableNodes = state.conversationTree.filter(
        (node) =>
          node.isComplete &&
          node.childIds.length === 0 &&
          node.depth < state.config.maxDepth - 1
      );

      if (expandableNodes.length === 0) {
        ctx.log.info("No expandable nodes found");
        return Success({
          ...state,
          pipeline: { ...state.pipeline, stage: "analyzing" },
        } as ConversationExplorerState);
      }

      ctx.log.info(
        `Processing ${expandableNodes.length} expandable nodes with AI`
      );

      try {
        // Process nodes in parallel for better performance
        const batchPromises = expandableNodes.map(async (parentNode) => {
          const questionsToGenerate = Math.min(
            state.config.branchingFactor,
            state.config.maxTotalNodes - state.conversationTree.length
          );

          if (questionsToGenerate <= 0) return [];

          // Use AI service to generate contextual questions
          const aiQuestions =
            await dependencies.aiService.generateFollowUpQuestions(
              parentNode,
              state.personas,
              questionsToGenerate
            );

          // Convert to QuestionRequest format
          return aiQuestions.map((aiQuestion, index) => {
            const questionId = `${parentNode.id}_ai_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

            const context = {
              parentResponse: parentNode.response,
              conversationHistory: getConversationHistory(
                parentNode,
                state.conversationTree
              ),
            };

            const questionRequest: QuestionRequest = {
              id: questionId,
              prompt: aiQuestion.prompt,
              persona: aiQuestion.persona,
              parentId: parentNode.id,
              depth: parentNode.depth + 1,
              context,
            };

            return questionRequest;
          });
        });

        const allQuestionBatches = await Promise.all(batchPromises);
        const allQuestions = allQuestionBatches.flat();

        if (allQuestions.length === 0) {
          ctx.log.info("No AI questions generated");
          return Success({
            ...state,
            pipeline: { ...state.pipeline, stage: "analyzing" },
          } as ConversationExplorerState);
        }

        // Create question batch
        const batchId = `ai_batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const questionBatch: QuestionBatch = {
          id: batchId,
          questions: allQuestions,
          priority: 2, // Higher priority for AI-generated questions
          createdAt: new Date().toISOString(),
          maxConcurrency: Math.min(state.config.batchSize, allQuestions.length),
        };

        // Update state with new batch
        const updatedQueue = {
          ...state.processingQueue,
          pendingBatches: [
            ...state.processingQueue.pendingBatches,
            questionBatch,
          ],
          queueMetrics: {
            ...state.processingQueue.queueMetrics,
            totalQueued:
              state.processingQueue.queueMetrics.totalQueued +
              allQuestions.length,
          },
        };

        ctx.log.info(
          `Generated ${allQuestions.length} AI questions in batch: ${batchId}`,
          {
            batchSize: allQuestions.length,
            expandableNodes: expandableNodes.length,
            priority: questionBatch.priority,
          }
        );

        // Emit event
        ctx.emit("ai_questions:generated", {
          batchId,
          questionCount: allQuestions.length,
          aiGenerated: true,
        });

        return Success({
          ...state,
          processingQueue: updatedQueue,
          pipeline: {
            ...state.pipeline,
            stage: "processing_responses",
            iterationCount: state.pipeline.iterationCount + 1,
          },
        } as ConversationExplorerState);
      } catch (error) {
        ctx.log.error("AI question generation failed", error);

        return Failure(
          new ProcessorExecutionError(
            "aiQuestionGenerator",
            ctx.meta.executionId,
            error instanceof Error ? error : new Error(String(error))
          )
        );
      }
    });
}

// === Helper Functions ===

/**
 * Generate a simple follow-up prompt (fallback when AI is not available)
 */
function generateFollowUpPrompt(
  parentNode: ConversationNode,
  persona: any,
  index: number
): string {
  const templates = [
    `Given your previous response about "${parentNode.prompt.substring(0, 30)}...", what specific concerns would you want to address next?`,

    `Building on your thoughts regarding "${parentNode.prompt.substring(0, 30)}...", how would you prioritize the different factors involved?`,

    `Considering your perspective on "${parentNode.prompt.substring(0, 30)}...", what additional information would help you make a decision?`,

    `Following up on "${parentNode.prompt.substring(0, 30)}...", what would you want to know about the implementation or execution?`,

    `Based on your response to "${parentNode.prompt.substring(0, 30)}...", what potential obstacles or challenges do you foresee?`,
  ];

  return (
    templates[index % templates.length] ||
    templates[0] ||
    "What are your thoughts on this topic?"
  );
}

/**
 * Get conversation history for context
 */
function getConversationHistory(
  node: ConversationNode,
  allNodes: ConversationNode[]
): string[] {
  const history: string[] = [];
  let currentNode: ConversationNode | undefined = node;

  // Traverse up the tree to get parent responses
  while (currentNode && currentNode.parentId) {
    if (currentNode.response) {
      history.unshift(currentNode.response);
    }
    currentNode = allNodes.find((n) => n.id === currentNode!.parentId);
  }

  return history.slice(0, 3); // Limit to last 3 responses for context
}
