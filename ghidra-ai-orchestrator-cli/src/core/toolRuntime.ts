import {
  type JSONSchemaObject,
  type ProviderId,
  type ProviderToolDefinition,
  type ToolCallRequest,
} from './types.js';
import {
  ToolArgumentValidationError,
  validateToolArguments,
} from './schemaValidator.js';
import { ContextManager } from './contextManager.js';

export interface ToolExecutionContext {
  profileName: string;
  provider: ProviderId;
  model: string;
  workspaceContext?: string | null;
}

export interface ToolRuntimeObserver {
  onToolStart?(call: ToolCallRequest): void;
  onToolResult?(call: ToolCallRequest, output: string): void;
  onToolError?(call: ToolCallRequest, error: string): void;
  onCacheHit?(call: ToolCallRequest): void;
}

interface ToolRuntimeOptions {
  observer?: ToolRuntimeObserver;
  contextManager?: ContextManager;
  enableCache?: boolean;
  cacheTTLMs?: number;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<string> | string;

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: JSONSchemaObject;
  handler: ToolHandler;
  cacheable?: boolean; // Whether results can be cached
}

export interface ToolSuite {
  id: string;
  description?: string;
  tools: ToolDefinition[];
}

interface ToolRecord {
  suiteId: string;
  definition: ToolDefinition;
}

interface CacheEntry {
  result: string;
  timestamp: number;
}

// Idempotent tools that can be safely cached
const CACHEABLE_TOOLS = new Set([
  'Read',
  'read_file',
  'Glob',
  'glob_search',
  'Grep',
  'grep_search',
  'find_definition',
  'analyze_code_quality',
  'extract_exports',
]);

export class ToolRuntime {
  private readonly registry = new Map<string, ToolRecord>();
  private readonly registrationOrder: string[] = [];
  private readonly observer: ToolRuntimeObserver | null;
  private readonly contextManager: ContextManager | null;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly enableCache: boolean;
  private readonly cacheTTLMs: number;

  constructor(baseTools: ToolDefinition[] = [], options: ToolRuntimeOptions = {}) {
    this.observer = options.observer ?? null;
    this.contextManager = options.contextManager ?? null;
    this.enableCache = options.enableCache ?? true;
    this.cacheTTLMs = options.cacheTTLMs ?? 5 * 60 * 1000; // 5 minutes default
    if (baseTools.length) {
      this.registerSuite({
        id: 'runtime.core',
        description: 'Core runtime metadata tools',
        tools: baseTools,
      });
    }
  }

  registerSuite(suite: ToolSuite): void {
    if (!suite?.id?.trim()) {
      throw new Error('Tool suite id cannot be blank.');
    }
    this.unregisterSuite(suite.id);
    for (const definition of suite.tools ?? []) {
      this.addTool(definition, suite.id);
    }
  }

  unregisterSuite(id: string): void {
    if (!id?.trim()) {
      return;
    }
    for (const [name, record] of this.registry.entries()) {
      if (record.suiteId === id) {
        this.registry.delete(name);
        this.removeFromOrder(name);
      }
    }
  }

  listProviderTools(): ProviderToolDefinition[] {
    return this.registrationOrder
      .map((name) => this.registry.get(name))
      .filter((record): record is ToolRecord => Boolean(record))
      .map(({ definition }) => {
        const tool: ProviderToolDefinition = {
          name: definition.name,
          description: definition.description,
        };
        if (definition.parameters) {
          tool.parameters = definition.parameters;
        }
        return tool;
      });
  }

  async execute(call: ToolCallRequest): Promise<string> {
    const record = this.registry.get(call.name);
    if (!record) {
      const message = `Tool "${call.name}" is not available.`;
      this.observer?.onToolError?.(call, message);
      return message;
    }

    // Check if tool is cacheable
    const isCacheable = record.definition.cacheable ?? CACHEABLE_TOOLS.has(call.name);

    // Try to get from cache
    if (this.enableCache && isCacheable) {
      const cacheKey = this.getCacheKey(call);
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.cacheTTLMs) {
        this.observer?.onCacheHit?.(call);
        this.observer?.onToolResult?.(call, cached.result);
        return cached.result;
      }
    }

    this.observer?.onToolStart?.(call);

    try {
      const args = normalizeToolArguments(call.arguments);
      validateToolArguments(record.definition.name, record.definition.parameters, args);
      const result = await record.definition.handler(args);
      let output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      // Truncate output if context manager is available
      if (this.contextManager) {
        const truncated = this.contextManager.truncateToolOutput(output, call.name);
        if (truncated.wasTruncated) {
          output = truncated.content;
          // Log truncation for debugging
          if (process.env['DEBUG_CONTEXT']) {
            console.warn(
              `[Context Manager] Truncated ${call.name} output: ${truncated.originalLength} -> ${truncated.truncatedLength} chars`
            );
          }
        }
      }

      // Cache the result if cacheable
      if (this.enableCache && isCacheable) {
        const cacheKey = this.getCacheKey(call);
        this.cache.set(cacheKey, {
          result: output,
          timestamp: Date.now(),
        });
      }

      this.observer?.onToolResult?.(call, output);
      return output;
    } catch (error) {
      let formatted: string;
      if (error instanceof ToolArgumentValidationError) {
        formatted = error.message;
      } else {
        const message = error instanceof Error ? error.message : String(error);
        formatted = `Failed to run "${call.name}": ${message}`;
      }
      this.observer?.onToolError?.(call, formatted);
      return formatted;
    }
  }

  private getCacheKey(call: ToolCallRequest): string {
    return `${call.name}:${JSON.stringify(call.arguments)}`;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats(): { size: number; entries: number } {
    let totalSize = 0;
    for (const entry of this.cache.values()) {
      totalSize += entry.result.length;
    }
    return {
      size: totalSize,
      entries: this.cache.size,
    };
  }

  private addTool(definition: ToolDefinition, suiteId: string): void {
    if (!definition?.name?.trim()) {
      throw new Error(`Tool names cannot be blank (suite "${suiteId}").`);
    }
    if (this.registry.has(definition.name)) {
      const owner = this.registry.get(definition.name)?.suiteId ?? 'unknown';
      throw new Error(`Tool "${definition.name}" already registered by suite "${owner}".`);
    }
    this.registry.set(definition.name, {
      suiteId,
      definition,
    });
    this.registrationOrder.push(definition.name);
  }

  private removeFromOrder(name: string): void {
    const index = this.registrationOrder.indexOf(name);
    if (index >= 0) {
      this.registrationOrder.splice(index, 1);
    }
  }
}

export function createDefaultToolRuntime(
  context: ToolExecutionContext,
  toolSuites: ToolSuite[] = [],
  options: ToolRuntimeOptions = {}
): ToolRuntime {
  const runtime = new ToolRuntime(
    [
      buildContextSnapshotTool(context.workspaceContext),
      buildCapabilitiesTool(context),
      buildProfileInspectorTool(context),
    ],
    options
  );

  for (const suite of toolSuites) {
    runtime.registerSuite(suite);
  }

  return runtime;
}

function buildContextSnapshotTool(workspaceContext?: string | null): ToolDefinition {
  return {
    name: 'context_snapshot',
    description: 'Returns the repository context that was automatically captured during startup.',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: 'Use "plain" for raw text or "markdown" for a fenced block.',
          enum: ['plain', 'markdown'],
        },
      },
    },
    handler: (args) => {
      if (!workspaceContext?.trim()) {
        return 'Workspace context is unavailable.';
      }

      const format = args['format'] === 'markdown' ? 'markdown' : 'plain';
      if (format === 'markdown') {
        return ['```text', workspaceContext.trim(), '```'].join('\n');
      }
      return workspaceContext.trim();
    },
  };
}

function buildCapabilitiesTool(context: ToolExecutionContext): ToolDefinition {
  return {
    name: 'capabilities_overview',
    description:
      'Summarizes the agent runtime capabilities including available tools and features.',
    parameters: {
      type: 'object',
      properties: {
        audience: {
          type: 'string',
          enum: ['developer', 'model'],
          description: 'Tailors the tone of the description.',
        },
      },
    },
    handler: (args) => {
      const audience = args['audience'];
      const adjective = audience === 'developer' ? 'Operator facing' : 'Model facing';
      return [
        `${adjective} capabilities summary:`,
        '- Full file system access (read, write, list, search).',
        '- Bash command execution for running scripts and tools.',
        '- Advanced code search and pattern matching.',
        '- Deterministic workspace context snapshot appended to the system prompt.',
        '- Tool invocations are logged in realtime for transparency.',
        `- Active provider: ${context.provider} (${context.model}).`,
      ].join('\n');
    },
  };
}

function buildProfileInspectorTool(context: ToolExecutionContext): ToolDefinition {
  return {
    name: 'profile_details',
    description: 'Returns the configuration of the active CLI profile.',
    parameters: {
      type: 'object',
      properties: {
        includeWorkspaceContext: {
          type: 'boolean',
          description: 'Set true to append the workspace context snapshot if available.',
        },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const payload = {
        profile: context.profileName,
        provider: context.provider,
        model: context.model,
        workspaceContext: args['includeWorkspaceContext'] ? context.workspaceContext ?? null : null,
      };
      return JSON.stringify(payload, null, 2);
    },
  };
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
