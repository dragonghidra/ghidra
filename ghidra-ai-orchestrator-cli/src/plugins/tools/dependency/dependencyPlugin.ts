import type { ToolPlugin, ToolPluginContext } from '../registry.js';
import { DependencySecurityCapabilityModule } from '../../../capabilities/dependencySecurityCapability.js';

export function createDependencyToolPlugin(): ToolPlugin {
  return {
    id: 'tool.dependency.security',
    description: 'Dependency analysis, lockfile insights, and npm audit orchestration.',
    targets: ['node'],
    create: async (context: ToolPluginContext) =>
      new DependencySecurityCapabilityModule({
        workingDir: context.workingDir,
      }),
  };
}
