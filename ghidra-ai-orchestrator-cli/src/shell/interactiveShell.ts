import readline from 'node:readline';
import { stdin as input, stdout as output, exit } from 'node:process';
import { type AssistantMessageMetadata, type AgentRuntime } from '../core/agent.js';
import type {
  ConversationMessage,
  ProviderId,
  ProviderUsage,
  ReasoningEffortLevel,
  ToolCallRequest,
} from '../core/types.js';
import type { ProfileName } from '../config.js';
import type { AgentProfileBlueprint } from '../core/agentProfiles.js';
import { display, type DisplayMessageMetadata } from '../ui/display.js';
import { formatUserPrompt, theme } from '../ui/theme.js';
import { getContextWindowTokens } from '../core/contextWindow.js';
import {
  ensureSecretForProvider,
  getSecretDefinitionForProvider,
  getSecretValue,
  listSecretDefinitions,
  maskSecret,
  setSecretValue,
  type SecretDefinition,
} from '../core/secretStore.js';
import {
  saveActiveProfilePreference,
  saveModelPreference,
  loadToolSettings,
  saveToolSettings,
  clearToolSettings,
  clearActiveProfilePreference,
  loadSessionPreferences,
  saveSessionPreferences,
  type SessionPreferences,
  type ThinkingMode,
} from '../core/preferences.js';
import {
  buildEnabledToolSet,
  evaluateToolPermissions,
  getToolToggleOptions,
  type ToolToggleOption,
  type ToolToggleId,
  type ToolLoadWarning,
} from '../capabilities/toolRegistry.js';
import { AgentSession, type ModelSelection } from '../runtime/agentSession.js';
import { BracketedPasteManager } from './bracketedPasteManager.js';
import { PromptSkin } from './promptSkin.js';
import { detectApiKeyError, type ApiKeyErrorInfo } from '../core/errors/apiKeyErrors.js';
import { LiveStatusTracker } from './liveStatus.js';
import { buildWorkspaceContext, type WorkspaceCaptureOptions } from '../workspace.js';
import { buildInteractiveSystemPrompt } from './systemPrompt.js';
import { getModels, getSlashCommands, getProviders } from '../core/agentSchemaLoader.js';
import { ShellUIAdapter } from '../ui/ShellUIAdapter.js';
import {
  clearAutosaveSnapshot,
  deleteSession,
  listSessions,
  loadAutosaveSnapshot,
  loadSessionById,
  saveAutosaveSnapshot,
  saveSessionSnapshot,
  type SessionSummary,
} from '../core/sessionStore.js';
import {
  buildCustomCommandPrompt,
  loadCustomSlashCommands,
  type LoadedCustomCommand,
} from '../core/customCommands.js';
import { SkillRepository } from '../skills/skillRepository.js';
import { createSkillTools } from '../tools/skillTools.js';

export interface ShellConfig {
  profile: ProfileName;
  profileLabel: string;
  workingDir: string;
  session: AgentSession;
  baseSystemPrompt: string;
  initialModel: ModelSelection;
  agentSelection?: AgentSelectionConfig;
  statusTracker: LiveStatusTracker;
  uiAdapter: ShellUIAdapter;
  workspaceOptions: WorkspaceCaptureOptions;
}

interface AgentSelectionConfig {
  defaultProfile: ProfileName;
  persistedProfile: ProfileName | null;
  options: AgentProfileBlueprint[];
}

type PendingInteraction =
  | { type: 'model-provider'; options: ModelProviderOption[] }
  | { type: 'model'; provider: ProviderId; options: ModelPreset[] }
  | { type: 'secret-select'; options: SecretDefinition[] }
  | { type: 'secret-input'; secret: SecretDefinition }
  | { type: 'agent-selection'; options: AgentProfileBlueprint[] }
  | ToolSettingsInteraction;

interface ToolSettingsInteraction {
  type: 'tool-settings';
  options: ToolToggleOption[];
  selection: Set<ToolToggleId>;
  initialSelection: Set<ToolToggleId>;
}

type SessionState = {
  provider: ProviderId;
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffortLevel;
};

interface ModelPreset {
  id: string;
  label: string;
  provider: ProviderId;
  description: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffortLevel;
}

interface ModelProviderOption {
  provider: ProviderId;
  label: string;
  modelCount: number;
}

type DropdownColor = (value: string) => string;

const DROPDOWN_COLORS: DropdownColor[] = [
  theme.primary,
  theme.info,
  theme.accent,
  theme.secondary,
  theme.success,
  theme.warning,
];

interface SlashCommandDefinition {
  command: string;
  description: string;
}

type SkillToolHandler = (args: Record<string, unknown>) => Promise<string> | string;

// Load MODEL_PRESETS from centralized schema
const MODEL_PRESETS: ModelPreset[] = getModels().map((model) => ({
  id: model.id,
  label: model.label,
  provider: model.provider,
  description: model.description ?? '',
  reasoningEffort: model.reasoningEffort as ReasoningEffortLevel | undefined,
  temperature: model.temperature,
  maxTokens: model.maxTokens,
}));

// Load BASE_SLASH_COMMANDS from centralized schema
const BASE_SLASH_COMMANDS: SlashCommandDefinition[] = getSlashCommands().map((cmd) => ({
  command: cmd.command,
  description: cmd.description,
}));

// Load PROVIDER_LABELS from centralized schema
const PROVIDER_LABELS: Record<ProviderId, string> = Object.fromEntries(
  getProviders().map((provider) => [provider.id, provider.label])
) as Record<ProviderId, string>;

const MULTILINE_INPUT_FLUSH_DELAY_MS = 30;
const BRACKETED_PASTE_ENABLE = '\u001b[?2004h';
const BRACKETED_PASTE_DISABLE = '\u001b[?2004l';
const CONTEXT_USAGE_THRESHOLD = 0.9;
const CONTEXT_RECENT_MESSAGE_COUNT = 12;
const CONTEXT_CLEANUP_CHARS_PER_CHUNK = 6000;
const CONTEXT_CLEANUP_MAX_OUTPUT_TOKENS = 800;
const CONTEXT_CLEANUP_SYSTEM_PROMPT = `You condense earlier IDE collaboration logs so the agent can keep working.
- Merge any prior summary with the new conversation chunk.
- Capture key decisions, TODOs, file edits, tool observations, and open questions.
- Clearly distinguish resolved work from outstanding follow-ups.
- Keep the response under roughly 200 words, prefer short bullet lists.
- Never call tools or run shell commands; respond with plain Markdown text only.`;

export class InteractiveShell {
  private readonly rl: readline.Interface;
  private agent: AgentRuntime | null = null;
  private readonly profile: ProfileName;
  private readonly profileLabel: string;
  private readonly workingDir: string;
  private readonly runtimeSession: AgentSession;
  private baseSystemPrompt: string;
  private workspaceOptions: WorkspaceCaptureOptions;
  private sessionState: SessionState;
  private isProcessing = false;
  private pendingInteraction: PendingInteraction | null = null;
  private pendingSecretRetry: (() => unknown | Promise<unknown>) | null = null;
  private bufferedInputLines: string[] = [];
  private bufferedInputTimer: NodeJS.Timeout | null = null;
  private pendingPasteInput: string | null = null;
  private awaitingPasteConfirmation = false;
  private readonly bracketedPaste: BracketedPasteManager;
  private bracketedPasteEnabled = false;
  private pendingCleanup: Promise<void> | null = null;
  private cleanupInProgress = false;
  private slashPreviewVisible = false;
  private readonly skillRepository: SkillRepository;
  private readonly skillToolHandlers = new Map<string, SkillToolHandler>();
  private thinkingMode: ThinkingMode = 'balanced';
  private readonly agentMenu: AgentSelectionConfig | null;
  private readonly slashCommands: SlashCommandDefinition[];
  private bannerSessionState: { model: string; provider: ProviderId } | null = null;
  private readonly promptSkin: PromptSkin;
  private readonly statusTracker: LiveStatusTracker;
  private readonly uiAdapter: ShellUIAdapter;
  private statusSubscription: (() => void) | null = null;
  private activeContextWindowTokens: number | null = null;
  private promptSkinOutputDisposer: (() => void) | null = null;
  private readonly sessionPreferences: SessionPreferences;
  private autosaveEnabled: boolean;
  private pendingHistoryLoad: ConversationMessage[] | null = null;
  private cachedHistory: ConversationMessage[] = [];
  private activeSessionId: string | null = null;
  private activeSessionTitle: string | null = null;
  private sessionResumeNotice: string | null = null;
  private readonly customCommands: LoadedCustomCommand[];
  private readonly customCommandMap: Map<string, LoadedCustomCommand>;

  constructor(config: ShellConfig) {
    this.profile = config.profile;
    this.profileLabel = config.profileLabel;
    this.workingDir = config.workingDir;
    this.runtimeSession = config.session;
    this.baseSystemPrompt = config.baseSystemPrompt;
    this.workspaceOptions = { ...config.workspaceOptions };
    this.sessionPreferences = loadSessionPreferences();
    this.thinkingMode = this.sessionPreferences.thinkingMode;
    this.autosaveEnabled = this.sessionPreferences.autosave;
    this.initializeSessionHistory();
    this.sessionState = {
      provider: config.initialModel.provider,
      model: config.initialModel.model,
      temperature: config.initialModel.temperature,
      maxTokens: config.initialModel.maxTokens,
      reasoningEffort: config.initialModel.reasoningEffort,
    };
    this.applyPresetReasoningDefaults();
    // The welcome banner only includes model + provider on launch, so mark that as the initial state.
    this.bannerSessionState = {
      model: this.sessionState.model,
      provider: this.sessionState.provider,
    };
    this.agentMenu = config.agentSelection ?? null;
    this.slashCommands = [...BASE_SLASH_COMMANDS];
    if (this.agentMenu) {
      this.slashCommands.push({
        command: '/agents',
        description: 'Select the default agent profile (applies on next launch)',
      });
    }
    this.customCommands = loadCustomSlashCommands();
    this.customCommandMap = new Map(this.customCommands.map((command) => [command.command, command]));
    for (const custom of this.customCommands) {
      this.slashCommands.push({
        command: custom.command,
        description: `${custom.description} (custom)`,
      });
    }

    this.statusTracker = config.statusTracker;
    this.uiAdapter = config.uiAdapter;
    this.skillRepository = new SkillRepository({
      workingDir: this.workingDir,
      env: process.env,
    });
    for (const definition of createSkillTools({ repository: this.skillRepository })) {
      this.skillToolHandlers.set(definition.name, definition.handler);
    }

    this.rl = readline.createInterface({
      input,
      output,
      prompt: formatUserPrompt(this.profileLabel || this.profile),
      terminal: true,
    });
    this.promptSkin = new PromptSkin(this.rl);

    // Keep legacy components for backward compatibility during transition
    this.promptSkinOutputDisposer = display.registerOutputInterceptor({
      beforeWrite: () => this.promptSkin.beginOutput(),
      afterWrite: () => this.promptSkin.endOutput(),
    });
    this.setupStatusTracking();
    this.refreshContextGauge();

    this.bracketedPasteEnabled = this.enableBracketedPasteMode();
    this.bracketedPaste = new BracketedPasteManager(this.bracketedPasteEnabled);
    this.rebuildAgent();
    this.setupHandlers();
    this.refreshBannerSessionInfo();
  }

  private initializeSessionHistory(): void {
    this.cachedHistory = [];
    this.pendingHistoryLoad = null;
    this.activeSessionId = null;
    this.activeSessionTitle = null;
    this.sessionResumeNotice = null;

    if (this.sessionPreferences.autoResume && this.sessionPreferences.lastSessionId) {
      const stored = loadSessionById(this.sessionPreferences.lastSessionId);
      if (stored) {
        this.cachedHistory = stored.messages;
        this.pendingHistoryLoad = stored.messages;
        this.activeSessionId = stored.id;
        this.activeSessionTitle = stored.title;
        this.sessionResumeNotice = `Resumed session "${stored.title}".`;
        return;
      }
      saveSessionPreferences({ lastSessionId: null });
    }

    if (this.autosaveEnabled) {
      const autosave = loadAutosaveSnapshot(this.profile);
      if (autosave) {
        this.cachedHistory = autosave.messages;
        this.pendingHistoryLoad = autosave.messages;
        this.activeSessionId = null;
        this.activeSessionTitle = autosave.title;
        this.sessionResumeNotice = 'Restored last autosaved session.';
      }
    }
  }

  private showSessionResumeNotice(): void {
    if (!this.sessionResumeNotice) {
      return;
    }
    display.showInfo(this.sessionResumeNotice);
    this.sessionResumeNotice = null;
  }

  async start(initialPrompt?: string): Promise<void> {
    if (initialPrompt) {
      display.newLine();
      this.promptSkin.beginOutput();
      console.log(`${formatUserPrompt(this.profileLabel || this.profile)}${initialPrompt}`);
      this.promptSkin.endOutput();
      await this.processInputBlock(initialPrompt);
      return;
    }

    this.rl.prompt();
  }

  private async handleToolSettingsInput(input: string): Promise<void> {
    const pending = this.pendingInteraction;
    if (!pending || pending.type !== 'tool-settings') {
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      display.showWarning('Enter a number, "save", "defaults", or "cancel".');
      this.rl.prompt();
      return;
    }

    const normalized = trimmed.toLowerCase();

    if (normalized === 'cancel') {
      this.pendingInteraction = null;
      display.showInfo('Tool selection cancelled.');
      this.rl.prompt();
      return;
    }

    if (normalized === 'defaults') {
      pending.selection = buildEnabledToolSet(null);
      this.renderToolMenu(pending);
      this.rl.prompt();
      return;
    }

    if (normalized === 'save') {
      await this.persistToolSelection(pending);
      this.pendingInteraction = null;
      this.rl.prompt();
      return;
    }

    const choice = Number.parseInt(trimmed, 10);
    if (Number.isFinite(choice)) {
      const option = pending.options[choice - 1];
      if (!option) {
        display.showWarning('That option is not available.');
      } else {
        if (pending.selection.has(option.id)) {
          pending.selection.delete(option.id);
        } else {
          pending.selection.add(option.id);
        }
        this.renderToolMenu(pending);
      }
      this.rl.prompt();
      return;
    }

    display.showWarning('Enter a number, "save", "defaults", or "cancel".');
    this.rl.prompt();
  }

  private async persistToolSelection(interaction: ToolSettingsInteraction): Promise<void> {
    if (setsEqual(interaction.selection, interaction.initialSelection)) {
      display.showInfo('No changes to save.');
      return;
    }

    const defaults = buildEnabledToolSet(null);
    if (setsEqual(interaction.selection, defaults)) {
      clearToolSettings();
      display.showInfo('Tool settings cleared. Defaults will be used on the next launch.');
      return;
    }

    const ordered = interaction.options
      .map((option) => option.id)
      .filter((id) => interaction.selection.has(id));
    saveToolSettings({ enabledTools: ordered });
    display.showInfo('Tool settings saved. Restart the CLI to apply them.');
  }

  private async handleAgentSelectionInput(input: string): Promise<void> {
    const pending = this.pendingInteraction;
    if (!pending || pending.type !== 'agent-selection') {
      return;
    }

    if (!this.agentMenu) {
      this.pendingInteraction = null;
      display.showWarning('Agent selection is unavailable in this CLI.');
      this.rl.prompt();
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      display.showWarning('Enter a number or type "cancel".');
      this.rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'cancel') {
      this.pendingInteraction = null;
      display.showInfo('Agent selection cancelled.');
      this.rl.prompt();
      return;
    }

    const choice = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(choice)) {
      display.showWarning('Please enter a valid number.');
      this.rl.prompt();
      return;
    }

    const option = pending.options[choice - 1];
    if (!option) {
      display.showWarning('That option is not available.');
      this.rl.prompt();
      return;
    }

    await this.persistAgentSelection(option.name);
    this.pendingInteraction = null;
    this.rl.prompt();
  }

  private async persistAgentSelection(profileName: ProfileName): Promise<void> {
    if (!this.agentMenu) {
      return;
    }

    const currentDefault = this.agentMenu.persistedProfile ?? this.agentMenu.defaultProfile;
    if (profileName === currentDefault) {
      display.showInfo(
        `${this.agentMenuLabel(profileName)} is already configured for the next launch.`
      );
      return;
    }

    if (profileName === this.agentMenu.defaultProfile) {
      clearActiveProfilePreference();
      this.agentMenu.persistedProfile = null;
      display.showInfo(
        `${this.agentMenuLabel(profileName)} restored as the default agent. Restart the CLI to switch.`
      );
      return;
    }

    saveActiveProfilePreference(profileName);
    this.agentMenu.persistedProfile = profileName;
    display.showInfo(
      `${this.agentMenuLabel(profileName)} will load the next time you start the CLI. Restart to switch now.`
    );
  }

  private setupHandlers(): void {
    this.rl.on('line', (line) => {
      const normalized = this.bracketedPaste.process(line);
      if (normalized.handled) {
        if (typeof normalized.result === 'string') {
          this.enqueueUserInput(normalized.result, true);
        }
        return;
      }

      this.enqueueUserInput(line);
    });

    this.rl.on('close', () => {
      this.disableBracketedPasteMode();
      this.teardownStatusTracking();
      if (this.promptSkinOutputDisposer) {
        this.promptSkinOutputDisposer();
        this.promptSkinOutputDisposer = null;
      }
      this.promptSkin.dispose();

      // Dispose unified UI adapter
      this.uiAdapter.dispose();

      display.newLine();
      const highlightedEmail = theme.info('support@ero.solar');
      const infoMessage = [
        'Made available for defensive and offensive security operations.',
        '',
        'Learn more:',
        'https://www.anthropic.com/news/disrupting-AI-espionage',
        '',
        `Email ${highlightedEmail} with any bugs or feedback`,
        'GitHub: https://github.com/dragonghidra/apt-cli-RE-claude-code',
        'npm: https://www.npmjs.com/package/apt-cli',
      ].join('\n');
      display.showInfo(infoMessage);
      exit(0);
    });

    this.setupSlashCommandPreviewHandler();
  }

  private setupSlashCommandPreviewHandler(): void {
    const inputStream = input as NodeJS.ReadStream | undefined;
    if (!inputStream || typeof inputStream.on !== 'function' || !inputStream.isTTY) {
      return;
    }

    readline.emitKeypressEvents(inputStream, this.rl);
    inputStream.on('keypress', (_str: string, key: any) => {
      this.handleSlashCommandPreviewChange();

      // Handle Shift+Tab for profile switching
      if (key && key.name === 'tab' && key.shift && this.agentMenu) {
        this.showProfileSwitcher();
      }
    });
  }

  private setupStatusTracking(): void {
    this.statusSubscription = this.statusTracker.subscribe((state) => {
      this.promptSkin.setStatus(state);
    });
    this.setIdleStatus();
  }

  private teardownStatusTracking(): void {
    if (this.statusSubscription) {
      this.statusSubscription();
      this.statusSubscription = null;
    }
    this.statusTracker.reset();
  }

  private setIdleStatus(detail?: string): void {
    this.statusTracker.setBase('Ready for prompts', {
      detail: detail ?? this.describeModelDetail(),
      tone: 'success',
    });
  }

  private setProcessingStatus(detail?: string): void {
    this.statusTracker.setBase('Working on your request', {
      detail: detail ?? this.describeModelDetail(),
      tone: 'info',
    });
  }

  private describeModelDetail(): string {
    const provider = this.providerLabel(this.sessionState.provider);
    return `${provider} · ${this.sessionState.model}`;
  }

  private refreshContextGauge(): void {
    const tokens = getContextWindowTokens(this.sessionState.model);
    this.activeContextWindowTokens =
      typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : null;
  }

  private handleSlashCommandPreviewChange(): void {
    if (this.pendingInteraction || this.awaitingPasteConfirmation) {
      this.slashPreviewVisible = false;
      return;
    }

    const shouldShow = this.shouldShowSlashCommandPreview();
    if (shouldShow && !this.slashPreviewVisible) {
      this.slashPreviewVisible = true;
      this.showSlashCommandPreview();
      return;
    }

    if (!shouldShow && this.slashPreviewVisible) {
      this.slashPreviewVisible = false;
      this.uiAdapter.hideSlashCommandPreview();
    }
  }

  private shouldShowSlashCommandPreview(): boolean {
    const line = this.rl.line ?? '';
    if (!line.trim()) {
      return false;
    }

    const trimmed = line.trimStart();
    return trimmed.startsWith('/');
  }

  private showSlashCommandPreview(): void {
    // Filter commands based on current input
    const line = this.rl.line ?? '';
    const trimmed = line.trimStart();

    // Filter commands that match the current input
    const filtered = this.slashCommands.filter(cmd =>
      cmd.command.startsWith(trimmed) || trimmed === '/'
    );

    // Show in the unified UI with dynamic overlay
    this.uiAdapter.showSlashCommandPreview(filtered, trimmed);

    // Don't reprompt - this causes flickering
  }

  private showProfileSwitcher(): void {
    if (!this.agentMenu) {
      return;
    }

    // Build profile options with current/next indicators
    const profiles = this.agentMenu.options.map((option, index) => {
      const badges: string[] = [];
      const nextProfile = this.agentMenu!.persistedProfile ?? this.agentMenu!.defaultProfile;

      if (option.name === this.profile) {
        badges.push('current');
      }
      if (option.name === nextProfile && option.name !== this.profile) {
        badges.push('next');
      }

      const badgeText = badges.length > 0 ? ` (${badges.join(', ')})` : '';
      return {
        command: `${index + 1}. ${option.label}${badgeText}`,
        description: `${this.providerLabel(option.defaultProvider)} • ${option.defaultModel}`,
      };
    });

    // Show profile switcher overlay
    this.uiAdapter.showProfileSwitcher(profiles, this.profileLabel);
  }

  private enqueueUserInput(line: string, flushImmediately = false): void {
    this.bufferedInputLines.push(line);

    if (flushImmediately) {
      if (this.bufferedInputTimer) {
        clearTimeout(this.bufferedInputTimer);
        this.bufferedInputTimer = null;
      }

      void this.flushBufferedInput();
      return;
    }

    if (this.bufferedInputTimer) {
      clearTimeout(this.bufferedInputTimer);
    }

    this.bufferedInputTimer = setTimeout(() => {
      void this.flushBufferedInput();
    }, MULTILINE_INPUT_FLUSH_DELAY_MS);
  }

  private async flushBufferedInput(): Promise<void> {
    if (!this.bufferedInputLines.length) {
      this.bufferedInputTimer = null;
      return;
    }

    const lineCount = this.bufferedInputLines.length;
    const combined = this.bufferedInputLines.join('\n');
    this.bufferedInputLines = [];
    this.bufferedInputTimer = null;

    try {
      await this.processInputBlock(combined, lineCount > 1);
    } catch (error) {
      display.showError(error instanceof Error ? error.message : String(error));
      this.rl.prompt();
    }
  }

  private async processInputBlock(line: string, wasRapidMultiLine = false): Promise<void> {
    this.slashPreviewVisible = false;
    this.uiAdapter.hideSlashCommandPreview();
    const trimmed = line.trim();

    if (await this.handlePendingInteraction(trimmed)) {
      return;
    }

    if (this.awaitingPasteConfirmation) {
      if (!trimmed && this.pendingPasteInput) {
        const pending = this.pendingPasteInput;
        this.awaitingPasteConfirmation = false;
        this.pendingPasteInput = null;
        await this.processRequest(pending);
        this.rl.prompt();
        return;
      }

      if (trimmed.toLowerCase() === '/cancel') {
        this.awaitingPasteConfirmation = false;
        this.pendingPasteInput = null;
        display.showInfo('Cancelled multi-line paste.');
        this.rl.prompt();
        return;
      }

      this.awaitingPasteConfirmation = false;
      this.pendingPasteInput = null;
      // Continue handling the new input normally.
    }

    if (!trimmed) {
      this.rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      this.rl.close();
      return;
    }

    if (trimmed.toLowerCase() === 'clear') {
      display.clear();
      this.rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'help') {
      this.showHelp();
      this.rl.prompt();
      return;
    }

    if (trimmed.startsWith('/')) {
      await this.processSlashCommand(trimmed);
      return;
    }

    if (wasRapidMultiLine && trimmed) {
      this.pendingPasteInput = trimmed;
      this.awaitingPasteConfirmation = true;
      display.showInfo('Multi-line paste captured. Press Enter to submit it, or type /cancel to discard.');
      this.rl.prompt();
      return;
    }

    await this.processRequest(trimmed);
    this.rl.prompt();
  }

  private async handlePendingInteraction(input: string): Promise<boolean> {
    if (!this.pendingInteraction) {
      return false;
    }

    switch (this.pendingInteraction.type) {
      case 'model-provider':
        await this.handleModelProviderSelection(input);
        return true;
      case 'model':
        await this.handleModelSelection(input);
        return true;
      case 'secret-select':
        await this.handleSecretSelection(input);
        return true;
      case 'secret-input':
        await this.handleSecretInput(input);
        return true;
      case 'tool-settings':
        await this.handleToolSettingsInput(input);
        return true;
      case 'agent-selection':
        await this.handleAgentSelectionInput(input);
        return true;
      default:
        return false;
    }
  }

  private async processSlashCommand(input: string): Promise<void> {
    const [command] = input.split(/\s+/);
    if (!command) {
      display.showWarning('Enter a slash command.');
      this.rl.prompt();
      return;
    }

    switch (command) {
      case '/model':
        this.showModelMenu();
        break;
      case '/secrets':
        this.showSecretsMenu();
        break;
      case '/tools':
        this.showToolsMenu();
        break;
      case '/doctor':
        this.runDoctor();
        break;
      case '/checks':
        await this.runRepoChecksCommand();
        break;
      case '/context':
        await this.refreshWorkspaceContextCommand(input);
        break;
      case '/agents':
        this.showAgentsMenu();
        break;
      case '/sessions':
        await this.handleSessionCommand(input);
        break;
      case '/skills':
        await this.handleSkillsCommand(input);
        break;
      case '/thinking':
        this.handleThinkingCommand(input);
        break;
      default:
        if (!(await this.tryCustomSlashCommand(command, input))) {
          display.showWarning(`Unknown command "${command}".`);
        }
        break;
    }

    this.rl.prompt();
  }

  private async tryCustomSlashCommand(command: string, fullInput: string): Promise<boolean> {
    const custom = this.customCommandMap.get(command);
    if (!custom) {
      return false;
    }

    const args = fullInput.slice(command.length).trim();
    if (custom.requireInput && !args) {
      display.showWarning(`${command} requires additional input.`);
      return true;
    }

    const prompt = buildCustomCommandPrompt(custom, args, {
      workspace: this.workingDir,
      profile: this.profile,
      provider: this.sessionState.provider,
      model: this.sessionState.model,
    }).trim();

    if (!prompt) {
      display.showWarning(
        `Custom command ${command} did not produce any text. Check ${custom.source} for errors.`
      );
      return true;
    }

    display.showInfo(`Running ${command} from ${custom.source}...`);
    await this.processRequest(prompt);
    return true;
  }

  private showHelp(): void {
    const info = [
      this.buildSlashCommandList('Available Commands:'),
      '',
      'Type your request in natural language and press Enter.',
    ];
    display.showSystemMessage(info.join('\n'));
  }

  private runDoctor(): void {
    const lines: string[] = [];
    lines.push(theme.bold('Environment diagnostics'));
    lines.push('');
    lines.push(`${theme.secondary('Workspace')}: ${this.workingDir}`);
    lines.push('');
    lines.push(theme.bold('Provider credentials'));
    const providerDefinition = getSecretDefinitionForProvider(this.sessionState.provider);
    if (providerDefinition) {
      const currentValue = getSecretValue(providerDefinition.id);
      if (currentValue) {
        lines.push(`${theme.success('✓')} ${providerDefinition.label} configured (${providerDefinition.envVar}).`);
      } else {
        lines.push(`${theme.warning('⚠')} Missing ${providerDefinition.label} (${providerDefinition.envVar}). Run /secrets to configure it.`);
      }
    } else {
      lines.push(`${theme.secondary('•')} ${this.providerLabel(this.sessionState.provider)} does not require an API key.`);
    }
    lines.push('');
    lines.push(theme.bold('Tool suites'));
    const toolSettings = loadToolSettings();
    const selection = buildEnabledToolSet(toolSettings);
    const permissions = evaluateToolPermissions(selection);
    const options = getToolToggleOptions();
    const enabledLabels = options
      .filter((option) => selection.has(option.id))
      .map((option) => option.label);
    lines.push(`Enabled: ${enabledLabels.length ? enabledLabels.join(', ') : 'none'}`);
    if (!permissions.warnings.length) {
      lines.push(theme.success('All enabled suites loaded successfully.'));
    } else {
      lines.push(theme.warning('Issues detected:'));
      for (const warning of permissions.warnings) {
        const detail = this.describeToolWarning(warning);
        lines.push(`  - ${detail}`);
      }
    }
    display.showSystemMessage(lines.join('\n'));
  }

  private async runRepoChecksCommand(): Promise<void> {
    if (this.isProcessing) {
      display.showWarning('Wait for the active response to finish before running checks.');
      return;
    }

    const call: ToolCallRequest = {
      id: 'manual-run-repo-checks',
      name: 'run_repo_checks',
      arguments: {},
    };

    display.showInfo('Running repo checks (npm test/build/lint when available)...');
    const output = await this.runtimeSession.toolRuntime.execute(call);
    display.showSystemMessage(output);
  }

  private async refreshWorkspaceContextCommand(input: string): Promise<void> {
    if (this.isProcessing) {
      display.showWarning('Wait for the active response to finish before refreshing the snapshot.');
      return;
    }

    const { overrides, error } = this.parseContextOverrideTokens(input);
    if (error) {
      display.showWarning(`${error} ${this.describeContextOverrideUsage()}`);
      return;
    }

    if (overrides) {
      this.workspaceOptions = { ...this.workspaceOptions, ...overrides };
    }

    display.showInfo('Refreshing workspace snapshot...');
    const context = buildWorkspaceContext(this.workingDir, this.workspaceOptions);
    const profileConfig = this.runtimeSession.refreshWorkspaceContext(context);
    const tools = this.runtimeSession.toolRuntime.listProviderTools();
    this.baseSystemPrompt = buildInteractiveSystemPrompt(
      profileConfig.systemPrompt,
      profileConfig.label,
      tools
    );

    if (this.rebuildAgent()) {
      display.showInfo(`Workspace snapshot refreshed (${this.describeWorkspaceOptions()}).`);
    } else {
      display.showWarning('Workspace snapshot refreshed, but the agent failed to rebuild. Run /doctor for details.');
    }
  }

  private parseContextOverrideTokens(
    input: string
  ): { overrides: WorkspaceCaptureOptions | null; error?: string } {
    const overrides: WorkspaceCaptureOptions = {};
    let hasOverride = false;
    const tokens = input
      .trim()
      .split(/\s+/)
      .slice(1);

    for (const token of tokens) {
      if (!token) {
        continue;
      }
      const [rawKey, rawValue] = token.split('=');
      if (!rawKey || !rawValue) {
        return { overrides: null, error: `Invalid option "${token}".` };
      }

      const key = rawKey.toLowerCase();
      const value = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(value) || value <= 0) {
        return { overrides: null, error: `Value for "${key}" must be a positive integer.` };
      }

      switch (key) {
        case 'depth':
          overrides.treeDepth = value;
          hasOverride = true;
          break;
        case 'entries':
          overrides.maxEntries = value;
          hasOverride = true;
          break;
        case 'excerpt':
        case 'doc':
        case 'docs':
          overrides.docExcerptLimit = value;
          hasOverride = true;
          break;
        default:
          return { overrides: null, error: `Unknown option "${key}".` };
      }
    }

    return { overrides: hasOverride ? overrides : null };
  }

  private async handleSessionCommand(input: string): Promise<void> {
    const tokens = input
      .trim()
      .split(/\s+/)
      .slice(1);
    const action = (tokens.shift() ?? 'list').toLowerCase();
    switch (action) {
      case '':
      case 'list':
        this.showSessionList();
        return;
      case 'save':
        await this.saveSessionCommand(tokens.join(' ').trim());
        return;
      case 'load':
        await this.loadSessionCommand(tokens.join(' ').trim());
        return;
      case 'delete':
      case 'remove':
        this.deleteSessionCommand(tokens.join(' ').trim());
        return;
      case 'new':
        this.newSessionCommand(tokens.join(' ').trim());
        return;
      case 'autosave':
        this.toggleAutosaveCommand(tokens[0]);
        return;
      case 'clear':
        this.clearAutosaveCommand();
        return;
      default:
        display.showWarning(
          'Usage: /sessions [list|save <title>|load <id>|delete <id>|new <title>|autosave on|off|clear]'
        );
        return;
    }
  }

  private async handleSkillsCommand(input: string): Promise<void> {
    const raw = input.slice('/skills'.length).trim();
    const tokens = raw ? raw.split(/\s+/).filter(Boolean) : [];
    let refresh = false;
    const filtered: string[] = [];
    for (const token of tokens) {
      if (token === '--refresh' || token === '-r') {
        refresh = true;
        continue;
      }
      filtered.push(token);
    }

    let mode = filtered.shift()?.toLowerCase() ?? 'list';
    if (mode === 'refresh') {
      refresh = true;
      mode = 'list';
    }

    try {
      switch (mode) {
        case '':
        case 'list': {
          const query = filtered.join(' ');
          const output = await this.invokeSkillTool('ListSkills', {
            query: query || undefined,
            refresh_cache: refresh,
          });
          display.showSystemMessage(output);
          break;
        }
        case 'show':
        case 'view': {
          const identifier = filtered.shift();
          if (!identifier) {
            display.showWarning('Usage: /skills show <skill-id> [sections=metadata,body]');
            return;
          }
          let sectionsArg: string | undefined;
          for (let i = 0; i < filtered.length; i += 1) {
            const token = filtered[i];
            if (!token) {
              continue;
            }
            if (token.startsWith('sections=')) {
              sectionsArg = token.slice('sections='.length);
              filtered.splice(i, 1);
              break;
            }
          }
          const sections = sectionsArg
            ? sectionsArg
                .split(',')
                .map((section) => section.trim())
                .filter(Boolean)
            : undefined;
          const output = await this.invokeSkillTool('Skill', {
            skill: identifier,
            sections,
            refresh_cache: refresh,
          });
          display.showSystemMessage(output);
          break;
        }
        default:
          display.showWarning('Usage: /skills [list|refresh|show <id> [sections=a,b]]');
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      display.showError(`Skill command failed: ${message}`);
    }
  }

  private async invokeSkillTool(name: string, args: Record<string, unknown>): Promise<string> {
    const handler = this.skillToolHandlers.get(name);
    if (!handler) {
      throw new Error(`Skill tool "${name}" is not registered.`);
    }
    const result = await handler(args);
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  private handleThinkingCommand(input: string): void {
    const value = input.slice('/thinking'.length).trim().toLowerCase();
    if (!value) {
      display.showInfo(
        `Thinking mode is currently ${theme.info(this.thinkingMode)}. Usage: /thinking [concise|balanced|extended]`
      );
      return;
    }
    if (value !== 'concise' && value !== 'balanced' && value !== 'extended') {
      display.showWarning('Usage: /thinking [concise|balanced|extended]');
      return;
    }
    if (this.isProcessing) {
      display.showWarning('Wait until the current request finishes before changing thinking mode.');
      return;
    }
    this.thinkingMode = value as ThinkingMode;
    saveSessionPreferences({ thinkingMode: this.thinkingMode });
    this.rebuildAgent();
    const descriptions: Record<ThinkingMode, string> = {
      concise: 'Hides internal reasoning and responds directly.',
      balanced: 'Shows short thoughts only when helpful.',
      extended: 'Always emits a <thinking> block before the final response.',
    };
    display.showInfo(`Thinking mode set to ${theme.info(value)} – ${descriptions[this.thinkingMode]}`);
  }

  private showSessionList(): void {
    const sessions = listSessions(this.profile);
    const lines: string[] = [];
    lines.push(theme.bold('Saved sessions'));
    lines.push('Use "/sessions save <title>" to persist history or "/sessions load <id>" to resume.');
    lines.push('');

    if (!sessions.length) {
      lines.push(theme.secondary('No saved sessions yet.'));
    } else {
      sessions.forEach((session, index) => {
        const prefix = `${index + 1}.`;
        const label = session.title || '(untitled)';
        const relative = this.describeRelativeTime(session.updatedAt);
        const active =
          this.activeSessionId && session.id === this.activeSessionId
            ? ` ${theme.success('[active]')}`
            : '';
        const messageCount = `${session.messageCount} msg`;
        const shortId = this.formatSessionId(session.id);
        lines.push(
          `${prefix.padEnd(3)} ${label} ${theme.secondary(`(${messageCount}, ${relative}, ${shortId})`)}${active}`
        );
      });
    }

    lines.push('');
    lines.push(
      `Autosave: ${
        this.autosaveEnabled ? theme.success('on') : theme.warning('off')
      } (toggle via "/sessions autosave on|off")`
    );
    display.showSystemMessage(lines.join('\n'));
  }

  private async saveSessionCommand(title: string): Promise<void> {
    const agent = this.agent;
    if (!agent) {
      display.showWarning('Start a conversation before saving a session.');
      return;
    }

    const history = agent.getHistory();
    if (!history || history.length <= 1) {
      display.showWarning('You need at least one user message before saving a session.');
      return;
    }

    const summary = saveSessionSnapshot({
      id: this.activeSessionId ?? undefined,
      title: title || this.activeSessionTitle || null,
      profile: this.profile,
      provider: this.sessionState.provider,
      model: this.sessionState.model,
      workspaceRoot: this.workingDir,
      messages: history,
    });

    this.cachedHistory = history;
    this.updateActiveSession(summary, true);
    this.sessionResumeNotice = null;
    this.autosaveIfEnabled();
    display.showInfo(`Session saved as "${summary.title}" (id ${this.formatSessionId(summary.id)}).`);
  }

  private async loadSessionCommand(selector: string): Promise<void> {
    const summary = this.resolveSessionBySelector(selector);
    if (!summary) {
      display.showWarning('No session matches that selection.');
      return;
    }

    const stored = loadSessionById(summary.id);
    if (!stored) {
      display.showWarning('Failed to load that session. It may have been corrupted or deleted.');
      return;
    }

    this.cachedHistory = stored.messages;
    this.updateActiveSession(summary, true);
    this.sessionResumeNotice = `Loaded session "${summary.title}".`;
    if (this.agent) {
      this.agent.loadHistory(stored.messages);
      this.sessionResumeNotice = null;
      display.showInfo(`Loaded session "${summary.title}".`);
      this.refreshContextGauge();
      this.captureHistorySnapshot();
      this.pendingHistoryLoad = null;
    } else {
      this.pendingHistoryLoad = stored.messages;
      display.showInfo(`Session "${summary.title}" queued to load once the agent is ready.`);
    }
    this.autosaveIfEnabled();
  }

  private deleteSessionCommand(selector: string): void {
    const summary = this.resolveSessionBySelector(selector);
    if (!summary) {
      display.showWarning('No session matches that selection.');
      return;
    }
    if (!deleteSession(summary.id)) {
      display.showWarning('Unable to delete that session.');
      return;
    }
    display.showInfo(`Deleted session "${summary.title}".`);
    if (this.activeSessionId === summary.id) {
      this.activeSessionId = null;
      this.activeSessionTitle = null;
      saveSessionPreferences({ lastSessionId: null });
    }
  }

  private newSessionCommand(title: string): void {
    if (this.agent) {
      this.agent.clearHistory();
      this.cachedHistory = this.agent.getHistory();
      this.pendingHistoryLoad = null;
    }
    if (!this.agent) {
      this.cachedHistory = [];
      this.pendingHistoryLoad = [];
    }
    this.activeSessionId = null;
    this.activeSessionTitle = title || null;
    this.sessionResumeNotice = null;
    saveSessionPreferences({ lastSessionId: null });
    clearAutosaveSnapshot(this.profile);
    display.showInfo('Started a new empty session.');
    this.refreshContextGauge();
  }

  private toggleAutosaveCommand(value?: string): void {
    if (!value) {
      display.showWarning('Usage: /sessions autosave on|off');
      return;
    }
    const normalized = value.toLowerCase();
    if (normalized !== 'on' && normalized !== 'off') {
      display.showWarning('Usage: /sessions autosave on|off');
      return;
    }
    this.autosaveEnabled = normalized === 'on';
    saveSessionPreferences({ autosave: this.autosaveEnabled });
    display.showInfo(`Autosave ${this.autosaveEnabled ? 'enabled' : 'disabled'}.`);
    if (!this.autosaveEnabled) {
      clearAutosaveSnapshot(this.profile);
    } else {
      this.autosaveIfEnabled();
    }
  }

  private clearAutosaveCommand(): void {
    clearAutosaveSnapshot(this.profile);
    display.showInfo('Cleared autosave history.');
  }

  private updateActiveSession(summary: SessionSummary | null, remember = false): void {
    this.activeSessionId = summary?.id ?? null;
    this.activeSessionTitle = summary?.title ?? null;
    if (remember) {
      saveSessionPreferences({ lastSessionId: summary?.id ?? null });
    }
  }

  private resolveSessionBySelector(selector: string): SessionSummary | null {
    const sessions = listSessions(this.profile);
    if (!sessions.length) {
      return null;
    }
    if (!selector) {
      return sessions[0] ?? null;
    }
    const trimmed = selector.trim();
    if (!trimmed) {
      return sessions[0] ?? null;
    }
    const index = Number.parseInt(trimmed, 10);
    if (Number.isFinite(index)) {
      const entry = sessions[index - 1];
      return entry ?? null;
    }
    const match = sessions.find((session) => session.id.startsWith(trimmed));
    return match ?? null;
  }

  private formatSessionId(id: string): string {
    return id.length > 8 ? `${id.slice(0, 8)}…` : id;
  }

  private describeRelativeTime(timestamp: string): string {
    const updated = Date.parse(timestamp);
    if (!updated) {
      return 'unknown';
    }
    const deltaMs = Date.now() - updated;
    const minutes = Math.round(deltaMs / 60000);
    if (minutes < 1) {
      return 'just now';
    }
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  private captureHistorySnapshot(): void {
    if (!this.agent) {
      return;
    }
    this.cachedHistory = this.agent.getHistory();
  }

  private autosaveIfEnabled(): void {
    if (!this.autosaveEnabled) {
      return;
    }
    if (!this.cachedHistory || this.cachedHistory.length <= 1) {
      return;
    }
    saveAutosaveSnapshot(this.profile, {
      provider: this.sessionState.provider,
      model: this.sessionState.model,
      workspaceRoot: this.workingDir,
      title: this.activeSessionTitle,
      messages: this.cachedHistory,
    });
  }

  private describeWorkspaceOptions(): string {
    const depth = this.workspaceOptions.treeDepth ?? 'default';
    const entries = this.workspaceOptions.maxEntries ?? 'default';
    const excerpt = this.workspaceOptions.docExcerptLimit ?? 'default';
    return `depth=${depth}, entries=${entries}, excerpt=${excerpt}`;
  }

  private describeContextOverrideUsage(): string {
    return 'Usage: /context [depth=<n>] [entries=<n>] [excerpt=<n>]';
  }

  private describeToolWarning(warning: ToolLoadWarning): string {
    if (warning.reason === 'missing-secret' && warning.secretId) {
      return `${warning.label}: missing ${warning.secretId}. Use /secrets to configure it.`;
    }
    return `${warning.label}: ${warning.reason}.`;
  }

  private buildSlashCommandList(header: string): string {
    const lines = [theme.gradient.primary(header), ''];
    for (const command of this.slashCommands) {
      lines.push(`${theme.primary(command.command)} - ${command.description}`);
    }
    return lines.join('\n');
  }

  private showModelMenu(): void {
    const providerOptions = this.buildProviderOptions();
    if (!providerOptions.length) {
      display.showWarning('No providers are available.');
      return;
    }

    const lines = [
      theme.bold('Select a provider:'),
      ...providerOptions.map((option, index) => {
        const isCurrent = option.provider === this.sessionState.provider;
        const countLabel = `${option.modelCount} model${option.modelCount === 1 ? '' : 's'}`;
        const label = this.colorizeDropdownLine(
          `${index + 1}. ${option.label} — ${countLabel}`,
          index
        );
        const suffix = isCurrent ? ` ${theme.primary('• current')}` : '';
        return `${label}${suffix}`;
      }),
      'Type the number of the provider to continue, or type "cancel".',
    ];
    display.showSystemMessage(lines.join('\n'));
    this.pendingInteraction = { type: 'model-provider', options: providerOptions };
  }

  private buildProviderOptions(): ModelProviderOption[] {
    const counts = new Map<ProviderId, number>();
    for (const preset of MODEL_PRESETS) {
      counts.set(preset.provider, (counts.get(preset.provider) ?? 0) + 1);
    }

    const orderedProviders: ProviderId[] = [];
    const seen = new Set<ProviderId>();
    for (const preset of MODEL_PRESETS) {
      if (seen.has(preset.provider)) {
        continue;
      }
      seen.add(preset.provider);
      orderedProviders.push(preset.provider);
    }

    return orderedProviders.map((provider) => ({
      provider,
      label: this.providerLabel(provider),
      modelCount: counts.get(provider) ?? 0,
    }));
  }

  private showProviderModels(option: ModelProviderOption): void {
    const models = MODEL_PRESETS.filter((preset) => preset.provider === option.provider);
    if (!models.length) {
      display.showWarning(`No models available for ${option.label}.`);
      this.pendingInteraction = null;
      return;
    }

    const lines = [
      theme.bold(`Select a model from ${option.label}:`),
      ...models.map((preset, index) => {
        const isCurrent = preset.id === this.sessionState.model;
        const label = this.colorizeDropdownLine(`${index + 1}. ${preset.label}`, index);
        const suffix = isCurrent ? ` ${theme.primary('• current')}` : '';
        const description = this.colorizeDropdownLine(`   ${preset.description}`, index);
        return `${label}${suffix}\n${description}`;
      }),
      'Type the number of the model to select it, type "back" to change provider, or type "cancel".',
    ];
    display.showSystemMessage(lines.join('\n'));
    this.pendingInteraction = { type: 'model', provider: option.provider, options: models };
  }

  private showSecretsMenu(): void {
    const definitions = listSecretDefinitions();
    const lines = [
      theme.bold('Manage Secrets:'),
      ...definitions.map((definition, index) => {
        const value = getSecretValue(definition.id);
        const status = value ? maskSecret(value) : theme.warning('not set');
        const providers = definition.providers.map((id) => this.providerLabel(id)).join(', ');
        const label = this.colorizeDropdownLine(
          `${index + 1}. ${definition.label} (${providers})`,
          index
        );
        return `${label} — ${status}`;
      }),
      'Enter the number to update a key, or type "cancel".',
    ];
    display.showSystemMessage(lines.join('\n'));
    this.pendingInteraction = { type: 'secret-select', options: definitions };
  }

  private showToolsMenu(): void {
    const options = getToolToggleOptions();
    if (!options.length) {
      display.showWarning('No configurable tools are available.');
      return;
    }

    const selection = buildEnabledToolSet(loadToolSettings());
    const interaction: ToolSettingsInteraction = {
      type: 'tool-settings',
      options,
      selection,
      initialSelection: new Set(selection),
    };

    this.pendingInteraction = interaction;
    this.renderToolMenu(interaction);
  }

  private renderToolMenu(interaction: ToolSettingsInteraction): void {
    const lines = [
      theme.bold('Select which tools are enabled (changes apply on next launch):'),
      ...interaction.options.map((option, index) =>
        this.formatToolOptionLine(option, index, interaction.selection)
      ),
      '',
      'Enter the number to toggle, "save" to persist, "defaults" to restore recommended tools, or "cancel".',
    ];
    display.showSystemMessage(lines.join('\n'));
  }

  private formatToolOptionLine(
    option: ToolToggleOption,
    index: number,
    selection: Set<ToolToggleId>
  ): string {
    const enabled = selection.has(option.id);
    const checkbox = enabled ? theme.primary('[x]') : theme.ui.muted('[ ]');
    const details = [option.description];
    if (option.requiresSecret) {
      const hasSecret = Boolean(getSecretValue(option.requiresSecret));
      const status = hasSecret ? theme.success('API key set') : theme.warning('API key missing');
      details.push(status);
    }
    const numberLabel = this.colorizeDropdownLine(`${index + 1}.`, index);
    const optionLabel = this.colorizeDropdownLine(option.label, index);
    const detailLine = this.colorizeDropdownLine(`   ${details.join(' • ')}`, index);
    return `${numberLabel} ${checkbox} ${optionLabel}\n${detailLine}`;
  }

  private showAgentsMenu(): void {
    if (!this.agentMenu) {
      display.showWarning('Agent selection is not available in this CLI.');
      return;
    }

    const lines = [
      theme.bold('Select the default agent profile (changes apply on next launch):'),
      ...this.agentMenu.options.map((option, index) =>
        this.formatAgentOptionLine(option, index)
      ),
      '',
      'Enter the number to save it, or type "cancel".',
    ];
    display.showSystemMessage(lines.join('\n'));
    this.pendingInteraction = { type: 'agent-selection', options: this.agentMenu.options };
  }

  private formatAgentOptionLine(option: AgentProfileBlueprint, index: number): string {
    const numberLabel = this.colorizeDropdownLine(`${index + 1}. ${option.label}`, index);
    if (!this.agentMenu) {
      return numberLabel;
    }

    const badges: string[] = [];
    const nextProfile = this.agentMenu.persistedProfile ?? this.agentMenu.defaultProfile;
    if (option.name === nextProfile) {
      badges.push(theme.primary('next launch'));
    }
    if (option.name === this.profile) {
      badges.push(theme.success('current session'));
    }

    const badgeSuffix = badges.length ? ` ${badges.join(' • ')}` : '';
    const rows = [
      `${numberLabel}${badgeSuffix}`,
      `   ${this.providerLabel(option.defaultProvider)} • ${option.defaultModel}`,
    ];
    if (option.description?.trim()) {
      rows.push(`   ${option.description.trim()}`);
    }
    return rows.join('\n');
  }

  private async handleModelProviderSelection(input: string): Promise<void> {
    const pending = this.pendingInteraction;
    if (!pending || pending.type !== 'model-provider') {
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      display.showWarning('Enter a number or type cancel.');
      this.rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'cancel') {
      this.pendingInteraction = null;
      display.showInfo('Model selection cancelled.');
      this.rl.prompt();
      return;
    }

    const choice = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(choice)) {
      display.showWarning('Please enter a valid number.');
      this.rl.prompt();
      return;
    }

    const option = pending.options[choice - 1];
    if (!option) {
      display.showWarning('That option is not available.');
      this.rl.prompt();
      return;
    }

    this.showProviderModels(option);
    this.rl.prompt();
  }

  private async handleModelSelection(input: string): Promise<void> {
    const pending = this.pendingInteraction;
    if (!pending || pending.type !== 'model') {
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      display.showWarning('Enter a number, type "back", or type "cancel".');
      this.rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'back') {
      this.showModelMenu();
      this.rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'cancel') {
      this.pendingInteraction = null;
      display.showInfo('Model selection cancelled.');
      this.rl.prompt();
      return;
    }

    const choice = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(choice)) {
      display.showWarning('Please enter a valid number.');
      this.rl.prompt();
      return;
    }

    const preset = pending.options[choice - 1];
    if (!preset) {
      display.showWarning('That option is not available.');
      this.rl.prompt();
      return;
    }

    this.pendingInteraction = null;
    await this.applyModelPreset(preset);
    this.rl.prompt();
  }

  private async applyModelPreset(preset: ModelPreset): Promise<void> {
    try {
      ensureSecretForProvider(preset.provider);
    } catch (error) {
      this.handleAgentSetupError(error, () => this.applyModelPreset(preset), preset.provider);
      return;
    }

    this.sessionState = {
      provider: preset.provider,
      model: preset.id,
      temperature: preset.temperature,
      maxTokens: preset.maxTokens,
      reasoningEffort: preset.reasoningEffort,
    };
    this.applyPresetReasoningDefaults();

    if (this.rebuildAgent()) {
      display.showInfo(`Switched to ${preset.label}.`);
      this.refreshBannerSessionInfo();
      this.persistSessionPreference();
    }
  }

  private async handleSecretSelection(input: string): Promise<void> {
    const pending = this.pendingInteraction;
    if (!pending || pending.type !== 'secret-select') {
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      display.showWarning('Enter a number or type cancel.');
      this.rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'cancel') {
      this.pendingInteraction = null;
      display.showInfo('Secret management cancelled.');
      this.rl.prompt();
      return;
    }

    const choice = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(choice)) {
      display.showWarning('Please enter a valid number.');
      this.rl.prompt();
      return;
    }

    const secret = pending.options[choice - 1];
    if (!secret) {
      display.showWarning('That option is not available.');
      this.rl.prompt();
      return;
    }

    display.showSystemMessage(`Enter a new value for ${secret.label} or type "cancel".`);
    this.pendingInteraction = { type: 'secret-input', secret };
    this.rl.prompt();
  }

  private async handleSecretInput(input: string): Promise<void> {
    const pending = this.pendingInteraction;
    if (!pending || pending.type !== 'secret-input') {
      return;
    }

    const trimmed = input.trim();
    if (!trimmed) {
      display.showWarning('Enter a value or type cancel.');
      this.rl.prompt();
      return;
    }

    if (trimmed.toLowerCase() === 'cancel') {
      this.pendingInteraction = null;
      this.pendingSecretRetry = null;
      display.showInfo('Secret unchanged.');
      this.rl.prompt();
      return;
    }

    try {
      setSecretValue(pending.secret.id, trimmed);
      display.showInfo(`${pending.secret.label} updated.`);
      this.pendingInteraction = null;
      const deferred = this.pendingSecretRetry;
      this.pendingSecretRetry = null;

      if (pending.secret.providers.includes(this.sessionState.provider)) {
        this.rebuildAgent();
      }

      if (deferred) {
        await deferred();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      display.showError(message);
      this.pendingInteraction = null;
      this.pendingSecretRetry = null;
    }

    this.rl.prompt();
  }

  private async processRequest(request: string): Promise<void> {
    if (this.isProcessing) {
      display.showWarning('Please wait for the current request to complete.');
      return;
    }

    if (!this.agent && !this.rebuildAgent()) {
      display.showWarning('Configure an API key via /secrets before sending requests.');
      return;
    }

    const agent = this.agent;
    if (!agent) {
      return;
    }

    this.isProcessing = true;
    this.promptSkin.setOverlayVisible(false);
    this.uiAdapter.startProcessing('Working on your request');
    this.setProcessingStatus();

    try {
      display.newLine();
      display.showThinking('Working on your request...');
      await agent.send(request);
      await this.awaitPendingCleanup();
      this.captureHistorySnapshot();
      this.autosaveIfEnabled();
    } catch (error) {
      const handled = this.handleProviderError(error, () => this.processRequest(request));
      if (!handled) {
        display.showError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      display.stopThinking();
      this.isProcessing = false;
      this.promptSkin.setOverlayVisible(true);
      this.uiAdapter.endProcessing('Ready for prompts');
      this.setIdleStatus();
      display.newLine();
    }
  }

  private async awaitPendingCleanup(): Promise<void> {
    if (!this.pendingCleanup) {
      return;
    }
    try {
      await this.pendingCleanup;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      display.showWarning(`Context cleanup failed: ${message}`);
    } finally {
      this.pendingCleanup = null;
    }
  }

  private rebuildAgent(): boolean {
    const previousHistory = this.agent ? this.agent.getHistory() : this.cachedHistory;
    try {
      ensureSecretForProvider(this.sessionState.provider);
      this.runtimeSession.updateToolContext(this.sessionState);
      const selection: ModelSelection = {
        provider: this.sessionState.provider,
        model: this.sessionState.model,
        temperature: this.sessionState.temperature,
        maxTokens: this.sessionState.maxTokens,
        systemPrompt: this.buildSystemPrompt(),
        reasoningEffort: this.sessionState.reasoningEffort,
      };

      this.agent = this.runtimeSession.createAgent(selection, {
        onAssistantMessage: (content, metadata) => {
          const enriched = this.buildDisplayMetadata(metadata);

          // Update spinner based on message type
          if (metadata.isFinal) {
            const parsed = this.splitThinkingResponse(content);
            if (parsed?.thinking) {
              const summary = this.extractThoughtSummary(parsed.thinking);
              if (summary) {
                display.updateThinking(`💭 ${summary}`);
              }
              display.showAssistantMessage(parsed.thinking, { ...enriched, isFinal: false });
            }
            display.updateThinking('Formulating response...');
            const finalContent = parsed?.response?.trim() || content;
            if (finalContent) {
              display.showAssistantMessage(finalContent, enriched);
            }
          } else {
            // Thought/reasoning - extract key insight for spinner
            const thoughtSummary = this.extractThoughtSummary(content);
            if (thoughtSummary) {
              display.updateThinking(`💭 ${thoughtSummary}`);
            }
            display.showAssistantMessage(content, enriched);
            return;
          }

          const cleanup = this.handleContextTelemetry(metadata, enriched);
          if (cleanup) {
            this.pendingCleanup = cleanup;
          }
        },
      });
      const historyToLoad =
        (this.pendingHistoryLoad && this.pendingHistoryLoad.length
          ? this.pendingHistoryLoad
          : previousHistory && previousHistory.length
            ? previousHistory
            : null) ?? null;
      if (historyToLoad && historyToLoad.length) {
        this.agent.loadHistory(historyToLoad);
        this.cachedHistory = historyToLoad;
      } else {
        this.cachedHistory = [];
      }
      this.pendingHistoryLoad = null;
      this.showSessionResumeNotice();
      return true;
    } catch (error) {
      this.agent = null;
      this.handleAgentSetupError(error, () => this.rebuildAgent(), this.sessionState.provider);
      return false;
    }
  }

  private buildSystemPrompt(): string {
    const providerLabel = this.providerLabel(this.sessionState.provider);
    const lines = [
      this.baseSystemPrompt.trim(),
      '',
      'ACTIVE RUNTIME METADATA:',
      `- CLI profile: ${this.profileLabel} (${this.profile})`,
      `- Provider: ${providerLabel} (${this.sessionState.provider})`,
      `- Model: ${this.sessionState.model}`,
    ];

    if (typeof this.sessionState.temperature === 'number') {
      lines.push(`- Temperature: ${this.sessionState.temperature}`);
    }

    if (typeof this.sessionState.maxTokens === 'number') {
      lines.push(`- Max tokens: ${this.sessionState.maxTokens}`);
    }

    lines.push(
      '',
      'Use these values when describing your identity or answering model/provider questions. If anything feels stale, call the `profile_details` tool before responding.'
    );

    const thinkingDirective = this.buildThinkingDirective();
    if (thinkingDirective) {
      lines.push('', thinkingDirective);
    }

    return lines.join('\n').trim();
  }

  private buildThinkingDirective(): string | null {
    switch (this.thinkingMode) {
      case 'concise':
        return 'Concise thinking mode is enabled: respond directly with the final answer and skip <thinking> blocks unless the user explicitly asks for your reasoning.';
      case 'extended':
        return [
          'Extended thinking mode is enabled. Format every reply as:',
          '<thinking>',
          'Detailed multi-step reasoning (reference tool runs/files when relevant, keep secrets redacted, no code blocks unless citing filenames).',
          '</thinking>',
          '<response>',
          'Final answer with actionable next steps and any code/commands requested.',
          '</response>',
        ].join('\n');
      case 'balanced':
      default:
        return 'Balanced thinking mode: include a short <thinking>...</thinking> block before <response> when the reasoning is non-trivial; skip it for simple answers.';
    }
  }

  private buildDisplayMetadata(metadata: AssistantMessageMetadata): DisplayMessageMetadata {
    return {
      ...metadata,
      contextWindowTokens: this.activeContextWindowTokens,
    };
  }

  private handleContextTelemetry(
    metadata: AssistantMessageMetadata,
    displayMetadata: DisplayMessageMetadata
  ): Promise<void> | null {
    if (!metadata.isFinal) {
      return null;
    }
    const windowTokens = displayMetadata.contextWindowTokens;
    if (!windowTokens || windowTokens <= 0) {
      return null;
    }
    const total = this.totalTokens(metadata.usage);
    if (total === null) {
      return null;
    }
    const usageRatio = total / windowTokens;

    // Always update context usage in the UI
    const percentUsed = Math.round(usageRatio * 100);
    this.uiAdapter.updateContextUsage(percentUsed);

    if (usageRatio < CONTEXT_USAGE_THRESHOLD) {
      return null;
    }
    if (!this.agent || this.cleanupInProgress) {
      return null;
    }
    return this.runContextCleanup(windowTokens, total);
  }

  private totalTokens(usage?: ProviderUsage | null): number | null {
    if (!usage) {
      return null;
    }
    if (typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)) {
      return usage.totalTokens;
    }
    const input = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0;
    const output = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0;
    const sum = input + output;
    return sum > 0 ? sum : null;
  }

  private async runContextCleanup(windowTokens: number, totalTokens: number): Promise<void> {
    if (!this.agent) {
      return;
    }
    this.cleanupInProgress = true;
    const cleanupStatusId = 'context-cleanup';
    let cleanupOverlayActive = false;
    try {
      const history = this.agent.getHistory();
      const { system, conversation } = this.partitionHistory(history);
      if (!conversation.length) {
        return;
      }

      const preserveCount = Math.min(conversation.length, CONTEXT_RECENT_MESSAGE_COUNT);
      const preserved = conversation.slice(conversation.length - preserveCount);
      const toSummarize = conversation.slice(0, conversation.length - preserveCount);
      if (!toSummarize.length) {
        return;
      }
      cleanupOverlayActive = true;
      this.statusTracker.pushOverride(cleanupStatusId, 'Running context cleanup', {
        detail: `Summarizing ${toSummarize.length} earlier messages`,
        tone: 'warning',
      });

      const percentUsed = Math.round((totalTokens / windowTokens) * 100);

      // Update context usage in unified UI
      this.uiAdapter.updateContextUsage(percentUsed);

      display.showSystemMessage(
        [
          `Context usage: ${totalTokens.toLocaleString('en-US')} of ${windowTokens.toLocaleString('en-US')} tokens`,
          `(${percentUsed}% full). Running automatic cleanup...`,
        ].join(' ')
      );

      const summary = await this.buildContextSummary(toSummarize);
      if (!summary) {
        throw new Error('Summary could not be generated.');
      }

      const trimmed = this.buildTrimmedHistory(system, summary, preserved);
      this.agent.loadHistory(trimmed);

      display.showSystemMessage(
        `Context cleanup complete. Summarized ${toSummarize.length} earlier messages and preserved the latest ${preserved.length}.`
      );
    } finally {
      if (cleanupOverlayActive) {
        this.statusTracker.clearOverride(cleanupStatusId);
      }
      this.cleanupInProgress = false;
    }
  }

  private partitionHistory(history: ConversationMessage[]): {
    system: ConversationMessage[];
    conversation: ConversationMessage[];
  } {
    const system: ConversationMessage[] = [];
    const conversation: ConversationMessage[] = [];
    for (const message of history) {
      if (message.role === 'system') {
        if (system.length === 0) {
          system.push(message);
        }
        continue;
      }
      conversation.push(message);
    }
    return { system, conversation };
  }

  private async buildContextSummary(messages: ConversationMessage[]): Promise<string | null> {
    const chunks = this.buildSummaryChunks(messages);
    if (!chunks.length) {
      return null;
    }

    const summarizer = this.runtimeSession.createAgent(
      {
        provider: this.sessionState.provider,
        model: this.sessionState.model,
        temperature: 0,
        maxTokens: Math.min(this.sessionState.maxTokens ?? CONTEXT_CLEANUP_MAX_OUTPUT_TOKENS, CONTEXT_CLEANUP_MAX_OUTPUT_TOKENS),
        systemPrompt: CONTEXT_CLEANUP_SYSTEM_PROMPT,
      },
      {}
    );

    let runningSummary = '';
    for (const chunk of chunks) {
      const prompt = this.buildSummaryPrompt(chunk, runningSummary);
      runningSummary = (await summarizer.send(prompt)).trim();
      summarizer.clearHistory();
    }

    return runningSummary || null;
  }

  private buildSummaryChunks(messages: ConversationMessage[]): string[] {
    const serialized = messages.map((message) => this.serializeMessage(message)).filter((text) => text.length > 0);
    if (!serialized.length) {
      return [];
    }

    const chunks: string[] = [];
    let buffer = '';

    for (const entry of serialized) {
      const segment = buffer ? `\n\n${entry}` : entry;
      if (buffer && buffer.length + segment.length > CONTEXT_CLEANUP_CHARS_PER_CHUNK) {
        chunks.push(buffer.trim());
        buffer = entry;
        continue;
      }
      buffer += buffer ? `\n\n${entry}` : entry;
    }

    if (buffer.trim()) {
      chunks.push(buffer.trim());
    }

    return chunks;
  }

  private serializeMessage(message: ConversationMessage): string {
    const role = this.describeRole(message);
    const parts: string[] = [`${role}:`];
    const content = message.content?.trim() ?? '';
    if (content) {
      parts.push(content);
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      parts.push(
        'Tool calls:',
        ...message.toolCalls.map((call) => {
          const args = JSON.stringify(call.arguments ?? {});
          return `- ${call.name} ${args}`;
        })
      );
    }
    return parts.join('\n').trim();
  }

  private describeRole(message: ConversationMessage): string {
    switch (message.role) {
      case 'assistant':
        return 'Assistant';
      case 'user':
        return 'User';
      case 'tool':
        return `Tool(${message.name ?? message.toolCallId ?? 'result'})`;
      case 'system':
      default:
        return 'System';
    }
  }

  private buildSummaryPrompt(chunk: string, existingSummary: string): string {
    const sections: string[] = [];
    if (existingSummary) {
      sections.push(`Existing summary:\n${existingSummary}`);
    }
    sections.push(`Conversation chunk:\n${chunk}`);
    sections.push(
      [
        'Instructions:',
        '- Merge the chunk into the running summary.',
        '- Preserve critical TODOs, bugs, test gaps, and file references.',
        '- Call out what is resolved vs. still pending.',
        '- Keep the output concise (<= 200 words) using short headings or bullets.',
      ].join('\n')
    );
    return sections.join('\n\n');
  }

  private buildTrimmedHistory(
    systemMessages: ConversationMessage[],
    summary: string,
    preserved: ConversationMessage[]
  ): ConversationMessage[] {
    const history: ConversationMessage[] = [];
    if (systemMessages.length > 0) {
      history.push(systemMessages[0]!);
    } else {
      history.push({ role: 'system', content: this.buildSystemPrompt() });
    }

    history.push({
      role: 'system',
      content: [
        'Condensed context summary (auto cleanup):',
        summary.trim(),
        `Last updated: ${new Date().toISOString()}`,
      ].join('\n\n'),
    });

    history.push(...preserved);
    return history;
  }

  private handleAgentSetupError(
    error: unknown,
    retryAction?: () => unknown | Promise<unknown>,
    providerOverride?: ProviderId | null
  ): void {
    this.pendingInteraction = null;

    const provider = providerOverride ?? this.sessionState.provider;
    const apiKeyIssue = detectApiKeyError(error, provider);
    if (apiKeyIssue) {
      this.handleApiKeyIssue(apiKeyIssue, retryAction);
      return;
    }

    this.pendingSecretRetry = null;
    const message = error instanceof Error ? error.message : String(error);
    display.showError(message);
  }

  private handleProviderError(
    error: unknown,
    retryAction?: () => unknown | Promise<unknown>
  ): boolean {
    const apiKeyIssue = detectApiKeyError(error, this.sessionState.provider);
    if (!apiKeyIssue) {
      return false;
    }

    this.handleApiKeyIssue(apiKeyIssue, retryAction);
    return true;
  }

  private handleApiKeyIssue(info: ApiKeyErrorInfo, retryAction?: () => unknown | Promise<unknown>): void {
    const secret = info.secret ?? null;
    const providerLabel = info.provider ? this.providerLabel(info.provider) : 'the selected provider';

    if (!secret) {
      this.pendingSecretRetry = null;
      const guidance =
        'Run "/secrets" to configure the required API key or export it (e.g., EXPORT KEY=value) before launching the CLI.';
      const baseMessage =
        info.type === 'missing'
          ? `An API key is required before using ${providerLabel}.`
          : `API authentication failed for ${providerLabel}.`;
      display.showWarning(`${baseMessage} ${guidance}`.trim());
      return;
    }

    const isMissing = info.type === 'missing';
    if (!isMissing && info.message && info.message.trim()) {
      display.showWarning(info.message.trim());
    }

    const prefix = isMissing
      ? `${secret.label} is required before you can use ${providerLabel}.`
      : `${secret.label} appears to be invalid for ${providerLabel}.`;

    display.showWarning(prefix);
    this.pendingSecretRetry = retryAction ?? null;
    this.pendingInteraction = { type: 'secret-input', secret };
    this.showSecretGuidance(secret, isMissing);
  }

  private showSecretGuidance(secret: SecretDefinition, promptForInput: boolean): void {
    const lines: string[] = [];
    if (promptForInput) {
      lines.push(`Enter a new value for ${secret.label} or type "cancel".`);
    } else {
      lines.push(`Update the stored value for ${secret.label} or type "cancel".`);
    }
    lines.push(
      `Tip: run "/secrets" anytime to manage credentials or export ${secret.envVar}=<value> before launching the CLI.`
    );
    display.showSystemMessage(lines.join('\n'));
  }

  private colorizeDropdownLine(text: string, index: number): string {
    if (!DROPDOWN_COLORS.length) {
      return text;
    }
    const color = DROPDOWN_COLORS[index % DROPDOWN_COLORS.length]!;
    return color(text);
  }

  private findModelPreset(modelId: string): ModelPreset | undefined {
    return MODEL_PRESETS.find((preset) => preset.id === modelId);
  }

  private applyPresetReasoningDefaults(): void {
    if (this.sessionState.reasoningEffort) {
      return;
    }
    const preset = this.findModelPreset(this.sessionState.model);
    if (preset?.reasoningEffort) {
      this.sessionState.reasoningEffort = preset.reasoningEffort;
    }
  }

  private refreshBannerSessionInfo(): void {
    const nextState = {
      model: this.sessionState.model,
      provider: this.sessionState.provider,
    };

    const previous = this.bannerSessionState;
    if (previous && previous.model === nextState.model && previous.provider === nextState.provider) {
      return;
    }

    this.refreshContextGauge();
    display.updateSessionInfo(nextState.model, nextState.provider);
    if (!this.isProcessing) {
      this.setIdleStatus();
    }
    this.bannerSessionState = nextState;
  }

  private providerLabel(id: ProviderId): string {
    return PROVIDER_LABELS[id] ?? id;
  }

  private agentMenuLabel(name: ProfileName): string {
    if (!this.agentMenu) {
      return name;
    }
    const entry = this.agentMenu.options.find((option) => option.name === name);
    return entry?.label ?? name;
  }

  private extractThoughtSummary(thought: string): string | null {
    // Extract first non-empty line
    const lines = thought?.split('\n').filter(line => line.trim()) ?? [];
    if (!lines.length) {
      return null;
    }

    // Remove common thought prefixes
    const cleaned = lines[0]!
      .trim()
      .replace(/^(Thinking|Analyzing|Considering|Looking at|Let me)[:.\s]+/i, '')
      .replace(/^I (should|need to|will|am)[:.\s]+/i, '')
      .trim();

    if (!cleaned) {
      return null;
    }

    // Truncate to reasonable length
    const maxLength = 50;
    return cleaned.length > maxLength
      ? cleaned.slice(0, maxLength - 3) + '...'
      : cleaned;
  }

  private splitThinkingResponse(content: string): { thinking: string | null; response: string } | null {
    if (!content?.includes('<thinking') && !content?.includes('<response')) {
      return null;
    }
    const thinkingMatch = /<thinking>([\s\S]*?)<\/thinking>/i.exec(content);
    const responseMatch = /<response>([\s\S]*?)<\/response>/i.exec(content);
    if (!thinkingMatch && !responseMatch) {
      return null;
    }
    const thinkingBody = thinkingMatch?.[1]?.trim() ?? null;
    let responseBody = responseMatch?.[1]?.trim();
    if (!responseBody) {
      responseBody = content
        .replace(thinkingMatch?.[0] ?? '', '')
        .replace(/<\/?response>/gi, '')
        .trim();
    }
    return {
      thinking: thinkingBody && thinkingBody.length ? thinkingBody : null,
      response: responseBody ?? '',
    };
  }

  private persistSessionPreference(): void {
    saveModelPreference(this.profile, {
      provider: this.sessionState.provider,
      model: this.sessionState.model,
      temperature: this.sessionState.temperature,
      maxTokens: this.sessionState.maxTokens,
      reasoningEffort: this.sessionState.reasoningEffort,
    });
  }

  private enableBracketedPasteMode(): boolean {
    if (!input.isTTY || !output.isTTY) {
      return false;
    }

    try {
      output.write(BRACKETED_PASTE_ENABLE);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      display.showWarning(`Unable to enable bracketed paste: ${message}`);
      return false;
    }
  }

  private disableBracketedPasteMode(): void {
    if (!this.bracketedPasteEnabled || !output.isTTY) {
      return;
    }

    try {
      output.write(BRACKETED_PASTE_DISABLE);
    } finally {
      this.bracketedPasteEnabled = false;
      this.bracketedPaste.reset();
    }
  }
}

function setsEqual<T>(first: Set<T>, second: Set<T>): boolean {
  if (first.size !== second.size) {
    return false;
  }
  for (const entry of first) {
    if (!second.has(entry)) {
      return false;
    }
  }
  return true;
}
