import type { JSONSchemaArray, JSONSchemaObject, JSONSchemaProperty } from './types.js';

export class ToolArgumentValidationError extends Error {
  constructor(toolName: string, issues: string[]) {
    super(formatMessage(toolName, issues));
    this.name = 'ToolArgumentValidationError';
  }
}

export function validateToolArguments(
  toolName: string,
  schema: JSONSchemaObject | undefined,
  args: Record<string, unknown>
): void {
  if (!schema || schema.type !== 'object') {
    return;
  }

  const errors: string[] = [];
  const properties = schema.properties ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];

  for (const property of required) {
    if (!hasArgument(args, property)) {
      errors.push(`Missing required property "${property}".`);
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const definition = properties[key];
    if (!definition) {
      if (schema.additionalProperties === false) {
        errors.push(`Property "${key}" is not allowed.`);
      }
      continue;
    }
    validateSchemaProperty(definition, value, key, errors);
  }

  if (errors.length) {
    throw new ToolArgumentValidationError(toolName, errors);
  }
}

function validateSchemaProperty(
  definition: JSONSchemaProperty,
  value: unknown,
  path: string,
  errors: string[]
): void {
  switch (definition.type) {
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`Argument "${path}" must be a string.`);
        return;
      }
      if (definition.enum && !definition.enum.includes(value)) {
        errors.push(
          `Argument "${path}" must be one of: ${definition.enum.map((entry) => `"${entry}"`).join(', ')}.`
        );
      }
      if (typeof definition.minLength === 'number' && value.length < definition.minLength) {
        errors.push(
          `Argument "${path}" must be at least ${definition.minLength} character${
            definition.minLength === 1 ? '' : 's'
          } long.`
        );
      }
      return;
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`Argument "${path}" must be a number.`);
      }
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        errors.push(`Argument "${path}" must be a boolean.`);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`Argument "${path}" must be an array.`);
        return;
      }
      validateArrayItems(definition, value, path, errors);
      return;
    }
    default:
      return;
  }
}

function validateArrayItems(
  definition: JSONSchemaArray,
  value: unknown[],
  path: string,
  errors: string[]
): void {
  const itemSchema = definition.items;
  if (!itemSchema) {
    return;
  }

  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    validateSchemaProperty(itemSchema, entry, `${path}[${index}]`, errors);
  }
}

function hasArgument(args: Record<string, unknown>, key: string): boolean {
  if (!Object.hasOwn(args, key)) {
    return false;
  }
  const value = args[key];
  return value !== undefined && value !== null;
}

function formatMessage(toolName: string, issues: string[]): string {
  const detail = issues.join(' ');
  return `Invalid arguments for "${toolName}": ${detail}`;
}
