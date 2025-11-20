import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ProviderId } from './types.js';

export type SecretName =
  | 'OPENAI_API_KEY'
  | 'ANTHROPIC_API_KEY'
  | 'DEEPSEEK_API_KEY'
  | 'XAI_API_KEY'
  | 'GEMINI_API_KEY'
  | 'BRAVE_SEARCH_API_KEY'
  | 'SERPAPI_API_KEY';

export interface SecretDefinition {
  id: SecretName;
  label: string;
  description: string;
  envVar: SecretName;
  providers: ProviderId[];
}

interface SecretStoreData {
  [key: string]: string | undefined;
}

const SECRET_DEFINITIONS: SecretDefinition[] = [
  {
    id: 'OPENAI_API_KEY',
    label: 'OpenAI API Key',
    description: 'Required to run OpenAI GPT and APT Code models.',
    envVar: 'OPENAI_API_KEY',
    providers: ['openai'],
  },
  {
    id: 'ANTHROPIC_API_KEY',
    label: 'Anthropic API Key',
    description: 'Required to run Anthropic Sonnet, Opus, or Haiku models.',
    envVar: 'ANTHROPIC_API_KEY',
    providers: ['anthropic'],
  },
  {
    id: 'DEEPSEEK_API_KEY',
    label: 'DeepSeek API Key',
    description: 'Required to run DeepSeek Reasoner or Chat models.',
    envVar: 'DEEPSEEK_API_KEY',
    providers: ['deepseek'],
  },
  {
    id: 'XAI_API_KEY',
    label: 'xAI API Key',
    description: 'Required to run Grok models from xAI.',
    envVar: 'XAI_API_KEY',
    providers: ['xai'],
  },
  {
    id: 'GEMINI_API_KEY',
    label: 'Google Gemini API Key',
    description: 'Required to run Gemini 2.5 Pro or Flash models.',
    envVar: 'GEMINI_API_KEY',
    providers: ['google'],
  },
  {
    id: 'BRAVE_SEARCH_API_KEY',
    label: 'Brave Search API Key',
    description: 'Optional: unlock WebSearch using the Brave Search API.',
    envVar: 'BRAVE_SEARCH_API_KEY',
    providers: [],
  },
  {
    id: 'SERPAPI_API_KEY',
    label: 'SerpAPI Key',
    description: 'Optional: fallback WebSearch provider via SerpAPI.',
    envVar: 'SERPAPI_API_KEY',
    providers: [],
  },
];

const envCodexHome = process.env['CODEX_HOME'];
const SECRET_DIR = envCodexHome ? resolve(envCodexHome) : join(homedir(), '.codex');
const SECRET_FILE = join(SECRET_DIR, 'secrets.json');

export class MissingSecretError extends Error {
  constructor(public readonly secret: SecretDefinition) {
    super(`${secret.label} is not configured.`);
    this.name = 'MissingSecretError';
  }
}

export function listSecretDefinitions(): SecretDefinition[] {
  return [...SECRET_DEFINITIONS];
}

export function getSecretValue(id: SecretName): string | null {
  const envValue = sanitize(process.env[id]);
  if (envValue) {
    return envValue;
  }

  const store = readSecretStore();
  const storedValue = sanitize(store[id]);
  if (!storedValue) {
    return null;
  }

  process.env[id] = storedValue;
  return storedValue;
}

export function setSecretValue(id: SecretName, rawValue: string): void {
  const value = sanitize(rawValue);
  if (!value) {
    throw new Error('Secret value cannot be blank.');
  }

  const store = readSecretStore();
  store[id] = value;
  writeSecretStore(store);
  process.env[id] = value;
}

export function maskSecret(value: string): string {
  if (!value) {
    return '';
  }
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }
  const suffix = value.slice(-4);
  const prefix = '*'.repeat(Math.max(0, value.length - 4));
  return `${prefix}${suffix}`;
}

export function ensureSecretForProvider(provider: ProviderId): string {
  const definition = findDefinitionForProvider(provider);
  const value = getSecretValue(definition.id);
  if (!value) {
    throw new MissingSecretError(definition);
  }
  process.env[definition.envVar] = value;
  return value;
}

export function getSecretDefinitionForProvider(provider: ProviderId): SecretDefinition | null {
  return SECRET_DEFINITIONS.find((entry) => entry.providers.includes(provider)) ?? null;
}

function readSecretStore(): SecretStoreData {
  if (!existsSync(SECRET_FILE)) {
    return {};
  }

  try {
    const content = readFileSync(SECRET_FILE, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return parsed as SecretStoreData;
    }
  } catch {
    return {};
  }
  return {};
}

function writeSecretStore(store: SecretStoreData): void {
  const directory = dirname(SECRET_FILE);
  mkdirSync(directory, { recursive: true });
  const payload = JSON.stringify(store, null, 2);
  writeFileSync(SECRET_FILE, `${payload}
`);
}

function findDefinitionForProvider(provider: ProviderId): SecretDefinition {
  const definition = getSecretDefinitionForProvider(provider);
  if (!definition) {
    throw new Error(`No secret configuration for provider "${provider}".`);
  }
  return definition;
}

function sanitize(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}
