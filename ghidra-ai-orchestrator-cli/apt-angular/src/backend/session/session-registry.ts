import { RuntimeConfig, loadRuntimeConfig } from '../config/runtime-config';
import { createSessionOrchestrator, OrchestratorBundle } from './orchestrator-factory';
import { SessionAccessController } from './session-access';

export interface SessionHandle {
  orchestrator: OrchestratorBundle['orchestrator'];
  config: RuntimeConfig;
  access: SessionAccessController;
}

const bootstrapConfigs = (): RuntimeConfig[] => {
  return [loadRuntimeConfig()];
};

export class SessionRegistry {
  private readonly sessions = new Map<string, Promise<SessionHandle>>();
  private readonly defaultSessionId: string;

  constructor(initialConfigs: RuntimeConfig[] = bootstrapConfigs()) {
    if (!initialConfigs.length) {
      throw new Error('At least one session configuration is required.');
    }

    this.defaultSessionId = initialConfigs[0].sessionId;
    initialConfigs.forEach((config) => this.register(config));
  }

  getDefaultSessionId(): string {
    return this.defaultSessionId;
  }

  register(config: RuntimeConfig): void {
    this.sessions.set(config.sessionId, this.createHandle(config));
  }

  async get(sessionId?: string): Promise<SessionHandle> {
    const id = sessionId ?? this.defaultSessionId;
    const handlePromise = this.sessions.get(id);
    if (!handlePromise) {
      throw new Error(`Session ${id} is not registered.`);
    }

    return handlePromise;
  }

  private createHandle(config: RuntimeConfig): Promise<SessionHandle> {
    const handlePromise = createSessionOrchestrator(config).then(({ orchestrator }) => ({
      orchestrator,
      config,
      access: new SessionAccessController(config.access)
    }));

    handlePromise.catch((error) => {
      console.error(`Failed to bootstrap session ${config.sessionId}`, error);
      this.sessions.delete(config.sessionId);
    });

    return handlePromise;
  }
}
