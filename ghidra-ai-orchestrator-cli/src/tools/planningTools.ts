import type { ToolDefinition } from '../core/toolRuntime.js';

/**
 * Creates planning workflow tools
 *
 * Tools:
 * - ExitPlanMode: Signal completion of planning phase
 *
 * These tools help structure agent workflows with explicit planning phases.
 */
export function createPlanningTools(): ToolDefinition[] {
  return [
    {
      name: 'ExitPlanMode',
      description: 'Use this tool when you are in plan mode and have finished presenting your plan and are ready to code. This will prompt the user to exit plan mode. IMPORTANT: Only use this tool when the task requires planning the implementation steps of a task that requires writing code. For research tasks where you are gathering information, searching files, reading files or in general trying to understand the codebase - do NOT use this tool.',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'string',
            description: 'The plan you came up with, that you want to run by the user for approval. Supports markdown. The plan should be pretty concise.',
          },
        },
        required: ['plan'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const plan = args['plan'];

        if (typeof plan !== 'string' || !plan.trim()) {
          return 'Error: plan must be a non-empty string.';
        }

        // Format the plan output
        const formattedPlan = [
          '=' .repeat(70),
          'PLAN READY FOR APPROVAL',
          '=' .repeat(70),
          '',
          plan.trim(),
          '',
          '=' .repeat(70),
          'Ready to proceed? If you approve this plan, I will begin implementation.',
          '=' .repeat(70),
        ].join('\n');

        return formattedPlan;
      },
    },
  ];
}
