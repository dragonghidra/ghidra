import { exec } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { buildSandboxEnv } from './bashTools.js';

const execAsync = promisify(exec);
const DEFAULT_SCRIPT_ORDER = ['test', 'build', 'lint'];
const MAX_STREAM_CHARS = 1200;

interface ScriptResult {
  script: string;
  command: string;
  success: boolean;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  errorMessage?: string;
  skipped?: boolean;
}

export function createRepoCheckTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'run_repo_checks',
      description:
        'Run common repo validation commands (npm test / npm run build / npm run lint when present) inside the sandbox and summarize pass/fail output.',
      parameters: {
        type: 'object',
        properties: {
          scripts: {
            type: 'array',
            description:
              'Optional override list of npm script names to run (defaults to test/build/lint if present).',
            items: { type: 'string' },
          },
          extraArgs: {
            type: 'string',
            description: 'Additional arguments appended to every npm run <script> invocation.',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const { scripts, skipped } = await resolveScripts(args['scripts'], workingDir);
        if (!scripts.length) {
          return 'No runnable npm scripts found (looked for test, build, lint). Add scripts to package.json or pass scripts explicitly.';
        }

        const extraArgsArg = args['extraArgs'];
        const extraArgs =
          typeof extraArgsArg === 'string' && extraArgsArg.trim()
            ? ` -- ${extraArgsArg.trim()}`
            : '';
        const env = await buildSandboxEnv(workingDir, {
          // macOS refuses to launch esbuild binaries when HOME is rewritten,
          // so repo checks keep the host HOME there to honor Gatekeeper prompts.
          preserveHome: process.platform === 'darwin',
        });
        const results: ScriptResult[] = [];

        for (const script of scripts) {
          const command = `npm run ${script}${extraArgs}`;
          results.push(await runScript(script, command, workingDir, env));
        }

        if (skipped.length) {
          results.push({
            script: skipped.join(', '),
            command: skipped.join(', '),
            success: false,
            stdout: '',
            stderr: '',
            elapsedMs: 0,
            skipped: true,
            errorMessage: `Skipped missing scripts: ${skipped.join(', ')}`,
          });
        }

        return formatResults(results);
      },
    },
  ];
}

async function resolveScripts(raw: unknown, workingDir: string): Promise<{ scripts: string[]; skipped: string[] }> {
  const declaredScripts = await readPackageScripts(workingDir);
  const requested = normalizeScriptList(raw);

  const baseline = DEFAULT_SCRIPT_ORDER.filter((name) => declaredScripts.has(name));
  const selected = (requested.length ? requested : baseline).filter((name) => declaredScripts.has(name));
  const skipped = requested.filter((name) => !declaredScripts.has(name));

  return { scripts: selected, skipped };
}

async function readPackageScripts(workingDir: string): Promise<Set<string>> {
  try {
    const raw = await readFile(join(workingDir, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const scripts = parsed?.scripts && typeof parsed.scripts === 'object' ? Object.keys(parsed.scripts) : [];
    return new Set(scripts);
  } catch {
    return new Set<string>();
  }
}

function normalizeScriptList(raw: unknown): string[] {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map(String).map((value) => value.trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

async function runScript(
  script: string,
  command: string,
  workingDir: string,
  env: NodeJS.ProcessEnv
): Promise<ScriptResult> {
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workingDir,
      env,
      timeout: 10 * 60 * 1000, // 10 minutes to cover installs/builds
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return {
      script,
      command,
      success: true,
      stdout,
      stderr,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error: any) {
    return {
      script,
      command,
      success: false,
      stdout: error?.stdout ?? '',
      stderr: error?.stderr ?? '',
      elapsedMs: Date.now() - startedAt,
      errorMessage: error?.message ?? 'Command failed',
    };
  }
}

function formatResults(results: ScriptResult[]): string {
  if (!results.length) {
    return 'No checks were executed.';
  }

  const lines: string[] = ['Repo checks summary:'];

  for (const result of results) {
    const icon = result.success ? '✓' : '✕';
    const duration = result.elapsedMs ? ` (${(result.elapsedMs / 1000).toFixed(1)}s)` : '';
    const label = result.skipped ? 'skipped' : result.command;
    lines.push(`- ${icon} ${label}${duration}`);

    if (result.errorMessage && !result.success) {
      lines.push(`  error: ${result.errorMessage}`);
    }

    const stdout = formatStream('stdout', result.stdout);
    if (stdout) {
      lines.push(`  ${stdout}`);
    }

    const stderr = formatStream('stderr', result.stderr);
    if (stderr) {
      lines.push(`  ${stderr}`);
    }
  }

  return lines.join('\n');
}

function formatStream(label: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const truncated = trimmed.length > MAX_STREAM_CHARS ? `${trimmed.slice(0, MAX_STREAM_CHARS)}...` : trimmed;
  return `${label}:\n${truncated}`;
}
