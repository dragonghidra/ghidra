import { McpCapabilityModule } from '../../../capabilities/mcpCapability.js';
import type { ToolPlugin } from '../registry.js';

export function createMcpToolPlugin(): ToolPlugin {
  return {
    id: 'tool.mcp.bridge',
    targets: ['node'],
    create: () => new McpCapabilityModule(),
  };
}
