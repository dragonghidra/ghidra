import { Component, computed, inject } from '@angular/core';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { AgentConnector, AgentConnectorStore } from '../../services/agent-connector.store';

interface ConnectorHighlight {
  label: string;
  value: string;
}

interface ConnectorPlaybook {
  id: string;
  description?: string;
}

interface ConnectorViewModel extends AgentConnector {
  highlights: ConnectorHighlight[];
  playbooks: ConnectorPlaybook[];
}

@Component({
  selector: 'app-connector-gallery',
  standalone: true,
  imports: [NgIf, NgFor, NgClass],
  templateUrl: './connector-gallery.html',
  styleUrls: ['./connector-gallery.css']
})
export class ConnectorGalleryComponent {
  private readonly store = inject(AgentConnectorStore);

  protected readonly connectors = computed<ConnectorViewModel[]>(() =>
    this.store.connectors().map((connector) => this.decorateConnector(connector))
  );
  protected readonly isLoading = this.store.isLoading;
  protected readonly error = this.store.error;

  protected statusClass(status: string): string {
    switch (status?.toLowerCase()) {
      case 'ready':
        return 'connector-status--ready';
      case 'paused':
      case 'queued':
        return 'connector-status--info';
      case 'error':
      case 'failed':
        return 'connector-status--danger';
      default:
        return 'connector-status--muted';
    }
  }

  protected async refresh(): Promise<void> {
    await this.store.refresh();
  }

  private decorateConnector(connector: AgentConnector): ConnectorViewModel {
    const metadata = connector.metadata ?? {};
    return {
      ...connector,
      highlights: this.buildHighlights(metadata),
      playbooks: this.extractPlaybooks(metadata)
    };
  }

  private buildHighlights(metadata: Record<string, unknown>): ConnectorHighlight[] {
    const highlights: ConnectorHighlight[] = [];
    const push = (label: string, value: unknown) => {
      if (value === undefined || value === null) {
        return;
      }

      const normalized = typeof value === 'string' ? value.trim() : String(value);
      if (!normalized) {
        return;
      }

      highlights.push({ label, value: normalized });
    };

    const stringKeys: Array<[keyof typeof metadata, string]> = [
      ['projectId', 'Project'],
      ['runtime', 'Runtime'],
      ['taskQueue', 'Task queue'],
      ['command', 'Command'],
      ['cwd', 'Working dir']
    ];

    for (const [key, label] of stringKeys) {
      const raw = metadata[key as keyof typeof metadata];
      if (typeof raw === 'string') {
        push(label, raw);
      }
    }

    if (typeof metadata['sampleRuns'] === 'number') {
      push('Sample runs', metadata['sampleRuns']);
    }

    if (typeof metadata['emitsArtifacts'] === 'boolean') {
      push('Artifacts', metadata['emitsArtifacts'] ? 'Artifacts attached' : 'Metadata only');
    }

    if (typeof metadata['requiresSsh'] === 'boolean') {
      push('SSH', metadata['requiresSsh'] ? 'Required' : 'Not needed');
    }

    if (typeof metadata['forwardsStdIn'] === 'boolean') {
      push('Command input', metadata['forwardsStdIn'] ? 'Interactive' : 'One-way');
    }

    const observability = metadata['observability'];
    if (observability && typeof observability === 'object') {
      const bits: string[] = [];
      const map = observability as Record<string, unknown>;
      if (typeof map['runEvents'] === 'boolean' && map['runEvents']) {
        bits.push('run events');
      }
      if (typeof map['storageArtifacts'] === 'boolean' && map['storageArtifacts']) {
        bits.push('storage artifacts');
      }
      if (bits.length) {
        push('Telemetry', bits.join(' + '));
      }
    }

    return highlights.slice(0, 5);
  }

  private extractPlaybooks(metadata: Record<string, unknown>): ConnectorPlaybook[] {
    const raw = metadata['supportedPlaybooks'];
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((entry) => {
        if (typeof entry === 'string') {
          return { id: entry } satisfies ConnectorPlaybook;
        }

        if (entry && typeof entry === 'object' && 'id' in entry) {
          const record = entry as Record<string, unknown>;
          return {
            id: String(record['id']),
            description: typeof record['description'] === 'string' ? record['description'] : undefined
          } satisfies ConnectorPlaybook;
        }

        return undefined;
      })
      .filter((value): value is ConnectorPlaybook => Boolean(value));
  }
}
