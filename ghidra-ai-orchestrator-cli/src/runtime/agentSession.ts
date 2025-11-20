import { resolveProfileConfig, type ProfileName, type ResolvedProfileConfig } from '../config.js';
import {
  createDefaultToolRuntime,
  type ToolExecutionContext,
  type ToolRuntime,
  type ToolRuntimeObserver,
  type ToolSuite,
} from '../core/toolRuntime.js';
import type { ProviderId, ReasoningEffortLevel, TextVerbosityLevel } from '../core/types.js';
import { createProvider, type ProviderConfig } from '../providers/providerFactory.js';
import { AgentRuntime, type AgentCallbacks } from '../core/agent.js';
import { registerDefaultProviderPlugins } from '../plugins/providers/index.js';
import {
  createDefaultContextManager,
  ContextManager,
  resolveContextManagerConfig,
} from '../core/contextManager.js';

export interface AgentSessionOptions {
  profile: ProfileName;
  workspaceContext: string | null;
  toolSuites?: ToolSuite[];
  toolObserver?: ToolRuntimeObserver;
}

export interface ModelSelection {
  provider: ProviderId;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  reasoningEffort?: ReasoningEffortLevel;
  textVerbosity?: TextVerbosityLevel;
}

interface AgentSessionState {
  readonly profile: ProfileName;
  workspaceContext: string | null;
  profileConfig: ResolvedProfileConfig;
  readonly toolContext: ToolExecutionContext;
  toolRuntime: ToolRuntime;
  readonly toolSuites: ToolSuite[];
  readonly toolObserver?: ToolRuntimeObserver;
  readonly contextManager: ContextManager;
}

export class AgentSession {
  private readonly state: AgentSessionState;

  constructor(options: AgentSessionOptions) {
    registerDefaultProviderPlugins();
    const profileConfig = resolveProfileConfig(options.profile, options.workspaceContext);
    const toolContext: ToolExecutionContext = {
      profileName: profileConfig.profile,
      provider: profileConfig.provider,
      model: profileConfig.model,
      workspaceContext: options.workspaceContext,
    };

    // Create context manager to prevent token limit leaks
    const contextManager = createDefaultContextManager(
      resolveContextManagerConfig(profileConfig.model)
    );

    const toolSuites = options.toolSuites ? [...options.toolSuites] : [];
    const toolRuntime = createDefaultToolRuntime(
      toolContext,
      toolSuites,
      {
        observer: options.toolObserver,
        contextManager, // Pass context manager for output truncation
      }
    );

    this.state = {
      profile: options.profile,
      workspaceContext: options.workspaceContext,
      profileConfig,
      toolContext,
      toolRuntime,
      toolSuites,
      toolObserver: options.toolObserver,
      contextManager,
    };
  }

  get profile(): ProfileName {
    return this.state.profile;
  }

  get profileConfig(): ResolvedProfileConfig {
    return this.state.profileConfig;
  }

  get workspaceContext(): string | null {
    return this.state.workspaceContext ?? null;
  }

  get toolRuntime(): ToolRuntime {
    return this.state.toolRuntime;
  }

  get toolContext(): ToolExecutionContext {
    return this.state.toolContext;
  }

  createAgent(selection: ModelSelection, callbacks?: AgentCallbacks): AgentRuntime {
    const provider = createProvider(asProviderConfig(selection));
    const systemPrompt = (selection.systemPrompt ?? this.state.profileConfig.systemPrompt).trim();

    return new AgentRuntime({
      provider,
      toolRuntime: this.state.toolRuntime,
      systemPrompt,
      callbacks,
      contextManager: this.state.contextManager, // Pass context manager for history pruning
    });
  }

  updateToolContext(selection: ModelSelection): void {
    this.state.toolContext.provider = selection.provider;
    this.state.toolContext.model = selection.model;
    this.state.contextManager.updateConfig(resolveContextManagerConfig(selection.model));
  }

  refreshWorkspaceContext(workspaceContext: string | null): ResolvedProfileConfig {
    const resolved = resolveProfileConfig(this.state.profile, workspaceContext);
    this.state.workspaceContext = workspaceContext;
    this.state.toolContext.workspaceContext = workspaceContext;
    this.state.profileConfig = {
      ...this.state.profileConfig,
      systemPrompt: resolved.systemPrompt,
      rulebook: resolved.rulebook,
    };
    this.state.toolRuntime = createDefaultToolRuntime(
      this.state.toolContext,
      this.state.toolSuites,
      {
        observer: this.state.toolObserver,
        contextManager: this.state.contextManager, // Preserve context manager
      }
    );
    return this.state.profileConfig;
  }

  get contextManager(): ContextManager {
    return this.state.contextManager;
  }
}

function asProviderConfig(selection: ModelSelection): ProviderConfig {
  return {
    provider: selection.provider,
    model: selection.model,
    temperature: selection.temperature,
    maxTokens: selection.maxTokens,
    reasoningEffort: selection.reasoningEffort,
    textVerbosity: selection.textVerbosity,
  };
}
