import { spawn, ChildProcess } from 'node:child_process';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { buildError } from '../core/errors.js';

/**
 * Background Bash Shell Manager
 *
 * Manages long-running background bash shells with output buffering.
 */
class BackgroundShellManager {
  private shells = new Map<string, BackgroundShell>();
  private nextId = 1;

  createShell(command: string, workingDir: string): string {
    const shellId = `shell_${this.nextId++}`;
    const shell = new BackgroundShell(shellId, command, workingDir);
    this.shells.set(shellId, shell);
    shell.start();
    return shellId;
  }

  getShell(shellId: string): BackgroundShell | undefined {
    return this.shells.get(shellId);
  }

  killShell(shellId: string): boolean {
    const shell = this.shells.get(shellId);
    if (shell) {
      shell.kill();
      this.shells.delete(shellId);
      return true;
    }
    return false;
  }

  listShells(): string[] {
    return Array.from(this.shells.keys());
  }
}

class BackgroundShell {
  private process?: ChildProcess;
  private outputBuffer: string[] = [];
  private errorBuffer: string[] = [];
  private lastReadPosition = 0;
  private isRunning = false;
  private exitCode?: number;

  constructor(
    public readonly id: string,
    private command: string,
    private _workingDir: string
  ) {}

  start(): void {
    this.process = spawn('bash', ['-c', this.command], {
      cwd: this._workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.isRunning = true;

    this.process.stdout?.on('data', (data) => {
      this.outputBuffer.push(data.toString());
    });

    this.process.stderr?.on('data', (data) => {
      this.errorBuffer.push(data.toString());
    });

    this.process.on('exit', (code) => {
      this.exitCode = code ?? 0;
      this.isRunning = false;
    });
  }

  getNewOutput(filter?: RegExp): { stdout: string; stderr: string; status: string } {
    const allOutput = this.outputBuffer.join('');
    const newOutput = allOutput.substring(this.lastReadPosition);
    this.lastReadPosition = allOutput.length;

    const allError = this.errorBuffer.join('');

    let stdout = newOutput;
    if (filter) {
      const lines = newOutput.split('\n');
      const filtered = lines.filter(line => filter.test(line));
      stdout = filtered.join('\n');
    }

    const status = this.isRunning
      ? 'running'
      : `exited with code ${this.exitCode}`;

    return {
      stdout,
      stderr: allError,
      status,
    };
  }

  kill(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }

  getStatus(): string {
    return this.isRunning ? 'running' : `exited with code ${this.exitCode}`;
  }
}

// Global manager instance
const shellManager = new BackgroundShellManager();

/**
 * Creates background bash management tools
 *
 * Tools:
 * - Bash (with run_in_background): Start background processes
 * - BashOutput: Retrieve output from background shells
 * - KillShell: Terminate background shells
 *
 * @param _workingDir - The working directory for commands (reserved for future use)
 * @returns Array of tool definitions
 */
export function createBackgroundBashTools(_workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'BashOutput',
      description: 'Retrieves output from a running or completed background bash shell. Always returns only new output since the last check.',
      parameters: {
        type: 'object',
        properties: {
          bash_id: {
            type: 'string',
            description: 'The ID of the background shell to retrieve output from',
          },
          filter: {
            type: 'string',
            description: 'Optional regular expression to filter the output lines. Only lines matching this regex will be included.',
          },
        },
        required: ['bash_id'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const bashId = args['bash_id'];
        const filterStr = args['filter'];

        if (typeof bashId !== 'string' || !bashId.trim()) {
          return 'Error: bash_id must be a non-empty string.';
        }

        try {
          const shell = shellManager.getShell(bashId);
          if (!shell) {
            const available = shellManager.listShells();
            return `Error: Shell "${bashId}" not found.\n\nAvailable shells: ${available.length > 0 ? available.join(', ') : 'none'}`;
          }

          const filter = filterStr && typeof filterStr === 'string'
            ? new RegExp(filterStr)
            : undefined;

          const { stdout, stderr, status } = shell.getNewOutput(filter);

          const parts: string[] = [];
          parts.push(`Shell: ${bashId}`);
          parts.push(`Status: ${status}`);

          if (stdout) {
            parts.push('\n=== New Output ===');
            parts.push(stdout);
          }

          if (stderr) {
            parts.push('\n=== Errors ===');
            parts.push(stderr);
          }

          if (!stdout && !stderr) {
            parts.push('\n(No new output)');
          }

          return parts.join('\n');

        } catch (error: any) {
          return buildError('retrieving shell output', error, { bash_id: bashId });
        }
      },
    },
    {
      name: 'KillShell',
      description: 'Kills a running background bash shell by its ID. Returns success or failure status.',
      parameters: {
        type: 'object',
        properties: {
          shell_id: {
            type: 'string',
            description: 'The ID of the background shell to kill',
          },
        },
        required: ['shell_id'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const shellId = args['shell_id'];

        if (typeof shellId !== 'string' || !shellId.trim()) {
          return 'Error: shell_id must be a non-empty string.';
        }

        try {
          const success = shellManager.killShell(shellId);

          if (success) {
            return `✓ Shell "${shellId}" has been terminated.`;
          } else {
            const available = shellManager.listShells();
            return `Error: Shell "${shellId}" not found.\n\nAvailable shells: ${available.length > 0 ? available.join(', ') : 'none'}`;
          }

        } catch (error: any) {
          return buildError('killing shell', error, { shell_id: shellId });
        }
      },
    },
  ];
}

/**
 * Start a background bash command
 *
 * This should be integrated into the main Bash tool with a run_in_background parameter.
 * For now, it's exported as a helper function.
 */
export function startBackgroundShell(command: string, workingDir: string): string {
  return shellManager.createShell(command, workingDir);
}
