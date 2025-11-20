import { Injectable, Type } from '@angular/core';
import { ChatMessage } from '../../shared/session-models';

export interface MessageRendererComponent {
  message: ChatMessage;
}

interface RendererEntry {
  id: string;
  component: Type<object>;
  kinds?: string[];
  predicate?: (message: ChatMessage) => boolean;
  priority: number;
  fallback?: boolean;
}

@Injectable({ providedIn: 'root' })
export class MessageRendererRegistryService {
  private readonly entries: RendererEntry[] = [];

  register(entry: Omit<RendererEntry, 'priority'> & { priority?: number }): void {
    const normalized: RendererEntry = { priority: entry.priority ?? 0, ...entry };
    this.entries.unshift(normalized);
  }

  ensureFallback(component: Type<object>): void {
    const existing = this.entries.find((entry) => entry.fallback);
    if (!existing) {
      this.register({ id: 'default', component, priority: -100, fallback: true, predicate: () => true });
    }
  }

  resolve(message: ChatMessage): RendererEntry | undefined {
    return this.entries
      .slice()
      .sort((a, b) => b.priority - a.priority)
      .find((entry) => {
        if (entry.predicate) {
          return entry.predicate(message);
        }

        if (entry.kinds?.length) {
          return entry.kinds.includes(message.kind ?? '');
        }

        return false;
      }) ?? this.entries.find((entry) => entry.fallback);
  }
}
