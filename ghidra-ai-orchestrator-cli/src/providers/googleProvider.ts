import {
  GoogleGenAI,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponseUsageMetadata,
  type Tool,
  type FunctionCall,
} from '@google/genai';
import type {
  AssistantMessage,
  ConversationMessage,
  LLMProvider,
  ProviderId,
  ProviderResponse,
  ProviderToolDefinition,
  ProviderUsage,
  ToolCallRequest,
  ToolMessage,
} from '../core/types.js';

interface GoogleGenAIProviderOptions {
  apiKey: string;
  model: string;
  providerId?: ProviderId;
  temperature?: number;
  maxOutputTokens?: number;
}

export class GoogleGenAIProvider implements LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  private readonly client: GoogleGenAI;
  private readonly temperature?: number;
  private readonly maxOutputTokens?: number;

  constructor(options: GoogleGenAIProviderOptions) {
    this.client = new GoogleGenAI({
      apiKey: options.apiKey,
    });
    this.id = options.providerId ?? 'google';
    this.model = options.model;
    this.temperature = options.temperature;
    this.maxOutputTokens = options.maxOutputTokens;
  }

  async generate(messages: ConversationMessage[], tools: ProviderToolDefinition[]): Promise<ProviderResponse> {
    const { contents, systemInstruction } = mapConversation(messages);
    const config: GenerateContentConfig = {};

    if (systemInstruction) {
      config.systemInstruction = systemInstruction;
    }
    if (typeof this.temperature === 'number') {
      config.temperature = this.temperature;
    }
    if (typeof this.maxOutputTokens === 'number') {
      config.maxOutputTokens = this.maxOutputTokens;
    }

    const mappedTools = mapTools(tools);
    if (mappedTools.length > 0) {
      config.tools = mappedTools;
    }

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: contents.length ? contents : createEmptyUserContent(),
      config: Object.keys(config).length ? config : undefined,
    });

    const usage = mapUsage(response.usageMetadata);
    const toolCalls = mapFunctionCalls(response.functionCalls ?? []);
    const content = response.text?.trim() ?? '';

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

function mapConversation(messages: ConversationMessage[]): { contents: Content[]; systemInstruction?: string } {
  const contents: Content[] = [];
  const systemPrompts: string[] = [];

  for (const message of messages) {
    switch (message.role) {
      case 'system': {
        if (message.content.trim()) {
          systemPrompts.push(message.content.trim());
        }
        break;
      }
      case 'user': {
        contents.push({
          role: 'user',
          parts: [{ text: message.content }],
        });
        break;
      }
      case 'assistant': {
        contents.push(mapAssistantMessage(message));
        break;
      }
      case 'tool': {
        const content = mapToolMessage(message);
        if (content) {
          contents.push(content);
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    contents,
    systemInstruction: systemPrompts.length ? systemPrompts.join('\n\n') : undefined,
  };
}

function mapAssistantMessage(message: AssistantMessage): Content {
  const parts: NonNullable<Content['parts']> = [];
  const text = message.content.trim();
  if (text) {
    parts.push({ text });
  }

  for (const call of message.toolCalls ?? []) {
    parts.push({
      functionCall: {
        id: call.id || undefined,
        name: call.name,
        args: toRecord(call.arguments),
      },
    });
  }

  return {
    role: 'model',
    parts: parts.length ? parts : [{ text: '' }],
  };
}

function mapToolMessage(message: ToolMessage): Content | null {
  if (!message.toolCallId) {
    return null;
  }

  return {
    role: 'user',
    parts: [
      {
        functionResponse: {
          id: message.toolCallId,
          name: message.name,
          response: parseToolResponse(message.content),
        },
      },
    ],
  };
}

function parseToolResponse(content: string): Record<string, unknown> {
  const trimmed = content.trim();
  if (!trimmed) {
    return { output: '' };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
  }

  return { output: content };
}

function mapFunctionCalls(calls: FunctionCall[]): ToolCallRequest[] {
  return calls
    .filter((call) => Boolean(call.name))
    .map((call) => ({
      id: call.id || call.name || 'function_call',
      name: call.name ?? 'function_call',
      arguments: toRecord(call.args),
    }));
}

function createEmptyUserContent(): Content[] {
  return [
    {
      role: 'user',
      parts: [{ text: '' }],
    },
  ];
}

function mapTools(tools: ProviderToolDefinition[]): Tool[] {
  if (!tools.length) {
    return [];
  }

  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters ?? { type: 'object', properties: {} },
      })),
    },
  ];
}

function mapUsage(metadata?: GenerateContentResponseUsageMetadata | null): ProviderUsage | null {
  if (!metadata) {
    return null;
  }
  return {
    inputTokens: metadata.promptTokenCount ?? undefined,
    outputTokens: metadata.candidatesTokenCount ?? undefined,
    totalTokens: metadata.totalTokenCount ?? undefined,
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
