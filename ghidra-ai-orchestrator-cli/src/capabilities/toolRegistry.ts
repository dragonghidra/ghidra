import type { ToolAvailabilityOption } from '../contracts/v1/toolAccess.js';
import type { ToolSettings } from '../core/preferences.js';
import { getSecretValue, listSecretDefinitions, type SecretName } from '../core/secretStore.js';
import { getToolManifest } from './toolManifest.js';

export type ToolToggleId = string;

export type ToolToggleOption = ToolAvailabilityOption & {
  requiresSecret?: SecretName;
};

export interface ToolPermissionSummary {
  allowedPluginIds: Set<string>;
  warnings: ToolLoadWarning[];
}

export interface ToolLoadWarning {
  id: ToolToggleId;
  label: string;
  reason: 'missing-secret';
  secretId?: SecretName;
}

const SECRET_LOOKUP = buildSecretLookup();

const TOOL_OPTIONS: ToolToggleOption[] = buildToolToggleOptions();

const PLUGIN_TO_OPTION = buildPluginLookup();

export function getToolToggleOptions(): ToolToggleOption[] {
  return [...TOOL_OPTIONS];
}

export function buildEnabledToolSet(saved: ToolSettings | null): Set<ToolToggleId> {
  const enabled = new Set<ToolToggleId>();
  if (!saved) {
    for (const option of TOOL_OPTIONS) {
      if (option.defaultEnabled) {
        enabled.add(option.id);
      }
    }
    return enabled;
  }

  const knownIds = new Set(TOOL_OPTIONS.map((option) => option.id));
  for (const id of saved.enabledTools ?? []) {
    if (knownIds.has(id)) {
      enabled.add(id);
    }
  }

  return enabled;
}

export function evaluateToolPermissions(selection: Set<ToolToggleId>): ToolPermissionSummary {
  const allowedPluginIds = new Set<string>();
  const warnings: ToolLoadWarning[] = [];

  for (const option of TOOL_OPTIONS) {
    if (!selection.has(option.id)) {
      continue;
    }

    if (option.requiresSecret) {
      const secret = getSecretValue(option.requiresSecret);
      if (!secret) {
        warnings.push({
          id: option.id,
          label: option.label,
          reason: 'missing-secret',
          secretId: option.requiresSecret,
        });
        continue;
      }
    }

    for (const pluginId of option.pluginIds) {
      allowedPluginIds.add(pluginId);
    }
  }

  return {
    allowedPluginIds,
    warnings,
  };
}

export function isPluginEnabled(pluginId: string, allowedPluginIds: Set<string>): boolean {
  const associated = PLUGIN_TO_OPTION.get(pluginId);
  if (!associated) {
    return true;
  }
  return allowedPluginIds.has(pluginId);
}

function buildPluginLookup(): Map<string, ToolToggleOption> {
  const map = new Map<string, ToolToggleOption>();
  for (const option of TOOL_OPTIONS) {
    for (const pluginId of option.pluginIds) {
      map.set(pluginId, option);
    }
  }
  return map;
}

function buildToolToggleOptions(): ToolToggleOption[] {
  const manifest = getToolManifest();
  return manifest.options.map((option) => normalizeToggleOption(option));
}

function normalizeToggleOption(option: ToolAvailabilityOption): ToolToggleOption {
  const pluginIds = option.pluginIds ?? [];
  if (!pluginIds.length) {
    throw new Error(`Tool option "${option.id}" is missing plugin bindings.`);
  }

  const normalized: ToolToggleOption = {
    id: option.id,
    label: option.label,
    description: option.description,
    defaultEnabled: option.defaultEnabled,
    pluginIds: [...pluginIds],
  };

  if (option.category) {
    normalized.category = option.category;
  }
  if (option.scopes?.length) {
    normalized.scopes = [...option.scopes];
  }
  const secret = normalizeSecret(option.requiresSecret);
  if (secret) {
    normalized.requiresSecret = secret;
  }
  if (option.metadata) {
    normalized.metadata = { ...option.metadata };
  }

  return normalized;
}

function buildSecretLookup(): Set<SecretName> {
  const ids = listSecretDefinitions().map((secret) => secret.id);
  return new Set(ids);
}

function normalizeSecret(value: string | undefined): SecretName | undefined {
  if (!value) {
    return undefined;
  }
  if (!SECRET_LOOKUP.has(value as SecretName)) {
    throw new Error(`Tool manifest references unknown secret "${value}".`);
  }
  return value as SecretName;
}
