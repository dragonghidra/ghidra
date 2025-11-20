/**
 * Test script for the Unified UI System
 * This demonstrates the capabilities of the new UI layer
 */

import { UnifiedUIController } from '../dist/ui/UnifiedUIController.js';
import { AnimationScheduler } from '../dist/ui/animation/AnimationScheduler.js';
import { InterruptPriority } from '../dist/ui/interrupts/InterruptManager.js';
import { Writable } from 'stream';

// Create a mock write stream for testing
class TestStream extends Writable {
  _write(chunk, encoding, callback) {
    process.stdout.write(chunk);
    callback();
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function demonstrateUnifiedUI() {
  console.log('🚀 Starting Unified UI System Demo\n');

  const stream = new TestStream();
  const controller = new UnifiedUIController(stream, {
    enableOverlay: true,
    enableAnimations: true,
    enableTelemetry: true,
    adaptivePerformance: true,
    debugMode: false,
  });

  try {
    // 1. Demonstrate processing states
    console.log('📝 Testing processing states...\n');
    controller.startProcessing();
    controller.setBaseStatus('Initializing system', 'info');
    await sleep(1000);

    // 2. Demonstrate tool execution
    console.log('\n🔧 Simulating tool execution...\n');
    const toolCall = {
      id: 'tool-001',
      name: 'read_file',
      arguments: { file_path: '/test/file.txt' },
    };

    controller.onToolStart(toolCall);
    await sleep(500);

    // Simulate progress
    for (let i = 0; i <= 100; i += 20) {
      controller.onToolProgress('tool-001', {
        current: i,
        total: 100,
        message: `Processing ${i}%`,
      });
      await sleep(300);
    }

    controller.onToolComplete('tool-001', { success: true });
    await sleep(500);

    // 3. Demonstrate status overrides
    console.log('\n📊 Testing status overrides...\n');
    controller.pushStatusOverride('analysis', 'Analyzing code', 'Found 3 issues', 'warning');
    await sleep(1500);
    controller.clearStatusOverride('analysis');

    // 4. Demonstrate context usage
    console.log('\n💾 Testing context usage display...\n');
    const contextLevels = [25, 50, 75, 92];
    for (const level of contextLevels) {
      controller.pushStatusOverride('context', `Context ${level}% used`, undefined,
        level > 90 ? 'danger' : level > 70 ? 'warning' : 'info');
      await sleep(800);
    }
    controller.clearStatusOverride('context');

    // 5. Demonstrate interrupts
    console.log('\n🔔 Testing interrupt system...\n');
    const interruptId = controller.queueInterrupt(
      'alert',
      'Important: System update available',
      InterruptPriority.HIGH
    );
    await sleep(2000);
    controller.completeInterrupt(interruptId);

    // 6. Demonstrate animations
    console.log('\n✨ Testing animation system...\n');
    controller.setBaseStatus('Running analysis', 'info');

    // Simulate multiple tools running
    const tools = [
      { id: 'scan-001', name: 'security_scan', desc: 'Scanning for vulnerabilities' },
      { id: 'test-001', name: 'run_tests', desc: 'Running test suite' },
      { id: 'lint-001', name: 'lint_code', desc: 'Checking code style' },
    ];

    for (const tool of tools) {
      controller.onToolStart({
        id: tool.id,
        name: tool.name,
        arguments: {},
      });
      await sleep(300);
    }

    await sleep(2000);

    // Complete tools
    for (const tool of tools) {
      controller.onToolComplete(tool.id, { success: true });
      await sleep(300);
    }

    // 7. Performance monitoring
    console.log('\n📈 Checking performance metrics...\n');
    const performance = controller.getPerformanceSummary();
    console.log('Performance Summary:', JSON.stringify(performance, null, 2));

    // 8. Get final state
    const state = controller.getState();
    console.log('\n📋 Final UI State:', JSON.stringify(state, null, 2));

    // End processing
    controller.endProcessing();
    controller.setBaseStatus('Demo complete', 'success');
    await sleep(1000);

    console.log('\n✅ Unified UI System demo completed successfully!\n');

  } catch (error) {
    console.error('❌ Error during demo:', error);
  } finally {
    // Cleanup
    controller.dispose();
  }
}

// Run the demo
demonstrateUnifiedUI().catch(console.error);