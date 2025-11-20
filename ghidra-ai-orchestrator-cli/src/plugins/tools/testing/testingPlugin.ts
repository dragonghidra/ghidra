import type { ToolPlugin, ToolPluginContext } from '../registry.js';
import { TestingCapabilityModule } from '../../../capabilities/testingCapability.js';

export function createTestingToolPlugin(): ToolPlugin {
  return {
    id: 'tool.testing.coverage',
    description: 'Test generation scaffolding plus coverage execution/reporting utilities.',
    targets: ['node'],
    create: async (context: ToolPluginContext) =>
      new TestingCapabilityModule({
        workingDir: context.workingDir,
      }),
  };
}
