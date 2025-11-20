import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { createGrepTools } from './grepTools.js';

export function createSearchTools(workingDir: string): ToolDefinition[] {
  // Include the advanced Grep tool from grepTools
  const grepTools = createGrepTools(workingDir);

  return [
    ...grepTools,
    {
      name: 'grep_search',
      description: 'Search for text patterns in files (similar to grep)',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The text pattern to search for (regex supported)',
          },
          path: {
            type: 'string',
            description: 'The directory or file to search in',
          },
          filePattern: {
            type: 'string',
            description: 'File pattern to filter (e.g., "*.ts", "*.js")',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Whether to perform case-sensitive search',
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const pattern = requireStringArg(args['pattern'], 'pattern');
          const searchPath = resolveSearchRoot(workingDir, args['path']);
          const filePattern = args['filePattern'] === undefined || args['filePattern'] === null
            ? undefined
            : requireStringArg(args['filePattern'], 'filePattern');
          const caseSensitive = args['caseSensitive'] === true;

          const regex = new RegExp(pattern, caseSensitive ? 'g' : 'gi');
          const results = searchInFiles(searchPath, regex, filePattern);

          if (results.length === 0) {
            return `No matches found for pattern: ${pattern}`;
          }

          return formatSearchResults(results);
        } catch (error) {
          return formatSearchError('searching', error);
        }
      },
    },
    {
      name: 'find_definition',
      description: 'Find function/class/interface definitions in code',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the function, class, or interface to find',
          },
          type: {
            type: 'string',
            enum: ['function', 'class', 'interface', 'type', 'const', 'any'],
            description: 'The type of definition to search for',
          },
        },
        required: ['name'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const name = requireStringArg(args['name'], 'name');
          const normalizedType = normalizeDefinitionType(args['type']);

          const patterns: Record<DefinitionSearchType, string> = {
            function: `(function\\s+${name}|const\\s+${name}\\s*=.*=>|${name}\\s*\\([^)]*\\)\\s*{)`,
            class: `class\\s+${name}`,
            interface: `interface\\s+${name}`,
            type: `type\\s+${name}`,
            const: `const\\s+${name}`,
            any: `(function\\s+${name}|class\\s+${name}|interface\\s+${name}|type\\s+${name}|const\\s+${name})`,
          };

          const pattern = patterns[normalizedType];
          const regex = new RegExp(pattern, 'gi');

          const results = searchInFiles(workingDir, regex, '*.{ts,js,tsx,jsx}');
          if (results.length === 0) {
            return `No definitions found for: ${name}`;
          }
          return formatSearchResults(results);
        } catch (error) {
          return formatSearchError('finding definition', error);
        }
      },
    },
  ];
}

interface SearchResult {
  file: string;
  line: number;
  content: string;
  match: string;
}

function searchInFiles(
  path: string,
  regex: RegExp,
  filePattern?: string
): SearchResult[] {
  const results: SearchResult[] = [];
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', '.next', 'build', 'coverage']);

  function search(currentPath: string) {
    try {
      const stat = statSync(currentPath);

      if (stat.isDirectory()) {
        const entries = readdirSync(currentPath);
        for (const entry of entries) {
          if (ignoredDirs.has(entry)) continue;
          search(join(currentPath, entry));
        }
      } else if (stat.isFile()) {
        if (filePattern && !matchFilePattern(currentPath, filePattern)) {
          return;
        }

        if (isBinaryFile(currentPath)) {
          return;
        }

        try {
          const content = readFileSync(currentPath, 'utf-8');
          const lines = content.split('\n');

          lines.forEach((line, index) => {
            const matches = line.match(regex);
            if (matches) {
              results.push({
                file: currentPath,
                line: index + 1,
                content: line.trim(),
                match: matches[0],
              });
            }
          });
        } catch (error) {
        }
      }
    } catch (error) {
    }
  }

  search(path);
  return results;
}

type DefinitionSearchType = 'function' | 'class' | 'interface' | 'type' | 'const' | 'any';

function normalizeDefinitionType(value: unknown): DefinitionSearchType {
  if (typeof value !== 'string') {
    return 'any';
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'function' || trimmed === 'class' || trimmed === 'interface' || trimmed === 'type' || trimmed === 'const') {
    return trimmed;
  }
  return 'any';
}

function formatSearchResults(results: SearchResult[]): string {
  const grouped = new Map<string, SearchResult[]>();

  for (const result of results) {
    if (!grouped.has(result.file)) {
      grouped.set(result.file, []);
    }
    grouped.get(result.file)!.push(result);
  }

  const output: string[] = [`Found ${results.length} matches in ${grouped.size} files:\n`];

  for (const [file, matches] of grouped) {
    output.push(`\n${file}:`);
    for (const match of matches) {
      output.push(`  Line ${match.line}: ${match.content}`);
    }
  }

  return output.join('\n');
}

function matchFilePattern(filePath: string, pattern: string): boolean {
  const regex = new RegExp(
    pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.'),
    'i'
  );
  return regex.test(filePath);
}

function isBinaryFile(filePath: string): boolean {
  const textExtensions = new Set([
    '.ts', '.js', '.tsx', '.jsx', '.json', '.md', '.txt',
    '.html', '.css', '.scss', '.sass', '.less',
    '.yml', '.yaml', '.xml', '.svg', '.sh', '.bash',
    '.py', '.rb', '.go', '.rs', '.c', '.cpp', '.h',
  ]);

  return !textExtensions.has(filePath.slice(filePath.lastIndexOf('.')));
}

function resolveSearchRoot(workingDir: string, rawPath: unknown): string {
  if (rawPath === undefined || rawPath === null || rawPath === '') {
    return workingDir;
  }
  const normalized = requireStringArg(rawPath, 'path');
  return join(workingDir, normalized);
}

function requireStringArg(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function formatSearchError(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error ${action}: ${message}`;
}
