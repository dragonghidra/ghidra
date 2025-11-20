import type { CapabilityModule, CapabilityContribution, CapabilityContext } from '../runtime/agentHost.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

export interface TodoState {
  items: TodoItem[];
  lastUpdate: number;
}

let globalTodoState: TodoState = {
  items: [],
  lastUpdate: Date.now(),
};

export class TodoCapability implements CapabilityModule {
  id = 'capability.todo';
  description = 'Task and todo list management for tracking multi-step work';

  async create(_context: CapabilityContext): Promise<CapabilityContribution> {
    return {
      id: 'todo.tools',
      description: 'Todo list management tools for tracking tasks',
      toolSuite: {
        id: 'todo',
        tools: [
          {
            name: 'todo_write',
            description: `Create and manage a structured task list for your current coding session. This helps track progress, organize complex tasks, and demonstrate thoroughness.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps
2. Non-trivial and complex tasks - Tasks that require careful planning
3. User explicitly requests todo list
4. User provides multiple tasks (numbered or comma-separated)
5. After receiving new instructions - Capture requirements as todos
6. When starting work on a task - Mark it as in_progress BEFORE beginning work
7. After completing a task - Mark completed and add follow-up tasks

## When NOT to Use
Skip when:
1. Single, straightforward task
2. Trivial task (less than 3 simple steps)
3. Purely conversational/informational task

## Task States
- pending: Task not yet started
- in_progress: Currently working on (limit to ONE at a time)
- completed: Task finished successfully

## Task Requirements
- content: Imperative form (e.g., "Run tests", "Build project")
- activeForm: Present continuous form (e.g., "Running tests", "Building project")

## Task Management
- Update status in real-time as you work
- Mark tasks complete IMMEDIATELY after finishing
- Exactly ONE task must be in_progress at any time
- Complete current tasks before starting new ones
- Remove irrelevant tasks entirely

## Task Completion Requirements
ONLY mark completed when FULLY accomplished:
- Never mark completed if tests failing, implementation partial, or errors unresolved
- When blocked, create new task describing what needs resolution
- Keep as in_progress if encountering errors or blockers`,
            parameters: {
              type: 'object',
              properties: {
                todos: {
                  type: 'array',
                  description: 'The updated todo list',
                  items: {
                    type: 'object',
                    properties: {
                      content: {
                        type: 'string',
                        minLength: 1,
                        description: 'The task description in imperative form',
                      },
                      status: {
                        type: 'string',
                        enum: ['pending', 'in_progress', 'completed'],
                        description: 'Current status of the task',
                      },
                      activeForm: {
                        type: 'string',
                        minLength: 1,
                        description: 'The task description in present continuous form',
                      },
                    },
                    required: ['content', 'status', 'activeForm'],
                  },
                },
              },
              required: ['todos'],
            },
            handler: async (args) => {
              const { todos } = args as { todos: TodoItem[] };

              if (!Array.isArray(todos)) {
                return 'Error: todos must be an array';
              }

              // Validate todos
              for (const todo of todos) {
                if (!todo.content || !todo.status || !todo.activeForm) {
                  return 'Error: Each todo must have content, status, and activeForm';
                }
                if (!['pending', 'in_progress', 'completed'].includes(todo.status)) {
                  return 'Error: Invalid status. Must be pending, in_progress, or completed';
                }
              }

              // Check for exactly one in_progress task
              const inProgressCount = todos.filter((t) => t.status === 'in_progress').length;
              if (inProgressCount > 1) {
                return 'Warning: Multiple tasks marked as in_progress. Only one task should be actively worked on at a time.';
              }

              globalTodoState = {
                items: todos,
                lastUpdate: Date.now(),
              };

              return this.formatTodoList(todos);
            },
          },
          {
            name: 'todo_read',
            description: 'Read the current todo list to check progress',
            parameters: {
              type: 'object',
              properties: {},
            },
            handler: async () => {
              if (!globalTodoState.items.length) {
                return 'No active todo list';
              }

              return this.formatTodoList(globalTodoState.items);
            },
          },
        ],
      },
    };
  }

  private formatTodoList(todos: TodoItem[]): string {
    if (!todos.length) {
      return 'Todo list is empty';
    }

    const lines: string[] = ['Todo List:'];
    const pending = todos.filter((t) => t.status === 'pending');
    const inProgress = todos.filter((t) => t.status === 'in_progress');
    const completed = todos.filter((t) => t.status === 'completed');

    if (inProgress.length > 0) {
      lines.push('\n🔵 In Progress:');
      for (const todo of inProgress) {
        lines.push(`  • ${todo.activeForm}`);
      }
    }

    if (pending.length > 0) {
      lines.push('\n⚪ Pending:');
      for (const todo of pending) {
        lines.push(`  • ${todo.content}`);
      }
    }

    if (completed.length > 0) {
      lines.push('\n✅ Completed:');
      for (const todo of completed) {
        lines.push(`  • ${todo.content}`);
      }
    }

    const total = todos.length;
    const completedCount = completed.length;
    const progress = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    lines.push(`\nProgress: ${completedCount}/${total} (${progress}%)`);

    return lines.join('\n');
  }
}

export const getTodoState = (): TodoState => globalTodoState;
export const clearTodoState = (): void => {
  globalTodoState = { items: [], lastUpdate: Date.now() };
};
