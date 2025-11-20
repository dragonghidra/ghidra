import { exit } from 'node:process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../config.js';
import type { ProfileName } from '../config.js';
import { buildWorkspaceContext, resolveWorkspaceCaptureOptions } from '../workspace.js';
import { type ToolRuntimeObserver } from '../core/toolRuntime.js';
import type { ToolCallRequest } from '../core/types.js';
import { InteractiveShell } from './interactiveShell.js';
import { display } from '../ui/display.js';
import {
  loadActiveProfilePreference,
  loadModelPreference,
  loadToolSettings,
} from '../core/preferences.js';
import type { ModelSelection } from '../runtime/agentSession.js';
import { createNodeRuntime } from '../runtime/node.js';
import {
  buildEnabledToolSet,
  evaluateToolPermissions,
  isPluginEnabled,
  type ToolLoadWarning,
} from '../capabilities/toolRegistry.js';
import type { ToolPlugin } from '../plugins/tools/index.js';
import { listAgentProfiles, hasAgentProfile } from '../core/agentProfiles.js';
import { maybeOfferCliUpdate } from './updateManager.js';
import { LiveStatusTracker, type LiveStatusTone } from './liveStatus.js';
import { buildInteractiveSystemPrompt } from './systemPrompt.js';
import { ShellUIAdapter } from '../ui/ShellUIAdapter.js';
import { stdout } from 'node:process';
import { resolveProfileOverride } from '../core/brand.js';

export interface LaunchShellOptions {
  enableProfileSelection?: boolean;
}

/**
 * Launch the interactive shell with full capability awareness for the selected profile.
 */
export async function launchShell(
  defaultProfile: ProfileName,
  options: LaunchShellOptions = {}
): Promise<void> {
  try {
    const { profileOverride, promptArgs } = parseLaunchArguments(process.argv.slice(2));
    const envProfileOverride = resolveProfileOverride();
    const allowProfileSelection = Boolean(options.enableProfileSelection);
    const availableProfiles = listAgentProfiles();
    const rawSavedProfile = allowProfileSelection ? loadActiveProfilePreference() : null;
    const savedProfile =
      rawSavedProfile && hasAgentProfile(rawSavedProfile) ? rawSavedProfile : null;
    const profile = resolveLaunchProfile({
      defaultProfile,
      availableProfiles,
      cliOverride: profileOverride,
      envOverride: envProfileOverride,
      savedProfile,
      allowSavedProfile: allowProfileSelection,
    });

    const workingDir = process.cwd();

    const workspaceOptions = resolveWorkspaceCaptureOptions(process.env);
    const workspaceContext = buildWorkspaceContext(workingDir, workspaceOptions);

    const statusTracker = new LiveStatusTracker();

    // Create unified UI adapter early to get the tool observer
    const uiAdapter = new ShellUIAdapter(stdout, display, {
      useUnifiedUI: true,
      preserveCompatibility: true,
      enableTelemetry: true,
      debugMode: false,
    });

    // Use the unified UI adapter's tool observer instead of the legacy one
    const toolObserver = uiAdapter.createToolObserver();

    const toolSettings = loadToolSettings();
    const toolSelection = buildEnabledToolSet(toolSettings);
    const permissionSummary = evaluateToolPermissions(toolSelection);
    const pluginFilter = (plugin: ToolPlugin): boolean =>
      isPluginEnabled(plugin.id, permissionSummary.allowedPluginIds);

    const runtime = await createNodeRuntime({
      profile,
      workspaceContext,
      workingDir,
      toolObserver,
      adapterOptions: {
        filter: pluginFilter,
      },
    });

    const session = runtime.session;

    const profileConfig = session.profileConfig;
    const providerTools = session.toolRuntime.listProviderTools();

    const persistedSelection =
      profileConfig.modelLocked || profileConfig.providerLocked
        ? null
        : loadModelPreference(profile);

    const initialModel: ModelSelection = persistedSelection ?? {
      provider: profileConfig.provider,
      model: profileConfig.model,
      temperature: profileConfig.temperature,
      maxTokens: profileConfig.maxTokens,
    };

    const enhancedSystemPrompt = buildInteractiveSystemPrompt(
      profileConfig.systemPrompt,
      profileConfig.label,
      providerTools
    );

    const version = readPackageVersion();

    display.showWelcome(
      profileConfig.label,
      profile,
      initialModel.model,
      initialModel.provider,
      workingDir,
      version
    );

    display.showAvailableTools(providerTools);

    const continueLaunch = await maybeOfferCliUpdate(version);
    if (!continueLaunch) {
      return;
    }

    if (permissionSummary.warnings.length) {
      reportSkippedTools(permissionSummary.warnings);
    }

    const agentSelection = allowProfileSelection
      ? {
          defaultProfile,
          persistedProfile: savedProfile,
          options: availableProfiles,
        }
      : undefined;

    const shell = new InteractiveShell({
      profile,
      profileLabel: profileConfig.label,
      workingDir,
      session,
      baseSystemPrompt: enhancedSystemPrompt,
      initialModel,
      agentSelection,
      statusTracker,
      uiAdapter,
      workspaceOptions,
    });

    const initialPrompt = promptArgs.join(' ').trim();
    await shell.start(initialPrompt || undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    display.showError(message);
    exit(1);
  }
}

interface ParsedLaunchArguments {
  profileOverride: string | null;
  promptArgs: string[];
}

interface ProfileResolutionInput {
  defaultProfile: ProfileName;
  availableProfiles: ReturnType<typeof listAgentProfiles>;
  cliOverride: string | null;
  envOverride: string | null;
  savedProfile: ProfileName | null;
  allowSavedProfile: boolean;
}

function parseLaunchArguments(argv: string[]): ParsedLaunchArguments {
  const promptArgs: string[] = [];
  let override: string | null = null;

  const expectValue = (flag: string, value: string | undefined): string => {
    if (value && value.trim()) {
      return value.trim();
    }
    throw new Error(`Missing value for ${flag}.`);
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    if (token === '--profile' || token === '-p') {
      const value = expectValue(token, argv[index + 1]);
      override = value;
      index += 1;
      continue;
    }

    if (token.startsWith('--profile=')) {
      const [, candidate] = token.split('=');
      if (!candidate?.trim()) {
        throw new Error('Missing value for --profile.');
      }
      override = candidate.trim();
      continue;
    }

    promptArgs.push(token);
  }

  return {
    profileOverride: override,
    promptArgs,
  };
}

function resolveLaunchProfile(input: ProfileResolutionInput): ProfileName {
  if (input.cliOverride) {
    const resolved = matchProfile(input.cliOverride, input.availableProfiles);
    if (!resolved) {
      throw new Error(
        `Unknown agent profile "${input.cliOverride}". Run "/agents" to view available options.`
      );
    }
    return resolved;
  }

  if (input.envOverride?.trim()) {
    const resolved = matchProfile(input.envOverride, input.availableProfiles);
    if (!resolved) {
      throw new Error(
        `Unknown agent profile "${input.envOverride}" provided via APT_PROFILE.`
      );
    }
    return resolved;
  }

  if (input.allowSavedProfile) {
    const saved = matchProfile(input.savedProfile, input.availableProfiles);
    if (saved) {
      return saved;
    }
  }

  const fallback = matchProfile(input.defaultProfile, input.availableProfiles);
  if (fallback) {
    return fallback;
  }

  throw new Error('No registered CLI profile is available.');
}

function matchProfile(
  candidate: string | null | undefined,
  availableProfiles: ReturnType<typeof listAgentProfiles>
): ProfileName | null {
  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  if (hasAgentProfile(trimmed as ProfileName)) {
    return trimmed as ProfileName;
  }

  const lower = trimmed.toLowerCase();
  const match = availableProfiles.find((profile) => profile.name.toLowerCase() === lower);
  return match ? (match.name as ProfileName) : null;
}

function reportSkippedTools(entries: ToolLoadWarning[]): void {
  for (const warning of entries) {
    const details =
      warning.reason === 'missing-secret' && warning.secretId
        ? `missing ${warning.secretId}`
        : warning.reason;
    const suffix = warning.secretId ? ' (use /secrets to configure it)' : '';
    display.showWarning(`Skipped ${warning.label} — ${details}${suffix}`);
  }
}

function readPackageVersion(): string {
  try {
    const filePath = fileURLToPath(import.meta.url);
    const packagePath = resolve(dirname(filePath), '../../package.json');
    const payload = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
    return typeof payload.version === 'string' ? payload.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * @deprecated This function is replaced by ShellUIAdapter.createToolObserver()
 * which provides unified UI integration. Kept for backward compatibility.
 */
// @ts-expect-error - Legacy function kept for reference, not currently used
function createToolObserver(root: string, statusTracker: LiveStatusTracker): ToolRuntimeObserver {
  const inflight = new Map<string, string>();

  const popTitle = (call: ToolCallRequest): string => {
    const title = inflight.get(call.id);
    inflight.delete(call.id);
    return title ?? formatToolTitle(call, root);
  };

  const statusId = (call: ToolCallRequest): string => `tool:${call.id}`;

  const clearStatus = (call: ToolCallRequest) => {
    statusTracker.clearOverride(statusId(call));
  };

  return {
    onToolStart: (call) => {
      inflight.set(call.id, formatToolTitle(call, root));
      const overlay = describeToolOverlay(call, root);
      statusTracker.pushOverride(statusId(call), overlay.text, {
        detail: overlay.detail,
        tone: overlay.tone,
      });
    },
    onToolResult: (call, output) => {
      const summary = summarizeToolResult(call, output);
      const title = popTitle(call);
      clearStatus(call);
      display.showAction(title, 'success');
      if (summary) {
        display.showSubAction(summary, 'success');
      }
    },
    onToolError: (call, message) => {
      const title = popTitle(call);
      clearStatus(call);
      display.showAction(title, 'error');
      display.showSubAction(message, 'error');
    },
  };
}

function formatToolTitle(call: ToolCallRequest, root: string): string {
  const getPath = (): string => {
    const value = stringArg(call.arguments?.['path']);
    return formatPath(value, root);
  };

  const getCommand = (): string => {
    return truncate(stringArg(call.arguments?.['command']), 32);
  };

  switch (call.name) {
    case 'read_file':
      return `Read(${getPath()})`;
    case 'write_file':
      return `Write(${getPath()})`;
    case 'list_files':
      return `List(${getPath() || '.'})`;
    case 'search_files':
      return `Search(${stringArg(call.arguments?.['pattern'], '*')})`;
    case 'grep_search':
      return `Grep(${stringArg(call.arguments?.['pattern'])})`;
    case 'find_definition':
      return `Find(${stringArg(call.arguments?.['name'])})`;
    case 'execute_bash':
      return `Bash(${getCommand()})`;
    case 'context_snapshot':
      return 'ContextSnapshot';
    case 'capabilities_overview':
      return 'CapabilitiesOverview';
    case 'profile_details':
      return 'ProfileDetails';
    default:
      return call.name;
  }
}

interface ToolOverlayDescription {
  text: string;
  detail?: string;
  tone?: LiveStatusTone;
}

function describeToolOverlay(call: ToolCallRequest, root: string): ToolOverlayDescription {
  const describePath = (): string => {
    const value = stringArg(call.arguments?.['path']);
    return formatPath(value, root) || '.';
  };

  const describePattern = (key: 'pattern' | 'name'): string => {
    const raw = stringArg(call.arguments?.[key]);
    return raw ? truncate(raw, 32) : key === 'pattern' ? 'pattern' : 'target';
  };

  const describeCommand = (): string => {
    const raw = stringArg(call.arguments?.['command']);
    return raw ? truncate(raw, 40) : 'shell command';
  };

  switch (call.name) {
    case 'read_file': {
      const path = describePath();
      return {
        text: `Reading ${path}`,
        detail: 'read_file tool running',
        tone: 'info',
      };
    }
    case 'write_file': {
      const path = describePath();
      return {
        text: `Writing ${path}`,
        detail: 'write_file tool running',
        tone: 'warning',
      };
    }
    case 'list_files': {
      const path = describePath();
      return {
        text: `Listing ${path}`,
        detail: 'list_files tool running',
        tone: 'info',
      };
    }
    case 'search_files': {
      const pattern = describePattern('pattern');
      return {
        text: `Searching files for ${pattern}`,
        detail: 'search_files tool running',
        tone: 'info',
      };
    }
    case 'grep_search': {
      const pattern = describePattern('pattern');
      return {
        text: `Grep search for ${pattern}`,
        detail: 'grep_search tool running',
        tone: 'info',
      };
    }
    case 'find_definition': {
      const name = describePattern('name');
      return {
        text: `Locating ${name}`,
        detail: 'find_definition tool running',
        tone: 'info',
      };
    }
    case 'execute_bash': {
      const command = describeCommand();
      return {
        text: `Running bash: ${command}`,
        detail: 'execute_bash tool running',
        tone: 'warning',
      };
    }
    case 'context_snapshot':
      return {
        text: 'Replaying workspace snapshot',
        detail: 'context_snapshot tool running',
        tone: 'info',
      };
    case 'capabilities_overview':
      return {
        text: 'Summarizing runtime capabilities',
        detail: 'capabilities_overview tool running',
        tone: 'info',
      };
    case 'profile_details':
      return {
        text: 'Describing profile metadata',
        detail: 'profile_details tool running',
        tone: 'info',
      };
    default:
      return {
        text: `Running ${call.name}`,
        detail: 'Tool execution in progress',
        tone: 'info',
      };
  }
}

function summarizeToolResult(call: ToolCallRequest, output: string): string {
  switch (call.name) {
    case 'read_file':
      return summarizeRead(output);
    case 'write_file':
      return summarizeWrite(output);
    case 'list_files':
      return summarizeList(output);
    case 'search_files':
      return matchOrFallback(output, /Found (\d+) files/i);
    case 'grep_search':
      return matchOrFallback(output, /Found (\d+) matches/i);
    case 'find_definition':
      return matchOrFallback(output, /No definitions found/i);
    case 'execute_bash':
      return summarizeBash(output);
    case 'context_snapshot':
      return 'Replayed cached workspace snapshot.';
    case 'capabilities_overview':
      return 'Described runtime guardrails.';
    case 'profile_details':
      return 'Returned active profile metadata.';
    default:
      return firstLine(output);
  }
}

function summarizeWrite(output: string): string {
  const normalized = output.trim();
  return normalized;
}

function summarizeRead(output: string): string {
  const separator = output.indexOf('\n\n');
  const body = separator >= 0 ? output.slice(separator + 2) : '';
  const lineCount = body ? body.split('\n').length : 0;
  return lineCount ? `Read ${lineCount} lines` : 'Read file contents';
}

function summarizeList(output: string): string {
  const [, ...rest] = output.split('\n');
  const entries = rest.filter((line) => line.trim()).length;
  return entries ? `Listed ${entries} entries` : 'Listed files';
}

function summarizeBash(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return 'Command completed (no output)';
  }
  const lines = trimmed.split('\n');
  const head = lines.slice(0, 3).join('\n');
  if (lines.length > 3) {
    return `${head}\n... +${lines.length - 3} more lines`;
  }
  return head;
}

function matchOrFallback(output: string, pattern: RegExp): string {
  const match = output.match(pattern);
  if (match?.[0]) {
    return match[0];
  }
  return firstLine(output);
}

function firstLine(output: string): string {
  const line = output.split('\n').find((entry) => entry.trim());
  return line ? truncate(line.trim(), 80) : '';
}

function formatPath(raw: string, root: string): string {
  if (!raw) return '.';
  if (raw.startsWith(root)) {
    const rel = relative(root, raw);
    return rel || '.';
  }
  return raw;
}

function truncate(value: string, max = 64): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function stringArg(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}
