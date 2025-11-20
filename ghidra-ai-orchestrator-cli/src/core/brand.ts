import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const BRAND_NAME = 'APT';
export const LEGACY_BRAND_NAME = 'Erosolar';
export const BRAND_CLI_NAME = 'apt';
export const BRAND_CODE_PROFILE = 'apt-code';
export const LEGACY_CODE_PROFILE = 'erosolar-code';
export const BRAND_DOT_DIR = '.apt';
export const LEGACY_DOT_DIR = '.erosolar';
export const BRAND_UI_DOT_DIR = '.apt-ui';
export const LEGACY_UI_DOT_DIR = '.erosolar-ui';

export function pickBrandEnv(env: NodeJS.ProcessEnv, suffix: string): string | null {
  const primary = env[`APT_${suffix}`];
  if (primary && primary.trim()) {
    return primary.trim();
  }
  const legacy = env[`EROSOLAR_${suffix}`];
  if (legacy && legacy.trim()) {
    return legacy.trim();
  }
  return null;
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = pickBrandEnv(env, 'DATA_DIR') ?? pickBrandEnv(env, 'HOME');
  if (override) {
    return override;
  }

  const preferred = join(homedir(), BRAND_DOT_DIR);
  const legacy = join(homedir(), LEGACY_DOT_DIR);

  if (!existsSync(preferred) && existsSync(legacy)) {
    return legacy;
  }

  return preferred;
}

export function resolveUiDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = pickBrandEnv(env, 'UI_DATA_DIR');
  if (override) {
    return override;
  }

  const preferred = join(homedir(), BRAND_UI_DOT_DIR);
  const legacy = join(homedir(), LEGACY_UI_DOT_DIR);

  if (!existsSync(preferred) && existsSync(legacy)) {
    return legacy;
  }

  return preferred;
}

export function resolveCommandsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = pickBrandEnv(env, 'COMMANDS_DIR');
  if (override) {
    return override;
  }
  return join(resolveDataDir(env), 'commands');
}

export function resolveTasksDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveDataDir(env), 'tasks');
}

export function resolveSkillSearchDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const envDirs = (pickBrandEnv(env, 'SKILLS_DIRS') ?? '')
    .split(':')
    .map((dir) => dir.trim())
    .filter(Boolean);

  return dedupeStrings([
    ...envDirs,
    'skills',
    '.claude/skills',
    `${BRAND_DOT_DIR}/skills`,
    `${LEGACY_DOT_DIR}/skills`,
  ]);
}

export function resolveProfileOverride(env: NodeJS.ProcessEnv = process.env): string | null {
  return pickBrandEnv(env, 'PROFILE');
}

export function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}
