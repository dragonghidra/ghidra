import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { buildError } from '../core/errors.js';

/**
 * Creates the Glob tool for fast file pattern matching
 *
 * Features:
 * - Supports glob patterns like wildcard recursion or directory matching
 * - Returns matching file paths sorted by modification time (newest first)
 * - Ignores common directories (.git, node_modules, dist)
 * - Fast pattern matching optimized for large codebases
 *
 * @param workingDir - The working directory for pattern matching
 * @returns Array containing the Glob tool definition
 */
export function createGlobTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'Glob',
      description: 'Fast file pattern matching tool that works with any codebase size. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The glob pattern to match files against (e.g., "**/*.ts", "src/**/*.js", "*.md")',
          },
          path: {
            type: 'string',
            description: 'The directory to search in. If not specified, the current working directory will be used.',
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const pattern = args['pattern'];
        const pathArg = args['path'];

        // Validate pattern
        if (typeof pattern !== 'string' || !pattern.trim()) {
          return 'Error: pattern must be a non-empty string.';
        }

        try {
          const searchPath = pathArg && typeof pathArg === 'string'
            ? resolveFilePath(workingDir, pathArg)
            : workingDir;

          // Perform glob search
          const matches = globSearch(searchPath, pattern);

          // Sort by modification time (newest first)
          const sorted = matches.sort((a, b) => {
            try {
              const statA = statSync(a);
              const statB = statSync(b);
              return statB.mtimeMs - statA.mtimeMs;
            } catch {
              return 0;
            }
          });

          // Convert to relative paths
          const relativePaths = sorted.map(filePath => {
            const rel = relative(workingDir, filePath);
            return rel && !rel.startsWith('..') ? rel : filePath;
          });

          if (relativePaths.length === 0) {
            return `No files found matching pattern: ${pattern}`;
          }

          const summary = relativePaths.length === 1
            ? '1 file found'
            : `${relativePaths.length} files found`;

          return `${summary} matching "${pattern}":\n\n${relativePaths.join('\n')}`;

        } catch (error: any) {
          return buildError('glob search', error, {
            pattern: String(pattern),
            path: pathArg ? String(pathArg) : undefined,
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

function globSearch(baseDir: string, pattern: string): string[] {
  const results: string[] = [];
  const regex = globToRegex(pattern);
  const ignoredDirs = new Set([
    '.git',
    'node_modules',
    'dist',
    '.next',
    'build',
    'coverage',
    '.turbo',
    '.cache',
    '__pycache__',
    '.pytest_cache',
    '.venv',
    'venv',
  ]);

  function search(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (ignoredDirs.has(entry.name)) {
          continue;
        }

        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          search(fullPath);
        } else {
          // Test the full path against the pattern
          if (regex.test(fullPath)) {
            results.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Silently ignore permission errors
    }
  }

  search(baseDir);
  return results;
}

function globToRegex(pattern: string): RegExp {
  // Escape special regex characters except glob wildcards
  let escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\+/g, '\\+')
    .replace(/\^/g, '\\^')
    .replace(/\$/g, '\\$')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\|/g, '\\|');

  // Convert glob patterns to regex
  escaped = escaped
    .replace(/\*\*/g, '<!GLOBSTAR!>')   // Placeholder for **
    .replace(/\*/g, '[^/]*')             // * matches any characters except /
    .replace(/<!GLOBSTAR!>/g, '.*')     // ** matches any characters including /
    .replace(/\?/g, '.');                // ? matches any single character

  return new RegExp(escaped + '$');
}
