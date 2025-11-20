import type { ProfileName } from '../config.js';
import type { AgentSession, ModelSelection } from './agentSession.js';
import type { UniversalRuntime } from './universal.js';
import { createNodeRuntime, type NodeRuntimeOptions } from './node.js';
import type { CapabilityModule } from './agentHost.js';
import type { AgentCallbacks, AssistantMessageMetadata } from '../core/agent.js';
import type { ToolRuntimeObserver, ToolSuite } from '../core/toolRuntime.js';
import type { ConversationMessage, ProviderUsage } from '../core/types.js';
import type {
  AgentEventUnion,
  CapabilityManifest,
  IAgentController,
  ModelConfig,
  ToolCapability,
} from '../contracts/v1/agent.js';
import { AGENT_CONTRACT_VERSION } from '../contracts/v1/agent.js';

interface EventSinkRef {
  current: EventStream<AgentEventUnion> | null;
}

class EventStream<T> implements AsyncIterableIterator<T> {
  private readonly queue: T[] = [];
  private pending: { resolve: (value: IteratorResult<T>) => void; reject: (error: unknown) => void } | null = null;
  private closed = false;
  private failure: Error | null = null;

  push(value: T): void {
    if (this.closed || this.failure) {
      return;
    }
    if (this.pending) {
      this.pending.resolve({ value, done: false });
      this.pending = null;
      return;
    }
    this.queue.push(value);
  }

  close(): void {
    if (this.closed || this.failure) {
      return;
    }
    this.closed = true;
    if (this.pending) {
      this.pending.resolve({ value: undefined as unknown as T, done: true });
      this.pending = null;
    }
  }

  fail(error: Error): void {
    if (this.closed || this.failure) {
      return;
    }
    this.failure = error;
    if (this.pending) {
      this.pending.reject(error);
      this.pending = null;
    }
  }

  next(): Promise<IteratorResult<T>> {
    if (this.queue.length) {
      const value = this.queue.shift()!;
      return Promise.resolve({ value, done: false });
    }
    if (this.failure) {
      const error = this.failure;
      this.failure = null;
      return Promise.reject(error);
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined as unknown as T, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  return(): Promise<IteratorResult<T>> {
    this.close();
    return Promise.resolve({ value: undefined as unknown as T, done: true });
  }

  throw(error: unknown): Promise<IteratorResult<T>> {
    const err = error instanceof Error ? error : new Error(String(error));
    this.fail(err);
    return Promise.reject(err);
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this;
  }
}

function mergeToolObservers(
  primary: ToolRuntimeObserver,
  secondary?: ToolRuntimeObserver
): ToolRuntimeObserver {
  if (!secondary) {
    return primary;
  }
  return {
    onToolStart(call) {
      primary.onToolStart?.(call);
      secondary.onToolStart?.(call);
    },
    onToolResult(call, output) {
      primary.onToolResult?.(call, output);
      secondary.onToolResult?.(call, output);
    },
    onToolError(call, error) {
      primary.onToolError?.(call, error);
      secondary.onToolError?.(call, error);
    },
    onCacheHit(call) {
      primary.onCacheHit?.(call);
      secondary.onCacheHit?.(call);
    },
  } satisfies ToolRuntimeObserver;
}

function createControllerToolObserver(ref: EventSinkRef): ToolRuntimeObserver {
  const emit = (event: AgentEventUnion) => {
    ref.current?.push(event);
  };
  const timestamp = () => Date.now();
  return {
    onToolStart(call) {
      emit({
        type: 'tool.start',
        timestamp: timestamp(),
        toolName: call.name,
        toolCallId: call.id,
        parameters: { ...call.arguments },
      });
    },
    onToolResult(call, output) {
      emit({
        type: 'tool.complete',
        timestamp: timestamp(),
        toolName: call.name,
        toolCallId: call.id,
        result: output,
      });
    },
    onToolError(call, error) {
      emit({
        type: 'tool.error',
        timestamp: timestamp(),
        toolName: call.name,
        toolCallId: call.id,
        error,
      });
    },
  } satisfies ToolRuntimeObserver;
}

interface AgentControllerDependencies {
  runtime: UniversalRuntime;
  sinkRef: EventSinkRef;
}

export interface AgentControllerCreateOptions extends Omit<NodeRuntimeOptions, 'toolObserver'> {
  profile: ProfileName;
  workspaceContext: string | null;
  workingDir: string;
  modules?: CapabilityModule[];
}

export async function createAgentController(
  options: AgentControllerCreateOptions,
  additionalObserver?: ToolRuntimeObserver
): Promise<AgentController> {
  const sinkRef: EventSinkRef = { current: null };
  const observer = createControllerToolObserver(sinkRef);
  const runtime = await createNodeRuntime({
    profile: options.profile,
    workspaceContext: options.workspaceContext,
    workingDir: options.workingDir,
    env: options.env,
    toolObserver: mergeToolObservers(observer, additionalObserver),
    additionalModules: options.modules,
    adapterOptions: options.adapterOptions,
  });
  return new AgentController({ runtime, sinkRef });
}

export class AgentController implements IAgentController {
  private readonly session: AgentSession;
  private readonly sinkRef: EventSinkRef;
  private activeSink: EventStream<AgentEventUnion> | null = null;
  private agent: ReturnType<AgentSession['createAgent']> | null = null;
  private cachedHistory: ConversationMessage[] = [];
  private selection: ModelSelection;

  constructor(dependencies: AgentControllerDependencies) {
    this.session = dependencies.runtime.session;
    this.sinkRef = dependencies.sinkRef;
    this.selection = this.buildInitialSelection();
  }

  private buildInitialSelection(): ModelSelection {
    const config = this.session.profileConfig;
    return {
      provider: config.provider,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPrompt: config.systemPrompt,
    } satisfies ModelSelection;
  }

  private ensureAgent(): ReturnType<AgentSession['createAgent']> {
    if (this.agent) {
      return this.agent;
    }
    const agent = this.session.createAgent(this.selection, this.createAgentCallbacks());
    if (this.cachedHistory.length) {
      agent.loadHistory(this.cachedHistory);
    }
    this.agent = agent;
    return agent;
  }

  private createAgentCallbacks(): AgentCallbacks {
    return {
      onAssistantMessage: (content, metadata) => this.handleAssistantMessage(content, metadata),
      onStreamChunk: (chunk) => this.emitDelta(chunk, false),
    } satisfies AgentCallbacks;
  }

  private emitDelta(content: string, isFinal: boolean): void {
    if (!content?.trim()) {
      return;
    }
    this.activeSink?.push({
      type: 'message.delta',
      timestamp: Date.now(),
      content,
      isFinal,
    });
  }

  private emitError(message: string): void {
    this.activeSink?.push({
      type: 'error',
      timestamp: Date.now(),
      error: message,
    });
  }

  private emitUsage(usage: ProviderUsage | null | undefined): void {
    if (!usage) {
      return;
    }
    this.activeSink?.push({
      type: 'usage',
      timestamp: Date.now(),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    });
  }

  private handleAssistantMessage(content: string, metadata: AssistantMessageMetadata): void {
    if (!this.activeSink) {
      return;
    }
    if (!metadata.isFinal) {
      this.emitDelta(content, false);
      return;
    }
    const elapsedMs = metadata.elapsedMs ?? 0;
    this.activeSink.push({
      type: 'message.complete',
      timestamp: Date.now(),
      content,
      elapsedMs,
    });
    this.emitUsage(metadata.usage ?? null);
  }

  private updateCachedHistory(): void {
    if (this.agent) {
      this.cachedHistory = this.agent.getHistory();
    }
  }

  async *send(message: string): AsyncIterableIterator<AgentEventUnion> {
    if (this.activeSink) {
      throw new Error('Agent runtime is already processing a message. Please wait for the current run to finish.');
    }
    const agent = this.ensureAgent();
    const sink = new EventStream<AgentEventUnion>();
    this.activeSink = sink;
    this.sinkRef.current = sink;
    sink.push({ type: 'message.start', timestamp: Date.now() });

    const run = agent
      .send(message, true)
      .then(() => {
        this.updateCachedHistory();
        sink.close();
      })
      .catch((error) => {
        const messageText = error instanceof Error ? error.message : String(error);
        this.emitError(messageText);
        sink.fail(error instanceof Error ? error : new Error(messageText));
      })
      .finally(() => {
        if (this.activeSink === sink) {
          this.activeSink = null;
          this.sinkRef.current = null;
        }
      });

    try {
      for await (const event of sink) {
        yield event;
      }
    } finally {
      await run;
    }
  }

  async switchModel(config: ModelConfig): Promise<void> {
    this.updateCachedHistory();
    this.agent = null;
    this.selection = {
      provider: config.provider,
      model: config.model,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      systemPrompt: this.selection.systemPrompt,
    } satisfies ModelSelection;
    this.session.updateToolContext(this.selection);
  }

  getCapabilities(): CapabilityManifest {
    const tools = this.session.toolRuntime.listProviderTools();
    const manifestTools: ToolCapability[] = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: 'general',
    }));
    return {
      contractVersion: AGENT_CONTRACT_VERSION,
      profile: this.session.profile,
      model: this.toModelConfig(this.selection),
      tools: manifestTools,
      features: ['streaming', 'tool-calls'],
    } satisfies CapabilityManifest;
  }

  registerToolSuite(suiteId: string, suite: ToolSuite): void {
    this.session.toolRuntime.registerSuite({ ...suite, id: suiteId });
  }

  unregisterToolSuite(suiteId: string): void {
    this.session.toolRuntime.unregisterSuite(suiteId);
  }

  getHistory(): ConversationMessage[] {
    if (this.agent) {
      return this.agent.getHistory();
    }
    return [...this.cachedHistory];
  }

  clearHistory(): void {
    this.cachedHistory = [];
    this.agent?.clearHistory();
  }

  private toModelConfig(selection: ModelSelection): ModelConfig {
    return {
      provider: selection.provider,
      model: selection.model,
      temperature: selection.temperature,
      maxTokens: selection.maxTokens,
    } satisfies ModelConfig;
  }
}
