import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';
import { JsonPipe, NgIf } from '@angular/common';
import { MessageExtension } from '../../../shared/session-models';
import {
  ExtensionRendererRegistryService,
  ExtensionRendererComponent
} from '../../services/extension-renderer-registry.service';

@Component({
  selector: 'app-default-extension-renderer',
  standalone: true,
  imports: [NgIf, JsonPipe],
  template: `
    <section class="extension-card">
      <header>
        <p class="extension-label">{{ extension.label ?? extension.kind }}</p>
        <p class="extension-description" *ngIf="extension.description">{{ extension.description }}</p>
      </header>
      <pre class="extension-body">{{ extension.data | json }}</pre>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DefaultExtensionRendererComponent implements ExtensionRendererComponent {
  @Input({ required: true }) extension!: MessageExtension;

  private readonly registry = inject(ExtensionRendererRegistryService);

  constructor() {
    this.registry.ensureFallback(DefaultExtensionRendererComponent);
  }
}
