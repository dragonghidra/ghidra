/**
 * UnifiedUIController - Central orchestration layer for the unified UI system
 * Coordinates overlay management, status orchestration, animations, interrupts, and telemetry
 */

import { EventEmitter } from 'events';
import { OverlayManager } from './overlay/OverlayManager.js';
import type { OverlayRegion } from './overlay/OverlayManager.js';
import { StatusOrchestrator } from './orchestration/StatusOrchestrator.js';
import type { StatusEvent, ToolStatus } from './orchestration/StatusOrchestrator.js';
import { AnimationScheduler } from './animation/AnimationScheduler.js';
import type { SpinnerAnimation, ElapsedAnimation } from './animation/AnimationScheduler.js';
import { InterruptManager, InterruptPriority } from './interrupts/InterruptManager.js';
import type { InterruptType, Interrupt } from './interrupts/InterruptManager.js';
import { UITelemetry } from './telemetry/UITelemetry.js';
import type { TelemetrySnapshot } from './telemetry/UITelemetry.js';
import type { ToolCallRequest } from '../core/types.js';
import type { LiveStatusState, LiveStatusTone } from '../shell/liveStatus.js';
import chalk from 'chalk';

export interface UIControllerConfig {
  enableOverlay: boolean;
  enableAnimations: boolean;
  enableTelemetry: boolean;
  adaptivePerformance: boolean; // Adjust quality based on performance
  debugMode: boolean;
}

export interface UIState {
  isProcessing: boolean;
  hasActiveTools: boolean;
  hasActiveInterrupts: boolean;
  overlayVisible: boolean;
  currentStatus: string | null;
  activeAnimations: number;
  performanceMode: 'high' | 'balanced' | 'low';
}

export type UIEventType =
  | 'ui.initialized'
  | 'ui.state.changed'
  | 'ui.overlay.updated'
  | 'ui.performance.adjusted'
  | 'ui.error';

// Extended interrupt interface with telemetry tracking
interface InterruptWithTelemetry extends Interrupt {
  _telemetryInteraction?: {
    complete: () => void;
    cancel: () => void;
  };
}

export class UnifiedUIController extends EventEmitter {
  private overlayManager: OverlayManager;
  private statusOrchestrator: StatusOrchestrator;
  private animationScheduler: AnimationScheduler;
  private interruptManager: InterruptManager;
  private telemetry: UITelemetry;

  private config: UIControllerConfig;
  private state: UIState;

  private activeSpinners: Map<string, SpinnerAnimation> = new Map();
  private activeElapsed: Map<string, ElapsedAnimation> = new Map();
  private performanceMonitorInterval: NodeJS.Timeout | null = null;
  private thinkingSpinner: SpinnerAnimation | null = null;

  constructor(
    writeStream: NodeJS.WriteStream,
    config: Partial<UIControllerConfig> = {}
  ) {
    super();
    this.config = {
      enableOverlay: true,
      enableAnimations: true,
      enableTelemetry: true,
      adaptivePerformance: true,
      debugMode: false,
      ...config,
    };

    this.state = {
      isProcessing: false,
      hasActiveTools: false,
      hasActiveInterrupts: false,
      overlayVisible: false,
      currentStatus: null,
      activeAnimations: 0,
      performanceMode: 'balanced',
    };

    // Initialize components
    this.overlayManager = new OverlayManager(writeStream);
    this.statusOrchestrator = new StatusOrchestrator();
    this.animationScheduler = new AnimationScheduler(30);
    this.interruptManager = new InterruptManager();
    this.telemetry = new UITelemetry({ enabled: config.enableTelemetry });

    this.setupEventHandlers();
    this.setupPerformanceMonitoring();

    this.emit('ui.initialized');
  }

  /**
   * Setup event handlers between components
   */
  private setupEventHandlers(): void {
    // Status orchestrator events
    this.statusOrchestrator.subscribe((event: StatusEvent) => {
      this.handleStatusEvent(event);
    });

    // Animation scheduler events
    this.animationScheduler.on('spinner:frame', (data) => {
      this.updateSpinnerOverlay(data);
    });

    this.animationScheduler.on('elapsed:update', (data) => {
      this.updateElapsedOverlay(data);
    });

    this.animationScheduler.on('progress:update', (data) => {
      this.updateProgressOverlay(data);
    });

    // Interrupt manager events
    this.interruptManager.on('interrupt:activated', (interrupt) => {
      this.handleInterruptActivated(interrupt);
    });

    this.interruptManager.on('interrupt:completed', (interrupt) => {
      this.handleInterruptCompleted(interrupt);
    });

    this.interruptManager.on('interrupt:transition', (data) => {
      this.handleInterruptTransition(data);
    });

    // Telemetry performance warnings
    this.telemetry.on('performance:slow-render', () => {
      if (this.config.adaptivePerformance) {
        this.adjustPerformanceMode('low');
      }
    });

    this.telemetry.on('performance:high-memory', () => {
      if (this.config.adaptivePerformance) {
        this.reduceMemoryUsage();
      }
    });
  }

  /**
   * Handle status events from orchestrator
   */
  private handleStatusEvent(event: StatusEvent): void {
    this.telemetry.recordEvent(event.type, event.data);

    switch (event.type) {
      case 'tool.start':
        this.handleToolStart(event.data as { toolCall: ToolCallRequest; toolStatus: ToolStatus });
        break;
      case 'tool.progress':
        this.handleToolProgress(event.data as { toolId: string; toolStatus: ToolStatus; progress?: unknown });
        break;
      case 'tool.complete':
        this.handleToolComplete(event.data as { toolId: string; toolStatus: ToolStatus; result?: unknown });
        break;
      case 'tool.error':
        this.handleToolError(event.data as { toolId: string; toolStatus: ToolStatus; error: unknown });
        break;
      case 'status.base.changed':
      case 'status.override.pushed':
      case 'status.override.cleared':
        this.updateOverlay();
        break;
    }
  }

  /**
   * Handle tool start event
   */
  private handleToolStart(data: { toolCall: ToolCallRequest; toolStatus: ToolStatus }): void {
    const { toolCall, toolStatus } = data;

    // Start telemetry
    this.telemetry.markStart(`tool.${toolCall.name}`);

    // Create spinner animation
    if (this.config.enableAnimations) {
      const spinner = this.animationScheduler.createSpinner(
        `tool-${toolCall.id}`,
        toolStatus.description
      );
      this.activeSpinners.set(toolCall.id, spinner);
    }

    // Create elapsed time animation
    const elapsed = this.animationScheduler.createElapsed(
      `elapsed-${toolCall.id}`,
      toolStatus.startedAt
    );
    this.activeElapsed.set(toolCall.id, elapsed);

    // Update state
    this.state.hasActiveTools = true;
    this.updateOverlay();
  }

  /**
   * Handle tool progress event
   */
  private handleToolProgress(data: any): void {
    if (data.progress) {
      // Update or create progress animation
      const progress = data.progress as { current: number; total: number };
      this.animationScheduler.updateProgress(
        `progress-${data.toolId}`,
        progress.current
      );
    }

    this.updateOverlay();
  }

  /**
   * Handle tool complete event
   */
  private handleToolComplete(data: any): void {
    // End telemetry
    // const duration = this.telemetry.markEnd(`tool.${data.toolStatus.tool}`);

    // Clean up animations
    this.activeSpinners.delete(data.toolId);
    this.activeElapsed.delete(data.toolId);
    this.animationScheduler.unregister(`tool-${data.toolId}`);
    this.animationScheduler.unregister(`elapsed-${data.toolId}`);
    this.animationScheduler.unregister(`progress-${data.toolId}`);

    // Update state
    if (this.statusOrchestrator.getContext().tools.size === 0) {
      this.state.hasActiveTools = false;
    }

    this.updateOverlay();
  }

  /**
   * Handle tool error event
   */
  private handleToolError(data: any): void {
    // Record error
    this.telemetry.recordError(data.error, {
      tool: data.toolStatus.tool,
      toolId: data.toolId,
    });

    // Clean up animations
    this.activeSpinners.delete(data.toolId);
    this.activeElapsed.delete(data.toolId);
    this.animationScheduler.unregister(`tool-${data.toolId}`);
    this.animationScheduler.unregister(`elapsed-${data.toolId}`);

    // Show error interrupt
    const error = data.error as Error;
    this.interruptManager.queue({
      type: 'alert',
      priority: InterruptPriority.HIGH,
      message: `Error in ${data.toolStatus.tool}: ${error.message || 'Unknown error'}`,
      ttl: 5000,
    });

    this.updateOverlay();
  }

  /**
   * Update the overlay based on current state
   */
  private updateOverlay(): void {
    if (!this.config.enableOverlay) return;

    this.telemetry.markStart('overlay.update');

    // Get current status from orchestrator
    const currentStatus = this.statusOrchestrator.getCurrentStatus();

    // Build overlay regions
    const regions: Record<string, OverlayRegion> = {};

    // Status region (top priority)
    if (currentStatus) {
      regions['status'] = this.buildStatusRegion(currentStatus);
    }

    // Progress region
    const activeTools = Array.from(this.statusOrchestrator.getContext().tools.values());
    const progressTools = activeTools.filter(t => t.progress);
    if (progressTools.length > 0 && progressTools[0]) {
      const progressRegion = this.buildProgressRegion(progressTools[0]);
      if (progressRegion) {
        regions['progress'] = progressRegion;
      }
    }

    // Hints region
    if (this.state.hasActiveTools || this.state.hasActiveInterrupts) {
      regions['hints'] = this.buildHintsRegion();
    }

    // Alerts region (for active interrupts)
    const activeInterrupts = this.interruptManager.getInterruptsByStatus('active');
    if (activeInterrupts.length > 0 && activeInterrupts[0]) {
      regions['alerts'] = this.buildAlertsRegion(activeInterrupts[0]);
    }

    // Update overlay
    this.overlayManager.setLayout({
      regions,
      maxHeight: 4,
    });

    // Show or hide based on state
    if (this.state.isProcessing && Object.keys(regions).length > 0) {
      this.overlayManager.show();
      this.state.overlayVisible = true;
    } else if (!this.state.isProcessing) {
      this.overlayManager.hide();
      this.state.overlayVisible = false;
    }

    this.telemetry.markEnd('overlay.update');
    this.emit('ui.overlay.updated', { regions });
  }

  /**
   * Build status region for overlay
   */
  private buildStatusRegion(status: LiveStatusState): OverlayRegion {
    const elapsed = this.formatElapsed(Date.now() - status.startedAt);
    const toneColor = this.getToneColor(status.tone);

    // Get current spinner frame if thinking spinner is active
    let spinnerFrame = '';
    if (this.thinkingSpinner && this.state.isProcessing) {
      const frameIndex = this.thinkingSpinner.currentFrame % this.thinkingSpinner.data.frames.length;
      spinnerFrame = this.thinkingSpinner.data.frames[frameIndex] || '';
    }

    let content = spinnerFrame
      ? toneColor(`${spinnerFrame} ${status.text} (${elapsed})`)
      : toneColor(`• ${status.text} (${elapsed})`);

    if (status.detail) {
      content += chalk.gray(` • ${status.detail}`);
    }

    return {
      content,
      height: 1,
      priority: 100,
    };
  }

  /**
   * Build progress region for overlay
   */
  private buildProgressRegion(tool: ToolStatus): OverlayRegion | undefined {
    if (!tool.progress) return undefined;

    const { current, total, percentage } = tool.progress;
    const barWidth = 20;
    const filled = Math.round((percentage / 100) * barWidth);
    const empty = barWidth - filled;

    const progressBar =
      chalk.cyan('[') +
      chalk.cyan('█').repeat(filled) +
      chalk.gray('░').repeat(empty) +
      chalk.cyan(']');

    const content = `${progressBar} ${percentage}% (${current}/${total})`;

    return {
      content,
      height: 1,
      priority: 90,
    };
  }

  /**
   * Build hints region for overlay
   */
  private buildHintsRegion(): OverlayRegion {
    const hints: string[] = [];

    if (this.state.hasActiveTools) {
      hints.push('Press Ctrl+C to cancel');
    }

    if (this.state.hasActiveInterrupts) {
      hints.push('Respond to continue');
    }

    const content = chalk.dim(hints.join(' • '));

    return {
      content,
      height: 1,
      priority: 50,
    };
  }

  /**
   * Build alerts region for overlay
   */
  private buildAlertsRegion(interrupt: Interrupt): OverlayRegion {
    const icon = this.getInterruptIcon(interrupt.type);
    const content = chalk.yellow(`${icon} ${interrupt.message}`);

    return {
      content,
      height: 1,
      priority: 110,
    };
  }

  /**
   * Handle interrupt activated
   */
  private handleInterruptActivated(interrupt: Interrupt): void {
    this.state.hasActiveInterrupts = true;

    // Record interaction
    const interaction = this.telemetry.recordInteraction(
      'menu-selection',
      interrupt.type
    );

    // Store for completion
    (interrupt as InterruptWithTelemetry)._telemetryInteraction = interaction;

    this.updateOverlay();
  }

  /**
   * Handle interrupt completed
   */
  private handleInterruptCompleted(interrupt: Interrupt): void {
    // Complete telemetry interaction
    const interruptWithTelemetry = interrupt as InterruptWithTelemetry;
    if (interruptWithTelemetry._telemetryInteraction) {
      interruptWithTelemetry._telemetryInteraction.complete();
    }

    const activeCount = this.interruptManager.getInterruptsByStatus('active').length;
    this.state.hasActiveInterrupts = activeCount > 0;

    this.updateOverlay();
  }

  /**
   * Handle interrupt transition animation
   */
  private handleInterruptTransition(data: any): void {
    if (!this.config.enableAnimations) return;

    const { direction, interrupt, duration } = data;

    this.animationScheduler.createTransition(
      `interrupt-${interrupt.id}`,
      direction === 'in' ? 0 : 1,
      direction === 'in' ? 1 : 0,
      'opacity',
      duration
    );
  }

  /**
   * Update spinner overlay from animation frame
   */
  private updateSpinnerOverlay(data: any): void {
    // Handle thinking spinner
    if (data.id === 'ai-thinking' && this.state.isProcessing) {
      this.updateOverlay();
      return;
    }

    // Handle tool spinners
    const toolId = data.id.replace('tool-', '');
    const tool = this.statusOrchestrator.getContext().tools.get(toolId);

    if (tool) {
      tool.detail = `${data.frame} ${data.message || ''}`.trim();
      this.updateOverlay();
    }
  }

  /**
   * Update elapsed overlay from animation frame
   */
  private updateElapsedOverlay(_data: any): void {
    // Elapsed time is shown in status region, trigger update
    this.updateOverlay();
  }

  /**
   * Update progress overlay from animation frame
   */
  private updateProgressOverlay(_data: any): void {
    this.updateOverlay();
  }

  /**
   * Setup performance monitoring
   */
  private setupPerformanceMonitoring(): void {
    if (!this.config.adaptivePerformance) return;

    this.performanceMonitorInterval = setInterval(() => {
      const snapshot = this.telemetry.getSnapshot();
      const { framerate, avgRenderTime } = snapshot.performance;

      // Adjust performance mode based on metrics
      if (framerate < 15 || avgRenderTime > 50) {
        this.adjustPerformanceMode('low');
      } else if (framerate > 50 && avgRenderTime < 10) {
        this.adjustPerformanceMode('high');
      } else {
        this.adjustPerformanceMode('balanced');
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Adjust performance mode
   */
  private adjustPerformanceMode(mode: 'high' | 'balanced' | 'low'): void {
    if (this.state.performanceMode === mode) return;

    const previousMode = this.state.performanceMode;
    this.state.performanceMode = mode;

    switch (mode) {
      case 'high':
        this.animationScheduler.setTargetFPS(60);
        this.config.enableAnimations = true;
        break;
      case 'balanced':
        this.animationScheduler.setTargetFPS(30);
        this.config.enableAnimations = true;
        break;
      case 'low':
        this.animationScheduler.setTargetFPS(10);
        this.config.enableAnimations = false;
        // Disable non-essential animations
        this.activeSpinners.forEach((_, id) => {
          this.animationScheduler.unregister(`tool-${id}`);
        });
        this.activeSpinners.clear();
        break;
    }

    this.emit('ui.performance.adjusted', { from: previousMode, to: mode });

    if (this.config.debugMode) {
      console.log(`Performance mode adjusted: ${previousMode} -> ${mode}`);
    }
  }

  /**
   * Reduce memory usage when high memory detected
   */
  private reduceMemoryUsage(): void {
    // Clear telemetry buffers
    this.telemetry.flush();

    // Clear completed animations
    this.animationScheduler.getActiveAnimations().forEach(anim => {
      if (anim.currentFrame > anim.frameCount) {
        this.animationScheduler.unregister(anim.id);
      }
    });

    // Clear old interrupts
    const stats = this.interruptManager.getStatistics();
    if (stats.queueLength > 50) {
      // Keep only high priority interrupts
      const lowPriority = this.interruptManager.getInterruptsByStatus('pending')
        .filter(i => i.priority < InterruptPriority.NORMAL);

      lowPriority.forEach(i => this.interruptManager.cancelInterrupt(i.id));
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * Public API Methods
   */

  /**
   * Start processing mode
   */
  startProcessing(): void {
    this.state.isProcessing = true;
    this.overlayManager.setEnabled(false); // Disable during processing

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

  /**
   * End processing mode
   */
  endProcessing(): void {
    this.state.isProcessing = false;

    // Stop the thinking spinner
    if (this.thinkingSpinner) {
      this.activeSpinners.delete('ai-thinking');
      this.animationScheduler.unregister('ai-thinking');
      this.thinkingSpinner = null;
    }

    this.overlayManager.setEnabled(true);
    this.updateOverlay();
    this.emit('ui.state.changed', { isProcessing: false });
  }

  /**
   * Set base status
   */
  setBaseStatus(text: string, tone?: LiveStatusTone): void {
    this.statusOrchestrator.setBaseStatus({
      text,
      tone,
      startedAt: Date.now(),
    });
  }

  /**
   * Push status override
   */
  pushStatusOverride(id: string, text: string, detail?: string, tone?: LiveStatusTone): void {
    this.statusOrchestrator.pushOverride(id, {
      text,
      detail,
      tone,
      startedAt: Date.now(),
    });
  }

  /**
   * Clear status override
   */
  clearStatusOverride(id: string): void {
    this.statusOrchestrator.clearOverride(id);
  }

  /**
   * Update commands overlay (for slash command preview)
   */
  updateCommandsOverlay(content: string): void {
    // Use the overlay manager to show commands in a hints region
    this.overlayManager.updateRegion('hints', {
      content,
      height: content.split('\n').length,
      priority: 95, // High priority but below alerts
    });
    this.overlayManager.show();
  }

  /**
   * Hide commands overlay
   */
  hideCommandsOverlay(): void {
    this.overlayManager.updateRegion('hints', undefined);
  }

  /**
   * Handle tool execution lifecycle
   */
  onToolStart(toolCall: ToolCallRequest): void {
    this.statusOrchestrator.onToolStart(toolCall);
  }

  onToolProgress(toolId: string, progress: { current: number; total: number; message?: string }): void {
    this.statusOrchestrator.onToolProgress(toolId, progress);
  }

  onToolComplete(toolId: string, result?: unknown): void {
    this.statusOrchestrator.onToolComplete(toolId, result);
  }

  onToolError(toolId: string, error: unknown): void {
    this.statusOrchestrator.onToolError(toolId, error);
  }

  /**
   * Queue an interrupt
   */
  queueInterrupt(
    type: InterruptType,
    message: string,
    priority: InterruptPriority = InterruptPriority.NORMAL,
    handler?: (interrupt: Interrupt) => void | Promise<void>
  ): string {
    return this.interruptManager.queue({
      type,
      priority,
      message,
      handler,
    });
  }

  /**
   * Complete an interrupt
   */
  completeInterrupt(id: string): void {
    this.interruptManager.completeInterrupt(id);
  }

  /**
   * Begin output (hides overlay)
   */
  beginOutput(): void {
    this.overlayManager.beginOutput();
  }

  /**
   * End output (shows overlay)
   */
  endOutput(): void {
    this.overlayManager.endOutput();
  }

  /**
   * Helper methods
   */

  private formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);

    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private getToneColor(tone?: LiveStatusTone): (text: string) => string {
    switch (tone) {
      case 'success':
        return chalk.green;
      case 'warning':
        return chalk.yellow;
      case 'danger':
        return chalk.red;
      case 'info':
      default:
        return chalk.cyan;
    }
  }

  private getInterruptIcon(type: InterruptType): string {
    switch (type) {
      case 'system-error':
        return '⚠️';
      case 'user-cancel':
        return '🛑';
      case 'confirmation':
        return '❓';
      case 'alert':
        return '🔔';
      case 'hint':
        return '💡';
      default:
        return '•';
    }
  }

  /**
   * Get current UI state
   */
  getState(): UIState {
    return { ...this.state };
  }

  /**
   * Get telemetry snapshot
   */
  getTelemetrySnapshot(): TelemetrySnapshot {
    return this.telemetry.getSnapshot();
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary(): Record<string, unknown> {
    return this.telemetry.getPerformanceSummary();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<UIControllerConfig>): void {
    this.config = { ...this.config, ...config };

    // Update component configs
    this.telemetry.setEnabled(this.config.enableTelemetry);
    this.overlayManager.setEnabled(this.config.enableOverlay);

    if (!this.config.enableAnimations) {
      this.animationScheduler.clearAll();
    }

    this.emit('ui.config.updated', this.config);
  }

  /**
   * Dispose of the controller
   */
  dispose(): void {
    if (this.performanceMonitorInterval) {
      clearInterval(this.performanceMonitorInterval);
    }

    this.overlayManager.dispose();
    this.statusOrchestrator.reset();
    this.animationScheduler.dispose();
    this.interruptManager.dispose();
    this.telemetry.dispose();

    this.activeSpinners.clear();
    this.activeElapsed.clear();

    this.removeAllListeners();
  }
}