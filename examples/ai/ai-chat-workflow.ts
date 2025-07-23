import {
  createProcessor,
  chainProcessors,
  routeProcessor,
  Success,
  Failure,
  ValidationError,
  ProcessorExecutionError,
  createAppState,
  LocalRuntime,
} from "am2z";
import type { AppState } from "am2z";
import { openai } from "@ai-sdk/openai";
import { generateText, generateObject } from "ai";
import { z } from "zod";

// Chat State Management
interface ChatState extends AppState {
  // Conversation context
  conversationId: string;
  userId: string;
  messages: ChatMessage[];

  // Current interaction
  currentUserMessage?: string;
  currentAssistantResponse?: string;

  // Conversation metadata
  intent?: ConversationIntent;
  context?: {
    topic?: string;
    sentiment?: "positive" | "negative" | "neutral";
    language?: string;
    needsHumanHandoff?: boolean;
  };

  // Knowledge base results
  relevantDocuments?: Document[];

  // Action results
  actionRequired?: {
    type: string;
    parameters: any;
    result?: any;
  };

  // Conversation summary
  summary?: string;

  // Analytics
  metrics?: {
    responseTime: number;
    tokensUsed: number;
    satisfactionScore?: number;
  };
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: {
    intent?: string;
    confidence?: number;
    actionTaken?: string;
  };
}

interface Document {
  id: string;
  title: string;
  content: string;
  relevanceScore: number;
  source: string;
}

type ConversationIntent =
  | "greeting"
  | "question"
  | "complaint"
  | "support"
  | "purchase"
  | "feedback"
  | "goodbye"
  | "unknown";

// Intent Classification Schema
const IntentClassificationSchema = z.object({
  intent: z.enum([
    "greeting",
    "question",
    "complaint",
    "support",
    "purchase",
    "feedback",
    "goodbye",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  topic: z.string().optional(),
  sentiment: z.enum(["positive", "negative", "neutral"]),
  language: z.string(),
  requiresAction: z.boolean(),
  suggestedAction: z.string().optional(),
});

// Response Generation Schema
const ResponseGenerationSchema = z.object({
  response: z.string(),
  followUpQuestions: z.array(z.string()).optional(),
  suggestedActions: z
    .array(
      z.object({
        label: z.string(),
        action: z.string(),
      })
    )
    .optional(),
  needsHumanHandoff: z.boolean(),
  confidence: z.number().min(0).max(1),
});

// Mock knowledge base search
async function searchKnowledgeBase(query: string): Promise<Document[]> {
  // In a real implementation, this would search your knowledge base
  return [
    {
      id: "doc1",
      title: "Product Documentation",
      content: "Our product offers features X, Y, and Z...",
      relevanceScore: 0.85,
      source: "docs.example.com",
    },
    {
      id: "doc2",
      title: "FAQ - Common Questions",
      content: "Q: How do I reset my password? A: Click on forgot password...",
      relevanceScore: 0.72,
      source: "faq.example.com",
    },
  ];
}

// Intent Classification Processor
const classifyIntent = createProcessor<ChatState>("classify-intent")
  .withDescription("Classify user intent using AI")
  .withTimeout(10000)
  .process(async (state, ctx) => {
    if (!state.currentUserMessage) {
      return Failure(
        new ValidationError(
          "currentUserMessage",
          undefined,
          "No user message to classify"
        )
      );
    }

    ctx.log.info("Classifying user intent", {
      message: state.currentUserMessage.substring(0, 50) + "...",
    });

    try {
      const { object } = await generateObject({
        model: openai("gpt-4o-mini"),
        schema: IntentClassificationSchema,
        system: `You are an intent classification expert. Analyze user messages to determine:
        - Primary intent (greeting, question, complaint, support, purchase, feedback, goodbye, unknown)
        - Confidence level (0-1)
        - Topic of conversation
        - Sentiment (positive, negative, neutral)
        - Language used
        - Whether action is required
        - Suggested action if applicable`,
        prompt: `Classify this user message: "${state.currentUserMessage}"
        
        Previous context: ${state.messages
          .slice(-3)
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n")}`,
        temperature: 0.3,
      });

      ctx.log.info("Intent classified", {
        intent: object.intent,
        confidence: object.confidence,
        sentiment: object.sentiment,
      });

      return Success({
        ...state,
        intent: object.intent,
        context: {
          ...state.context,
          topic: object.topic,
          sentiment: object.sentiment,
          language: object.language,
        },
      });
    } catch (error) {
      ctx.log.error("Intent classification failed", error);
      return Failure(error);
    }
  });

// Knowledge Base Search Processor
const searchKnowledge = createProcessor<ChatState>("search-knowledge")
  .withDescription("Search knowledge base for relevant information")
  .process(async (state, ctx) => {
    // Skip for certain intents
    if (state.intent === "greeting" || state.intent === "goodbye") {
      ctx.log.info("Skipping knowledge search for", state.intent);
      return Success(state);
    }

    ctx.log.info("Searching knowledge base");

    try {
      const searchQuery =
        state.context?.topic || state.currentUserMessage || "";
      const documents = await searchKnowledgeBase(searchQuery);

      ctx.log.info("Knowledge search complete", {
        documentsFound: documents.length,
        topRelevance: documents[0]?.relevanceScore,
      });

      return Success({
        ...state,
        relevantDocuments: documents,
      });
    } catch (error) {
      // Non-critical failure - continue without knowledge base
      ctx.log.warn("Knowledge base search failed, continuing without", error);
      return Success(state);
    }
  });

// Response Generation Processor
const generateResponse = createProcessor<ChatState>("generate-response")
  .withDescription("Generate AI response based on context and knowledge")
  .withTimeout(20000)
  .process(async (state, ctx) => {
    const startTime = Date.now();

    ctx.log.info("Generating response", {
      intent: state.intent,
      hasKnowledge: !!state.relevantDocuments?.length,
    });

    // Build context for response generation
    const conversationHistory = state.messages
      .slice(-10) // Last 10 messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");

    const knowledgeContext = state.relevantDocuments
      ?.slice(0, 3)
      .map((doc) => `[${doc.title}]: ${doc.content.substring(0, 500)}...`)
      .join("\n\n");

    try {
      const { object, usage } = await generateObject({
        model: openai("gpt-4o"),
        schema: ResponseGenerationSchema,
        system: `You are a helpful, empathetic customer service assistant. 
        
        Guidelines:
        - Be conversational and friendly
        - Use the provided knowledge base information when relevant
        - Acknowledge customer emotions
        - Provide clear, actionable responses
        - Know when to escalate to human support
        - Suggest follow-up questions to clarify needs
        - Offer relevant actions the user can take`,
        prompt: `Generate a response for this conversation:
        
        Current Message: ${state.currentUserMessage}
        Intent: ${state.intent} (${state.context?.sentiment} sentiment)
        
        Conversation History:
        ${conversationHistory}
        
        ${knowledgeContext ? `Relevant Knowledge:\n${knowledgeContext}` : ""}
        
        Create an appropriate response that addresses the user's needs.`,
        temperature: 0.7,
        maxTokens: 1000,
      });

      const responseTime = Date.now() - startTime;

      ctx.log.info("Response generated", {
        responseLength: object.response.length,
        needsHandoff: object.needsHumanHandoff,
        confidence: object.confidence,
        tokensUsed: usage.totalTokens,
        responseTime,
      });

      // Update conversation history
      const updatedMessages: ChatMessage[] = [
        ...state.messages,
        {
          role: "user",
          content: state.currentUserMessage!,
          timestamp: new Date().toISOString(),
          metadata: {
            intent: state.intent,
          },
        },
        {
          role: "assistant",
          content: object.response,
          timestamp: new Date().toISOString(),
          metadata: {
            intent: state.intent,
            confidence: object.confidence,
          },
        },
      ];

      return Success({
        ...state,
        currentAssistantResponse: object.response,
        messages: updatedMessages,
        context: {
          ...state.context,
          needsHumanHandoff: object.needsHumanHandoff,
        },
        metrics: {
          responseTime,
          tokensUsed: usage.totalTokens,
        },
      });
    } catch (error) {
      ctx.log.error("Response generation failed", error);
      return Failure(error);
    }
  });

// Action Execution Processor
const executeAction = createProcessor<ChatState>("execute-action")
  .withDescription("Execute required actions based on conversation")
  .process(async (state, ctx) => {
    // Check if action is required based on intent
    const actionableIntents = ["purchase", "support", "complaint"];

    if (!actionableIntents.includes(state.intent || "")) {
      return Success(state);
    }

    ctx.log.info("Executing action for intent", { intent: state.intent });

    // Mock action execution based on intent
    let actionResult;

    switch (state.intent) {
      case "purchase":
        actionResult = {
          type: "create_checkout_session",
          parameters: { userId: state.userId },
          result: { sessionId: "checkout_" + Date.now() },
        };
        break;

      case "support":
        actionResult = {
          type: "create_support_ticket",
          parameters: {
            userId: state.userId,
            issue: state.context?.topic,
            priority:
              state.context?.sentiment === "negative" ? "high" : "normal",
          },
          result: { ticketId: "TICKET_" + Date.now() },
        };
        break;

      case "complaint":
        actionResult = {
          type: "escalate_to_human",
          parameters: {
            userId: state.userId,
            reason: "Customer complaint",
            sentiment: state.context?.sentiment,
          },
          result: { escalated: true, agentId: "AGENT_001" },
        };
        break;
    }

    return Success({
      ...state,
      actionRequired: actionResult,
    });
  });

// Conversation Summary Processor
const summarizeConversation = createProcessor<ChatState>(
  "summarize-conversation"
)
  .withDescription("Generate conversation summary for handoff or records")
  .process(async (state, ctx) => {
    // Only summarize if needed (handoff, long conversation, or ending)
    const needsSummary =
      state.context?.needsHumanHandoff ||
      state.messages.length > 20 ||
      state.intent === "goodbye";

    if (!needsSummary) {
      return Success(state);
    }

    ctx.log.info("Generating conversation summary");

    try {
      const { text } = await generateText({
        model: openai("gpt-3.5-turbo"),
        system:
          "You are an expert at summarizing customer service conversations.",
        prompt: `Summarize this conversation in 2-3 sentences:
        
        ${state.messages.map((m) => `${m.role}: ${m.content}`).join("\n")}
        
        Include: main topic, customer sentiment, actions taken, and outcome.`,
        temperature: 0.3,
        maxTokens: 200,
      });

      return Success({
        ...state,
        summary: text,
      });
    } catch (error) {
      // Non-critical - continue without summary
      ctx.log.warn("Summary generation failed", error);
      return Success(state);
    }
  });

// Intent-based routing
const intentRouter = routeProcessor<ChatState>(
  "intent-router",
  (state) => {
    // Route to specialized handlers based on intent
    if (state.intent === "greeting") return "simple";
    if (state.intent === "goodbye") return "simple";
    if (state.context?.needsHumanHandoff) return "escalate";
    return "full";
  },
  {
    simple: generateResponse,
    full: chainProcessors({
      name: "full-response",
      processors: [searchKnowledge, generateResponse, executeAction],
    }),
    escalate: chainProcessors({
      name: "escalate-to-human",
      processors: [generateResponse, summarizeConversation, executeAction],
    }),
  }
);

// Complete Chat Workflow
export const chatWorkflow = chainProcessors<ChatState>({
  name: "chat-workflow",
  processors: [
    classifyIntent, // Understand user intent
    intentRouter, // Route based on intent
    summarizeConversation, // Summarize if needed
  ],
  timeout: 30000, // 30 seconds total
});

// Streaming Chat Processor (for real-time responses)
export const streamingChatProcessor = createProcessor<ChatState>(
  "streaming-chat"
)
  .withDescription("Generate streaming chat responses")
  .process(async (state, ctx) => {
    if (!state.currentUserMessage) {
      return Failure(
        new ValidationError(
          "currentUserMessage",
          undefined,
          "No message to respond to"
        )
      );
    }

    ctx.log.info("Starting streaming response");

    try {
      const stream = await generateText({
        model: openai("gpt-4o"),
        messages: [
          ...state.messages.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          })),
          { role: "user", content: state.currentUserMessage },
        ],
        temperature: 0.7,
        maxTokens: 1000,
      });

      let fullResponse = "";
      let chunkCount = 0;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        fullResponse += content;
        chunkCount++;

        // Emit streaming events
        ctx.emit("chat:stream:chunk", {
          conversationId: state.conversationId,
          chunk: content,
          chunkNumber: chunkCount,
          accumulated: fullResponse.length,
        });
      }

      // Add to conversation history
      const updatedMessages: ChatMessage[] = [
        ...state.messages,
        {
          role: "user",
          content: state.currentUserMessage,
          timestamp: new Date().toISOString(),
        },
        {
          role: "assistant",
          content: fullResponse,
          timestamp: new Date().toISOString(),
        },
      ];

      return Success({
        ...state,
        currentAssistantResponse: fullResponse,
        messages: updatedMessages,
      });
    } catch (error) {
      return Failure(error);
    }
  });

// Chat Manager Class
export class ChatManager {
  private runtime: LocalRuntime<ChatState>;
  private conversations: Map<string, ChatState> = new Map();

  constructor() {
    this.runtime = new LocalRuntime<ChatState>();
    this.runtime.register(chatWorkflow);
    this.runtime.register(streamingChatProcessor);
  }

  async start() {
    await this.runtime.start();

    // Set up event listeners
    this.runtime.on("chat:stream:chunk", (data) => {
      // Handle streaming chunks (e.g., send to WebSocket)
      console.log(`Stream chunk for ${data.conversationId}: ${data.chunk}`);
    });
  }

  async sendMessage(
    conversationId: string,
    userId: string,
    message: string,
    streaming: boolean = false
  ): Promise<ChatState> {
    // Get or create conversation
    let conversation = this.conversations.get(conversationId);

    if (!conversation) {
      conversation = createAppState(conversationId, {
        conversationId,
        userId,
        messages: [],
        currentUserMessage: message,
      } as Omit<ChatState, keyof AppState>);
    } else {
      conversation = {
        ...conversation,
        currentUserMessage: message,
      };
    }

    // Execute appropriate processor
    const processorName = streaming ? "streaming-chat" : "chat-workflow";
    const result = await this.runtime.execute(processorName, conversation);

    if (result.success) {
      this.conversations.set(conversationId, result.state);
      return result.state;
    } else {
      throw result.error;
    }
  }

  getConversation(conversationId: string): ChatState | undefined {
    return this.conversations.get(conversationId);
  }

  async stop() {
    await this.runtime.stop();
  }
}

// Example usage
async function main() {
  const chatManager = new ChatManager();
  await chatManager.start();

  const conversationId = "conv_" + Date.now();
  const userId = "user_123";

  try {
    // Example conversation
    console.log("🤖 AI Chat Workflow Example\n");

    // First message
    let response = await chatManager.sendMessage(
      conversationId,
      userId,
      "Hello! I'm interested in learning more about your products."
    );
    console.log(
      "User: Hello! I'm interested in learning more about your products."
    );
    console.log(`Bot: ${response.currentAssistantResponse}\n`);

    // Follow-up question
    response = await chatManager.sendMessage(
      conversationId,
      userId,
      "What pricing plans do you offer?"
    );
    console.log("User: What pricing plans do you offer?");
    console.log(`Bot: ${response.currentAssistantResponse}\n`);

    // Complaint scenario
    response = await chatManager.sendMessage(
      conversationId,
      userId,
      "I'm having serious issues with my account and need help immediately!"
    );
    console.log(
      "User: I'm having serious issues with my account and need help immediately!"
    );
    console.log(`Bot: ${response.currentAssistantResponse}`);
    console.log(
      `(Needs human handoff: ${response.context?.needsHumanHandoff})\n`
    );

    // Check conversation summary
    if (response.summary) {
      console.log("📝 Conversation Summary:");
      console.log(response.summary);
    }

    // Check if action was taken
    if (response.actionRequired) {
      console.log("\n⚡ Action Taken:");
      console.log(JSON.stringify(response.actionRequired, null, 2));
    }
  } finally {
    await chatManager.stop();
  }
}

// Export components
export {
  classifyIntent,
  searchKnowledge,
  generateResponse,
  executeAction,
  summarizeConversation,
  intentRouter,
};

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
