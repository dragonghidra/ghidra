import { randomUUID } from 'node:crypto';
import { promises as fsPromises, watch } from 'node:fs';
import { basename, dirname } from 'node:path';
import {
  ChatMessage,
  OpsEvent,
  SessionEvent,
  SessionSnapshot,
  SessionStatus,
  Shortcut,
  StreamMeter,
} from '../../shared/session-models';
import { MirrorFileConfig } from '../config/runtime-config';
import { AgentGateway } from './gateway';

type MirrorStream = 'stdout' | 'stderr';

interface MirrorEntry {
  type: 'start' | 'stdout' | 'stderr' | 'exit' | 'error' | 'extension';
  data?: Record<string, unknown>;
  at?: string;
}

type Handler = (event: SessionEvent) => void;

export class MirrorFileGateway implements AgentGateway {
  readonly source = 'mirror-file';
  readonly label = 'apt mirror log tail';

  private readonly shortcuts: Shortcut[] = [
    { keys: 'Shift+Enter', description: 'Send immediately to APT CLI' },
    { keys: 'Cmd+.', description: 'Interrupt active response' },
    { keys: 'Ctrl+L', description: 'Center terminal focus' },
  ];

  private readonly fileDir: string;
  private readonly fileName: string;
  private readonly defaultMeters: StreamMeter[];

  private streamMeters: StreamMeter[];
  private status: SessionStatus;
  private opsEvents: OpsEvent[] = [];
  private chatMessages: ChatMessage[] = [];
  private watcher?: ReturnType<typeof watch>;
  private queuedTail: Promise<void> | null = null;
  private fileCharacters = 0;
  private lineBuffer = '';
  private readonly streamBuffers: Record<MirrorStream, string> = {
    stdout: '',
    stderr: '',
  };
  private readonly maxMessages = 400;
  private readonly maxOpsEvents = 8;

  constructor(private readonly config: MirrorFileConfig) {
    this.fileDir = dirname(config.file);
    this.fileName = basename(config.file);
    this.defaultMeters = [
      {
        label: 'Mirror file',
        value: this.fileName,
        detail: this.config.file,
        tone: 'info',
      },
    ];
    this.streamMeters = [...this.defaultMeters];
    this.status = {
      label: 'waiting for APT mirror',
      detail: `tailing ${this.fileName}`,
      tone: 'info',
    };
  }

  async bootstrap(): Promise<SessionSnapshot> {
    const contents = await this.safeReadFile();
    this.fileCharacters = contents.length;
    this.processChunk(contents, false);
    return this.snapshot();
  }

  async start(handler: Handler): Promise<() => void> {
    this.queueTail(handler);

    this.watcher = watch(this.fileDir, (_, changedName) => {
      if (changedName && changedName !== this.fileName) {
        return;
      }
      this.queueTail(handler);
    });

    return () => {
      this.watcher?.close();
      this.watcher = undefined;
    };
  }

  private queueTail(handler: Handler): void {
    const next = (this.queuedTail ?? Promise.resolve()).then(() => this.tailFile(handler));
    this.queuedTail = next
      .catch((error) => {
        this.emitStatus(
          {
            label: 'mirror error',
            detail: error instanceof Error ? error.message : String(error),
            tone: 'warn',
          },
          handler,
        );
      })
      .finally(() => {
        if (this.queuedTail === next) {
          this.queuedTail = null;
        }
      });
  }

  private async tailFile(handler: Handler): Promise<void> {
    const contents = await this.safeReadFile();
    if (!contents || contents.length === this.fileCharacters) {
      return;
    }

    if (contents.length < this.fileCharacters) {
      this.resetState();
      this.fileCharacters = contents.length;
      this.processChunk(contents, false);
      handler({ type: 'session', payload: this.snapshot() });
      return;
    }

    const delta = contents.slice(this.fileCharacters);
    this.fileCharacters = contents.length;
    this.processChunk(delta, true, handler);
  }

  private async safeReadFile(): Promise<string> {
    try {
      return await fsPromises.readFile(this.config.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return '';
      }
      throw error;
    }
  }

  private processChunk(chunk: string, emit = false, handler?: Handler): void {
    if (!chunk) {
      return;
    }

    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() ?? '';
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        const entry = JSON.parse(trimmed) as MirrorEntry;
        this.applyEntry(entry, emit, handler);
      } catch (error) {
        console.warn('Failed to parse mirror entry', error);
      }
    });
  }

  private applyEntry(entry: MirrorEntry, emit: boolean, handler?: Handler): void {
    switch (entry.type) {
      case 'start':
        this.handleStartEntry(entry, emit, handler);
        break;
      case 'stdout':
      case 'stderr':
        this.handleStreamEntry(entry.type, entry, emit, handler);
        break;
      case 'exit':
        this.flushPendingStreams(entry.at, emit, handler);
        this.handleExitEntry(entry, emit, handler);
        break;
      case 'error':
        this.flushPendingStreams(entry.at, emit, handler);
        this.handleErrorEntry(entry, emit, handler);
        break;
      case 'extension':
        this.handleExtensionEntry(entry, emit, handler);
        break;
    }
  }

  private handleExtensionEntry(entry: MirrorEntry, emit: boolean, handler?: Handler): void {
    if (!entry.data) {
      return;
    }

    const messageId = typeof entry.data['messageId'] === 'string' ? entry.data['messageId'] : undefined;
    if (!messageId) {
      return;
    }

    const payload = {
      id: typeof entry.data['id'] === 'string' ? entry.data['id'] : randomUUID(),
      kind: typeof entry.data['kind'] === 'string' ? entry.data['kind'] : 'custom-extension',
      data: (typeof entry.data['data'] === 'object' && entry.data['data'] !== null
        ? entry.data['data']
        : { raw: entry.data }) as Record<string, unknown>,
      label: typeof entry.data['label'] === 'string' ? entry.data['label'] : undefined,
      description: typeof entry.data['description'] === 'string' ? entry.data['description'] : undefined,
      messageId
    };

    if (emit && handler) {
      handler({ type: 'extension', payload });
    } else {
      this.chatMessages = this.chatMessages.map((message) => {
        if (message.id !== messageId) {
          return message;
        }

        const nextExtensions = [...(message.extensions ?? []).filter((extension) => extension.id !== payload.id), payload];
        return { ...message, extensions: nextExtensions };
      });
    }
  }

  private handleStartEntry(entry: MirrorEntry, emit: boolean, handler?: Handler): void {
    const data = entry.data ?? {};
    const workspace = typeof data['workspace'] === 'string' ? data['workspace'] : undefined;
    const argv = Array.isArray(data['argv']) ? data['argv'].map(String).join(' ') : 'apt';

    this.streamMeters = [
      {
        label: 'Workspace',
        value: workspace ? basename(workspace) : 'unknown',
        detail: workspace ?? 'workspace not reported',
        tone: 'info',
      },
      {
        label: 'Mirror file',
        value: this.fileName,
        detail: this.config.file,
        tone: 'success',
      },
    ];

    this.status = {
      label: 'apt session connected',
      detail: argv,
      tone: 'success',
    };

    this.pushOpsEvent(
      {
        label: 'apt start',
        detail: argv,
        meta: this.formatTimestamp(entry.at),
        tone: 'info',
      },
      emit,
      handler,
    );

    this.emitMeters(emit, handler);
    this.emitStatus(this.status, handler, emit);
  }

  private handleStreamEntry(stream: MirrorStream, entry: MirrorEntry, emit: boolean, handler?: Handler): void {
    const chunk = typeof entry.data?.['chunk'] === 'string' ? entry.data['chunk'] : '';
    if (!chunk) {
      return;
    }

    const normalized = chunk.replace(/\r\n/g, '\n');
    this.streamBuffers[stream] += normalized;
    const lines = this.streamBuffers[stream].split('\n');
    this.streamBuffers[stream] = lines.pop() ?? '';

    lines.forEach((line) => {
      const message = this.composeMessage(stream, line, entry.at);
      this.appendMessage(message);
      if (emit && handler) {
        handler({ type: 'chat-message', payload: message });
      }
    });
  }

  private handleExitEntry(entry: MirrorEntry, emit: boolean, handler?: Handler): void {
    const data = entry.data ?? {};
    const code = typeof data['code'] === 'number' ? data['code'] : undefined;
    const signal = typeof data['signal'] === 'string' ? data['signal'] : undefined;
    const detail = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
    const tone = code === 0 ? 'info' : 'warn';

    this.pushOpsEvent(
      {
        label: 'apt exit',
        detail,
        meta: this.formatTimestamp(entry.at),
        tone: code === 0 ? 'success' : 'warn',
      },
      emit,
      handler,
    );

    this.emitStatus(
      {
        label: 'apt session ended',
        detail,
        tone,
      },
      handler,
      emit,
    );
  }

  private handleErrorEntry(entry: MirrorEntry, emit: boolean, handler?: Handler): void {
    const detail = typeof entry.data?.['message'] === 'string' ? entry.data['message'] : 'unknown error';
    this.pushOpsEvent(
      {
        label: 'mirror error',
        detail,
        meta: this.formatTimestamp(entry.at),
        tone: 'warn',
      },
      emit,
      handler,
    );

    this.emitStatus(
      {
        label: 'apt session error',
        detail,
        tone: 'warn',
      },
      handler,
      emit,
    );
  }

  private flushPendingStreams(at?: string, emit?: boolean, handler?: Handler): void {
    (['stdout', 'stderr'] as MirrorStream[]).forEach((stream) => {
      const pending = this.streamBuffers[stream];
      if (!pending) {
        return;
      }

      this.streamBuffers[stream] = '';
      const message = this.composeMessage(stream, pending, at);
      this.appendMessage(message);
      if (emit && handler) {
        handler({ type: 'chat-message', payload: message });
      }
    });
  }

  private composeMessage(stream: MirrorStream, line: string, at?: string): ChatMessage {
    return {
      id: randomUUID(),
      agent: 'apt',
      timestamp: this.formatTimestamp(at),
      title: stream === 'stdout' ? 'apt cli · stdout' : 'apt cli · stderr',
      caption: this.config.sessionId,
      status: stream === 'stdout' ? 'stream' : 'stderr',
      body: [line.length ? line : ' '],
    };
  }

  private appendMessage(message: ChatMessage): void {
    this.chatMessages = [...this.chatMessages, message].slice(-this.maxMessages);
  }

  private pushOpsEvent(event: OpsEvent, emit: boolean, handler?: Handler): void {
    this.opsEvents = [...this.opsEvents.slice(-(this.maxOpsEvents - 1)), event];
    if (emit && handler) {
      handler({ type: 'ops-events', payload: this.opsEvents });
    }
  }

  private emitMeters(emit: boolean, handler?: Handler): void {
    if (emit && handler) {
      handler({ type: 'stream-meters', payload: this.streamMeters });
    }
  }

  private emitStatus(status: SessionStatus, handler?: Handler, emit = true): void {
    this.status = status;
    if (emit && handler) {
      handler({ type: 'status', payload: status });
    }
  }

  private snapshot(): SessionSnapshot {
    return {
      sessionId: this.config.sessionId,
      source: 'mirror-file',
      chatMessages: [...this.chatMessages],
      streamMeters: [...this.streamMeters],
      opsEvents: [...this.opsEvents],
      shortcuts: [...this.shortcuts],
      status: this.status ? { ...this.status } : undefined,
    };
  }

  private resetState(): void {
    this.chatMessages = [];
    this.opsEvents = [];
    this.lineBuffer = '';
    this.streamBuffers.stdout = '';
    this.streamBuffers.stderr = '';
    this.streamMeters = [...this.defaultMeters];
    this.status = {
      label: 'replaying mirror',
      detail: this.fileName,
      tone: 'info',
    };
  }

  private formatTimestamp(isoValue?: string): string {
    const date = isoValue ? new Date(isoValue) : new Date();
    const parts = date.toTimeString().split(' ')[0];
    return parts;
  }
}
