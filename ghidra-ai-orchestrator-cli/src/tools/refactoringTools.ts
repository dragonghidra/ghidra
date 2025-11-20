import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';
import { performAdvancedAstAnalysis, type AstSymbolInsight } from './codeAnalysisTools.js';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const IGNORED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo']);

export function createRefactoringTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'detect_refactoring_hotspots',
      description: 'Scan a file or directory for large/complex functions that merit refactoring.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File or directory to inspect (relative to workspace).',
          },
          maxResults: {
            type: 'number',
            description: 'Limit the number of hotspots returned (default: 10).',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const targetPath = resolveFilePath(workingDir, args['path']);
          if (!existsSync(targetPath)) {
            return `Error: Path not found: ${targetPath}`;
          }

          const files = collectSourceFiles(targetPath);
          if (files.length === 0) {
            return `No source files (.ts/.tsx/.js/.jsx) discovered under ${targetPath}.`;
          }

          const hotspots: HotspotRecord[] = [];
          for (const file of files) {
            const content = readFileSync(file, 'utf-8');
            const ast = performAdvancedAstAnalysis(content, file);

            for (const symbol of ast.symbols) {
              if (symbol.kind === 'class') {
                continue;
              }

              const reasons: string[] = [];
              if (symbol.statementCount > 40) {
                reasons.push(`long body (${symbol.statementCount} statements)`);
              }
              if (symbol.cyclomaticComplexity > 12) {
                reasons.push(`complex (CC ${symbol.cyclomaticComplexity})`);
              }
              const span = symbol.endLine - symbol.startLine + 1;
              if (span > 120) {
                reasons.push(`spans ${span} lines`);
              }

              if (reasons.length > 0) {
                hotspots.push({
                  file,
                  symbol,
                  reasons,
                  score: symbol.cyclomaticComplexity * 2 + symbol.statementCount,
                });
              }
            }
          }

          if (hotspots.length === 0) {
            return 'No refactoring hotspots detected.';
          }

          const maxResultsArg = args['maxResults'];
          const limit =
            typeof maxResultsArg === 'number' && Number.isFinite(maxResultsArg) && maxResultsArg > 0
              ? Math.floor(maxResultsArg)
              : 10;
          hotspots.sort((a, b) => b.score - a.score);
          const selection = hotspots.slice(0, limit);

          const output: string[] = [];
          output.push(`# Refactoring hotspots (${selection.length}/${hotspots.length})`);
          output.push('');
          selection.forEach((record, index) => {
            const relPath = relative(workingDir, record.file);
            const span = record.symbol.endLine - record.symbol.startLine + 1;
            output.push(
              `${index + 1}. ${record.symbol.name} in ${relPath} (lines ${record.symbol.startLine}-${record.symbol.endLine})`,
            );
            output.push(`   - Severity score: ${record.score}`);
            output.push(`   - Reasons: ${record.reasons.join(', ')}`);
            output.push(`   - Statements: ${record.symbol.statementCount}, CC: ${record.symbol.cyclomaticComplexity}, span ${span} lines`);
          });

          return output.join('\n');
        } catch (error) {
          return `Error detecting hotspots: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'generate_refactor_plan',
      description: 'Create a structured refactor plan for the most complex symbol in a file (or a specific symbol).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File to analyze.',
          },
          symbol: {
            type: 'string',
            description: 'Optional symbol to target (defaults to the most complex function).',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const filePath = resolveFilePath(workingDir, args['path']);
          if (!existsSync(filePath)) {
            return `Error: File not found: ${filePath}`;
          }

          const content = readFileSync(filePath, 'utf-8');
          const ast = performAdvancedAstAnalysis(content, filePath);
          if (ast.symbols.length === 0) {
            return `No analyzable symbols found in ${filePath}.`;
          }

          const targetSymbol = selectTargetSymbol(ast.symbols, args['symbol']);
          if (!targetSymbol) {
            return `Symbol "${String(args['symbol'])}" not found in ${filePath}.`;
          }

          const callOutputs = ast.callGraph.filter((edge) => edge.from === targetSymbol.name || edge.to === targetSymbol.name);

          const relPath = relative(workingDir, filePath);
          const plan: string[] = [];
          plan.push(`# Refactor plan for ${targetSymbol.name}`);
          plan.push(`File: ${relPath}`);
          plan.push('');
          plan.push('## Current metrics');
          plan.push(`- Statements: ${targetSymbol.statementCount}`);
          plan.push(`- Cyclomatic complexity: ${targetSymbol.cyclomaticComplexity}`);
          plan.push(`- Span: lines ${targetSymbol.startLine}-${targetSymbol.endLine}`);
          plan.push('');
          plan.push('## Recommended steps');
          plan.push('- Break the function into cohesive helpers grouped by responsibility.');
          if (targetSymbol.statementCount > 60) {
            plan.push('- Extract the initialization / setup logic into a dedicated helper.');
          }
          if (targetSymbol.cyclomaticComplexity > 14) {
            plan.push('- Replace deeply nested branching with guard clauses or strategy objects.');
          }
          plan.push('- Introduce descriptive interfaces/types to clarify inputs and return values.');
          plan.push('- Write focused unit tests for each new helper and for the refactored entry point.');
          plan.push('');
          plan.push('## Dependency considerations');
          if (callOutputs.length === 0) {
            plan.push('This symbol does not interact with other tracked functions inside the file.');
          } else {
            plan.push('Calls & referenced symbols:');
            callOutputs.forEach((edge) => {
              if (edge.from === targetSymbol.name) {
                plan.push(`- Calls ${edge.to} (${edge.count} time${edge.count === 1 ? '' : 's'})`);
              } else {
                plan.push(`- Invoked by ${edge.from} (${edge.count} call${edge.count === 1 ? '' : 's'})`);
              }
            });
          }

          return plan.join('\n');
        } catch (error) {
          return `Error generating refactor plan: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'analyze_refactor_impact',
      description: 'Summarize inbound/outbound calls for a symbol to estimate refactor blast radius.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File containing the symbol.',
          },
          symbol: {
            type: 'string',
            description: 'Symbol name to inspect. Defaults to the most connected symbol.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const filePath = resolveFilePath(workingDir, args['path']);
          if (!existsSync(filePath)) {
            return `Error: File not found: ${filePath}`;
          }

          const content = readFileSync(filePath, 'utf-8');
          const ast = performAdvancedAstAnalysis(content, filePath);
          if (ast.symbols.length === 0) {
            return `No analyzable symbols found in ${filePath}.`;
          }

          const fallbackSymbol = ast.symbols[0]?.name ?? '';
          const symbolArg = args['symbol'];
          const symbolName =
            typeof symbolArg === 'string' && symbolArg.trim()
              ? symbolArg.trim()
              : findMostConnectedSymbol(ast) ?? fallbackSymbol;

          const incoming = ast.callGraph.filter((edge) => edge.to === symbolName);
          const outgoing = ast.callGraph.filter((edge) => edge.from === symbolName);

          const summary: string[] = [];
          summary.push(`# Refactor impact for ${symbolName}`);
          summary.push('');
          summary.push('## Incoming references');
          if (incoming.length === 0) {
            summary.push('No recorded inbound calls inside this file.');
          } else {
            incoming.forEach((edge) => {
              summary.push(`- ${edge.from} (${edge.count} call${edge.count === 1 ? '' : 's'})`);
            });
          }
          summary.push('');
          summary.push('## Outgoing calls');
          if (outgoing.length === 0) {
            summary.push('No outbound calls recorded.');
          } else {
            outgoing.forEach((edge) => {
              summary.push(`- ${edge.to} (${edge.count} call${edge.count === 1 ? '' : 's'})`);
            });
          }

          return summary.join('\n');
        } catch (error) {
          return `Error analyzing refactor impact: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];
}

interface HotspotRecord {
  file: string;
  symbol: AstSymbolInsight;
  reasons: string[];
  score: number;
}

function resolveFilePath(workingDir: string, path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Path must be a non-empty string.');
  }
  const value = path.trim();
  return value.startsWith('/') ? value : join(workingDir, value);
}

function collectSourceFiles(targetPath: string): string[] {
  const stats = statSync(targetPath);
  if (stats.isDirectory()) {
    const directoryName = basename(targetPath);
    if (IGNORED_DIRECTORIES.has(directoryName)) {
      return [];
    }

    const entries = readdirSync(targetPath);
    const files: string[] = [];
    for (const entry of entries) {
      files.push(...collectSourceFiles(join(targetPath, entry)));
    }
    return files;
  }

  if (!stats.isFile()) {
    return [];
  }

  if (SOURCE_EXTENSIONS.some((ext) => targetPath.endsWith(ext))) {
    return [targetPath];
  }

  return [];
}

function selectTargetSymbol(symbols: AstSymbolInsight[], requestedSymbol: unknown): AstSymbolInsight | null {
  if (typeof requestedSymbol === 'string' && requestedSymbol.trim()) {
    const match = symbols.find((symbol) => symbol.name === requestedSymbol.trim());
    if (match) {
      return match;
    }
    return null;
  }

  const sorted = [...symbols]
    .filter((symbol) => symbol.kind !== 'class')
    .sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity);
  return sorted[0] ?? null;
}

function findMostConnectedSymbol(ast: ReturnType<typeof performAdvancedAstAnalysis>): string | null {
  const connectionWeights = new Map<string, number>();
  for (const edge of ast.callGraph) {
    connectionWeights.set(edge.from, (connectionWeights.get(edge.from) ?? 0) + edge.count);
    connectionWeights.set(edge.to, (connectionWeights.get(edge.to) ?? 0) + edge.count);
  }

  let bestSymbol: string | null = null;
  let bestScore = -1;
  for (const [symbol, weight] of connectionWeights.entries()) {
    if (weight > bestScore) {
      bestSymbol = symbol;
      bestScore = weight;
    }
  }
  return bestSymbol;
}
