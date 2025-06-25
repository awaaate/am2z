// AM2Z v4.0 - Conversation Explorer
// Tree-based conversation generation with proper state management and error handling

import {
  type AppState,
  type BrandedState,
  type NonEmptyArray,
  createNonEmptyArray,
  createAppState,
  createProcessor,
  chainProcessors,
  parallelProcessors,
  createLocalRuntime,
  type Logger,
  createLogger,
  createColoredFormatter,
} from '../lib/core';

// === Domain Types ===

export interface Persona {
  readonly id: string;
  readonly name: string;
  readonly demographics: {
    readonly age: number;
    readonly occupation: string;
    readonly location: string;
    readonly familyStatus: string;
  };
  readonly preferences: {
    readonly primaryInterest: string;
    readonly priorityLevel: number; // 1-10
    readonly budgetSensitivity: number; // 1-10
    readonly technologyAdoption: number; // 1-10
  };
  readonly motivations: readonly string[];
  readonly concerns: readonly string[];
}

export interface ConversationNode {
  readonly id: string;
  readonly parentId?: string;
  readonly depth: number;
  readonly prompt: string;
  readonly response?: string;
  readonly persona: Persona;
  readonly childIds: readonly string[];
  readonly isComplete: boolean;
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly processingMetrics?: {
    readonly processingTimeMs: number;
    readonly tokenCount: number;
    readonly confidenceScore: number;
  };
}

export interface ConversationTreeConfig {
  readonly maxDepth: number;
  readonly maxNodesPerLevel: number;
  readonly maxTotalNodes: number;
  readonly branchingFactor: number;
  readonly responseTimeout: number;
}

export interface ConversationAnalytics {
  readonly totalNodes: number;
  readonly completedNodes: number;
  readonly averageDepth: number;
  readonly maxDepthReached: number;
  readonly totalProcessingTime: number;
  readonly averageResponseTime: number;
  readonly completionRate: number;
  readonly personaDistribution: Record<string, number>;
}

export interface ConversationPipelineState {
  readonly stage: 'initializing' | 'generating_responses' | 'expanding_tree' | 'analyzing' | 'completed';
  readonly currentDepth: number;
  readonly isComplete: boolean;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly iterationCount: number;
}

// === Main State ===

export type ConversationExplorerState = BrandedState<'conversation-explorer', {
  readonly config: ConversationTreeConfig;
  readonly personas: NonEmptyArray<Persona>;
  readonly conversationTree: ConversationNode[];
  readonly analytics: ConversationAnalytics;
  readonly pipeline: ConversationPipelineState;
}>;

// === AI Service Mock ===

class MockAIService {
  /**
   * Generate a conversational response for a given prompt and persona
   */
  async generateResponse(
    prompt: string, 
    persona: Persona,
    context?: { parentResponse?: string }
  ): Promise<{
    text: string;
    tokenCount: number;
    confidenceScore: number;
  }> {
    // Simulate realistic AI processing time
    const processingTime = 300 + Math.random() * 700;
    await new Promise(resolve => setTimeout(resolve, processingTime));

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
    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));

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
    ];

    // Generate personalized questions
    return Array.from({ length: count }, (_, i) => {
      const persona = personas[i % personas.length];
      const baseQuestion = baseQuestions[i % baseQuestions.length];
      
      if (!persona) {
        throw new Error(`No persona available at index ${i % personas.length}`);
      }
      
      // Personalize based on persona characteristics
      const personalizedPrompt = this.personalizeQuestion(baseQuestion || 'What do you think?', persona, parentNode);
      
      return {
        prompt: personalizedPrompt,
        persona,
      };
    });
  }

  private generateContextualResponse(
    prompt: string,
    persona: Persona,
    context?: { parentResponse?: string }
  ): string {
    const templates = [
      `As someone who is ${persona.demographics.occupation.toLowerCase()} in ${persona.demographics.location}, I find this really interesting. ${prompt} makes me think about ${persona.motivations[0] || 'my priorities'}. However, I'm a bit concerned about ${persona.concerns[0] || 'potential issues'}.`,
      
      `Given my ${persona.preferences.primaryInterest} focus and being ${persona.demographics.familyStatus.toLowerCase()}, I'd approach this by considering ${persona.motivations.slice(0, 2).join(' and ')}. What specifically appeals to me is how this might address my concern about ${persona.concerns[0]?.toLowerCase()}.`,
      
      `From my perspective as a ${persona.demographics.age}-year-old ${persona.demographics.occupation.toLowerCase()}, ${prompt} resonates because it aligns with my priority of ${persona.motivations[0] || 'my main goal'}. Though I do wonder about ${persona.concerns[Math.floor(Math.random() * persona.concerns.length)] || 'potential challenges'}.`,
    ];

    return templates[Math.floor(Math.random() * templates.length)] || '';
  }

  private personalizeQuestion(
    baseQuestion: string,
    persona: Persona,
    parentNode: ConversationNode
  ): string {
    // Add persona-specific context to the question
    const personalizations = [
      `Given your background as a ${persona.demographics.occupation}, ${(baseQuestion || 'what do you think?').toLowerCase()}`,
      `As someone in ${persona.demographics.location} who values ${persona.preferences.primaryInterest}, ${(baseQuestion || 'what do you think?').toLowerCase()}`,
      `Considering your ${persona.demographics.familyStatus.toLowerCase()} situation, ${(baseQuestion || 'what do you think?').toLowerCase()}`,
    ];

    return personalizations[Math.floor(Math.random() * personalizations.length)] || '';
  }
}

// === Core Processors ===

/**
 * Processor to generate responses for pending conversation nodes
 */
const responseGeneratorProcessor = createProcessor<ConversationExplorerState>('responseGenerator')
  .withDescription('Generate AI responses for pending conversation nodes')
  .withTimeout(30000)
  .withRetryPolicy({
    maxAttempts: 3,
    backoffMs: 1000,
    shouldRetry: (error) => error.retryable,
  })

  .processWithImmer((draft, ctx) => {
    ctx.log.info('🤖 Starting response generation...');
    
    // Find nodes that need responses
    const pendingNodes = draft.conversationTree.filter(
      node => !node.isComplete && node.depth <= draft.config.maxDepth
    );

    if (pendingNodes.length === 0) {
      ctx.log.info('No pending nodes found for response generation');
      return;
    }

    ctx.log.info(`Found ${pendingNodes.length} nodes requiring responses`);
    draft.pipeline.stage = 'generating_responses';

    // Process each pending node (in real implementation, this would be async)
    pendingNodes.forEach((node, index) => {
      // Find the node in the draft to modify it
      const nodeIndex = draft.conversationTree.findIndex(n => n.id === node.id);
      if (nodeIndex === -1) return;

      const draftNode = draft.conversationTree[nodeIndex];
      if (!draftNode) return; // Safety check
      
      // Mark as complete with mock response
      draftNode.isComplete = true;
      draftNode.completedAt = new Date().toISOString();
      draftNode.response = `Response for "${node.prompt.substring(0, 40)}..." from ${node.persona.name}'s perspective, considering their ${node.persona.preferences.primaryInterest} focus and concerns about ${node.persona.concerns[0] || 'unknown concerns'}.`;
      draftNode.processingMetrics = {
        processingTimeMs: 400 + Math.random() * 600,
        tokenCount: 120 + Math.floor(Math.random() * 80),
        confidenceScore: 0.75 + Math.random() * 0.2,
      };

      // Update analytics
      draft.analytics.completedNodes++;
      if (draftNode.processingMetrics) {
        draft.analytics.totalProcessingTime += draftNode.processingMetrics.processingTimeMs;
      }
      draft.analytics.averageResponseTime = 
        draft.analytics.totalProcessingTime / draft.analytics.completedNodes;
      draft.analytics.completionRate = 
        draft.analytics.completedNodes / draft.analytics.totalNodes;
    });

    ctx.log.info(`Completed response generation for ${pendingNodes.length} nodes`);
  });

/**
 * Processor to expand the conversation tree with new branches
 */
const treeExpansionProcessor = createProcessor<ConversationExplorerState>('treeExpansion')
  .withDescription('Expand conversation tree by generating follow-up questions')
  .withTimeout(25000)
  .processWithImmer((draft, ctx) => {
    ctx.log.info('🌳 Starting tree expansion...');

    // Check if we can still expand
    if (draft.conversationTree.length >= draft.config.maxTotalNodes) {
      ctx.log.info('Maximum total nodes reached, skipping expansion');
      return;
    }

    if (draft.analytics.maxDepthReached >= draft.config.maxDepth - 1) {
      ctx.log.info('Maximum depth reached, skipping expansion');
      return;
    }

    // Find completed nodes that can be expanded
    const expandableNodes = draft.conversationTree.filter(
      node => node.isComplete && 
              node.childIds.length === 0 && 
              node.depth < draft.config.maxDepth - 1
    );

    if (expandableNodes.length === 0) {
      ctx.log.info('No expandable nodes found');
      return;
    }

    ctx.log.info(`Found ${expandableNodes.length} nodes that can be expanded`);
    draft.pipeline.stage = 'expanding_tree';

    expandableNodes.forEach(parentNode => {
      // Calculate how many children we can add
      const remainingCapacity = draft.config.maxTotalNodes - draft.conversationTree.length;
      const maxChildren = Math.min(
        draft.config.branchingFactor,
        remainingCapacity
      );

      if (maxChildren <= 0) return;

      // Generate follow-up questions
      for (let i = 0; i < maxChildren; i++) {
        const persona = draft.personas[i % draft.personas.length];
        if (!persona) continue; // Skip if no persona available
        
        const newNode: ConversationNode = {
          id: `${parentNode.id}_child_${i}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          parentId: parentNode.id,
          depth: parentNode.depth + 1,
          prompt: `Follow-up question ${i + 1}: How would you evaluate the options mentioned regarding "${parentNode.prompt.substring(0, 30)}..."?`,
          persona,
          childIds: [],
          isComplete: false,
          createdAt: new Date().toISOString(),
        };

        // Add new node to tree (cast to WritableDraft for Immer compatibility)
        draft.conversationTree.push(newNode as any);
        
        // Update parent's children list
        const parentIndex = draft.conversationTree.findIndex(n => n.id === parentNode.id);
        if (parentIndex !== -1 && draft.conversationTree[parentIndex]) {
          (draft.conversationTree[parentIndex]!.childIds as string[]).push(newNode.id);
        }

        // Update analytics
        draft.analytics.totalNodes++;
        draft.analytics.maxDepthReached = Math.max(
          draft.analytics.maxDepthReached,
          newNode.depth
        );
        
        // Update persona distribution
        const personaKey = persona.id;
        draft.analytics.personaDistribution[personaKey] = 
          (draft.analytics.personaDistribution[personaKey] || 0) + 1;
      }
    });

    ctx.log.info(`Tree expansion completed. Total nodes: ${draft.conversationTree.length}`);
  });

/**
 * Processor to update analytics and determine completion
 */
const analyticsProcessor = createProcessor<ConversationExplorerState>('analytics')
  .withDescription('Update conversation analytics and check for completion')
  .withTimeout(5000)
  .processWithImmer((draft, ctx) => {
    ctx.log.info('📊 Updating analytics...');

    // Recalculate analytics
    const totalNodes = draft.conversationTree.length;
    const completedNodes = draft.conversationTree.filter(node => node.isComplete).length;
    const depths = draft.conversationTree.map(node => node.depth);
    
    draft.analytics.totalNodes = totalNodes;
    draft.analytics.completedNodes = completedNodes;
    draft.analytics.averageDepth = depths.length > 0 
      ? depths.reduce((sum, depth) => sum + depth, 0) / depths.length 
      : 0;
    draft.analytics.maxDepthReached = Math.max(...depths, 0);
    draft.analytics.completionRate = totalNodes > 0 ? completedNodes / totalNodes : 0;

    // Check completion criteria
    const pendingNodes = draft.conversationTree.filter(node => !node.isComplete);
    const canExpand = totalNodes < draft.config.maxTotalNodes;
    const hasReachedMaxDepth = draft.analytics.maxDepthReached >= draft.config.maxDepth - 1;

    ctx.log.info('Analytics updated', {
      totalNodes,
      completedNodes,
      pendingNodes: pendingNodes.length,
      canExpand,
      hasReachedMaxDepth,
      completionRate: draft.analytics.completionRate,
    });

    // Determine if pipeline is complete
    if (pendingNodes.length === 0 && (!canExpand || hasReachedMaxDepth)) {
      draft.pipeline.stage = 'completed';
      draft.pipeline.isComplete = true;
      draft.pipeline.completedAt = new Date().toISOString();
      ctx.log.info('🎉 Conversation exploration completed!');
    }

    // Update iteration count
    draft.pipeline.iterationCount++;
  });

// === Pipeline Composition ===

/**
 * Main conversation exploration pipeline
 */
const conversationPipeline = chainProcessors(
  'conversationExploration',
  responseGeneratorProcessor,
  treeExpansionProcessor,
  analyticsProcessor
);

// === State Factory ===

/**
 * Create initial conversation explorer state
 */
function createConversationExplorerState(
  personas: NonEmptyArray<Persona>,
  initialPrompts: NonEmptyArray<string>,
  config: Partial<ConversationTreeConfig> = {}
): ConversationExplorerState {
  const sessionId = `conversation-${Date.now()}`;
  const now = new Date().toISOString();
  
  const finalConfig: ConversationTreeConfig = {
    maxDepth: 4,
    maxNodesPerLevel: 3,
    maxTotalNodes: 25,
    branchingFactor: 2,
    responseTimeout: 30000,
    ...config,
  };

  // Create initial conversation nodes
  const initialNodes: ConversationNode[] = initialPrompts.map((prompt, index) => {
    const persona = personas[index % personas.length];
    
    if (!persona) {
      throw new Error(`No persona available at index ${index % personas.length}`);
    }
    
    return {
      id: `root_${index}_${Date.now()}`,
      depth: 0,
      prompt,
      persona,
      parentId: undefined,
      childIds: [],
      isComplete: false,
      createdAt: now,
    };
  });

  // Initialize persona distribution
  const personaDistribution: Record<string, number> = {};
  initialNodes.forEach(node => {
    personaDistribution[node.persona.id] = (personaDistribution[node.persona.id] || 0) + 1;
  });

  const baseState = createAppState(sessionId, {
    __brand: 'conversation-explorer' as const,
    config: finalConfig,
    personas,
    conversationTree: initialNodes,
    analytics: {
      totalNodes: initialNodes.length,
      completedNodes: 0,
      averageDepth: 0,
      maxDepthReached: 0,
      totalProcessingTime: 0,
      averageResponseTime: 0,
      completionRate: 0,
      personaDistribution,
    },
    pipeline: {
      stage: 'initializing' as const,
      currentDepth: 0,
      isComplete: false,
      startedAt: now,
      iterationCount: 0,
    },
  });

  return baseState as ConversationExplorerState;
}

// === Main Runner ===

/**
 * Run the conversation exploration process
 */
export async function runConversationExplorer(
  personas: NonEmptyArray<Persona>,
  initialPrompts: NonEmptyArray<string>,
  config?: Partial<ConversationTreeConfig>,
  logger?: Logger
): Promise<ConversationExplorerState> {
  const log = logger || createLogger(
    { component: 'ConversationExplorer' },
    'info',
    createColoredFormatter()
  );

  log.info('🚀 Starting conversation exploration', {
    personaCount: personas.length,
    initialPrompts: initialPrompts.length,
    config,
  });

  // Create initial state
  const initialState = createConversationExplorerState(personas, initialPrompts, config);
  
  // Create runtime and register processors
  const runtime = createLocalRuntime<ConversationExplorerState>(log);
  runtime.register(conversationPipeline);
  
  await runtime.start();

  try {
    let currentState = initialState;
    const maxIterations = 15;
    let iteration = 0;

    while (iteration < maxIterations && !currentState.pipeline.isComplete) {
      iteration++;
      
      log.info(`Starting iteration ${iteration}/${maxIterations}`);
      
      const result = await runtime.execute(
        conversationPipeline.name,
        currentState,
        currentState.metadata.sessionId
      );

      if (!result.success) {
        log.error('Pipeline iteration failed', result.error);
        throw result.error;
      }

      currentState = result.state;
      
      // Log progress
      log.info('Iteration completed', {
        iteration,
        stage: currentState.pipeline.stage,
        totalNodes: currentState.analytics.totalNodes,
        completedNodes: currentState.analytics.completedNodes,
        completionRate: `${(currentState.analytics.completionRate * 100).toFixed(1)}%`,
        maxDepth: currentState.analytics.maxDepthReached,
      });

      // Small delay between iterations for demo purposes
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (!currentState.pipeline.isComplete) {
      log.warn(`Exploration stopped after ${maxIterations} iterations without completion`);
    }

    return currentState;

  } finally {
    await runtime.stop();
  }
}

// === Demo Function ===

/**
 * Demonstrate the conversation explorer with sample data
 */
export async function demonstrateConversationExplorer(): Promise<void> {
  console.log('🚀 AM2Z v4.0 - Advanced Conversation Explorer Demo\n');

  // Sample personas
  const personas = createNonEmptyArray([
    {
      id: 'tech_professional',
      name: 'Alex Chen',
      demographics: {
        age: 32,
        occupation: 'Software Engineer',
        location: 'San Francisco, CA',
        familyStatus: 'Young professional, recently married',
      },
      preferences: {
        primaryInterest: 'Innovation and Technology',
        priorityLevel: 8,
        budgetSensitivity: 6,
        technologyAdoption: 9,
      },
      motivations: [
        'Stay ahead with latest technology',
        'Optimize for long-term value',
        'Minimize maintenance overhead',
      ],
      concerns: [
        'Technology becoming obsolete quickly',
        'Hidden costs and fees',
        'Time investment for learning new systems',
      ],
    },
    {
      id: 'family_focused',
      name: 'Maria Rodriguez',
      demographics: {
        age: 38,
        occupation: 'Marketing Manager',
        location: 'Austin, TX',
        familyStatus: 'Married with two children (8 and 12)',
      },
      preferences: {
        primaryInterest: 'Family Safety and Convenience',
        priorityLevel: 9,
        budgetSensitivity: 7,
        technologyAdoption: 6,
      },
      motivations: [
        'Ensure family safety and security',
        'Maximize convenience for busy schedule',
        'Get reliable, proven solutions',
      ],
      concerns: [
        'Complexity affecting family members',
        'Reliability during critical moments',
        'Value for money with family budget',
      ],
    },
    {
      id: 'sustainability_advocate',
      name: 'David Kim',
      demographics: {
        age: 29,
        occupation: 'Environmental Consultant',
        location: 'Portland, OR',
        familyStatus: 'Single, environmentally conscious',
      },
      preferences: {
        primaryInterest: 'Environmental Impact',
        priorityLevel: 9,
        budgetSensitivity: 8,
        technologyAdoption: 7,
      },
      motivations: [
        'Minimize environmental footprint',
        'Support sustainable practices',
        'Choose ethical companies',
      ],
      concerns: [
        'Greenwashing and false claims',
        'Higher upfront costs',
        'Limited options in sustainable choices',
      ],
    },
  ]);

  // Initial conversation starters
  const initialPrompts = createNonEmptyArray([
    "What are the most important factors to consider when making a major technology investment for your lifestyle?",
    "How do you balance innovation with reliability when choosing products or services?",
  ]);

  try {
    const result = await runConversationExplorer(
      personas,
      initialPrompts,
      {
        maxDepth: 3,
        maxTotalNodes: 20,
        branchingFactor: 2,
      }
    );

    // Display results
    console.log('\n🎉 Exploration Completed!');
    console.log('═'.repeat(60));
    
    console.log(`\n📊 Final Analytics:`);
    console.log(`  • Total nodes generated: ${result.analytics.totalNodes}`);
    console.log(`  • Completed responses: ${result.analytics.completedNodes}`);
    console.log(`  • Completion rate: ${(result.analytics.completionRate * 100).toFixed(1)}%`);
    console.log(`  • Average depth: ${result.analytics.averageDepth.toFixed(1)}`);
    console.log(`  • Maximum depth reached: ${result.analytics.maxDepthReached}`);
    console.log(`  • Total processing time: ${result.analytics.totalProcessingTime.toFixed(0)}ms`);
    console.log(`  • Average response time: ${result.analytics.averageResponseTime.toFixed(0)}ms`);

    console.log(`\n👥 Persona Distribution:`);
    Object.entries(result.analytics.personaDistribution).forEach(([personaId, count]) => {
      const persona = personas.find(p => p.id === personaId);
      console.log(`  • ${persona?.name || personaId}: ${count} nodes`);
    });

    console.log(`\n🌳 Conversation Tree Structure:`);
    
    // Display tree in a hierarchical format
    const displayNode = (node: ConversationNode, indent: string = ''): void => {
      const status = node.isComplete ? '✅' : '⏳';
      const metrics = node.processingMetrics 
        ? ` (${node.processingMetrics.processingTimeMs.toFixed(0)}ms, ${node.processingMetrics.tokenCount} tokens)`
        : '';
      
      console.log(`${indent}${status} [${node.persona.name}] ${node.prompt}`);
      
      if (node.response && node.isComplete) {
        const responsePreview = node.response.length > 80 
          ? node.response.substring(0, 80) + '...'
          : node.response;
        console.log(`${indent}    💬 ${responsePreview}${metrics}`);
      }

      // Display children
      const children = result.conversationTree.filter(n => n.parentId === node.id);
      children.forEach(child => {
        displayNode(child, indent + '  ');
      });
    };

    // Display root nodes and their trees
    const rootNodes = result.conversationTree.filter(node => !node.parentId);
    rootNodes.forEach(node => displayNode(node));

    console.log(`\n✨ AM2Z v4.0 Improvements Demonstrated:`);
    console.log('  🎯 Type-safe state management with branded types');
    console.log('  🔄 Composable processor architecture');
    console.log('  🛡️ Robust error handling with specific error types');
    console.log('  📊 Comprehensive analytics and metrics');
    console.log('  🌳 Hierarchical conversation tree structure');
    console.log('  🚀 Scalable from local to distributed execution');
    console.log('  🔍 Detailed logging and observability');

  } catch (error) {
    console.error('\n❌ Conversation exploration failed:', error);
    
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      });
    }
  }
}

// Run demo if this file is executed directly
if (require.main === module) {
  demonstrateConversationExplorer().catch(console.error);
}