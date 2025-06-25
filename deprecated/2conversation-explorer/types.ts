// AM2Z v4.0 - Conversation Explorer Types (Simplified)
// Simplified domain types optimized for AM2Z architecture

import { type BrandedState, type NonEmptyArray } from "../../src/lib/core";

// === Core Domain Types ===

export interface Persona {
  readonly id: string;
  readonly name: string;
  readonly background: string;
  readonly interests: readonly string[];
  readonly concerns: readonly string[];
}

export interface ConversationNode {
  readonly id: string;
  readonly parentId?: string;
  readonly depth: number;
  readonly prompt: string;
  readonly response?: string;
  readonly persona: Persona;
  readonly isComplete: boolean;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly metrics?: {
    readonly processingTimeMs: number;
    readonly tokenCount: number;
  };
}

export interface ExplorationConfig {
  readonly maxDepth: number;
  readonly maxTotalNodes: number;
  readonly branchingFactor: number;
  readonly batchSize: number;
}

// === Simplified State ===

export type ConversationExplorerState = BrandedState<
  "conversation-explorer",
  {
    readonly config: ExplorationConfig;
    readonly personas: NonEmptyArray<Persona>;
    readonly nodes: ConversationNode[];
    readonly pendingQuestions: QuestionTask[];
    readonly analytics: {
      readonly totalNodes: number;
      readonly completedNodes: number;
      readonly maxDepthReached: number;
      readonly averageProcessingTime: number;
      readonly isComplete: boolean;
    };
    readonly currentStage: "setup" | "processing" | "expanding" | "completed";
  }
>;

// === Task Types for Processing ===

export interface QuestionTask {
  readonly id: string;
  readonly prompt: string;
  readonly persona: Persona;
  readonly parentId?: string;
  readonly depth: number;
}

export interface ResponseTask {
  readonly questionId: string;
  readonly response: string;
  readonly processingTimeMs: number;
  readonly tokenCount: number;
}

// === AI Service Interface (Simplified) ===

export interface AIService {
  generateResponse(
    prompt: string,
    persona: Persona
  ): Promise<{
    text: string;
    tokenCount: number;
  }>;

  generateFollowUpQuestions(
    parentResponse: string,
    persona: Persona,
    count: number
  ): Promise<string[]>;
}
