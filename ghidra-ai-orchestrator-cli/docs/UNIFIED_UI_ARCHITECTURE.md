# Unified UI Architecture Documentation

## Overview

The Unified UI Layer is a comprehensive orchestration system that coordinates all UI components in the APT CLI. It provides sophisticated overlay rendering, status management, animations, interrupt handling, and telemetry collection through a single, cohesive interface.

## Architecture Components

### 1. **OverlayManager** (`src/ui/overlay/OverlayManager.ts`)

Manages terminal overlay rendering using ANSI escape sequences for precise cursor control.

**Key Features:**
- Multi-region overlay composition (status, progress, hints, alerts)
- Adaptive terminal sizing
- Output guard system to prevent conflicts
- Smart line truncation with ellipsis
- Smooth transitions

**Usage:**
```typescript
const overlayManager = new OverlayManager(process.stdout);
overlayManager.setLayout({
  regions: {
    status: { content: 'Processing...', height: 1, priority: 100 },
    progress: { content: '[████░░░░] 50%', height: 1, priority: 90 }
  },
  maxHeight: 4
});
overlayManager.show();
```

### 2. **StatusOrchestrator** (`src/ui/orchestration/StatusOrchestrator.ts`)

Unifies status management from multiple sources with priority-based resolution.

**Key Features:**
- Hierarchical status management (base + overrides)
- Tool lifecycle tracking
- Event-driven architecture
- Smart status aggregation

**Status Priority:**
1. Active interrupts (highest)
2. Running tools
3. Status overrides
4. Base status (lowest)

**Usage:**
```typescript
const orchestrator = new StatusOrchestrator();
orchestrator.setBaseStatus({ text: 'Ready', tone: 'success', startedAt: Date.now() });
orchestrator.onToolStart(toolCallRequest);
orchestrator.onToolProgress(toolId, { current: 5, total: 10 });
orchestrator.onToolComplete(toolId, result);
```

### 3. **AnimationScheduler** (`src/ui/animation/AnimationScheduler.ts`)

Coordinates all animations with frame-based updates and easing functions.

**Animation Types:**
- **Spinner**: Rotating characters for loading states
- **Progress**: Smooth progress bar transitions
- **Elapsed**: Time tracking displays
- **Transition**: Property animations with easing

**Built-in Spinners:**
- `dots`, `dots2`, `dots3`: Various dot patterns
- `line`, `pipe`: Line-based spinners
- `growVertical`, `growHorizontal`: Growing bars
- `bounce`, `circle`, `arrow`: Motion patterns

**Easing Functions:**
- Linear, Quad (In/Out/InOut), Cubic (In/Out/InOut)
- Elastic Out for bouncy effects

**Usage:**
```typescript
const scheduler = new AnimationScheduler(30); // 30 FPS
const spinner = scheduler.createSpinner('loading', 'Processing...', AnimationScheduler.SpinnerFrames.dots);
const progress = scheduler.createProgress('upload', 0, 100, 500); // 500ms duration
scheduler.updateProgress('upload', 50); // Animate to 50%
```

### 4. **InterruptManager** (`src/ui/interrupts/InterruptManager.ts`)

Manages user interruptions with sophisticated priority queuing and transitions.

**Priority Levels:**
- `CRITICAL` (100): System errors, critical failures
- `HIGH` (75): User cancellations, important alerts
- `NORMAL` (50): Standard user input, questions
- `LOW` (25): Hints, suggestions
- `BACKGROUND` (0): Non-urgent notifications

**Features:**
- Priority-based queuing
- Interrupt deferrals (up to 3 times by default)
- Time-to-live (TTL) for auto-expiration
- Blocking interrupts
- Smooth transition animations

**Usage:**
```typescript
const manager = new InterruptManager();
const id = manager.queue({
  type: 'confirmation',
  priority: InterruptPriority.HIGH,
  message: 'Confirm deletion?',
  ttl: 30000, // 30 second timeout
  handler: async (interrupt) => {
    // Handle user response
  }
});
```

### 5. **UITelemetry** (`src/ui/telemetry/UITelemetry.ts`)

Comprehensive telemetry collection for performance monitoring and optimization.

**Metrics Collected:**
- Event tracking with metadata
- Performance timing (render, response)
- User interaction tracking
- Frame rate monitoring
- Memory usage tracking
- Error logging with context

**Performance Thresholds:**
- Render time: 16ms (60 FPS target)
- Response time: 100ms maximum
- Frame rate: 30 FPS minimum
- Memory: 500MB threshold

**Usage:**
```typescript
const telemetry = new UITelemetry({ enabled: true });
telemetry.markStart('operation.heavy');
// ... perform operation ...
const duration = telemetry.markEnd('operation.heavy');

const interaction = telemetry.recordInteraction('command', '/help');
// ... process command ...
interaction.complete();
```

### 6. **UnifiedUIController** (`src/ui/UnifiedUIController.ts`)

Central orchestration layer that coordinates all UI components.

**Key Features:**
- Unified event handling
- Adaptive performance modes (high/balanced/low)
- Automatic memory management
- Tool execution coordination
- Telemetry integration

**Performance Modes:**
- **High**: 60 FPS, all animations enabled
- **Balanced**: 30 FPS, standard animations
- **Low**: 10 FPS, minimal animations

**Usage:**
```typescript
const controller = new UnifiedUIController(process.stdout, {
  enableOverlay: true,
  enableAnimations: true,
  enableTelemetry: true,
  adaptivePerformance: true
});

// Tool execution
controller.onToolStart(toolCallRequest);
controller.onToolProgress(toolId, { current: 5, total: 10 });
controller.onToolComplete(toolId, result);

// Status management
controller.setBaseStatus('Ready', 'success');
controller.pushStatusOverride('processing', 'Working...', 'Step 1', 'info');

// Interrupts
const id = controller.queueInterrupt('alert', 'Important!', InterruptPriority.HIGH);
controller.completeInterrupt(id);
```

### 7. **ShellUIAdapter** (`src/ui/ShellUIAdapter.ts`)

Bridge between the unified UI system and existing shell infrastructure.

**Features:**
- Backward compatibility with legacy components
- Feature flag for gradual migration
- Tool observer factory
- Telemetry access

**Usage:**
```typescript
const adapter = new ShellUIAdapter(process.stdout, display, {
  useUnifiedUI: true,
  preserveCompatibility: true,
  enableTelemetry: true
});

// Create tool observer for agent
const observer = adapter.createToolObserver();

// Processing lifecycle
adapter.startProcessing('Working on your request');
// ... process request ...
adapter.endProcessing('Ready for prompts');

// Context updates
adapter.updateContextUsage(75); // 75% used

// Interrupts
const id = adapter.showInterrupt('Confirm?', 'confirmation');
adapter.completeInterrupt(id);
```

## Integration Guide

### Step 1: Initialize the UI System

```typescript
import { ShellUIAdapter } from './ui/ShellUIAdapter';
import { Display } from './ui/display';

const display = new Display(process.stdout);
const uiAdapter = new ShellUIAdapter(process.stdout, display, {
  useUnifiedUI: true,
  enableTelemetry: true
});
```

### Step 2: Connect Tool Execution

```typescript
const toolObserver = uiAdapter.createToolObserver();

agent.setToolRuntimeObserver(toolObserver);
```

### Step 3: Manage Processing States

```typescript
// When starting to process a request
uiAdapter.startProcessing('Working on your request');

// During processing
uiAdapter.updateContextUsage(percentageUsed);

// When complete
uiAdapter.endProcessing('Ready for prompts');
```

### Step 4: Handle Interrupts

```typescript
// Show confirmation
const id = uiAdapter.showInterrupt(
  'Do you want to continue?',
  'confirmation',
  async () => {
    // Handle user response
  }
);

// Complete when done
uiAdapter.completeInterrupt(id);
```

### Step 5: Monitor Performance

```typescript
// Get telemetry data
const telemetry = uiAdapter.getTelemetry();
console.log('Performance:', telemetry.performance);
console.log('Events:', telemetry.snapshot.events);

// React to performance issues
controller.on('ui.performance.adjusted', ({ from, to }) => {
  console.log(`Performance mode changed: ${from} -> ${to}`);
});
```

## Migration from Legacy System

The system supports gradual migration through feature flags:

```typescript
// Start with compatibility mode
const adapter = new ShellUIAdapter(stream, display, {
  useUnifiedUI: false,  // Use legacy system
  preserveCompatibility: true
});

// Test unified UI
adapter.switchUIMode(true);

// Verify functionality
// ...

// Commit to unified UI
adapter.updateConfig({ useUnifiedUI: true });
```

## Performance Optimization

### Adaptive Performance

The system automatically adjusts quality based on performance:

1. **Monitors key metrics**: Frame rate, render time, memory usage
2. **Adjusts dynamically**: Reduces animations, lowers FPS, clears buffers
3. **Maintains responsiveness**: Prioritizes user interaction over visual effects

### Manual Optimization

```typescript
// Reduce animation quality
controller.updateConfig({
  enableAnimations: false  // Disable non-essential animations
});

// Adjust frame rate
animationScheduler.setTargetFPS(15);  // Lower FPS for better performance

// Clear old data
telemetry.flush();  // Clear telemetry buffers
interruptManager.clearAll();  // Clear pending interrupts
```

## Event System

The unified UI emits various events for monitoring:

```typescript
// UI Controller events
controller.on('ui.initialized', () => {});
controller.on('ui.state.changed', (state) => {});
controller.on('ui.overlay.updated', (regions) => {});
controller.on('ui.performance.adjusted', ({ from, to }) => {});

// Status events
orchestrator.subscribe((event) => {
  switch(event.type) {
    case 'tool.start':
    case 'tool.progress':
    case 'tool.complete':
    case 'tool.error':
      // Handle tool events
      break;
  }
});

// Animation events
scheduler.on('spinner:frame', (data) => {});
scheduler.on('progress:update', (data) => {});
scheduler.on('elapsed:update', (data) => {});

// Interrupt events
interruptManager.on('interrupt:activated', (interrupt) => {});
interruptManager.on('interrupt:completed', (interrupt) => {});
interruptManager.on('interrupt:expired', (interrupt) => {});
```

## Testing

Comprehensive test suite included in `src/ui/__tests__/unifiedUI.test.ts`:

```bash
npm test -- unifiedUI
```

Test coverage includes:
- Overlay rendering and truncation
- Status priority resolution
- Animation frame updates
- Interrupt queuing and expiration
- Telemetry collection
- Performance mode switching
- Integration flows

## Best Practices

1. **Always use output guards** when writing to terminal to prevent overlay corruption
2. **Set appropriate interrupt priorities** to ensure critical messages are shown first
3. **Monitor telemetry** to identify performance bottlenecks
4. **Use feature flags** for gradual rollout and A/B testing
5. **Clean up resources** by calling `dispose()` when shutting down
6. **Batch status updates** to reduce rendering overhead
7. **Use appropriate animation FPS** based on terminal capabilities

## Troubleshooting

### Overlay not showing
- Check `isEnabled` state
- Verify output guards are balanced
- Ensure terminal supports ANSI escape codes

### Poor performance
- Check telemetry for slow operations
- Verify adaptive performance is enabled
- Consider reducing animation FPS
- Check for memory leaks

### Interrupts not appearing
- Verify priority levels
- Check TTL hasn't expired
- Ensure queue isn't full
- Check for blocking interrupts

## Future Enhancements

Potential improvements for the unified UI system:

1. **Multi-line progress bars** for parallel operations
2. **Rich media support** (images, charts in capable terminals)
3. **Theme customization** with user-defined colors
4. **Persistent telemetry** with SQLite backend
5. **Remote UI streaming** for web-based interfaces
6. **Accessibility features** (screen reader support)
7. **Plugin architecture** for custom UI components
8. **Predictive performance** using ML models

## Conclusion

The Unified UI Layer provides a robust, performant, and extensible foundation for terminal UI in the APT CLI. Its modular architecture, comprehensive telemetry, and adaptive performance ensure a smooth user experience across diverse terminal environments and system capabilities.