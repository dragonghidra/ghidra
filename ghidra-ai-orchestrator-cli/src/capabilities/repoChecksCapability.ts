import type { CapabilityContribution, CapabilityContext, CapabilityModule } from '../runtime/agentHost.js';
import { createRepoCheckTools } from '../tools/repoChecksTools.js';

export class RepoChecksCapabilityModule implements CapabilityModule {
  readonly id = 'capability.repo_checks';
  private readonly workingDirOverride: string | undefined;

  constructor(options: { workingDir?: string } = {}) {
    this.workingDirOverride = options.workingDir;
  }

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const workingDir = this.workingDirOverride ?? context.workingDir;
    return {
      id: 'repo.checks.tools',
      description: 'Run repository validation commands (npm test/build/lint) inside the sandbox.',
      toolSuite: {
        id: 'repo-checks',
        description: 'Repository quality checks',
        tools: createRepoCheckTools(workingDir),
      },
      metadata: {
        workingDir,
      },
    };
  }
}
