import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import {
  Agent,
  ChatMessage,
  SessionCommandPayload,
  SessionEvent,
  SessionSnapshot,
} from '../../shared/session-models';
import { LocalCliConfig } from '../config/runtime-config';
import { AgentGateway } from './gateway';

export class LocalCliGateway implements AgentGateway {
  readonly source = 'local-cli';
  readonly label = 'local APT CLI bridge';
  private child?: ChildProcessWithoutNullStreams;
  private readonly expectJsonOutput: boolean;

  constructor(private readonly config: LocalCliConfig) {
    this.expectJsonOutput = config.expectJson ?? true;
  }

  async bootstrap(): Promise<SessionSnapshot> {
    return {
      sessionId: this.config.sessionId ?? 'local-cli',
      source: 'local-cli',
      chatMessages: [],
      streamMeters: [
        {
          label: 'APT CLI',
          value: 'starting',
          detail: this.config.command,
          tone: 'info'
        }
      ],
      opsEvents: [],
      shortcuts: [],
      status: {
        label: 'local CLI bridge',
        detail: `watching: ${this.config.command}`,
        tone: 'info'
      }
    };
  }

  async start(eventHandler: (event: SessionEvent) => void): Promise<() => void> {
    this.child = spawn(this.config.command, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      shell: true
    });

    const stdout = createInterface({ input: this.child.stdout });
    stdout.on('line', (line) => {
      const event = this.parseEvent(line);
      if (event) {
        eventHandler(event);
      }
    });

    this.child.stderr?.on('data', (chunk) => {
      eventHandler({
        type: 'chat-message',
        payload: this.buildMessage(chunk.toString(), 'apt', 'stderr')
      });
    });

    this.child.on('close', (code) => {
      eventHandler({
        type: 'status',
        payload: {
          label: 'CLI exited',
          detail: `process finished with code ${code ?? 'unknown'}`,
          tone: 'warn'
        }
      });
    });

    return () => {
      stdout.close();
      this.child?.kill();
    };
  }

  async sendCommand(command: SessionCommandPayload): Promise<void> {
    if (!this.child || !this.child.stdin) {
      throw new Error('CLI process is not ready to receive commands.');
    }

    this.child.stdin.write(`${command.text}\n`);
  }

  private parseEvent(line: string): SessionEvent | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    if (this.expectJsonOutput) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.type) {
          return parsed as SessionEvent;
        }
      } catch {
      }
    }

    return {
      type: 'chat-message',
      payload: this.buildMessage(trimmed, 'apt', 'stdout')
    };
  }

  private buildMessage(text: string, agent: Agent, stream: string): ChatMessage {
    return {
      id: randomUUID(),
      agent,
      timestamp: new Date().toISOString().split('T')[1]?.split('.')[0] ?? '',
      title: `${agent} · ${stream}`,
      caption: this.config.command,
      status: 'stream',
      body: text.split(/\r?\n/)
    };
  }
}