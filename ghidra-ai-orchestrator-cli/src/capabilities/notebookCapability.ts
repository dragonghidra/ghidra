import type { CapabilityModule, CapabilityContext, CapabilityContribution } from '../runtime/agentHost.js';
import { createNotebookEditTools } from '../tools/notebookEditTools.js';

/**
 * Notebook Capability Module
 *
 * Provides Jupyter notebook editing capabilities.
 * Supports .ipynb files with cell-level operations.
 *
 * Tools:
 * - NotebookEdit: Replace, insert, or delete notebook cells
 *
 * Scope: filesystem:write, analysis:notebook
 */
export class NotebookCapabilityModule implements CapabilityModule {
  readonly id = 'capability.notebook';

  async create(context: CapabilityContext): Promise<CapabilityContribution> {
    const tools = createNotebookEditTools(context.workingDir);

    return {
      id: 'notebook.editing',
      description: 'Jupyter notebook (.ipynb) editing tools',
      toolSuite: {
        id: 'notebook',
        tools,
      },
    };
  }
}
