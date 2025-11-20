import { randomBytes } from 'node:crypto';

interface SessionTokenRecord {
  sessionId: string;
  expiresAt: number;
}

export class SessionTokenStore {
  private readonly tokens = new Map<string, SessionTokenRecord>();

  constructor(private readonly ttlMs = 1000 * 60 * 60) {}

  issue(sessionId: string): string {
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.ttlMs;
    this.tokens.set(token, { sessionId, expiresAt });
    return token;
  }

  validate(token: string | undefined, sessionId: string): boolean {
    if (!token) {
      return false;
    }

    const record = this.tokens.get(token);
    if (!record) {
      return false;
    }

    if (record.sessionId !== sessionId || record.expiresAt < Date.now()) {
      this.tokens.delete(token);
      return false;
    }

    return true;
  }

  clear(token: string): void {
    this.tokens.delete(token);
  }

  get ttl(): number {
    return this.ttlMs;
  }
}

export const buildSessionCookieName = (sessionId: string): string =>
  `apt_session_${encodeURIComponent(sessionId)}`;
