import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { AgentSource } from '../../shared/session-models';

export interface LocalCliConfig {
  command: string;
  cwd?: string;
  expectJson?: boolean;
  env?: Record<string, string>;
  sessionId?: string;
}

export interface RemoteGatewayConfig {
  baseUrl: string;
  token?: string;
  project?: string;
}

export interface MirrorFileConfig {
  file: string;
  sessionId: string;
}

export interface JsonlStoreConfig {
  url: string;
  pollIntervalMs?: number;
  label?: string;
}

export interface RedisStreamConfig {
  url: string;
  streamKey: string;
  pollIntervalMs?: number;
  label?: string;
}

export interface TemporalWorkflowConfig {
  historyUrl: string;
  commandUrl?: string;
  pollIntervalMs?: number;
  label?: string;
}

export interface RuntimeConfig {
  source: AgentSource;
  sessionId: string;
  label?: string;
  localCli?: LocalCliConfig;
  remote?: RemoteGatewayConfig;
  mirrorFile?: MirrorFileConfig;
  jsonlStore?: JsonlStoreConfig;
  redisStream?: RedisStreamConfig;
  temporal?: TemporalWorkflowConfig;
  access: SessionAccessConfig;
}

export type SessionAccessMode = 'public' | 'firebase' | 'passphrase';

export interface SessionAccessConfig {
  mode: SessionAccessMode;
  passphraseHash?: string;
}

const MIRROR_SUBDIR = ['.apt-ui', 'mirror'];

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const parseNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseEnvObject = (value: string | undefined): Record<string, string> | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    console.warn('Unable to parse LOCAL_CLI_ENV - expected JSON stringified record.');
    return undefined;
  }
};

const deriveMirrorSessionId = (filePath: string, fallback?: string): string => {
  if (fallback) {
    return fallback;
  }

  const base = basename(filePath);
  return base.replace(/\.jsonl$/i, '') || 'apt-mirror';
};

const mirrorFileFromEnv = (): string | undefined =>
  process.env['APT_UI_MIRROR_FILE'] ??
  process.env['MIRROR_FILE'] ??
  process.env['SESSION_MIRROR_FILE'];

const discoverWorkspaceCandidates = (): string[] => {
  const hints = [
    process.env['APT_UI_WORKSPACE'],
    process.env['WORKSPACE'],
    process.cwd()
  ].filter((value): value is string => Boolean(value));

  return hints.map((hint) => {
    try {
      return resolve(hint);
    } catch {
      return hint;
    }
  });
};

const pickLatestMirrorFile = (workspace: string): string | undefined => {
  const mirrorDir = join(workspace, ...MIRROR_SUBDIR);
  if (!existsSync(mirrorDir)) {
    return undefined;
  }

  const entries = readdirSync(mirrorDir).filter((name) => name.endsWith('.jsonl'));
  if (!entries.length) {
    return undefined;
  }

  const latest = entries
    .map((name) => {
      const fullPath = join(mirrorDir, name);
      let mtime = 0;
      try {
        mtime = statSync(fullPath).mtimeMs;
      } catch {
      }
      return { path: fullPath, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)[0];

  return latest?.path;
};

const discoverMirrorFile = (): string | undefined => {
  const direct = mirrorFileFromEnv();
  if (direct) {
    return direct;
  }

  for (const workspace of discoverWorkspaceCandidates()) {
    const candidate = pickLatestMirrorFile(workspace);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
};

export const hashSecret = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const parseAccessConfig = (): SessionAccessConfig => {
  const mode = (process.env['SESSION_ACCESS_MODE'] as SessionAccessMode | undefined) ?? 'public';
  if (mode === 'passphrase') {
    const passphrase =
      process.env['SESSION_PASSPHRASE'] ?? process.env['SESSION_ACCESS_PASSPHRASE'];
    if (!passphrase) {
      throw new Error('SESSION_PASSPHRASE must be set when SESSION_ACCESS_MODE=passphrase.');
    }

    return { mode, passphraseHash: hashSecret(passphrase) };
  }

  return { mode };
};

export const loadRuntimeConfig = (): RuntimeConfig => {
  const explicitSource = process.env['AGENT_SOURCE'] as AgentSource | undefined;
  const autoMirrorFile = discoverMirrorFile();
  const source: AgentSource =
    explicitSource ?? (autoMirrorFile ? 'mirror-file' : 'mock');
  const access = parseAccessConfig();

  if (source === 'mirror-file') {
    const file = autoMirrorFile;
    if (!file) {
      throw new Error(
        'Set APT_UI_MIRROR_FILE (or MIRROR_FILE) or run apt-ui so we can find a mirror under <workspace>/.apt-ui/mirror/*.jsonl.',
      );
    }

    const sessionId = deriveMirrorSessionId(file, process.env['APT_UI_SESSION_ID'] ?? process.env['SESSION_ID']);
    return {
      source,
      sessionId,
      mirrorFile: {
        file,
        sessionId
      },
      access
    };
  }

  const sessionId = process.env['SESSION_ID'] ?? (source === 'mock' ? 'mock-local' : 'workspace-stream');

  if (source === 'local-cli') {
    const expectJson = parseBoolean(process.env['LOCAL_CLI_JSON'], true);
      return {
        source,
        sessionId,
        localCli: {
          command: process.env['LOCAL_CLI_COMMAND'] ?? 'apt --profile apt-code --json',
          cwd: process.env['LOCAL_CLI_CWD'] ?? process.cwd(),
          expectJson,
          env: parseEnvObject(process.env['LOCAL_CLI_ENV']),
          sessionId
        },
        access
      };
    }

  if (source === 'remote-cloud') {
    return {
      source,
      sessionId,
      remote: {
        baseUrl: process.env['REMOTE_AGENT_URL'] ?? '',
        token: process.env['REMOTE_AGENT_TOKEN'],
        project: process.env['REMOTE_AGENT_PROJECT']
      },
      access
    };
  }

  if (source === 'jsonl-store') {
    const url = process.env['JSONL_STORE_URL'];
    if (!url) {
      throw new Error('JSONL_STORE_URL must be set when AGENT_SOURCE=jsonl-store.');
    }

    return {
      source,
      sessionId,
      jsonlStore: {
        url,
        pollIntervalMs: parseNumber(process.env['JSONL_STORE_POLL_MS']),
        label: process.env['JSONL_STORE_LABEL']
      },
      access
    };
  }

  if (source === 'redis-stream') {
    const url = process.env['REDIS_STREAM_URL'];
    const streamKey = process.env['REDIS_STREAM_KEY'];
    if (!url || !streamKey) {
      throw new Error('REDIS_STREAM_URL and REDIS_STREAM_KEY must be set for redis-stream mode.');
    }

    return {
      source,
      sessionId,
      redisStream: {
        url,
        streamKey,
        pollIntervalMs: parseNumber(process.env['REDIS_STREAM_POLL_MS']),
        label: process.env['REDIS_STREAM_LABEL']
      },
      access
    };
  }

  if (source === 'temporal-workflow') {
    const historyUrl = process.env['TEMPORAL_HISTORY_URL'];
    if (!historyUrl) {
      throw new Error('TEMPORAL_HISTORY_URL must be set for temporal-workflow mode.');
    }

    return {
      source,
      sessionId,
      temporal: {
        historyUrl,
        commandUrl: process.env['TEMPORAL_COMMAND_URL'],
        pollIntervalMs: parseNumber(process.env['TEMPORAL_POLL_MS']),
        label: process.env['TEMPORAL_LABEL']
      },
      access
    };
  }

  return { source: 'mock', sessionId, access };
};
