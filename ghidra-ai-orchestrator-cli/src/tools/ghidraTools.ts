import { randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { BRAND_DOT_DIR } from '../core/brand.js';

const execFileAsync = promisify(execFile);

const HEADLESS_SCRIPT_NAME = process.platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless';

interface HeadlessResolution {
  installRoot: string;
  scriptPath: string;
  source: string;
}

export function createGhidraTools(
  workingDir: string,
  env: Record<string, string | undefined>
): ToolDefinition[] {
  return [
    {
      name: 'ghidra_locate_installation',
      description:
        'Locate a runnable analyzeHeadless script using GHIDRA_INSTALL_DIR, an explicit install_dir, or the local Ghidra checkout.',
      parameters: {
        type: 'object',
        properties: {
          install_dir: {
            type: 'string',
            description:
              'Optional path to a Ghidra install root (directory containing support/analyzeHeadless). Defaults to GHIDRA_INSTALL_DIR or the repo checkout.',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const hint =
            typeof args['install_dir'] === 'string' && args['install_dir'].trim()
              ? args['install_dir'].trim()
              : null;
          const resolved = await resolveHeadlessPath({
            workingDir,
            env,
            hint,
          });
          return [
            `Found analyzeHeadless: ${resolved.scriptPath}`,
            `Install root: ${resolved.installRoot}`,
            `Source: ${resolved.source}`,
            '',
            'Use ghidra_run_headless to import binaries, attach scripts, and export artifacts.',
          ]
            .filter(Boolean)
            .join('\n');
        } catch (error) {
          return formatHandlerError('locating a Ghidra installation', error);
        }
      },
    },
    {
      name: 'ghidra_write_script',
      description:
        'Persist a Ghidra script under .apt/ghidra/scripts for reuse. Pair with ghidra_run_headless to execute it.',
      parameters: {
        type: 'object',
        properties: {
          file_name: {
            type: 'string',
            description:
              'Optional base filename (without extension) for the script. Defaults to ghidra-script-<uuid>.',
          },
          language: {
            type: 'string',
            enum: ['python', 'java'],
            description: 'Script language. Python targets the bundled Jython, Java targets the GhidraScript API.',
          },
          contents: {
            type: 'string',
            description:
              'Full script contents. Include imports and any GhidraScript subclassing as needed for your task.',
          },
        },
        required: ['contents'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const contents = toNonEmptyString(args['contents']);
        if (!contents) {
          return 'Provide script contents to persist.';
        }

        const language =
          typeof args['language'] === 'string' && args['language'].toLowerCase() === 'java'
            ? 'java'
            : 'python';

        const baseName =
          typeof args['file_name'] === 'string' && args['file_name'].trim()
            ? sanitizeName(args['file_name'])
            : `ghidra-script-${randomUUID()}`;

        try {
          const filePath = await writeScriptFile({
            workingDir,
            baseName,
            contents,
            language,
          });
          return `Wrote ${language} script to ${filePath}\nUse ghidra_run_headless with script_path="${filePath}" to execute it.`;
        } catch (error) {
          return formatHandlerError('writing the script', error);
        }
      },
    },
    {
      name: 'ghidra_run_headless',
      description:
        'Run Ghidra headless (analyzeHeadless) end-to-end: import a binary, (optionally) run analysis, and execute post scripts for vulnerability triage or exploit prep.',
      parameters: {
        type: 'object',
        properties: {
          binary_path: {
            type: 'string',
            description: 'Path to the binary or archive to import.',
          },
          project_dir: {
            type: 'string',
            description:
              'Ghidra project directory to use/create. Defaults to .apt/ghidra-projects inside the workspace.',
          },
          project_name: {
            type: 'string',
            description: 'Project name inside the project directory. Defaults to the binary filename.',
          },
          install_dir: {
            type: 'string',
            description:
              'Optional Ghidra install root override. Falls back to GHIDRA_INSTALL_DIR or the local checkout.',
          },
          script_path: {
            type: 'string',
            description:
              'Optional existing script to run with -postScript. Provide absolute or workspace-relative path.',
          },
          inline_script: {
            type: 'string',
            description:
              'Inline script contents to run as a -postScript. The script will be written to .apt/ghidra/scripts first.',
          },
          script_language: {
            type: 'string',
            enum: ['python', 'java'],
            description:
              'Language for inline_script when provided. Defaults to python (Jython); set to java for GhidraScript.',
          },
          script_args: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments forwarded to the post script.',
          },
          analysis_args: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Additional analyzeHeadless arguments (e.g., "-overwrite", "-analysisTimeoutPerFile", "-process importedBin*").',
          },
          no_analysis: {
            type: 'boolean',
            description: 'Skip auto-analysis (-noanalysis). Useful when scripts handle their own processing.',
          },
          delete_project: {
            type: 'boolean',
            description: 'Delete the project after completion (-deleteProject) to keep the workspace clean.',
          },
          timeout_ms: {
            type: 'number',
            description:
              'Execution timeout in milliseconds. Defaults to 300000 (5 minutes) to accommodate larger binaries.',
          },
        },
        required: ['binary_path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const binaryPath = toNonEmptyString(args['binary_path']);
          if (!binaryPath) {
            return 'binary_path is required.';
          }

          const resolvedBinary = resolve(workingDir, binaryPath);
          if (!existsSync(resolvedBinary)) {
            return `Binary not found at ${resolvedBinary}`;
          }

          const resolvedProjectDir = resolve(
            workingDir,
            toNonEmptyString(args['project_dir']) ?? join(BRAND_DOT_DIR, 'ghidra-projects')
          );
          await mkdir(resolvedProjectDir, { recursive: true });

          const projectName = sanitizeName(
            toNonEmptyString(args['project_name']) ?? basename(resolvedBinary)
          );

          const resolution = await resolveHeadlessPath({
            workingDir,
            env,
            hint: toNonEmptyString(args['install_dir']),
          });

          const scriptLanguage =
            typeof args['script_language'] === 'string' && args['script_language'].toLowerCase() === 'java'
              ? 'java'
              : 'python';

          const inlineScript = toNonEmptyString(args['inline_script']);
          let scriptPath = toNonEmptyString(args['script_path']);
          if (inlineScript) {
            scriptPath = await writeScriptFile({
              workingDir,
              baseName: `ghidra-inline-${randomUUID()}`,
              contents: inlineScript,
              language: scriptLanguage,
            });
          }
          let resolvedScriptPath: string | null = null;
          if (scriptPath) {
            const absolute = resolve(workingDir, scriptPath);
            if (!existsSync(absolute)) {
              return `Script not found at ${absolute}`;
            }
            resolvedScriptPath = absolute;
          }

          const argList: string[] = [
            resolvedProjectDir,
            projectName,
            '-import',
            resolvedBinary,
          ];

          if (args['no_analysis'] === true) {
            argList.push('-noanalysis');
          }
          if (resolvedScriptPath) {
            argList.push('-postScript', resolvedScriptPath);
            for (const token of toStringArray(args['script_args'])) {
              argList.push(token);
            }
          }
          for (const token of toStringArray(args['analysis_args'])) {
            argList.push(token);
          }
          if (args['delete_project'] === true) {
            argList.push('-deleteProject');
          }

          const timeout = normalizeTimeout(args['timeout_ms']);
          const runtimeEnv = mergeEnvs(process.env, env, {
            GHIDRA_INSTALL_DIR: resolution.installRoot,
            GHIDRA_HOME: resolution.installRoot,
          });

          const { stdout, stderr } = await execFileAsync(resolution.scriptPath, argList, {
            cwd: dirname(resolution.scriptPath),
            timeout,
            maxBuffer: 25 * 1024 * 1024,
            shell: process.platform === 'win32',
            env: runtimeEnv,
          });

          return formatRunOutput({
            resolution,
            argList,
            stdout,
            stderr,
          });
        } catch (error: any) {
          const stdout = typeof error?.stdout === 'string' ? error.stdout.trim() : '';
          const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
          const exit = typeof error?.code === 'number' ? ` (exit ${error.code})` : '';
          const message = error instanceof Error ? error.message : String(error);
          const details = [stdout, stderr].filter(Boolean).join('\n');

          return [`Headless Ghidra run failed${exit}: ${message}`, details].filter(Boolean).join('\n');
        }
      },
    },
  ];
}

async function resolveHeadlessPath(options: {
  workingDir: string;
  env: Record<string, string | undefined>;
  hint?: string | null;
}): Promise<HeadlessResolution> {
  const candidates: HeadlessResolution[] = [];

  const normalizedHint = toNonEmptyString(options.hint);
  if (normalizedHint) {
    const hintPath = resolve(options.workingDir, normalizedHint);
    if (hintPath.toLowerCase().includes(HEADLESS_SCRIPT_NAME.toLowerCase())) {
      candidates.push({
        installRoot: dirname(hintPath),
        scriptPath: hintPath,
        source: 'explicit script path',
      });
    } else {
      candidates.push({
        installRoot: hintPath,
        scriptPath: join(hintPath, 'support', HEADLESS_SCRIPT_NAME),
        source: 'explicit install_dir',
      });
    }
  }

  const envDir = lookupEnvDir(options.env);
  if (envDir) {
    const resolved = resolve(options.workingDir, envDir);
    candidates.push({
      installRoot: resolved,
      scriptPath: join(resolved, 'support', HEADLESS_SCRIPT_NAME),
      source: 'GHIDRA_INSTALL_DIR/GHIDRA_HOME',
    });
  }

  for (const root of candidateRoots(options.workingDir)) {
    const repoRoot = join(root, 'Ghidra');
    candidates.push({
      installRoot: repoRoot,
      scriptPath: join(repoRoot, 'support', HEADLESS_SCRIPT_NAME),
      source: 'repo support',
    });
    const platform = process.platform === 'win32' ? 'Windows' : 'Linux';
    candidates.push({
      installRoot: repoRoot,
      scriptPath: join(repoRoot, 'RuntimeScripts', platform, 'support', HEADLESS_SCRIPT_NAME),
      source: 'RuntimeScripts',
    });
  }

  const seen = new Set<string>();
  for (const entry of candidates) {
    const key = entry.scriptPath;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (await fileExists(entry.scriptPath)) {
      return entry;
    }
  }

  const searched = Array.from(seen).map((path) => `- ${path}`).join('\n');
  throw new Error(
    [
      `Could not find ${HEADLESS_SCRIPT_NAME}.`,
      'Set GHIDRA_INSTALL_DIR to a built Ghidra install or pass install_dir explicitly.',
      'Paths checked:',
      searched || '(none)',
    ].join('\n')
  );
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function lookupEnvDir(env: Record<string, string | undefined>): string | null {
  const keys = ['GHIDRA_INSTALL_DIR', 'GHIDRA_HOME'];
  for (const key of keys) {
    const raw = env[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
  }
  return null;
}

function candidateRoots(workingDir: string): string[] {
  const roots = new Set<string>();
  let current = resolve(workingDir);
  for (let depth = 0; depth < 4; depth += 1) {
    roots.add(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return Array.from(roots);
}

async function writeScriptFile(options: {
  workingDir: string;
  baseName: string;
  contents: string;
  language: 'python' | 'java';
}): Promise<string> {
  const scriptsDir = resolve(options.workingDir, BRAND_DOT_DIR, 'ghidra', 'scripts');
  await mkdir(scriptsDir, { recursive: true });
  const extension = options.language === 'java' ? '.java' : '.py';
  const filePath = join(scriptsDir, `${sanitizeName(options.baseName)}${extension}`);
  await writeFile(filePath, options.contents, 'utf8');
  return filePath;
}

function sanitizeName(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-');
  return cleaned || 'ghidra-project';
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '')).trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [String(value)].filter(Boolean);
}

function mergeEnvs(
  ...sources: Record<string, string | undefined>[]
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (typeof value === 'string') {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function normalizeTimeout(value: unknown): number {
  const fallback = 300_000;
  if (typeof value !== 'number') {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  const max = 45 * 60 * 1000; // cap at 45 minutes to avoid runaway runs
  return Math.min(Math.floor(value), max);
}

function formatRunOutput(payload: {
  resolution: HeadlessResolution;
  argList: string[];
  stdout: string;
  stderr: string;
}): string {
  const command = `${payload.resolution.scriptPath} ${payload.argList.map(quoteArg).join(' ')}`;
  const parts = [`Command: ${command}`];
  if (payload.stdout?.trim()) {
    parts.push('stdout:', payload.stdout.trim());
  }
  if (payload.stderr?.trim()) {
    parts.push('stderr:', payload.stderr.trim());
  }
  parts.push(
    '',
    'Tip: attach custom scripts for vuln hunting or patch automation via inline_script/script_path.'
  );
  return parts.filter(Boolean).join('\n');
}

function quoteArg(arg: string): string {
  if (!arg.includes(' ')) {
    return arg;
  }
  return `"${arg.replace(/"/g, '\\"')}"`;
}

function formatHandlerError(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error while ${action}: ${message}`;
}
