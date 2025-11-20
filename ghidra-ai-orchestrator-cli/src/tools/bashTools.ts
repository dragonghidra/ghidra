import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { createBackgroundBashTools, startBackgroundShell } from './backgroundBashTools.js';
import { BRAND_DOT_DIR, LEGACY_DOT_DIR, pickBrandEnv } from '../core/brand.js';

const execAsync = promisify(exec);
const sandboxCache = new Map<string, Promise<SandboxPaths>>();

interface SandboxPaths {
  root: string;
  home: string;
  cache: string;
  config: string;
  data: string;
  tmp: string;
}

export function createBashTools(workingDir: string): ToolDefinition[] {
  const backgroundTools = createBackgroundBashTools(workingDir);

  return [
    {
      name: 'execute_bash',
      description: 'Execute a bash command in the working directory. Use run_in_background: true to run commands in the background and monitor with BashOutput.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000). Not used when run_in_background is true.',
          },
          run_in_background: {
            type: 'boolean',
            description: 'Set to true to run this command in the background. Returns a shell ID that can be used with BashOutput to monitor output.',
          },
        },
        required: ['command'],
      },
      handler: async (args) => {
        const command = args['command'] as string;
        const timeout = (args['timeout'] as number) || 30000;
        const runInBackground = args['run_in_background'] === true;

        const dangerousCommands = ['rm -rf /', 'format', 'mkfs', ':(){ :|:& };:'];
        if (dangerousCommands.some((dangerous) => command.includes(dangerous))) {
          return 'Error: Dangerous command blocked for safety';
        }

        // Handle background execution
        if (runInBackground) {
          const shellId = startBackgroundShell(command, workingDir);
          return `Background shell started: ${shellId}\n\nUse BashOutput with bash_id="${shellId}" to monitor output.\nUse KillShell with shell_id="${shellId}" to terminate.`;
        }

        // Handle foreground execution
        try {
          const env = await buildSandboxEnv(workingDir);
          const { stdout, stderr } = await execAsync(command, {
            cwd: workingDir,
            timeout,
            maxBuffer: 1024 * 1024 * 10, // 10MB
            env,
          });

          let result = '';
          if (stdout) result += `stdout:\n${stdout}\n`;
          if (stderr) result += `stderr:\n${stderr}\n`;

          return result || 'Command executed successfully (no output)';
        } catch (error: any) {
          if (error.killed) {
            return `Error: Command timed out after ${timeout}ms`;
          }
          return `Error executing command: ${error.message}\nstderr: ${error.stderr || 'none'}`;
        }
      },
    },
    {
      name: 'execute_bash_stream',
      description: 'Execute a bash command and stream output (for long-running commands)',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
        },
        required: ['command'],
      },
      handler: async (_args) => {
        await buildSandboxEnv(workingDir);
        return 'Stream execution not yet implemented - use execute_bash instead';
      },
    },
    ...backgroundTools,
  ];
}

interface SandboxEnvOptions {
  preserveHome?: boolean;
}

export async function buildSandboxEnv(
  workingDir: string,
  options?: SandboxEnvOptions
): Promise<NodeJS.ProcessEnv> {
  const envPreference = pickBrandEnv(process.env, 'PRESERVE_HOME');
  const preserveHome =
    envPreference === '1'
      ? true
      : envPreference === '0'
        ? false
        : Boolean(options?.preserveHome);
  const paths = await ensureSandboxPaths(workingDir);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APT_SANDBOX_ROOT: paths.root,
    APT_SANDBOX_HOME: paths.home,
    APT_SANDBOX_TMP: paths.tmp,
    EROSOLAR_SANDBOX_ROOT: paths.root,
    EROSOLAR_SANDBOX_HOME: paths.home,
    EROSOLAR_SANDBOX_TMP: paths.tmp,
  };

  if (!preserveHome) {
    env['HOME'] = paths.home;
  }

  env['XDG_CACHE_HOME'] = paths.cache;
  env['XDG_CONFIG_HOME'] = paths.config;
  env['XDG_DATA_HOME'] = paths.data;
  env['TMPDIR'] = paths.tmp;
  env['TMP'] = paths.tmp;
  env['TEMP'] = paths.tmp;

  return env;
}

async function ensureSandboxPaths(workingDir: string): Promise<SandboxPaths> {
  const key = workingDir;
  let pending = sandboxCache.get(key);
  if (!pending) {
    pending = createSandboxPaths(workingDir);
    sandboxCache.set(key, pending);
  }
  return pending;
}

async function createSandboxPaths(workingDir: string): Promise<SandboxPaths> {
  const preferredRoot = join(workingDir, BRAND_DOT_DIR, 'shell-sandbox');
  const legacyRoot = join(workingDir, LEGACY_DOT_DIR, 'shell-sandbox');
  const root = existsSync(preferredRoot) || !existsSync(legacyRoot) ? preferredRoot : legacyRoot;
  const home = join(root, 'home');
  const cache = join(root, 'cache');
  const config = join(root, 'config');
  const data = join(root, 'data');
  const tmp = join(root, 'tmp');
  await Promise.all([home, cache, config, data, tmp].map((dir) => mkdir(dir, { recursive: true })));
  return { root, home, cache, config, data, tmp };
}
