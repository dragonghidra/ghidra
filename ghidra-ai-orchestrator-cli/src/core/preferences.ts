import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderId, ReasoningEffortLevel } from './types.js';
import type { ProfileName } from '../config.js';
import { resolveDataDir } from './brand.js';

const CONFIG_DIR = resolveDataDir();
const SETTINGS_PATH = join(CONFIG_DIR, 'settings.json');
const CURRENT_VERSION = 2;

export interface PersistedModelPreference {
  provider: ProviderId;
  model: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffortLevel;
}

interface ToolSettingsSection {
  enabledTools?: string[];
}

interface SettingsFile {
  version: number;
  profiles: Partial<Record<ProfileName, PersistedModelPreference>>;
  tools?: ToolSettingsSection;
  activeProfile?: ProfileName;
  session?: SessionPreferenceSection;
}

interface SessionPreferenceSection {
  autosave?: boolean;
  autoResume?: boolean;
  lastSessionId?: string;
  thinkingMode?: ThinkingMode;
}

export interface ToolSettings {
  enabledTools: string[];
}

export type ThinkingMode = 'concise' | 'balanced' | 'extended';

export interface SessionPreferences {
  autosave: boolean;
  autoResume: boolean;
  lastSessionId: string | null;
  thinkingMode: ThinkingMode;
}

export function loadActiveProfilePreference(): ProfileName | null {
  const payload = readSettingsFile();
  if (!payload?.activeProfile) {
    return null;
  }
  return normalizeProfileNameValue(payload.activeProfile);
}

export function saveActiveProfilePreference(profile: ProfileName): void {
  const normalized = normalizeProfileNameValue(profile);
  if (!normalized) {
    return;
  }
  const payload = readSettingsFile() ?? { version: CURRENT_VERSION, profiles: {} };
  payload.version = CURRENT_VERSION;
  payload.profiles = payload.profiles ?? {};
  payload.activeProfile = normalized;
  writeSettingsFile(payload);
}

export function clearActiveProfilePreference(): void {
  const payload = readSettingsFile();
  if (!payload?.activeProfile) {
    return;
  }
  payload.version = CURRENT_VERSION;
  payload.profiles = payload.profiles ?? {};
  delete payload.activeProfile;
  writeSettingsFile(payload);
}

export function loadModelPreference(profile: ProfileName): PersistedModelPreference | null {
  const payload = readSettingsFile();
  if (!payload) {
    return null;
  }
  const entry = payload.profiles?.[profile];
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  if (typeof entry.provider !== 'string' || typeof entry.model !== 'string') {
    return null;
  }
  return { ...entry };
}

export function saveModelPreference(
  profile: ProfileName,
  preference: PersistedModelPreference
): void {
  const payload = readSettingsFile() ?? { version: CURRENT_VERSION, profiles: {} };
  payload.version = CURRENT_VERSION;
  payload.profiles = payload.profiles ?? {};
  payload.profiles[profile] = { ...preference };
  writeSettingsFile(payload);
}

export function loadToolSettings(): ToolSettings | null {
  const payload = readSettingsFile();
  if (!payload?.tools) {
    return null;
  }
  const enabledTools = normalizeToolIds(payload.tools.enabledTools);
  return { enabledTools };
}

export function saveToolSettings(settings: ToolSettings): void {
  const payload = readSettingsFile() ?? { version: CURRENT_VERSION, profiles: {} };
  payload.version = CURRENT_VERSION;
  payload.profiles = payload.profiles ?? {};
  payload.tools = {
    enabledTools: normalizeToolIds(settings.enabledTools),
  };
  writeSettingsFile(payload);
}

export function clearToolSettings(): void {
  const payload = readSettingsFile();
  if (!payload) {
    return;
  }
  payload.version = CURRENT_VERSION;
  payload.profiles = payload.profiles ?? {};
  if (payload.tools) {
    delete payload.tools;
  }
  writeSettingsFile(payload);
}

export function loadSessionPreferences(): SessionPreferences {
  const payload = readSettingsFile();
  const section = payload?.session;
  return {
    autosave: typeof section?.autosave === 'boolean' ? section.autosave : true,
    autoResume: typeof section?.autoResume === 'boolean' ? section.autoResume : true,
    lastSessionId:
      typeof section?.lastSessionId === 'string' && section.lastSessionId.trim()
        ? section.lastSessionId.trim()
        : null,
    thinkingMode: parseThinkingMode(section?.thinkingMode),
  };
}

export function saveSessionPreferences(preferences: Partial<SessionPreferences>): void {
  const payload = readSettingsFile() ?? { version: CURRENT_VERSION, profiles: {} };
  payload.version = CURRENT_VERSION;
  payload.profiles = payload.profiles ?? {};
  const section = payload.session ?? {};

  if (typeof preferences.autosave === 'boolean') {
    section.autosave = preferences.autosave;
  }
  if (typeof preferences.autoResume === 'boolean') {
    section.autoResume = preferences.autoResume;
  }
  if ('lastSessionId' in preferences) {
    section.lastSessionId = preferences.lastSessionId ?? undefined;
  }
  if (preferences.thinkingMode) {
    section.thinkingMode = preferences.thinkingMode;
  }

  payload.session = section;
  writeSettingsFile(payload);
}

function readSettingsFile(): SettingsFile | null {
  try {
    if (!existsSync(SETTINGS_PATH)) {
      return null;
    }
    const raw = readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const profiles =
      typeof parsed.profiles === 'object' && parsed.profiles !== null ? parsed.profiles : {};
    const payload: SettingsFile = {
      version: typeof parsed.version === 'number' ? parsed.version : CURRENT_VERSION,
      profiles,
    };
    const tools = parseToolSettings(parsed.tools);
    if (tools) {
      payload.tools = tools;
    }
    const session = parseSessionPreferences(parsed.session);
    if (session) {
      payload.session = session;
    }
    const rawProfile =
      typeof parsed.activeProfile === 'string' && parsed.activeProfile.trim()
        ? (parsed.activeProfile.trim() as ProfileName)
        : undefined;
    if (rawProfile) {
      payload.activeProfile = rawProfile;
    }
    return payload;
  } catch {
    return null;
  }
}

function writeSettingsFile(payload: SettingsFile): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(SETTINGS_PATH, JSON.stringify(payload, null, 2));
  } catch {
  }
}

function parseToolSettings(value: unknown): ToolSettingsSection | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as ToolSettingsSection;
  if (!Array.isArray(record.enabledTools)) {
    return { enabledTools: [] };
  }
  return { enabledTools: normalizeToolIds(record.enabledTools) };
}

function parseSessionPreferences(value: unknown): SessionPreferenceSection | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as SessionPreferenceSection;
  const section: SessionPreferenceSection = {};
  if (typeof record.autosave === 'boolean') {
    section.autosave = record.autosave;
  }
  if (typeof record.autoResume === 'boolean') {
    section.autoResume = record.autoResume;
  }
  if (typeof record.lastSessionId === 'string' && record.lastSessionId.trim()) {
    section.lastSessionId = record.lastSessionId.trim();
  }
  if (record.thinkingMode) {
    section.thinkingMode = parseThinkingMode(record.thinkingMode);
  }
  return section;
}

function parseThinkingMode(value: unknown): ThinkingMode {
  if (value === 'concise' || value === 'extended' || value === 'balanced') {
    return value;
  }
  return 'balanced';
}

function normalizeToolIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of ids) {
    if (typeof entry !== 'string') {
      continue;
    }
    const id = entry.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

function normalizeProfileNameValue(value: unknown): ProfileName | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed as ProfileName;
}
