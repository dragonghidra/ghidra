import { Component, inject, signal } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { AgentSessionService } from './services/agent-session.service';
import { RunBoardComponent } from './components/run-board/run-board';
import { ConnectorGalleryComponent } from './components/connector-gallery/connector-gallery';
import { ChatMessageHostComponent } from './components/chat-message/chat-message-host';
import { SettingsDrawerComponent } from './components/settings/settings-drawer';
import { ChatInputComponent } from './components/chat-input/chat-input';

@Component({
  selector: 'app-root',
  imports: [
    NgFor,
    NgClass,
    NgIf,
    RunBoardComponent,
    ConnectorGalleryComponent,
    ChatMessageHostComponent,
    ChatInputComponent,
    SettingsDrawerComponent
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly session = inject(AgentSessionService);

  protected readonly chatMessages = this.session.chatMessages;
  protected readonly streamMeters = this.session.streamMeters;
  protected readonly opsEvents = this.session.opsEvents;
  protected readonly shortcuts = this.session.shortcuts;
  protected readonly status = this.session.status;
  protected readonly isLoading = this.session.isLoading;
  protected readonly errorMessage = this.session.errorMessage;
  protected readonly passphraseDraft = signal(this.session.passphrase());
  protected readonly passphraseStatus = signal<string | null>(null);
  protected readonly drawerOpen = signal(false);

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unable to deliver your command to the APT CLI.';
  }

  protected onPassphraseInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.passphraseDraft.set(value);
  }

  protected applyPassphrase(event: Event): void {
    event.preventDefault();
    this.session.setPassphrase(this.passphraseDraft());
    this.session
      .refreshSessionAccess()
      .then(() => {
        this.passphraseStatus.set('passphrase applied');
        setTimeout(() => this.passphraseStatus.set(null), 3000);
      })
      .catch((error: unknown) => this.passphraseStatus.set(this.describeError(error)));
  }

  protected openSettings(): void {
    this.drawerOpen.set(true);
  }

  protected closeSettings(): void {
    this.drawerOpen.set(false);
  }
}
