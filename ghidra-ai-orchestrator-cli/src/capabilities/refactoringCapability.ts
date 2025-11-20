import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createRefactoringTools } from '../tools/refactoringTools.js';

export interface RefactoringCapabilityOptions {
  workingDir?: string;
  id?: string;
  description?: string;
}

export class RefactoringCapabilityModule implements CapabilityModule {
  readonly id = 'capability.refactoring';
  private readonly options: RefactoringCapabilityOptions;

  constructor(options: RefactoringCapabilityOptions = {}) {
    this.options = options;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    return {
      id: this.options.id ?? 'refactoring.tools.assistant',
      description:
        this.options.description ??
        'Refactoring intelligence including hotspot detection, impact analysis, and actionable plan suggestions.',
      toolSuite: {
        id: 'refactoring',
        description: 'Refactoring assistants',
        tools: createRefactoringTools(workingDir),
      },
      metadata: {
        workingDir,
      },
    };
  }
}
