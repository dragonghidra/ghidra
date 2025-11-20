import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createCodeQualityTools } from '../tools/codeQualityTools.js';

export interface CodeQualityCapabilityOptions {
  workingDir?: string;
  id?: string;
  description?: string;
}

export class CodeQualityCapabilityModule implements CapabilityModule {
  readonly id = 'capability.code-quality';
  private readonly options: CodeQualityCapabilityOptions;

  constructor(options: CodeQualityCapabilityOptions = {}) {
    this.options = options;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    return {
      id: this.options.id ?? 'code-quality.tools.linting',
      description:
        this.options.description ??
        'Code quality helpers for linting, maintainability analysis, and ESLint rule discovery.',
      toolSuite: {
        id: 'code-quality',
        description: 'Code quality and linting',
        tools: createCodeQualityTools(workingDir),
      },
      metadata: {
        workingDir,
      },
    };
  }
}
