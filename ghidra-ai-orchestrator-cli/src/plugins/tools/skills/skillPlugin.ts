import { SkillCapabilityModule } from '../../../capabilities/skillCapability.js';
import type { ToolPlugin } from '../registry.js';

export function createSkillToolPlugin(): ToolPlugin {
  return {
    id: 'tool.skills.loader',
    targets: ['node', 'cloud'],
    create: () => new SkillCapabilityModule(),
  };
}
