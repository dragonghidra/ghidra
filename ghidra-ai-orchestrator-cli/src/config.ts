import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentProfileEntry, AgentProfileManifest } from './contracts/v1/agentProfileManifest.js';
import type { ProviderId } from './core/types.js';
import {
  registerAgentProfile,
  hasAgentProfile,
  getAgentProfile,
  type AgentProfileBlueprint,
  type ProfileName,
} from './core/agentProfiles.js';
import { buildAgentRulebookPrompt, loadAgentRulebook } from './core/agentRulebook.js';
import { getAgentProfileManifest } from './core/agentProfileManifest.js';

export type { ProfileName } from './core/agentProfiles.js';

export interface ResolvedProfileConfig {
  profile: ProfileName;
  label: string;
  provider: ProviderId;
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  modelLocked: boolean;
  providerLocked: boolean;
  rulebook: ProfileRulebookMetadata | null;
}

export interface ProfileRulebookMetadata {
  profile: ProfileName;
  label: string;
  version: string;
  contractVersion: string;
  description?: string;
  file: string;
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PROFILE_MANIFEST = getAgentProfileManifest();

const DEFAULT_PROFILES: AgentProfileBlueprint[] = PROFILE_MANIFEST.profiles.map((entry) =>
  normalizeProfileFromManifest(entry, PROFILE_MANIFEST, PACKAGE_ROOT)
);

for (const profile of DEFAULT_PROFILES) {
  if (!hasAgentProfile(profile.name)) {
    registerAgentProfile(profile);
  }
}

export function resolveProfileConfig(profile: ProfileName, workspaceContext: string | null): ResolvedProfileConfig {
  const blueprint = getAgentProfile(profile);

  const envPrefix = toEnvPrefix(blueprint.name);

  const modelEnv = process.env[`${envPrefix}_MODEL`];
  const modelLocked = typeof modelEnv === 'string' && modelEnv.trim().length > 0;
  const model = modelLocked ? modelEnv!.trim() : blueprint.defaultModel;

  const systemPrompt = process.env[`${envPrefix}_SYSTEM_PROMPT`] ?? blueprint.defaultSystemPrompt;

  const providerEnv = process.env[`${envPrefix}_PROVIDER`];
  const providerLocked = isProviderValue(providerEnv);
  const provider = providerLocked ? providerEnv!.trim() : blueprint.defaultProvider;
  const rulebook = loadRulebookMetadata(blueprint);

  const contextBlock = workspaceContext?.trim()
    ? `\n\nWorkspace context (auto-detected):\n${workspaceContext.trim()}`
    : '';

  const resolved: ResolvedProfileConfig = {
    profile,
    label: blueprint.label,
    provider,
    model,
    systemPrompt: `${systemPrompt.trim()}${contextBlock}`,
    modelLocked,
    providerLocked,
    rulebook,
  };

  if (typeof blueprint.temperature === 'number') {
    resolved.temperature = blueprint.temperature;
  }
  if (typeof blueprint.maxTokens === 'number') {
    resolved.maxTokens = blueprint.maxTokens;
  }

  return resolved;
}

function toEnvPrefix(profile: ProfileName): string {
  return profile
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_');
}

function isProviderValue(value: unknown): value is ProviderId {
  return typeof value === 'string' && value.trim().length > 0;
}

function loadRulebookMetadata(profile: AgentProfileBlueprint): ProfileRulebookMetadata | null {
  try {
    // Check if rulebook is inline
    const rulebookRef = profile.rulebook as any;
    const manifest = rulebookRef.inline
      ? loadAgentRulebook(profile.name, { inline: rulebookRef.inline })
      : loadAgentRulebook(profile.name, {
          root: PACKAGE_ROOT,
          file: rulebookRef.file,
        });

    return {
      profile: manifest.profile,
      label: manifest.label ?? manifest.profile,
      version: manifest.version,
      contractVersion: manifest.contractVersion,
      description: manifest.description ?? profile.rulebook.description,
      file: rulebookRef.file ?? '[inline]',
    };
  } catch {
    if (!profile.rulebook) {
      return null;
    }

    const rulebookRef = profile.rulebook as any;
    const fallback: ProfileRulebookMetadata = {
      profile: profile.name,
      label: profile.label,
      version: rulebookRef.version ?? 'unknown',
      contractVersion: rulebookRef.contractVersion ?? 'unknown',
      description: rulebookRef.description,
      file: rulebookRef.file ?? '[inline]',
    };

    return fallback;
  }
}

function normalizeProfileFromManifest(
  entry: AgentProfileEntry,
  manifest: AgentProfileManifest,
  root: string
): AgentProfileBlueprint {
  const defaultSystemPrompt = buildDefaultSystemPrompt(entry, root);

  return {
    name: entry.name,
    label: entry.label,
    description: entry.description,
    defaultProvider: entry.defaultProvider,
    defaultModel: entry.defaultModel,
    systemPromptConfig: entry.systemPrompt,
    defaultSystemPrompt,
    temperature: entry.temperature,
    maxTokens: entry.maxTokens,
    rulebook: entry.rulebook,
    manifestVersion: manifest.version,
    manifestContractVersion: manifest.contractVersion,
  };
}

function buildDefaultSystemPrompt(entry: AgentProfileEntry, root: string): string {
  try {
    const promptConfig = entry.systemPrompt;
    if (promptConfig.type === 'literal') {
      return promptConfig.content.trim();
    }

    const template = promptConfig.template?.trim() || '{{rulebook}}';
    // Check if rulebook is inline
    const rulebookRef = entry.rulebook as any;
    const rulebookPrompt = rulebookRef.inline
      ? buildAgentRulebookPrompt(entry.name, { inline: rulebookRef.inline }).trim()
      : buildAgentRulebookPrompt(entry.name, { root, file: rulebookRef.file }).trim();
    const replacements: Record<string, string> = {
      rulebook: rulebookPrompt,
      profile: entry.label || entry.name,
      profile_name: entry.name,
    };

    const rendered = template.replace(
      /\{\{\s*(rulebook|profile|profile_name)\s*\}\}/gi,
      (_match, token: string) => {
        const key = token.toLowerCase() as keyof typeof replacements;
        return replacements[key] ?? '';
      }
    );

    if (/\{\{\s*rulebook\s*\}\}/i.test(template)) {
      return rendered.trim();
    }

    const merged = rendered.trim();
    const suffix = merged ? `\n\n${rulebookPrompt}` : rulebookPrompt;
    return `${merged}${suffix}`.trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build system prompt for profile "${entry.name}": ${message}`);
  }
}
