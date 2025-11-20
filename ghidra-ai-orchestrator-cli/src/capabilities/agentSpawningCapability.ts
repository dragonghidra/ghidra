import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { TaskRunner, type TaskInvocationOptions } from '../subagents/taskRunner.js';

export class AgentSpawningCapabilityModule implements CapabilityModule {
  readonly id = 'capability.agent-spawning';

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const runner = new TaskRunner(context);

    return {
      id: 'agent-spawning.tools',
      description: 'Launch specialized agents to handle complex, multi-step tasks autonomously',
      toolSuite: {
        id: 'agent-spawning',
        description: 'Task agent spawning and management',
        tools: [
          {
            name: 'Task',
            description: `Launch a new agent to handle complex, multi-step tasks autonomously.

The Task tool launches specialized agents (subprocesses) that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types and the tools they have access to:
- general-purpose: General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you. (Tools: *)
- Explore: Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions. (Tools: All tools)
- Plan: Fast agent specialized for planning tasks. Use this when you need to break down complex tasks into steps, analyze requirements, or create implementation strategies. (Tools: All tools)

When using the Task tool, you must specify a subagent_type parameter to select which agent type to use.

When NOT to use the Task tool:
- If you want to read a specific file path, use the Read or Glob tool instead of the Task tool, to find the match more quickly
- If you are searching for a specific class definition like "class Foo", use the Glob tool instead, to find the match more quickly
- If you are searching for code within a specific file or set of 2-3 files, use the Read tool instead of the Task tool, to find the match more quickly
- Other tasks that are not related to the agent descriptions above

Usage notes:
- Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses
- When the agent is done, it will return a single message back to you. The result returned by the agent is not visible to the user. To show the user the result, you should send a text message back to the user with a concise summary of the result.
- Each agent invocation is stateless. You will not be able to send additional messages to the agent, nor will the agent be able to communicate with you outside of its final report. Therefore, your prompt should contain a highly detailed task description for the agent to perform autonomously and you should specify exactly what information the agent should return back to you in its final and only message to you.
- The agent's outputs should generally be trusted
- Clearly tell the agent whether you expect it to write code or just to do research (search, file reads, web fetches, etc.), since it is not aware of the user's intent
- If the agent description mentions that it should be used proactively, then you should try your best to use it without the user having to ask for it first. Use your judgement.

Example usage:
- "Find all TypeScript files in the project and identify which ones use async/await"
- "Explore the authentication system and explain how JWT tokens are validated"
- "Plan the implementation of a new user dashboard feature"`,
            parameters: {
              type: 'object',
              properties: {
                description: {
                  type: 'string',
                  description: 'A short (3-5 word) description of the task',
                },
                prompt: {
                  type: 'string',
                  description: 'The task for the agent to perform',
                },
                subagent_type: {
                  type: 'string',
                  description: 'The type of specialized agent to use for this task',
                },
                model: {
                  type: 'string',
                  enum: ['sonnet', 'opus', 'haiku'],
                  description: 'Optional model to use for this agent. If not specified, inherits from parent. Prefer haiku for quick, straightforward tasks to minimize cost and latency.',
                },
                resume: {
                  type: 'string',
                  description: 'Optional agent ID to resume from. If provided, the agent will continue from the previous execution transcript.',
                },
              },
              required: ['description', 'prompt', 'subagent_type'],
            },
            handler: async (args: Record<string, unknown>) => {
              try {
                const input = parseTaskArguments(args);
                const result = await runner.runTask(input);
                return result.output;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return `Task tool failed: ${message}`;
              }
            },
          },
        ],
      },
    };
  }
}

function parseTaskArguments(args: Record<string, unknown>): TaskInvocationOptions {
  const description = expectString(args['description'], 'description');
  const prompt = expectString(args['prompt'], 'prompt');
  const subagentType = expectString(args['subagent_type'], 'subagent_type');

  const modelValue = typeof args['model'] === 'string' ? args['model'].trim().toLowerCase() : undefined;
  let model: TaskInvocationOptions['model'];
  if (modelValue) {
    if (modelValue !== 'sonnet' && modelValue !== 'opus' && modelValue !== 'haiku') {
      throw new Error(`Invalid model "${args['model']}". Allowed values are sonnet, opus, or haiku.`);
    }
    model = modelValue;
  }

  const resumeId = typeof args['resume'] === 'string' ? args['resume'].trim() : undefined;

  return {
    description,
    prompt,
    subagentType,
    model,
    resumeId: resumeId && resumeId.length ? resumeId : undefined,
  };
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Task tool is missing a valid "${field}" parameter.`);
  }
  return value.trim();
}
