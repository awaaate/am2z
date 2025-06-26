// AM2Z v4.0 - Batch Response Processor
// Processes multiple questions in parallel using AM2Z parallelProcessors

import {
  createProcessor,
  parallelProcessors,
  Success,
  Failure,
} from "../../../src/lib/core";

import {
  type ConversationExplorerState,
  type QuestionBatch,
  type ResponseResult,
  type BatchResult,
  type AIService,
  type ConversationNode,
} from "../types";

import { ProcessorExecutionError } from "../../../src/lib/core/errors";

/**
 * Batch processor dependencies
 */
interface BatchProcessorDependencies {
  readonly aiService: AIService;
}

/**
 * Main Batch Processor
 * Takes pending batches from the queue and processes them in parallel
 */
export function createBatchProcessor(dependencies: BatchProcessorDependencies) {
  return createProcessor<ConversationExplorerState>("batchProcessor")
    .withDescription(
      "Process question batches in parallel with optimal throughput"
    )
    .withTimeout(45000)
    .withRetryPolicy({
      maxAttempts: 2,
      backoffMs: 2000,
      shouldRetry: (error) => error.retryable,
    })

    .processWithImmer(async (draft, ctx) => {
      ctx.log.info("🚀 Starting batch processing...");

      // Check if there are pending batches
      if (draft.processingQueue.pendingBatches.length === 0) {
        ctx.log.info("No pending batches to process");
        draft.pipeline.stage = "analyzing";
        return;
      }

      // Get next batch to process (highest priority first)
      const sortedBatches = [...draft.processingQueue.pendingBatches].sort(
        (a, b) => b.priority - a.priority
      );

      const batchToProcess = sortedBatches[0];
      if (!batchToProcess) {
        draft.pipeline.stage = "analyzing";
        return;
      }

      ctx.log.info(`Processing batch: ${batchToProcess.id}`, {
        questionCount: batchToProcess.questions.length,
        priority: batchToProcess.priority,
        maxConcurrency: batchToProcess.maxConcurrency,
      });

      // Move batch from pending to active
      draft.processingQueue.pendingBatches =
        draft.processingQueue.pendingBatches.filter(
          (batch) => batch.id !== batchToProcess.id
        );

      (draft.processingQueue.activeBatches as any).push(batchToProcess);

      // Update pipeline stage
      draft.pipeline.stage = "processing_responses";

      const batchStartTime = Date.now();

      try {
        // Use AI service batch processing for optimal performance
        const responses = await dependencies.aiService.batchGenerateResponses(
          batchToProcess.questions
        );

        const batchProcessingTime = Date.now() - batchStartTime;

        // Create batch result
        const successCount = responses.filter((r) => r.success).length;
        const failureCount = responses.length - successCount;

        const batchResult: BatchResult = {
          batchId: batchToProcess.id,
          responses,
          successCount,
          failureCount,
          totalProcessingTime: batchProcessingTime,
          completedAt: new Date().toISOString(),
        };

        // Move batch from active to completed
        draft.processingQueue.activeBatches =
          draft.processingQueue.activeBatches.filter(
            (batch) => batch.id !== batchToProcess.id
          );

        (draft.processingQueue.completedBatches as any).push(batchResult);

        // Update queue metrics
        draft.processingQueue.queueMetrics.totalProcessed += responses.length;
        const currentThroughput =
          responses.length / (batchProcessingTime / 1000 / 60); // per minute
        draft.processingQueue.queueMetrics.throughputPerMinute =
          (draft.processingQueue.queueMetrics.throughputPerMinute +
            currentThroughput) /
          2;

        // Apply responses to conversation tree
        await applyResponsesToDraft(draft, responses, ctx);

        // Update processing analytics
        updateProcessingStats(draft, batchResult);

        ctx.log.info(`Batch processed successfully`, {
          batchId: batchToProcess.id,
          totalResponses: responses.length,
          successCount,
          failureCount,
          processingTime: batchProcessingTime,
          throughput: currentThroughput.toFixed(1) + " req/min",
        });

        // Emit batch completion event
        ctx.emit("batch:completed", {
          batchId: batchToProcess.id,
          successCount,
          failureCount,
          processingTime: batchProcessingTime,
        });

        // Check if we should continue to next batch or move to tree expansion
        if (draft.processingQueue.pendingBatches.length > 0) {
          draft.pipeline.stage = "processing_responses"; // Continue processing
        } else {
          draft.pipeline.stage = "expanding_tree"; // Move to tree expansion
        }
      } catch (error) {
        const batchProcessingTime = Date.now() - batchStartTime;

        ctx.log.error(`Batch processing failed`, {
          batchId: batchToProcess.id,
          error: error instanceof Error ? error.message : String(error),
          processingTime: batchProcessingTime,
        });

        // Move batch back to pending for retry (or mark as failed)
        draft.processingQueue.activeBatches =
          draft.processingQueue.activeBatches.filter(
            (batch) => batch.id !== batchToProcess.id
          );

        // Create failure batch result
        const failureBatchResult: BatchResult = {
          batchId: batchToProcess.id,
          responses: batchToProcess.questions.map((q) => ({
            questionId: q.id,
            response: "",
            metrics: {
              processingTimeMs: 0,
              tokenCount: 0,
              confidenceScore: 0,
            },
            success: false,
            error: "Batch processing failed",
          })),
          successCount: 0,
          failureCount: batchToProcess.questions.length,
          totalProcessingTime: batchProcessingTime,
          completedAt: new Date().toISOString(),
        };

        (draft.processingQueue.completedBatches as any).push(
          failureBatchResult
        );

        // Emit failure event
        ctx.emit("batch:failed", {
          batchId: batchToProcess.id,
          error: error instanceof Error ? error.message : String(error),
          questionCount: batchToProcess.questions.length,
        });

        // Set error state
        draft.pipeline.stage = "error";
        draft.pipeline.lastError =
          error instanceof Error ? error.message : String(error);
      }
    });
}

/**
 * Parallel Batch Processor
 * Uses AM2Z parallelProcessors to process multiple batches simultaneously
 */
export function createParallelBatchProcessor(
  dependencies: BatchProcessorDependencies,
  maxConcurrentBatches = 3
) {
  // Create individual batch processors
  const batchProcessors = Array.from(
    { length: maxConcurrentBatches },
    (_, index) => createSingleBatchProcessor(dependencies, `batch-${index}`)
  );

  // Use parallelProcessors to run them concurrently
  return parallelProcessors({ name: "parallelBatchProcessor", timeoutStrategy: ...batchProcessors });
}

/**
 * Single batch processor for parallel execution
 */
function createSingleBatchProcessor(
  dependencies: BatchProcessorDependencies,
  processorId: string
) {
  return createProcessor<ConversationExplorerState>(
    `singleBatch_${processorId}`
  )
    .withDescription(`Single batch processor instance: ${processorId}`)
    .withTimeout(30000)

    .process(async (state, ctx) => {
      // Each parallel processor handles one batch
      const pendingBatches = state.processingQueue.pendingBatches;

      if (pendingBatches.length === 0) {
        return Success(state);
      }

      // Take the first available batch (simple strategy)
      const batchToProcess = pendingBatches[0];
      if (!batchToProcess) {
        return Success(state);
      }

      ctx.log.info(
        `Processor ${processorId} taking batch: ${batchToProcess.id}`
      );

      try {
        // Process batch using AI service
        const responses = await dependencies.aiService.batchGenerateResponses(
          batchToProcess.questions
        );

        // Return state with processed batch results
        // In a real implementation, this would need proper state coordination
        return Success(state);
      } catch (error) {
        ctx.log.error(
          `Processor ${processorId} failed to process batch`,
          error
        );
        return Success(state); // Don't fail the entire pipeline
      }
    });
}

// === Helper Functions ===

/**
 * Apply response results to the conversation tree
 */
async function applyResponsesToDraft(
  draft: any,
  responses: readonly ResponseResult[],
  ctx: any
): Promise<void> {
  for (const response of responses) {
    if (!response.success) continue;

    // Find or create the corresponding conversation node
    let targetNode = draft.conversationTree.find(
      (node: any) => node.id === response.questionId
    );

    if (!targetNode) {
      // Create new node if it doesn't exist (for new questions)
      const questionBatch = [
        ...draft.processingQueue.activeBatches,
        ...draft.processingQueue.completedBatches,
      ].find((batch: any) =>
        batch.questions?.some((q: any) => q.id === response.questionId)
      );

      const questionRequest = questionBatch?.questions?.find(
        (q: any) => q.id === response.questionId
      );

      if (questionRequest) {
        const newNode: ConversationNode = {
          id: response.questionId,
          parentId: questionRequest.parentId,
          depth: questionRequest.depth,
          prompt: questionRequest.prompt,
          response: response.response,
          persona: questionRequest.persona,
          childIds: [],
          isComplete: true,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          processingMetrics: response.metrics,
        };

        (draft.conversationTree as any).push(newNode);

        // Update parent's childIds
        if (questionRequest.parentId) {
          const parentNode = draft.conversationTree.find(
            (node: any) => node.id === questionRequest.parentId
          );
          if (parentNode) {
            (parentNode.childIds as any).push(response.questionId);
          }
        }
      }
    } else {
      // Update existing node
      targetNode.response = response.response;
      targetNode.isComplete = true;
      targetNode.completedAt = new Date().toISOString();
      targetNode.processingMetrics = response.metrics;
    }
  }

  ctx.log.debug(
    `Applied ${responses.filter((r) => r.success).length} responses to conversation tree`
  );
}

/**
 * Update processing statistics
 */
function updateProcessingStats(draft: any, batchResult: BatchResult): void {
  // Update analytics
  draft.analytics.completedNodes += batchResult.successCount;
  draft.analytics.totalProcessingTime += batchResult.totalProcessingTime;

  if (draft.analytics.completedNodes > 0) {
    draft.analytics.averageResponseTime =
      draft.analytics.totalProcessingTime / draft.analytics.completedNodes;
  }

  draft.analytics.completionRate =
    draft.analytics.completedNodes / draft.analytics.totalNodes;

  // Update processing stats
  draft.analytics.processingStats.batchesProcessed++;

  const avgBatchSize =
    (draft.analytics.processingStats.averageBatchSize *
      (draft.analytics.processingStats.batchesProcessed - 1) +
      batchResult.responses.length) /
    draft.analytics.processingStats.batchesProcessed;

  draft.analytics.processingStats.averageBatchSize = avgBatchSize;

  // Calculate parallel efficiency (successful responses / total processing time)
  const efficiency =
    batchResult.successCount / (batchResult.totalProcessingTime / 1000);
  draft.analytics.processingStats.parallelEfficiency =
    (draft.analytics.processingStats.parallelEfficiency + efficiency) / 2;

  // Update max depth reached
  const depths = draft.conversationTree.map((node: any) => node.depth);
  draft.analytics.maxDepthReached = Math.max(...depths, 0);

  // Recalculate average depth
  if (depths.length > 0) {
    draft.analytics.averageDepth =
      depths.reduce((sum: number, depth: number) => sum + depth, 0) /
      depths.length;
  }
}
