import type { ToolPlugin, ToolPluginContext } from '../registry.js';
import { GhidraCapabilityModule } from '../../../capabilities/ghidraCapability.js';

export function createGhidraToolPlugin(): ToolPlugin {
  return {
    id: 'tool.ghidra.headless',
    description: 'Headless Ghidra automation for binary analysis, vuln triage, and exploit scripting.',
    targets: ['node'],
    create: async (context: ToolPluginContext) =>
      new GhidraCapabilityModule({
        workingDir: context.workingDir,
        env: context.env,
      }),
  };
}
