import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ToolDefinition } from '../core/toolRuntime.js';

const execAsync = promisify(exec);

export interface PackageInfo {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export function createDevTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'run_tests',
      description: 'Execute test suite using npm test or other test runners',
      parameters: {
        type: 'object',
        properties: {
          testPattern: {
            type: 'string',
            description: 'Optional test pattern or file to run specific tests',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 60000)',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const testPatternArg = args['testPattern'];
        const testPattern =
          typeof testPatternArg === 'string' && testPatternArg.trim() ? testPatternArg.trim() : undefined;
        const timeoutArg = args['timeout'];
        const timeout =
          typeof timeoutArg === 'number' && Number.isFinite(timeoutArg) && timeoutArg > 0 ? timeoutArg : 60000;

        try {
          // Check if package.json exists
          const packageJsonPath = join(workingDir, 'package.json');
          if (!existsSync(packageJsonPath)) {
            return 'Error: package.json not found. Cannot run tests.';
          }

          // Build test command
          let command = 'npm test';
          if (testPattern) {
            // Try to detect test runner and build appropriate command
            const packageInfo = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageInfo;
            const scripts = packageInfo.scripts || {};
            const testScript = scripts['test'] ?? '';

            if (testScript.includes('jest')) {
              command = `npx jest ${testPattern}`;
            } else if (testScript.includes('vitest')) {
              command = `npx vitest run ${testPattern}`;
            } else if (testScript.includes('mocha')) {
              command = `npx mocha ${testPattern}`;
            } else {
              // Fallback to npm test with pattern
              command = `npm test -- ${testPattern}`;
            }
          }

          const { stdout, stderr } = await execAsync(command, {
            cwd: workingDir,
            timeout,
            maxBuffer: 1024 * 1024 * 10, // 10MB
          });

          let result = `Test command: ${command}\n\n`;
          if (stdout) result += `stdout:\n${stdout}\n`;
          if (stderr) result += `stderr:\n${stderr}\n`;

          return result || 'Tests completed (no output)';
        } catch (error: any) {
          if (error.killed) {
            return `Error: Test command timed out after ${timeout}ms`;
          }
          return `Error running tests: ${error.message}\nstderr: ${error.stderr || 'none'}`;
        }
      },
    },
    {
      name: 'install_dependencies',
      description: 'Install project dependencies using npm, yarn, or pnpm',
      parameters: {
        type: 'object',
        properties: {
          packageManager: {
            type: 'string',
            enum: ['npm', 'yarn', 'pnpm'],
            description: 'Package manager to use (default: npm)',
          },
          production: {
            type: 'boolean',
            description: 'Install only production dependencies',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const packageManager = typeof args['packageManager'] === 'string' ? args['packageManager'] : 'npm';
        const production = args['production'] === true;

        try {
          let command: string;
          if (packageManager === 'npm') {
            command = production ? 'npm ci --production' : 'npm ci';
          } else if (packageManager === 'yarn') {
            command = production ? 'yarn install --production' : 'yarn install';
          } else if (packageManager === 'pnpm') {
            command = production ? 'pnpm install --prod' : 'pnpm install';
          } else {
            return `Error: Unsupported package manager: ${packageManager}`;
          }

          const { stdout, stderr } = await execAsync(command, {
            cwd: workingDir,
            timeout: 300000, // 5 minutes
            maxBuffer: 1024 * 1024 * 10,
          });

          let result = `Dependency installation command: ${command}\n\n`;
          if (stdout) result += `stdout:\n${stdout}\n`;
          if (stderr) result += `stderr:\n${stderr}\n`;

          return result || 'Dependencies installed successfully (no output)';
        } catch (error: any) {
          if (error.killed) {
            return 'Error: Dependency installation timed out';
          }
          return `Error installing dependencies: ${error.message}\nstderr: ${error.stderr || 'none'}`;
        }
      },
    },
    {
      name: 'check_package_info',
      description: 'Get information about project dependencies and scripts from package.json',
      parameters: {
        type: 'object',
        properties: {
          detail: {
            type: 'string',
            enum: ['basic', 'dependencies', 'scripts', 'full'],
            description: 'Level of detail to include',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const detailArg = args['detail'];
        const detail = typeof detailArg === 'string' && detailArg.trim() ? detailArg : 'basic';

        try {
          const packageJsonPath = join(workingDir, 'package.json');
          if (!existsSync(packageJsonPath)) {
            return 'Error: package.json not found';
          }

          const packageInfo = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageInfo;
          const output: string[] = [];

          output.push(`# Package Info: ${packageInfo.name || 'Unnamed'} v${packageInfo.version || 'Unknown'}`);
          output.push('');

          if (detail === 'basic' || detail === 'full') {
            output.push('## Basic Info');
            output.push(`- Name: ${packageInfo.name || 'Not specified'}`);
            output.push(`- Version: ${packageInfo.version || 'Not specified'}`);
            output.push('');
          }

          if ((detail === 'scripts' || detail === 'full') && packageInfo.scripts) {
            output.push('## Scripts');
            Object.entries(packageInfo.scripts).forEach(([name, script]) => {
              output.push(`- ${name}: ${script}`);
            });
            output.push('');
          }

          if ((detail === 'dependencies' || detail === 'full') && packageInfo.dependencies) {
            output.push('## Dependencies');
            Object.entries(packageInfo.dependencies).forEach(([name, version]) => {
              output.push(`- ${name}: ${version}`);
            });
            output.push('');
          }

          if ((detail === 'dependencies' || detail === 'full') && packageInfo.devDependencies) {
            output.push('## Dev Dependencies');
            Object.entries(packageInfo.devDependencies).forEach(([name, version]) => {
              output.push(`- ${name}: ${version}`);
            });
            output.push('');
          }

          return output.join('\n');
        } catch (error) {
          return `Error reading package.json: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'run_build',
      description: 'Execute build process using npm run build or other build commands',
      parameters: {
        type: 'object',
        properties: {
          buildCommand: {
            type: 'string',
            description: 'Custom build command (defaults to npm run build)',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 300000)',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const buildCommandArg = args['buildCommand'];
        const buildCommand =
          typeof buildCommandArg === 'string' && buildCommandArg.trim()
            ? buildCommandArg
            : 'npm run build';
        const timeoutArg = args['timeout'];
        const timeout =
          typeof timeoutArg === 'number' && Number.isFinite(timeoutArg) && timeoutArg > 0 ? timeoutArg : 300000; // 5 minutes

        try {
          const { stdout, stderr } = await execAsync(buildCommand, {
            cwd: workingDir,
            timeout,
            maxBuffer: 1024 * 1024 * 10,
          });

          let result = `Build command: ${buildCommand}\n\n`;
          if (stdout) result += `stdout:\n${stdout}\n`;
          if (stderr) result += `stderr:\n${stderr}\n`;

          return result || 'Build completed (no output)';
        } catch (error: any) {
          if (error.killed) {
            return `Error: Build command timed out after ${timeout}ms`;
          }
          return `Error running build: ${error.message}\nstderr: ${error.stderr || 'none'}`;
        }
      },
    },
  ];
}
