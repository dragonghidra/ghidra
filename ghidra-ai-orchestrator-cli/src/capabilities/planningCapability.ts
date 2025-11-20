import type { CapabilityModule, CapabilityContext, CapabilityContribution } from '../runtime/agentHost.js';
import { createPlanningTools } from '../tools/planningTools.js';

/**
 * Planning Capability Module
 *
 * Provides workflow planning and phase management tools.
 *
 * Tools:
 * - ExitPlanMode: Signal completion of planning phase
 *
 * Scope: planning:workflow
 */
export class PlanningCapabilityModule implements CapabilityModule {
  readonly id = 'capability.planning';

  async create(_context: CapabilityContext): Promise<CapabilityContribution> {
    const tools = createPlanningTools();

    return {
      id: 'planning.workflow',
      description: 'Workflow planning and phase management',
      toolSuite: {
        id: 'planning',
        tools,
      },
    };
  }
}
