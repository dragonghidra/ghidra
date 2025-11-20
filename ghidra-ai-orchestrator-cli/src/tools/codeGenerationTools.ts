import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ToolDefinition } from '../core/toolRuntime.js';

export function createCodeGenerationTools(workingDir: string): ToolDefinition[] {
  return [
    {
      name: 'generate_component',
      description: 'Generate a React/TypeScript component with proper structure and exports',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Component name (PascalCase)',
          },
          type: {
            type: 'string',
            enum: ['functional', 'class'],
            description: 'Component type (default: functional)',
          },
          withProps: {
            type: 'boolean',
            description: 'Include props interface (default: true)',
          },
          withStyles: {
            type: 'boolean',
            description: 'Include CSS module import (default: false)',
          },
          outputPath: {
            type: 'string',
            description: 'Output file path (relative to workspace)',
          },
        },
        required: ['name', 'outputPath'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const componentName = validateComponentName(args['name']);
          const componentType = args['type'] === 'class' ? 'class' : 'functional';
          const withProps = args['withProps'] !== false;
          const withStyles = args['withStyles'] === true;
          const outputPath = resolveFilePath(workingDir, args['outputPath']);

          const componentCode = generateComponentCode({
            name: componentName,
            type: componentType,
            withProps,
            withStyles,
          });

          ensureDirectoryExists(outputPath);
          writeFileSync(outputPath, componentCode, 'utf-8');

          return `✅ Component "${componentName}" generated successfully at ${outputPath}`;
        } catch (error) {
          return `Error generating component: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'generate_utility_function',
      description: 'Generate a TypeScript utility function with proper typing and documentation',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Function name (camelCase)',
          },
          description: {
            type: 'string',
            description: 'Function description for JSDoc',
          },
          parameters: {
            type: 'array',
            description: 'Function parameters with name and type',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string' },
                optional: { type: 'boolean' },
              },
              required: ['name', 'type'],
            },
          },
          returnType: {
            type: 'string',
            description: 'Return type (default: void)',
          },
          outputPath: {
            type: 'string',
            description: 'Output file path',
          },
        },
        required: ['name', 'description', 'outputPath'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const functionName = validateFunctionName(args['name']);
          const description = typeof args['description'] === 'string' ? args['description'].trim() : '';
          const parameters = normalizeFunctionParameters(args['parameters']);
          const returnType = typeof args['returnType'] === 'string' ? args['returnType'] : 'void';
          const outputPath = resolveFilePath(workingDir, args['outputPath']);

          const functionCode = generateUtilityFunctionCode({
            name: functionName,
            description,
            parameters,
            returnType,
          });

          ensureDirectoryExists(outputPath);
          writeFileSync(outputPath, functionCode, 'utf-8');

          return `✅ Utility function "${functionName}" generated successfully at ${outputPath}`;
        } catch (error) {
          return `Error generating utility function: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
    {
      name: 'generate_type_definition',
      description: 'Generate TypeScript type/interface definitions',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Type/interface name (PascalCase)',
          },
          type: {
            type: 'string',
            enum: ['interface', 'type'],
            description: 'Definition type (default: interface)',
          },
          properties: {
            type: 'array',
            description: 'Properties with name and type',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: { type: 'string' },
                optional: { type: 'boolean' },
              },
              required: ['name', 'type'],
            },
          },
          outputPath: {
            type: 'string',
            description: 'Output file path',
          },
        },
        required: ['name', 'outputPath'],
        additionalProperties: false,
      },
      handler: async (args) => {
        try {
          const typeName = validateTypeName(args['name']);
          const definitionType = args['type'] === 'type' ? 'type' : 'interface';
          const properties = normalizeTypeProperties(args['properties']);
          const outputPath = resolveFilePath(workingDir, args['outputPath']);

          const typeCode = generateTypeDefinitionCode({
            name: typeName,
            type: definitionType,
            properties,
          });

          ensureDirectoryExists(outputPath);
          writeFileSync(outputPath, typeCode, 'utf-8');

          return `✅ ${definitionType} "${typeName}" generated successfully at ${outputPath}`;
        } catch (error) {
          return `Error generating type definition: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    },
  ];
}

interface ComponentOptions {
  name: string;
  type: 'functional' | 'class';
  withProps: boolean;
  withStyles: boolean;
}

interface FunctionOptions {
  name: string;
  description: string;
  parameters: Array<{ name: string; type: string; optional?: boolean }>;
  returnType: string;
}

interface TypeOptions {
  name: string;
  type: 'interface' | 'type';
  properties: Array<{ name: string; type: string; optional?: boolean }>;
}

function normalizeFunctionParameters(value: unknown): FunctionOptions['parameters'] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: FunctionOptions['parameters'] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    const type = typeof record['type'] === 'string' ? record['type'].trim() : '';
    if (!name || !type) {
      continue;
    }
    result.push({
      name,
      type,
      optional: record['optional'] === true,
    });
  }
  return result;
}

function normalizeTypeProperties(value: unknown): TypeOptions['properties'] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: TypeOptions['properties'] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
    const type = typeof record['type'] === 'string' ? record['type'].trim() : '';
    if (!name || !type) {
      continue;
    }
    result.push({
      name,
      type,
      optional: record['optional'] === true,
    });
  }
  return result;
}

function resolveFilePath(workingDir: string, path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new Error('Path must be a non-empty string.');
  }
  const value = path.trim();
  return value.startsWith('/') ? value : join(workingDir, value);
}

function validateComponentName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Component name must be a non-empty string.');
  }
  const value = name.trim();
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(value)) {
    throw new Error('Component name must be PascalCase (start with capital letter, no special characters).');
  }
  return value;
}

function validateFunctionName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Function name must be a non-empty string.');
  }
  const value = name.trim();
  if (!/^[a-z][a-zA-Z0-9]*$/.test(value)) {
    throw new Error('Function name must be camelCase (start with lowercase letter, no special characters).');
  }
  return value;
}

function validateTypeName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Type name must be a non-empty string.');
  }
  const value = name.trim();
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(value)) {
    throw new Error('Type name must be PascalCase (start with capital letter, no special characters).');
  }
  return value;
}

function ensureDirectoryExists(filePath: string): void {
  const directory = dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function generateComponentCode(options: ComponentOptions): string {
  const { name, type, withProps, withStyles } = options;
  const lines: string[] = [];

  lines.push("import React from 'react';");
  if (withStyles) {
    lines.push(`import styles from './${name}.module.css';`);
  }
  lines.push('');

  if (withProps) {
    lines.push(`interface ${name}Props {`);
    lines.push('  // Add your props here');
    lines.push('}');
    lines.push('');
  }

  if (type === 'class') {
    lines.push(`class ${name} extends React.Component${withProps ? `<${name}Props>` : ''} {`);
    lines.push('  render() {');
    lines.push('    return (');
    lines.push('      <div>');
    lines.push(`        <h1>${name} Component</h1>`);
    lines.push('      </div>');
    lines.push('    );');
    lines.push('  }');
    lines.push('}');
  } else {
    lines.push(`const ${name}: React.FC${withProps ? `<${name}Props>` : ''} = (${withProps ? 'props' : ''}) => {`);
    lines.push('  return (');
    lines.push('    <div>');
    lines.push(`      <h1>${name} Component</h1>`);
    lines.push('    </div>');
    lines.push('  );');
    lines.push('};');
  }

  lines.push('');
  lines.push(`export default ${name};`);

  return lines.join('\n');
}

function generateUtilityFunctionCode(options: FunctionOptions): string {
  const { name, description, parameters, returnType } = options;
  const lines: string[] = [];

  lines.push('/**');
  lines.push(` * ${description}`);
  if (parameters.length > 0) {
    parameters.forEach(param => {
      lines.push(` * @param ${param.name} - ${param.type}${param.optional ? ' (optional)' : ''}`);
    });
  }
  lines.push(` * @returns ${returnType}`);
  lines.push(' */');

  const paramString = parameters
    .map(param => `${param.name}${param.optional ? '?' : ''}: ${param.type}`)
    .join(', ');

  lines.push(`export function ${name}(${paramString}): ${returnType} {`);
  lines.push('  // Implement your function logic here');
  if (returnType !== 'void') {
    lines.push(`  return ${getDefaultReturnValue(returnType)};`);
  }
  lines.push('}');

  return lines.join('\n');
}

function generateTypeDefinitionCode(options: TypeOptions): string {
  const { name, type, properties } = options;
  const lines: string[] = [];

  if (type === 'interface') {
    lines.push(`export interface ${name} {`);
  } else {
    lines.push(`export type ${name} = {`);
  }

  if (properties.length === 0) {
    lines.push('  // Add properties here');
  } else {
    properties.forEach(prop => {
      lines.push(`  ${prop.name}${prop.optional ? '?' : ''}: ${prop.type};`);
    });
  }

  lines.push('};');

  return lines.join('\n');
}

function getDefaultReturnValue(returnType: string): string {
  switch (returnType) {
    case 'string':
      return "''";
    case 'number':
      return '0';
    case 'boolean':
      return 'false';
    case 'any[]':
    case 'Array<any>':
      return '[]';
    case 'object':
    case 'Record<string, any>':
      return '{}';
    case 'null':
      return 'null';
    case 'undefined':
      return 'undefined';
    default:
      return 'null';
  }
}
