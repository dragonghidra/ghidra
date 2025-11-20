import type { ToolPlugin, ToolPluginContext } from '../registry.js';
import { DevCapabilityModule } from '../../../capabilities/devCapability.js';

export function createDevToolPlugin(): ToolPlugin {
  return {
    id: 'tool.development.workflow',
    description: 'Development workflow tools for testing, building, and dependency management.',
    targets: ['node'],
    create: async (context: ToolPluginContext) => {
      return new DevCapabilityModule({
        workingDir: context.workingDir,
      });
    },
  };
}
