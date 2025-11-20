import {
  SessionCommandPayload,
  SessionEvent,
  SessionSnapshot,
} from '../../shared/session-models';
import { AgentGateway } from '../gateways/gateway';
import { reduceSnapshot } from './snapshot-reducer';

type Listener = (event: SessionEvent) => void;

export class SessionOrchestrator {
  private snapshot!: SessionSnapshot;
  private listeners = new Set<Listener>();
  private teardown?: () => void;

  constructor(private readonly gateway: AgentGateway) {}

  async init(): Promise<void> {
    this.snapshot = await this.gateway.bootstrap();
    this.teardown = await this.gateway.start((event) => this.handleEvent(event));
  }

  dispose(): void {
    this.teardown?.();
    this.listeners.clear();
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendCommand(command: SessionCommandPayload): Promise<void> {
    if (!this.gateway.sendCommand) {
      throw new Error('The active gateway does not accept commands.');
    }

    await this.gateway.sendCommand(command);
  }

  private handleEvent(event: SessionEvent): void {
    this.applyEvent(event);
    this.listeners.forEach((listener) => listener(event));
  }

  private applyEvent(event: SessionEvent): void {
    this.snapshot = reduceSnapshot(this.snapshot, event);
  }
}
