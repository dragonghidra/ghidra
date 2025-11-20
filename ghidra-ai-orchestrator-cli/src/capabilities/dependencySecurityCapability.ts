import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createDependencyTools } from '../tools/dependencyTools.js';

export interface DependencySecurityCapabilityOptions {
  workingDir?: string;
  id?: string;
  description?: string;
}

export class DependencySecurityCapabilityModule implements CapabilityModule {
  readonly id = 'capability.dependency-security';
  private readonly options: DependencySecurityCapabilityOptions;

  constructor(options: DependencySecurityCapabilityOptions = {}) {
    this.options = options;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.options.workingDir ?? context.workingDir;
    return {
      id: this.options.id ?? 'dependency.tools.health',
      description:
        this.options.description ?? 'Dependency insight, npm audit orchestration, and lockfile health summaries.',
      toolSuite: {
        id: 'dependency-security',
        description: 'Dependency analysis & security scanning',
        tools: createDependencyTools(workingDir),
      },
      metadata: {
        workingDir,
      },
    };
  }
}
