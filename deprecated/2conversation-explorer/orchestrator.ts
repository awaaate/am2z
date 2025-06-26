// AM2Z v4.0 - Conversation Explorer Orchestrator
// Main orchestrator using AM2Z composition capabilities correctly

import {
  createProcessor,
  chainProcessors,
  routeProcessor,
  parallelProcessors,
} from "../../src/lib/core";

import { type ConversationExplorerState, type AIService } from "./types";

// Import processors
import { createAnswerQuestionProcessor } from "./processors/answer-question";
import {
  createBatchAnswererProcessor,
  createSimpleBatchProcessor,
} from "./processors/batch-answerer";
import { createGenerateQuestionsProcessor } from "./processors/generate-questions";
import { analyticsProcessor } from "./processors/analytics";

/**
 * Main Conversation Explorer Orchestrator
 * Uses AM2Z routing and chaining to coordinate the exploration process
 */
export function createConversationExplorerOrchestrator(aiService: AIService) {
  // Create individual processors
  const answerQuestion = createAnswerQuestionProcessor(aiService);
  const batchAnswerer = createSimpleBatchProcessor(aiService); // Use simple for better reliability
  const generateQuestions = createGenerateQuestionsProcessor(aiService);

  // Stage router that determines the next action based on current stage
  const stageRouter = routeProcessor<ConversationExplorerState>(
    "stageRouter",
    (state) => state.currentStage,
    {
      setup: createSetupProcessor(),
      processing: batchAnswerer,
      expanding: generateQuestions,
      completed: createCompletionProcessor(),
    },
    // Fallback - if unknown stage, go to analytics
    analyticsProcessor
  );

  // Main orchestration chain
  // Always run analytics after the stage-specific processor
  const mainChain = chainProcessors<ConversationExplorerState>({
    name: "conversationExplorerChain",
    timeoutStrategy: stageRouter,
    processors: [analyticsProcessor],
  });

  return {
    mainProcessor: mainChain,
    answerQuestion, // Export for direct use in distributed mode
  };
}

/**
 * Setup Processor - Initializes the conversation with initial questions
 */
function createSetupProcessor() {
  return createProcessor<ConversationExplorerState>("setup")
    .withDescription("Initialize conversation exploration")
    .withTimeout(10000)

    .processWithImmer((draft, ctx) => {
      ctx.log.info("🔧 Setting up conversation exploration...");

      // Find incomplete root nodes (initial questions)
      const incompleteRoots = draft.nodes.filter(
        (node) => !node.isComplete && node.depth === 0
      );

      if (incompleteRoots.length > 0) {
        // Create question tasks for incomplete root nodes
        const initialTasks = incompleteRoots.map((node) => ({
          id: node.id,
          prompt: node.prompt,
          persona: node.persona,
          parentId: node.parentId,
          depth: node.depth,
        }));

        // Add to pending questions
        initialTasks.forEach((task) => {
          (draft.pendingQuestions as any).push(task);
        });

        draft.currentStage = "processing";

        ctx.log.info(`Created ${initialTasks.length} initial question tasks`);
      } else {
        // All initial nodes are complete, move to expansion
        draft.currentStage = "expanding";
      }
    });
}

/**
 * Completion Processor - Handles final state
 */
function createCompletionProcessor() {
  return createProcessor<ConversationExplorerState>("completion")
    .withDescription("Handle conversation exploration completion")
    .withTimeout(5000)

    .processWithImmer((draft, ctx) => {
      ctx.log.info("🎉 Conversation exploration completed!");

      // Ensure completion state
      draft.currentStage = "completed";
      draft.analytics.isComplete = true;

      // Calculate final metrics
      const totalTime =
        Date.now() - new Date(draft.metadata.createdAt).getTime();

      ctx.log.info("Final statistics", {
        totalNodes: draft.analytics.totalNodes,
        completedNodes: draft.analytics.completedNodes,
        maxDepth: draft.analytics.maxDepthReached,
        avgProcessingTime: `${draft.analytics.averageProcessingTime.toFixed(0)}ms`,
        totalExplorationTime: `${(totalTime / 1000).toFixed(1)}s`,
        completionRate: `${((draft.analytics.completedNodes / draft.analytics.totalNodes) * 100).toFixed(1)}%`,
      });

      // Emit completion event
      ctx.emit("exploration:completed", {
        analytics: draft.analytics,
        totalExplorationTime: totalTime,
        completionRate:
          draft.analytics.completedNodes / draft.analytics.totalNodes,
      });
    });
}

/**
 * Advanced Orchestrator with Parallel Processing
 * Uses parallelProcessors for better throughput in distributed environments
 */
export function createAdvancedConversationOrchestrator(aiService: AIService) {
  const answerQuestion = createAnswerQuestionProcessor(aiService);
  const batchAnswerer = createBatchAnswererProcessor(aiService); // Use parallel version
  const generateQuestions = createGenerateQuestionsProcessor(aiService);

  // Advanced routing with parallel processing capabilities
  const advancedRouter = routeProcessor<ConversationExplorerState>(
    "advancedStageRouter",
    (state) => {
      // More intelligent routing based on system state
      if (
        state.currentStage === "processing" &&
        state.pendingQuestions.length > state.config.batchSize
      ) {
        return "parallel_processing"; // Use parallel when many questions pending
      }
      return state.currentStage;
    },
    {
      setup: createSetupProcessor(),
      processing: batchAnswerer,
      parallel_processing: parallelProcessors({
        name: "parallelQuestionProcessing",
        timeoutStrategy: batchAnswerer,
        processors: [
          generateQuestions, // Process existing and generate new questions in parallel
        ],
      }),
      expanding: generateQuestions,
      completed: createCompletionProcessor(),
    },
    analyticsProcessor
  );

  // Advanced chain with monitoring
  const advancedChain = chainProcessors<ConversationExplorerState>({
    name: "advancedConversationExplorer",
    timeoutStrategy: advancedRouter,
    processors: [analyticsProcessor, createMonitoringProcessor()],
  });

  return {
    mainProcessor: advancedChain,
    answerQuestion,
  };
}

/**
 * Monitoring Processor for system health
 */
function createMonitoringProcessor() {
  return createProcessor<ConversationExplorerState>("monitoring")
    .withDescription("Monitor system health and performance")
    .withTimeout(3000)

    .processWithImmer((draft, ctx) => {
      // Calculate performance metrics
      const queueLoad = draft.pendingQuestions.length;
      const completionRate =
        draft.analytics.totalNodes > 0
          ? draft.analytics.completedNodes / draft.analytics.totalNodes
          : 0;

      // Log performance insights
      if (queueLoad > draft.config.batchSize * 2) {
        ctx.log.warn("High queue load detected", {
          queueLoad,
          batchSize: draft.config.batchSize,
        });
      }

      if (completionRate < 0.5 && draft.analytics.totalNodes > 10) {
        ctx.log.warn("Low completion rate", {
          completionRate: `${(completionRate * 100).toFixed(1)}%`,
        });
      }

      // Emit monitoring event
      ctx.emit("system:monitored", {
        queueLoad,
        completionRate,
        totalNodes: draft.analytics.totalNodes,
        avgProcessingTime: draft.analytics.averageProcessingTime,
      });
    });
}
