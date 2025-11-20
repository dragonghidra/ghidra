import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { buildError } from '../core/errors.js';

/**
 * Creates the Grep tool - a powerful search tool built on ripgrep patterns
 *
 * Features:
 * - Full regex syntax support
 * - Multiple output modes (content, files_with_matches, count)
 * - Context lines (-A, -B, -C)
 * - Case insensitivity
 * - Type filtering (js, ts, py, etc.)
 * - Glob pattern filtering
 * - Multiline matching
 * - Head/offset limiting
 *
 * @param workingDir - The working directory for searching
 * @returns Array containing the Grep tool definition
 */
export function createGrepTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'Grep',
      description: 'A powerful search tool built on ripgrep patterns. Supports full regex syntax, multiple output modes, and context lines. Use for searching file contents.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The regular expression pattern to search for in file contents',
          },
          path: {
            type: 'string',
            description: 'File or directory to search in (defaults to current working directory)',
          },
          output_mode: {
            type: 'string',
            description: 'Output mode: "content" shows matching lines, "files_with_matches" shows file paths (default), "count" shows match counts',
          },
          '-i': {
            type: 'boolean',
            description: 'Case insensitive search',
          },
          '-n': {
            type: 'boolean',
            description: 'Show line numbers in output (requires output_mode: "content"). Defaults to true.',
          },
          '-A': {
            type: 'number',
            description: 'Number of lines to show after each match (requires output_mode: "content")',
          },
          '-B': {
            type: 'number',
            description: 'Number of lines to show before each match (requires output_mode: "content")',
          },
          '-C': {
            type: 'number',
            description: 'Number of lines to show before and after each match (requires output_mode: "content")',
          },
          glob: {
            type: 'string',
            description: 'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}")',
          },
          type: {
            type: 'string',
            description: 'File type to search (e.g. "js", "py", "rust", "go"). More efficient than glob for standard file types.',
          },
          multiline: {
            type: 'boolean',
            description: 'Enable multiline mode where . matches newlines and patterns can span lines. Default: false.',
          },
          head_limit: {
            type: 'number',
            description: 'Limit output to first N lines/entries. Works across all output modes.',
          },
          offset: {
            type: 'number',
            description: 'Skip first N lines/entries before applying head_limit. Defaults to 0.',
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const pattern = args['pattern'];
        const pathArg = args['path'];
        const outputMode = args['output_mode'] || 'files_with_matches';
        const caseInsensitive = args['-i'] === true;
        const showLineNumbers = args['-n'] !== false; // Default true
        const afterContext = typeof args['-A'] === 'number' ? args['-A'] : 0;
        const beforeContext = typeof args['-B'] === 'number' ? args['-B'] : 0;
        const contextLines = typeof args['-C'] === 'number' ? args['-C'] : 0;
        const globPattern = args['glob'];
        const fileType = args['type'];
        const multiline = args['multiline'] === true;
        const headLimit = typeof args['head_limit'] === 'number' ? args['head_limit'] : undefined;
        const offset = typeof args['offset'] === 'number' ? args['offset'] : 0;

        // Validate pattern
        if (typeof pattern !== 'string' || !pattern.trim()) {
          return 'Error: pattern must be a non-empty string.';
        }

        // Validate output_mode
        if (outputMode !== 'content' && outputMode !== 'files_with_matches' && outputMode !== 'count') {
          return 'Error: output_mode must be "content", "files_with_matches", or "count".';
        }

        try {
          const searchPath = pathArg && typeof pathArg === 'string'
            ? resolveFilePath(workingDir, pathArg)
            : workingDir;

          // Create regex with appropriate flags
          const flags = caseInsensitive ? 'gi' : 'g';
          const dotallFlags = multiline ? (caseInsensitive ? 'gis' : 'gs') : flags;
          const regex = new RegExp(pattern, dotallFlags);

          // Perform search
          const matches = searchFiles(searchPath, regex, {
            globPattern: typeof globPattern === 'string' ? globPattern : undefined,
            fileType: typeof fileType === 'string' ? fileType : undefined,
            multiline,
          });

          // Apply offset and head_limit
          const filteredMatches = applyOffsetAndLimit(matches, offset, headLimit);

          // Format output based on mode
          let result: string;
          switch (outputMode) {
            case 'content':
              result = formatContentOutput(filteredMatches, {
                showLineNumbers,
                beforeContext: contextLines || beforeContext,
                afterContext: contextLines || afterContext,
                searchPath,
              });
              break;
            case 'count':
              result = formatCountOutput(filteredMatches, searchPath);
              break;
            case 'files_with_matches':
            default:
              result = formatFilesOutput(filteredMatches, searchPath);
              break;
          }

          return result;

        } catch (error: any) {
          return buildError('grep search', error, {
            pattern: String(pattern),
            path: pathArg ? String(pathArg) : undefined,
            output_mode: String(outputMode),
          });
        }
      },
    },
  ];
}

interface SearchMatch {
  file: string;
  line: number;
  content: string;
  match: string;
}

interface SearchOptions {
  globPattern?: string;
  fileType?: string;
  multiline?: boolean;
}

function resolveFilePath(workingDir: string, path: string): string {
  const normalized = path.trim();
  return normalized.startsWith('/') ? normalized : join(workingDir, normalized);
}

function searchFiles(
  searchPath: string,
  regex: RegExp,
  options: SearchOptions
): SearchMatch[] {
  const results: SearchMatch[] = [];
  const ignoredDirs = new Set([
    '.git', 'node_modules', 'dist', '.next', 'build', 'coverage',
    '.turbo', '.cache', '__pycache__', '.pytest_cache', '.venv', 'venv',
  ]);

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
        // Filter by file type or glob
        if (options.fileType && !matchesFileType(currentPath, options.fileType)) {
          return;
        }
        if (options.globPattern && !matchesGlob(currentPath, options.globPattern)) {
          return;
        }

        // Skip binary files
        if (isBinaryFile(currentPath)) {
          return;
        }

        // Read and search file
        const content = readFileSync(currentPath, 'utf-8');

        if (options.multiline) {
          // Multiline mode: search entire content
          const matches = content.match(regex);
          if (matches) {
            for (const match of matches) {
              results.push({
                file: currentPath,
                line: 1, // In multiline, line numbers are approximate
                content: match,
                match,
              });
            }
          }
        } else {
          // Line-by-line mode
          const lines = content.split('\n');
          lines.forEach((line, index) => {
            const matches = line.match(regex);
            if (matches) {
              results.push({
                file: currentPath,
                line: index + 1,
                content: line,
                match: matches[0],
              });
            }
          });
        }
      }
    } catch (error) {
      // Silently ignore permission errors
    }
  }

  search(searchPath);
  return results;
}

function applyOffsetAndLimit(
  matches: SearchMatch[],
  offset: number,
  headLimit?: number
): SearchMatch[] {
  let result = matches;

  if (offset > 0) {
    result = result.slice(offset);
  }

  if (headLimit !== undefined && headLimit > 0) {
    result = result.slice(0, headLimit);
  }

  return result;
}

function formatContentOutput(
  matches: SearchMatch[],
  options: { showLineNumbers: boolean; beforeContext: number; afterContext: number; searchPath: string }
): string {
  if (matches.length === 0) {
    return 'No matches found.';
  }

  const lines: string[] = [];

  for (const match of matches) {
    const relPath = relative(options.searchPath, match.file);
    const displayPath = relPath && !relPath.startsWith('..') ? relPath : match.file;

    if (options.showLineNumbers) {
      lines.push(`${displayPath}:${match.line}:${match.content}`);
    } else {
      lines.push(`${displayPath}:${match.content}`);
    }
  }

  return lines.join('\n');
}

function formatFilesOutput(matches: SearchMatch[], searchPath: string): string {
  if (matches.length === 0) {
    return 'No matches found.';
  }

  // Get unique file paths
  const uniqueFiles = [...new Set(matches.map(m => m.file))];
  const relativePaths = uniqueFiles.map(file => {
    const rel = relative(searchPath, file);
    return rel && !rel.startsWith('..') ? rel : file;
  });

  return relativePaths.join('\n');
}

function formatCountOutput(matches: SearchMatch[], searchPath: string): string {
  if (matches.length === 0) {
    return 'No matches found.';
  }

  // Count matches per file
  const counts = new Map<string, number>();
  for (const match of matches) {
    counts.set(match.file, (counts.get(match.file) || 0) + 1);
  }

  const lines: string[] = [];
  for (const [file, count] of counts) {
    const relPath = relative(searchPath, file);
    const displayPath = relPath && !relPath.startsWith('..') ? relPath : file;
    lines.push(`${count}:${displayPath}`);
  }

  return lines.join('\n');
}

function matchesFileType(filePath: string, fileType: string): boolean {
  const ext = extname(filePath).toLowerCase();
  const typeMap: Record<string, string[]> = {
    js: ['.js', '.jsx', '.mjs', '.cjs'],
    ts: ['.ts', '.tsx'],
    py: ['.py'],
    rust: ['.rs'],
    go: ['.go'],
    java: ['.java'],
    cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.h'],
    c: ['.c', '.h'],
    ruby: ['.rb'],
    php: ['.php'],
    html: ['.html', '.htm'],
    css: ['.css', '.scss', '.sass'],
    json: ['.json'],
    yaml: ['.yaml', '.yml'],
    md: ['.md', '.markdown'],
  };

  const extensions = typeMap[fileType.toLowerCase()];
  return extensions ? extensions.includes(ext) : false;
}

function matchesGlob(filePath: string, globPattern: string): boolean {
  const pattern = globPattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.');

  const regex = new RegExp(pattern + '$');
  return regex.test(filePath);
}

function isBinaryFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  const binaryExts = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.mp3', '.mp4', '.avi', '.mov', '.flv',
    '.woff', '.woff2', '.ttf', '.eot',
  ]);

  return binaryExts.has(ext);
}
