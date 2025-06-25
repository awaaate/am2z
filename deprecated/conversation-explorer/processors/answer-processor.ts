// src/conversation-explorer-v2/processors/answer-processor.ts
import { createProcessor, Success, Failure } from "../../../src/lib/core";
import { type ConversationState, type AIService, type Message } from "../types";
import { type ConversationStateManager } from "../state/state-manager";
import { ProcessorExecutionError } from "../../../src/lib/core/errors";

export function createAnswerProcessor(
  aiService: AIService,
  stateManager: ConversationStateManager
) {
  return createProcessor<ConversationState>("answer-processor")
    .withDescription("Generate AI responses for messages")
    .withTimeout(15000)
    .withRetryPolicy({
      maxAttempts: 3,
      backoffMs: 1000,
    })

    .process(async (state, ctx) => {
      const { sessionId } = ctx.meta;
      ctx.log.info("🤖 Processing message responses...", {
        sessionId: sessionId || "no session id",
      });

      try {
        // Obtener estado actual del store centralizado
        const currentState = (await stateManager.getState(
          sessionId
        )) as ConversationState;
        if (!currentState) {
          throw new Error(`Session ${sessionId} not found`);
        }

        if (currentState.pendingMessages.length === 0) {
          ctx.log.info("No pending messages, calling question generator");

          // Llamar al siguiente processor sin pasar estado
          const result = await ctx.call("question-generator", state);
          return result.success ? Success(result.data) : Failure(result.error);
        }

        // Procesar primer mensaje pendiente
        const messageId = currentState.pendingMessages[0]!;
        const message = currentState.messages.find((m) => m.id === messageId);

        if (!message) {
          // Actualizar estado removiendo mensaje inválido
          await stateManager.updateState(sessionId, (state) => ({
            ...state,
            pendingMessages: state.pendingMessages.slice(1),
          }));

          // Continuar procesando
          const result = await ctx.call("answer-processor", state);
          return result.success ? Success(result.data) : Failure(result.error);
        }

        const persona = currentState.personas.find(
          (p) => p.id === message.personaId
        );
        if (!persona) {
          throw new Error(`Persona not found: ${message.personaId}`);
        }

        ctx.log.info(`Generating response for message: ${messageId}`, {
          persona: persona.name,
          contentPreview: message.content.substring(0, 50) + "...",
        });

        // Generar respuesta AI
        const response = await aiService.generateResponse(
          message.content,
          persona
        );

        // Actualizar estado atómicamente
        const updatedState = await stateManager.updateState(
          sessionId,
          (state) => {
            const updatedMessages = state.messages.map((m: Message) =>
              m.id === messageId
                ? {
                    ...m,
                    response: response.text,
                    isComplete: true,
                    completedAt: new Date().toISOString(),
                  }
                : m
            );

            return {
              ...state,
              messages: updatedMessages,
              pendingMessages: state.pendingMessages.slice(1),
            };
          }
        );

        ctx.log.info(`✅ Response generated for ${messageId}`, {
          tokenCount: response.tokenCount,
        });

        ctx.emit("message:completed", {
          messageId,
          personaId: message.personaId,
          tokenCount: response.tokenCount,
        });

        // Decidir siguiente paso basado en estado actualizado
        if (updatedState.pendingMessages.length > 0) {
          // Continuar procesando mensajes
          const result = await ctx.call("answer-processor", updatedState);
          return result.success ? Success(result.data) : Failure(result.error);
        } else {
          // Ir a generar preguntas
          const result = await ctx.call("question-generator", updatedState);
          return result.success ? Success(result.data) : Failure(result.error);
        }
      } catch (error) {
        ctx.log.error("Answer processing failed:", error);

        return Failure(
          new ProcessorExecutionError(
            "answer-processor",
            ctx.meta.executionId,
            error instanceof Error ? error : new Error(String(error))
          )
        );
      }
    });
}
