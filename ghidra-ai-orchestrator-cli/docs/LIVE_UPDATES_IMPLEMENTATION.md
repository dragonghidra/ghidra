# Live Updates & Spinner System Implementation

This document describes the comprehensive live update system implemented in APT CLI, similar to Claude Code's real-time feedback system.

## Overview

The live update system provides persistent, animated feedback while the AI is thinking and working. It includes:

- **Persistent animated spinner** - Continuously animates while AI is active
- **Live thought streaming** - Shows AI reasoning in real-time
- **Real-time tool execution feedback** - Updates spinner for each tool action
- **Dynamic status messages** - Context-aware messages based on current activity
- **Emoji indicators** - Visual cues for different tool types

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                   Interactive Shell                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Agent Callbacks                                      │   │
│  │  - onAssistantMessage (thoughts & responses)        │   │
│  │  - Extract thought summaries                        │   │
│  │  - Update spinner dynamically                       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Shell UI Adapter                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Tool Observer                                        │   │
│  │  - onToolStart: Update spinner with tool action     │   │
│  │  - onToolResult: Show success & reset spinner       │   │
│  │  - onToolError: Show error & reset spinner          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                      Display Layer                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Spinner Management                                   │   │
│  │  - showThinking(): Start spinner                    │   │
│  │  - updateThinking(): Update spinner message         │   │
│  │  - stopThinking(): Stop and clear spinner           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 Unified UI Controller                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Animation System                                     │   │
│  │  - Creates thinking spinner on startProcessing()    │   │
│  │  - Integrates with AnimationScheduler               │   │
│  │  - Updates status overlay with spinner frames       │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Details

### 1. Display Layer Spinner (`src/ui/display.ts`)

The display layer manages the visible terminal spinner using `nanospinner`:

```typescript
showThinking(message: string = 'Thinking...') {
  if (this.activeSpinner) {
    this.activeSpinner.stop();
  }
  this.activeSpinner = createSpinner(message).start();
}

updateThinking(message: string) {
  if (this.activeSpinner) {
    this.activeSpinner.update({ text: message });
  } else {
    this.showThinking(message);
  }
}

stopThinking() {
  if (this.activeSpinner) {
    this.activeSpinner.success();
    this.activeSpinner = null;
  }
}
```

### 2. Unified UI Spinner (`src/ui/UnifiedUIController.ts`)

The unified UI maintains an internal spinner animation for status tracking:

```typescript
startProcessing(): void {
  this.state.isProcessing = true;

  // Start the thinking spinner
  if (this.config.enableAnimations) {
    this.thinkingSpinner = this.animationScheduler.createSpinner(
      'ai-thinking',
      'Thinking...',
      AnimationScheduler.SpinnerFrames.dots
    );
    this.activeSpinners.set('ai-thinking', this.thinkingSpinner);
  }

  this.emit('ui.state.changed', { isProcessing: true });
}

endProcessing(): void {
  // Stop the thinking spinner
  if (this.thinkingSpinner) {
    this.activeSpinners.delete('ai-thinking');
    this.animationScheduler.unregister('ai-thinking');
    this.thinkingSpinner = null;
  }

  this.updateOverlay();
  this.emit('ui.state.changed', { isProcessing: false });
}
```

### 3. Tool Execution Feedback (`src/ui/ShellUIAdapter.ts`)

Real-time updates for tool execution:

```typescript
createToolObserver(): ToolRuntimeObserver {
  return {
    onToolStart: (call: ToolCallRequest) => {
      // Update spinner with tool execution status
      const description = this.describeToolForDisplay(call);
      this.display.updateThinking(description);

      this.uiController.onToolStart(call);
    },

    onToolResult: (call: ToolCallRequest, output: string) => {
      // Reset spinner to thinking state
      this.display.updateThinking('Analyzing results...');

      // Display tool result
      const summary = this.summarizeToolResult(call, output);
      this.display.showAction(summary, 'success');
    },

    onToolError: (call: ToolCallRequest, message: string) => {
      this.display.updateThinking('Handling error...');
      this.display.showAction(`Error in ${call.name}: ${message}`, 'error');
    },
  };
}
```

### 4. Tool Description Formatting

Rich, context-aware descriptions with emoji indicators:

```typescript
private describeToolForDisplay(call: ToolCallRequest): string {
  const params = call.arguments as any;
  switch (call.name) {
    case 'Read':
      return `📖 Reading ${this.truncatePath(params.file_path)}`;
    case 'Edit':
      return `✏️  Editing ${this.truncatePath(params.file_path)}`;
    case 'Bash':
      return `⚙️  Running: ${this.truncateCommand(params.command)}`;
    case 'Grep':
      return `🔍 Searching for: ${this.truncateQuery(params.pattern)}`;
    case 'WebFetch':
      return `🌐 Fetching ${this.truncateUrl(params.url)}`;
    case 'WebSearch':
      return `🔎 Searching: ${this.truncateQuery(params.query)}`;
    default:
      return `🔧 Running ${this.formatToolName(call.name)}`;
  }
}
```

### 5. Live Thought Streaming (`src/shell/interactiveShell.ts`)

Extracts and displays AI reasoning in real-time:

```typescript
this.agent = this.runtimeSession.createAgent(selection, {
  onAssistantMessage: (content, metadata) => {
    // Update spinner based on message type
    if (metadata.isFinal) {
      display.updateThinking('Formulating response...');
    } else {
      // Thought/reasoning - extract key insight for spinner
      const thoughtSummary = this.extractThoughtSummary(content);
      if (thoughtSummary) {
        display.updateThinking(`💭 ${thoughtSummary}`);
      }
    }

    display.showAssistantMessage(content, enriched);
  },
});
```

### 6. Thought Summary Extraction

Intelligently extracts concise summaries from AI thoughts:

```typescript
private extractThoughtSummary(thought: string): string | null {
  // Get first non-empty line
  const lines = thought.split('\n').filter(l => l.trim());
  const firstLine = lines[0]?.trim();

  // Remove common thought prefixes
  const cleaned = firstLine
    .replace(/^(Thinking|Analyzing|Considering|Looking at|Let me)[:.\s]+/i, '')
    .replace(/^I (should|need to|will|am)[:.\s]+/i, '')
    .trim();

  // Truncate to reasonable length
  const maxLength = 50;
  return cleaned.length > maxLength
    ? cleaned.slice(0, maxLength - 3) + '...'
    : cleaned;
}
```

## Processing Lifecycle

### Full Request Flow

```
User sends request
        ↓
1. display.showThinking('Working on your request...')
        ↓
2. uiAdapter.startProcessing()
        ↓
3. UnifiedUI creates thinking spinner animation
        ↓
4. Agent starts processing
        ↓
5. Thoughts arrive → extract summary → update spinner
   "💭 Analyzing the problem structure"
        ↓
6. Tool execution starts → update spinner
   "📖 Reading src/main.ts"
        ↓
7. Tool completes → reset spinner
   "Analyzing results..."
        ↓
8. More thoughts → update spinner
   "💭 Tests passed successfully"
        ↓
9. Final response → update spinner
   "Formulating response..."
        ↓
10. display.stopThinking()
        ↓
11. uiAdapter.endProcessing()
        ↓
12. UnifiedUI cleans up spinner
        ↓
Response complete
```

## Spinner Frame Animation

The system uses pre-built spinner frames from `AnimationScheduler`:

```typescript
static readonly SpinnerFrames = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  dots2: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
  line: ['-', '\\', '|', '/'],
  circle: ['◜', '◠', '◝', '◞', '◡', '◟'],
  // ... more spinner styles
};
```

Frames update at **10 FPS** for smooth animation without excessive CPU usage.

## Emoji Indicators

| Tool | Emoji | Description |
|------|-------|-------------|
| Read | 📖 | Reading files |
| Write | ✍️ | Writing files |
| Edit | ✏️ | Editing files |
| Bash | ⚙️ | Running commands |
| Grep | 🔍 | Searching code |
| Glob | 📁 | Listing directories |
| WebFetch | 🌐 | Fetching web content |
| WebSearch | 🔎 | Web search |
| Thought | 💭 | AI reasoning |
| Generic | 🔧 | Other tools |

## Performance Considerations

### Optimizations

1. **Adaptive Frame Rate**: Spinner runs at 10 FPS (100ms per frame)
2. **Throttled Updates**: Spinner message updates are batched
3. **Minimal Overhead**: Uses native terminal ANSI codes
4. **Smart Truncation**: Long paths/commands are intelligently shortened
5. **Lazy Cleanup**: Animations clean up automatically after completion

### Memory Management

```typescript
// Automatic cleanup in endProcessing()
if (this.thinkingSpinner) {
  this.activeSpinners.delete('ai-thinking');
  this.animationScheduler.unregister('ai-thinking');
  this.thinkingSpinner = null;
}
```

## Testing

Run the comprehensive test suite:

```bash
node examples/test-live-updates.js
```

This demonstrates:
- ✓ Persistent animated spinner while AI is active
- ✓ Live thought streaming with spinner updates
- ✓ Real-time tool execution feedback
- ✓ Dynamic spinner messages for each action
- ✓ Emoji indicators for different tool types
- ✓ Smooth transitions between states

## Configuration

The system can be configured via `UIControllerConfig`:

```typescript
const controller = new UnifiedUIController(stream, {
  enableOverlay: true,        // Show status overlay
  enableAnimations: true,     // Enable spinner animations
  enableTelemetry: true,      // Track performance metrics
  adaptivePerformance: true,  // Adjust quality based on performance
  debugMode: false,           // Debug logging
});
```

## Future Enhancements

Potential improvements:

1. **Streaming Response Display**: Character-by-character final response streaming
2. **Progress Bars**: For long-running operations with known duration
3. **Multi-Tool Parallelism**: Show multiple tools running simultaneously
4. **Custom Spinner Styles**: User-configurable spinner animations
5. **Sound Effects**: Optional audio feedback for different events
6. **Color Themes**: Customizable color schemes for different tones

## Troubleshooting

### Spinner Not Showing

**Issue**: Spinner doesn't appear during AI processing

**Solution**: Ensure `display.showThinking()` is called in `processRequest()`:

```typescript
display.showThinking('Working on your request...');
```

### Spinner Not Updating

**Issue**: Spinner message doesn't change during tool execution

**Solution**: Verify tool observer is wired correctly in `ShellUIAdapter`:

```typescript
const toolObserver = uiAdapter.createToolObserver();
```

### Multiple Spinners

**Issue**: Multiple spinners appear simultaneously

**Solution**: Ensure proper cleanup in `stopThinking()` and `endProcessing()`

## References

- **Display Layer**: `src/ui/display.ts`
- **UI Controller**: `src/ui/UnifiedUIController.ts`
- **Shell Adapter**: `src/ui/ShellUIAdapter.ts`
- **Interactive Shell**: `src/shell/interactiveShell.ts`
- **Animation System**: `src/ui/animation/AnimationScheduler.ts`
- **Test Demo**: `examples/test-live-updates.js`

## Summary

The live update system provides comprehensive, real-time feedback that keeps users informed of exactly what the AI is doing at every moment. It combines:

- Persistent visual feedback (animated spinner)
- Context-aware status messages (dynamic updates)
- Rich formatting (emoji indicators)
- Performance optimization (adaptive frame rates)
- Seamless integration (tool observer pattern)

This creates a professional, polished user experience similar to Claude Code's implementation.
