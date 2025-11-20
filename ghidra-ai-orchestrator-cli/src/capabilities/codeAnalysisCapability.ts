import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createCodeAnalysisTools } from '../tools/codeAnalysisTools.js';

export interface CodeAnalysisCapabilityOptions {
  workingDir?: string;
  id?: string;
  description?: string;
}

export class CodeAnalysisCapabilityModule implements CapabilityModule {
  readonly id = 'capability.code-analysis';
  private readonly options: CodeAnalysisCapabilityOptions;

  constructor(options: CodeAnalysisCapabilityOptions = {}) {
    this.options = options;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    return {
      id: this.options.id ?? 'code-analysis.tools.structural',
      description: this.options.description ?? 'Advanced code structure analysis, dependency tracking, and complexity metrics.',
      toolSuite: {
        id: 'code-analysis',
        description: 'Code analysis and metrics',
        tools: createCodeAnalysisTools(workingDir),
      },
      metadata: {
        workingDir,
      },
    };
  }
}