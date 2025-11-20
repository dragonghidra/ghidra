import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { McpToolBridge } from '../mcp/toolBridge.js';

export class McpCapabilityModule implements CapabilityModule {
  readonly id = 'capability.mcp';

  async create(context: CapabilityContext): Promise<CapabilityContribution | null> {
    const bridge = new McpToolBridge(context);
    const suites = await bridge.initialize();
    if (!suites.length) {
      await bridge.dispose();
      return null;
    }

    return {
      id: 'mcp.tools',
      description: 'Model Context Protocol connectors declared via .mcp.json files.',
      toolSuites: suites,
      dispose: () => bridge.dispose(),
    };
  }
}
