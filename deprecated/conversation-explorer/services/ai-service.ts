// src/conversation-explorer-v2/services/ai-service.ts
import { type AIService, type Persona } from "../types";

export class SimpleAIService implements AIService {
  async generateResponse(
    message: string,
    persona: Persona
  ): Promise<{ text: string; tokenCount: number }> {
    // Simular tiempo de procesamiento
    await this.delay(300 + Math.random() * 700);

    const response = `As ${persona.name}, ${persona.personality.toLowerCase()}, I think ${message.toLowerCase()} is ${this.getRandomAdjective()}. From my background in ${persona.background}, I believe this ${this.getRandomInsight()}.`;

    return {
      text: response,
      tokenCount: 50 + Math.floor(Math.random() * 100),
    };
  }

  async generateQuestions(response: string, count: number): Promise<string[]> {
    await this.delay(200 + Math.random() * 300);

    const questionTemplates = [
      "What concerns you most about this approach?",
      "How would you implement this in practice?",
      "What evidence supports this view?",
      "What alternatives would you consider?",
      "How does this align with current trends?",
      "What potential risks do you see?",
    ];

    return Array.from(
      { length: count },
      (_, i) =>
        questionTemplates[i % questionTemplates.length] ||
        "What do you think about this?"
    );
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRandomAdjective(): string {
    const adjectives = [
      "interesting",
      "challenging",
      "important",
      "complex",
      "valuable",
      "concerning",
    ];
    return (
      adjectives[Math.floor(Math.random() * adjectives.length)] || "noteworthy"
    );
  }

  private getRandomInsight(): string {
    const insights = [
      "requires careful consideration",
      "has both benefits and drawbacks",
      "needs more research",
      "could be transformative",
      "presents unique opportunities",
      "deserves deeper analysis",
    ];
    return (
      insights[Math.floor(Math.random() * insights.length)] ||
      "is worth exploring"
    );
  }
}

export function createAIService(): AIService {
  return new SimpleAIService();
}
