import type { RedisClientType } from 'redis';
import { createClient } from 'redis';
import { SessionEvent, SessionSnapshot } from '../../shared/session-models';
import { PersistenceAdapter } from './persistence-adapter';
import { reduceSnapshot } from '../session/snapshot-reducer';

export interface RedisStreamConfig {
  url: string;
  streamKey: string;
  pollIntervalMs?: number;
  readCount?: number;
}

interface RedisStreamEntry {
  id: string;
  data: SessionEvent;
}

export class RedisStreamAdapter implements PersistenceAdapter {
  private client?: RedisClientType;
  private snapshot: SessionSnapshot | null = null;
  private lastId = '0-0';

  constructor(private readonly config: RedisStreamConfig) {}

  async bootstrap(): Promise<SessionSnapshot> {
    this.client = createClient({ url: this.config.url });
    await this.client.connect();
    const entries = await this.readRange('-', '+');
    entries.forEach((entry) => {
      this.snapshot = reduceSnapshot(this.snapshot, entry.data);
      this.lastId = entry.id;
    });

    if (!this.snapshot) {
      throw new Error('Redis stream does not contain a session snapshot event.');
    }

    return this.snapshot;
  }

  async subscribe(handler: (event: SessionEvent) => void): Promise<() => void> {
    const interval = this.config.pollIntervalMs ?? 3000;
    const timer = setInterval(async () => {
      const entries = await this.readRange(this.lastId, '+');
      for (const entry of entries) {
        if (entry.id === this.lastId) {
          continue;
        }

        this.snapshot = reduceSnapshot(this.snapshot, entry.data);
        handler(entry.data);
        this.lastId = entry.id;
      }
    }, interval);

    return () => {
      clearInterval(timer);
      this.client?.disconnect().catch(() => {});
    };
  }

  private async readRange(start: string, end: string): Promise<RedisStreamEntry[]> {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    const records = await this.client.xRange(this.config.streamKey, start, end, {
      COUNT: this.config.readCount ?? 200
    });

    return records.map((record) => {
      const payload = record.message['event'];
      if (!payload) {
        throw new Error('Redis stream entry missing "event" field');
      }

      return {
        id: record.id,
        data: JSON.parse(payload as string) as SessionEvent
      };
    });
  }
}
