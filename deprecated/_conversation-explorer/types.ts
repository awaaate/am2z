// AM2Z v4.0 - Conversation Explorer Types
// Domain types for modular conversation exploration system

import { type BrandedState, type NonEmptyArray } from "../../src/lib/core";

// === Core Domain Types ===

export interface Persona {
  readonly id: string;
  readonly name: string;
  readonly demographics: {
    readonly age: number;
    readonly occupation: string;
    readonly location: string;
    readonly familyStatus: string;
  };
  readonly preferences: {
    readonly primaryInterest: string;
    readonly priorityLevel: number; // 1-10
    readonly budgetSensitivity: number; // 1-10
    readonly technologyAdoption: number; // 1-10
  };
  readonly motivations: readonly string[];
  readonly concerns: readonly string[];
}

export interface ConversationNode {
  readonly id: string;
  readonly parentId?: string;
  readonly depth: number;
  readonly prompt: string;
  readonly response?: string;
  readonly persona: Persona;
  readonly childIds: readonly string[];
  readonly isComplete: boolean;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly processingMetrics?: ProcessingMetrics;
}

export interface ProcessingMetrics {
  readonly processingTimeMs: number;
  readonly tokenCount: number;
  readonly confidenceScore: number;
}

export interface ConversationTreeConfig {
  readonly maxDepth: number;
  readonly maxNodesPerLevel: number;
  readonly maxTotalNodes: number;
  readonly branchingFactor: number;
  readonly responseTimeout: number;
  readonly batchSize: number; // For parallel processing
}

export interface ConversationAnalytics {
  readonly totalNodes: number;
  readonly completedNodes: number;
  readonly pendingNodes: number;
  readonly averageDepth: number;
  readonly maxDepthReached: number;
  readonly totalProcessingTime: number;
  readonly averageResponseTime: number;
  readonly completionRate: number;
  readonly personaDistribution: Record<string, number>;
  readonly processingStats: {
    readonly batchesProcessed: number;
    readonly averageBatchSize: number;
    readonly parallelEfficiency: number;
  };
}

// === Processing Types ===

export interface QuestionRequest {
  readonly id: string;
  readonly prompt: string;
  readonly persona: Persona;
  readonly parentId?: string;
  readonly depth: number;
  readonly context?: {
    readonly parentResponse?: string;
    readonly conversationHistory?: string[];
  };
}

export interface ResponseResult {
  readonly questionId: string;
  readonly response: string;
  readonly metrics: ProcessingMetrics;
  readonly success: boolean;
  readonly error?: string;
}

export interface QuestionBatch {
  readonly id: string;
  readonly questions: readonly QuestionRequest[];
  readonly priority: number;
  readonly createdAt: string;
  readonly maxConcurrency?: number;
}

export interface BatchResult {
  readonly batchId: string;
  readonly responses: readonly ResponseResult[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly totalProcessingTime: number;
  readonly completedAt: string;
}

// === Pipeline State Types ===

export interface PipelineStage {
  readonly stage:
    | "initializing"
    | "generating_questions"
    | "processing_responses"
    | "expanding_tree"
    | "analyzing"
    | "completed"
    | "error";
  readonly currentDepth: number;
  readonly isComplete: boolean;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly iterationCount: number;
  readonly lastError?: string;
}

export interface ProcessingQueue {
  readonly pendingBatches: readonly QuestionBatch[];
  readonly activeBatches: readonly QuestionBatch[];
  readonly completedBatches: readonly BatchResult[];
  readonly queueMetrics: {
    readonly totalQueued: number;
    readonly totalProcessed: number;
    readonly averageWaitTime: number;
    readonly throughputPerMinute: number;
  };
}

// === Main State Type ===

export type ConversationExplorerState = BrandedState<
  "conversation-explorer",
  {
    readonly config: ConversationTreeConfig;
    readonly personas: NonEmptyArray<Persona>;
    readonly conversationTree: ConversationNode[];
    readonly analytics: ConversationAnalytics;
    readonly pipeline: PipelineStage;
    readonly processingQueue: ProcessingQueue;
    readonly workflowStage: WorkflowStage;
  }
>;

export interface WorkflowStage {
  readonly currentPhase: "setup" | "exploration" | "expansion" | "completion";
  readonly phasesCompleted: readonly string[];
  readonly totalPhases: number;
  readonly estimatedTimeRemaining?: number;
}

// === Event Types ===

export interface ConversationEvent {
  readonly type:
    | "node_completed"
    | "batch_processed"
    | "tree_expanded"
    | "analysis_updated";
  readonly timestamp: string;
  readonly data: unknown;
}

// === AI Service Interface ===

export interface AIServiceResponse {
  readonly text: string;
  readonly tokenCount: number;
  readonly confidenceScore: number;
}

export interface AIService {
  generateResponse(
    prompt: string,
    persona: Persona,
    context?: { parentResponse?: string }
  ): Promise<AIServiceResponse>;

  generateFollowUpQuestions(
    parentNode: ConversationNode,
    personas: NonEmptyArray<Persona>,
    count: number
  ): Promise<Array<{ prompt: string; persona: Persona }>>;

  batchGenerateResponses(
    requests: readonly QuestionRequest[]
  ): Promise<readonly ResponseResult[]>;
}
