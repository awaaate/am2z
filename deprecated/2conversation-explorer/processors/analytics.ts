// AM2Z v4.0 - Analytics Processor
// Updates conversation analytics and determines completion state

import { createProcessor } from "../../../src/lib/core";
import { type ConversationExplorerState } from "../types";

/**
 * Analytics Processor
 * Updates analytics metrics and determines system completion state
 */
export const analyticsProcessor = createProcessor<ConversationExplorerState>(
  "analytics"
)
  .withDescription("Update conversation analytics and check completion state")
  .withTimeout(5000)

  .processWithImmer((draft, ctx) => {
    ctx.log.info("📊 Updating analytics...");

    // Calculate basic metrics
    const allNodes = draft.nodes;
    const completedNodes = allNodes.filter((node) => node.isComplete);
    const pendingNodes = allNodes.filter((node) => !node.isComplete);

    // Update basic counts
    draft.analytics.totalNodes = allNodes.length;
    draft.analytics.completedNodes = completedNodes.length;

    // Calculate max depth reached
    const depths = allNodes.map((node) => node.depth);
    draft.analytics.maxDepthReached =
      depths.length > 0 ? Math.max(...depths) : 0;

    // Calculate average processing time
    const processingTimes = completedNodes
      .map((node) => node.metrics?.processingTimeMs || 0)
      .filter((time) => time > 0);

    if (processingTimes.length > 0) {
      draft.analytics.averageProcessingTime =
        processingTimes.reduce((sum, time) => sum + time, 0) /
        processingTimes.length;
    }

    // Determine completion state
    const isComplete = determineCompletion(draft);
    draft.analytics.isComplete = isComplete;

    // Update current stage based on state
    if (isComplete) {
      draft.currentStage = "completed";
    } else if (draft.pendingQuestions.length > 0) {
      draft.currentStage = "processing";
    } else if (canExpand(draft)) {
      draft.currentStage = "expanding";
    } else {
      draft.currentStage = "completed";
      draft.analytics.isComplete = true;
    }

    ctx.log.info("Analytics updated", {
      totalNodes: draft.analytics.totalNodes,
      completedNodes: draft.analytics.completedNodes,
      pendingQuestions: draft.pendingQuestions.length,
      maxDepth: draft.analytics.maxDepthReached,
      avgProcessingTime: `${draft.analytics.averageProcessingTime.toFixed(0)}ms`,
      currentStage: draft.currentStage,
      isComplete: draft.analytics.isComplete,
    });

    // Emit analytics update event
    ctx.emit("analytics:updated", {
      analytics: draft.analytics,
      currentStage: draft.currentStage,
      pendingCount: draft.pendingQuestions.length,
    });
  });

// === Helper Functions ===

/**
 * Determine if the conversation exploration is complete
 */
function determineCompletion(state: any): boolean {
  // No pending questions and no way to expand further
  if (state.pendingQuestions.length > 0) {
    return false;
  }

  // Check if we reached maximum limits
  if (state.nodes.length >= state.config.maxTotalNodes) {
    return true;
  }

  if (state.analytics.maxDepthReached >= state.config.maxDepth - 1) {
    return true;
  }

  // Check if there are expandable nodes
  return !canExpand(state);
}

/**
 * Check if the conversation tree can be expanded further
 */
function canExpand(state: any): boolean {
  // Check for completed nodes that can have children
  const expandableNodes = state.nodes.filter(
    (node: any) =>
      node.isComplete &&
      node.response &&
      node.depth < state.config.maxDepth - 1 &&
      !state.nodes.some((child: any) => child.parentId === node.id)
  );

  return (
    expandableNodes.length > 0 &&
    state.nodes.length < state.config.maxTotalNodes
  );
}
