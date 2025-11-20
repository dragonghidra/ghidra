import type { ProfileName } from '../config.js';
import type { CapabilityModule } from '../runtime/agentHost.js';

export interface RuntimeAdapterContext {
  profile: ProfileName;
  workspaceContext: string | null;
  workingDir: string;
  env: Record<string, string | undefined>;
}

export interface RuntimeAdapter {
  id: string;
  description?: string;
  createCapabilityModules(
    context: RuntimeAdapterContext
  ): CapabilityModule[] | Promise<CapabilityModule[]>;
}
