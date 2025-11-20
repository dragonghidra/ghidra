import type { ToolPlugin } from '../registry.js';
import { NotebookCapabilityModule } from '../../../capabilities/notebookCapability.js';

/**
 * Notebook Tool Plugin
 *
 * Registers Jupyter notebook editing capabilities.
 * Available in node and cloud runtimes.
 */
export function createNotebookToolPlugin(): ToolPlugin {
  return {
    id: 'tool.notebook',
    targets: ['node', 'cloud'],
    create: () => new NotebookCapabilityModule(),
  };
}
