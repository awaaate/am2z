// src/conversation-explorer-v2/processors/completion-handler.ts
import { createProcessor, Success } from "../../../src/lib/core";
import { type ConversationStateManager } from "../state/state-manager";
import { type ConversationState } from "../types";
import { type Message } from "../types";

export function createCompletionHandler(
  stateManager: ConversationStateManager
) {
  return createProcessor<ConversationState>("completion-handler")
    .withDescription("Handle exploration compl  etion")
    .withTimeout(5000)

    .process(async (state, ctx) => {
      const { sessionId } = state;
      ctx.log.info("🏁 Completing conversation exploration...", { sessionId });

      try {
        // Obtener estado final
        const finalState = (await stateManager.getState(
          sessionId
        )) as ConversationState;
        if (!finalState) {
          throw new Error(`Session ${sessionId} not found`);
        }

        // Actualizar a estado completado
        const completedState = await stateManager.updateState(
          sessionId,
          (state) => ({
            ...state,
            currentStage: "completed",
          })
        );

        // Calcular métricas finales
        const totalMessages = completedState.messages.length;
        const completedMessages = completedState.messages.filter(
          (m: Message) => m.isComplete
        ).length;
        const maxDepth = Math.max(
          ...completedState.messages.map((m: Message) => m.depth),
          0
        );

        ctx.log.info("📊 Final Results", {
          totalMessages,
          completedMessages,
          maxDepth,
          completionRate: `${((completedMessages / totalMessages) * 100).toFixed(1)}%`,
        });

        ctx.emit("exploration:completed", {
          sessionId,
          totalMessages,
          completedMessages,
          maxDepth,
        });

        return Success(completedState);
      } catch (error) {
        ctx.log.error("Completion handling failed:", error);
        throw error;
      }
    });
}
