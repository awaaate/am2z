// AM2Z v4.0 - Simplified AI Service
// Clean AI service focused on core operations

import { type AIService, type Persona } from '../types';

/**
 * Mock AI Service with realistic behavior
 */
export class MockAIService implements AIService {
  async generateResponse(prompt: string, persona: Persona): Promise<{
    text: string;
    tokenCount: number;
  }> {
    // Simulate processing time
    await this.delay(200 + Math.random() * 500);

    const response = this.createPersonalizedResponse(prompt, persona);
    
    return {
      text: response,
      tokenCount: 80 + Math.floor(Math.random() * 120),
    };
  }

  async generateFollowUpQuestions(
    parentResponse: string,
    persona: Persona,
    count: number
  ): Promise<string[]> {
    // Simulate processing time
    await this.delay(100 + Math.random() * 200);

    const templates = [
      "What concerns you most about this approach?",
      "How would you prioritize the different factors?",
      "What additional information would you need?",
      "How does this align with your experience?",
      "What would be your next step?",
      "What alternatives would you consider?",
    ];

    return Array.from({ length: count }, (_, i) => {
      const template = templates[i % templates.length] || templates[0] || 'What do you think?';
      return this.personalizeQuestion(template, persona);
    });
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private createPersonalizedResponse(prompt: string, persona: Persona): string {
    const interest = persona.interests[0] || 'general topics';
    const concern = persona.concerns[0] || 'potential issues';
    
    return `As someone interested in ${interest}, I think ${prompt.toLowerCase()} raises important considerations. From my perspective, ${persona.background}, I'm particularly focused on ${interest}. However, I'm concerned about ${concern}. This requires careful thought and consideration of multiple factors.`;
  }

  private personalizeQuestion(template: string, persona: Persona): string {
    const interest = persona.interests[0] || 'this topic';
    return `Given your interest in ${interest}, ${template.toLowerCase()}`;
  }
}

/**
 * Factory function
 */
export function createAIService(): AIService {
  return new MockAIService();
} 