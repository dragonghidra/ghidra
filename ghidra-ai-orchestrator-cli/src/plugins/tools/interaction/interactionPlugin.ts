import { InteractionCapabilityModule } from '../../../capabilities/interactionCapability.js';
import type { ToolPlugin } from '../registry.js';

export function createInteractionToolPlugin(): ToolPlugin {
  return {
    id: 'tool.interaction.local',
    description: 'Interactive question and clarification tools for gathering user preferences.',
    targets: ['node', 'cloud'],
    create: (_context) => {
      return new InteractionCapabilityModule({});
    },
  };
}
