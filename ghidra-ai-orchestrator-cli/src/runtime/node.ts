import { createUniversalRuntime, type UniversalRuntime, type UniversalRuntimeOptions } from './universal.js';
import { NodeRuntimeAdapter, type NodeAdapterOptions } from '../adapters/node/index.js';

export interface NodeRuntimeOptions
  extends Omit<UniversalRuntimeOptions, 'adapter' | 'additionalModules'> {
  adapterOptions?: NodeAdapterOptions;
  additionalModules?: UniversalRuntimeOptions['additionalModules'];
}

export async function createNodeRuntime(options: NodeRuntimeOptions): Promise<UniversalRuntime> {
  const adapter = new NodeRuntimeAdapter(options.adapterOptions);
  return createUniversalRuntime({
    ...options,
    adapter,
    additionalModules: options.additionalModules,
  });
}
