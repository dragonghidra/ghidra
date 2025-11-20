import type { ToolPlugin } from '../registry.js';
import { PlanningCapabilityModule } from '../../../capabilities/planningCapability.js';

/**
 * Planning Tool Plugin
 *
 * Registers workflow planning capabilities.
 * Available in node and cloud runtimes.
 */
export function createPlanningToolPlugin(): ToolPlugin {
  return {
    id: 'tool.planning',
    targets: ['node', 'cloud'],
    create: () => new PlanningCapabilityModule(),
  };
}
