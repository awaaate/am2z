// src/conversation-explorer-v2/simple-explorer.ts
import { createDistributedRuntime } from "../../src/lib/node/distributed-runtime";
import {
  createLogger,
  createColoredFormatter,
  createAppState,
  createNonEmptyArray,
} from "../../src/lib/core";
import {
  type ConversationState,
  type Persona,
  type ExplorationConfig,
} from "./types";
import { ConversationStateManager } from "./state/state-manager";
import { createAIService } from "./services/ai-service";
import { createAnswerProcessor } from "./processors/answer-processor";
import { createQuestionGenerator } from "./processors/question-generator";
import { createCompletionHandler } from "./processors/completion-handler";

export class SimpleConversationExplorer {
  private readonly runtime;
  private readonly stateManager;
  private readonly aiService;
  private readonly logger;

  constructor(config: {
    redis: { host: string; port: number };
    concurrency?: number;
  }) {
    this.logger = createLogger(
      { component: "SimpleConversationExplorer" },
      "info",
      createColoredFormatter()
    );

    this.stateManager = new ConversationStateManager(config.redis, this.logger);
    this.aiService = createAIService();

    this.runtime = createDistributedRuntime(
      {
        queuePrefix: "conversation-explorer",
        redis: config.redis,
        worker: { concurrency: config.concurrency || 3 },
      },
      this.logger
    );

    this.setupProcessors();
  }

  private setupProcessors(): void {
    // Pasar state manager a todos los processors
    this.runtime.register(
      createAnswerProcessor(this.aiService, this.stateManager)
    );
    this.runtime.register(
      createQuestionGenerator(this.aiService, this.stateManager)
    );
    this.runtime.register(createCompletionHandler(this.stateManager));

    this.logger.info(
      "✅ All processors registered with centralized state management"
    );
  }

  getQueues() {
    return this.runtime.getQueues();
  }

  async start(): Promise<void> {
    await this.runtime.start();
    this.logger.info("✅ Simple Conversation Explorer started");
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
    await this.stateManager.close();
    this.logger.info("✅ Simple Conversation Explorer stopped");
  }

  async exploreConversation(
    initialMessages: string[],
    agents: Persona[],
    config: ExplorationConfig
  ): Promise<ConversationState> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    this.logger.info("🚀 Starting conversation exploration", {
      sessionId,
      messageCount: initialMessages.length,
      agentCount: agents.length,
      config,
    });

    // Crear estado inicial en el store centralizado
    const initialState = this.createInitialState(
      sessionId,
      initialMessages,
      agents,
      config
    );
    await this.stateManager.createState(sessionId, initialState);

    // Ejecutar orchestrador - solo pasa sessionId, no estado
    const result = await this.runtime.execute(
      "answer-processor",
      initialState,
      sessionId
    );

    if (!result.success) {
      throw result.error;
    }

    // Obtener estado final del store
    const finalState = await this.stateManager.getState(sessionId);
    if (!finalState) {
      throw new Error("Failed to retrieve final state");
    }

    this.logger.info("✅ Conversation exploration completed");
    return finalState;
  }

  private createInitialState(
    sessionId: string,
    initialMessages: string[],
    agents: Persona[],
    config: ExplorationConfig
  ): ConversationState {
    // ... mismo código de antes para crear estado inicial
    const messages = initialMessages.map((content, index) => ({
      id: `initial_${index}_${Date.now()}`,
      depth: 0,
      content,
      personaId: agents[index % agents.length]!.id,
      isComplete: false,
      createdAt: new Date().toISOString(),
    }));

    const pendingMessages = messages.map((m) => m.id);

    const baseState = createAppState(sessionId, {
      __brand: "conversation" as const,
      personas: createNonEmptyArray(agents),
      messages,
      config,
      pendingMessages,
      currentStage: "processing" as const,
    });

    return baseState as ConversationState;
  }

  async getSessionState(sessionId: string): Promise<ConversationState | null> {
    return this.stateManager.getState(sessionId);
  }
}
