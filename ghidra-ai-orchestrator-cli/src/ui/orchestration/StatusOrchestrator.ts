/**
 * StatusOrchestrator - Unified status management system
 * Coordinates between tool execution, live status tracking, and overlay display
 */

import { EventEmitter } from 'events';
import { ToolCallRequest } from '../../core/types.js';
import { LiveStatusState, LiveStatusTone } from '../../shell/liveStatus.js';

export type StatusEventType =
  | 'status.base.changed'
  | 'status.override.pushed'
  | 'status.override.cleared'
  | 'tool.start'
  | 'tool.progress'
  | 'tool.complete'
  | 'tool.error'
  | 'animation.frame'
  | 'interrupt.received';

export interface StatusEvent {
  type: StatusEventType;
  timestamp: number;
  data: unknown;
}

export interface ToolStatus {
  toolId: string;
  tool: string;
  status: 'starting' | 'running' | 'completing' | 'completed' | 'error';
  description: string;
  detail?: string;
  progress?: {
    current: number;
    total: number;
    percentage: number;
  };
  startedAt: number;
  updatedAt: number;
  tone: LiveStatusTone;
}

export interface StatusContext {
  base: LiveStatusState | null;
  overrides: Map<string, LiveStatusState>;
  tools: Map<string, ToolStatus>;
  animations: Map<string, AnimationState>;
  interrupts: InterruptQueue;
}

export interface AnimationState {
  id: string;
  type: 'spinner' | 'progress' | 'pulse';
  frame: number;
  startedAt: number;
  data?: unknown;
}

export interface InterruptQueue {
  pending: Interrupt[];
  active: Interrupt | null;
}

export interface Interrupt {
  id: string;
  priority: number;
  type: string;
  message: string;
  timestamp: number;
}

export class StatusOrchestrator extends EventEmitter {
  private context: StatusContext;
  private statusListeners: Set<(event: StatusEvent) => void> = new Set();
  private priorityResolver: (a: LiveStatusState, b: LiveStatusState) => number;

  constructor() {
    super();
    this.context = {
      base: null,
      overrides: new Map(),
      tools: new Map(),
      animations: new Map(),
      interrupts: {
        pending: [],
        active: null,
      },
    };

    // Default priority resolver
    this.priorityResolver = (a, b) => {
      const tonePriority: Record<LiveStatusTone, number> = {
        danger: 4,
        warning: 3,
        success: 2,
        info: 1,
      };

      const aPriority = tonePriority[a.tone || 'info'];
      const bPriority = tonePriority[b.tone || 'info'];

      return bPriority - aPriority;
    };
  }

  /**
   * Set base status
   */
  setBaseStatus(status: LiveStatusState | null): void {
    this.context.base = status;
    this.emitEvent({
      type: 'status.base.changed',
      timestamp: Date.now(),
      data: { status },
    });
  }

  /**
   * Push status override
   */
  pushOverride(id: string, status: LiveStatusState): void {
    this.context.overrides.set(id, status);
    this.emitEvent({
      type: 'status.override.pushed',
      timestamp: Date.now(),
      data: { id, status },
    });
  }

  /**
   * Clear status override
   */
  clearOverride(id: string): void {
    const removed = this.context.overrides.delete(id);
    if (removed) {
      this.emitEvent({
        type: 'status.override.cleared',
        timestamp: Date.now(),
        data: { id },
      });
    }
  }

  /**
   * Handle tool lifecycle events
   */
  onToolStart(toolCall: ToolCallRequest): void {
    const toolStatus: ToolStatus = {
      toolId: toolCall.id,
      tool: toolCall.name,
      status: 'starting',
      description: this.describeToolOperation(toolCall),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      tone: this.getToolTone(toolCall.name),
    };

    this.context.tools.set(toolCall.id, toolStatus);

    this.emitEvent({
      type: 'tool.start',
      timestamp: Date.now(),
      data: { toolCall, toolStatus },
    });

    // Update to running status after a brief delay
    setTimeout(() => {
      const status = this.context.tools.get(toolCall.id);
      if (status && status.status === 'starting') {
        status.status = 'running';
        status.updatedAt = Date.now();
        this.emitEvent({
          type: 'tool.progress',
          timestamp: Date.now(),
          data: { toolCall, toolStatus: status },
        });
      }
    }, 100);
  }

  /**
   * Update tool progress
   */
  onToolProgress(
    toolId: string,
    progress: { current: number; total: number; message?: string }
  ): void {
    const toolStatus = this.context.tools.get(toolId);
    if (!toolStatus) return;

    toolStatus.progress = {
      current: progress.current,
      total: progress.total,
      percentage: Math.round((progress.current / progress.total) * 100),
    };

    if (progress.message) {
      toolStatus.detail = progress.message;
    }

    toolStatus.updatedAt = Date.now();

    this.emitEvent({
      type: 'tool.progress',
      timestamp: Date.now(),
      data: { toolId, toolStatus, progress },
    });
  }

  /**
   * Handle tool completion
   */
  onToolComplete(toolId: string, result?: unknown): void {
    const toolStatus = this.context.tools.get(toolId);
    if (!toolStatus) return;

    toolStatus.status = 'completed';
    toolStatus.updatedAt = Date.now();

    this.emitEvent({
      type: 'tool.complete',
      timestamp: Date.now(),
      data: { toolId, toolStatus, result },
    });

    // Remove from active tools after animation
    setTimeout(() => {
      this.context.tools.delete(toolId);
    }, 1000);
  }

  /**
   * Handle tool error
   */
  onToolError(toolId: string, error: unknown): void {
    const toolStatus = this.context.tools.get(toolId);
    if (!toolStatus) return;

    const errorMessage = error instanceof Error ? error.message : String(error);
    toolStatus.status = 'error';
    toolStatus.tone = 'danger';
    toolStatus.detail = errorMessage || 'An error occurred';
    toolStatus.updatedAt = Date.now();

    this.emitEvent({
      type: 'tool.error',
      timestamp: Date.now(),
      data: { toolId, toolStatus, error },
    });

    // Remove from active tools after delay
    setTimeout(() => {
      this.context.tools.delete(toolId);
    }, 2000);
  }

  /**
   * Queue an interrupt
   */
  queueInterrupt(interrupt: Omit<Interrupt, 'id' | 'timestamp'>): string {
    const id = `interrupt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullInterrupt: Interrupt = {
      ...interrupt,
      id,
      timestamp: Date.now(),
    };

    // Insert based on priority
    const index = this.context.interrupts.pending.findIndex(
      (i) => i.priority < interrupt.priority
    );

    if (index === -1) {
      this.context.interrupts.pending.push(fullInterrupt);
    } else {
      this.context.interrupts.pending.splice(index, 0, fullInterrupt);
    }

    this.emitEvent({
      type: 'interrupt.received',
      timestamp: Date.now(),
      data: { interrupt: fullInterrupt },
    });

    // Process interrupt queue
    this.processInterrupts();

    return id;
  }

  /**
   * Process pending interrupts
   */
  private processInterrupts(): void {
    if (this.context.interrupts.active || this.context.interrupts.pending.length === 0) {
      return;
    }

    const interrupt = this.context.interrupts.pending.shift();
    if (!interrupt) return;

    this.context.interrupts.active = interrupt;

    // Auto-clear interrupt after 3 seconds if not cleared manually
    setTimeout(() => {
      if (this.context.interrupts.active?.id === interrupt.id) {
        this.clearInterrupt(interrupt.id);
      }
    }, 3000);
  }

  /**
   * Clear an active interrupt
   */
  clearInterrupt(id: string): void {
    if (this.context.interrupts.active?.id === id) {
      this.context.interrupts.active = null;
      this.processInterrupts(); // Process next in queue
    }
  }

  /**
   * Get the current aggregated status
   */
  getCurrentStatus(): LiveStatusState | null {
    // Priority order:
    // 1. Active interrupt
    // 2. Active tools
    // 3. Overrides
    // 4. Base status

    if (this.context.interrupts.active) {
      return {
        text: this.context.interrupts.active.message,
        tone: 'warning' as LiveStatusTone,
        startedAt: this.context.interrupts.active.timestamp,
      };
    }

    // Get most important tool status
    if (this.context.tools.size > 0) {
      const toolStatuses = Array.from(this.context.tools.values());
      const activeTools = toolStatuses.filter((t) => t.status === 'running');

      if (activeTools.length > 0) {
        const mostRecent = activeTools.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (mostRecent) {
          return {
            text: mostRecent.description,
            detail: mostRecent.detail,
            tone: mostRecent.tone,
            startedAt: mostRecent.startedAt,
          };
        }
      }
    }

    // Get highest priority override
    if (this.context.overrides.size > 0) {
      const overrides = Array.from(this.context.overrides.values());
      const sorted = overrides.sort(this.priorityResolver);
      return sorted[0] || null;
    }

    return this.context.base;
  }

  /**
   * Register animation
   */
  registerAnimation(
    id: string,
    type: AnimationState['type'],
    data?: unknown
  ): void {
    this.context.animations.set(id, {
      id,
      type,
      frame: 0,
      startedAt: Date.now(),
      data,
    });
  }

  /**
   * Update animation frame
   */
  updateAnimationFrame(id: string): void {
    const animation = this.context.animations.get(id);
    if (animation) {
      animation.frame++;
      this.emitEvent({
        type: 'animation.frame',
        timestamp: Date.now(),
        data: { animation },
      });
    }
  }

  /**
   * Clear animation
   */
  clearAnimation(id: string): void {
    this.context.animations.delete(id);
  }

  /**
   * Subscribe to status events
   */
  subscribe(listener: (event: StatusEvent) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Emit status event
   */
  private emitEvent(event: StatusEvent): void {
    this.emit(event.type, event);
    this.statusListeners.forEach((listener) => listener(event));
  }

  /**
   * Get tool operation description
   */
  private describeToolOperation(toolCall: ToolCallRequest): string {
    const params = toolCall.arguments as any;

    switch (toolCall.name) {
      case 'read_file':
        return `Reading ${this.truncatePath(params.path)}`;
      case 'write_file':
        return `Writing ${this.truncatePath(params.path)}`;
      case 'edit_file':
        return `Editing ${this.truncatePath(params.path)}`;
      case 'bash':
        return `Running: ${this.truncateCommand(params.command)}`;
      case 'search_files':
        return `Searching for: ${this.truncateQuery(params.query)}`;
      case 'list_directory':
        return `Listing ${this.truncatePath(params.path || '.')}`;
      default:
        return `Running ${toolCall.name}`;
    }
  }

  /**
   * Get tone for tool type
   */
  private getToolTone(tool: string): LiveStatusTone {
    const dangerousTools = ['bash', 'write_file', 'edit_file', 'delete_file'];
    const warningTools = ['install', 'uninstall', 'update'];

    if (dangerousTools.includes(tool)) {
      return 'warning';
    }
    if (warningTools.includes(tool)) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Helper to truncate paths
   */
  private truncatePath(path: string, maxLength: number = 40): string {
    if (!path) return '';
    if (path.length <= maxLength) return path;

    const parts = path.split('/');
    if (parts.length <= 2) {
      return '...' + path.slice(-(maxLength - 3));
    }

    // Keep first and last parts
    const first = parts[0] || '';
    const last = parts[parts.length - 1] || '';
    const middle = '...';

    const result = `${first}/${middle}/${last}`;
    if (result.length > maxLength) {
      return '...' + last.slice(-(maxLength - 3));
    }

    return result;
  }

  /**
   * Helper to truncate commands
   */
  private truncateCommand(command: string, maxLength: number = 40): string {
    if (!command) return '';
    if (command.length <= maxLength) return command;
    return command.slice(0, maxLength - 3) + '...';
  }

  /**
   * Helper to truncate search queries
   */
  private truncateQuery(query: string, maxLength: number = 30): string {
    if (!query) return '';
    if (query.length <= maxLength) return query;
    return query.slice(0, maxLength - 3) + '...';
  }

  /**
   * Get full context for debugging
   */
  getContext(): StatusContext {
    return { ...this.context };
  }

  /**
   * Reset all status
   */
  reset(): void {
    this.context = {
      base: null,
      overrides: new Map(),
      tools: new Map(),
      animations: new Map(),
      interrupts: {
        pending: [],
        active: null,
      },
    };
  }
}