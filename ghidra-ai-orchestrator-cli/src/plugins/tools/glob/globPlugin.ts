import type { ToolPlugin } from '../registry.js';
import { GlobCapabilityModule } from '../../../capabilities/globCapability.js';

/**
 * Glob Tool Plugin
 *
 * Registers fast file pattern matching capabilities.
 * Available in node and cloud runtimes.
 */
export function createGlobToolPlugin(): ToolPlugin {
  return {
    id: 'tool.glob',
    targets: ['node', 'cloud'],
    create: () => new GlobCapabilityModule(),
  };
}
