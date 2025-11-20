import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { McpServerConfig, RawMcpServerDefinition } from './types.js';
import { pickBrandEnv, resolveDataDir } from '../core/brand.js';

interface LoadOptions {
  workingDir: string;
  env: Record<string, string | undefined>;
}

const DEFAULT_FILES = ['.mcp.json', join('.apt', 'mcp.json'), join('.erosolar', 'mcp.json')];
const DEFAULT_DIRECTORIES = [join('.apt', 'mcp.d'), join('.erosolar', 'mcp.d')];

export async function loadMcpServers(options: LoadOptions): Promise<McpServerConfig[]> {
  const candidates = await discoverConfigFiles(options);
  if (!candidates.length) {
    return [];
  }

  const normalized = new Map<string, McpServerConfig>();

  for (const file of candidates) {
    try {
      const definitions = await parseConfigFile(file);
      for (const definition of definitions) {
        if (definition.disabled) {
          normalized.delete(definition.id ?? '');
          continue;
        }
        const entry = normalizeServerDefinition(definition, file, options);
        if (entry) {
          normalized.set(entry.id, entry);
        }
      }
    } catch {
      // Ignore malformed files but continue loading others.
    }
  }

  return Array.from(normalized.values());
}

async function discoverConfigFiles(options: LoadOptions): Promise<string[]> {
  const files = new Set<string>();
  const envOverride =
    pickBrandEnv(options.env as NodeJS.ProcessEnv, 'MCP_CONFIG') ??
    pickBrandEnv(process.env, 'MCP_CONFIG');
  if (envOverride) {
    for (const path of envOverride.split(/[:,;]/)) {
      const trimmed = path.trim();
      if (trimmed) {
        files.add(resolve(trimmed));
      }
    }
  }
  const brandHome = resolveDataDir({ ...process.env, ...options.env });
  const userHome = homedir();
  const searchRoots = [options.workingDir, brandHome, userHome];
  for (const root of searchRoots) {
    for (const name of DEFAULT_FILES) {
      const candidate = resolve(root, name);
      if (await fileExists(candidate)) {
        files.add(candidate);
      }
    }
    for (const dirName of DEFAULT_DIRECTORIES) {
      const directory = resolve(root, dirName);
      const entries = await readDirectoryJsonFiles(directory);
      for (const entry of entries) {
        files.add(entry);
      }
    }
  }

  return Array.from(files);
}

async function readDirectoryJsonFiles(directory: string): Promise<string[]> {
  try {
    const stats = await stat(directory);
    if (!stats.isDirectory()) {
      return [];
    }
    const entries = await readdir(directory);
    return entries
      .filter((name) => name.endsWith('.json'))
      .map((name) => resolve(directory, name));
  } catch {
    return [];
  }
}

async function parseConfigFile(path: string): Promise<RawMcpServerDefinition[]> {
  const content = await readFile(path, 'utf8');
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }
  const parsed = JSON.parse(trimmed);
  if (Array.isArray(parsed)) {
    return parsed.filter((entry): entry is RawMcpServerDefinition => Boolean(entry && typeof entry === 'object'));
  }
  if (parsed && typeof parsed === 'object') {
    const result: RawMcpServerDefinition[] = [];
    for (const [id, value] of Object.entries(parsed as Record<string, RawMcpServerDefinition>)) {
      if (value && typeof value === 'object') {
        result.push({ ...value, id });
      }
    }
    return result;
  }
  return [];
}

function normalizeServerDefinition(
  raw: RawMcpServerDefinition,
  source: string,
  options: LoadOptions
): McpServerConfig | null {
  const type = normalizeTransport(raw.type);
  if (!type) {
    return null;
  }

  const id = sanitizeId(raw.id ?? '');
  if (!id) {
    return null;
  }

  if (type === 'stdio') {
    const command = expandTemplate(raw.command ?? '', options, source);
    if (!command) {
      return null;
    }
    const args = Array.isArray(raw.args)
      ? raw.args
          .map((value) => {
            const expanded = expandTemplate(String(value ?? ''), options, source);
            return expanded || String(value ?? '').trim();
          })
          .filter(Boolean)
      : [];

    const env = normalizeEnv(raw.env, options, source);
    const cwd = raw.cwd ? expandTemplate(raw.cwd, options, source) : undefined;

    return {
      id,
      type,
      command,
      args,
      cwd,
      env,
      description: raw.description,
      source,
    };
  }

  return null;
}

function normalizeTransport(value: string | undefined): McpServerConfig['type'] | null {
  if (!value) {
    return 'stdio';
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stdio') {
    return 'stdio';
  }
  return null;
}

function normalizeEnv(
  env: Record<string, string> | undefined,
  options: LoadOptions,
  source: string
): Record<string, string> {
  if (!env) {
    return {};
  }
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') {
      continue;
    }
    const expanded = expandTemplate(value, options, source);
    record[key] = expanded || value;
  }
  return record;
}

function expandTemplate(value: string, options: LoadOptions, file: string): string {
  if (!value) {
    return '';
  }
  const workspace = resolve(options.workingDir);
  const aptHome = resolveDataDir({ ...process.env, ...options.env });
  const replacements = {
    WORKSPACE_ROOT: workspace,
    PROJECT_DIR: workspace,
    CLAUDE_PROJECT_DIR: workspace,
    APT_HOME: aptHome,
    HOME: homedir(),
    MCP_CONFIG_DIR: resolve(file, '..'),
  } as const;

  type ReplacementKey = keyof typeof replacements;

  const replaced = value.replace(/\$\{([^}]+)\}/g, (_match, token: string): string => {
    const key = token.trim();
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
      const replacementKey = key as ReplacementKey;
      return replacements[replacementKey];
    }
    const envValue = options.env[key];
    if (typeof envValue === 'string' && envValue.trim()) {
      return envValue.trim();
    }
    if (typeof process.env[key] === 'string' && process.env[key]!.trim()) {
      return process.env[key]!.trim();
    }
    return '';
  });

  if (replaced.trim()) {
    return replaced;
  }

  const tokenMatch = value.match(/^\$\{\s*([^\}]+)\s*\}$/);
  if (tokenMatch) {
    const key = (tokenMatch[1] ?? '').trim();
    const direct =
      (replacements as Record<string, string>)[key] ??
      options.env[key]?.toString() ??
      (process.env[key] ?? '').toString();
    if (direct.trim()) {
      return direct.trim();
    }
  }

  return replaced.trim();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}
