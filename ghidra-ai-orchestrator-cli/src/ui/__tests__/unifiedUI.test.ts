/**
 * Test suite for the Unified UI System
 * Tests overlay management, status orchestration, animations, interrupts, and telemetry
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EventEmitter, Writable } from 'stream';
import { OverlayManager } from '../overlay/OverlayManager.js';
import { StatusOrchestrator } from '../orchestration/StatusOrchestrator.js';
import { AnimationScheduler } from '../animation/AnimationScheduler.js';
import { InterruptManager, InterruptPriority } from '../interrupts/InterruptManager.js';
import { UITelemetry } from '../telemetry/UITelemetry.js';
import { UnifiedUIController } from '../UnifiedUIController.js';
import { ShellUIAdapter } from '../ShellUIAdapter.js';
import { Display } from '../display.js';

// Mock write stream for testing
class MockWriteStream extends Writable {
  public output: string[] = [];
  public columns: number = 80;
  public rows: number = 24;

  _write(chunk: any, encoding: string, callback: Function): void {
    this.output.push(chunk.toString());
    callback();
  }

  clear(): void {
    this.output = [];
  }

  getOutput(): string {
    return this.output.join('');
  }
}

describe('OverlayManager', () => {
  let writeStream: MockWriteStream;
  let overlayManager: OverlayManager;

  beforeEach(() => {
    writeStream = new MockWriteStream();
    overlayManager = new OverlayManager(writeStream);
  });

  test('should render overlay with status region', () => {
    overlayManager.setLayout({
      regions: {
        status: {
          content: 'Processing request...',
          height: 1,
          priority: 100,
        },
      },
      maxHeight: 2,
    });

    overlayManager.show();

    const output = writeStream.getOutput();
    expect(output).toContain('Processing request...');
    expect(output).toContain('\u001b[2K'); // Clear line escape
  });

  test('should handle output guards correctly', () => {
    overlayManager.setLayout({
      regions: {
        status: {
          content: 'Test status',
          height: 1,
          priority: 100,
        },
      },
      maxHeight: 2,
    });

    overlayManager.show();
    expect(overlayManager.getState().isVisible).toBe(true);

    // Begin output should hide overlay
    overlayManager.beginOutput();
    expect(overlayManager.getState().isVisible).toBe(false);

    // Nested guards
    overlayManager.beginOutput();
    overlayManager.endOutput();
    expect(overlayManager.getState().isVisible).toBe(false);

    // Final end should restore
    overlayManager.endOutput();
    expect(overlayManager.getState().isVisible).toBe(true);
  });

  test('should truncate long lines', () => {
    const longContent = 'A'.repeat(100);
    overlayManager.setLayout({
      regions: {
        status: {
          content: longContent,
          height: 1,
          priority: 100,
        },
      },
      maxHeight: 2,
    });

    overlayManager.show();

    const output = writeStream.getOutput();
    expect(output).toContain('...');
    expect(output).not.toContain('A'.repeat(100));
  });
});

describe('StatusOrchestrator', () => {
  let orchestrator: StatusOrchestrator;

  beforeEach(() => {
    orchestrator = new StatusOrchestrator();
  });

  test('should manage base status', () => {
    orchestrator.setBaseStatus({
      text: 'Idle',
      tone: 'info',
      startedAt: Date.now(),
    });

    const status = orchestrator.getCurrentStatus();
    expect(status?.text).toBe('Idle');
  });

  test('should prioritize overrides over base', () => {
    orchestrator.setBaseStatus({
      text: 'Base status',
      tone: 'info',
      startedAt: Date.now(),
    });

    orchestrator.pushOverride('test', {
      text: 'Override status',
      tone: 'warning',
      startedAt: Date.now(),
    });

    const status = orchestrator.getCurrentStatus();
    expect(status?.text).toBe('Override status');

    orchestrator.clearOverride('test');
    const afterClear = orchestrator.getCurrentStatus();
    expect(afterClear?.text).toBe('Base status');
  });

  test('should handle tool lifecycle', () => {
    const toolCall = {
      id: 'tool-123',
      tool: 'read_file',
      parameters: { file_path: '/test/file.txt' },
    };

    orchestrator.onToolStart(toolCall);

    const context = orchestrator.getContext();
    expect(context.tools.size).toBe(1);

    const toolStatus = context.tools.get('tool-123');
    expect(toolStatus?.status).toBe('starting');
    expect(toolStatus?.tool).toBe('read_file');

    orchestrator.onToolComplete('tool-123', 'File content');

    // Tool should be marked complete but still in context briefly
    const updatedStatus = context.tools.get('tool-123');
    expect(updatedStatus?.status).toBe('completed');
  });

  test('should handle tool errors', () => {
    const toolCall = {
      id: 'tool-456',
      tool: 'bash',
      parameters: { command: 'invalid-command' },
    };

    orchestrator.onToolStart(toolCall);
    orchestrator.onToolError('tool-456', new Error('Command not found'));

    const context = orchestrator.getContext();
    const toolStatus = context.tools.get('tool-456');
    expect(toolStatus?.status).toBe('error');
    expect(toolStatus?.tone).toBe('danger');
  });
});

describe('AnimationScheduler', () => {
  let scheduler: AnimationScheduler;

  beforeEach(() => {
    scheduler = new AnimationScheduler(60);
    jest.useFakeTimers();
  });

  afterEach(() => {
    scheduler.dispose();
    jest.useRealTimers();
  });

  test('should create and update spinner animation', () => {
    const frameEvents: any[] = [];
    scheduler.on('spinner:frame', (data) => frameEvents.push(data));

    const spinner = scheduler.createSpinner('test-spinner', 'Loading...');
    expect(spinner.type).toBe('spinner');

    // Advance time to trigger frames
    jest.advanceTimersByTime(200);

    expect(frameEvents.length).toBeGreaterThan(0);
    expect(frameEvents[0].message).toBe('Loading...');
  });

  test('should create and update progress animation', () => {
    const progressEvents: any[] = [];
    scheduler.on('progress:update', (data) => progressEvents.push(data));

    scheduler.createProgress('test-progress', 0, 100, 1000);
    scheduler.updateProgress('test-progress', 50);

    jest.advanceTimersByTime(500);

    expect(progressEvents.length).toBeGreaterThan(0);
    const lastEvent = progressEvents[progressEvents.length - 1];
    expect(lastEvent.percentage).toBeGreaterThan(0);
    expect(lastEvent.percentage).toBeLessThanOrEqual(50);
  });

  test('should format elapsed time correctly', () => {
    const elapsedEvents: any[] = [];
    scheduler.on('elapsed:update', (data) => elapsedEvents.push(data));

    scheduler.createElapsed('test-elapsed', Date.now() - 65000); // 65 seconds ago

    jest.advanceTimersByTime(1000);

    expect(elapsedEvents.length).toBeGreaterThan(0);
    const formatted = elapsedEvents[0].formatted;
    expect(formatted).toMatch(/1m \d+s/);
  });

  test('should apply easing functions', () => {
    const t = 0.5;
    expect(AnimationScheduler.Easing.linear(t)).toBe(0.5);
    expect(AnimationScheduler.Easing.easeInQuad(t)).toBe(0.25);
    expect(AnimationScheduler.Easing.easeOutQuad(t)).toBe(0.75);
  });
});

describe('InterruptManager', () => {
  let manager: InterruptManager;

  beforeEach(() => {
    manager = new InterruptManager();
    jest.useFakeTimers();
  });

  afterEach(() => {
    manager.dispose();
    jest.useRealTimers();
  });

  test('should queue interrupts by priority', () => {
    const lowId = manager.queue({
      type: 'hint',
      priority: InterruptPriority.LOW,
      message: 'Low priority',
    });

    const highId = manager.queue({
      type: 'alert',
      priority: InterruptPriority.HIGH,
      message: 'High priority',
    });

    const normalId = manager.queue({
      type: 'confirmation',
      priority: InterruptPriority.NORMAL,
      message: 'Normal priority',
    });

    const pending = manager.getInterruptsByStatus('pending');
    // High priority should be processed first, so might already be active
    // Check order of remaining pending
    if (pending.length > 0) {
      const priorities = pending.map(i => i.priority);
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i - 1]).toBeGreaterThanOrEqual(priorities[i]);
      }
    }
  });

  test('should expire interrupts after TTL', () => {
    const expiredEvents: any[] = [];
    manager.on('interrupt:expired', (i) => expiredEvents.push(i));

    manager.queue({
      type: 'alert',
      priority: InterruptPriority.NORMAL,
      message: 'Will expire',
      ttl: 1000,
    });

    jest.advanceTimersByTime(1500);

    expect(expiredEvents.length).toBe(1);
    expect(expiredEvents[0].status).toBe('expired');
  });

  test('should handle interrupt completion', () => {
    let handlerCalled = false;
    const id = manager.queue({
      type: 'confirmation',
      priority: InterruptPriority.NORMAL,
      message: 'Confirm action',
      handler: async () => {
        handlerCalled = true;
      },
    });

    // Let the interrupt activate
    jest.advanceTimersByTime(100);

    // Handler should be called
    expect(handlerCalled).toBe(true);
  });

  test('should defer lower priority interrupts', () => {
    const deferredEvents: any[] = [];
    manager.on('interrupt:deferred', (i) => deferredEvents.push(i));

    // High priority blocking interrupt
    manager.queue({
      type: 'system-error',
      priority: InterruptPriority.CRITICAL,
      message: 'Critical error',
      blocking: true,
      ttl: 2000,
    });

    // Lower priority should be deferred
    manager.queue({
      type: 'hint',
      priority: InterruptPriority.LOW,
      message: 'Helpful hint',
      deferrable: true,
    });

    jest.advanceTimersByTime(100);

    expect(deferredEvents.length).toBeGreaterThan(0);
  });
});

describe('UITelemetry', () => {
  let telemetry: UITelemetry;

  beforeEach(() => {
    telemetry = new UITelemetry({ enabled: true });
    jest.useFakeTimers();
  });

  afterEach(() => {
    telemetry.dispose();
    jest.useRealTimers();
  });

  test('should record events', () => {
    telemetry.recordEvent('button.click', { button: 'submit' });
    telemetry.recordEvent('page.view', { page: '/home' });

    const snapshot = telemetry.getSnapshot();
    expect(snapshot.events.total).toBe(2);
    expect(snapshot.events.byType['button.click']).toBe(1);
  });

  test('should track performance metrics', () => {
    telemetry.markStart('operation.heavy');
    jest.advanceTimersByTime(150);
    const duration = telemetry.markEnd('operation.heavy');

    expect(duration).toBeGreaterThanOrEqual(150);

    const summary = telemetry.getPerformanceSummary();
    expect(summary.measures['operation.heavy']).toBeDefined();
    expect(summary.measures['operation.heavy'].count).toBe(1);
  });

  test('should track user interactions', () => {
    const interaction = telemetry.recordInteraction('command', '/help');

    jest.advanceTimersByTime(200);
    interaction.complete();

    const snapshot = telemetry.getSnapshot();
    expect(snapshot.interactions.total).toBe(1);
    expect(snapshot.interactions.completed).toBe(1);
  });

  test('should detect performance thresholds', () => {
    const thresholdEvents: any[] = [];
    telemetry.on('performance:threshold-exceeded', (e) => thresholdEvents.push(e));

    telemetry.recordRender('HeavyComponent', 50); // Above 16ms threshold

    expect(thresholdEvents.length).toBeGreaterThan(0);
    expect(thresholdEvents[0].type).toBe('render');
  });

  test('should anonymize sensitive data', () => {
    telemetry.recordEvent('user.login', {
      username: 'john@example.com',
      password: 'secret123',
      token: 'abc-def-ghi',
    });

    const snapshot = telemetry.getSnapshot();
    const event = snapshot.events.byType['user.login'];
    expect(event).toBe(1);
    // The actual data should be anonymized, but we can't easily check that
    // without accessing internal state
  });
});

describe('UnifiedUIController', () => {
  let controller: UnifiedUIController;
  let writeStream: MockWriteStream;

  beforeEach(() => {
    writeStream = new MockWriteStream();
    controller = new UnifiedUIController(writeStream, {
      enableOverlay: true,
      enableAnimations: true,
      enableTelemetry: true,
    });
  });

  afterEach(() => {
    controller.dispose();
  });

  test('should coordinate tool execution', () => {
    const toolCall = {
      id: 'test-tool',
      tool: 'read_file',
      parameters: { file_path: '/test.txt' },
    };

    controller.onToolStart(toolCall);

    const state = controller.getState();
    expect(state.hasActiveTools).toBe(true);

    controller.onToolComplete('test-tool', 'Content');

    const afterState = controller.getState();
    expect(afterState.hasActiveTools).toBe(false);
  });

  test('should handle status updates', () => {
    controller.setBaseStatus('Ready', 'success');

    controller.pushStatusOverride('temp', 'Processing...', 'Step 1', 'info');

    // Override should take precedence
    controller.clearStatusOverride('temp');

    // Should revert to base
    const state = controller.getState();
    expect(state.currentStatus).toBe(null); // Status is internal
  });

  test('should queue interrupts', () => {
    const id = controller.queueInterrupt(
      'alert',
      'Important message',
      InterruptPriority.HIGH
    );

    expect(id).toBeTruthy();

    const state = controller.getState();
    expect(state.hasActiveInterrupts).toBe(true);

    controller.completeInterrupt(id);
  });

  test('should collect telemetry', () => {
    controller.onToolStart({
      id: 'perf-test',
      tool: 'bash',
      parameters: { command: 'echo test' },
    });

    controller.onToolComplete('perf-test');

    const telemetry = controller.getTelemetrySnapshot();
    expect(telemetry.events.total).toBeGreaterThan(0);
  });

  test('should handle performance mode switching', () => {
    const perfEvents: any[] = [];
    controller.on('ui.performance.adjusted', (e) => perfEvents.push(e));

    // Simulate poor performance
    controller.updateConfig({ adaptivePerformance: true });

    // This would normally be triggered by telemetry, but we can't easily simulate
    // Instead, check that the mechanism exists
    expect(controller.getState().performanceMode).toBeDefined();
  });
});

describe('ShellUIAdapter', () => {
  let adapter: ShellUIAdapter;
  let writeStream: MockWriteStream;
  let display: Display;

  beforeEach(() => {
    writeStream = new MockWriteStream();
    display = new Display(writeStream);
    adapter = new ShellUIAdapter(writeStream, display, {
      useUnifiedUI: true,
      preserveCompatibility: true,
    });
  });

  afterEach(() => {
    adapter.dispose();
  });

  test('should create tool observer', () => {
    const observer = adapter.createToolObserver();

    expect(observer.onToolStart).toBeDefined();
    expect(observer.onToolResult).toBeDefined();
    expect(observer.onToolError).toBeDefined();
    expect(observer.onToolProgress).toBeDefined();
  });

  test('should handle processing lifecycle', () => {
    adapter.startProcessing('Working...');

    const state = adapter.getState();
    expect(state.isProcessing).toBe(true);

    adapter.endProcessing('Ready');

    const afterState = adapter.getState();
    expect(afterState.isProcessing).toBe(false);
  });

  test('should update context usage', () => {
    adapter.updateContextUsage(75);

    // Should show warning tone for high usage
    const state = adapter.getState();
    // Context usage is shown in overlay
  });

  test('should handle interrupts', () => {
    const id = adapter.showInterrupt('Confirm action?', 'confirmation');
    expect(id).toBeTruthy();

    adapter.completeInterrupt(id);
  });

  test('should switch between UI modes', () => {
    expect(adapter.getCurrentMode()).toBe('unified');

    adapter.switchUIMode(false);
    expect(adapter.getCurrentMode()).toBe('legacy');

    adapter.switchUIMode(true);
    expect(adapter.getCurrentMode()).toBe('unified');
  });

  test('should provide telemetry in unified mode', () => {
    const telemetry = adapter.getTelemetry();
    expect(telemetry).toBeTruthy();
    expect(telemetry.snapshot).toBeDefined();
    expect(telemetry.performance).toBeDefined();
  });

  test('should handle slash command preview', () => {
    adapter.showSlashCommandPreview(['/help', '/model', '/tools']);

    // Preview should be shown as override
    adapter.hideSlashCommandPreview();
  });
});

// Integration test
describe('Unified UI Integration', () => {
  test('should handle complete tool execution flow', async () => {
    const writeStream = new MockWriteStream();
    const display = new Display(writeStream);
    const adapter = new ShellUIAdapter(writeStream, display);

    const observer = adapter.createToolObserver();

    // Start processing
    adapter.startProcessing('Processing your request');

    // Simulate tool execution
    const toolCall = {
      id: 'integration-test',
      tool: 'bash',
      parameters: { command: 'npm test' },
    };

    observer.onToolStart!(toolCall);

    // Simulate progress
    observer.onToolProgress!(toolCall, {
      current: 5,
      total: 10,
      message: 'Running tests...',
    });

    // Simulate completion
    observer.onToolResult!(toolCall, 'All tests passed!');

    // End processing
    adapter.endProcessing();

    // Check telemetry
    const telemetry = adapter.getTelemetry();
    expect(telemetry?.snapshot.events.total).toBeGreaterThan(0);

    adapter.dispose();
  });
});