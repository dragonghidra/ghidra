import { SessionEvent, SessionSnapshot, SessionCommandPayload } from '../../shared/session-models';
import { PersistenceAdapter } from './persistence-adapter';
import { reduceSnapshot } from '../session/snapshot-reducer';

export interface TemporalWorkflowConfig {
  historyUrl: string;
  commandUrl?: string;
  pollIntervalMs?: number;
}

interface TemporalHistoryResponse {
  snapshot?: SessionSnapshot;
  events: SessionEvent[];
}

export class TemporalWorkflowAdapter implements PersistenceAdapter {
  private snapshot: SessionSnapshot | null = null;
  private lastEventIndex = 0;
  private pollHandle?: NodeJS.Timeout;

  constructor(private readonly config: TemporalWorkflowConfig) {}

  async bootstrap(): Promise<SessionSnapshot> {
    const history = await this.fetchHistory();
    this.snapshot = history.snapshot ?? null;
    history.events.forEach((event) => {
      this.snapshot = reduceSnapshot(this.snapshot, event);
      this.lastEventIndex++;
    });

    if (!this.snapshot) {
      throw new Error('Temporal history endpoint did not return a session snapshot.');
    }

    return this.snapshot;
  }

  async subscribe(handler: (event: SessionEvent) => void): Promise<() => void> {
    const interval = this.config.pollIntervalMs ?? 4000;
    this.pollHandle = setInterval(async () => {
      const history = await this.fetchHistory();
      const newEvents = history.events.slice(this.lastEventIndex);
      newEvents.forEach((event) => {
        this.snapshot = reduceSnapshot(this.snapshot, event);
        handler(event);
        this.lastEventIndex++;
      });
    }, interval);

    return () => {
      if (this.pollHandle) {
        clearInterval(this.pollHandle);
      }
    };
  }

  async sendCommand(payload: SessionCommandPayload): Promise<void> {
    if (!this.config.commandUrl) {
      throw new Error('No command URL configured for Temporal workflow adapter.');
    }

    await fetch(this.config.commandUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  private async fetchHistory(): Promise<TemporalHistoryResponse> {
    const response = await fetch(this.config.historyUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Temporal history request failed (${response.status})`);
    }

    return (await response.json()) as TemporalHistoryResponse;
  }
}
