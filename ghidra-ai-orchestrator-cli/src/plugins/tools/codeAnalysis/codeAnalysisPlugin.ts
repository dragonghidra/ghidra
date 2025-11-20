import type { ToolPlugin, ToolPluginContext } from '../registry.js';
import { CodeAnalysisCapabilityModule } from '../../../capabilities/codeAnalysisCapability.js';

export function createCodeAnalysisToolPlugin(): ToolPlugin {
  return {
    id: 'tool.code-analysis.structural',
    description: 'Advanced code structure analysis, dependency tracking, and complexity metrics.',
    targets: ['node'],
    create: async (context: ToolPluginContext) => {
      return new CodeAnalysisCapabilityModule({
        workingDir: context.workingDir,
      });
    },
  };
}
