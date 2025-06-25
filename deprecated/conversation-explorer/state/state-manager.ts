// src/conversation-explorer-v2/state/state-manager.ts
import Redis from "ioredis";
import { createLogger, type Logger } from "../../../src/lib/core";
import { type ConversationState } from "../types";

export class ConversationStateManager {
  private redis: Redis;

  constructor(
    redisConfig: { host: string; port: number },
    private readonly logger: Logger = createLogger({
      component: "StateManager",
    })
  ) {
    this.redis = new Redis(redisConfig);
  }

  /**
   * Obtener el estado más actual
   */
  async getState(sessionId: string): Promise<ConversationState | null> {
    try {
      const stateJson = await this.redis.get(`conversation:${sessionId}`);
      if (!stateJson) return null;

      return JSON.parse(stateJson) as ConversationState;
    } catch (error) {
      this.logger.error(`Failed to get state for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Actualizar estado con optimistic locking
   */
  async updateState(
    sessionId: string,
    updater: (current: ConversationState) => ConversationState,
    maxRetries: number = 3
  ): Promise<ConversationState> {
    let retries = 0;

    while (retries < maxRetries) {
      try {
        // Usar transacción con WATCH para optimistic locking
        await this.redis.watch(`conversation:${sessionId}`);

        const currentStateJson = await this.redis.get(
          `conversation:${sessionId}`
        );
        if (!currentStateJson) {
          throw new Error(`Session ${sessionId} not found`);
        }

        const currentState = JSON.parse(currentStateJson) as ConversationState;
        const newState = updater(currentState);

        // Actualizar versión del estado
        const updatedState = {
          ...newState,
          metadata: {
            ...newState.metadata,
            version: newState.metadata.version + 1,
            lastUpdated: new Date().toISOString(),
          },
        };

        // Transacción atómica
        const multi = this.redis.multi();
        multi.set(`conversation:${sessionId}`, JSON.stringify(updatedState));
        const result = await multi.exec();

        if (result === null) {
          // Transacción falló (otro proceso modificó el estado)
          retries++;
          this.logger.warn(
            `State update conflict for session ${sessionId}, retry ${retries}/${maxRetries}`
          );
          await this.delay(100 * retries); // Backoff exponencial
          continue;
        }

        this.logger.debug(`State updated for session ${sessionId}`, {
          version: updatedState.metadata.version,
          retries,
        });

        return updatedState;
      } catch (error) {
        this.logger.error(
          `Failed to update state for session ${sessionId}:`,
          error
        );
        throw error;
      }
    }

    throw new Error(`Failed to update state after ${maxRetries} retries`);
  }

  /**
   * Crear nuevo estado inicial
   */
  async createState(
    sessionId: string,
    initialState: ConversationState
  ): Promise<void> {
    try {
      await this.redis.set(
        `conversation:${sessionId}`,
        JSON.stringify(initialState)
      );
      await this.redis.expire(`conversation:${sessionId}`, 24 * 60 * 60); // 24 horas TTL

      this.logger.info(`Created new state for session ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to create state for session ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Eliminar estado
   */
  async deleteState(sessionId: string): Promise<void> {
    try {
      await this.redis.del(`conversation:${sessionId}`);
      this.logger.info(`Deleted state for session ${sessionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to delete state for session ${sessionId}:`,
        error
      );
      throw error;
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close(): Promise<void> {
    await this.redis.disconnect();
  }
}
