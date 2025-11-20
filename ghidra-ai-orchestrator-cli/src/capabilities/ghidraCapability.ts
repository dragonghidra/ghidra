import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createGhidraTools } from '../tools/ghidraTools.js';

export interface GhidraCapabilityOptions {
  workingDir?: string;
  env?: Record<string, string | undefined>;
  id?: string;
  description?: string;
}

export class GhidraCapabilityModule implements CapabilityModule {
  readonly id = 'capability.ghidra';
  private readonly options: GhidraCapabilityOptions;

  constructor(options: GhidraCapabilityOptions = {}) {
    this.options = options;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    const env = this.options.env ?? context.env ?? process.env;

    return {
      id: this.options.id ?? 'ghidra.tools.headless',
      description:
        this.options.description ??
        'Headless Ghidra automation (import, analysis, post scripts, and export tasks).',
      toolSuite: {
        id: 'ghidra',
        description: 'Ghidra automation and vulnerability research helpers',
        tools: createGhidraTools(workingDir, env),
      },
      metadata: {
        workingDir,
        installRoot: env['GHIDRA_INSTALL_DIR'] ?? env['GHIDRA_HOME'] ?? null,
      },
    };
  }
}
