import type { ToolPlugin, ToolPluginContext } from '../registry.js';
import { CodeQualityCapabilityModule } from '../../../capabilities/codeQualityCapability.js';

export function createCodeQualityToolPlugin(): ToolPlugin {
  return {
    id: 'tool.code-quality.linting',
    description: 'Code quality helpers (lint orchestration, rule inspection, maintainability checks).',
    targets: ['node'],
    create: async (context: ToolPluginContext) => {
      return new CodeQualityCapabilityModule({
        workingDir: context.workingDir,
      });
    },
  };
}
