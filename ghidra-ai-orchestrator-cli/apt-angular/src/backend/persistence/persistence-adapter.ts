import { SessionCommandPayload, SessionEvent, SessionSnapshot } from '../../shared/session-models';

export interface PersistenceAdapter {
  bootstrap(): Promise<SessionSnapshot>;
  subscribe(handler: (event: SessionEvent) => void): Promise<() => void>;
  sendCommand?(payload: SessionCommandPayload): Promise<void>;
}
