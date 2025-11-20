import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createSearchTools } from '../tools/searchTools.js';

export interface SearchCapabilityOptions {
  workingDir?: string;
  id?: string;
  description?: string;
}

export class SearchCapabilityModule implements CapabilityModule {
  readonly id = 'capability.search';
  private readonly options: SearchCapabilityOptions;

  constructor(options: SearchCapabilityOptions = {}) {
    this.options = options;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    return {
      id: this.options.id ?? 'search.tools.repo',
      description: this.options.description ?? 'Repository-aware search helpers (glob + structural grep).',
      toolSuite: {
        id: 'search',
        description: 'Code search',
        tools: createSearchTools(workingDir),
      },
      metadata: {
        workingDir,
      },
    };
  }
}
