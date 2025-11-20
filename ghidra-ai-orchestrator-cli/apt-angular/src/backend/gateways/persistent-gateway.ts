import { AgentGateway } from './gateway';
import { PersistenceAdapter } from '../persistence/persistence-adapter';
import { SessionEvent, SessionSnapshot, SessionCommandPayload, AgentSource } from '../../shared/session-models';

export class PersistentGateway implements AgentGateway {
  readonly label: string;
  readonly source: AgentSource;

  constructor(
    private readonly adapter: PersistenceAdapter,
    options: { label: string; source: AgentSource }
  ) {
    this.label = options.label;
    this.source = options.source;
  }

  async bootstrap(): Promise<SessionSnapshot> {
    const snapshot = await this.adapter.bootstrap();
    return {
      ...snapshot,
      source: this.source
    };
  }

  async start(eventHandler: (event: SessionEvent) => void): Promise<() => void> {
    return this.adapter.subscribe(eventHandler);
  }

  async sendCommand(command: SessionCommandPayload): Promise<void> {
    if (!this.adapter.sendCommand) {
      throw new Error(`${this.label} gateway does not support commands.`);
    }

    await this.adapter.sendCommand(command);
  }
}
