import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ViewContainerRef,
  inject
} from '@angular/core';
import { ChatMessage } from '../../../shared/session-models';
import { MessageRendererRegistryService, MessageRendererComponent } from '../../services/message-renderer-registry.service';
import { DefaultChatMessageRendererComponent } from './default-chat-message-renderer';

@Component({
  selector: 'app-chat-message',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChatMessageHostComponent implements OnChanges {
  @Input({ required: true }) message!: ChatMessage;

  private readonly registry = inject(MessageRendererRegistryService);
  private readonly viewContainerRef = inject(ViewContainerRef);

  constructor() {
    this.registry.ensureFallback(DefaultChatMessageRendererComponent);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['message']) {
      this.render();
    }
  }

  private render(): void {
    if (!this.message) {
      return;
    }

    this.viewContainerRef.clear();
    const descriptor = this.registry.resolve(this.message);
    if (!descriptor) {
      return;
    }

    const componentRef = this.viewContainerRef.createComponent(descriptor.component);
    if ('message' in componentRef.instance) {
      (componentRef.instance as MessageRendererComponent).message = this.message;
    }
  }
}
