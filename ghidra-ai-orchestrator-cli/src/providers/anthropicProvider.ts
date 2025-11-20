import Anthropic from '@anthropic-ai/sdk';
import { APIError, RateLimitError } from '@anthropic-ai/sdk/error.js';
import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages.js';
import type {
  ConversationMessage,
  LLMProvider,
  ProviderResponse,
  ProviderToolDefinition,
  ProviderUsage,
  StreamChunk,
  ToolCallRequest,
} from '../core/types.js';

interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  rateLimitMaxRetries?: number;
  rateLimitInitialDelayMs?: number;
  enablePromptCaching?: boolean;
}

const DEFAULT_RATE_LIMIT_RETRIES = 4;
const DEFAULT_RATE_LIMIT_INITIAL_DELAY_MS = 1500;
const MIN_RATE_LIMIT_DELAY_MS = 750;
const MAX_RATE_LIMIT_DELAY_MS = 40_000;

export class AnthropicMessagesProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly rateLimitMaxRetries: number;
  private readonly rateLimitInitialDelayMs: number;
  private readonly enablePromptCaching: boolean;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 2048;
    this.temperature = options.temperature ?? 0;
    this.rateLimitMaxRetries = Math.max(0, options.rateLimitMaxRetries ?? DEFAULT_RATE_LIMIT_RETRIES);
    this.rateLimitInitialDelayMs = Math.max(
      MIN_RATE_LIMIT_DELAY_MS,
      options.rateLimitInitialDelayMs ?? DEFAULT_RATE_LIMIT_INITIAL_DELAY_MS
    );
    this.enablePromptCaching = options.enablePromptCaching ?? true;
  }

  async generate(messages: ConversationMessage[], tools: ProviderToolDefinition[]): Promise<ProviderResponse> {
    const { system, chat } = convertConversation(messages, this.enablePromptCaching);
    const response = await this.executeWithRateLimitRetries(() =>
      this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        messages: chat,
        ...(system ? { system } : {}),
        ...(tools.length ? { tools: tools.map(mapTool) } : {}),
      })
    );

    const usage = mapUsage(response.usage);

    const toolCalls = response.content
      .filter((block): block is ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments: toRecord(block.input),
      }));

    const textContent = response.content
      .filter((block) => block.type === 'text')
      .map((block) => ('text' in block ? (block as { text: string }).text : ''))
      .join('\n')
      .trim();

    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls,
        content: textContent,
        usage,
      };
    }

    return {
      type: 'message',
      content: textContent,
      usage,
    };
  }

  async *generateStream(messages: ConversationMessage[], tools: ProviderToolDefinition[]): AsyncIterableIterator<StreamChunk> {
    const { system, chat } = convertConversation(messages, this.enablePromptCaching);

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      messages: chat,
      ...(system ? { system } : {}),
      ...(tools.length ? { tools: tools.map(mapTool) } : {}),
    });

    let currentToolCall: Partial<ToolCallRequest> | null = null;
    let currentToolCallInput = '';
    let toolCallId = '';

    for await (const event of stream) {
      // Handle different event types
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          toolCallId = block.id;
          currentToolCall = {
            id: block.id,
            name: block.name,
            arguments: {},
          };
          currentToolCallInput = '';
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield {
            type: 'content',
            content: delta.text,
          };
        } else if (delta.type === 'input_json_delta' && currentToolCall) {
          // accumulate tool input JSON fragments
          if (typeof delta.partial_json === 'string' && delta.partial_json) {
            currentToolCallInput += delta.partial_json;
          }
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolCall && toolCallId) {
          if (currentToolCallInput.trim()) {
            try {
              currentToolCall.arguments = toRecord(JSON.parse(currentToolCallInput));
            } catch {
              currentToolCall.arguments = {};
            }
          }
          yield {
            type: 'tool_call',
            toolCall: currentToolCall as ToolCallRequest,
          };
          currentToolCall = null;
          currentToolCallInput = '';
          toolCallId = '';
        }
      } else if (event.type === 'message_stop') {
        const finalMessage = await stream.finalMessage();
        const usage = mapUsage(finalMessage.usage);
        if (usage) {
          yield {
            type: 'usage',
            usage,
          };
        }
        yield {
          type: 'done',
        };
      }
    }
  }

  getCapabilities() {
    return {
      streaming: true,
      toolCalling: true,
      vision: this.model.includes('sonnet') || this.model.includes('opus'),
      functionCalling: true,
      maxTokens: this.maxTokens,
      supportedModalities: ['text', 'image'] as ('text' | 'image' | 'audio')[],
    };
  }

  private async executeWithRateLimitRetries<T>(operation: () => Promise<T>): Promise<T> {
    let retries = 0;
    let delayMs = this.rateLimitInitialDelayMs;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!isRateLimitError(error)) {
          throw error;
        }
        if (retries >= this.rateLimitMaxRetries) {
          throw buildRateLimitFailureError(error, retries);
        }
        const waitMs = determineRetryDelay(error.headers, delayMs);
        await sleep(waitMs);
        retries += 1;
        delayMs = Math.min(delayMs * 2, MAX_RATE_LIMIT_DELAY_MS);
      }
    }
  }
}

function convertConversation(
  messages: ConversationMessage[],
  enablePromptCaching = false
): { system: string | null; chat: MessageParam[] } {
  const systemPrompts: string[] = [];
  const chat: MessageParam[] = [];

  for (const message of messages) {
    switch (message.role) {
      case 'system': {
        systemPrompts.push(message.content);
        break;
      }
      case 'user': {
        chat.push({
          role: 'user',
          content: [{ type: 'text', text: message.content }],
        });
        break;
      }
      case 'assistant': {
        const contentBlocks: MessageParam['content'] = [];
        if (message.content.trim().length > 0) {
          contentBlocks.push({ type: 'text', text: message.content });
        }
        for (const call of message.toolCalls ?? []) {
          contentBlocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.arguments,
          });
        }
        chat.push({
          role: 'assistant',
          content: contentBlocks.length ? contentBlocks : [{ type: 'text', text: '' }],
        });
        break;
      }
      case 'tool': {
        const block: ToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: message.toolCallId,
          content: [{ type: 'text', text: message.content }],
        };
        chat.push({
          role: 'user',
          content: [block],
        });
        break;
      }
      default:
        break;
    }
  }

  // Add cache control breakpoints to optimize costs
  // Cache the first few user messages (usually contain system context)
  if (enablePromptCaching && chat.length > 2) {
    const cacheBreakpoint = Math.min(2, chat.length - 1);
    for (let i = 0; i < cacheBreakpoint; i++) {
      const message = chat[i];
      if (message && message.role === 'user' && Array.isArray(message.content)) {
        const lastContent = message.content[message.content.length - 1];
        if (lastContent && 'text' in lastContent) {
          (lastContent as unknown as Record<string, unknown>)['cache_control'] = { type: 'ephemeral' };
        }
      }
    }
  }

  return {
    system: systemPrompts.length ? systemPrompts.join('\n\n') : null,
    chat,
  };
}

function mapTool(definition: ProviderToolDefinition): Tool {
  return {
    name: definition.name,
    description: definition.description,
    input_schema:
      definition.parameters ?? ({
        type: 'object',
        properties: {},
      } as Tool['input_schema']),
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (isPlainRecord(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      return isPlainRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapUsage(usage?: { input_tokens?: number; output_tokens?: number } | null): ProviderUsage | null {
  if (!usage) {
    return null;
  }
  const total = typeof usage.input_tokens === 'number' && typeof usage.output_tokens === 'number'
    ? usage.input_tokens + usage.output_tokens
    : undefined;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: total,
  };
}

function isRateLimitError(error: unknown): error is APIError {
  if (error instanceof RateLimitError) {
    return true;
  }
  if (error instanceof APIError && error.status === 429) {
    return true;
  }
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status?: number }).status === 429;
}

function determineRetryDelay(headers: HeadersLike, fallbackMs: number): number {
  const retryAfter = parseRetryAfterHeader(headers);
  if (retryAfter !== null) {
    return clamp(retryAfter, MIN_RATE_LIMIT_DELAY_MS, MAX_RATE_LIMIT_DELAY_MS);
  }
  const jitter = fallbackMs * 0.25;
  const randomized = fallbackMs + (Math.random() * (2 * jitter) - jitter);
  return clamp(Math.round(randomized), MIN_RATE_LIMIT_DELAY_MS, MAX_RATE_LIMIT_DELAY_MS);
}

function parseRetryAfterHeader(headers: HeadersLike): number | null {
  if (!headers || typeof headers.get !== 'function') {
    return null;
  }
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) {
    return null;
  }
  const numeric = Number(retryAfter);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }
  const parsedDate = Date.parse(retryAfter);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

function buildRateLimitFailureError(error: APIError, retries: number): Error {
  const baseMessage =
    'Anthropic rejected the request because the per-minute token rate limit was exceeded.';
  const retryDetails =
    retries > 0 ? ` Waited and retried ${retries} time${retries === 1 ? '' : 's'} without success.` : '';
  const advisory =
    ' Reduce the prompt size or wait for usage to reset before trying again. ' +
    'See https://docs.claude.com/en/api/rate-limits for quota guidance.';
  const original = error.message ? `\nOriginal message: ${error.message}` : '';
  return new Error(`${baseMessage}${retryDetails}${advisory}${original}`, {
    cause: error,
  });
}

type HeadersLike = {
  get?: (header: string) => string | null | undefined;
} | null | undefined;
