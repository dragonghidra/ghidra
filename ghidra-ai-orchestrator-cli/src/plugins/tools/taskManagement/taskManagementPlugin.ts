import { TaskManagementCapabilityModule } from '../../../capabilities/taskManagementCapability.js';
import type { ToolPlugin } from '../registry.js';

export function createTaskManagementToolPlugin(): ToolPlugin {
  return {
    id: 'tool.task-management.local',
    description: 'Task tracking and planning tools for organizing complex multi-step work.',
    targets: ['node', 'cloud'],
    create: (_context) => {
      return new TaskManagementCapabilityModule({});
    },
  };
}
