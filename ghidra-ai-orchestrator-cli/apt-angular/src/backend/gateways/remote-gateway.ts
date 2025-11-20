import { RemoteGatewayConfig } from '../config/runtime-config';
import { AgentGateway } from './gateway';
import { SessionEvent, SessionSnapshot } from '../../shared/session-models';

export class RemoteAgentGateway implements AgentGateway {
  readonly source = 'remote-cloud';
  readonly label = 'cloud APT relay';
  private pollTimer?: NodeJS.Timeout;

  constructor(private readonly config: RemoteGatewayConfig) {}

  async bootstrap(): Promise<SessionSnapshot> {
    return this.fetchSnapshot();
  }

  async start(eventHandler: (event: SessionEvent) => void): Promise<() => void> {
    this.pollTimer = setInterval(async () => {
      try {
        const snapshot = await this.fetchSnapshot();
        eventHandler({ type: 'session', payload: snapshot });
      } catch (error) {
        eventHandler({
          type: 'status',
          payload: {
            label: 'remote poll failed',
            detail: error instanceof Error ? error.message : String(error),
            tone: 'warn'
          }
        });
      }
    }, 5000);

    return () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
    };
  }

  private async fetchSnapshot(): Promise<SessionSnapshot> {
    const response = await fetch(new URL('/api/session', this.config.baseUrl), {
      headers: this.headers(),
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Remote agent responded with status ${response.status}`);
    }

    return (await response.json()) as SessionSnapshot;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    if (this.config.project) {
      headers['x-agent-project'] = this.config.project;
    }

    return headers;
  }
}