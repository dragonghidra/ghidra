import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodeRuntime } from '../runtime/node.js';
import type { CapabilityContext } from '../runtime/agentHost.js';
import { loadToolSettings } from '../core/preferences.js';
import { buildEnabledToolSet, evaluateToolPermissions } from '../capabilities/toolRegistry.js';
import type { ToolPlugin } from '../plugins/tools/index.js';
import type { ModelSelection } from '../runtime/agentSession.js';
import type { AssistantMessageMetadata } from '../core/agent.js';
import type { ConversationMessage } from '../core/types.js';
import { resolveTasksDir } from '../core/brand.js';

type TaskModelName = 'sonnet' | 'opus' | 'haiku';

export interface TaskInvocationOptions {
  description: string;
  prompt: string;
  subagentType: string;
  model?: TaskModelName;
  resumeId?: string;
}

interface TaskExecutionResult {
  output: string;
}

interface SubAgentDefinition {
  id: string;
  label: string;
  summary: string;
  instructions: string[];
  defaultModel?: TaskModelName;
}

interface TaskSnapshot {
  id: string;
  profile: string;
  description: string;
  subagentType: string;
  history: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

const SUBAGENT_DEFINITIONS: Record<string, SubAgentDefinition> = {
  'general-purpose': {
    id: 'general-purpose',
    label: 'General Purpose',
    summary: 'complete research, editing, and implementation tasks end-to-end',
    instructions: [
      'Own the entire task autonomously. Narrate your plan, gather context with filesystem/search tools, and make changes when necessary.',
      'Always cite the evidence, commands, and files you touched. Include TODOs or risks that need human review.',
    ],
    defaultModel: 'sonnet',
  },
  explore: {
    id: 'explore',
    label: 'Explore',
    summary: 'map the codebase, answer architectural questions, and locate patterns quickly',
    instructions: [
      'Prioritize read/search/glob tools before editing. Call out every directory or file you investigated.',
      'Return a crisp summary of what you learned plus direct file references so the parent agent can follow up.',
    ],
    defaultModel: 'haiku',
  },
  plan: {
    id: 'plan',
    label: 'Plan',
    summary: 'break down complex efforts into actionable steps and identify risks or dependencies',
    instructions: [
      'Produce a numbered plan with estimates, dependency notes, and explicit testing checkpoints.',
      'If the task mentions code changes, suggest which files/modules should be edited and why before any implementation occurs.',
    ],
    defaultModel: 'sonnet',
  },
};

const MODEL_ID_LOOKUP: Record<TaskModelName, { provider: string; model: string }> = {
  sonnet: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
  opus: { provider: 'anthropic', model: 'claude-opus-4.1' },
  haiku: { provider: 'anthropic', model: 'claude-haiku-4.5' },
};

const TASK_STORE_DIR = resolveTasksDir();

export class TaskRunner {
  private readonly context: CapabilityContext;
  private readonly snapshots = new TaskSnapshotStore();

  constructor(context: CapabilityContext) {
    this.context = context;
  }

  async runTask(options: TaskInvocationOptions): Promise<TaskExecutionResult> {
    const definition = resolveSubAgentDefinition(options.subagentType);
    const { allowedPluginIds } = this.resolveToolPermissions();
    const adapterOptions = allowedPluginIds.size
      ? {
          filter: (plugin: ToolPlugin) => allowedPluginIds.has(plugin.id),
        }
      : undefined;
    const runtime = await createNodeRuntime({
      profile: this.context.profile,
      workspaceContext: this.context.workspaceContext,
      workingDir: this.context.workingDir,
      env: this.context.env,
      adapterOptions,
    });

    try {
      const session = runtime.session;
      const selection = this.buildModelSelection(session.profileConfig, options.model ?? definition.defaultModel);
      const systemPrompt = this.composeSystemPrompt(
        session.profileConfig.systemPrompt,
        definition,
        options.description
      );

      let finalMetadata: AssistantMessageMetadata | null = null;
      const agent = session.createAgent(
        {
          provider: selection.provider,
          model: selection.model,
          temperature: selection.temperature,
          maxTokens: selection.maxTokens,
          systemPrompt,
        },
        {
          onAssistantMessage: (_content, metadata) => {
            if (metadata.isFinal) {
              finalMetadata = metadata;
            }
          },
        }
      );

      const resumeSnapshot = options.resumeId ? await this.snapshots.load(options.resumeId) : null;
      if (options.resumeId && !resumeSnapshot) {
        throw new Error(`Resume id "${options.resumeId}" was not found. Call Task without resume to start a new agent.`);
      }
      if (resumeSnapshot) {
        agent.loadHistory(resumeSnapshot.history);
      }

      const startedAt = Date.now();
      const reply = await agent.send(options.prompt, false);
      const durationMs = Date.now() - startedAt;
      const history = agent.getHistory();
      const resumeId = options.resumeId ?? this.snapshots.createId();

      await this.snapshots.save({
        id: resumeId,
        profile: this.context.profile,
        description: options.description,
        subagentType: definition.id,
        history,
        createdAt: resumeSnapshot?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const parsed = extractResponseSections(reply);
      const usageLine = formatUsage(extractUsage(finalMetadata));
      const durationLine = `Duration: ${formatDuration(durationMs)}${usageLine ? ` | ${usageLine}` : ''}`;

      const lines = [
        `Task "${options.description}" completed by ${definition.label} agent (${selection.model})`,
        `${durationLine} | Resume ID: ${resumeId}`,
      ];
      if (definition.summary) {
        lines.push(`Agent focus: ${definition.summary}`);
      }
      if (parsed.thinking) {
        lines.push('', 'Key reasoning:', parsed.thinking);
      }
      lines.push('', parsed.response || '(no response returned)');

      return { output: lines.join('\n').trim() };
    } finally {
      await runtime.host.dispose();
    }
  }

  private resolveToolPermissions(): { allowedPluginIds: Set<string> } {
    const settings = loadToolSettings();
    const selection = buildEnabledToolSet(settings);
    const summary = evaluateToolPermissions(selection);
    return {
      allowedPluginIds: summary.allowedPluginIds,
    };
  }

  private buildModelSelection(
    profile: { provider: string; model: string; temperature?: number; maxTokens?: number },
    preferred?: TaskModelName
  ): ModelSelection {
    if (preferred && MODEL_ID_LOOKUP[preferred]) {
      const mapping = MODEL_ID_LOOKUP[preferred];
      return {
        provider: mapping.provider,
        model: mapping.model,
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
      };
    }

    return {
      provider: profile.provider,
      model: profile.model,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
    };
  }

  private composeSystemPrompt(basePrompt: string, definition: SubAgentDefinition, description: string): string {
    const lines = [
      basePrompt.trim(),
      '',
      'You are an autonomous sub-agent launched via the Task tool. Operate independently and return a single comprehensive report to the parent agent.',
      `Task summary: ${description}`,
      `Agent specialization: ${definition.summary}`,
      '',
      'Execution rules:',
      ...definition.instructions.map((line, index) => `${index + 1}. ${line}`),
      '',
      'When you finish:',
      '- Provide a concise summary with actionable next steps.',
      '- Mention any remaining risks, TODOs, or follow-ups.',
      '- Include file paths, commands, or test names you touched so the operator can verify your work.',
    ];
    return lines.join('\n').trim();
  }
}

class TaskSnapshotStore {
  async load(id: string): Promise<TaskSnapshot | null> {
    try {
      const file = join(TASK_STORE_DIR, `${sanitizeId(id)}.json`);
      const content = await readFile(file, 'utf8');
      const parsed = JSON.parse(content) as TaskSnapshot;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async save(snapshot: TaskSnapshot): Promise<void> {
    await mkdir(TASK_STORE_DIR, { recursive: true });
    const normalized: TaskSnapshot = {
      ...snapshot,
      history: snapshot.history ?? [],
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    };
    const file = join(TASK_STORE_DIR, `${sanitizeId(snapshot.id)}.json`);
    await writeFile(file, JSON.stringify(normalized, null, 2), 'utf8');
  }

  createId(): string {
    return `task_${randomUUID()}`;
  }
}

function resolveSubAgentDefinition(name: string): SubAgentDefinition {
  const normalized = name ? name.trim().toLowerCase() : '';
  const candidate = normalized ? SUBAGENT_DEFINITIONS[normalized] : undefined;
  if (candidate) {
    return candidate;
  }
  const fallback = SUBAGENT_DEFINITIONS['general-purpose'];
  if (!fallback) {
    throw new Error('General-purpose subagent definition is missing.');
  }
  return fallback;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'task';
}

function extractResponseSections(content: string): { thinking: string | null; response: string } {
  if (!content) {
    return { thinking: null, response: '' };
  }
  const thinkingMatch = /<thinking>([\s\S]*?)<\/thinking>/i.exec(content);
  const responseMatch = /<response>([\s\S]*?)<\/response>/i.exec(content);
  const thinking = thinkingMatch?.[1]?.trim() ?? null;
  if (responseMatch?.[1]) {
    return {
      thinking,
      response: responseMatch[1].trim(),
    };
  }
  if (thinkingMatch?.[0]) {
    const remaining = content.replace(thinkingMatch[0], '').trim();
    return {
      thinking,
      response: remaining,
    };
  }
  return { thinking: null, response: content.trim() };
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) {
    return 'unknown duration';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

function extractUsage(metadata: AssistantMessageMetadata | null): AssistantMessageMetadata['usage'] | null {
  return metadata?.usage ?? null;
}

function formatUsage(usage?: AssistantMessageMetadata['usage'] | null): string {
  if (!usage) {
    return '';
  }
  const parts = [];
  if (typeof usage.inputTokens === 'number') {
    parts.push(`in ${usage.inputTokens}`);
  }
  if (typeof usage.outputTokens === 'number') {
    parts.push(`out ${usage.outputTokens}`);
  }
  if (!parts.length && typeof usage.totalTokens === 'number') {
    parts.push(`total ${usage.totalTokens}`);
  }
  return parts.length ? `Tokens ${parts.join(' / ')}` : '';
}
