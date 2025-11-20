import type { CapabilityModule } from '../../runtime/agentHost.js';
import type { RuntimeAdapter, RuntimeAdapterContext } from '../types.js';

export interface BrowserAdapterOptions {
  modules?: CapabilityModule[];
}

export class BrowserRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'runtime.browser';
  private readonly options: BrowserAdapterOptions;

  constructor(options: BrowserAdapterOptions = {}) {
    this.options = options;
  }

  async createCapabilityModules(_: RuntimeAdapterContext): Promise<CapabilityModule[]> {
    return [...(this.options.modules ?? [])];
  }
}
