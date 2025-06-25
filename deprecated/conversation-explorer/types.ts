// src/conversation-explorer-v2/types.ts
import { type BrandedState, type NonEmptyArray } from "../../src/lib/core";

export interface Persona {
  readonly id: string;
  readonly name: string;
  readonly personality: string;
  readonly background: string;
  readonly expertise: readonly string[];
}

export interface Message {
  readonly id: string;
  readonly parentId?: string;
  readonly depth: number;
  readonly content: string;
  readonly personaId: string;
  readonly response?: string;
  readonly isComplete: boolean;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface ExplorationConfig {
  readonly maxDepth: number;
  readonly maxMessages: number;
  readonly branchingFactor: number;
}

export type ConversationState = BrandedState<
  "conversation",
  {
    readonly personas: NonEmptyArray<Persona>;
    readonly messages: Message[];
    readonly config: ExplorationConfig;
    readonly pendingMessages: string[]; // IDs of messages to process
    readonly currentStage: "processing" | "generating" | "completed";
    readonly sessionId: string;
  }
>;

export interface AIService {
  generateResponse(
    message: string,
    persona: Persona
  ): Promise<{ text: string; tokenCount: number }>;
  generateQuestions(response: string, count: number): Promise<string[]>;
}
