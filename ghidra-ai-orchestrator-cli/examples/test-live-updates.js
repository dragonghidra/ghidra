/**
 * Test script for live updates and spinner system
 * Demonstrates the comprehensive AI thinking and tool execution feedback
 */

import { Display } from '../dist/ui/display.js';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function demonstrateLiveUpdates() {
  console.log('🚀 Testing Live Updates and Spinner System\n');

  const display = new Display();

  try {
    // 1. Start thinking
    console.log('━'.repeat(60));
    console.log('📝 Phase 1: Initial AI Thinking');
    console.log('━'.repeat(60));
    display.showThinking('Working on your request...');
    await sleep(1500);

    // 2. Simulate thought streaming
    console.log('\n━'.repeat(60));
    console.log('💭 Phase 2: Streaming Thoughts');
    console.log('━'.repeat(60));

    const thoughts = [
      'Analyzing the problem structure',
      'Considering multiple approaches to solve this',
      'Need to check the existing codebase first',
    ];

    for (const thought of thoughts) {
      display.updateThinking(`💭 ${thought}`);
      display.showAssistantMessage(thought, { isFinal: false });
      await sleep(1000);
    }

    // 3. Simulate tool executions
    console.log('\n━'.repeat(60));
    console.log('🔧 Phase 3: Tool Executions with Live Updates');
    console.log('━'.repeat(60));

    const tools = [
      { emoji: '📖', action: 'Reading src/main.ts', duration: 800 },
      { emoji: '🔍', action: 'Searching for: handleRequest', duration: 600 },
      { emoji: '✏️', action: 'Editing src/main.ts', duration: 1000 },
      { emoji: '⚙️', action: 'Running: npm test', duration: 1200 },
    ];

    for (const tool of tools) {
      display.updateThinking(`${tool.emoji} ${tool.action}`);
      await sleep(tool.duration);
      display.showAction(tool.action, 'success');
    }

    // 4. Back to thinking
    console.log('\n━'.repeat(60));
    console.log('🤔 Phase 4: Analyzing Results');
    console.log('━'.repeat(60));
    display.updateThinking('Analyzing results...');
    await sleep(800);

    // 5. More thoughts
    const finalThoughts = [
      'Tests passed successfully',
      'Changes look good, ready to respond',
    ];

    for (const thought of finalThoughts) {
      display.updateThinking(`💭 ${thought}`);
      display.showAssistantMessage(thought, { isFinal: false });
      await sleep(700);
    }

    // 6. Final response
    console.log('\n━'.repeat(60));
    console.log('✅ Phase 5: Final Response');
    console.log('━'.repeat(60));
    display.updateThinking('Formulating response...');
    await sleep(500);

    display.stopThinking();
    display.showAssistantMessage(
      'I\'ve successfully analyzed the codebase and implemented the requested changes. The tests are passing and everything looks good!',
      { isFinal: true }
    );

    console.log('\n━'.repeat(60));
    console.log('✨ Complete! All phases demonstrated successfully');
    console.log('━'.repeat(60));

    console.log('\n📊 Summary of Live Update Features:');
    console.log('  ✓ Persistent animated spinner while AI is active');
    console.log('  ✓ Live thought streaming with spinner updates');
    console.log('  ✓ Real-time tool execution feedback');
    console.log('  ✓ Dynamic spinner messages for each action');
    console.log('  ✓ Emoji indicators for different tool types');
    console.log('  ✓ Smooth transitions between states\n');

  } catch (error) {
    console.error('❌ Error during demo:', error);
  }
}

// Run the demonstration
demonstrateLiveUpdates().catch(console.error);
