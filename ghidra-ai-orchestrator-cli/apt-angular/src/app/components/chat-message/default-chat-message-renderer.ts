import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { ChatMessage } from '../../../shared/session-models';
import { MessageRendererRegistryService, MessageRendererComponent } from '../../services/message-renderer-registry.service';
import { ExtensionHostComponent } from '../extensions/extension-host';
import { DefaultExtensionRendererComponent } from '../extensions/default-extension-renderer';

@Component({
  selector: 'app-default-chat-message-renderer',
  standalone: true,
  imports: [NgFor, NgIf, NgClass, ExtensionHostComponent],
  template: `
    <article
      class="chat-message"
      [ngClass]="{
        'message--apt': message.agent === 'apt',
        'message--apt-code': message.agent === 'apt-code',
        'message--user': message.agent === 'user'
      }"
    >
      <div class="message-meta">
        <span
          class="agent-chip"
          [ngClass]="{
            'agent-chip--apt': message.agent === 'apt',
            'agent-chip--apt-code': message.agent === 'apt-code',
            'agent-chip--user': message.agent === 'user'
          }"
        >
          {{ message.title }}
        </span>
        <span class="message-caption">{{ message.caption }}</span>
        <span class="message-timestamp">{{ message.timestamp }}</span>
        <span class="message-status">{{ message.status }}</span>
        <span class="message-stat" *ngIf="message.tokens">{{ message.tokens }}</span>
        <span class="streaming-dot" *ngIf="message.streaming">streaming</span>
      </div>

      <div class="command-line" *ngIf="message.command">
        <span class="prompt-symbol">$</span>
        <span class="command-text">{{ message.command }}</span>
      </div>

      <div class="message-body">
        <p *ngFor="let line of message.body">{{ line }}</p>
      </div>

      <div class="diff-block" *ngIf="message.diff?.length">
        <div
          class="diff-line"
          *ngFor="let diffLine of message.diff"
          [ngClass]="{
            'diff-line--add': diffLine.kind === 'add',
            'diff-line--remove': diffLine.kind === 'remove'
          }"
        >
          {{ diffLine.text }}
        </div>
      </div>

      <section class="extension-stack" *ngIf="message.extensions?.length">
        <app-extension-host
          *ngFor="let extension of message.extensions"
          [extension]="extension"
        ></app-extension-host>
      </section>

      <div class="message-footer" *ngIf="message.footer">{{ message.footer }}</div>
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DefaultChatMessageRendererComponent implements MessageRendererComponent {
  @Input({ required: true }) message!: ChatMessage;

  private readonly registry = inject(MessageRendererRegistryService);

  constructor() {
    this.registry.ensureFallback(DefaultChatMessageRendererComponent);
  }
}
