// AM2Z v4.0 - Conversation Explorer Main
// Entry point for the conversation explorer system

import {
  createAppState,
  createNonEmptyArray,
  createLocalRuntime,
  createLogger,
  createColoredFormatter,
  type Logger,
  type NonEmptyArray,
} from "../../src/lib/core";

import {
  type ConversationExplorerState,
  type Persona,
  type ExplorationConfig,
  type AIService,
} from "./types";

import { createAIService } from "./services/ai-service";
import {
  createConversationExplorerOrchestrator,
  createAdvancedConversationOrchestrator,
} from "./orchestrator";
import { createDistributedRuntime } from "../../src/lib/node/distributed-runtime";

// === State Factory ===

/**
 * Create initial conversation explorer state
 */
export function createConversationExplorerState(
  personas: NonEmptyArray<Persona>,
  initialPrompts: NonEmptyArray<string>,
  config: Partial<ExplorationConfig> = {}
): ConversationExplorerState {
  const sessionId = `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const finalConfig: ExplorationConfig = {
    maxDepth: 3,
    maxTotalNodes: 20,
    branchingFactor: 2,
    batchSize: 4,
    ...config,
  };

  // Create initial conversation nodes
  const initialNodes = initialPrompts.map((prompt, index) => {
    const persona = personas[index % personas.length];

    if (!persona) {
      throw new Error(
        `No persona available at index ${index % personas.length}`
      );
    }

    return {
      id: `root_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      parentId: undefined,
      depth: 0,
      prompt,
      persona,
      isComplete: false,
      createdAt: now,
    };
  });

  const baseState = createAppState(sessionId, {
    __brand: "conversation-explorer" as const,
    config: finalConfig,
    personas,
    nodes: initialNodes,
    pendingQuestions: [],
    analytics: {
      totalNodes: initialNodes.length,
      completedNodes: 0,
      maxDepthReached: 0,
      averageProcessingTime: 0,
      isComplete: false,
    },
    currentStage: "setup" as const,
  });

  return baseState as ConversationExplorerState;
}

// === Main Runner ===

/**
 * Run conversation exploration
 */
export async function runConversationExplorer(
  personas: NonEmptyArray<Persona>,
  initialPrompts: NonEmptyArray<string>,
  config?: Partial<ExplorationConfig> & {
    useAdvanced?: boolean;
    aiService?: AIService;
    logger?: Logger;
  }
): Promise<ConversationExplorerState> {
  const log =
    config?.logger ||
    createLogger(
      { component: "ConversationExplorer" },
      "info",
      createColoredFormatter()
    );

  const aiService = config?.aiService || createAIService();

  log.info("🚀 Starting conversation exploration", {
    personaCount: personas.length,
    initialPrompts: initialPrompts.length,
    config: {
      maxDepth: config?.maxDepth || 3,
      maxTotalNodes: config?.maxTotalNodes || 20,
      branchingFactor: config?.branchingFactor || 2,
      batchSize: config?.batchSize || 4,
      useAdvanced: config?.useAdvanced || false,
    },
  });

  // Create initial state
  const initialState = createConversationExplorerState(
    personas,
    initialPrompts,
    config
  );

  // Create orchestrator
  const orchestrator = config?.useAdvanced
    ? createAdvancedConversationOrchestrator(aiService)
    : createConversationExplorerOrchestrator(aiService);

  // Create runtime and register processors
  const runtime = createDistributedRuntime<ConversationExplorerState>(
    {
      queueName: "conversation-explorer",
      redis: {
        host: "localhost",
        port: 6379,
      },
    },
    log
  );
  runtime.register(orchestrator.mainProcessor);
  runtime.register(orchestrator.answerQuestion);

  await runtime.start();

  try {
    let currentState = initialState;
    const maxIterations = 20;
    let iteration = 0;

    while (iteration < maxIterations && !currentState.analytics.isComplete) {
      iteration++;

      log.info(`🔄 Starting iteration ${iteration}/${maxIterations}`, {
        currentStage: currentState.currentStage,
        totalNodes: currentState.analytics.totalNodes,
        completedNodes: currentState.analytics.completedNodes,
        pendingQuestions: currentState.pendingQuestions.length,
      });

      const result = await runtime.execute(
        orchestrator.mainProcessor.name,
        currentState,
        currentState.metadata.sessionId
      );

      if (!result.success) {
        log.error("Pipeline iteration failed", result.error);
        throw result.error;
      }

      currentState = result.state;

      // Log progress
      log.info(`✅ Iteration ${iteration} completed`, {
        stage: currentState.currentStage,
        totalNodes: currentState.analytics.totalNodes,
        completedNodes: currentState.analytics.completedNodes,
        completionRate: `${((currentState.analytics.completedNodes / currentState.analytics.totalNodes) * 100).toFixed(1)}%`,
        maxDepth: currentState.analytics.maxDepthReached,
        avgProcessingTime: `${currentState.analytics.averageProcessingTime.toFixed(0)}ms`,
      });

      // Small delay between iterations
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!currentState.analytics.isComplete) {
      log.warn(
        `Exploration stopped after ${maxIterations} iterations without completion`
      );
    }

    return currentState;
  } finally {
    await runtime.stop();
  }
}

// === Sample Data Factories ===

/**
 * Create sample personas for demonstration
 */
export function createSamplePersonas(): NonEmptyArray<Persona> {
  return createNonEmptyArray([
    {
      id: "tech_enthusiast",
      name: "Alex Chen",
      background: "Software engineer with 8+ years experience in tech startups",
      interests: ["Innovation", "Scalable systems", "Technical excellence"],
      concerns: ["Technical debt", "Vendor lock-in", "Learning curve"],
    },
    {
      id: "family_focused",
      name: "Maria Rodriguez",
      background: "Marketing manager, mother of two, values work-life balance",
      interests: ["Family safety", "Convenience", "Reliable solutions"],
      concerns: ["Complexity", "Time investment", "Budget constraints"],
    },
    {
      id: "sustainability_advocate",
      name: "David Kim",
      background: "Environmental consultant focused on sustainable practices",
      interests: [
        "Environmental impact",
        "Ethical choices",
        "Long-term sustainability",
      ],
      concerns: ["Greenwashing", "Higher costs", "Limited options"],
    },
  ]);
}

/**
 * Create sample initial prompts
 */
export function createSamplePrompts(): NonEmptyArray<string> {
  return createNonEmptyArray([
    "What are the most important factors when making technology decisions for your work or personal life?",
    "How do you balance innovation with reliability when choosing new tools or services?",
  ]);
}

// === Demo Function ===

/**
 * Run a complete demonstration of the conversation explorer
 */
export async function demonstrateConversationExplorer(): Promise<void> {
  console.log("🚀 AM2Z v4.0 - Conversation Explorer Demo\n");

  const personas = createSamplePersonas();
  const prompts = createSamplePrompts();

  try {
    const result = await runConversationExplorer(personas, prompts, {
      maxDepth: 3,
      maxTotalNodes: 15,
      branchingFactor: 2,
      batchSize: 3,
      useAdvanced: false,
    });

    // Display results
    console.log("\n🎉 Exploration Completed!");
    console.log("═".repeat(60));

    console.log(`\n📊 Final Analytics:`);
    console.log(`  • Total nodes: ${result.analytics.totalNodes}`);
    console.log(`  • Completed nodes: ${result.analytics.completedNodes}`);
    console.log(`  • Max depth reached: ${result.analytics.maxDepthReached}`);
    console.log(
      `  • Average processing time: ${result.analytics.averageProcessingTime.toFixed(0)}ms`
    );
    console.log(
      `  • Completion rate: ${((result.analytics.completedNodes / result.analytics.totalNodes) * 100).toFixed(1)}%`
    );

    console.log(`\n🌳 Conversation Tree:`);
    displayConversationTree(result.nodes);

    console.log(`\n✨ AM2Z v4.0 Features Demonstrated:`);
    console.log("  🎯 Type-safe state management with branded types");
    console.log(
      "  🔄 Processor composition with chainProcessors and routeProcessor"
    );
    console.log("  📞 Inter-processor communication with call()");
    console.log("  🚀 Ready for distributed execution with BullMQ");
    console.log("  📊 Real-time analytics and monitoring");
    console.log("  🛡️ Robust error handling and retry policies");
  } catch (error) {
    console.error("\n❌ Conversation exploration failed:", error);
  }
}

// === Helper Functions ===

/**
 * Display conversation tree in a readable format
 */
function displayConversationTree(nodes: any[]): void {
  const displayNode = (node: any, indent: string = ""): void => {
    const status = node.isComplete ? "✅" : "⏳";
    const metrics = node.metrics
      ? ` (${node.metrics.processingTimeMs.toFixed(0)}ms, ${node.metrics.tokenCount} tokens)`
      : "";

    console.log(`${indent}${status} [${node.persona.name}] ${node.prompt}`);

    if (node.response && node.isComplete) {
      const responsePreview =
        node.response.length > 80
          ? node.response.substring(0, 80) + "..."
          : node.response;
      console.log(`${indent}    💬 ${responsePreview}${metrics}`);
    }

    // Display children
    const children = nodes.filter((n) => n.parentId === node.id);
    children.forEach((child) => {
      displayNode(child, indent + "  ");
    });
  };

  // Display root nodes and their trees
  const rootNodes = nodes.filter((node) => !node.parentId);
  rootNodes.forEach((node) => displayNode(node));
}

// === Exports ===

export {
  type ConversationExplorerState,
  type Persona,
  type ExplorationConfig,
  type AIService,
  createAIService,
  createConversationExplorerOrchestrator,
  createAdvancedConversationOrchestrator,
};

// Run demo if this file is executed directly
if (require.main === module) {
  demonstrateConversationExplorer().catch(console.error);
}
