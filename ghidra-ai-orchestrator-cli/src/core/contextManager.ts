/**
 * ContextManager - Manages conversation context to prevent token limit leaks
 *
 * Responsibilities:
 * - Truncate tool outputs intelligently
 * - Prune old conversation history
 * - Track and estimate token usage
 * - Keep conversation within budget
 */

import type { ConversationMessage } from './types.js';
import { getContextWindowTokens } from './contextWindow.js';

export interface ContextManagerConfig {
  maxTokens: number; // Maximum tokens allowed in conversation
  targetTokens: number; // Target to stay under (allows headroom)
  maxToolOutputLength: number; // Max characters for tool outputs
  preserveRecentMessages: number; // Number of recent exchanges to always keep
  estimatedCharsPerToken: number; // Rough estimation (usually ~4 for English)
}

export interface TruncationResult {
  content: string;
  wasTruncated: boolean;
  originalLength: number;
  truncatedLength: number;
}

export class ContextManager {
  private config: ContextManagerConfig;

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = {
      maxTokens: 130000, // Leave room below 131072 limit
      targetTokens: 100000, // Target to trigger pruning
      maxToolOutputLength: 10000, // 10k chars max per tool output
      preserveRecentMessages: 10, // Keep last 10 user/assistant exchanges
      estimatedCharsPerToken: 3, // Conservative estimate for code-heavy contexts
      ...config,
    };
  }

  /**
   * Truncate tool output intelligently
   */
  truncateToolOutput(output: string, toolName: string): TruncationResult {
    const originalLength = output.length;

    if (originalLength <= this.config.maxToolOutputLength) {
      return {
        content: output,
        wasTruncated: false,
        originalLength,
        truncatedLength: originalLength,
      };
    }

    // Intelligent truncation based on tool type
    let truncated = this.intelligentTruncate(output, toolName);
    const truncatedLength = truncated.length;

    return {
      content: truncated,
      wasTruncated: true,
      originalLength,
      truncatedLength,
    };
  }

  /**
   * Intelligent truncation based on tool type
   */
  private intelligentTruncate(output: string, toolName: string): string {
    const maxLength = this.config.maxToolOutputLength;

    // For file reads, show beginning and end
    if (toolName === 'Read' || toolName === 'read_file') {
      return this.truncateFileOutput(output, maxLength);
    }

    // For search results, keep first N results
    if (toolName === 'Grep' || toolName === 'grep_search' || toolName === 'Glob') {
      return this.truncateSearchOutput(output, maxLength);
    }

    // For bash/command output, keep end (usually most relevant)
    if (toolName === 'Bash' || toolName === 'bash' || toolName === 'execute_bash') {
      return this.truncateBashOutput(output, maxLength);
    }

    // Default: show beginning with truncation notice
    return this.truncateDefault(output, maxLength);
  }

  private truncateFileOutput(output: string, maxLength: number): string {
    const lines = output.split('\n');
    if (lines.length <= 100) {
      // For small files, just truncate text
      return this.truncateDefault(output, maxLength);
    }

    // Show first 50 and last 50 lines
    const keepLines = Math.floor(maxLength / 100); // Rough estimate
    const headLines = lines.slice(0, keepLines);
    const tailLines = lines.slice(-keepLines);

    const truncatedCount = lines.length - (keepLines * 2);

    return [
      ...headLines,
      `\n... [${truncatedCount} lines truncated for context management] ...\n`,
      ...tailLines,
    ].join('\n');
  }

  private truncateSearchOutput(output: string, maxLength: number): string {
    const lines = output.split('\n');
    const keepLines = Math.floor(maxLength / 80); // Rough average line length

    if (lines.length <= keepLines) {
      return output;
    }

    const truncatedCount = lines.length - keepLines;
    return [
      ...lines.slice(0, keepLines),
      `\n... [${truncatedCount} more results truncated for context management] ...`,
    ].join('\n');
  }

  private truncateBashOutput(output: string, maxLength: number): string {
    if (output.length <= maxLength) {
      return output;
    }

    // For command output, the end is usually most important (errors, final status)
    const keepChars = Math.floor(maxLength * 0.8); // 80% at end
    const prefixChars = maxLength - keepChars - 100; // Small prefix

    const prefix = output.slice(0, prefixChars);
    const suffix = output.slice(-keepChars);
    const truncatedChars = output.length - prefixChars - keepChars;

    return `${prefix}\n\n... [${truncatedChars} characters truncated for context management] ...\n\n${suffix}`;
  }

  private truncateDefault(output: string, maxLength: number): string {
    if (output.length <= maxLength) {
      return output;
    }

    const truncatedChars = output.length - maxLength + 100; // Account for notice
    return `${output.slice(0, maxLength - 100)}\n\n... [${truncatedChars} characters truncated for context management] ...`;
  }

  /**
   * Estimate tokens in a message
   */
  estimateTokens(message: ConversationMessage): number {
    let charCount = 0;

    if (message.content) {
      charCount += message.content.length;
    }

    if (message.role === 'assistant' && message.toolCalls) {
      // Tool calls add overhead
      for (const call of message.toolCalls) {
        charCount += call.name.length;
        charCount += JSON.stringify(call.arguments).length;
      }
    }

    return Math.ceil(charCount / this.config.estimatedCharsPerToken);
  }

  /**
   * Estimate total tokens in conversation
   */
  estimateTotalTokens(messages: ConversationMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateTokens(msg), 0);
  }

  /**
   * Prune old messages when approaching limit
   */
  pruneMessages(messages: ConversationMessage[]): {
    pruned: ConversationMessage[];
    removed: number;
  } {
    const totalTokens = this.estimateTotalTokens(messages);

    // Only prune if we're above target
    if (totalTokens < this.config.targetTokens) {
      return { pruned: messages, removed: 0 };
    }

    // Always keep system message (first)
    const firstMessage = messages[0];
    const systemMessage = firstMessage?.role === 'system' ? firstMessage : null;
    const conversationMessages = systemMessage ? messages.slice(1) : messages;

    // Keep recent messages based on preserveRecentMessages
    // Count user/assistant pairs
    const recentMessages: ConversationMessage[] = [];
    let exchangeCount = 0;

    for (let i = conversationMessages.length - 1; i >= 0; i--) {
      const msg = conversationMessages[i];
      if (!msg) continue;
      recentMessages.unshift(msg);

      if (msg.role === 'user') {
        exchangeCount++;
        if (exchangeCount >= this.config.preserveRecentMessages) {
          break;
        }
      }
    }

    // Build pruned message list
    const pruned: ConversationMessage[] = [];
    if (systemMessage) {
      pruned.push(systemMessage);
    }

    // Add a context summary message if we removed messages
    const removedCount = conversationMessages.length - recentMessages.length;
    if (removedCount > 0) {
      pruned.push({
        role: 'system',
        content: `[Context Manager: Removed ${removedCount} old messages to stay within token budget. Recent conversation history preserved.]`,
      });
    }

    pruned.push(...recentMessages);

    return {
      pruned,
      removed: removedCount,
    };
  }

  /**
   * Check if we're approaching the limit
   */
  isApproachingLimit(messages: ConversationMessage[]): boolean {
    const totalTokens = this.estimateTotalTokens(messages);
    return totalTokens >= this.config.targetTokens;
  }

  /**
   * Get context stats
   */
  getStats(messages: ConversationMessage[]): {
    totalTokens: number;
    percentage: number;
    isOverLimit: boolean;
    isApproachingLimit: boolean;
  } {
    const totalTokens = this.estimateTotalTokens(messages);
    const percentage = Math.round((totalTokens / this.config.maxTokens) * 100);

    return {
      totalTokens,
      percentage,
      isOverLimit: totalTokens >= this.config.maxTokens,
      isApproachingLimit: totalTokens >= this.config.targetTokens,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

const DEFAULT_CONTEXT_HEADROOM = 0.97;
const DEFAULT_TARGET_RATIO = 0.75;

/**
 * Derives a context manager configuration based on the active model's context window.
 */
export function resolveContextManagerConfig(model: string | null | undefined): Partial<ContextManagerConfig> {
  const windowTokens = getContextWindowTokens(model);
  if (!windowTokens) {
    return {};
  }

  const maxTokens = Math.max(1000, Math.floor(windowTokens * DEFAULT_CONTEXT_HEADROOM));
  const targetTokens = Math.max(500, Math.floor(maxTokens * DEFAULT_TARGET_RATIO));

  return { maxTokens, targetTokens };
}

/**
 * Create a default context manager instance
 */
export function createDefaultContextManager(
  overrides: Partial<ContextManagerConfig> = {}
): ContextManager {
  return new ContextManager({
    maxTokens: 130000, // Safe limit below 131072
    targetTokens: 100000, // Start pruning at 100k
    maxToolOutputLength: 8000, // 8k chars max
    preserveRecentMessages: 8, // Keep last 8 exchanges
    estimatedCharsPerToken: 3, // Conservative estimate for code-heavy text
    ...overrides,
  });
}
