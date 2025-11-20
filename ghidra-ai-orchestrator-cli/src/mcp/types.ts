import type { JSONSchemaObject } from '../core/types.js';

export type McpTransportType = 'stdio';

export interface RawMcpServerDefinition {
  id?: string;
  type?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  description?: string;
  disabled?: boolean;
}

export interface McpServerConfig {
  id: string;
  type: McpTransportType;
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  description?: string;
  source: string;
}

export interface McpToolDescription {
  name: string;
  description?: string;
  inputSchema?: JSONSchemaObject;
}

export type McpContentBlock =
  | { type: 'text'; text: string }
  | { type: 'markdown'; markdown: string }
  | { type: 'json'; json: unknown }
  | { type: 'resource'; uri: string; mimeType?: string; description?: string }
  | { type: string; [key: string]: unknown };

export interface McpToolCallResult {
  content?: McpContentBlock[];
  isError?: boolean;
}
