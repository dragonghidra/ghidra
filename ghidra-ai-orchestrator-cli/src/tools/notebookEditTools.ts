import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { buildError } from '../core/errors.js';

/**
 * Jupyter Notebook Structure
 */
interface NotebookCell {
  cell_type: 'code' | 'markdown';
  execution_count?: number | null;
  id?: string;
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  source: string | string[];
}

interface JupyterNotebook {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Creates the NotebookEdit tool for editing Jupyter .ipynb files
 *
 * This tool allows surgical editing of Jupyter notebook cells, supporting:
 * - Replacing cell content
 * - Inserting new cells
 * - Deleting cells
 * - Both code and markdown cells
 *
 * @param workingDir - The working directory for resolving paths
 * @returns Array containing the NotebookEdit tool definition
 */
export function createNotebookEditTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'NotebookEdit',
      description: 'Completely replaces or modifies cells in a Jupyter notebook (.ipynb file). Use edit_mode=replace (default) to replace a cell, edit_mode=insert to add a new cell, or edit_mode=delete to remove a cell.',
      parameters: {
        type: 'object',
        properties: {
          notebook_path: {
            type: 'string',
            description: 'The absolute path to the Jupyter notebook file to edit (must be .ipynb file)',
          },
          cell_id: {
            type: 'string',
            description: 'The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.',
          },
          new_source: {
            type: 'string',
            description: 'The new source for the cell (code or markdown content)',
          },
          cell_type: {
            type: 'string',
            description: 'The type of the cell (code or markdown). If not specified, defaults to current cell type. Required when using edit_mode=insert.',
          },
          edit_mode: {
            type: 'string',
            description: 'The type of edit to make: "replace" (default), "insert", or "delete"',
          },
        },
        required: ['notebook_path', 'new_source'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const notebookPath = args['notebook_path'];
        const cellId = args['cell_id'];
        const newSource = args['new_source'];
        const cellType = args['cell_type'];
        const editMode = args['edit_mode'] || 'replace';

        // Validate inputs
        if (typeof notebookPath !== 'string' || !notebookPath.trim()) {
          return 'Error: notebook_path must be a non-empty string.';
        }
        if (!notebookPath.endsWith('.ipynb')) {
          return 'Error: notebook_path must be a .ipynb file.';
        }
        if (typeof newSource !== 'string') {
          return 'Error: new_source must be a string.';
        }
        if (editMode !== 'replace' && editMode !== 'insert' && editMode !== 'delete') {
          return 'Error: edit_mode must be "replace", "insert", or "delete".';
        }
        if (editMode === 'insert' && !cellType) {
          return 'Error: cell_type is required when edit_mode=insert.';
        }
        if (cellType && cellType !== 'code' && cellType !== 'markdown') {
          return 'Error: cell_type must be "code" or "markdown".';
        }

        try {
          const filePath = resolveFilePath(workingDir, notebookPath);

          // Check file exists
          if (!existsSync(filePath)) {
            return `Error: Notebook file not found: ${filePath}`;
          }

          // Read and parse notebook
          const content = readFileSync(filePath, 'utf-8');
          let notebook: JupyterNotebook;
          try {
            notebook = JSON.parse(content);
          } catch (parseError) {
            return `Error: Failed to parse notebook JSON: ${parseError}`;
          }

          // Validate notebook structure
          if (!notebook.cells || !Array.isArray(notebook.cells)) {
            return 'Error: Invalid notebook structure - missing cells array.';
          }

          // Perform the edit
          let resultMessage: string;
          switch (editMode) {
            case 'insert':
              resultMessage = insertCell(notebook, cellId as string | undefined, newSource, cellType as 'code' | 'markdown');
              break;
            case 'delete':
              resultMessage = deleteCell(notebook, cellId as string | undefined);
              break;
            case 'replace':
            default:
              resultMessage = replaceCell(notebook, cellId as string | undefined, newSource, cellType as 'code' | 'markdown' | undefined);
              break;
          }

          // Write back to file
          const updatedContent = JSON.stringify(notebook, null, 2);
          writeFileSync(filePath, updatedContent, 'utf-8');

          return `✓ Notebook edited: ${filePath}\n${resultMessage}`;

        } catch (error: any) {
          return buildError('editing notebook', error, {
            notebook_path: notebookPath,
            edit_mode: editMode,
          });
        }
      },
    },
  ];
}

function resolveFilePath(workingDir: string, path: string): string {
  const normalized = path.trim();
  return normalized.startsWith('/') ? normalized : join(workingDir, normalized);
}

function replaceCell(
  notebook: JupyterNotebook,
  cellId: string | undefined,
  newSource: string,
  cellType?: 'code' | 'markdown'
): string {
  let cellIndex: number;

  if (cellId) {
    // Find cell by ID
    cellIndex = notebook.cells.findIndex(c => c.id === cellId);
    if (cellIndex === -1) {
      throw new Error(`Cell with id "${cellId}" not found.`);
    }
  } else {
    // Default to first cell
    if (notebook.cells.length === 0) {
      throw new Error('Notebook has no cells. Use edit_mode=insert to add a cell.');
    }
    cellIndex = 0;
  }

  const cell = notebook.cells[cellIndex]!;

  const oldType = cell.cell_type;
  const newType = cellType || oldType;

  // Update cell
  cell.cell_type = newType;
  cell.source = newSource.split('\n');

  // If changing from code to markdown, remove code-specific fields
  if (oldType === 'code' && newType === 'markdown') {
    delete cell.execution_count;
    delete cell.outputs;
  }

  // If changing from markdown to code, add code-specific fields
  if (oldType === 'markdown' && newType === 'code') {
    cell.execution_count = null;
    cell.outputs = [];
  }

  return `Replaced cell ${cellIndex} (${oldType} → ${newType})`;
}

function insertCell(
  notebook: JupyterNotebook,
  afterCellId: string | undefined,
  newSource: string,
  cellType: 'code' | 'markdown'
): string {
  let insertIndex = 0;

  if (afterCellId) {
    const afterIndex = notebook.cells.findIndex(c => c.id === afterCellId);
    if (afterIndex === -1) {
      throw new Error(`Cell with id "${afterCellId}" not found.`);
    }
    insertIndex = afterIndex + 1;
  }

  const newCell: NotebookCell = {
    cell_type: cellType,
    id: generateCellId(),
    metadata: {},
    source: newSource.split('\n'),
  };

  if (cellType === 'code') {
    newCell.execution_count = null;
    newCell.outputs = [];
  }

  notebook.cells.splice(insertIndex, 0, newCell);

  return `Inserted new ${cellType} cell at position ${insertIndex}`;
}

function deleteCell(
  notebook: JupyterNotebook,
  cellId: string | undefined
): string {
  if (!cellId) {
    throw new Error('cell_id is required when edit_mode=delete.');
  }

  const cellIndex = notebook.cells.findIndex(c => c.id === cellId);
  if (cellIndex === -1) {
    throw new Error(`Cell with id "${cellId}" not found.`);
  }

  const cellType = notebook.cells[cellIndex]!.cell_type;
  notebook.cells.splice(cellIndex, 1);

  return `Deleted ${cellType} cell at position ${cellIndex}`;
}

function generateCellId(): string {
  // Generate a random cell ID (simplified version)
  return Math.random().toString(36).substring(2, 10);
}
