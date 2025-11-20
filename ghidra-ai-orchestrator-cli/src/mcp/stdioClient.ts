import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import type { McpServerConfig, McpToolCallResult, McpToolDescription } from './types.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
  timer: NodeJS.Timeout;
}

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpStdioClient {
  readonly id: string;
  readonly description?: string;
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private ready: Promise<void>;
  private disposed = false;
  private stderrLog: string[] = [];

  constructor(config: McpServerConfig, workingDir: string) {
    this.id = config.id;
    this.description = config.description;
    this.process = spawn(config.command, config.args, {
      cwd: config.cwd ?? workingDir,
      env: { ...process.env, ...config.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process.stdout.on('data', (chunk) => this.handleStdout(chunk as Buffer));
    this.process.stderr.on('data', (chunk) => this.handleStderr(chunk as Buffer));
    this.process.on('exit', (code, signal) => {
      if (!this.disposed) {
        const message = signal
          ? `MCP server "${this.id}" exited via signal ${signal}.`
          : `MCP server "${this.id}" exited with code ${code}.`;
        this.rejectAll(new Error(message));
      }
    });

    this.ready = this.initialize();
  }

  async listTools(): Promise<McpToolDescription[]> {
    await this.ready;
    const response = (await this.sendRequest('tools/list', {})) as { tools?: McpToolDescription[] };
    return response?.tools ?? [];
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    await this.ready;
    const response = (await this.sendRequest('tools/call', {
      name: toolName,
      arguments: args ?? {},
    })) as McpToolCallResult;
    return response;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectAll(new Error(`MCP server "${this.id}" disposed.`));
    this.process.kill();
    await once(this.process, 'close').catch(() => {});
  }

  private async initialize(): Promise<void> {
    await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
      clientInfo: {
        name: 'APT CLI',
        version: process.env['APT_VERSION'] ?? process.env['EROSOLAR_VERSION'] ?? 'dev',
      },
    });
    await this.sendNotification('notifications/initialized', {});
  }

  private async sendRequest(method: string, params: unknown): Promise<unknown> {
    if (this.disposed) {
      throw new Error(`MCP server "${this.id}" is not running.`);
    }
    const id = this.nextId++;
    const payload: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };
    const serialized = JSON.stringify(payload);
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(serialized, 'utf8')}\r\n\r\n${serialized}`);

    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Timed out waiting for "${method}" from MCP server "${this.id}".`));
        }
      }, 60_000);

      this.pending.set(id, { resolve, reject, method, timer });
    });
  }

  private async sendNotification(method: string, params: unknown): Promise<void> {
    if (this.disposed) {
      return;
    }
    const payload: JsonRpcMessage = {
      jsonrpc: '2.0',
      method,
      params,
    };
    const serialized = JSON.stringify(payload);
    this.process.stdin.write(`Content-Length: ${Buffer.byteLength(serialized, 'utf8')}\r\n\r\n${serialized}`);
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      let headerIndex = this.buffer.indexOf('\r\n\r\n');
      let delimiterLength = 4;
      if (headerIndex === -1) {
        headerIndex = this.buffer.indexOf('\n\n');
        delimiterLength = 2;
      }
      if (headerIndex === -1) {
        break;
      }
      const header = this.buffer.slice(0, headerIndex).toString('utf8');
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerIndex + 4);
        continue;
      }
      const bodyLength = Number(lengthMatch[1]);
      const totalLength = headerIndex + delimiterLength + bodyLength;
      if (this.buffer.length < totalLength) {
        break;
      }
      const body = this.buffer.slice(headerIndex + delimiterLength, totalLength).toString('utf8');
      this.buffer = this.buffer.slice(totalLength);
      this.handleMessage(body);
    }
  }

  private handleStderr(chunk: Buffer): void {
    const text = chunk.toString('utf8').trim();
    if (!text) {
      return;
    }
    this.stderrLog.push(text);
    if (this.stderrLog.length > 5) {
      this.stderrLog.shift();
    }
  }

  private handleMessage(payload: string): void {
    try {
      const message = JSON.parse(payload) as JsonRpcMessage;
      if (typeof message.id === 'number' && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          const errorMessage = message.error.message || `MCP server "${this.id}" returned an error.`;
          const details = this.stderrLog.length ? `\n${this.stderrLog.join('\n')}` : '';
          pending.reject(new Error(`${errorMessage}${details}`));
        } else {
          pending.resolve(message.result);
        }
        return;
      }

      if (message.method === 'notifications/tools/list_changed') {
        // Tool list changed notification; callers can refresh by calling listTools again.
        return;
      }
    } catch {
      // Ignore malformed messages.
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
