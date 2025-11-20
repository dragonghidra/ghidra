import type { Request } from 'express';
import admin from 'firebase-admin';
import { timingSafeEqual } from 'node:crypto';
import { hashSecret, SessionAccessConfig } from '../config/runtime-config';

const PASS_HEADER = 'x-session-passphrase';
const PASS_QUERY_KEY = 'passphrase';
const FIREBASE_HEADER = 'authorization';
const FIREBASE_QUERY_KEY = 'firebaseIdToken';

let firebaseInitialized = false;

const ensureFirebaseApp = (): void => {
  if (firebaseInitialized) {
    return;
  }

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  firebaseInitialized = true;
};

export interface SessionAccessPayload {
  passphrase?: string;
  firebaseIdToken?: string;
}

export class SessionAccessController {
  constructor(private readonly policy: SessionAccessConfig) {}

  async assertAuthorized(req: Request): Promise<void> {
    switch (this.policy.mode) {
      case 'public':
        return;
      case 'passphrase':
        this.assertPassphraseValue(this.extractPassphraseFromRequest(req));
        return;
      case 'firebase':
        await this.verifyFirebaseToken(this.extractFirebaseTokenFromRequest(req));
        return;
      default:
        throw new Error(`Unsupported session access mode ${this.policy.mode}`);
    }
  }

  async assertPayload(payload: SessionAccessPayload): Promise<void> {
    switch (this.policy.mode) {
      case 'public':
        return;
      case 'passphrase':
        this.assertPassphraseValue(payload.passphrase);
        return;
      case 'firebase':
        await this.verifyFirebaseToken(payload.firebaseIdToken);
        return;
      default:
        throw new Error(`Unsupported session access mode ${this.policy.mode}`);
    }
  }

  private assertPassphraseValue(passphrase: string | undefined): void {
    if (!this.policy.passphraseHash) {
      throw new Error('Passphrase hash not configured for this session.');
    }

    if (!passphrase) {
      throw new Error('Session passphrase required.');
    }

    const hashed = hashSecret(passphrase);
    if (!timingSafeEqual(Buffer.from(hashed), Buffer.from(this.policy.passphraseHash))) {
      throw new Error('Invalid session passphrase.');
    }
  }

  private async verifyFirebaseToken(token: string | undefined): Promise<void> {
    if (!token) {
      throw new Error('Firebase ID token is required for this session.');
    }

    ensureFirebaseApp();
    await admin.auth().verifyIdToken(token);
  }

  private extractPassphraseFromRequest(req: Request): string | undefined {
    return (
      req.header(PASS_HEADER) ??
      (typeof req.query[PASS_QUERY_KEY] === 'string' ? (req.query[PASS_QUERY_KEY] as string) : undefined)
    );
  }

  private extractFirebaseTokenFromRequest(req: Request): string | undefined {
    return (
      this.extractBearerToken(req.header(FIREBASE_HEADER)) ??
      (typeof req.query[FIREBASE_QUERY_KEY] === 'string'
        ? (req.query[FIREBASE_QUERY_KEY] as string)
        : undefined)
    );
  }

  private extractBearerToken(headerValue: string | undefined): string | undefined {
    if (!headerValue) {
      return undefined;
    }

    const [scheme, value] = headerValue.split(' ');
    if (scheme?.toLowerCase() === 'bearer' && value) {
      return value;
    }

    return undefined;
  }
}
