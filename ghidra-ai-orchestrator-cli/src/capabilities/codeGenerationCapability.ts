import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createCodeGenerationTools } from '../tools/codeGenerationTools.js';

export interface CodeGenerationCapabilityOptions {
  workingDir?: string;
  id?: string;
  description?: string;
}

export class CodeGenerationCapabilityModule implements CapabilityModule {
  readonly id = 'capability.code-generation';
  private readonly options: CodeGenerationCapabilityOptions;

  constructor(options: CodeGenerationCapabilityOptions = {}) {
    this.options = options;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    return {
      id: this.options.id ?? 'code-generation.tools.assistant',
      description:
        this.options.description ??
        'Advanced code generation including boilerplate creation, component templates, and utility generation.',
      toolSuite: {
        id: 'code-generation',
        description: 'Code generation assistants',
        tools: createCodeGenerationTools(workingDir),
      },
      metadata: {
        workingDir,
      },
    };
  }
}