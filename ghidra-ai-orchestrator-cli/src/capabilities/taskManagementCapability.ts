import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createTaskManagementTools } from '../tools/taskManagementTools.js';

export interface TaskManagementCapabilityOptions {
  id?: string;
  description?: string;
}

export class TaskManagementCapabilityModule implements CapabilityModule {
  readonly id = 'capability.task-management';
  private readonly options: TaskManagementCapabilityOptions;

  constructor(options: TaskManagementCapabilityOptions = {}) {
    this.options = options;
  }

  async create(_context: CapabilityContext): Promise<CapabilityContribution> {
    return {
      id: this.options.id ?? 'task-management.tools.todos',
      description:
        this.options.description ??
        'Task tracking and planning tools for organizing complex multi-step work.',
      toolSuite: {
        id: 'task-management',
        description: 'Task tracking and todo management',
        tools: createTaskManagementTools(),
      },
      metadata: {},
    };
  }
}
