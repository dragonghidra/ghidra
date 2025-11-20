/**
 * Tests for centralized agent schema loader
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  getAgentSchemas,
  getProviders,
  getProvider,
  getModels,
  getModelsByProvider,
  getModel,
  getProfiles,
  getProfile,
  getSlashCommands,
  getCapabilities,
  isValidProvider,
  isValidModel,
  isValidProfile,
  clearSchemaCache,
} from '../src/core/agentSchemaLoader.js';

test('agentSchemaLoader - loads schema successfully', () => {
  const schemas = getAgentSchemas();
  assert.ok(schemas, 'Schema should be loaded');
  assert.ok(schemas.contractVersion, 'Contract version should exist');
  assert.ok(schemas.version, 'Version should exist');
  assert.ok(Array.isArray(schemas.providers), 'Providers should be an array');
  assert.ok(Array.isArray(schemas.models), 'Models should be an array');
  assert.ok(Array.isArray(schemas.profiles), 'Profiles should be an array');
});

test('agentSchemaLoader - validates required fields', () => {
  const schemas = getAgentSchemas();
  assert.ok(schemas.providers.length > 0, 'Should have at least one provider');
  assert.ok(schemas.models.length > 0, 'Should have at least one model');
  assert.ok(schemas.profiles.length > 0, 'Should have at least one profile');
});

test('agentSchemaLoader - getProviders returns all providers', () => {
  const providers = getProviders();
  assert.ok(Array.isArray(providers), 'Providers should be an array');
  assert.ok(providers.length > 0, 'Should have at least one provider');

  // Check that all providers have required fields
  for (const provider of providers) {
    assert.ok(provider.id, 'Provider should have an id');
    assert.ok(provider.label, 'Provider should have a label');
  }
});

test('agentSchemaLoader - getProvider returns specific provider', () => {
  const provider = getProvider('openai');
  assert.ok(provider, 'Should find OpenAI provider');
  assert.strictEqual(provider?.id, 'openai', 'Provider ID should match');
  assert.ok(provider?.label, 'Provider should have a label');
});

test('agentSchemaLoader - getProvider returns undefined for unknown provider', () => {
  const provider = getProvider('unknown' as any);
  assert.strictEqual(provider, undefined, 'Should return undefined for unknown provider');
});

test('agentSchemaLoader - getModels returns all models', () => {
  const models = getModels();
  assert.ok(Array.isArray(models), 'Models should be an array');
  assert.ok(models.length > 0, 'Should have at least one model');

  // Check that all models have required fields
  for (const model of models) {
    assert.ok(model.id, 'Model should have an id');
    assert.ok(model.label, 'Model should have a label');
    assert.ok(model.provider, 'Model should have a provider');
  }
});

test('agentSchemaLoader - getModelsByProvider filters correctly', () => {
  const openaiModels = getModelsByProvider('openai');
  assert.ok(Array.isArray(openaiModels), 'Models should be an array');

  // All models should belong to openai
  for (const model of openaiModels) {
    assert.strictEqual(model.provider, 'openai', 'Model should belong to OpenAI');
  }
});

test('agentSchemaLoader - getModel returns specific model', () => {
  const model = getModel('gpt-5.1');
  assert.ok(model, 'Should find GPT-5.1 model');
  assert.strictEqual(model?.id, 'gpt-5.1', 'Model ID should match');
  assert.strictEqual(model?.provider, 'openai', 'Model should be from OpenAI');
});

test('agentSchemaLoader - getProfiles returns all profiles', () => {
  const profiles = getProfiles();
  assert.ok(Array.isArray(profiles), 'Profiles should be an array');
  assert.ok(profiles.length > 0, 'Should have at least one profile');

  // Check that all profiles have required fields
  for (const profile of profiles) {
    assert.ok(profile.name, 'Profile should have a name');
    assert.ok(profile.label, 'Profile should have a label');
    assert.ok(profile.defaultProvider, 'Profile should have a default provider');
    assert.ok(profile.defaultModel, 'Profile should have a default model');
  }
});

test('agentSchemaLoader - getProfile returns specific profile', () => {
  const profile = getProfile('general');
  assert.ok(profile, 'Should find general profile');
  assert.strictEqual(profile?.name, 'general', 'Profile name should match');
  assert.ok(profile?.label, 'Profile should have a label');
});

test('agentSchemaLoader - profile references valid provider and model', () => {
  const profiles = getProfiles();
  const providers = getProviders();
  const models = getModels();

  const providerIds = new Set(providers.map((p) => p.id));
  const modelIds = new Set(models.map((m) => m.id));

  for (const profile of profiles) {
    assert.ok(
      providerIds.has(profile.defaultProvider),
      `Profile "${profile.name}" references valid provider "${profile.defaultProvider}"`
    );
    assert.ok(
      modelIds.has(profile.defaultModel),
      `Profile "${profile.name}" references valid model "${profile.defaultModel}"`
    );
  }
});

test('agentSchemaLoader - getSlashCommands returns slash commands', () => {
  const commands = getSlashCommands();
  assert.ok(Array.isArray(commands), 'Slash commands should be an array');

  // Check that all commands have required fields
  for (const cmd of commands) {
    assert.ok(cmd.command, 'Command should have a command field');
    assert.ok(cmd.command.startsWith('/'), 'Command should start with /');
    assert.ok(cmd.description, 'Command should have a description');
  }
});

test('agentSchemaLoader - getCapabilities returns capabilities', () => {
  const capabilities = getCapabilities();
  assert.ok(Array.isArray(capabilities), 'Capabilities should be an array');

  // Check that all capabilities have required fields
  for (const cap of capabilities) {
    assert.ok(cap.id, 'Capability should have an id');
    assert.ok(cap.label, 'Capability should have a label');
  }
});

test('agentSchemaLoader - isValidProvider validates correctly', () => {
  assert.ok(isValidProvider('openai'), 'OpenAI should be a valid provider');
  assert.ok(isValidProvider('anthropic'), 'Anthropic should be a valid provider');
  assert.ok(!isValidProvider('unknown'), 'Unknown should not be a valid provider');
});

test('agentSchemaLoader - isValidModel validates correctly', () => {
  assert.ok(isValidModel('gpt-5.1'), 'GPT-5.1 should be a valid model');
  assert.ok(!isValidModel('unknown-model'), 'Unknown model should not be valid');
});

test('agentSchemaLoader - isValidProfile validates correctly', () => {
  assert.ok(isValidProfile('general'), 'General should be a valid profile');
  assert.ok(isValidProfile('apt-code'), 'APT Code should be a valid profile');
  assert.ok(!isValidProfile('unknown-profile'), 'Unknown profile should not be valid');
});

test('agentSchemaLoader - validates no duplicate provider IDs', () => {
  const providers = getProviders();
  const ids = providers.map((p) => p.id);
  const uniqueIds = new Set(ids);
  assert.strictEqual(ids.length, uniqueIds.size, 'All provider IDs should be unique');
});

test('agentSchemaLoader - validates no duplicate model IDs', () => {
  const models = getModels();
  const ids = models.map((m) => m.id);
  const uniqueIds = new Set(ids);
  assert.strictEqual(ids.length, uniqueIds.size, 'All model IDs should be unique');
});

test('agentSchemaLoader - validates no duplicate profile names', () => {
  const profiles = getProfiles();
  const names = profiles.map((p) => p.name);
  const uniqueNames = new Set(names);
  assert.strictEqual(names.length, uniqueNames.size, 'All profile names should be unique');
});

test('agentSchemaLoader - schema is cached', () => {
  clearSchemaCache();
  const schema1 = getAgentSchemas();
  const schema2 = getAgentSchemas();
  assert.strictEqual(schema1, schema2, 'Schema should be cached and return same instance');
});

test('agentSchemaLoader - clearSchemaCache works', () => {
  const schema1 = getAgentSchemas();
  clearSchemaCache();
  const schema2 = getAgentSchemas();
  assert.notStrictEqual(schema1, schema2, 'Cache should be cleared and new instance loaded');
});
