import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { analyzeTypeScriptFile, performAdvancedAstAnalysis } from './codeAnalysisTools.js';

const execAsync = promisify(exec);

const LINT_CONFIG_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.cjs',
  'eslint.config.mjs',
  'eslint.config.json',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.eslintrc.js',
  '.eslintrc.yml',
  '.eslintrc.yaml',
];

interface PackageJson {
  scripts?: Record<string, string>;
  eslintConfig?: unknown;
}

export function createCodeQualityTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'run_lint_checks',
      description: 'Run ESLint (or npm run lint) with optional pattern targeting and auto-fix support.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Optional file/glob pattern to pass to the linter.',
          },
          fix: {
            type: 'boolean',
            description: 'Apply automatic fixes when supported.',
          },
          timeout: {
            type: 'number',
            description: 'Command timeout in milliseconds (default: 120000).',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const rawPattern = args['pattern'];
        const pattern = typeof rawPattern === 'string' && rawPattern.trim() ? rawPattern.trim() : null;
        const fix = args['fix'] === true;
        const timeout =
          typeof args['timeout'] === 'number' && Number.isFinite(args['timeout']) && args['timeout'] > 0
            ? (args['timeout'] as number)
            : 120000;

        try {
          const packageJsonPath = join(workingDir, 'package.json');
          if (!existsSync(packageJsonPath)) {
            return 'Error: package.json not found. Cannot determine lint command.';
          }

          const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
          let command: string;

          if (pkg.scripts?.['lint']) {
            const extras: string[] = [];
            if (pattern) {
              extras.push(pattern);
            }
            if (fix) {
              extras.push('--fix');
            }
            command = 'npm run lint';
            if (extras.length > 0) {
              command += ` -- ${extras.map(shellEscape).join(' ')}`;
            }
          } else {
            const target = pattern ?? '.';
            command = `npx eslint ${shellEscape(target)} --ext .ts,.tsx,.js,.jsx`;
            if (fix) {
              command += ' --fix';
            }
          }

          const { stdout, stderr } = await execAsync(command, {
            cwd: workingDir,
            timeout,
            maxBuffer: 1024 * 1024 * 10,
          });

          let result = `Lint command: ${command}\n\n`;
          if (stdout) result += `stdout:\n${stdout}\n`;
          if (stderr) result += `stderr:\n${stderr}\n`;
          return result || 'Lint run completed (no output).';
        } catch (error: any) {
          const stdout = (error.stdout as string | undefined) ?? '';
          const stderr = (error.stderr as string | undefined) ?? '';
          if (error.killed) {
            return `Error: lint command timed out after ${timeout}ms`;
          }
          return `Error running lint command: ${error.message}\nstdout: ${stdout}\nstderr: ${stderr}`;
        }
      },
    },
    {
      name: 'inspect_code_quality',
      description: 'Generate a maintainability report (function complexity, TODO density, comment coverage) for a file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the TypeScript/JavaScript file to inspect.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const filePath = resolveFilePath(workingDir, args['path']);
          if (!existsSync(filePath)) {
            return `Error: File not found: ${filePath}`;
          }

          const content = readFileSync(filePath, 'utf-8');
          const analysis = analyzeTypeScriptFile(content, filePath);
          const ast = performAdvancedAstAnalysis(content, filePath);
          return formatQualityReport(content, analysis, ast);
        } catch (error) {
          return `Error analyzing code quality: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'list_lint_rules',
      description: 'Summarize the ESLint configuration and active rules.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      handler: async () => {
        try {
          const configInfo = await loadLintConfig(workingDir);
          if (!configInfo) {
            return 'No ESLint configuration found (package.json eslintConfig or .eslintrc/eslint.config.*).';
          }

          const rules = extractLintRules(configInfo.config);
          if (Object.keys(rules).length === 0) {
            return `ESLint configuration "${configInfo.source}" found, but no rules were declared.`;
          }

          return formatLintRules(configInfo.source, rules);
        } catch (error) {
          return `Error reading ESLint configuration: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];
}

function resolveFilePath(workingDir: string, path: unknown): string {
  const value = validatePathArg(path);
  return value.startsWith('/') ? value : join(workingDir, value);
}

function validatePathArg(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Path must be a non-empty string.');
  }
  return path.trim();
}

function shellEscape(value: string): string {
  if (!value) {
    return "''";
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function loadLintConfig(
  workingDir: string,
): Promise<{ config: unknown; source: string } | null> {
  const packageJsonPath = join(workingDir, 'package.json');
  if (existsSync(packageJsonPath)) {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
    if (pkg.eslintConfig) {
      return {
        config: pkg.eslintConfig,
        source: 'package.json eslintConfig',
      };
    }
  }

  for (const relativePath of LINT_CONFIG_CANDIDATES) {
    const absolute = join(workingDir, relativePath);
    if (!existsSync(absolute)) {
      continue;
    }

    if (relativePath.endsWith('.json') || relativePath === '.eslintrc') {
      const config = JSON.parse(readFileSync(absolute, 'utf-8'));
      return { config, source: relativePath };
    }

    if (relativePath.endsWith('.js') || relativePath.endsWith('.cjs') || relativePath.endsWith('.mjs')) {
      const module = await import(pathToFileURL(absolute).href);
      const config = module.default ?? module;
      return { config, source: relativePath };
    }
  }

  return null;
}

function extractLintRules(config: unknown): Record<string, unknown> {
  if (!config) {
    return {};
  }

  if (Array.isArray(config)) {
    return config.reduce((acc, entry) => {
      if (entry && typeof entry === 'object' && 'rules' in entry && typeof (entry as any).rules === 'object') {
        Object.assign(acc, (entry as any).rules);
      }
      return acc;
    }, {} as Record<string, unknown>);
  }

  if (typeof config === 'object' && 'rules' in (config as any) && typeof (config as any).rules === 'object') {
    return { ...(config as any).rules };
  }

  return {};
}

function formatLintRules(source: string, rules: Record<string, unknown>): string {
  const output: string[] = [];
  output.push(`# ESLint rules (${source})`);
  output.push('');

  const entries = Object.entries(rules).sort(([a], [b]) => a.localeCompare(b));
  for (const [rule, setting] of entries) {
    const normalized = normalizeRuleSetting(setting);
    output.push(`- **${rule}** → ${normalized.level}${normalized.details ? ` (${normalized.details})` : ''}`);
  }

  return output.join('\n');
}

function normalizeRuleSetting(
  setting: unknown,
): { level: string; details?: string } {
  if (typeof setting === 'string') {
    return { level: setting };
  }
  if (typeof setting === 'number') {
    return { level: severityFromNumber(setting) };
  }
  if (Array.isArray(setting) && setting.length > 0) {
    const [levelRaw, ...rest] = setting;
    const level = typeof levelRaw === 'number' ? severityFromNumber(levelRaw) : String(levelRaw);
    return {
      level,
      details: rest.length > 0 ? JSON.stringify(rest) : undefined,
    };
  }
  if (typeof setting === 'object' && setting !== null) {
    return {
      level: 'configured',
      details: JSON.stringify(setting),
    };
  }
  return { level: 'off' };
}

function severityFromNumber(level: number): string {
  switch (level) {
    case 0:
      return 'off';
    case 1:
      return 'warn';
    case 2:
      return 'error';
    default:
      return `level-${level}`;
  }
}

function formatQualityReport(
  content: string,
  structural: ReturnType<typeof analyzeTypeScriptFile>,
  ast: ReturnType<typeof performAdvancedAstAnalysis>,
): string {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const todoCount = lines.filter((line) => /TODO|FIXME|HACK/.test(line)).length;
  const commentLines = lines.filter((line) => line.trim().startsWith('//') || line.trim().startsWith('/*')).length;
  const commentCoverage = totalLines === 0 ? 0 : (commentLines / totalLines) * 100;

  const longStructures = ast.symbols.filter(
    (symbol) => symbol.kind !== 'class' && (symbol.statementCount > 40 || symbol.cyclomaticComplexity > 12),
  );

  const maintainabilityScore = Math.max(
    10,
    Math.round(
      100 -
        longStructures.length * 4 -
        Math.min(todoCount * 2, 30) -
        Math.min(structural.functions.length * 0.5, 15) -
        Math.min(commentCoverage < 10 ? 20 : 0, 20),
    ),
  );

  const output: string[] = [];
  output.push(`# Code quality snapshot`);
  output.push('');
  output.push(`- Total lines: ${totalLines}`);
  output.push(`- Comment coverage: ${commentCoverage.toFixed(1)}%`);
  output.push(`- TODO/FIXME occurrences: ${todoCount}`);
  output.push(`- Named exports: ${structural.exports.length}`);
  output.push(`- Maintainability score (heuristic): ${maintainabilityScore}/100`);
  output.push('');
  output.push('## Hotspots');
  if (longStructures.length === 0) {
    output.push('No large or unusually complex functions detected.');
  } else {
    for (const symbol of longStructures) {
      output.push(
        `- ${symbol.name} (${symbol.kind}) — statements: ${symbol.statementCount}, CC: ${symbol.cyclomaticComplexity}, lines ${symbol.startLine}-${symbol.endLine}`,
      );
    }
  }
  return output.join('\n');
}
