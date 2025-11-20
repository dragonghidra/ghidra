import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createInteractionTools } from '../tools/interactionTools.js';

export interface InteractionCapabilityOptions {
  id?: string;
  description?: string;
}

export class InteractionCapabilityModule implements CapabilityModule {
  readonly id = 'capability.interaction';
  private readonly options: InteractionCapabilityOptions;

  constructor(options: InteractionCapabilityOptions = {}) {
    this.options = options;
  }

  async create(_context: CapabilityContext): Promise<CapabilityContribution> {
    return {
      id: this.options.id ?? 'interaction.tools.questions',
      description:
        this.options.description ??
        'Interactive user question and clarification tools for gathering preferences and decisions.',
      toolSuite: {
        id: 'interaction',
        description: 'User interaction and question tools',
        tools: createInteractionTools(),
      },
      metadata: {},
    };
  }
}
