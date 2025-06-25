// AM2Z v4.0 - AI Service for Conversation Explorer
// Mock AI service with batch processing and parallelism capabilities

import {
  type AIService,
  type AIServiceResponse,
  type Persona,
  type ConversationNode,
  type QuestionRequest,
  type ResponseResult,
  type ProcessingMetrics,
} from "../types";
import { type NonEmptyArray } from "../../../src/lib/core";

/**
 * Mock AI Service implementing batch processing and parallel execution
 * In production, this would connect to actual AI APIs
 */
export class MockAIService implements AIService {
  private readonly baseProcessingTime: number;
  private readonly varianceMs: number;

  constructor(baseProcessingTime = 300, varianceMs = 400) {
    this.baseProcessingTime = baseProcessingTime;
    this.varianceMs = varianceMs;
  }

  /**
   * Generate a single response for a prompt and persona
   */
  async generateResponse(
    prompt: string,
    persona: Persona,
    context?: { parentResponse?: string }
  ): Promise<AIServiceResponse> {
    // Simulate realistic AI processing time
    const processingTime =
      this.baseProcessingTime + Math.random() * this.varianceMs;
    await this.simulateProcessingDelay(processingTime);

    // Generate contextual response based on persona
    const response = this.generateContextualResponse(prompt, persona, context);

    return {
      text: response,
      tokenCount: 120 + Math.floor(Math.random() * 80),
      confidenceScore: 0.7 + Math.random() * 0.3,
    };
  }

  /**
   * Generate follow-up questions based on a conversation node
   */
  async generateFollowUpQuestions(
    parentNode: ConversationNode,
    personas: NonEmptyArray<Persona>,
    count: number
  ): Promise<Array<{ prompt: string; persona: Persona }>> {
    // Simulate processing time - typically faster than response generation
    await this.simulateProcessingDelay(150 + Math.random() * 200);

    const baseQuestions = [
      "What factors would influence your decision the most?",
      "How do you typically research options in this area?",
      "What would make you confident in this choice?",
      "Are there any deal-breakers you'd want to avoid?",
      "How important is expert opinion versus peer reviews?",
      "What's your timeline for making this decision?",
      "How would you measure success with this choice?",
      "What alternatives are you also considering?",
      "What questions would you ask an expert?",
      "How would this impact your daily routine?",
      "What past experiences inform your thinking here?",
      "How does your budget factor into this decision?",
      "What would your ideal outcome look like?",
      "How do you balance innovation with proven reliability?",
      "What role does sustainability play in your choice?",
    ];

    // Generate personalized questions
    return Array.from({ length: count }, (_, i) => {
      const persona = personas[i % personas.length];
      const baseQuestion = baseQuestions[i % baseQuestions.length];

      if (!persona || !baseQuestion) {
        throw new Error(
          `Missing data: persona=${!!persona}, question=${!!baseQuestion}`
        );
      }

      // Personalize based on persona characteristics
      const personalizedPrompt = this.personalizeQuestion(
        baseQuestion,
        persona,
        parentNode
      );

      return {
        prompt: personalizedPrompt,
        persona,
      };
    });
  }

  /**
   * Batch process multiple response requests in parallel
   * Optimized for throughput with configurable concurrency
   */
  async batchGenerateResponses(
    requests: readonly QuestionRequest[]
  ): Promise<readonly ResponseResult[]> {
    if (requests.length === 0) {
      return [];
    }

    // Configure concurrency based on batch size
    const maxConcurrency = Math.min(
      10,
      Math.max(3, Math.floor(requests.length / 2))
    );

    // Process in batches for memory efficiency
    const results: ResponseResult[] = [];
    const batchStartTime = Date.now();

    for (let i = 0; i < requests.length; i += maxConcurrency) {
      const batch = requests.slice(i, i + maxConcurrency);

      // Process batch concurrently
      const batchPromises = batch.map(
        async (request): Promise<ResponseResult> => {
          const startTime = Date.now();

          try {
            const response = await this.generateResponse(
              request.prompt,
              request.persona,
              request.context
            );

            const processingTime = Date.now() - startTime;

            return {
              questionId: request.id,
              response: response.text,
              metrics: {
                processingTimeMs: processingTime,
                tokenCount: response.tokenCount,
                confidenceScore: response.confidenceScore,
              },
              success: true,
            };
          } catch (error) {
            return {
              questionId: request.id,
              response: "",
              metrics: {
                processingTimeMs: Date.now() - startTime,
                tokenCount: 0,
                confidenceScore: 0,
              },
              success: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add small delay between batches to simulate rate limiting
      if (i + maxConcurrency < requests.length) {
        await this.simulateProcessingDelay(50);
      }
    }

    const totalTime = Date.now() - batchStartTime;
    console.log(
      `Batch completed: ${requests.length} requests in ${totalTime}ms (${(requests.length / (totalTime / 1000)).toFixed(1)} req/s)`
    );

    return results;
  }

  // === Private Methods ===

  private async simulateProcessingDelay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private generateContextualResponse(
    prompt: string,
    persona: Persona,
    context?: { parentResponse?: string }
  ): string {
    const templates = [
      `As a ${persona.demographics.age}-year-old ${persona.demographics.occupation.toLowerCase()} in ${persona.demographics.location}, I find this really interesting. ${prompt} makes me think about ${persona.motivations[0] || "my priorities"}. However, I'm a bit concerned about ${persona.concerns[0] || "potential issues"}.`,

      `Given my focus on ${persona.preferences.primaryInterest.toLowerCase()} and being ${persona.demographics.familyStatus.toLowerCase()}, I'd approach this by considering ${persona.motivations.slice(0, 2).join(" and ")}. What specifically appeals to me is how this might address my concern about ${persona.concerns[0]?.toLowerCase() || "uncertainties"}.`,

      `From my perspective with a priority level of ${persona.preferences.priorityLevel}/10 for this type of decision, ${prompt} resonates because it aligns with my goal of ${persona.motivations[0] || "finding the best solution"}. Though I do wonder about ${persona.concerns[Math.floor(Math.random() * persona.concerns.length)] || "potential challenges"}.`,

      `As someone who values ${persona.preferences.primaryInterest.toLowerCase()} (priority: ${persona.preferences.priorityLevel}/10), this question touches on something important to me. My experience as a ${persona.demographics.occupation.toLowerCase()} in ${persona.demographics.location} has taught me to consider ${persona.motivations[0] || "practical implications"}. I'm particularly mindful of ${persona.concerns[0]?.toLowerCase() || "potential risks"}.`,

      `Thinking about this as a ${persona.demographics.familyStatus.toLowerCase()} ${persona.demographics.occupation.toLowerCase()}, I need to balance ${persona.motivations.slice(0, 2).join(" with ")}. Given my budget sensitivity (${persona.preferences.budgetSensitivity}/10) and technology adoption rate (${persona.preferences.technologyAdoption}/10), I'd want to explore how this addresses my main concern: ${persona.concerns[0]?.toLowerCase() || "making the right choice"}.`,
    ];

    let selectedTemplate =
      templates[Math.floor(Math.random() * templates.length)] ||
      templates[0] ||
      "";

    // Add context if available
    if (context?.parentResponse) {
      const contextualAddition = ` Building on the previous point about "${context.parentResponse.substring(0, 50)}...", I think this connects to my perspective because it highlights the importance of ${persona.motivations[Math.floor(Math.random() * persona.motivations.length)] || "careful consideration"}.`;
      selectedTemplate += contextualAddition;
    }

    return selectedTemplate;
  }

  private personalizeQuestion(
    baseQuestion: string,
    persona: Persona,
    parentNode: ConversationNode
  ): string {
    const personalizations = [
      `Given your background as a ${persona.demographics.occupation.toLowerCase()} in ${persona.demographics.location}, ${baseQuestion.toLowerCase()}`,

      `As someone who prioritizes ${persona.preferences.primaryInterest.toLowerCase()} and has a ${persona.preferences.priorityLevel}/10 priority level for these decisions, ${baseQuestion.toLowerCase()}`,

      `Considering your ${persona.demographics.familyStatus.toLowerCase()} situation and ${persona.preferences.budgetSensitivity}/10 budget sensitivity, ${baseQuestion.toLowerCase()}`,

      `With your technology adoption level of ${persona.preferences.technologyAdoption}/10 and focus on ${persona.motivations[0]?.toLowerCase() || "your main goals"}, ${baseQuestion.toLowerCase()}`,

      `Thinking about your concern regarding ${persona.concerns[0]?.toLowerCase() || "potential challenges"} and motivation to ${persona.motivations[0]?.toLowerCase() || "achieve your goals"}, ${baseQuestion.toLowerCase()}`,
    ];

    return (
      personalizations[Math.floor(Math.random() * personalizations.length)] ||
      baseQuestion
    );
  }
}

/**
 * Factory function to create AI service instance
 */
export function createAIService(
  baseProcessingTime = 300,
  varianceMs = 400
): AIService {
  return new MockAIService(baseProcessingTime, varianceMs);
}
