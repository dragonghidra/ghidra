/**
 * Test script demonstrating Claude Code style interface
 * Shows the new visual design matching Claude Code's aesthetic
 */

import { Display } from '../dist/ui/display.js';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function demonstrateClaudeCodeStyle() {
  console.log('\n🎨 APT CLI - Claude Code Style Demo\n');

  const display = new Display();

  // 1. Welcome Banner (Claude Code style)
  console.log('═'.repeat(60));
  console.log('1. WELCOME BANNER (Claude Code Style)');
  console.log('═'.repeat(60));
  display.showWelcome(
    'APT Max',
    'apt-code',
    'deepseek-reasoner',
    'deepseek',
    '/Users/bo/GitHub/tools_second_refactor',
    '1.0.4'
  );

  await sleep(1500);

  // 2. No verbose tool listing (like Claude Code)
  console.log('\n═'.repeat(60));
  console.log('2. CLEAN STARTUP (No Verbose Tool List)');
  console.log('═'.repeat(60));
  console.log('✓ Tools are available but not listed on startup');
  console.log('✓ Matches Claude Code\'s minimal approach\n');

  await sleep(1000);

  // 3. Spinner Animation (Claude Code style: ∴ and ✻)
  console.log('\n═'.repeat(60));
  console.log('3. THINKING SPINNER (∴ and ✻ symbols)');
  console.log('═'.repeat(60));
  display.showThinking('Thinking…');
  await sleep(2000);
  display.stopThinking();

  // 4. Thought Display (Claude Code style: ⏺ prefix)
  console.log('\n═'.repeat(60));
  console.log('4. THOUGHT DISPLAY (Compact ⏺ Style)');
  console.log('═'.repeat(60));
  display.showAssistantMessage(
    "I'll look at the file you have open and identify an opportunity to simplify it while improving correctness.",
    { isFinal: false }
  );

  await sleep(1000);

  // 5. Tool Execution Display (Claude Code format)
  console.log('\n═'.repeat(60));
  console.log('5. TOOL EXECUTION (Claude Code Format)');
  console.log('═'.repeat(60));

  const toolActions = [
    {
      name: 'Read',
      args: { file_path: 'src/shell/interactiveShell.ts' },
      output: Array(1859).fill('line').join('\n')
    },
    {
      name: 'Grep',
      args: { pattern: 'handleRequest' },
      output: 'Found 5 matches'
    },
    {
      name: 'Edit',
      args: { file_path: 'src/utils/errorUtils.ts' },
      output: 'Changes applied'
    },
  ];

  for (const tool of toolActions) {
    display.showThinking(`Running ${tool.name}...`);
    await sleep(800);
    display.stopThinking();

    // Simulate tool result display
    const lines = tool.output.split('\n').filter(l => l.trim());
    const lineCount = lines.length;

    let resultText = '';
    if (tool.name === 'Read') {
      resultText = `${tool.name}(${tool.args.file_path})\n  ⎿  Read ${lineCount} lines`;
    } else if (tool.name === 'Grep') {
      resultText = `${tool.name}("${tool.args.pattern}")\n  ⎿  Found matches`;
    } else if (tool.name === 'Edit') {
      resultText = `${tool.name}(${tool.args.file_path})\n  ⎿  Changes applied`;
    }

    display.showAction(resultText, 'success');
    await sleep(500);
  }

  // 6. More thoughts
  console.log('\n═'.repeat(60));
  console.log('6. ADDITIONAL THOUGHTS');
  console.log('═'.repeat(60));
  display.showAssistantMessage(
    "Now let me analyze the results and formulate a response.",
    { isFinal: false }
  );

  await sleep(1000);

  // 7. Final response
  console.log('\n═'.repeat(60));
  console.log('7. FINAL RESPONSE (Chat Box)');
  console.log('═'.repeat(60));
  display.showAssistantMessage(
    "I've identified an opportunity to simplify the error handling in `src/utils/errorUtils.ts`. " +
    "The current implementation has some unnecessary complexity that can be reduced while improving type safety.\n\n" +
    "The changes I made:\n" +
    "- Consolidated duplicate error checking logic\n" +
    "- Added proper TypeScript type guards\n" +
    "- Improved error message formatting",
    { isFinal: true, elapsedMs: 4567 }
  );

  // Summary
  console.log('\n\n' + '═'.repeat(60));
  console.log('✨ SUMMARY: Claude Code Style Features');
  console.log('═'.repeat(60));
  console.log('✓ Centered welcome banner with clean design');
  console.log('✓ No verbose tool listing on startup');
  console.log('✓ Claude-style spinner (∴ and ✻ symbols)');
  console.log('✓ Compact thought display (⏺ prefix)');
  console.log('✓ Tool results: ToolName(args) ⎿ details');
  console.log('✓ Clean action icons (⏺ for completed)');
  console.log('✓ Professional, minimal aesthetic');
  console.log('═'.repeat(60) + '\n');
}

// Run the demonstration
demonstrateClaudeCodeStyle().catch(console.error);
