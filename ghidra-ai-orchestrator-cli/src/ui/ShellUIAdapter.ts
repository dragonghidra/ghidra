/**
 * ShellUIAdapter - Bridges the UnifiedUIController with the existing shell infrastructure
 * Provides compatibility layer and migration path from old to new UI system
 */

import { UnifiedUIController } from './UnifiedUIController.js';
import { PromptSkin } from '../shell/promptSkin.js';
import { LiveStatusTracker } from '../shell/liveStatus.js';
import { Display } from './display.js';
import { ToolRuntimeObserver } from '../core/toolRuntime.js';
import { ToolCallRequest } from '../core/types.js';
import { InterruptPriority } from './interrupts/InterruptManager.js';
import { LiveStatusTone } from '../shell/liveStatus.js';


export interface ShellUIAdapterConfig {
  useUnifiedUI: boolean; // Feature flag to switch between old and new UI
  preserveCompatibility: boolean; // Keep old APIs working
  enableTelemetry: boolean;
  debugMode: boolean;
}

export class ShellUIAdapter {
  private uiController: UnifiedUIController;
  private legacyPromptSkin?: PromptSkin;
  private legacyStatusTracker?: LiveStatusTracker;
  private display: Display;
  private config: ShellUIAdapterConfig;
  private isProcessing: boolean = false;
  private contextUsage: number = 0;

  constructor(
    writeStream: NodeJS.WriteStream,
    display: Display,
    config: Partial<ShellUIAdapterConfig> = {}
  ) {
    this.display = display;
    this.config = {
      useUnifiedUI: true,
      preserveCompatibility: true,
      enableTelemetry: true,
      debugMode: false,
      ...config,
    };

    // Initialize unified UI controller
    this.uiController = new UnifiedUIController(writeStream, {
      enableOverlay: true,
      enableAnimations: true,
      enableTelemetry: this.config.enableTelemetry,
      adaptivePerformance: true,
      debugMode: this.config.debugMode,
    });

    // Legacy components are optional and should be passed in if needed
    // They require a readline.Interface which we don't have here
    this.setupDisplayIntegration();
  }

  /**
   * Setup display integration
   */
  private setupDisplayIntegration(): void {
    // Register output interceptor to coordinate with overlay
    this.display.registerOutputInterceptor({
      beforeWrite: () => {
        if (this.config.useUnifiedUI) {
          this.uiController.beginOutput();
        } else if (this.legacyPromptSkin) {
          this.legacyPromptSkin.beginOutput();
        }
      },
      afterWrite: () => {
        if (this.config.useUnifiedUI) {
          this.uiController.endOutput();
        } else if (this.legacyPromptSkin) {
          this.legacyPromptSkin.endOutput();
        }
      },
    });
  }

  /**
   * Create a tool observer for the agent
   */
  createToolObserver(): ToolRuntimeObserver {
    return {
      onToolStart: (call: ToolCallRequest) => {
        // Update spinner with tool execution status
        const description = this.describeToolForDisplay(call);
        this.display.updateThinking(description);

        if (this.config.useUnifiedUI) {
          this.uiController.onToolStart(call);
        } else if (this.legacyStatusTracker) {
          // Use legacy behavior
          const legacyDesc = this.describeToolForLegacy(call);
          this.legacyStatusTracker.pushOverride(`tool-${call.id}`, legacyDesc, {
            tone: this.getToolTone(call.name),
          });
        }
      },

      onToolResult: (call: ToolCallRequest, output: string) => {
        if (this.config.useUnifiedUI) {
          this.uiController.onToolComplete(call.id, output);
        } else if (this.legacyStatusTracker) {
          this.legacyStatusTracker.clearOverride(`tool-${call.id}`);
        }

        // Reset spinner to thinking state
        this.display.updateThinking('Analyzing results...');

        // Display tool result
        const summary = this.summarizeToolResult(call, output);
        this.display.showAction(summary, 'success');
      },

      onToolError: (call: ToolCallRequest, message: string) => {
        if (this.config.useUnifiedUI) {
          this.uiController.onToolError(call.id, { message });
        } else if (this.legacyStatusTracker) {
          this.legacyStatusTracker.clearOverride(`tool-${call.id}`);
        }

        // Reset spinner
        this.display.updateThinking('Handling error...');

        // Display error
        this.display.showAction(
          `Error in ${call.name}: ${message}`,
          'error'
        );
      },
    };
  }

  /**
   * Start processing a request
   */
  startProcessing(message: string = 'Working on your request'): void {
    this.isProcessing = true;

    if (this.config.useUnifiedUI) {
      this.uiController.startProcessing();
      this.uiController.setBaseStatus(message, 'info');
    } else {
      if (this.legacyPromptSkin) {
        this.legacyPromptSkin.setOverlayVisible(false);
      }
      if (this.legacyStatusTracker) {
        this.legacyStatusTracker.setBase(message, { tone: 'info' });
      }
    }
  }

  /**
   * End processing
   */
  endProcessing(message: string = 'Ready for prompts'): void {
    this.isProcessing = false;

    if (this.config.useUnifiedUI) {
      this.uiController.endProcessing();
      this.uiController.setBaseStatus(message, 'success');
    } else {
      if (this.legacyPromptSkin) {
        this.legacyPromptSkin.setOverlayVisible(true);
      }
      if (this.legacyStatusTracker) {
        this.legacyStatusTracker.setBase(message, { tone: 'success' });
      }
    }
  }

  /**
   * Update context usage
   */
  updateContextUsage(percentage: number): void {
    this.contextUsage = percentage;

    if (this.config.useUnifiedUI) {
      // Determine tone based on usage
      let tone: LiveStatusTone = 'info';
      if (percentage > 90) tone = 'danger';
      else if (percentage > 70) tone = 'warning';

      const message = `Context ${percentage}% used`;
      this.uiController.pushStatusOverride('context', message, undefined, tone);
    } else if (this.legacyPromptSkin) {
      // Legacy uses its own context display
      this.legacyPromptSkin.setContextPercent(percentage);
    }
  }

  /**
   * Show a user interrupt
   */
  showInterrupt(
    message: string,
    type: 'confirmation' | 'alert' | 'question' = 'alert',
    handler?: () => void | Promise<void>
  ): string {
    if (this.config.useUnifiedUI) {
      const priority = type === 'alert'
        ? InterruptPriority.HIGH
        : InterruptPriority.NORMAL;

      return this.uiController.queueInterrupt(
        type,
        message,
        priority,
        handler ? async () => handler() : undefined
      );
    } else {
      // For legacy, just show the message immediately
      this.display.showWarning(message);
      if (handler) {
        setTimeout(() => handler(), 0);
      }
      return 'legacy-interrupt';
    }
  }

  /**
   * Complete an interrupt
   */
  completeInterrupt(id: string): void {
    if (this.config.useUnifiedUI) {
      this.uiController.completeInterrupt(id);
    }
  }

  /**
   * Show slash command preview with dynamic overlay
   */
  showSlashCommandPreview(
    commands: Array<{ command: string; description: string }>,
    filterText?: string
  ): void {
    if (this.config.useUnifiedUI) {
      // Build a Claude Code-style command menu
      const terminalWidth = (this.display as any).writeStream?.columns || 80;
      const separator = '─'.repeat(terminalWidth - 1);

      // Build command lines with proper indentation
      const commandLines = commands.map(cmd => {
        // Wrap description to fit terminal width with indentation
        const descriptionIndent = '      '; // 6 spaces
        const maxDescWidth = terminalWidth - descriptionIndent.length - 2;
        const wrappedDesc = this.wrapText(cmd.description, maxDescWidth)
          .split('\n')
          .map(line => descriptionIndent + line)
          .join('\n');

        return `  ${cmd.command}\n${wrappedDesc}`;
      }).join('\n');

      // Create overlay content with separators and prompt
      const userInput = filterText || '/';
      const content = `${separator}\n> ${userInput}\n${separator}\n${commandLines}\n?`;

      // Use the unified UI overlay system
      this.uiController.updateCommandsOverlay(content);
    } else if (this.legacyStatusTracker) {
      // Legacy fallback - just show command names
      const preview = commands.map(c => c.command).join(' | ');
      this.legacyStatusTracker.pushOverride('slash-preview', `Commands: ${preview}`, {
        tone: 'info',
      });
    }
  }

  /**
   * Wrap text to fit within a max width
   */
  private wrapText(text: string, maxWidth: number): string {
    if (text.length <= maxWidth) return text;

    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxWidth) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) lines.push(currentLine);
    return lines.join('\n');
  }

  /**
   * Hide slash command preview
   */
  hideSlashCommandPreview(): void {
    if (this.config.useUnifiedUI) {
      this.uiController.hideCommandsOverlay();
    } else if (this.legacyStatusTracker) {
      this.legacyStatusTracker.clearOverride('slash-preview');
    }
  }

  /**
   * Show profile switcher (Shift+Tab)
   */
  showProfileSwitcher(
    profiles: Array<{ command: string; description: string }>,
    currentProfile: string
  ): void {
    if (this.config.useUnifiedUI) {
      // Build profile switcher overlay
      const terminalWidth = (this.display as any).writeStream?.columns || 80;
      const separator = '─'.repeat(terminalWidth - 1);

      // Build profile lines
      const profileLines = profiles.map(profile => {
        return `  ${profile.command}\n      ${profile.description}`;
      }).join('\n');

      // Create overlay content
      const header = `Switch Profile (Shift+Tab)`;
      const content = `${separator}\n${header}\n${separator}\n${profileLines}\n\nPress number to switch or Esc to cancel`;

      // Use the unified UI overlay system
      this.uiController.updateCommandsOverlay(content);

      // Auto-hide after 5 seconds
      setTimeout(() => {
        this.uiController.hideCommandsOverlay();
      }, 5000);
    } else if (this.legacyStatusTracker) {
      // Legacy fallback
      const preview = `Current: ${currentProfile} | Press Shift+Tab to switch`;
      this.legacyStatusTracker.pushOverride('profile-switch', preview, {
        tone: 'info',
      });
    }
  }

  /**
   * Enable or disable overlay
   */
  setOverlayEnabled(enabled: boolean): void {
    if (this.config.useUnifiedUI) {
      this.uiController.updateConfig({ enableOverlay: enabled });
    }
    // Legacy PromptSkin doesn't have setOverlayEnabled
  }

  /**
   * Get telemetry data (only available in unified mode)
   */
  getTelemetry(): any {
    if (this.config.useUnifiedUI) {
      return {
        snapshot: this.uiController.getTelemetrySnapshot(),
        performance: this.uiController.getPerformanceSummary(),
      };
    }
    return null;
  }

  /**
   * Switch between UI modes
   */
  switchUIMode(useUnified: boolean): void {
    this.config.useUnifiedUI = useUnified;

    if (useUnified) {
      // Hide legacy overlay if it exists
      if (this.legacyPromptSkin) {
        this.legacyPromptSkin.setOverlayVisible(false);
      }
    } else {
      // Switch back to legacy
      if (this.legacyPromptSkin) {
        this.legacyPromptSkin.setOverlayVisible(!this.isProcessing);
      }
    }
  }

  /**
   * Helper methods
   */

  private describeToolForDisplay(call: ToolCallRequest): string {
    const params = call.arguments as any;
    switch (call.name) {
      case 'Read':
      case 'read_file':
        return `⏺ Reading ${this.truncatePath(params.path)}`;
      case 'Write':
      case 'write_file':
        return `⏺ Writing ${this.truncatePath(params.path)}`;
      case 'Edit':
      case 'edit_file':
        return `⏺ Editing ${this.truncatePath(params.path)}`;
      case 'Bash':
      case 'bash':
        return `⏺ Running: ${this.truncateCommand(params.command)}`;
      case 'Grep':
      case 'search_files':
        return `⏺ Searching for: ${this.truncateQuery(params.query || params.pattern)}`;
      case 'Glob':
      case 'list_directory':
        return `⏺ Listing ${this.truncatePath(params.path || '.')}`;
      case 'WebFetch':
      case 'web_fetch':
        return `⏺ Fetching ${this.truncateUrl(params.url)}`;
      case 'WebSearch':
      case 'web_search':
        return `⏺ Searching: ${this.truncateQuery(params.query)}`;
      default:
        return `⏺ Running ${this.formatToolName(call.name)}`;
    }
  }

  private describeToolForLegacy(call: ToolCallRequest): string {
    const params = call.arguments as any;
    switch (call.name) {
      case 'read_file':
        return `Reading ${this.truncatePath(params.path)}`;
      case 'write_file':
        return `Writing ${this.truncatePath(params.path)}`;
      case 'bash':
        return `Running: ${this.truncateCommand(params.command)}`;
      default:
        return `Running ${call.name}`;
    }
  }

  private summarizeToolResult(call: ToolCallRequest, output: string): string {
    const lines = output.split('\n').filter(l => l.trim());
    const lineCount = lines.length;
    const args = call.arguments as any;

    // Claude Code style: ⏺ ToolName(args)\n  ⎿  Details
    switch (call.name) {
      case 'Read':
      case 'read_file':
        const readPath = this.abbreviatePathForDisplay(args.path || '');
        return `⏺ Read(${readPath})\n  ⎿  Read ${lineCount} lines`;
      case 'Write':
      case 'write_file':
        const writePath = this.abbreviatePathForDisplay(args.path || '');
        return `⏺ Write(${writePath})\n  ⎿  File written`;
      case 'Edit':
      case 'edit_file':
        const editPath = this.abbreviatePathForDisplay(args.path || '');
        const separator = '─'.repeat(59);
        return `⏺ Edit(${editPath})\n${separator}\n  Changes applied\n${separator}`;
      case 'Bash':
      case 'bash':
      case 'execute_bash':
        const cmd = this.truncateCommand(args.command, 40);
        return `⏺ Bash(${cmd})\n  ⎿  Completed`;
      case 'Grep':
      case 'grep_search':
        const pattern = args.pattern || args.query || '';
        return `⏺ Grep("${pattern}")\n  ⎿  Found matches`;
      case 'Glob':
      case 'list_files':
        return `⏺ Glob(${args.pattern || args.path || '.'})\n  ⎿  Listed files`;
      case 'WebFetch':
      case 'web_fetch':
        const url = this.truncateUrl(args.url || '', 35);
        return `⏺ WebFetch(${url})\n  ⎿  Content fetched`;
      default:
        return `⏺ ${this.formatToolName(call.name)}\n  ⎿  Completed`;
    }
  }

  private abbreviatePathForDisplay(path: string): string {
    if (!path) return '';
    // Keep reasonable length for display
    if (path.length <= 35) return path;
    const parts = path.split('/');
    if (parts.length <= 2) return path.slice(-35);
    // Show first and last parts
    return parts[0] + '/.../' + parts[parts.length - 1];
  }

  private getToolTone(tool: string): LiveStatusTone {
    const warningTools = ['bash', 'write_file', 'edit_file', 'delete_file'];
    return warningTools.includes(tool) ? 'warning' : 'info';
  }

  private truncatePath(path: string, maxLength: number = 40): string {
    if (!path) return '';
    if (path.length <= maxLength) return path;
    const parts = path.split('/');
    if (parts.length <= 2) {
      return '...' + path.slice(-(maxLength - 3));
    }
    return `${parts[0]}/.../${parts[parts.length - 1]}`;
  }

  private truncateCommand(command: string, maxLength: number = 40): string {
    if (!command) return '';
    if (command.length <= maxLength) return command;
    return command.slice(0, maxLength - 3) + '...';
  }

  private truncateQuery(query: string, maxLength: number = 30): string {
    if (!query) return '';
    if (query.length <= maxLength) return query;
    return query.slice(0, maxLength - 3) + '...';
  }

  private truncateUrl(url: string, maxLength: number = 40): string {
    if (!url) return '';
    if (url.length <= maxLength) return url;
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + (urlObj.pathname.length > 10 ? '/...' : urlObj.pathname);
    } catch {
      return url.slice(0, maxLength - 3) + '...';
    }
  }

  private formatToolName(name: string): string {
    // Convert snake_case or camelCase to Title Case
    return name
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .trim()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Get current UI mode
   */
  getCurrentMode(): 'unified' | 'legacy' {
    return this.config.useUnifiedUI ? 'unified' : 'legacy';
  }

  /**
   * Get UI state
   */
  getState(): any {
    if (this.config.useUnifiedUI) {
      return this.uiController.getState();
    } else {
      return {
        isProcessing: this.isProcessing,
        contextUsage: this.contextUsage,
      };
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.uiController.dispose();

    if (this.legacyPromptSkin) {
      // Legacy promptSkin doesn't have dispose, but we can clean up
      this.legacyPromptSkin.setOverlayVisible(false);
    }

    if (this.legacyStatusTracker) {
      // Clear all status
      this.legacyStatusTracker.reset();
    }
  }
}