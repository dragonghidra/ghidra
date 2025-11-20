import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { ToolDefinition } from '../core/toolRuntime.js';

export interface CodeAnalysisResult {
  file: string;
  functions: FunctionInfo[];
  classes: ClassInfo[];
  interfaces: InterfaceInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
}

export interface FunctionInfo {
  name: string;
  line: number;
  parameters: string[];
  returnType?: string;
}

export interface ClassInfo {
  name: string;
  line: number;
  methods: MethodInfo[];
  properties: PropertyInfo[];
}

export interface MethodInfo {
  name: string;
  line: number;
  parameters: string[];
  returnType?: string;
}

export interface PropertyInfo {
  name: string;
  line: number;
  type?: string;
}

export interface InterfaceInfo {
  name: string;
  line: number;
  properties: PropertyInfo[];
  methods: MethodInfo[];
}

export interface ImportInfo {
  source: string;
  specifiers: string[];
  line: number;
}

export interface ExportInfo {
  name: string;
  type: 'default' | 'named' | 'namespace';
  line: number;
}

export type AstSymbolKind = 'function' | 'method' | 'arrow-function' | 'class';

export interface AstSymbolInsight {
  name: string;
  kind: AstSymbolKind;
  startLine: number;
  endLine: number;
  parameters: string[];
  statementCount: number;
  cyclomaticComplexity: number;
}

export interface AstCallEdge {
  from: string;
  to: string;
  count: number;
}

export interface AdvancedAstAnalysisResult {
  file: string;
  symbols: AstSymbolInsight[];
  callGraph: AstCallEdge[];
  totalCyclomaticComplexity: number;
  issues: string[];
}

export function createCodeAnalysisTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'analyze_code_structure',
      description: 'Analyze TypeScript/JavaScript file structure and extract functions, classes, interfaces, imports, and exports',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the TypeScript/JavaScript file to analyze',
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
          const analysis = analyzeTypeScriptFile(content, filePath);
          return formatAnalysisResults(analysis);
        } catch (error) {
          return formatHandlerError('analyzing file', error);
        }
      },
    },
    {
      name: 'find_dependencies',
      description: 'Find all dependencies and imports in a TypeScript/JavaScript file',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the TypeScript/JavaScript file',
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
          const analysis = analyzeTypeScriptFile(content, filePath);
          return formatDependencies(analysis);
        } catch (error) {
          return formatHandlerError('analyzing dependencies', error);
        }
      },
    },
    {
      name: 'check_code_complexity',
      description: 'Analyze code complexity metrics (function length, parameter count, etc.)',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the TypeScript/JavaScript file',
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
          const analysis = analyzeTypeScriptFile(content, filePath);
          return formatComplexityMetrics(analysis);
        } catch (error) {
          return formatHandlerError('analyzing complexity', error);
        }
      },
    },
    {
      name: 'advanced_ast_analysis',
      description:
        'Perform AST-based analysis with cyclomatic complexity scoring, call graph construction, and potential hotspot detection.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the TypeScript/JavaScript file to inspect',
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
          const analysis = performAdvancedAstAnalysis(content, filePath);
          return formatAstAnalysis(analysis);
        } catch (error) {
          return formatHandlerError('performing AST analysis', error);
        }
      },
    },
  ];
}

function resolveFilePath(workingDir: string, path: unknown): string {
  const normalized = validatePathArg(path);
  return normalized.startsWith('/') ? normalized : join(workingDir, normalized);
}

function validatePathArg(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Path must be a non-empty string.');
  }
  return path.trim();
}

export function analyzeTypeScriptFile(content: string, filePath: string): CodeAnalysisResult {
  const lines = content.split('\n');
  const result: CodeAnalysisResult = {
    file: filePath,
    functions: [],
    classes: [],
    interfaces: [],
    imports: [],
    exports: [],
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    // Parse imports
    if (trimmed.startsWith('import')) {
      const importInfo = parseImportStatement(trimmed, lineNumber);
      if (importInfo) {
        result.imports.push(importInfo);
      }
    }

    // Parse exports
    if (trimmed.startsWith('export')) {
      const exportInfo = parseExportStatement(trimmed, lineNumber);
      if (exportInfo) {
        result.exports.push(exportInfo);
      }
    }

    // Parse functions
    const functionMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (functionMatch) {
      const fnName = functionMatch[1] ?? '';
      const fnParams = functionMatch[2] ?? '';
      result.functions.push({
        name: fnName,
        line: lineNumber,
        parameters: parseParameters(fnParams),
      });
    }

    // Parse arrow functions
    const arrowFunctionMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:\(([^)]*)\)|(\w+))\s*=>/);
    if (arrowFunctionMatch) {
      const name = arrowFunctionMatch[1] ?? '';
      const params = arrowFunctionMatch[2] || arrowFunctionMatch[3] || '';
      result.functions.push({
        name,
        line: lineNumber,
        parameters: parseParameters(params),
      });
    }

    // Parse classes
    const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
    if (classMatch) {
      const className = classMatch[1] ?? '';
      result.classes.push({
        name: className,
        line: lineNumber,
        methods: [],
        properties: [],
      });
    }

    // Parse interfaces
    const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
    if (interfaceMatch) {
      const interfaceName = interfaceMatch[1] ?? '';
      result.interfaces.push({
        name: interfaceName,
        line: lineNumber,
        properties: [],
        methods: [],
      });
    }

    // Parse class methods and properties (simplified)
    if (trimmed.match(/^(?:public|private|protected|readonly)?\s*\w+\s*\([^)]*\)/)) {
      const methodMatch = trimmed.match(/^(?:public|private|protected)?\s*(\w+)\s*\(([^)]*)\)/);
      if (methodMatch && result.classes.length > 0) {
        const currentClass = result.classes[result.classes.length - 1];
        if (currentClass) {
          currentClass.methods.push({
            name: methodMatch[1] ?? '',
            line: lineNumber,
            parameters: parseParameters(methodMatch[2] ?? ''),
          });
        }
      }
    }

    // Parse interface properties
    if (trimmed.match(/^\w+\s*:/) && result.interfaces.length > 0) {
      const propMatch = trimmed.match(/^(\w+)\s*:/);
      if (propMatch) {
        const currentInterface = result.interfaces[result.interfaces.length - 1];
        if (currentInterface) {
          currentInterface.properties.push({
            name: propMatch[1] ?? '',
            line: lineNumber,
          });
        }
      }
    }
  });

  return result;
}

export function performAdvancedAstAnalysis(content: string, filePath: string): AdvancedAstAnalysisResult {
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const symbols: AstSymbolInsight[] = [];
  const callGraph = new Map<string, Map<string, number>>();
  const issues: string[] = [];
  const symbolStack: string[] = [];

  const recordCall = (callee: string | null) => {
    if (!callee) {
      return;
    }
    const caller = symbolStack[symbolStack.length - 1];
    if (!caller) {
      return;
    }
    if (!callGraph.has(caller)) {
      callGraph.set(caller, new Map());
    }
      const targets = callGraph.get(caller)!;
    targets.set(callee, (targets.get(callee) ?? 0) + 1);
  };

  const registerSymbol = (info: AstSymbolInsight) => {
    symbols.push(info);
    if (info.statementCount > 50) {
      issues.push(`Large function detected: ${info.name} spans ${info.statementCount} statements.`);
    }
    if (info.cyclomaticComplexity > 10) {
      issues.push(`High complexity function: ${info.name} cyclomatic complexity is ${info.cyclomaticComplexity}.`);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const info = buildFunctionSymbol(node, node.name.text, 'function', sourceFile);
      registerSymbol(info);
      symbolStack.push(info.name);
      ts.forEachChild(node, visit);
      symbolStack.pop();
      return;
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const info = buildClassSymbol(node, sourceFile);
      registerSymbol(info);
      ts.forEachChild(node, visit);
      return;
    }

    if (
      (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
      ts.isClassLike(node.parent)
    ) {
      const className = (node.parent.name && node.parent.name.getText(sourceFile)) || 'anonymous-class';
      const methodName = ts.isIdentifier(node.name) ? node.name.getText(sourceFile) : 'anonymous-method';
      const info = buildFunctionSymbol(node, `${className}.${methodName}`, 'method', sourceFile);
      registerSymbol(info);
      symbolStack.push(info.name);
      ts.forEachChild(node, visit);
      symbolStack.pop();
      return;
    }

    if (ts.isConstructorDeclaration(node) && ts.isClassLike(node.parent)) {
      const className = (node.parent.name && node.parent.name.getText(sourceFile)) || 'anonymous-class';
      const info = buildFunctionSymbol(node, `${className}.constructor`, 'method', sourceFile);
      registerSymbol(info);
      symbolStack.push(info.name);
      ts.forEachChild(node, visit);
      symbolStack.pop();
      return;
    }

    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      ts.isIdentifier(node.name)
    ) {
      const kind: AstSymbolKind = ts.isArrowFunction(node.initializer) ? 'arrow-function' : 'function';
      const info = buildFunctionSymbol(node.initializer, node.name.text, kind, sourceFile);
      registerSymbol(info);
      symbolStack.push(info.name);
      ts.forEachChild(node.initializer, visit);
      symbolStack.pop();
      return;
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = extractCalleeName(node.expression);
      recordCall(callee);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  const callGraphList: AstCallEdge[] = [];
  for (const [from, targets] of callGraph.entries()) {
    for (const [to, count] of targets.entries()) {
      callGraphList.push({ from, to, count });
    }
  }

  const totalCyclomaticComplexity = symbols.reduce((sum, symbol) => sum + symbol.cyclomaticComplexity, 0);

  return {
    file: filePath,
    symbols,
    callGraph: callGraphList,
    totalCyclomaticComplexity,
    issues,
  };
}

function buildFunctionSymbol(
  node: ts.FunctionLikeDeclaration | ts.FunctionExpression | ts.ArrowFunction,
  name: string,
  kind: AstSymbolKind,
  sourceFile: ts.SourceFile,
): AstSymbolInsight {
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
  const statementCount = countStatements(node);
  const cyclomaticComplexity = estimateCyclomaticComplexity(node);
  const parameters = node.parameters?.map((param) => param.name.getText(sourceFile)) ?? [];

  return {
    name,
    kind,
    startLine,
    endLine,
    parameters,
    statementCount,
    cyclomaticComplexity,
  };
}

function buildClassSymbol(node: ts.ClassLikeDeclaration, sourceFile: ts.SourceFile): AstSymbolInsight {
  const name = (node.name && node.name.getText(sourceFile)) || 'AnonymousClass';
  const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
  const statementCount = node.members.length;
  const cyclomaticComplexity = node.members.reduce((sum, member) => {
    if (
      ts.isMethodDeclaration(member) ||
      ts.isConstructorDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      return sum + estimateCyclomaticComplexity(member);
    }
    return sum;
  }, 1);

  return {
    name,
    kind: 'class',
    startLine,
    endLine,
    parameters: [],
    statementCount,
    cyclomaticComplexity,
  };
}

function countStatements(node: ts.FunctionLikeDeclaration | ts.FunctionExpression | ts.ArrowFunction): number {
  const body = node.body;
  if (!body) {
    return 0;
  }
  if (ts.isBlock(body)) {
    return body.statements.length;
  }
  return 1;
}

function estimateCyclomaticComplexity(node: ts.Node): number {
  let complexity = 1;

  const visit = (child: ts.Node) => {
    if (
      ts.isIfStatement(child) ||
      ts.isForStatement(child) ||
      ts.isWhileStatement(child) ||
      ts.isForOfStatement(child) ||
      ts.isForInStatement(child) ||
      ts.isCaseClause(child) ||
      ts.isCatchClause(child)
    ) {
      complexity += 1;
    } else if (ts.isConditionalExpression(child)) {
      complexity += 1;
    } else if (
      ts.isBinaryExpression(child) &&
      (child.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        child.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      complexity += 1;
    }
    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  return complexity;
}

function extractCalleeName(expression: ts.LeftHandSideExpression | undefined): string | null {
  if (!expression) {
    return null;
  }
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return null;
}

function formatAstAnalysis(result: AdvancedAstAnalysisResult): string {
  const output: string[] = [];
  output.push(`# Advanced AST Analysis: ${result.file}`);
  output.push('');

  output.push('## Symbol Metrics');
  if (result.symbols.length === 0) {
    output.push('No functions or classes detected.');
  } else {
    const sorted = [...result.symbols].sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity);
    for (const symbol of sorted) {
      output.push(
        `- ${symbol.name} (${symbol.kind}) lines ${symbol.startLine}-${symbol.endLine} | statements: ${symbol.statementCount} | CC: ${symbol.cyclomaticComplexity} | params: ${symbol.parameters.join(
          ', ',
        ) || 'none'}`,
      );
    }
  }
  output.push('');

  output.push('## Call Graph');
  if (result.callGraph.length === 0) {
    output.push('No function-to-function calls detected.');
  } else {
    for (const edge of result.callGraph) {
      output.push(`- ${edge.from} → ${edge.to} (x${edge.count})`);
    }
  }
  output.push('');

  output.push('## Hotspot Alerts');
  if (result.issues.length === 0) {
    output.push('No hotspots detected.');
  } else {
    for (const issue of result.issues) {
      output.push(`- ${issue}`);
    }
  }
  output.push('');

  const averageComplexity =
    result.symbols.length === 0 ? 0 : result.totalCyclomaticComplexity / result.symbols.length;
  output.push('## Aggregate Metrics');
  output.push(`- Total symbols analyzed: ${result.symbols.length}`);
  output.push(`- Total cyclomatic complexity: ${result.totalCyclomaticComplexity}`);
  output.push(`- Average cyclomatic complexity: ${averageComplexity.toFixed(2)}`);

  return output.join('\n');
}

function formatHandlerError(task: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Error ${task}: ${message}`;
}

function parseImportStatement(line: string, lineNumber: number): ImportInfo | null {
  // Simple import parsing - can be enhanced with proper AST parsing
  const importMatch = line.match(/import\s+(?:\*\s+as\s+(\w+)|\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/);
  if (importMatch) {
    let specifiers: string[] = [];
    if (importMatch[1]) {
      // namespace import
      specifiers = [`* as ${importMatch[1]}`];
    } else if (importMatch[2]) {
      // named imports
      specifiers = importMatch[2].split(',').map(s => s.trim()).filter(Boolean);
    } else if (importMatch[3]) {
      // default import
      specifiers = [importMatch[3]];
    }

    return {
      source: importMatch[4] ?? '',
      specifiers,
      line: lineNumber,
    };
  }
  return null;
}

function parseExportStatement(line: string, lineNumber: number): ExportInfo | null {
  if (line.includes('export default')) {
    const defaultMatch = line.match(/export\s+default\s+(\w+)/);
    if (defaultMatch) {
        return {
          name: defaultMatch[1] ?? '',
          type: 'default',
          line: lineNumber,
        };
    }
  } else if (line.includes('export {')) {
    const namedMatch = line.match(/export\s+\{\s*([^}]+)\s*\}/);
    if (namedMatch) {
        return {
          name: namedMatch[1] ?? '',
          type: 'named',
          line: lineNumber,
        };
    }
  } else {
    const exportMatch = line.match(/export\s+(?:class|function|interface|const|let|var)\s+(\w+)/);
    if (exportMatch) {
        return {
          name: exportMatch[1] ?? '',
          type: 'named',
          line: lineNumber,
        };
    }
  }
  return null;
}

function parseParameters(paramString: string): string[] {
  return paramString
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      // Extract parameter name (ignore types for now)
      const nameMatch = p.match(/^(\w+)(?:\s*:\s*[^,]+)?$/);
      return nameMatch?.[1] ?? p;
    });
}

function formatAnalysisResults(analysis: CodeAnalysisResult): string {
  const output: string[] = [];
  output.push(`# Code Analysis: ${analysis.file}`);
  output.push('');

  if (analysis.imports.length > 0) {
    output.push('## Imports');
    analysis.imports.forEach(imp => {
      output.push(`- Line ${imp.line}: from "${imp.source}"`);
      if (imp.specifiers.length > 0) {
        output.push(`  ${imp.specifiers.join(', ')}`);
      }
    });
    output.push('');
  }

  if (analysis.exports.length > 0) {
    output.push('## Exports');
    analysis.exports.forEach(exp => {
      output.push(`- Line ${exp.line}: ${exp.type} ${exp.name}`);
    });
    output.push('');
  }

  if (analysis.functions.length > 0) {
    output.push('## Functions');
    analysis.functions.forEach(func => {
      output.push(`- Line ${func.line}: ${func.name}(${func.parameters.join(', ')})`);
    });
    output.push('');
  }

  if (analysis.classes.length > 0) {
    output.push('## Classes');
    analysis.classes.forEach(cls => {
      output.push(`- Line ${cls.line}: ${cls.name}`);
      if (cls.methods.length > 0) {
        output.push(`  Methods: ${cls.methods.map(m => m.name).join(', ')}`);
      }
      if (cls.properties.length > 0) {
        output.push(`  Properties: ${cls.properties.map(p => p.name).join(', ')}`);
      }
    });
    output.push('');
  }

  if (analysis.interfaces.length > 0) {
    output.push('## Interfaces');
    analysis.interfaces.forEach(intf => {
      output.push(`- Line ${intf.line}: ${intf.name}`);
      if (intf.properties.length > 0) {
        output.push(`  Properties: ${intf.properties.map(p => p.name).join(', ')}`);
      }
      if (intf.methods.length > 0) {
        output.push(`  Methods: ${intf.methods.map(m => m.name).join(', ')}`);
      }
    });
    output.push('');
  }

  return output.join('\n');
}

function formatDependencies(analysis: CodeAnalysisResult): string {
  const output: string[] = [];
  output.push(`# Dependencies: ${analysis.file}`);
  output.push('');

  if (analysis.imports.length > 0) {
    output.push('## Imported Modules');
    analysis.imports.forEach(imp => {
      output.push(`- ${imp.source}`);
      if (imp.specifiers.length > 0) {
        output.push(`  Used: ${imp.specifiers.join(', ')}`);
      }
    });
  } else {
    output.push('No imports found.');
  }

  return output.join('\n');
}

function formatComplexityMetrics(analysis: CodeAnalysisResult): string {
  const output: string[] = [];
  output.push(`# Code Complexity: ${analysis.file}`);
  output.push('');

  // Function complexity
  if (analysis.functions.length > 0) {
    output.push('## Function Complexity');
    analysis.functions.forEach(func => {
      const paramCount = func.parameters.length;
      const complexity = paramCount > 3 ? 'High' : paramCount > 1 ? 'Medium' : 'Low';
      output.push(`- ${func.name}: ${paramCount} parameters (${complexity})`);
    });
  }

  // Class complexity
  if (analysis.classes.length > 0) {
    output.push('## Class Complexity');
    analysis.classes.forEach(cls => {
      const methodCount = cls.methods.length;
      const propCount = cls.properties.length;
      const complexity = methodCount + propCount > 5 ? 'High' : methodCount + propCount > 2 ? 'Medium' : 'Low';
      output.push(`- ${cls.name}: ${methodCount} methods, ${propCount} properties (${complexity})`);
    });
  }

  // Overall metrics
  output.push('');
  output.push('## Overall Metrics');
  output.push(`- Total functions: ${analysis.functions.length}`);
  output.push(`- Total classes: ${analysis.classes.length}`);
  output.push(`- Total interfaces: ${analysis.interfaces.length}`);
  output.push(`- Total imports: ${analysis.imports.length}`);
  output.push(`- Total exports: ${analysis.exports.length}`);

  return output.join('\n');
}
