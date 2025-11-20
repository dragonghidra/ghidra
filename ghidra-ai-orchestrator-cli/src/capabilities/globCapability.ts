import type { CapabilityModule, CapabilityContext, CapabilityContribution } from '../runtime/agentHost.js';
import { createGlobTools } from '../tools/globTools.js';

/**
 * Glob Capability Module
 *
 * Provides fast file pattern matching using glob patterns.
 * Optimized for large codebases with intelligent directory filtering.
 *
 * Tools:
 * - Glob: Fast pattern matching with modification time sorting
 *
 * Scope: filesystem:read
 */
export class GlobCapabilityModule implements CapabilityModule {
  readonly id = 'capability.glob';

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const tools = createGlobTools(context.workingDir);

    return {
      id: 'glob.pattern_matching',
      description: 'Fast file pattern matching with glob support',
      toolSuite: {
        id: 'glob',
        tools,
      },
    };
  }
}
