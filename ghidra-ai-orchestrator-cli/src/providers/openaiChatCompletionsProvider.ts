import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions.js';
import type { FunctionDefinition } from 'openai/resources/shared.js';
import type {
  ConversationMessage,
  LLMProvider,
  ProviderId,
  ProviderResponse,
  ProviderToolDefinition,
  ToolCallRequest,
  ProviderUsage,
} from '../core/types.js';

interface OpenAIChatCompletionsOptions {
  apiKey: string;
  model: string;
  providerId?: ProviderId;
  baseURL?: string;
}

type ChatCompletionsResult = Awaited<ReturnType<OpenAI['chat']['completions']['create']>>;

export class OpenAIChatCompletionsProvider implements LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(options: OpenAIChatCompletionsOptions) {
    const clientConfig: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: options.apiKey,
    };

    if (options.baseURL) {
      clientConfig.baseURL = options.baseURL;
    }

    this.client = new OpenAI(clientConfig);
    this.id = options.providerId ?? 'openai';
    this.model = options.model;
  }

  async generate(messages: ConversationMessage[], tools: ProviderToolDefinition[]): Promise<ProviderResponse> {
    const request: Parameters<OpenAI['chat']['completions']['create']>[0] = {
      model: this.model,
      messages: mapMessages(messages),
      tools: tools.length ? tools.map(mapTool) : undefined,
      stream: false,
    };

    const completion = await this.client.chat.completions.create(request);
    assertHasChoices(completion);
    const choice = completion.choices[0];
    const usage = mapUsage(completion.usage);

    if (!choice) {
      return {
        type: 'message',
        content: '',
        usage,
      };
    }

    const toolCalls = (choice.message.tool_calls ?? []).map(mapToolCall);
    const content = extractMessageContent(choice);

    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls,
        content,
        usage,
      };
    }

    return {
      type: 'message',
      content,
      usage,
    };
  }
}

function mapMessages(messages: ConversationMessage[]): ChatCompletionMessageParam[] {
  const params: ChatCompletionMessageParam[] = [];

  for (const message of messages) {
    switch (message.role) {
      case 'system':
      case 'user': {
        params.push({
          role: message.role,
          content: message.content,
        });
        break;
      }
      case 'assistant': {
        params.push({
          role: 'assistant',
          content: message.content,
          tool_calls: message.toolCalls?.map((call, index) => ({
            id: call.id || `call_${index}`,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments ?? {}),
            },
          })),
        });
        break;
      }
      case 'tool': {
        params.push({
          role: 'tool',
          content: message.content,
          tool_call_id: message.toolCallId,
        });
        break;
      }
      default:
        break;
    }
  }

  return params;
}

function mapTool(definition: ProviderToolDefinition): ChatCompletionTool {
  const parameters: FunctionDefinition['parameters'] =
    definition.parameters ??
    ({
      type: 'object',
      properties: {},
    } as Record<string, unknown>);

  return {
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters,
    },
  };
}

function extractMessageContent(choice: ChatCompletion.Choice): string {
  const message = choice.message;
  const content = message?.content;

  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }

  const refusal = message?.refusal;
  if (typeof refusal === 'string' && refusal.trim()) {
    return refusal.trim();
  }

  return '';
}

function mapToolCall(call: ChatCompletionMessageToolCall): ToolCallRequest {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(call.function.arguments ?? '{}');
  } catch {
    parsed = {};
  }

  return {
    id: call.id ?? call.function.name,
    name: call.function.name,
    arguments: parsed,
  };
}

function mapUsage(usage?: ChatCompletion['usage'] | null): ProviderUsage | null {
  if (!usage) {
    return null;
  }

  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function assertHasChoices(result: ChatCompletionsResult): asserts result is ChatCompletion {
  if (!('choices' in result)) {
    throw new Error('Streaming responses are not supported in this runtime.');
  }
}
