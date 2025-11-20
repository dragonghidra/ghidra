import type { CapabilityModule } from '../../runtime/agentHost.js';
import type { RuntimeAdapter, RuntimeAdapterContext } from '../types.js';

export type RemoteModuleFactory =
  | CapabilityModule
  | ((context: RuntimeAdapterContext) => CapabilityModule | Promise<CapabilityModule>);

export interface RemoteAdapterOptions {
  modules?: RemoteModuleFactory[];
}

export class RemoteRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'runtime.remote';
  private readonly options: RemoteAdapterOptions;

  constructor(options: RemoteAdapterOptions = {}) {
    this.options = options;
  }

  async createCapabilityModules(context: RuntimeAdapterContext): Promise<CapabilityModule[]> {
    const modules: CapabilityModule[] = [];
    for (const entry of this.options.modules ?? []) {
      if (typeof entry === 'function') {
        modules.push(await entry(context));
      } else {
        modules.push(entry);
      }
    }
    return modules;
  }
}
