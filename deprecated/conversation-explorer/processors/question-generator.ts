// src/conversation-explorer-v2/processors/question-generator.ts
import { createProcessor, Success, Failure } from "../../../src/lib/core";
import { type ConversationState, type AIService, type Message } from "../types";
import { type ConversationStateManager } from "../state/state-manager";
import { ProcessorExecutionError } from "../../../src/lib/core/errors";

export function createQuestionGenerator(
  aiService: AIService,
  stateManager: ConversationStateManager
) {
  return createProcessor<ConversationState>("question-generator")
    .withDescription("Generate follow-up questions from completed messages")
    .withTimeout(10000)

    .process(async (state, ctx) => {
      const { sessionId } = state;
      ctx.log.info("🔍 Generating follow-up questions...", { sessionId });

      try {
        // Obtener estado actual
        const currentState = (await stateManager.getState(
          sessionId
        )) as ConversationState;
        if (!currentState) {
          throw new Error(`Session ${sessionId} not found`);
        }

        // Verificar límites
        if (currentState.messages.length >= currentState.config.maxMessages) {
          ctx.log.info("Max messages reached, completing exploration");

          const result = await ctx.call("completion-handler", state);
          return result.success ? Success(result.data) : Failure(result.error);
        }

        // Encontrar mensajes expandibles
        const expandableMessages = currentState.messages.filter(
          (m: Message) =>
            m.isComplete &&
            m.response &&
            m.depth < currentState.config.maxDepth - 1 &&
            !currentState.messages.some(
              (child: Message) => child.parentId === m.id
            )
        );

        if (expandableMessages.length === 0) {
          ctx.log.info("No expandable messages, completing exploration");

          const result = await ctx.call("completion-handler", state);
          return result.success ? Success(result.data) : Failure(result.error);
        }

        // Generar preguntas para los primeros mensajes expandibles
        const messagesToExpand = expandableMessages.slice(0, 2);
        const newMessages: Message[] = [];
        const newPendingMessages: string[] = [];

        for (const parentMessage of messagesToExpand) {
          if (!parentMessage.response) continue;

          const questions = await aiService.generateQuestions(
            parentMessage.response,
            Math.min(
              currentState.config.branchingFactor,
              currentState.config.maxMessages - currentState.messages.length
            )
          );

          for (let i = 0; i < questions.length; i++) {
            const question = questions[i];
            if (!question) continue;

            const persona =
              currentState.personas[i % currentState.personas.length];
            if (!persona) continue;

            const messageId = `${parentMessage.id}_q${i}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

            const newMessage: Message = {
              id: messageId,
              parentId: parentMessage.id,
              depth: parentMessage.depth + 1,
              content: question,
              personaId: persona.id,
              isComplete: false,
              createdAt: new Date().toISOString(),
            };

            newMessages.push(newMessage);
            newPendingMessages.push(messageId);
          }
        }

        if (newMessages.length === 0) {
          const result = await ctx.call("completion-handler", state);
          return result.success ? Success(result.data) : Failure(result.error);
        }

        // Actualizar estado atómicamente
        await stateManager.updateState(sessionId, (state) => ({
          ...state,
          messages: [...state.messages, ...newMessages],
          pendingMessages: [...state.pendingMessages, ...newPendingMessages],
          currentStage: "processing",
        }));

        ctx.log.info(`✅ Generated ${newMessages.length} follow-up questions`);

        ctx.emit("questions:generated", {
          parentMessageIds: messagesToExpand.map((m) => m.id),
          newMessageIds: newMessages.map((m) => m.id),
          count: newMessages.length,
        });

        // Continuar procesando
        const result = await ctx.call("answer-processor", state);
        return result.success ? Success(result.data) : Failure(result.error);
      } catch (error) {
        ctx.log.error("Question generation failed:", error);

        return Failure(
          new ProcessorExecutionError(
            "question-generator",
            ctx.meta.executionId,
            error instanceof Error ? error : new Error(String(error))
          )
        );
      }
    });
}
