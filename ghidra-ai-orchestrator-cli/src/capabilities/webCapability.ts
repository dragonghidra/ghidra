import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createWebTools } from '../tools/webTools.js';

export interface WebCapabilityOptions {
  id?: string;
  description?: string;
}

export class WebCapabilityModule implements CapabilityModule {
  readonly id = 'capability.web';
  private readonly options: WebCapabilityOptions;

  constructor(options: WebCapabilityOptions = {}) {
    this.options = options;
  }

  async create(_context: CapabilityContext): Promise<CapabilityContribution> {
    return {
      id: this.options.id ?? 'web.tools.fetch-search',
      description:
        this.options.description ??
        'Web content fetching and search tools for accessing online information.',
      toolSuite: {
        id: 'web',
        description: 'Web fetch and search tools',
        tools: createWebTools(),
      },
      metadata: {},
    };
  }
}
