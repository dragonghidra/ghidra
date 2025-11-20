import { SessionEvent, SessionSnapshot } from '../../shared/session-models';
import { PersistenceAdapter } from './persistence-adapter';
import { reduceSnapshot } from '../session/snapshot-reducer';

export interface JsonlStoreConfig {
  url: string;
  pollIntervalMs?: number;
  label?: string;
}

export class JsonlStoreAdapter implements PersistenceAdapter {
  private snapshot: SessionSnapshot | null = null;
  private events: SessionEvent[] = [];
  private pollHandle?: NodeJS.Timeout;

  constructor(private readonly config: JsonlStoreConfig) {}

  async bootstrap(): Promise<SessionSnapshot> {
    const events = await this.fetchEvents();
    this.events = events;
    events.forEach((event) => {
      this.snapshot = reduceSnapshot(this.snapshot, event);
    });

    if (!this.snapshot) {
      throw new Error('JSONL store did not include a session snapshot event.');
    }

    return this.snapshot;
  }

  async subscribe(handler: (event: SessionEvent) => void): Promise<() => void> {
    const interval = this.config.pollIntervalMs ?? 5000;
    this.pollHandle = setInterval(async () => {
      const events = await this.fetchEvents();
      if (events.length <= this.events.length) {
        return;
      }

      const newEvents = events.slice(this.events.length);
      this.events = events;
      newEvents.forEach((event) => {
        this.snapshot = reduceSnapshot(this.snapshot, event);
        handler(event);
      });
    }, interval);

    return () => {
      if (this.pollHandle) {
        clearInterval(this.pollHandle);
      }
    };
  }

  private async fetchEvents(): Promise<SessionEvent[]> {
    const response = await fetch(this.config.url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to fetch JSONL store (${response.status})`);
    }

    const text = await response.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.map((line) => JSON.parse(line) as SessionEvent);
  }
}
