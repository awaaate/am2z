// AM2Z v4.0 - Analytics Processor
// Updates conversation analytics and determines system completion state

import { createProcessor, Success } from "../../../src/lib/core";
import { type ConversationExplorerState } from "../types";

/**
 * Analytics Processor
 * Recalculates analytics, updates metrics, and determines completion state
 */
export const analyticsProcessor = createProcessor<ConversationExplorerState>(
  "analytics"
)
  .withDescription("Update conversation analytics and check for completion")
  .withTimeout(5000)
  .withRetryPolicy({
    maxAttempts: 2,
    backoffMs: 500,
    shouldRetry: (error) => error.retryable,
  })

  .processWithImmer((draft, ctx) => {
    ctx.log.info("📊 Updating analytics and checking completion...");

    // Recalculate core analytics
    updateCoreAnalytics(draft);

    // Update processing queue metrics
    updateQueueMetrics(draft);

    // Update persona distribution
    updatePersonaDistribution(draft);

    // Check completion criteria
    const completionStatus = checkCompletionCriteria(draft);

    // Update pipeline state based on completion
    updatePipelineState(draft, completionStatus, ctx);

    // Update workflow stage
    updateWorkflowStage(draft, completionStatus);

    // Log current state
    logAnalyticsUpdate(draft, ctx);

    // Emit analytics update event
    ctx.emit("analytics:updated", {
      analytics: draft.analytics,
      completionStatus,
      pipeline: draft.pipeline,
    });
  });

/**
 * Enhanced Analytics Processor with Performance Insights
 */
export const enhancedAnalyticsProcessor =
  createProcessor<ConversationExplorerState>("enhancedAnalytics")
    .withDescription(
      "Advanced analytics with performance insights and optimization suggestions"
    )
    .withTimeout(8000)

    .processWithImmer((draft, ctx) => {
      ctx.log.info("📈 Running enhanced analytics...");

      // Run core analytics
      updateCoreAnalytics(draft);
      updateQueueMetrics(draft);
      updatePersonaDistribution(draft);

      // Calculate performance metrics
      const performanceMetrics = calculatePerformanceMetrics(draft);

      // Analyze conversation quality
      const qualityMetrics = analyzeConversationQuality(draft);

      // Generate optimization suggestions
      const optimizations = generateOptimizationSuggestions(
        draft,
        performanceMetrics
      );

      // Check completion with enhanced criteria
      const completionStatus = checkEnhancedCompletionCriteria(
        draft,
        performanceMetrics
      );

      updatePipelineState(draft, completionStatus, ctx);
      updateWorkflowStage(draft, completionStatus);

      // Log enhanced insights
      ctx.log.info("Enhanced analytics completed", {
        performance: performanceMetrics,
        quality: qualityMetrics,
        optimizations: optimizations.slice(0, 3), // Top 3 suggestions
        completion: completionStatus,
      });

      // Emit enhanced analytics event
      ctx.emit("enhanced_analytics:updated", {
        analytics: draft.analytics,
        performance: performanceMetrics,
        quality: qualityMetrics,
        optimizations,
        completionStatus,
      });
    });

// === Core Analytics Functions ===

/**
 * Update core analytics metrics
 */
function updateCoreAnalytics(draft: any): void {
  const allNodes = draft.conversationTree;
  const completedNodes = allNodes.filter((node: any) => node.isComplete);
  const pendingNodes = allNodes.filter((node: any) => !node.isComplete);

  // Basic counts
  draft.analytics.totalNodes = allNodes.length;
  draft.analytics.completedNodes = completedNodes.length;
  draft.analytics.pendingNodes = pendingNodes.length;

  // Depth analysis
  const depths = allNodes.map((node: any) => node.depth);
  draft.analytics.maxDepthReached = Math.max(...depths, 0);
  draft.analytics.averageDepth =
    depths.length > 0
      ? depths.reduce((sum: number, depth: number) => sum + depth, 0) /
        depths.length
      : 0;

  // Processing time analysis
  const processingTimes = completedNodes
    .map((node: any) => node.processingMetrics?.processingTimeMs || 0)
    .filter((time: number) => time > 0);

  if (processingTimes.length > 0) {
    draft.analytics.totalProcessingTime = processingTimes.reduce(
      (sum: number, time: number) => sum + time,
      0
    );
    draft.analytics.averageResponseTime =
      draft.analytics.totalProcessingTime / processingTimes.length;
  }

  // Completion rate
  draft.analytics.completionRate =
    allNodes.length > 0 ? completedNodes.length / allNodes.length : 0;
}

/**
 * Update processing queue metrics
 */
function updateQueueMetrics(draft: any): void {
  const queue = draft.processingQueue;

  // Calculate average wait time (simplified)
  const completedBatches = queue.completedBatches;
  if (completedBatches.length > 0) {
    const avgProcessingTime =
      completedBatches.reduce(
        (sum: number, batch: any) => sum + batch.totalProcessingTime,
        0
      ) / completedBatches.length;

    queue.queueMetrics.averageWaitTime = avgProcessingTime;
  }

  // Update throughput (already calculated in batch processor)
  // Additional queue health metrics could be added here
}

/**
 * Update persona distribution analytics
 */
function updatePersonaDistribution(draft: any): void {
  const distribution: Record<string, number> = {};

  draft.conversationTree.forEach((node: any) => {
    const personaId = node.persona.id;
    distribution[personaId] = (distribution[personaId] || 0) + 1;
  });

  draft.analytics.personaDistribution = distribution;
}

// === Completion Criteria ===

interface CompletionStatus {
  readonly isComplete: boolean;
  readonly reason: string;
  readonly completionPercentage: number;
  readonly blockers: readonly string[];
  readonly nextActions: readonly string[];
}

/**
 * Check basic completion criteria
 */
function checkCompletionCriteria(draft: any): CompletionStatus {
  const config = draft.config;
  const analytics = draft.analytics;
  const queue = draft.processingQueue;

  const blockers: string[] = [];
  const nextActions: string[] = [];

  // Check if all nodes are completed
  const allNodesCompleted = analytics.pendingNodes === 0;

  // Check if maximum limits reached
  const maxNodesReached = analytics.totalNodes >= config.maxTotalNodes;
  const maxDepthReached = analytics.maxDepthReached >= config.maxDepth - 1;

  // Check if there are pending batches
  const hasPendingWork =
    queue.pendingBatches.length > 0 || queue.activeBatches.length > 0;

  // Determine completion
  let isComplete = false;
  let reason = "";

  if (allNodesCompleted && !hasPendingWork) {
    if (maxNodesReached || maxDepthReached) {
      isComplete = true;
      reason = "All nodes completed and limits reached";
    } else {
      // Could expand more but no pending work
      const expandableNodes = draft.conversationTree.filter(
        (node: any) =>
          node.isComplete &&
          node.childIds.length === 0 &&
          node.depth < config.maxDepth - 1
      );

      if (expandableNodes.length === 0) {
        isComplete = true;
        reason = "All nodes completed and no expandable nodes remaining";
      } else {
        nextActions.push("Generate more questions from expandable nodes");
      }
    }
  } else if (hasPendingWork) {
    nextActions.push("Process pending batches");
  } else if (analytics.pendingNodes > 0) {
    blockers.push("Incomplete nodes detected without corresponding batches");
    nextActions.push("Create batches for pending nodes");
  }

  // Calculate completion percentage
  let completionPercentage = analytics.completionRate * 100;

  // Adjust for depth and coverage
  const depthProgress = analytics.maxDepthReached / (config.maxDepth - 1);
  const nodeProgress = analytics.totalNodes / config.maxTotalNodes;
  completionPercentage = Math.min(
    100,
    (completionPercentage + depthProgress * 30 + nodeProgress * 20) / 1.5
  );

  return {
    isComplete,
    reason,
    completionPercentage,
    blockers,
    nextActions,
  };
}

/**
 * Enhanced completion criteria with quality checks
 */
function checkEnhancedCompletionCriteria(
  draft: any,
  performanceMetrics: any
): CompletionStatus {
  const basicStatus = checkCompletionCriteria(draft);

  // Add quality-based criteria
  const qualityThresholds = {
    minAverageConfidence: 0.7,
    minSuccessRate: 0.8,
    minDepthCoverage: 0.6,
  };

  const additionalBlockers: string[] = [...basicStatus.blockers];
  const additionalActions: string[] = [...basicStatus.nextActions];

  // Check quality metrics
  if (
    performanceMetrics.averageConfidence <
    qualityThresholds.minAverageConfidence
  ) {
    additionalBlockers.push("Average confidence below threshold");
    additionalActions.push("Improve response quality");
  }

  if (performanceMetrics.successRate < qualityThresholds.minSuccessRate) {
    additionalBlockers.push("Success rate below threshold");
    additionalActions.push("Investigate and resolve failures");
  }

  const depthCoverage =
    draft.analytics.maxDepthReached / (draft.config.maxDepth - 1);
  if (depthCoverage < qualityThresholds.minDepthCoverage) {
    additionalBlockers.push("Insufficient depth coverage");
    additionalActions.push("Expand conversations to deeper levels");
  }

  // Override completion if quality issues exist
  const hasQualityIssues =
    additionalBlockers.length > basicStatus.blockers.length;
  const enhancedComplete = basicStatus.isComplete && !hasQualityIssues;

  return {
    ...basicStatus,
    isComplete: enhancedComplete,
    reason: hasQualityIssues
      ? `${basicStatus.reason} (blocked by quality issues)`
      : basicStatus.reason,
    blockers: additionalBlockers,
    nextActions: additionalActions,
  };
}

// === Performance Analysis ===

/**
 * Calculate performance metrics
 */
function calculatePerformanceMetrics(draft: any) {
  const completedNodes = draft.conversationTree.filter(
    (node: any) => node.isComplete
  );
  const processingMetrics = completedNodes
    .map((node: any) => node.processingMetrics)
    .filter((metrics: any) => metrics);

  const completedBatches = draft.processingQueue.completedBatches;

  return {
    // Response quality
    averageConfidence:
      processingMetrics.length > 0
        ? processingMetrics.reduce(
            (sum: number, m: any) => sum + m.confidenceScore,
            0
          ) / processingMetrics.length
        : 0,

    // Processing efficiency
    averageProcessingTime:
      processingMetrics.length > 0
        ? processingMetrics.reduce(
            (sum: number, m: any) => sum + m.processingTimeMs,
            0
          ) / processingMetrics.length
        : 0,

    // Batch efficiency
    batchEfficiency: draft.analytics.processingStats.parallelEfficiency,
    averageBatchSize: draft.analytics.processingStats.averageBatchSize,

    // Success rates
    successRate:
      completedBatches.length > 0
        ? completedBatches.reduce(
            (sum: number, batch: any) => sum + batch.successCount,
            0
          ) /
          completedBatches.reduce(
            (sum: number, batch: any) => sum + batch.responses.length,
            0
          )
        : 0,

    // Throughput
    throughputPerMinute: draft.processingQueue.queueMetrics.throughputPerMinute,

    // Resource utilization
    queueUtilization: {
      pending: draft.processingQueue.pendingBatches.length,
      active: draft.processingQueue.activeBatches.length,
      completed: draft.processingQueue.completedBatches.length,
    },
  };
}

/**
 * Analyze conversation quality
 */
function analyzeConversationQuality(draft: any) {
  const nodes = draft.conversationTree;
  const completedNodes = nodes.filter((node: any) => node.isComplete);

  return {
    // Depth analysis
    depthDistribution: calculateDepthDistribution(nodes),

    // Response length analysis
    averageResponseLength:
      completedNodes.length > 0
        ? completedNodes.reduce(
            (sum: number, node: any) => sum + (node.response?.length || 0),
            0
          ) / completedNodes.length
        : 0,

    // Persona coverage
    personaCoverage:
      Object.keys(draft.analytics.personaDistribution).length /
      draft.personas.length,

    // Tree balance (how evenly distributed the tree is)
    treeBalance: calculateTreeBalance(nodes),
  };
}

/**
 * Generate optimization suggestions
 */
function generateOptimizationSuggestions(
  draft: any,
  performanceMetrics: any
): string[] {
  const suggestions: string[] = [];

  // Performance-based suggestions
  if (performanceMetrics.averageProcessingTime > 2000) {
    suggestions.push("Consider increasing batch size for better throughput");
  }

  if (performanceMetrics.successRate < 0.9) {
    suggestions.push("Investigate error patterns and improve retry logic");
  }

  if (performanceMetrics.batchEfficiency < 0.5) {
    suggestions.push("Optimize parallel processing or reduce batch size");
  }

  // Quality-based suggestions
  if (performanceMetrics.averageConfidence < 0.8) {
    suggestions.push("Review and improve AI prompt quality");
  }

  // Structure-based suggestions
  const maxDepthUtilization =
    draft.analytics.maxDepthReached / (draft.config.maxDepth - 1);
  if (maxDepthUtilization < 0.7) {
    suggestions.push("Increase conversation depth for richer insights");
  }

  const nodeUtilization =
    draft.analytics.totalNodes / draft.config.maxTotalNodes;
  if (nodeUtilization < 0.8) {
    suggestions.push("Consider expanding tree breadth for better coverage");
  }

  return suggestions;
}

// === Pipeline State Management ===

/**
 * Update pipeline state based on completion status
 */
function updatePipelineState(
  draft: any,
  completionStatus: CompletionStatus,
  ctx: any
): void {
  if (completionStatus.isComplete) {
    draft.pipeline.stage = "completed";
    draft.pipeline.isComplete = true;
    draft.pipeline.completedAt = new Date().toISOString();
    ctx.log.info("🎉 Conversation exploration completed!", {
      reason: completionStatus.reason,
      completionPercentage:
        completionStatus.completionPercentage.toFixed(1) + "%",
    });
  } else if (completionStatus.blockers.length > 0) {
    draft.pipeline.stage = "error";
    draft.pipeline.lastError = `Completion blocked: ${completionStatus.blockers.join(", ")}`;
    ctx.log.warn("⚠️ Completion blocked", {
      blockers: completionStatus.blockers,
      nextActions: completionStatus.nextActions,
    });
  } else {
    // Continue with next actions
    if (completionStatus.nextActions.includes("Process pending batches")) {
      draft.pipeline.stage = "processing_responses";
    } else if (
      completionStatus.nextActions.includes(
        "Generate more questions from expandable nodes"
      )
    ) {
      draft.pipeline.stage = "generating_questions";
    } else {
      draft.pipeline.stage = "expanding_tree";
    }
  }
}

/**
 * Update workflow stage
 */
function updateWorkflowStage(
  draft: any,
  completionStatus: CompletionStatus
): void {
  const currentPhases = ["setup", "exploration", "expansion", "completion"];
  const currentIndex = currentPhases.indexOf(draft.workflowStage.currentPhase);

  if (completionStatus.isComplete) {
    draft.workflowStage.currentPhase = "completion";
    if (!draft.workflowStage.phasesCompleted.includes("completion")) {
      (draft.workflowStage.phasesCompleted as any).push("completion");
    }
  } else {
    // Progress through phases based on completion percentage
    const targetPhaseIndex = Math.floor(
      completionStatus.completionPercentage / 25
    );
    const targetPhase =
      currentPhases[Math.min(targetPhaseIndex, currentPhases.length - 1)];

    if (targetPhase && targetPhase !== draft.workflowStage.currentPhase) {
      draft.workflowStage.currentPhase = targetPhase;
      if (
        targetPhase &&
        !draft.workflowStage.phasesCompleted.includes(targetPhase)
      ) {
        (draft.workflowStage.phasesCompleted as any).push(targetPhase);
      }
    }
  }

  // Estimate remaining time
  if (!completionStatus.isComplete && draft.analytics.averageResponseTime > 0) {
    const remainingNodes = Math.max(
      0,
      draft.config.maxTotalNodes - draft.analytics.totalNodes
    );
    const estimatedTimeMs =
      remainingNodes * draft.analytics.averageResponseTime;
    draft.workflowStage.estimatedTimeRemaining = estimatedTimeMs;
  }
}

/**
 * Log analytics update
 */
function logAnalyticsUpdate(draft: any, ctx: any): void {
  ctx.log.info("Analytics updated", {
    totalNodes: draft.analytics.totalNodes,
    completedNodes: draft.analytics.completedNodes,
    pendingNodes: draft.analytics.pendingNodes,
    completionRate: `${(draft.analytics.completionRate * 100).toFixed(1)}%`,
    maxDepth: draft.analytics.maxDepthReached,
    avgResponseTime: `${draft.analytics.averageResponseTime.toFixed(0)}ms`,
    queueStatus: {
      pending: draft.processingQueue.pendingBatches.length,
      active: draft.processingQueue.activeBatches.length,
      completed: draft.processingQueue.completedBatches.length,
    },
  });
}

// === Helper Functions ===

/**
 * Calculate depth distribution
 */
function calculateDepthDistribution(nodes: any[]): Record<number, number> {
  const distribution: Record<number, number> = {};
  nodes.forEach((node) => {
    distribution[node.depth] = (distribution[node.depth] || 0) + 1;
  });
  return distribution;
}

/**
 * Calculate tree balance metric
 */
function calculateTreeBalance(nodes: any[]): number {
  // Simplified balance calculation - could be more sophisticated
  const depthCounts = calculateDepthDistribution(nodes);
  const depths = Object.keys(depthCounts).map(Number);

  if (depths.length <= 1) return 1.0;

  const variance =
    depths.reduce((sum, depth, _, arr) => {
      const mean = arr.reduce((s, d) => s + depthCounts[d]!, 0) / arr.length;
      return sum + Math.pow(depthCounts[depth]! - mean, 2);
    }, 0) / depths.length;

  // Return balance score (lower variance = higher balance)
  return Math.max(0, 1 - variance / 100);
}
