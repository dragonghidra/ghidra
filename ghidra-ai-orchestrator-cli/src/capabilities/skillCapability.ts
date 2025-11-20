import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { SkillRepository } from '../skills/skillRepository.js';
import { createSkillTools } from '../tools/skillTools.js';

export class SkillCapabilityModule implements CapabilityModule {
  readonly id = 'capability.skills';
  private repository: SkillRepository | null = null;

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    this.repository = new SkillRepository({
      workingDir: context.workingDir,
      env: context.env,
    });

    return {
      id: 'skills.tools',
      description: 'Load Claude Skill packages and inspect available reusable workflows.',
      toolSuite: {
        id: 'skills',
        description: 'Claude Skill discovery and loading',
        tools: createSkillTools({
          repository: this.repository,
        }),
      },
      dispose: async () => {
        this.repository = null;
      },
    };
  }
}
