import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, computed, effect, inject, signal } from '@angular/core';
import { NgIf } from '@angular/common';
import { AgentSessionService } from '../../services/agent-session.service';
import { FirebaseLoginService } from '../../services/firebase-login.service';

@Component({
  selector: 'app-settings-drawer',
  standalone: true,
  imports: [NgIf],
  template: `
    <div
      class="settings-overlay"
      *ngIf="open"
      (click)="close.emit()"
    >
      <section
        class="settings-panel"
        (click)="$event.stopPropagation()"
      >
        <header class="settings-head">
          <h2>Session settings</h2>
          <button
            class="icon-button"
            type="button"
            (click)="close.emit()"
          >
            ×
          </button>
        </header>

        <div class="settings-body">
          <label>
            <span>Session ID</span>
            <input
              type="text"
              [value]="sessionIdDraft() ?? ''"
              (input)="onSessionIdInput($event)"
            />
          </label>

          <form (submit)="applyPassphrase($event)">
            <label>
              <span>Session passphrase</span>
              <input
                type="password"
                [value]="passphraseDraft()"
                (input)="onPassphraseInput($event)"
              />
            </label>
            <div class="settings-actions">
              <button type="submit">Apply</button>
              <span class="status-text" *ngIf="passphraseStatus()">{{ passphraseStatus() }}</span>
            </div>
          </form>

          <form (submit)="applyFirebaseToken($event)">
            <label>
              <span>Firebase token</span>
              <input
                type="text"
                [value]="firebaseTokenDraft()"
                (input)="onFirebaseTokenInput($event)"
              />
            </label>
            <div class="settings-actions">
              <button type="submit">Apply</button>
              <span class="status-text" *ngIf="firebaseStatus()">{{ firebaseStatus() }}</span>
            </div>
          </form>

          <button
            class="firebase-button"
            type="button"
            [disabled]="!firebaseLoginSupported() || firebaseLoggingIn()"
            (click)="startFirebaseLogin()"
          >
            {{ firebaseLoggingIn() ? 'Signing in…' : 'Sign in with Firebase' }}
          </button>
        </div>
      </section>
    </div>
  `,
  styleUrl: './settings-drawer.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsDrawerComponent {
  @Input({ required: true }) open = false;
  @Output() readonly close = new EventEmitter<void>();

  private readonly session = inject(AgentSessionService);
  private readonly firebaseLogin = inject(FirebaseLoginService);

  protected readonly sessionIdDraft = signal<string | null>(null);
  protected readonly passphraseDraft = signal('');
  protected readonly firebaseTokenDraft = signal('');
  protected readonly passphraseStatus = signal<string | null>(null);
  protected readonly firebaseStatus = signal<string | null>(null);
  protected readonly firebaseLoginSupported = computed(() => this.firebaseLogin.isSupported());
  protected readonly firebaseLoggingIn = signal(false);

  constructor() {
    effect(() => {
      const currentSessionId = this.session.sessionId();
      this.sessionIdDraft.set(currentSessionId);
    });
    effect(() => {
      const passphrase = this.session.passphrase();
      this.passphraseDraft.set(passphrase);
    });
  }

  protected onSessionIdInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.sessionIdDraft.set(value || null);
    this.session.setSessionId(value || null);
  }

  protected onPassphraseInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.passphraseDraft.set(value);
  }

  protected onFirebaseTokenInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.firebaseTokenDraft.set(value);
  }

  protected async applyPassphrase(event: Event): Promise<void> {
    event.preventDefault();
    this.session.setPassphrase(this.passphraseDraft());
    try {
      await this.session.refreshSessionAccess();
      this.passphraseStatus.set('Updated');
      setTimeout(() => this.passphraseStatus.set(null), 3000);
    } catch (error) {
      this.passphraseStatus.set((error as Error).message ?? 'Failed');
    }
  }

  protected async applyFirebaseToken(event: Event): Promise<void> {
    event.preventDefault();
    this.session.setFirebaseToken(this.firebaseTokenDraft() || null);
    try {
      await this.session.refreshSessionAccess();
      this.firebaseStatus.set('Updated');
      setTimeout(() => this.firebaseStatus.set(null), 3000);
    } catch (error) {
      this.firebaseStatus.set((error as Error).message ?? 'Failed');
    }
  }

  protected async startFirebaseLogin(): Promise<void> {
    this.firebaseLoggingIn.set(true);
    try {
      const token = await this.firebaseLogin.signInWithPopup();
      if (token) {
        this.firebaseTokenDraft.set(token);
        this.session.setFirebaseToken(token);
        await this.session.refreshSessionAccess();
        this.firebaseStatus.set('Signed in');
        setTimeout(() => this.firebaseStatus.set(null), 3000);
      } else {
        this.firebaseStatus.set('Login unavailable');
      }
    } catch (error) {
      this.firebaseStatus.set(error instanceof Error ? error.message : 'Login failed');
    } finally {
      this.firebaseLoggingIn.set(false);
    }
  }
}
