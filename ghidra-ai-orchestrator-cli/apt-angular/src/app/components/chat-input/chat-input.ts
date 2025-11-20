import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  effect,
  inject,
  signal
} from '@angular/core';
import { NgIf } from '@angular/common';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { AgentSessionService } from '../../services/agent-session.service';

@Component({
  selector: 'app-chat-input',
  standalone: true,
  imports: [NgIf],
  templateUrl: './chat-input.html',
  styleUrl: './chat-input.css'
})
export class ChatInputComponent implements AfterViewInit, OnDestroy {
  private readonly session = inject(AgentSessionService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  @ViewChild('inputField') private inputField?: ElementRef<HTMLTextAreaElement>;

  protected readonly draft = signal('');
  protected readonly sending = signal(false);
  protected readonly error = signal<string | null>(null);

  private persistHandle: ReturnType<typeof setTimeout> | null = null;
  private lastLoadedKey: string | null = null;

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    // Reload a locally persisted draft whenever the session changes.
    effect(
      () => {
        const key = this.composeStorageKey();
        if (this.lastLoadedKey === key) {
          return;
        }

        this.lastLoadedKey = key;
        const stored = localStorage.getItem(key);
        this.draft.set(stored ?? '');
        queueMicrotask(() => this.resizeToContent());
      },
      { allowSignalWrites: true }
    );
  }

  ngAfterViewInit(): void {
    this.resizeToContent();
    this.focusInput();
  }

  ngOnDestroy(): void {
    if (this.persistHandle) {
      clearTimeout(this.persistHandle);
    }
  }

  protected onInput(event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    this.draft.set(value);
    this.queuePersist(value);
    this.error.set(null);
    this.resizeToContent();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void this.submitDraft();
  }

  protected handleSubmit(event: Event): void {
    event.preventDefault();
    void this.submitDraft();
  }

  protected clearDraft(): void {
    this.draft.set('');
    this.queuePersist('');
    this.resizeToContent();
    this.focusInput();
  }

  private async submitDraft(): Promise<void> {
    const text = this.draft().trim();
    if (!text || this.sending()) {
      return;
    }

    this.sending.set(true);
    this.error.set(null);

    try {
      await this.session.sendCommand({ text });
      this.draft.set('');
      this.queuePersist('');
      this.resizeToContent();
    } catch (error) {
      this.error.set(this.describeError(error));
    } finally {
      this.sending.set(false);
      this.focusInput();
    }
  }

  private queuePersist(value: string): void {
    if (!this.isBrowser) {
      return;
    }

    if (this.persistHandle) {
      clearTimeout(this.persistHandle);
    }

    const key = this.composeStorageKey();
    this.persistHandle = setTimeout(() => {
      this.persistHandle = null;
      if (value.trim().length === 0) {
        localStorage.removeItem(key);
        return;
      }

      localStorage.setItem(key, value);
    }, 150);
  }

  private composeStorageKey(): string {
    const sessionId = this.session.sessionId();
    return sessionId ? `apt-chat-draft:${sessionId}` : 'apt-chat-draft';
  }

  private resizeToContent(): void {
    const input = this.inputField?.nativeElement;
    if (!input) {
      return;
    }

    input.style.height = 'auto';
    const nextHeight = Math.min(input.scrollHeight, 240);
    input.style.height = `${nextHeight}px`;
  }

  private focusInput(): void {
    if (!this.isBrowser) {
      return;
    }

    const input = this.inputField?.nativeElement;
    if (!input) {
      return;
    }

    requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      const length = input.value.length;
      input.setSelectionRange(length, length);
    });
  }

  private describeError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Unable to deliver your command to the APT CLI.';
  }
}
