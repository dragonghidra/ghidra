import { WebCapabilityModule } from '../../../capabilities/webCapability.js';
import type { ToolPlugin } from '../registry.js';

export function createWebToolPlugin(): ToolPlugin {
  return {
    id: 'tool.web.local',
    description: 'Web content fetching and search tools for accessing online information.',
    targets: ['node', 'cloud'],
    create: (_context) => {
      return new WebCapabilityModule({});
    },
  };
}
