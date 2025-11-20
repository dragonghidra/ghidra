import type { ToolPlugin, ToolPluginContext } from '../registry.js';
import { RefactoringCapabilityModule } from '../../../capabilities/refactoringCapability.js';

export function createRefactoringToolPlugin(): ToolPlugin {
  return {
    id: 'tool.refactoring.assistant',
    description: 'Refactoring intelligence (hotspot detection, impact studies, plan generation).',
    targets: ['node'],
    create: async (context: ToolPluginContext) =>
      new RefactoringCapabilityModule({
        workingDir: context.workingDir,
      }),
  };
}
