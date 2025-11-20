import type { ToolRuntime } from './toolRuntime.js';
import {
  type ConversationMessage,
  type LLMProvider,
  type ProviderToolDefinition,
  type ToolCallRequest,
  type ProviderUsage,
} from './types.js';
import { ContextManager } from './contextManager.js';

export interface AgentCallbacks {
  onAssistantMessage?(content: string, metadata: AssistantMessageMetadata): void;
  onStreamChunk?(chunk: string): void;
  onContextPruned?(removedCount: number, stats: Record<string, unknown>): void;
}

export interface AssistantMessageMetadata {
  isFinal: boolean;
  elapsedMs?: number;
  usage?: ProviderUsage | null;
  contextStats?: Record<string, unknown> | null;
}

interface AgentOptions {
  provider: LLMProvider;
  toolRuntime: ToolRuntime;
  systemPrompt: string;
  callbacks?: AgentCallbacks;
  contextManager?: ContextManager;
}

export class AgentRuntime {
  private readonly messages: ConversationMessage[] = [];
  private readonly provider: LLMProvider;
  private readonly toolRuntime: ToolRuntime;
  private readonly callbacks: AgentCallbacks;
  private readonly contextManager: ContextManager | null;
  private activeRun: { startedAt: number } | null = null;
  private readonly baseSystemPrompt: string | null;

  constructor(options: AgentOptions) {
    this.provider = options.provider;
    this.toolRuntime = options.toolRuntime;
    this.callbacks = options.callbacks ?? {};
    this.contextManager = options.contextManager ?? null;

    const trimmedPrompt = options.systemPrompt.trim();
    this.baseSystemPrompt = trimmedPrompt || null;
    if (trimmedPrompt) {
      this.messages.push({ role: 'system', content: trimmedPrompt });
    }
  }

  async send(text: string, useStreaming = false): Promise<string> {
    const prompt = text.trim();
    if (!prompt) {
      return '';
    }

    this.messages.push({ role: 'user', content: prompt });
    const run = { startedAt: Date.now() };
    this.activeRun = run;
    try {
      if (useStreaming && this.provider.generateStream) {
        return await this.processConversationStreaming();
      }
      return await this.processConversation();
    } finally {
      if (this.activeRun === run) {
        this.activeRun = null;
      }
    }
  }

  private async processConversation(): Promise<string> {
    while (true) {
      // Prune messages if approaching context limit
      this.pruneMessagesIfNeeded();

      const response = await this.provider.generate(this.messages, this.providerTools);
      const usage = response.usage ?? null;
      const contextStats = this.getContextStats();

      if (response.type === 'tool_calls') {
        const narration = response.content?.trim();
        if (narration) {
          this.emitAssistantMessage(narration, { isFinal: false, usage, contextStats });
        }
        const assistantMessage: ConversationMessage = {
          role: 'assistant',
          content: response.content ?? '',
        };
        if (response.toolCalls?.length) {
          assistantMessage.toolCalls = response.toolCalls;
        }
        this.messages.push(assistantMessage);
        await this.resolveToolCalls(response.toolCalls);
        continue;
      }

      const reply = response.content?.trim() ?? '';
      if (reply) {
        this.emitAssistantMessage(reply, { isFinal: true, usage, contextStats });
      }
      this.messages.push({ role: 'assistant', content: reply });
      return reply;
    }
  }

  private async processConversationStreaming(): Promise<string> {
    if (!this.provider.generateStream) {
      return this.processConversation();
    }

    while (true) {
      // Prune messages if approaching context limit
      this.pruneMessagesIfNeeded();

      let fullContent = '';
      const toolCalls: ToolCallRequest[] = [];
      let usage: ProviderUsage | null = null;

      const stream = this.provider.generateStream(this.messages, this.providerTools);

      for await (const chunk of stream) {
        if (chunk.type === 'content' && chunk.content) {
          fullContent += chunk.content;
          this.callbacks.onStreamChunk?.(chunk.content);
        } else if (chunk.type === 'tool_call' && chunk.toolCall) {
          toolCalls.push(chunk.toolCall);
        } else if (chunk.type === 'usage' && chunk.usage) {
          usage = chunk.usage;
        }
      }

      const contextStats = this.getContextStats();

      // Check if we got tool calls
      if (toolCalls.length > 0) {
        const narration = fullContent.trim();
        if (narration) {
          this.emitAssistantMessage(narration, { isFinal: false, usage, contextStats });
        }
        const assistantMessage: ConversationMessage = {
          role: 'assistant',
          content: fullContent,
          toolCalls,
        };
        this.messages.push(assistantMessage);
        await this.resolveToolCalls(toolCalls);
        continue;
      }

      // Final message
      const reply = fullContent.trim();
      if (reply) {
        this.emitAssistantMessage(reply, { isFinal: true, usage, contextStats });
      }
      this.messages.push({ role: 'assistant', content: reply });
      return reply;
    }
  }

  private async resolveToolCalls(toolCalls: ToolCallRequest[]): Promise<void> {
    // Execute all tool calls in parallel for better performance
    const results = await Promise.all(
      toolCalls.map(async (call) => ({
        call,
        output: await this.toolRuntime.execute(call),
      }))
    );

    // Add results to messages in the same order as tool calls
    for (const { call, output } of results) {
      this.messages.push({
        role: 'tool',
        name: call.name,
        toolCallId: call.id,
        content: output,
      });
    }
  }

  private get providerTools(): ProviderToolDefinition[] {
    return this.toolRuntime.listProviderTools();
  }

  private emitAssistantMessage(content: string, metadata: AssistantMessageMetadata): void {
    if (!content) {
      return;
    }
    const elapsedMs = this.activeRun ? Date.now() - this.activeRun.startedAt : undefined;
    const payload: AssistantMessageMetadata = { ...metadata };
    if (typeof elapsedMs === 'number') {
      payload.elapsedMs = elapsedMs;
    }
    this.callbacks.onAssistantMessage?.(content, payload);
  }

  getHistory(): ConversationMessage[] {
    return this.messages.map(cloneMessage);
  }

  loadHistory(history: ConversationMessage[]): void {
    this.messages.length = 0;
    if (history.length === 0) {
      if (this.baseSystemPrompt) {
        this.messages.push({ role: 'system', content: this.baseSystemPrompt });
      }
      return;
    }
    for (const message of history) {
      this.messages.push(cloneMessage(message));
    }
  }

  clearHistory(): void {
    this.messages.length = 0;
    if (this.baseSystemPrompt) {
      this.messages.push({ role: 'system', content: this.baseSystemPrompt });
    }
  }

  /**
   * Prune messages if approaching context limit
   */
  private pruneMessagesIfNeeded(): void {
    if (!this.contextManager) {
      return;
    }

    if (this.contextManager.isApproachingLimit(this.messages)) {
      const result = this.contextManager.pruneMessages(this.messages);
      if (result.removed > 0) {
        // Replace messages with pruned version
        this.messages.length = 0;
        this.messages.push(...result.pruned);

        // Notify callback
        const stats = this.contextManager.getStats(this.messages);
        this.callbacks.onContextPruned?.(result.removed, stats);

        if (process.env['DEBUG_CONTEXT']) {
          console.warn(
            `[Context Manager] Pruned ${result.removed} messages. ` +
            `Tokens: ${stats.totalTokens} (${stats.percentage}%)`
          );
        }
      }
    }
  }

  /**
   * Get current context statistics
   */
  private getContextStats(): Record<string, unknown> | null {
    if (!this.contextManager) {
      return null;
    }
    return this.contextManager.getStats(this.messages);
  }

  /**
   * Get context manager instance
   */
  getContextManager(): ContextManager | null {
    return this.contextManager;
  }
}

function cloneMessage(message: ConversationMessage): ConversationMessage {
  switch (message.role) {
    case 'assistant':
      const clone: ConversationMessage = {
        role: 'assistant',
        content: message.content,
      };
      if (message.toolCalls) {
        clone.toolCalls = message.toolCalls.map(cloneToolCall);
      }
      return clone;
    case 'tool':
      return {
        role: 'tool',
        name: message.name,
        content: message.content,
        toolCallId: message.toolCallId,
      };
    case 'system':
      return { role: 'system', content: message.content };
    case 'user':
    default:
      return { role: 'user', content: message.content };
  }
}

function cloneToolCall(call: ToolCallRequest): ToolCallRequest {
  return {
    id: call.id,
    name: call.name,
    arguments: { ...(call.arguments ?? {}) },
  };
}
