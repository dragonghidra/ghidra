import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createDevTools } from '../tools/devTools.js';

export interface DevCapabilityOptions {
  workingDir?: string;
  id?: string;
  description?: string;
}

export class DevCapabilityModule implements CapabilityModule {
  readonly id = 'capability.development';
  private readonly options: DevCapabilityOptions;

  constructor(options: DevCapabilityOptions = {}) {
    this.options = options;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    return {
      id: this.options.id ?? 'development.tools.workflow',
      description: this.options.description ?? 'Development workflow tools for testing, building, and dependency management.',
      toolSuite: {
        id: 'development',
        description: 'Development workflow',
        tools: createDevTools(workingDir),
      },
      metadata: {
        workingDir,
      },
    };
  }
}