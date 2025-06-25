// AM2Z v4.0 - Simple Demo
// Basic usage demonstration

import {
  createProcessor,
  chainProcessors,
  createLocalRuntime,
  createAppState,
  type BrandedState,
  createLogger,
  createColoredFormatter,
} from '../lib/core';

// === Simple State Definition ===

type SimpleAppState = BrandedState<'simple-demo', {
  counter: number;
  messages: string[];
  processedAt?: string;
}>;

// === Simple Processors ===

const incrementProcessor = createProcessor<SimpleAppState>('increment')
  .withDescription('Increment the counter')
  .process(async (state, ctx) => {
    ctx.log.info(`Incrementing counter from ${state.counter}`);
    const newCounter = state.counter + 1;
    const newMessages = [...state.messages, `Counter incremented to ${newCounter}`];

    return {
      success: true,
      data: {
        ...state,
        counter: newCounter,
        messages: newMessages,
      },
    };
  });

const timestampProcessor = createProcessor<SimpleAppState>('timestamp')
  .withDescription('Add processing timestamp')
  .process(async (state, ctx) => {
    const now = new Date().toISOString();
    ctx.log.info('Adding timestamp');
    state.processedAt = now;
    const newMessages = [...state.messages, `Processed at ${now}`];

    return {
      success: true,
      data: {
        ...state,
        messages: newMessages,
      },
    };
  });

// === Pipeline ===

const simplePipeline = chainProcessors(
  'simplePipeline',
  incrementProcessor,
  timestampProcessor
);

// === Demo Function ===

export async function runSimpleDemo(): Promise<void> {
  console.log('🚀 AM2Z v4.0 - Simple Demo\n');

  // Create logger
  const logger = createLogger(
    { demo: 'simple' },
    'info',
    createColoredFormatter()
  );

  // Create initial state
  const initialState = createAppState('simple-demo-session', {
    __brand: 'simple-demo' as const,
    counter: 0,
    messages: [],
  }) as SimpleAppState;

  logger.info('Created initial state', {
    counter: initialState.counter,
    messages: initialState.messages.length,
  });

  // Create runtime with proper typing
  const runtime = createLocalRuntime<SimpleAppState>(logger);
  runtime.register(simplePipeline);
  
  await runtime.start();

  try {
    // Execute pipeline
    logger.info('Executing simple pipeline...');
    
    const result = await runtime.execute(
      simplePipeline.name,
      initialState,
      'simple-demo-session'
    );

    if (result.success) {
      logger.info('Pipeline completed successfully!', {
        executionTime: result.executionTime,
        finalCounter: result.state.counter,
        messageCount: result.state.messages.length,
      });

      console.log('\n📊 Results:');
      console.log(`  • Final counter: ${result.state.counter}`);
      console.log(`  • Processing time: ${result.executionTime}ms`);
      console.log(`  • Messages generated: ${result.state.messages.length}`);
      console.log(`  • Processed at: ${result.state.processedAt}`);
      
      console.log('\n📝 Message log:');
      result.state.messages.forEach((msg: string, i: number) => {
        console.log(`  ${i + 1}. ${msg}`);
      });
      
      console.log('\n✨ This demonstrates:');
      console.log('  • Simple processor creation with builder pattern');
      console.log('  • Immer-based state mutations');
      console.log('  • Processor chaining');
      console.log('  • Structured logging with context');
      console.log('  • Type-safe state management');
      
    } else {
      logger.error('Pipeline execution failed', result.error);
      throw result.error;
    }

  } finally {
    await runtime.stop();
  }
}

// Run demo if executed directly
if (require.main === module) {
  runSimpleDemo().catch(console.error);
}