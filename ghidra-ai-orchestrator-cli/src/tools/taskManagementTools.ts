import type { ToolDefinition } from '../core/toolRuntime.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;
}

// In-memory storage for the current session's todo list
let currentTodoList: TodoItem[] = [];

export function createTaskManagementTools(): ToolDefinition[] {
  return [
    {
      name: 'TodoWrite',
      description: `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool
Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

## Task States and Management
1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

   **IMPORTANT**: Task descriptions must have two forms:
   - content: The imperative form describing what needs to be done (e.g., "Run tests", "Build the project")
   - activeForm: The present continuous form shown during execution (e.g., "Running tests", "Building the project")

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Exactly ONE task must be in_progress at any time (not less, not more)
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names
   - Always provide both forms:
     - content: "Fix authentication bug"
     - activeForm: "Fixing authentication bug"`,
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
                  description: 'The imperative form of the task (e.g., "Run tests")',
                },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'completed'],
                  description: 'Current status of the task',
                },
                activeForm: {
                  type: 'string',
                  minLength: 1,
                  description: 'The present continuous form (e.g., "Running tests")',
                },
              },
              required: ['content', 'status', 'activeForm'],
              additionalProperties: false,
            },
          },
        },
        required: ['todos'],
      },
      handler: async (args: Record<string, unknown>) => {
        const todos = args['todos'] as TodoItem[];
        if (!todos || !Array.isArray(todos)) {
          return 'Error: todos parameter is required and must be an array.';
        }

        // Validate that exactly one task is in_progress (if there are any non-completed tasks)
        const inProgressTasks = todos.filter(t => t.status === 'in_progress');
        const nonCompletedTasks = todos.filter(t => t.status !== 'completed');

        if (nonCompletedTasks.length > 0 && inProgressTasks.length !== 1) {
          return `Error: Exactly ONE task must be in_progress at any time. Currently ${inProgressTasks.length} tasks are in_progress.`;
        }

        // Validate required fields
        for (const todo of todos) {
          if (!todo.content || !todo.activeForm) {
            return 'Error: Each todo must have both "content" and "activeForm" fields.';
          }
        }

        // Update the todo list
        currentTodoList = todos;

        // Format output
        let output = '📋 Task List Updated:\n\n';

        for (let i = 0; i < todos.length; i++) {
          const todo = todos[i];
          if (!todo) continue;

          let statusIcon: string;
          let statusLabel: string;

          switch (todo.status) {
            case 'completed':
              statusIcon = '✓';
              statusLabel = 'Completed';
              break;
            case 'in_progress':
              statusIcon = '▶';
              statusLabel = 'In Progress';
              break;
            case 'pending':
            default:
              statusIcon = '○';
              statusLabel = 'Pending';
              break;
          }

          output += `${i + 1}. [${statusIcon}] ${todo.content}\n`;
          output += `   Status: ${statusLabel}\n`;
          if (todo.status === 'in_progress') {
            output += `   Active: ${todo.activeForm}\n`;
          }
          output += '\n';
        }

        const pendingCount = todos.filter(t => t.status === 'pending').length;
        const completedCount = todos.filter(t => t.status === 'completed').length;
        const totalCount = todos.length;

        output += `\nProgress: ${completedCount}/${totalCount} tasks completed, ${pendingCount} pending\n`;

        return output;
      },
    },
  ];
}

export function getCurrentTodoList(): TodoItem[] {
  return currentTodoList;
}

export function clearTodoList(): void {
  currentTodoList = [];
}
