// AM2Z v4.0 - Distributed Conversation Explorer Demo
// Complete example using distributed runtime and queue monitoring

import {
  createSamplePersonas,
  createSamplePrompts,
  createConversationExplorerState,
  createConversationExplorerOrchestrator,
  type ConversationExplorerState,
} from "../index";

import { createDistributedRuntime } from "../../../src/lib/node/distributed-runtime";
import { createAIService } from "../services/ai-service";
import { createSimpleQueueMonitor } from "../monitor/queue-monitor";
import { createLogger, createColoredFormatter } from "../../../src/lib/core";

/**
 * Distributed Conversation Explorer Demo
 * Shows how to run the conversation explorer with BullMQ distributed runtime
 */
console.log("🚀 AM2Z v4.0 - Distributed Conversation Explorer Demo\n");

const logger = createLogger(
  { component: "DistributedDemo" },
  "info",
  createColoredFormatter()
);

// Create sample data
const personas = createSamplePersonas();
const prompts = createSamplePrompts();

// Create AI service
const aiService = createAIService();

// Create initial state
const initialState = createConversationExplorerState(personas, prompts, {
  maxDepth: 3,
  maxTotalNodes: 12,
  branchingFactor: 2,
  batchSize: 3,
});

// Create orchestrator
const orchestrator = createConversationExplorerOrchestrator(aiService);

// Create distributed runtime
const runtime = createDistributedRuntime<ConversationExplorerState>(
  {
    queuePrefix: "conversation-explorer",
    redis: {
      host: "localhost",
      port: 6379,
    },
    worker: {
      concurrency: 5,
      removeOnComplete: 10,
      removeOnFail: 5,
    },
  },
  logger
);

// Register processors
runtime.register(orchestrator.mainProcessor);
runtime.register(orchestrator.answerQuestion);

// Start queue monitor (in separate process ideally)
console.log("📊 Starting queue monitor...");
createSimpleQueueMonitor({
  redis: { host: "localhost", port: 6379 },
  queues: ["conversation-explorer"],
  refreshInterval: 2000,
});

export { runtime };

async function runDistributedDemo(): Promise<void> {
  try {
    // Start runtime
    await runtime.start();
    logger.info("✅ Distributed runtime started");

    // Start monitoring (comment out if running in separate terminal)
    // await monitor.start();

    runtime.execute(orchestrator.mainProcessor.name, initialState);
  } catch (error) {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  }
}

/**
 * Display final exploration results
 */
async function displayFinalResults(
  state: ConversationExplorerState,
  logger: any
): Promise<void> {
  console.log("\n🎉 Exploration Completed!");
  console.log("═".repeat(60));

  console.log("\n📊 Final Analytics:");
  console.log(`  • Total nodes: ${state.analytics.totalNodes}`);
  console.log(`  • Completed nodes: ${state.analytics.completedNodes}`);
  console.log(`  • Max depth reached: ${state.analytics.maxDepthReached}`);
  console.log(
    `  • Average processing time: ${state.analytics.averageProcessingTime.toFixed(0)}ms`
  );
  console.log(
    `  • Completion rate: ${((state.analytics.completedNodes / state.analytics.totalNodes) * 100).toFixed(1)}%`
  );

  console.log("\n👥 Persona Distribution:");
  const personaDistribution: Record<string, number> = {};
  state.nodes.forEach((node) => {
    personaDistribution[node.persona.name] =
      (personaDistribution[node.persona.name] || 0) + 1;
  });

  Object.entries(personaDistribution).forEach(([name, count]) => {
    console.log(`  • ${name}: ${count} nodes`);
  });

  console.log("\n🌳 Conversation Tree Sample:");
  const rootNodes = state.nodes.filter((node) => !node.parentId);
  rootNodes.slice(0, 2).forEach((node) => {
    // Show first 2 trees only
    displayNodeTree(node, state.nodes, "");
  });

  console.log("\n✨ Distributed Features Demonstrated:");
  console.log("  🎯 BullMQ task distribution");
  console.log("  📞 Inter-processor communication with call()");
  console.log("  🔄 Automatic retry and error handling");
  console.log("  📊 Real-time queue monitoring");
  console.log("  🚀 Horizontal scalability");
  console.log("  🛡️ Fault tolerance and recovery");
}

/**
 * Display a conversation node and its children
 */
function displayNodeTree(node: any, allNodes: any[], indent: string): void {
  const status = node.isComplete ? "✅" : "⏳";
  const metrics = node.metrics
    ? ` (${node.metrics.processingTimeMs.toFixed(0)}ms)`
    : "";

  console.log(
    `${indent}${status} [${node.persona.name}] ${node.prompt.substring(0, 50)}...`
  );

  if (node.response && indent.length < 6) {
    // Limit depth for readability
    const responsePreview = node.response.substring(0, 60) + "...";
    console.log(`${indent}    💬 ${responsePreview}${metrics}`);
  }

  // Show children (limit to 2 levels for readability)
  if (indent.length < 4) {
    const children = allNodes.filter((n) => n.parentId === node.id);
    children.slice(0, 2).forEach((child) => {
      displayNodeTree(child, allNodes, indent + "  ");
    });
  }
}

/**
 * Run queue monitor in separate mode
 */
async function runQueueMonitor(): Promise<void> {
  console.log("📊 Starting Queue Monitor for Conversation Explorer\n");

  const monitor = createSimpleQueueMonitor({
    redis: { host: "localhost", port: 6379 },
    queues: ["conversation-explorer"],
    refreshInterval: 2000,
  });

  await monitor.start();
}

/**
 * Main function to choose demo mode
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0] || "demo";

  switch (mode) {
    case "monitor":
      await runQueueMonitor();
      break;
    case "demo":
    default:
      await runDistributedDemo();
      break;
  }
}

// Run the appropriate mode
if (require.main === module) {
  main().catch((error) => {
    console.error("❌ Demo failed:", error);
    process.exit(1);
  });
}

export { runDistributedDemo, runQueueMonitor };
