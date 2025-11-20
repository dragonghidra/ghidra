import type { CapabilityContext } from '../runtime/agentHost.js';
import type { ToolDefinition, ToolSuite } from '../core/toolRuntime.js';
import type { McpContentBlock, McpServerConfig, McpToolCallResult, McpToolDescription } from './types.js';
import { loadMcpServers } from './config.js';
import { McpStdioClient } from './stdioClient.js';

interface LoadedServer {
  config: McpServerConfig;
  client: McpStdioClient;
  tools: McpToolDescription[];
}

export class McpToolBridge {
  private readonly context: CapabilityContext;
  private servers: LoadedServer[] = [];

  constructor(context: CapabilityContext) {
    this.context = context;
  }

  async initialize(): Promise<ToolSuite[]> {
    const configs = await loadMcpServers({
      workingDir: this.context.workingDir,
      env: this.context.env,
    });
    if (!configs.length) {
      return [];
    }

    const suites: ToolSuite[] = [];
    for (const config of configs) {
      try {
        const client = new McpStdioClient(config, this.context.workingDir);
        const tools = await client.listTools();
        if (!tools.length) {
          await client.dispose();
          continue;
        }
        this.servers.push({ config, client, tools });
        suites.push({
          id: `mcp.${config.id}`,
          description: `MCP server at ${config.description ?? config.command}`,
          tools: tools.map((tool) => this.buildToolDefinition(config.id, client, tool)),
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `Failed to load MCP server "${config.id}" (${config.source}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return suites;
  }

  async dispose(): Promise<void> {
    await Promise.allSettled(this.servers.map((entry) => entry.client.dispose()));
    this.servers = [];
  }

  private buildToolDefinition(
    serverId: string,
    client: McpStdioClient,
    tool: McpToolDescription
  ): ToolDefinition {
    const name = buildToolName(serverId, tool.name);
    const description = tool.description
      ? `[${serverId}] ${tool.description}`
      : `MCP tool "${tool.name}" from ${serverId}`;

    return {
      name,
      description,
      parameters: normalizeSchema(tool.inputSchema),
      handler: async (args: Record<string, unknown>) => {
        const response = await client.callTool(tool.name, args);
        return formatToolResponse(response);
      },
    };
  }
}

function buildToolName(serverId: string, toolName: string): string {
  const safeServer = serverId.replace(/[^a-z0-9_-]/gi, '_');
  const safeTool = toolName.replace(/[^a-z0-9_-]/gi, '_');
  return `mcp__${safeServer}__${safeTool}`;
}

function normalizeSchema(schema?: McpToolDescription['inputSchema']): McpToolDescription['inputSchema'] {
  if (schema && typeof schema === 'object') {
    return schema;
  }
  return {
    type: 'object',
    additionalProperties: true,
    properties: {},
  };
}

function formatToolResponse(result: McpToolCallResult): string {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  if (!blocks.length) {
    return 'MCP tool completed without returning content.';
  }
  return blocks.map(formatContentBlock).join('\n\n');
}

function formatContentBlock(block: McpContentBlock): string {
  switch (block.type) {
    case 'text':
      return getStringField(block, 'text') ?? '';
    case 'markdown':
      return getStringField(block, 'markdown') ?? '';
    case 'json': {
      const jsonValue = (block as Record<string, unknown>)['json'];
      return jsonValue !== undefined ? JSON.stringify(jsonValue, null, 2) : '';
    }
    case 'resource': {
      const uri = getStringField(block, 'uri') ?? '(unknown uri)';
      const description = getStringField(block, 'description');
      return `Resource: ${uri}${description ? `\n${description}` : ''}`;
    }
    default:
      return JSON.stringify(block, null, 2);
  }
}

function getStringField(block: McpContentBlock, key: string): string | null {
  const record = block as Record<string, unknown>;
  const value = record[key];
  return typeof value === 'string' ? value : null;
}
