import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { buildError } from '../core/errors.js';
import { buildDiffSegments, formatDiffLines, type DiffSegment } from './diffUtils.js';

export function createFileTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'read_file',
      description: 'Read the contents of a file at the specified path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The file path (relative to working directory or absolute)',
            minLength: 1,
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const pathArg = args['path'];
        const requestedPath = normalizePathContext(pathArg);
        let resolvedPath: string | undefined;
        try {
          const filePath = resolveFilePath(workingDir, pathArg);
          resolvedPath = filePath;
          if (!existsSync(filePath)) {
            return `Error: File not found: ${filePath}`;
          }

          const content = readFileSync(filePath, 'utf-8');
          return `File: ${filePath}\n\n${content}`;
        } catch (error: any) {
          return buildError('reading file', error, { path: requestedPath, resolvedPath });
        }
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file at the specified path (creates directories if needed)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The file path (relative to working directory or absolute)',
            minLength: 1,
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const pathArg = args['path'];
        const requestedPath = normalizePathContext(pathArg);
        let resolvedPath: string | undefined;
        try {
          const filePath = resolveFilePath(workingDir, pathArg);
          resolvedPath = filePath;
          const dir = dirname(filePath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }

          const nextContent = typeof args['content'] === 'string' ? (args['content'] as string) : '';
          const filePreviouslyExisted = existsSync(filePath);
          const previousContent = filePreviouslyExisted ? readFileSync(filePath, 'utf-8') : '';
          const diffSegments = buildDiffSegments(previousContent, nextContent);

          writeFileSync(filePath, nextContent, 'utf-8');

          return buildWriteSummary(filePath, diffSegments, workingDir, filePreviouslyExisted);
        } catch (error: any) {
          return buildError('writing file', error, { path: requestedPath, resolvedPath });
        }
      },
    },
    {
      name: 'list_files',
      description: 'List files and directories at the specified path',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The directory path (defaults to current working directory)',
            minLength: 1,
          },
          recursive: {
            type: 'boolean',
            description: 'Whether to list files recursively',
          },
        },
        additionalProperties: false,
      },
      handler: async (args) => {
        const pathArg = args['path'];
        const requestedPath = normalizePathContext(pathArg);
        let resolvedPath: string | undefined;
        try {
          const dirPath =
            pathArg !== undefined && pathArg !== null ? resolveFilePath(workingDir, pathArg) : workingDir;
          resolvedPath = dirPath;
          const recursive = args['recursive'] === true;

          if (!existsSync(dirPath)) {
            return `Error: Directory not found: ${dirPath}`;
          }

          const files = listFilesRecursive(dirPath, recursive ? 5 : 1, workingDir);
          return `Directory: ${dirPath}\n\n${files.join('\n')}`;
        } catch (error: any) {
          return buildError('listing files', error, { path: requestedPath, resolvedPath });
        }
      },
    },
    {
      name: 'search_files',
      description: 'Search for files matching a pattern (supports glob patterns)',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The search pattern (e.g., "*.ts", "src/**/*.js")',
            minLength: 1,
          },
          path: {
            type: 'string',
            description: 'The directory to search in (defaults to current working directory)',
            minLength: 1,
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const pathArg = args['path'];
        const requestedPath = normalizePathContext(pathArg);
        const patternArg = args['pattern'];
        const requestedPattern = typeof patternArg === 'string' ? patternArg : undefined;
        let resolvedPath: string | undefined;
        try {
          const pattern = typeof patternArg === 'string' && patternArg.trim() ? patternArg : null;
          if (!pattern) {
            return 'Error: pattern must be a non-empty string.';
          }
          const searchPath =
            pathArg !== undefined && pathArg !== null ? resolveFilePath(workingDir, pathArg) : workingDir;
          resolvedPath = searchPath;
          const results = searchFilesGlob(searchPath, pattern);
          if (results.length === 0) {
            return `No files found matching pattern: ${pattern}`;
          }
          return `Found ${results.length} files:\n\n${results.map((f) => relative(workingDir, f)).join('\n')}`;
        } catch (error: any) {
          return buildError('searching files', error, {
            path: requestedPath,
            resolvedPath,
            pattern: requestedPattern,
          });
        }
      },
    },
  ];
}

function resolveFilePath(workingDir: string, path: unknown): string {
  const validated = validatePathArg(path);
  return validated.startsWith('/') ? validated : join(workingDir, validated);
}

function validatePathArg(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Path must be a non-empty string.');
  }
  return path.trim();
}

function normalizePathContext(path: unknown): string | undefined {
  if (path === undefined || path === null) {
    return undefined;
  }
  try {
    return String(path);
  } catch {
    return '(unprintable)';
  }
}

function listFilesRecursive(dir: string, maxDepth: number, baseDir: string, currentDepth = 0): string[] {
  if (currentDepth >= maxDepth) {
    return [];
  }

  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', '.next', 'build', 'coverage']);
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (ignoredDirs.has(entry.name)) {
        continue;
      }

      const fullPath = join(dir, entry.name);
      const indent = '  '.repeat(currentDepth);

      if (entry.isDirectory()) {
        results.push(`${indent}${entry.name}/`);
        results.push(...listFilesRecursive(fullPath, maxDepth, baseDir, currentDepth + 1));
      } else {
        const stats = statSync(fullPath);
        const size = formatFileSize(stats.size);
        results.push(`${indent}${entry.name} ${size}`);
      }
    }
  } catch (error) {
  }

  return results;
}

function searchFilesGlob(dir: string, pattern: string): string[] {
  const results: string[] = [];
  const regex = globToRegex(pattern);

  function search(currentDir: string) {
    const ignoredDirs = new Set(['.git', 'node_modules', 'dist', '.next', 'build', 'coverage']);

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (ignoredDirs.has(entry.name)) {
          continue;
        }

        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          search(fullPath);
        } else if (regex.test(fullPath)) {
          results.push(fullPath);
        }
      }
    } catch (error) {
    }
  }

  search(dir);
  return results;
}

function buildWriteSummary(
  filePath: string,
  diffSegments: DiffSegment[],
  workingDir: string,
  filePreviouslyExisted: boolean
): string {
  const readablePath = formatRelativeFilePath(filePath, workingDir);
  const addedLines = diffSegments.filter((segment) => segment.type === 'added').length;
  const removedLines = diffSegments.filter((segment) => segment.type === 'removed').length;
  const hasChanges = diffSegments.length > 0;
  const actionLabel = !filePreviouslyExisted ? 'Added' : hasChanges ? 'Edited' : 'Updated';
  const header = `#### ${actionLabel} ${readablePath}`;

  if (!hasChanges) {
    return `${header}\nNo textual changes.`;
  }

  const statsLine = `Lines changed: +${addedLines} / -${removedLines}`;
  const diffLines = formatDiffLines(diffSegments);
  const diffBlock = ['```diff', ...diffLines, '```'].join('\n');
  const sections = [header, statsLine, '', 'Diff preview:', diffBlock];
  return sections.join('\n').trimEnd();
}

function formatRelativeFilePath(filePath: string, workingDir: string): string {
  const relPath = relative(workingDir, filePath);
  if (!relPath || relPath.startsWith('..')) {
    return filePath;
  }
  return relPath;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');
  return new RegExp(escaped);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
