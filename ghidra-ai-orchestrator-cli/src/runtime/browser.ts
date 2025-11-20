import {
  createUniversalRuntime,
  type UniversalRuntime,
  type UniversalRuntimeOptions,
} from './universal.js';
import { BrowserRuntimeAdapter, type BrowserAdapterOptions } from '../adapters/browser/index.js';

export interface BrowserRuntimeOptions
  extends Omit<UniversalRuntimeOptions, 'adapter'> {
  adapterOptions?: BrowserAdapterOptions;
}

export async function createBrowserRuntime(
  options: BrowserRuntimeOptions
): Promise<UniversalRuntime> {
  const adapter = new BrowserRuntimeAdapter(options.adapterOptions);
  return createUniversalRuntime({
    ...options,
    adapter,
  });
}
