// AM2Z v4.0 - Conversation Explorer Orchestrator
// Main orchestrator that coordinates all processors using AM2Z composition capabilities

import {
  createProcessor,
  chainProcessors,
  routeProcessor,
  parallelProcessors,
  Success,
  Failure,
  withRetry,
} from "../../../src/lib/core";

import { type ConversationExplorerState, type AIService } from "../types";
import { ProcessorExecutionError } from "../../../src/lib/core/errors";

// Import our modular processors
import {
  createQuestionGeneratorProcessor,
  createAIQuestionGeneratorProcessor,
} from "./question-generator";
import {
  createBatchProcessor,
  createParallelBatchProcessor,
} from "./batch-processor";
import { analyticsProcessor, enhancedAnalyticsProcessor } from "./analytics";

/**
 * Orchestrator dependencies
 */
interface OrchestratorDependencies {
  readonly aiService: AIService;
  readonly useEnhancedAnalytics?: boolean;
  readonly useParallelBatching?: boolean;
  readonly useAIQuestionGeneration?: boolean;
}

/**
 * Main Conversation Explorer Orchestrator
 * Uses AM2Z routing and chaining capabilities to coordinate the exploration process
 */
export function createConversationExplorerOrchestrator(
  dependencies: OrchestratorDependencies
) {
  // Create processor instances based on configuration
  const questionGenerator = dependencies.useAIQuestionGeneration
    ? createAIQuestionGeneratorProcessor({ aiService: dependencies.aiService })
    : createQuestionGeneratorProcessor({ aiService: dependencies.aiService });

  const batchProcessor = dependencies.useParallelBatching
    ? createParallelBatchProcessor({ aiService: dependencies.aiService })
    : createBatchProcessor({ aiService: dependencies.aiService });

  const analyticsProc = dependencies.useEnhancedAnalytics
    ? enhancedAnalyticsProcessor
    : analyticsProcessor;

  // Initial setup processor
  const setupProcessor = createProcessor<ConversationExplorerState>("setup")
    .withDescription(
      "Initialize conversation exploration and process initial nodes"
    )
    .withTimeout(20000)

    .processWithImmer((draft, ctx) => {
      ctx.log.info("🔧 Setting up conversation exploration...");

      // Initialize pipeline
      draft.pipeline.stage = "initializing";
      draft.workflowStage.currentPhase = "setup";

      // Process initial prompts if not already completed
      const pendingInitialNodes = draft.conversationTree.filter(
        (node) => !node.isComplete && node.depth === 0
      );

      if (pendingInitialNodes.length > 0) {
        ctx.log.info(
          `Creating initial batch for ${pendingInitialNodes.length} root nodes`
        );

        // Create initial batch for root questions
        const initialQuestions = pendingInitialNodes.map((node) => ({
          id: node.id,
          prompt: node.prompt,
          persona: node.persona,
          parentId: node.parentId,
          depth: node.depth,
          context: undefined,
        }));

        const initialBatch = {
          id: `initial_batch_${Date.now()}`,
          questions: initialQuestions,
          priority: 3, // Highest priority for initial questions
          createdAt: new Date().toISOString(),
          maxConcurrency: Math.min(
            draft.config.batchSize,
            initialQuestions.length
          ),
        };

        (draft.processingQueue.pendingBatches as any).push(initialBatch);
        draft.processingQueue.queueMetrics.totalQueued +=
          initialQuestions.length;

        draft.pipeline.stage = "processing_responses";
      } else {
        // All initial nodes completed, move to expansion
        draft.pipeline.stage = "generating_questions";
      }

      ctx.log.info("Setup completed", {
        pendingInitialNodes: pendingInitialNodes.length,
        nextStage: draft.pipeline.stage,
      });
    });

  // Stage router that determines which processor to run next
  const stageRouter = routeProcessor<ConversationExplorerState>(
    "stageRouter",
    (state) => state.pipeline.stage,
    {
      initializing: setupProcessor,
      generating_questions: questionGenerator,
      processing_responses: batchProcessor,
      expanding_tree: questionGenerator, // Generate more questions after tree expansion
      analyzing: analyticsProc,
      completed: createCompletionProcessor(),
      error: createErrorProcessor(),
    },
    // Fallback processor
    createFallbackProcessor()
  );

  // Main orchestration chain
  const mainChain = chainProcessors<ConversationExplorerState>(
    "conversationExplorerChain",
    stageRouter,
    analyticsProc // Always run analytics after each stage
  );

  // Add retry logic to the main chain for resilience
  const resilientChain = withRetry(mainChain, {
    maxAttempts: 3,
    backoffMs: 1000,
    shouldRetry: (error) => error.retryable,
    onRetry: (error, attempt) => {
      console.log(
        `Retrying conversation exploration (attempt ${attempt}): ${error.message}`
      );
    },
    onExhausted: (error, attempts) => {
      console.error(
        `Conversation exploration failed after ${attempts} attempts: ${error.message}`
      );
    },
  });

  return resilientChain;
}

/**
 * Advanced Orchestrator with Parallel Workflow Optimization
 * Uses parallel processing where possible for maximum efficiency
 */
export function createAdvancedConversationOrchestrator(
  dependencies: OrchestratorDependencies
) {
  // Advanced parallel workflow
  const parallelWorkflow = createParallelWorkflowProcessor(dependencies);

  // Advanced routing with more sophisticated logic
  const advancedRouter = createAdvancedRouter(dependencies);

  // Monitoring and optimization processor
  const monitoringProcessor = createMonitoringProcessor();

  // Advanced chain with parallel optimization
  return chainProcessors<ConversationExplorerState>(
    "advancedConversationExplorer",
    advancedRouter,
    parallelWorkflow,
    monitoringProcessor,
    analyticsProcessor
  );
}

// === Specialized Processors ===

/**
 * Completion processor
 */
function createCompletionProcessor() {
  return createProcessor<ConversationExplorerState>("completion")
    .withDescription("Handle conversation exploration completion")
    .withTimeout(5000)

    .processWithImmer((draft, ctx) => {
      ctx.log.info("🎉 Conversation exploration completed");

      // Ensure completion state is properly set
      draft.pipeline.isComplete = true;
      draft.pipeline.completedAt =
        draft.pipeline.completedAt || new Date().toISOString();
      draft.workflowStage.currentPhase = "completion";

      // Final analytics update
      const totalTime =
        new Date().getTime() - new Date(draft.pipeline.startedAt).getTime();

      ctx.log.info("Exploration completed successfully", {
        totalNodes: draft.analytics.totalNodes,
        completedNodes: draft.analytics.completedNodes,
        maxDepth: draft.analytics.maxDepthReached,
        totalTime: `${(totalTime / 1000).toFixed(1)}s`,
        completionRate: `${(draft.analytics.completionRate * 100).toFixed(1)}%`,
        batchesProcessed: draft.analytics.processingStats.batchesProcessed,
      });

      // Emit completion event
      ctx.emit("exploration:completed", {
        analytics: draft.analytics,
        totalTime,
        finalStats: {
          totalNodes: draft.analytics.totalNodes,
          completedNodes: draft.analytics.completedNodes,
          completionRate: draft.analytics.completionRate,
        },
      });
    });
}

/**
 * Error processor for handling error states
 */
function createErrorProcessor() {
  return createProcessor<ConversationExplorerState>("errorHandler")
    .withDescription("Handle error states and attempt recovery")
    .withTimeout(10000)

    .processWithImmer((draft, ctx) => {
      ctx.log.error("❌ Handling error state", {
        error: draft.pipeline.lastError,
        stage: draft.pipeline.stage,
        iteration: draft.pipeline.iterationCount,
      });

      // Attempt error recovery based on the type of error
      const canRecover = attemptErrorRecovery(draft, ctx);

      if (canRecover) {
        ctx.log.info("✅ Error recovery successful, resuming processing");
        draft.pipeline.stage = "analyzing"; // Go back to analysis
        draft.pipeline.lastError = undefined;
      } else {
        ctx.log.error("💀 Cannot recover from error, marking as failed");
        draft.pipeline.isComplete = true;
        draft.pipeline.completedAt = new Date().toISOString();

        ctx.emit("exploration:failed", {
          error: draft.pipeline.lastError,
          finalStats: draft.analytics,
        });
      }
    });
}

/**
 * Fallback processor for unknown states
 */
function createFallbackProcessor() {
  return createProcessor<ConversationExplorerState>("fallback")
    .withDescription("Fallback processor for unknown pipeline stages")
    .withTimeout(5000)

    .processWithImmer((draft, ctx) => {
      ctx.log.warn(
        `⚠️ Unknown pipeline stage: ${draft.pipeline.stage}, moving to analytics`
      );
      draft.pipeline.stage = "analyzing";
    });
}

/**
 * Parallel workflow processor for advanced orchestration
 */
function createParallelWorkflowProcessor(
  dependencies: OrchestratorDependencies
) {
  // Create parallel processors for different aspects
  const questionGeneration = createAIQuestionGeneratorProcessor({
    aiService: dependencies.aiService,
  });

  const batchProcessing = createParallelBatchProcessor({
    aiService: dependencies.aiService,
  });

  const performanceMonitoring = createPerformanceMonitoringProcessor();

  // Run these in parallel when appropriate
  return routeProcessor<ConversationExplorerState>(
    "parallelWorkflow",
    (state) => {
      // Determine if we can run parallel workflow
      if (
        state.processingQueue.pendingBatches.length > 0 &&
        state.conversationTree.some(
          (node) => node.isComplete && node.childIds.length === 0
        )
      ) {
        return "parallel";
      }
      return "sequential";
    },
    {
      parallel: parallelProcessors(
        "parallelWorkflowExecution",
        questionGeneration,
        batchProcessing,
        performanceMonitoring
      ),
      sequential: chainProcessors(
        "sequentialWorkflow",
        questionGeneration,
        batchProcessing
      ),
    }
  );
}

/**
 * Advanced router with intelligent routing logic
 */
function createAdvancedRouter(dependencies: OrchestratorDependencies) {
  return createProcessor<ConversationExplorerState>("advancedRouter")
    .withDescription(
      "Intelligent routing based on system state and performance"
    )
    .withTimeout(2000)

    .process(async (state, ctx) => {
      // Analyze system state
      const systemLoad = analyzeSystemLoad(state);
      const nextAction = determineOptimalAction(state, systemLoad);

      ctx.log.info("Advanced routing decision", {
        currentStage: state.pipeline.stage,
        systemLoad,
        recommendedAction: nextAction,
        queueStatus: {
          pending: state.processingQueue.pendingBatches.length,
          active: state.processingQueue.activeBatches.length,
        },
      });

      // Update pipeline stage based on intelligent analysis
      const updatedState = {
        ...state,
        pipeline: {
          ...state.pipeline,
          stage: nextAction,
        },
      } as ConversationExplorerState;

      return Success(updatedState);
    });
}

/**
 * Performance monitoring processor
 */
function createPerformanceMonitoringProcessor() {
  return createProcessor<ConversationExplorerState>("performanceMonitoring")
    .withDescription("Monitor system performance and suggest optimizations")
    .withTimeout(3000)

    .processWithImmer((draft, ctx) => {
      // Calculate current performance metrics
      const performance = {
        throughput: draft.processingQueue.queueMetrics.throughputPerMinute,
        averageResponseTime: draft.analytics.averageResponseTime,
        completionRate: draft.analytics.completionRate,
        parallelEfficiency: draft.analytics.processingStats.parallelEfficiency,
      };

      // Log performance insights
      ctx.log.info("Performance monitoring", performance);

      // Suggest optimizations if needed
      if (performance.throughput < 10) {
        ctx.log.warn("Low throughput detected, consider increasing batch size");
      }

      if (performance.parallelEfficiency < 0.6) {
        ctx.log.warn(
          "Low parallel efficiency, consider optimizing concurrency"
        );
      }

      // Emit performance event
      ctx.emit("performance:monitored", performance);
    });
}

/**
 * Monitoring processor for advanced orchestrator
 */
function createMonitoringProcessor() {
  return createProcessor<ConversationExplorerState>("monitoring")
    .withDescription("Advanced monitoring and system health checks")
    .withTimeout(5000)

    .processWithImmer((draft, ctx) => {
      // Comprehensive system health check
      const healthCheck = performSystemHealthCheck(draft);

      ctx.log.info("System health check", healthCheck);

      // Take corrective actions if needed
      if (healthCheck.issues.length > 0) {
        ctx.log.warn("System issues detected", healthCheck.issues);
        applyCorrectiveActions(draft, healthCheck.issues, ctx);
      }

      // Emit monitoring event
      ctx.emit("system:monitored", healthCheck);
    });
}

// === Helper Functions ===

/**
 * Attempt to recover from error state
 */
function attemptErrorRecovery(draft: any, ctx: any): boolean {
  const error = draft.pipeline.lastError;

  if (!error) return true;

  // Simple recovery strategies
  if (error.includes("timeout")) {
    ctx.log.info("Timeout error detected, clearing stale batches");
    // Clear any stale active batches
    draft.processingQueue.activeBatches = [];
    return true;
  }

  if (error.includes("batch processing failed")) {
    ctx.log.info("Batch processing error, retrying with smaller batches");
    // Reduce batch size for retry
    if (draft.config.batchSize > 2) {
      draft.config.batchSize = Math.max(
        2,
        Math.floor(draft.config.batchSize / 2)
      );
      return true;
    }
  }

  return false; // Cannot recover
}

/**
 * Analyze system load
 */
function analyzeSystemLoad(state: ConversationExplorerState) {
  return {
    queueLoad:
      state.processingQueue.pendingBatches.length +
      state.processingQueue.activeBatches.length,
    processingLoad: state.processingQueue.activeBatches.length,
    completionRatio: state.analytics.completionRate,
    resourceUtilization: state.analytics.processingStats.parallelEfficiency,
  };
}

/**
 * Determine optimal next action
 */
function determineOptimalAction(
  state: ConversationExplorerState,
  systemLoad: any
): any {
  // Intelligent decision making based on system state
  if (systemLoad.queueLoad > 5) {
    return "processing_responses"; // Focus on processing backlog
  }

  if (state.analytics.completionRate > 0.8 && systemLoad.queueLoad === 0) {
    return "analyzing"; // Near completion, run analytics
  }

  if (state.analytics.maxDepthReached < state.config.maxDepth - 1) {
    return "generating_questions"; // Can still expand depth
  }

  return state.pipeline.stage; // Keep current stage
}

/**
 * Perform comprehensive system health check
 */
function performSystemHealthCheck(draft: any) {
  const issues: string[] = [];
  const warnings: string[] = [];
  const metrics = {
    queueHealth: "good",
    processingHealth: "good",
    dataIntegrity: "good",
  };

  // Check queue health
  if (draft.processingQueue.activeBatches.length > 10) {
    issues.push("Too many active batches");
    metrics.queueHealth = "critical";
  }

  // Check processing health
  if (draft.analytics.processingStats.parallelEfficiency < 0.3) {
    warnings.push("Low parallel efficiency");
    metrics.processingHealth = "warning";
  }

  // Check data integrity
  const expectedTotalNodes = draft.processingQueue.completedBatches.reduce(
    (sum: number, batch: any) => sum + batch.successCount,
    draft.conversationTree.filter((node: any) => node.depth === 0).length
  );

  if (Math.abs(expectedTotalNodes - draft.analytics.completedNodes) > 2) {
    issues.push("Data integrity issue: node count mismatch");
    metrics.dataIntegrity = "warning";
  }

  return {
    issues,
    warnings,
    metrics,
    overall:
      issues.length > 0
        ? "critical"
        : warnings.length > 0
          ? "warning"
          : "healthy",
  };
}

/**
 * Apply corrective actions based on detected issues
 */
function applyCorrectiveActions(draft: any, issues: string[], ctx: any): void {
  issues.forEach((issue) => {
    if (issue.includes("Too many active batches")) {
      // Clear some active batches and move them back to pending
      const excessBatches = draft.processingQueue.activeBatches.splice(5);
      excessBatches.forEach((batch: any) => {
        (draft.processingQueue.pendingBatches as any).unshift(batch);
      });
      ctx.log.info(
        `Moved ${excessBatches.length} batches back to pending queue`
      );
    }

    if (issue.includes("Data integrity")) {
      // Recalculate analytics
      ctx.log.info("Recalculating analytics due to data integrity issue");
      // This would be handled by the analytics processor
    }
  });
}
