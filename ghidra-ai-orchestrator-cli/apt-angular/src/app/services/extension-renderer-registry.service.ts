import { Injectable, Type } from '@angular/core';
import { MessageExtension } from '../../shared/session-models';

export interface ExtensionRendererComponent {
  extension: MessageExtension;
}

interface ExtensionRendererEntry {
  id: string;
  component: Type<object>;
  kinds?: string[];
  predicate?: (extension: MessageExtension) => boolean;
  priority: number;
  fallback?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ExtensionRendererRegistryService {
  private readonly entries: ExtensionRendererEntry[] = [];

  register(entry: Omit<ExtensionRendererEntry, 'priority'> & { priority?: number }): void {
    const normalized: ExtensionRendererEntry = { priority: entry.priority ?? 0, ...entry };
    this.entries.unshift(normalized);
  }

  ensureFallback(component: Type<object>): void {
    const existing = this.entries.find((entry) => entry.fallback);
    if (!existing) {
      this.register({
        id: 'fallback-extension',
        component,
        priority: -100,
        fallback: true,
        predicate: () => true
      });
    }
  }

  resolve(extension: MessageExtension): ExtensionRendererEntry | undefined {
    return this.entries
      .slice()
      .sort((a, b) => b.priority - a.priority)
      .find((entry) => {
        if (entry.predicate) {
          return entry.predicate(extension);
        }

        if (entry.kinds?.length) {
          return entry.kinds.includes(extension.kind);
        }

        return false;
      }) ?? this.entries.find((entry) => entry.fallback);
  }
}
