import type { CapabilityModule } from '../../runtime/agentHost.js';
import type { RuntimeAdapter, RuntimeAdapterContext } from '../types.js';
import {
  instantiateToolPlugins,
  registerDefaultNodeToolPlugins,
  type ToolPlugin,
} from '../../plugins/tools/index.js';

export interface NodeAdapterOptions {
  includeFilesystem?: boolean;
  includeSearch?: boolean;
  includeBash?: boolean;
  extraModules?: CapabilityModule[];
  filter?: (plugin: ToolPlugin) => boolean;
}

export class NodeRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'runtime.node';
  private readonly options: NodeAdapterOptions;

  constructor(options: NodeAdapterOptions = {}) {
    this.options = options;
  }

  async createCapabilityModules(context: RuntimeAdapterContext): Promise<CapabilityModule[]> {
    registerDefaultNodeToolPlugins();

    const filter = (plugin: ToolPlugin): boolean => {
      if (this.options.includeFilesystem === false && plugin.id === 'tool.filesystem.local') {
        return false;
      }
      if (this.options.includeSearch === false && plugin.id === 'tool.search.local') {
        return false;
      }
      if (this.options.includeBash === false && plugin.id === 'tool.bash.local') {
        return false;
      }
      if (this.options.filter && !this.options.filter(plugin)) {
        return false;
      }
      return true;
    };

    const modules = await instantiateToolPlugins(
      'node',
      {
        workingDir: context.workingDir,
        env: context.env,
      },
      { filter }
    );

    if (this.options.extraModules?.length) {
      modules.push(...this.options.extraModules);
    }

    return modules;
  }
}
