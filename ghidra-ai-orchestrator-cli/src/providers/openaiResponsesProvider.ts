import OpenAI from 'openai';
import type {
  FunctionTool,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputRefusal,
  Response,
  Tool,
} from 'openai/resources/responses/responses.js';
import type {
  ConversationMessage,
  LLMProvider,
  ProviderId,
  ProviderResponse,
  ProviderToolDefinition,
  ToolCallRequest,
  ProviderUsage,
  ReasoningEffortLevel,
  TextVerbosityLevel,
} from '../core/types.js';

interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  providerId?: ProviderId;
  baseURL?: string;
  reasoningEffort?: ReasoningEffortLevel;
  textVerbosity?: TextVerbosityLevel;
}

type ResponsesCreateParams = Parameters<OpenAI['responses']['create']>[0];
type EnhancedResponsesCreateParams = ResponsesCreateParams & {
  reasoning?: { effort: ReasoningEffortLevel };
  text?: { verbosity: TextVerbosityLevel };
};
type ResponsesCreateResult = Awaited<ReturnType<OpenAI['responses']['create']>>;

export class OpenAIResponsesProvider implements LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  private readonly client: OpenAI;
  private readonly reasoningEffort?: ReasoningEffortLevel;
  private readonly textVerbosity?: TextVerbosityLevel;

  constructor(options: OpenAIProviderOptions) {
    const clientConfig: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: options.apiKey,
    };

    if (options.baseURL) {
      clientConfig.baseURL = options.baseURL;
    }

    this.client = new OpenAI(clientConfig);
    this.id = options.providerId ?? 'openai';
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort;
    this.textVerbosity = options.textVerbosity;
  }

  async generate(messages: ConversationMessage[], tools: ProviderToolDefinition[]): Promise<ProviderResponse> {
    const request: EnhancedResponsesCreateParams = {
      model: this.model,
      input: mapMessages(messages),
      tools: tools.length ? tools.map(mapTool) : undefined,
      stream: false,
    };

    if (this.reasoningEffort) {
      request.reasoning = { effort: this.reasoningEffort };
    }
    if (this.textVerbosity) {
      request.text = { verbosity: this.textVerbosity };
    }

    const response = await this.client.responses.create(request);
    assertHasOutput(response);

    const toolCalls = response.output.filter(isFunctionCall).map(mapToolCall);
    const usage = mapUsage(response.usage);
    if (toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls,
        content: extractTextContent(response),
        usage,
      };
    }

    return {
      type: 'message',
      content: extractTextContent(response),
      usage,
    };
  }
}

function mapMessages(messages: ConversationMessage[]): ResponseInput {
  const input: ResponseInput = [];
  for (const message of messages) {
    switch (message.role) {
      case 'system':
      case 'user':
      case 'assistant': {
        input.push({
          role: message.role,
          content: message.content,
          type: 'message',
        });
        if (message.role === 'assistant') {
          for (const call of message.toolCalls ?? []) {
            input.push({
              type: 'function_call',
              call_id: call.id,
              name: call.name,
              arguments: JSON.stringify(call.arguments ?? {}),
            });
          }
        }
        break;
      }
      case 'tool': {
        input.push({
          type: 'function_call_output',
          call_id: message.toolCallId,
          output: JSON.stringify(message.content),
        });
        break;
      }
      default:
        break;
    }
  }
  return input;
}

function mapTool(definition: ProviderToolDefinition): Tool {
  return {
    type: 'function',
    name: definition.name,
    description: definition.description,
    parameters: (definition.parameters ?? {
      type: 'object',
      properties: {},
    }) as FunctionTool['parameters'],
    strict: false,
  };
}

function extractTextContent(response: Response): string {
  const primary = collectOutputText(response.output);
  if (primary) {
    return primary;
  }

  const aggregated = typeof response.output_text === 'string' ? response.output_text.trim() : '';
  if (aggregated) {
    return aggregated;
  }

  const refusal = collectRefusalText(response.output);
  if (refusal) {
    return refusal;
  }

  return '';
}

function collectOutputText(output: ResponseOutputItem[]): string {
  const chunks: string[] = [];
  for (const item of output) {
    if (!isOutputMessage(item)) {
      continue;
    }
    for (const block of item.content) {
      if (block.type === 'output_text') {
        chunks.push(block.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

function collectRefusalText(output: ResponseOutputItem[]): string {
  for (const item of output) {
    if (!isOutputMessage(item)) {
      continue;
    }
    for (const block of item.content) {
      if (isRefusal(block) && block.refusal?.trim()) {
        return block.refusal.trim();
      }
    }
  }
  return '';
}

function mapToolCall(call: ResponseFunctionToolCall): ToolCallRequest {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(call.arguments ?? '{}');
  } catch {
    parsed = {};
  }

  return {
    id: call.call_id ?? call.id ?? '',
    name: call.name,
    arguments: parsed,
  };
}

function mapUsage(usage?: Response['usage'] | null): ProviderUsage | null {
  if (!usage) {
    return null;
  }
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.total_tokens,
  };
}

function isFunctionCall(item: ResponseOutputItem): item is ResponseFunctionToolCall {
  return item.type === 'function_call';
}

function isOutputMessage(item: ResponseOutputItem): item is ResponseOutputMessage {
  return item.type === 'message';
}

function isRefusal(block: ResponseOutputMessage['content'][number]): block is ResponseOutputRefusal {
  return block.type === 'refusal';
}

function assertHasOutput(response: ResponsesCreateResult): asserts response is Response {
  if (!('output' in response)) {
    throw new Error('Streaming responses are not supported in this runtime.');
  }
}
