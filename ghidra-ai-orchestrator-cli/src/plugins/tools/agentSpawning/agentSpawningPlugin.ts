import { AgentSpawningCapabilityModule } from '../../../capabilities/agentSpawningCapability.js';
import type { ToolPlugin } from '../registry.js';

export function createAgentSpawningToolPlugin(): ToolPlugin {
  return {
    id: 'tool.agent-spawning',
    targets: ['node', 'cloud'],
    create: () => new AgentSpawningCapabilityModule(),
  };
}
