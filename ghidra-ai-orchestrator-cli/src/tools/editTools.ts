import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { buildError } from '../core/errors.js';
import { buildDiffSegments, formatDiffLines } from './diffUtils.js';

/**
 * Creates the Edit tool for surgical file modifications using exact string replacement.
 *
 * This tool performs string-based edits without requiring full file rewrites,
 * making it ideal for targeted changes while preserving exact formatting and indentation.
 *
 * Features:
 * - Exact string matching (preserves indentation)
 * - Replace all occurrences or enforce uniqueness
 * - Unified diff preview
 * - Validation before writing
 *
 * @param workingDir - The working directory for resolving relative paths
 * @returns Array containing the Edit tool definition
 */
export function createEditTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'Edit',
      description: 'Performs exact string replacements in files. Use for surgical edits when you know the exact text to replace. The edit will FAIL if old_string is not unique unless replace_all is true.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The absolute path to the file to modify',
          },
          old_string: {
            type: 'string',
            description: 'The exact text to replace (must match precisely including indentation and whitespace)',
          },
          new_string: {
            type: 'string',
            description: 'The text to replace it with (must be different from old_string)',
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace all occurrences of old_string (default false). When false, the edit fails if old_string appears multiple times.',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const pathArg = args['file_path'];
        const oldString = args['old_string'];
        const newString = args['new_string'];
        const replaceAll = args['replace_all'] === true;

        // Validate inputs
        if (typeof pathArg !== 'string' || !pathArg.trim()) {
          return 'Error: file_path must be a non-empty string.';
        }
        if (typeof oldString !== 'string') {
          return 'Error: old_string must be a string.';
        }
        if (typeof newString !== 'string') {
          return 'Error: new_string must be a string.';
        }
        if (oldString === newString) {
          return 'Error: old_string and new_string must be different.';
        }

        try {
          const filePath = resolveFilePath(workingDir, pathArg);

          // Check file exists
          if (!existsSync(filePath)) {
            return `Error: File not found: ${filePath}`;
          }

          // Read current content
          const currentContent = readFileSync(filePath, 'utf-8');

          // Check if old_string exists in file
          if (!currentContent.includes(oldString)) {
            return `Error: old_string not found in file. The exact text must match including all whitespace and indentation.\n\nFile: ${filePath}\nSearching for: ${JSON.stringify(oldString.substring(0, 100))}...`;
          }

          // Count occurrences
          const occurrences = countOccurrences(currentContent, oldString);

          if (!replaceAll && occurrences > 1) {
            return `Error: old_string appears ${occurrences} times in the file. Either:\n1. Provide a larger unique string that includes more context\n2. Set replace_all: true to replace all ${occurrences} occurrences\n\nFile: ${filePath}`;
          }

          // Perform replacement
          const newContent = replaceAll
            ? currentContent.split(oldString).join(newString)
            : currentContent.replace(oldString, newString);

          // Generate diff
          const diffSegments = buildDiffSegments(currentContent, newContent);

          // Write file
          writeFileSync(filePath, newContent, 'utf-8');

          // Build summary
          const relativePath = relative(workingDir, filePath);
          const displayPath = relativePath && !relativePath.startsWith('..') ? relativePath : filePath;
          const addedLines = diffSegments.filter(s => s.type === 'added').length;
          const removedLines = diffSegments.filter(s => s.type === 'removed').length;
          const occurrencesText = replaceAll ? ` (${occurrences} occurrence${occurrences > 1 ? 's' : ''})` : '';

          const diffLines = formatDiffLines(diffSegments);
          const diffBlock = diffLines.length > 0
            ? ['```diff', ...diffLines, '```'].join('\n')
            : '(No visual diff - whitespace or formatting changes only)';

          return [
            `✓ Edited ${displayPath}${occurrencesText}`,
            `Lines changed: +${addedLines} / -${removedLines}`,
            '',
            'Diff preview:',
            diffBlock,
          ].join('\n');

        } catch (error: any) {
          return buildError('editing file', error, {
            file_path: pathArg,
            old_string_length: typeof oldString === 'string' ? oldString.length : 0,
            new_string_length: typeof newString === 'string' ? newString.length : 0,
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

function countOccurrences(text: string, search: string): number {
  if (!search) return 0;
  let count = 0;
  let position = 0;

  while ((position = text.indexOf(search, position)) !== -1) {
    count++;
    position += search.length;
  }

  return count;
}
