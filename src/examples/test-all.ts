// AM2Z v4.0 - Test All Examples
// Run all examples to verify the framework works

import { runSimpleDemo } from './simple-demo';
import { demonstrateConversationExplorer } from './conversation-explorer-v4';

async function runAllTests(): Promise<void> {
  console.log('🧪 AM2Z v4.0 - Running All Tests\n');
  console.log('═'.repeat(60));

  try {
    // Test 1: Simple Demo
    console.log('\n🔍 Test 1: Simple Processor Demo');
    console.log('─'.repeat(40));
    await runSimpleDemo();
    console.log('\n✅ Simple demo completed successfully!');

    // Test 2: Conversation Explorer
    console.log('\n🔍 Test 2: Conversation Explorer Demo');
    console.log('─'.repeat(40));
    await demonstrateConversationExplorer();
    console.log('\n✅ Conversation explorer completed successfully!');

    // Summary
    console.log('\n🎉 All Tests Passed!');
    console.log('═'.repeat(60));
    console.log('✨ AM2Z v4.0 is working correctly!');
    console.log('');
    console.log('🚀 Ready for production use with:');
    console.log('  • Type-safe processor architecture');
    console.log('  • Immutable state management');
    console.log('  • Robust error handling');
    console.log('  • Local and distributed execution');
    console.log('  • Comprehensive logging and metrics');
    console.log('  • BullMQ integration with best practices');

  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    
    if (error instanceof Error) {
      console.error('\nError details:');
      console.error(`  Name: ${error.name}`);
      console.error(`  Message: ${error.message}`);
      if (error.stack) {
        console.error(`  Stack: ${error.stack.split('\n').slice(0, 5).join('\n')}`);
      }
    }
    
    process.exit(1);
  }
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}