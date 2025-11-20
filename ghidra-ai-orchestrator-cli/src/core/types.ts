export type ProviderId = string;

export type ReasoningEffortLevel = 'low' | 'medium' | 'high';
export type TextVerbosityLevel = 'low' | 'medium' | 'high';

export type ConversationRole = 'system' | 'user' | 'assistant' | 'tool';

export interface SystemMessage {
  role: 'system';
  content: string;
}

export interface UserMessage {
  role: 'user';
  content: string;
}

export interface ToolCallArguments {
  [key: string]: unknown;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: ToolCallArguments;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string;
  toolCalls?: ToolCallRequest[];
}

export interface ToolMessage {
  role: 'tool';
  name: string;
  content: string;
  toolCallId: string;
}

export type ConversationMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface JSONSchemaPropertyBase {
  description?: string;
}

export interface JSONSchemaString extends JSONSchemaPropertyBase {
  type: 'string';
  enum?: string[];
  minLength?: number;
}

export interface JSONSchemaNumber extends JSONSchemaPropertyBase {
  type: 'number';
}

export interface JSONSchemaBoolean extends JSONSchemaPropertyBase {
  type: 'boolean';
}

export interface JSONSchemaArray extends JSONSchemaPropertyBase {
  type: 'array';
  items: JSONSchemaProperty;
}

export type JSONSchemaProperty =
  | JSONSchemaString
  | JSONSchemaNumber
  | JSONSchemaBoolean
  | JSONSchemaArray
  | JSONSchemaObject;

export interface JSONSchemaObject {
  type: 'object';
  description?: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface ProviderToolDefinition {
  name: string;
  description: string;
  parameters?: JSONSchemaObject;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderResponseBase {
  usage?: ProviderUsage | null;
}

export type ProviderResponse =
  | (ProviderResponseBase & {
      type: 'message';
      content: string;
    })
  | (ProviderResponseBase & {
      type: 'tool_calls';
      toolCalls: ToolCallRequest[];
      content?: string;
    });

export interface StreamChunk {
  type: 'content' | 'tool_call' | 'usage' | 'done';
  content?: string;
  toolCall?: ToolCallRequest;
  usage?: ProviderUsage;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly model: string;
  generate(messages: ConversationMessage[], tools: ProviderToolDefinition[]): Promise<ProviderResponse>;
  generateStream?(messages: ConversationMessage[], tools: ProviderToolDefinition[]): AsyncIterableIterator<StreamChunk>;
  getCapabilities?(): ProviderCapabilities;
}

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  vision: boolean;
  functionCalling: boolean;
  maxTokens: number;
  supportedModalities: ('text' | 'image' | 'audio')[];
}
