import {
  createUniversalRuntime,
  type UniversalRuntime,
  type UniversalRuntimeOptions,
} from './universal.js';
import { RemoteRuntimeAdapter, type RemoteAdapterOptions } from '../adapters/remote/index.js';

export interface CloudRuntimeOptions
  extends Omit<UniversalRuntimeOptions, 'adapter'> {
  adapterOptions?: RemoteAdapterOptions;
}

export async function createCloudRuntime(options: CloudRuntimeOptions): Promise<UniversalRuntime> {
  const adapter = new RemoteRuntimeAdapter(options.adapterOptions);
  return createUniversalRuntime({
    ...options,
    adapter,
  });
}
