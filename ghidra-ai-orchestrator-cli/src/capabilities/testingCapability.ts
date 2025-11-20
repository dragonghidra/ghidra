import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createTestingTools } from '../tools/testingTools.js';

export interface TestingCapabilityOptions {
  workingDir?: string;
  id?: string;
  description?: string;
}

export class TestingCapabilityModule implements CapabilityModule {
  readonly id = 'capability.testing';
  private readonly options: TestingCapabilityOptions;

  constructor(options: TestingCapabilityOptions = {}) {
    this.options = options;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    return {
      id: this.options.id ?? 'testing.tools.coverage',
      description:
        this.options.description ??
        'Test generation helpers plus coverage execution and reporting utilities.',
      toolSuite: {
        id: 'testing',
        description: 'Testing and coverage',
        tools: createTestingTools(workingDir),
      },
      metadata: {
        workingDir,
      },
    };
  }
}
