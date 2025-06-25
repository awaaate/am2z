// AM2Z v4.0 - State Factory for Conversation Explorer
// Factory functions to create initial states and configurations

import {
  createAppState,
  createNonEmptyArray,
  type NonEmptyArray,
} from "../../../src/lib/core";

import {
  type ConversationExplorerState,
  type ConversationTreeConfig,
  type Persona,
  type ConversationNode,
  type ConversationAnalytics,
  type PipelineStage,
  type ProcessingQueue,
  type WorkflowStage,
} from "../types";

/**
 * Create initial conversation explorer state with optimal configuration
 */
export function createConversationExplorerState(
  personas: NonEmptyArray<Persona>,
  initialPrompts: NonEmptyArray<string>,
  config: Partial<ConversationTreeConfig> = {}
): ConversationExplorerState {
  const sessionId = `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  // Create optimal configuration based on inputs
  const finalConfig: ConversationTreeConfig = {
    maxDepth: 4,
    maxNodesPerLevel: 6,
    maxTotalNodes: 50,
    branchingFactor: 3,
    responseTimeout: 30000,
    batchSize: 8, // Optimal for parallel processing
    ...config,
  };

  // Create initial conversation nodes from prompts
  const initialNodes: ConversationNode[] = initialPrompts.map(
    (prompt, index) => {
      const persona = personas[index % personas.length];

      if (!persona) {
        throw new Error(
          `No persona available at index ${index % personas.length}`
        );
      }

      return {
        id: `root_${index}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        depth: 0,
        prompt,
        persona,
        parentId: undefined,
        childIds: [],
        isComplete: false,
        createdAt: now,
      };
    }
  );

  // Initialize analytics
  const initialAnalytics: ConversationAnalytics = {
    totalNodes: initialNodes.length,
    completedNodes: 0,
    pendingNodes: initialNodes.length,
    averageDepth: 0,
    maxDepthReached: 0,
    totalProcessingTime: 0,
    averageResponseTime: 0,
    completionRate: 0,
    personaDistribution: createPersonaDistribution(initialNodes),
    processingStats: {
      batchesProcessed: 0,
      averageBatchSize: 0,
      parallelEfficiency: 0,
    },
  };

  // Initialize pipeline stage
  const initialPipeline: PipelineStage = {
    stage: "initializing",
    currentDepth: 0,
    isComplete: false,
    startedAt: now,
    iterationCount: 0,
  };

  // Initialize processing queue
  const initialQueue: ProcessingQueue = {
    pendingBatches: [],
    activeBatches: [],
    completedBatches: [],
    queueMetrics: {
      totalQueued: 0,
      totalProcessed: 0,
      averageWaitTime: 0,
      throughputPerMinute: 0,
    },
  };

  // Initialize workflow stage
  const initialWorkflow: WorkflowStage = {
    currentPhase: "setup",
    phasesCompleted: [],
    totalPhases: 4, // setup, exploration, expansion, completion
  };

  // Create the complete state
  const baseState = createAppState(sessionId, {
    __brand: "conversation-explorer" as const,
    config: finalConfig,
    personas,
    conversationTree: initialNodes,
    analytics: initialAnalytics,
    pipeline: initialPipeline,
    processingQueue: initialQueue,
    workflowStage: initialWorkflow,
  });

  return baseState as ConversationExplorerState;
}

/**
 * Create a default conversation tree configuration optimized for different scenarios
 */
export function createOptimizedConfig(
  scenario: "quick" | "standard" | "comprehensive" | "distributed"
): ConversationTreeConfig {
  const baseConfig = {
    responseTimeout: 30000,
  };

  switch (scenario) {
    case "quick":
      return {
        ...baseConfig,
        maxDepth: 2,
        maxNodesPerLevel: 3,
        maxTotalNodes: 15,
        branchingFactor: 2,
        batchSize: 4,
      };

    case "standard":
      return {
        ...baseConfig,
        maxDepth: 3,
        maxNodesPerLevel: 5,
        maxTotalNodes: 30,
        branchingFactor: 3,
        batchSize: 6,
      };

    case "comprehensive":
      return {
        ...baseConfig,
        maxDepth: 5,
        maxNodesPerLevel: 8,
        maxTotalNodes: 100,
        branchingFactor: 4,
        batchSize: 10,
      };

    case "distributed":
      return {
        ...baseConfig,
        maxDepth: 6,
        maxNodesPerLevel: 12,
        maxTotalNodes: 200,
        branchingFactor: 5,
        batchSize: 15,
      };

    default:
      return {
        ...baseConfig,
        maxDepth: 4,
        maxNodesPerLevel: 6,
        maxTotalNodes: 50,
        branchingFactor: 3,
        batchSize: 8,
      };
  }
}

/**
 * Create sample personas for demonstration
 */
export function createSamplePersonas(): NonEmptyArray<Persona> {
  return createNonEmptyArray([
    {
      id: "tech_professional",
      name: "Alex Chen",
      demographics: {
        age: 32,
        occupation: "Software Engineer",
        location: "San Francisco, CA",
        familyStatus: "Young professional, recently married",
      },
      preferences: {
        primaryInterest: "Innovation and Technology",
        priorityLevel: 8,
        budgetSensitivity: 6,
        technologyAdoption: 9,
      },
      motivations: [
        "Stay ahead with latest technology",
        "Optimize for long-term value",
        "Minimize maintenance overhead",
        "Achieve technical excellence",
      ],
      concerns: [
        "Technology becoming obsolete quickly",
        "Hidden costs and fees",
        "Time investment for learning new systems",
        "Security and privacy implications",
      ],
    },
    {
      id: "family_focused",
      name: "Maria Rodriguez",
      demographics: {
        age: 38,
        occupation: "Marketing Manager",
        location: "Austin, TX",
        familyStatus: "Married with two children (8 and 12)",
      },
      preferences: {
        primaryInterest: "Family Safety and Convenience",
        priorityLevel: 9,
        budgetSensitivity: 7,
        technologyAdoption: 6,
      },
      motivations: [
        "Ensure family safety and security",
        "Maximize convenience for busy schedule",
        "Get reliable, proven solutions",
        "Save time for family activities",
      ],
      concerns: [
        "Complexity affecting family members",
        "Reliability during critical moments",
        "Value for money with family budget",
        "Impact on children's development",
      ],
    },
    {
      id: "sustainability_advocate",
      name: "David Kim",
      demographics: {
        age: 29,
        occupation: "Environmental Consultant",
        location: "Portland, OR",
        familyStatus: "Single, environmentally conscious",
      },
      preferences: {
        primaryInterest: "Environmental Impact",
        priorityLevel: 9,
        budgetSensitivity: 8,
        technologyAdoption: 7,
      },
      motivations: [
        "Minimize environmental footprint",
        "Support sustainable practices",
        "Choose ethical companies",
        "Promote circular economy principles",
      ],
      concerns: [
        "Greenwashing and false claims",
        "Higher upfront costs",
        "Limited options in sustainable choices",
        "Long-term environmental impact",
      ],
    },
    {
      id: "budget_conscious",
      name: "Sarah Johnson",
      demographics: {
        age: 26,
        occupation: "Teacher",
        location: "Denver, CO",
        familyStatus: "Single, student loans",
      },
      preferences: {
        primaryInterest: "Value and Affordability",
        priorityLevel: 9,
        budgetSensitivity: 9,
        technologyAdoption: 5,
      },
      motivations: [
        "Maximize value for money",
        "Find reliable budget options",
        "Build long-term financial stability",
        "Avoid unnecessary expenses",
      ],
      concerns: [
        "Hidden fees and costs",
        "Quality vs price trade-offs",
        "Long-term financial commitment",
        "Limited disposable income",
      ],
    },
  ]);
}

/**
 * Create sample initial prompts for demonstration
 */
export function createSamplePrompts(): NonEmptyArray<string> {
  return createNonEmptyArray([
    "What are the most important factors to consider when making a major technology investment for your lifestyle?",
    "How do you balance innovation with reliability when choosing products or services that will impact your daily routine?",
    "What role should expert recommendations versus peer reviews play in making important purchasing decisions?",
  ]);
}

// === Helper Functions ===

/**
 * Create persona distribution map from nodes
 */
function createPersonaDistribution(
  nodes: ConversationNode[]
): Record<string, number> {
  const distribution: Record<string, number> = {};

  nodes.forEach((node) => {
    const personaId = node.persona.id;
    distribution[personaId] = (distribution[personaId] || 0) + 1;
  });

  return distribution;
}

/**
 * Estimate processing time based on configuration
 */
export function estimateProcessingTime(config: ConversationTreeConfig): number {
  // Very rough estimation based on node count and processing time per node
  const avgProcessingTimePerNode = 500; // ms
  const estimatedNodes = Math.min(
    config.maxTotalNodes,
    Math.pow(config.branchingFactor, config.maxDepth)
  );

  return estimatedNodes * avgProcessingTimePerNode;
}
