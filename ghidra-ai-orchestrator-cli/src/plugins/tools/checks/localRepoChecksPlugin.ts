import { RepoChecksCapabilityModule } from '../../../capabilities/repoChecksCapability.js';
import type { ToolPlugin } from '../registry.js';

export function createLocalRepoChecksPlugin(): ToolPlugin {
  return {
    id: 'tool.repo-checks.local',
    description: 'Run npm-based repo checks (test/build/lint) in the sandboxed workspace.',
    targets: ['node', 'cloud'],
    create: (context) => {
      return new RepoChecksCapabilityModule({
        workingDir: context.workingDir,
      });
    },
  };
}
