import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ViewContainerRef,
  inject
} from '@angular/core';
import { MessageExtension } from '../../../shared/session-models';
import {
  ExtensionRendererRegistryService,
  ExtensionRendererComponent
} from '../../services/extension-renderer-registry.service';
import { DefaultExtensionRendererComponent } from './default-extension-renderer';

@Component({
  selector: 'app-extension-host',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ExtensionHostComponent implements OnChanges {
  @Input({ required: true }) extension!: MessageExtension;

  private readonly registry = inject(ExtensionRendererRegistryService);
  private readonly viewContainerRef = inject(ViewContainerRef);

  constructor() {
    this.registry.ensureFallback(DefaultExtensionRendererComponent);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['extension']) {
      this.render();
    }
  }

  private render(): void {
    if (!this.extension) {
      return;
    }

    this.viewContainerRef.clear();
    const descriptor = this.registry.resolve(this.extension);
    if (!descriptor) {
      return;
    }

    const componentRef = this.viewContainerRef.createComponent(descriptor.component);
    if ('extension' in componentRef.instance) {
      (componentRef.instance as ExtensionRendererComponent).extension = this.extension;
    }
  }
}
