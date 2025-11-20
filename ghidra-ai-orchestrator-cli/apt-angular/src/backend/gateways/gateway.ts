import { SessionCommandPayload, SessionEvent, SessionSnapshot } from '../../shared/session-models';

export interface AgentGateway {
  readonly source: SessionSnapshot['source'];
  readonly label: string;

  /**
   * Returns the initial snapshot that will seed the in-memory state before clients connect.
   */
  bootstrap(): Promise<SessionSnapshot>;

  /**
   * Starts listening to upstream events and forwards them to the orchestrator.
   * Returns a cleanup function that will tear down the subscription.
   */
  start(eventHandler: (event: SessionEvent) => void): Promise<() => void>;

  /**
   * Optional hook used when the UI wants to send a command back to the upstream runtime.
   */
  sendCommand?(command: SessionCommandPayload): Promise<void>;
}
