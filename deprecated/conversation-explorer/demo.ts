// src/conversation-explorer-v2/demo.ts
import { SimpleConversationExplorer } from "./simple-explorer";
import { type Persona } from "./types";

export function createSampleAgents(): Persona[] {
  return [
    {
      id: "analyst",
      name: "Dr. Sarah Chen",
      personality: "Analytical and methodical researcher",
      background: "data science and behavioral analysis",
      expertise: [
        "data analysis",
        "research methodology",
        "statistical modeling",
      ],
    },
    {
      id: "creative",
      name: "Marcus Rivera",
      personality: "Creative and innovative designer",
      background: "design thinking and user experience",
      expertise: ["creative strategy", "design thinking", "user research"],
    },
    {
      id: "pragmatist",
      name: "Jennifer Park",
      personality: "Practical and results-focused manager",
      background: "business operations and project management",
      expertise: ["business strategy", "implementation", "change management"],
    },
  ];
}

export const explorer = new SimpleConversationExplorer({
  redis: { host: "localhost", port: 6379 },
  concurrency: 2,
});

async function runDemo(): Promise<void> {
  console.log("🚀 Simple Conversation Explorer Demo\n");

  try {
    await explorer.start();

    const result = await explorer.exploreConversation(
      [
        "What are the main challenges when implementing AI in traditional businesses?",
        "How can companies balance innovation with risk management?",
      ],
      createSampleAgents(),
      {
        maxDepth: 3,
        maxMessages: 15,
        branchingFactor: 2,
      }
    );

    // Mostrar resultados
    console.log("\n🎉 Exploration Results:");
    console.log("═".repeat(60));
    console.log(`📊 Total messages: ${result.messages.length}`);
    console.log(
      `✅ Completed messages: ${result.messages.filter((m) => m.isComplete).length}`
    );
    console.log(
      `📏 Max depth reached: ${Math.max(...result.messages.map((m) => m.depth))}`
    );
    console.log(`🎭 Agent distribution:`);

    const agentCounts = result.messages.reduce(
      (acc, m) => {
        const agent = result.personas.find((a) => a.id === m.personaId);
        const name = agent?.name || m.personaId;
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    Object.entries(agentCounts).forEach(([name, count]) => {
      console.log(`   • ${name}: ${count} messages`);
    });

    console.log("\n🌳 Conversation Tree:");
    displayConversationTree(result.messages);
  } catch (error) {
    console.error("❌ Demo failed:", error);
  } finally {
    await explorer.stop();
  }
}

function displayConversationTree(messages: any[]): void {
  const rootMessages = messages.filter((m) => m.depth === 0);

  const displayMessage = (msg: any, indent: string = "") => {
    const status = msg.isComplete ? "✅" : "⏳";
    const preview =
      msg.content.substring(0, 60) + (msg.content.length > 60 ? "..." : "");

    console.log(`${indent}${status} ${preview}`);

    if (msg.response && msg.isComplete) {
      const responsePreview = msg.response.substring(0, 80) + "...";
      console.log(`${indent}    💬 ${responsePreview}`);
    }

    // Mostrar hijos
    const children = messages.filter((m) => m.parentId === msg.id);
    children.forEach((child) => displayMessage(child, indent + "  "));
  };

  rootMessages.forEach((msg) => displayMessage(msg));
}

// Ejecutar demo
if (require.main === module) {
  runDemo().catch(console.error);
}
