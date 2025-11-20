import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { performAdvancedAstAnalysis } from './codeAnalysisTools.js';

const execAsync = promisify(exec);

interface PackageJson {
  scripts?: Record<string, string>;
}

export function createTestingTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'generate_test_templates',
      description: 'Create sample Jest/Vitest/Mocha test blocks for functions and classes.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File to analyze when generating templates.',
          },
          framework: {
            type: 'string',
            enum: ['jest', 'vitest', 'mocha'],
            description: 'Test framework style to use (default: jest).',
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

          const framework = normalizeFramework(args['framework']);
          const content = readFileSync(filePath, 'utf-8');
          const ast = performAdvancedAstAnalysis(content, filePath);
          if (ast.symbols.length === 0) {
            return `No functions or classes detected in ${filePath}.`;
          }

          return buildTestTemplate(ast, filePath, framework);
        } catch (error) {
          return `Error generating test templates: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'run_coverage_analysis',
      description: 'Execute a coverage-focused test run (npm test -- --coverage / jest / vitest).',
      parameters: {
        type: 'object',
        properties: {
          framework: {
            type: 'string',
            enum: ['jest', 'vitest', 'mocha', 'npm'],
            description: 'Preferred test driver (default: npm).',
          },
          additionalArgs: {
            type: 'string',
            description: 'Extra CLI args to append to the coverage command.',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 240000).',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const framework = typeof args['framework'] === 'string' ? args['framework'] : 'npm';
        const timeoutArg = args['timeout'];
        const timeout =
          typeof timeoutArg === 'number' && Number.isFinite(timeoutArg) && timeoutArg > 0
            ? timeoutArg
            : 240000;
        const extraArgsArg = args['additionalArgs'];
        const extraArgs =
          typeof extraArgsArg === 'string' && extraArgsArg.trim()
            ? extraArgsArg.trim()
            : '';

        try {
          const command = await determineCoverageCommand(workingDir, framework, extraArgs);
          const { stdout, stderr } = await execAsync(command, {
            cwd: workingDir,
            timeout,
            maxBuffer: 1024 * 1024 * 10,
          });
          let result = `Coverage command: ${command}\n\n`;
          if (stdout) result += `stdout:\n${stdout}\n`;
          if (stderr) result += `stderr:\n${stderr}\n`;
          return result || 'Coverage run completed.';
        } catch (error: any) {
          if (error.killed) {
            return `Error: coverage command timed out after ${timeout}ms`;
          }
          return `Error running coverage command: ${error.message}\nstderr: ${error.stderr ?? 'none'}`;
        }
      },
    },
    {
      name: 'summarize_coverage_report',
      description: 'Summarize coverage/coverage-summary.json (NYC/Jest/Vitest) in markdown.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Custom path to the coverage summary JSON (defaults to coverage/coverage-summary.json).',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const summaryPath =
            typeof args['path'] === 'string' && args['path'].trim()
              ? resolveFilePath(workingDir, args['path'])
              : join(workingDir, 'coverage', 'coverage-summary.json');
          if (!existsSync(summaryPath)) {
            return `Coverage summary not found at ${summaryPath}. Run coverage and ensure the report is generated.`;
          }

          const summary = JSON.parse(readFileSync(summaryPath, 'utf-8')) as CoverageSummary;
          return formatCoverageSummary(summary, summaryPath, workingDir);
        } catch (error) {
          return `Error summarizing coverage: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];
}

type Framework = 'jest' | 'vitest' | 'mocha';

interface CoverageMetric {
  total: number;
  covered: number;
  skipped?: number;
  pct: number;
}

interface CoverageSummary {
  total: Record<'lines' | 'statements' | 'functions' | 'branches', CoverageMetric>;
  [file: string]: any;
}

function resolveFilePath(workingDir: string, path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Path must be a non-empty string.');
  }
  const value = path.trim();
  return value.startsWith('/') ? value : join(workingDir, value);
}

function normalizeFramework(input: unknown): Framework {
  if (input === 'vitest' || input === 'mocha') {
    return input;
  }
  return 'jest';
}

function buildTestTemplate(ast: ReturnType<typeof performAdvancedAstAnalysis>, filePath: string, framework: Framework): string {
  const describeName = basename(filePath);
  const testFn = framework === 'mocha' ? 'it' : 'test';
  const output: string[] = [];
  output.push('```ts');
  output.push(`describe('${describeName}', () => {`);

  ast.symbols.forEach((symbol) => {
    if (symbol.kind === 'class') {
      output.push(`  describe('${symbol.name}', () => {`);
      output.push(`    ${testFn}('should construct and expose expected behavior', () => {`);
      output.push('      // Arrange');
      output.push('      // const instance = new ClassUnderTest();');
      output.push('');
      output.push('      // Act');
      output.push('');
      output.push('      // Assert');
      output.push('    });');
      output.push('  });');
      return;
    }

    output.push(`  ${testFn}('should handle ${symbol.name}', () => {`);
    output.push('    // Arrange');
    output.push('    // const input = ...;');
    output.push('');
    output.push('    // Act');
    output.push(`    // const result = ${symbol.name}();`);
    output.push('');
    output.push('    // Assert');
    output.push('    // expect(result).toBeDefined();');
    output.push('  });');
  });

  output.push('});');
  output.push('```');
  return output.join('\n');
}

async function determineCoverageCommand(workingDir: string, framework: string, extraArgs: string): Promise<string> {
  const pkg = readPackageJson(workingDir);
  const suffix = extraArgs ? ` ${extraArgs}` : '';

  if (pkg?.scripts?.['test:coverage']) {
    return `npm run test:coverage${suffix ? ` --${suffix}` : ''}`;
  }
  if (pkg?.scripts?.['coverage']) {
    return `npm run coverage${suffix ? ` --${suffix}` : ''}`;
  }

  switch (framework) {
    case 'vitest':
      return `npx vitest run --coverage${suffix}`;
    case 'jest':
      return `npx jest --coverage${suffix}`;
    case 'mocha':
      return `npx nyc mocha${suffix || ' --reporter spec'}`;
    default:
      return `npm test -- --coverage${suffix}`;
  }
}

function readPackageJson(workingDir: string): PackageJson | null {
  const packageJsonPath = join(workingDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson;
}

function formatCoverageSummary(summary: CoverageSummary, path: string, workingDir: string): string {
  const relPath = path.startsWith(workingDir) ? path.slice(workingDir.length + 1) : path;
  const total = summary.total;
  const output: string[] = [];
  output.push(`# Coverage summary (${relPath})`);
  output.push('');
  output.push('| Metric | Covered | Total | % |');
  output.push('| --- | --- | --- | --- |');
  (['lines', 'statements', 'functions', 'branches'] as const).forEach((metric) => {
    const entry = total[metric];
    output.push(`| ${metric} | ${entry.covered} | ${entry.total} | ${entry.pct}% |`);
  });

  const detailedFiles = Object.entries(summary)
    .filter(([key]) => key !== 'total')
    .slice(0, 15);

  if (detailedFiles.length > 0) {
    output.push('');
    output.push('## Sample files');
    for (const [file, metrics] of detailedFiles) {
      const lines = metrics.lines as CoverageMetric | undefined;
      const pct = lines ? `${lines.pct}%` : 'n/a';
      output.push(`- ${file}: lines ${pct}`);
    }
  }

  return output.join('\n');
}
