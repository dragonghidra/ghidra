import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { DestroyRef, Injectable, PLATFORM_ID, Signal, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ChatMessage,
  SessionCommandPayload,
  SessionEvent,
  SessionSnapshot,
  StreamMeter,
} from '../../shared/session-models';

@Injectable({ providedIn: 'root' })
export class AgentSessionService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly snapshotState = signal<SessionSnapshot | null>(null);
  private readonly loadingState = signal(true);
  private readonly errorState = signal<string | null>(null);
  private readonly passphraseStorageKey = 'apt-session-passphrase';
  private readonly passphraseState = signal<string>(this.readStoredPassphrase());
  private readonly firebaseTokenStorageKey = 'apt-session-firebase-token';
  private readonly firebaseTokenState = signal<string | null>(this.readStoredFirebaseToken());
  private readonly sessionIdState = signal<string | null>(this.readInitialSessionId());

  private eventSource?: EventSource;
  private reconnectHandle?: ReturnType<typeof setTimeout>;
  private connectionInFlight = false;
  private readonly retryDelayMs = 5000;
  private accessExchange: Promise<void> | null = null;
  private lastAccessKey: string | null = null;
  private lastAccessTimestamp = 0;
  private readonly accessTtlMs = 1000 * 60 * 30;

  readonly snapshot: Signal<SessionSnapshot | null> = this.snapshotState.asReadonly();
  readonly isLoading = this.loadingState.asReadonly();
  readonly errorMessage = this.errorState.asReadonly();

  readonly chatMessages: Signal<ChatMessage[]> = computed(() => this.snapshotState()?.chatMessages ?? []);

  readonly streamMeters: Signal<StreamMeter[]> = computed(() => this.snapshotState()?.streamMeters ?? []);

  readonly opsEvents = computed(() => this.snapshotState()?.opsEvents ?? []);
  readonly shortcuts = computed(() => this.snapshotState()?.shortcuts ?? []);
  readonly status = computed(() => this.snapshotState()?.status);
  readonly sessionId = this.sessionIdState.asReadonly();
  readonly passphrase = this.passphraseState.asReadonly();

  constructor() {
    if (this.isBrowser) {
      this.bootstrap();
      this.openEventStream();
    } else {
      this.loadingState.set(false);
    }

    this.destroyRef.onDestroy(() => {
      this.eventSource?.close();
      if (this.reconnectHandle) {
        clearTimeout(this.reconnectHandle);
      }
    });
  }

  async sendCommand(payload: SessionCommandPayload): Promise<void> {
    const options = this.buildRequestOptions();
    await firstValueFrom(this.http.post('/api/session/commands', payload, options));
  }

  setSessionId(sessionId: string | null): void {
    this.sessionIdState.set(sessionId);
    this.lastAccessKey = null;
    this.triggerAccessSync(true);
  }

  setPassphrase(passphrase: string): void {
    this.passphraseState.set(passphrase);
    if (this.isBrowser) {
      localStorage.setItem(this.passphraseStorageKey, passphrase);
    }
    this.triggerAccessSync(true);
  }

  setFirebaseToken(token: string | null): void {
    this.firebaseTokenState.set(token);
    if (!this.isBrowser) {
      return;
    }

    if (token) {
      localStorage.setItem(this.firebaseTokenStorageKey, token);
    } else {
      localStorage.removeItem(this.firebaseTokenStorageKey);
    }

    this.triggerAccessSync(true);
  }

  async refreshSessionAccess(): Promise<void> {
    await this.ensureSessionAccess(true);
  }

  private async bootstrap(): Promise<void> {
    if (!this.isBrowser || this.connectionInFlight) {
      return;
    }

    this.connectionInFlight = true;
    this.loadingState.set(true);

    try {
      await this.ensureSessionAccess(false);
      const snapshot = await firstValueFrom(
        this.http.get<SessionSnapshot>('/api/session', this.buildRequestOptions())
      );
      this.snapshotState.set(snapshot);
      this.errorState.set(null);
    } catch (error) {
      this.errorState.set(this.describeError(error));
      this.scheduleReconnect();
    } finally {
      this.loadingState.set(false);
      this.connectionInFlight = false;
    }
  }

  private openEventStream(forceReconnect = false): void {
    if (!this.isBrowser || typeof EventSource === 'undefined') {
      return;
    }

    this.ensureSessionAccess(false)
      .then(() => this.startEventStream(forceReconnect))
      .catch((error) => {
        this.errorState.set(this.describeError(error));
        this.scheduleReconnect();
      });
  }

  private startEventStream(forceReconnect: boolean): void {
    if (this.eventSource && !forceReconnect) {
      return;
    }

    this.eventSource?.close();
    const streamUrl = this.composeStreamUrl('/api/session/stream');
    const stream = new EventSource(streamUrl);
    this.eventSource = stream;

    const supportedEvents: SessionEvent['type'][] = [
      'session',
      'chat-message',
      'chat-replace',
      'chat-history',
      'stream-meters',
      'ops-events',
      'shortcuts',
      'status'
    ];

    supportedEvents.forEach((eventName) => {
      stream.addEventListener(eventName, (event) => {
        const parsed = JSON.parse((event as MessageEvent).data) as SessionEvent;
        this.applyEvent(parsed);
      });
    });

    stream.onopen = () => {
      this.errorState.set(null);
    };

    stream.onerror = () => {
      this.errorState.set('Lost connection to the workspace stream. Retrying...');
      stream.close();
      this.eventSource = undefined;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.isBrowser || this.reconnectHandle) {
      return;
    }

    this.reconnectHandle = setTimeout(() => {
      this.reconnectHandle = undefined;
      this.bootstrap();
      this.openEventStream(true);
    }, this.retryDelayMs);
  }

  private applyEvent(event: SessionEvent): void {
    this.snapshotState.update((current) => this.computeNextSnapshot(current, event));
  }

  private computeNextSnapshot(
    current: SessionSnapshot | null,
    event: SessionEvent
  ): SessionSnapshot | null {
    if (!current) {
      return event.type === 'session' ? event.payload : current;
    }

    switch (event.type) {
      case 'session':
        return event.payload;
      case 'chat-message':
        return { ...current, chatMessages: [...current.chatMessages, event.payload] };
      case 'chat-replace':
        return {
          ...current,
          chatMessages: current.chatMessages.map((message) =>
            message.id === event.payload.id ? event.payload : message
          )
        };
      case 'chat-history':
        return { ...current, chatMessages: [...event.payload] };
      case 'stream-meters':
        return { ...current, streamMeters: [...event.payload] };
      case 'ops-events':
        return { ...current, opsEvents: [...event.payload] };
      case 'shortcuts':
        return { ...current, shortcuts: [...event.payload] };
      case 'status':
        return { ...current, status: event.payload };
      case 'extension':
        return {
          ...current,
          chatMessages: current.chatMessages.map((message) => {
            if (message.id !== event.payload.messageId) {
              return message;
            }

            const existing = message.extensions ?? [];
            const filtered = existing.filter((extension) => extension.id !== event.payload.id);
            return { ...message, extensions: [...filtered, event.payload] };
          })
        };
      default:
        event satisfies never;
        return current;
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unable to reach the workspace session API.';
  }

  private buildRequestOptions():
    | { params: HttpParams; headers?: HttpHeaders }
    | { params: HttpParams } {
    const params = this.buildSessionParams();
    const headers = this.buildHeaders();
    return headers ? { params, headers } : { params };
  }

  private buildSessionParams(): HttpParams {
    let params = new HttpParams();
    const sessionId = this.sessionIdState();
    if (sessionId) {
      params = params.set('sessionId', sessionId);
    }
    return params;
  }

  private composeStreamUrl(path: string): string {
    const query = this.buildSessionQuery();
    return query ? `${path}?${query}` : path;
  }

  private buildHeaders(): HttpHeaders | undefined {
    const token = this.firebaseTokenState();
    if (!token) {
      return undefined;
    }

    return new HttpHeaders({
      Authorization: `Bearer ${token}`
    });
  }

  private readStoredPassphrase(): string {
    if (!this.isBrowser) {
      return '';
    }

    return localStorage.getItem(this.passphraseStorageKey) ?? '';
  }

  private readInitialSessionId(): string | null {
    if (!this.isBrowser) {
      return null;
    }

    const globalSessionId = (globalThis as unknown as { APT_SESSION_ID?: string }).APT_SESSION_ID;
    return globalSessionId ?? null;
  }

  private readStoredFirebaseToken(): string | null {
    if (!this.isBrowser) {
      return null;
    }

    return localStorage.getItem(this.firebaseTokenStorageKey);
  }

  private forceReconnect(): void {
    if (!this.isBrowser) {
      return;
    }

    this.eventSource?.close();
    this.eventSource = undefined;
    this.bootstrap();
    this.openEventStream(true);
  }

  private buildSessionQuery(): string {
    const params = new URLSearchParams();
    const sessionId = this.sessionIdState();
    if (sessionId) {
      params.set('sessionId', sessionId);
    }

    return params.toString();
  }

  private triggerAccessSync(forceReconnect: boolean): void {
    if (!this.isBrowser) {
      return;
    }

    this.ensureSessionAccess(true)
      .then(() => {
        if (forceReconnect) {
          this.forceReconnect();
        }
      })
      .catch((error) => this.errorState.set(this.describeError(error)));
  }

  private async ensureSessionAccess(force: boolean): Promise<void> {
    if (!this.isBrowser) {
      return;
    }

    const sessionId = this.sessionIdState();
    const passphrase = this.passphraseState();
    const firebaseToken = this.firebaseTokenState();

    if (!sessionId || (!passphrase && !firebaseToken)) {
      return;
    }

    const accessSignature = this.computeAccessKey(sessionId, passphrase, firebaseToken);
    if (
      !force &&
      this.lastAccessKey === accessSignature &&
      Date.now() - this.lastAccessTimestamp < this.accessTtlMs / 2
    ) {
      return;
    }

    if (this.accessExchange) {
      await this.accessExchange.catch(() => undefined);
      if (!force) {
        return;
      }
    }

    const payload: Record<string, string> = {};
    if (passphrase) {
      payload['passphrase'] = passphrase;
    }
    if (firebaseToken) {
      payload['firebaseIdToken'] = firebaseToken;
    }

    const endpoint = this.composeAccessEndpoint();
    const options = this.buildRequestOptions();

    this.accessExchange = firstValueFrom(this.http.post(endpoint, payload, options))
      .then(() => {
        this.lastAccessKey = accessSignature;
        this.lastAccessTimestamp = Date.now();
      })
      .finally(() => {
        this.accessExchange = null;
      });

    await this.accessExchange;
  }

  private composeAccessEndpoint(): string {
    const sessionId = this.sessionIdState();
    return sessionId ? `/api/session/${encodeURIComponent(sessionId)}/access` : '/api/session/access';
  }

  private computeAccessKey(sessionId: string, passphrase: string, firebaseToken: string | null): string {
    return `${sessionId}:${passphrase}:${firebaseToken ?? ''}`;
  }
}
