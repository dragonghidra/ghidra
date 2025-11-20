export type Tone = 'info' | 'success' | 'warn';
export type Agent = 'user' | 'apt' | 'apt-code';

export interface DiffLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
}

export interface MessageExtension {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  label?: string;
  description?: string;
}

export interface ChatMessage {
  id: string;
  agent: Agent;
  timestamp: string;
  title: string;
  caption: string;
  status: string;
  tokens?: string;
  streaming?: boolean;
  command?: string;
  body: string[];
  diff?: DiffLine[];
  footer?: string;
  kind?: string;
  severity?: Tone;
  extensions?: MessageExtension[];
}

export interface StreamMeter {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

export interface OpsEvent {
  label: string;
  detail: string;
  meta: string;
  tone: Tone;
}

export interface Shortcut {
  keys: string;
  description: string;
}

export type AgentSource = 'mock' | 'local-cli' | 'remote-cloud' | 'mirror-file' | 'jsonl-store' | 'redis-stream' | 'temporal-workflow';

export interface SessionStatus {
  label: string;
  detail?: string;
  tone?: Tone;
}

export interface SessionSnapshot {
  sessionId: string;
  source: AgentSource;
  chatMessages: ChatMessage[];
  streamMeters: StreamMeter[];
  opsEvents: OpsEvent[];
  shortcuts: Shortcut[];
  status?: SessionStatus;
}

export interface SessionExtensionPayload extends MessageExtension {
  messageId: string;
}

export type SessionEvent =
  | { type: 'chat-message'; payload: ChatMessage }
  | { type: 'chat-replace'; payload: ChatMessage }
  | { type: 'chat-history'; payload: ChatMessage[] }
  | { type: 'stream-meters'; payload: StreamMeter[] }
  | { type: 'ops-events'; payload: OpsEvent[] }
  | { type: 'shortcuts'; payload: Shortcut[] }
  | { type: 'status'; payload: SessionStatus }
  | { type: 'session'; payload: SessionSnapshot }
  | { type: 'extension'; payload: SessionExtensionPayload };

export interface SessionCommandPayload {
  text: string;
  agent?: Agent;
  cwd?: string;
}
