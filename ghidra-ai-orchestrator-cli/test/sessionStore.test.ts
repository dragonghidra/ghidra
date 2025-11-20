import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConversationMessage } from '../src/core/types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'apt-session-store-'));
process.env['APT_DATA_DIR'] = tempDir;

const {
  saveSessionSnapshot,
  listSessions,
  loadSessionById,
  deleteSession,
  saveAutosaveSnapshot,
  loadAutosaveSnapshot,
  clearAutosaveSnapshot,
} = await import('../src/core/sessionStore.js');

test.after(() => {
  delete process.env['APT_DATA_DIR'];
  rmSync(tempDir, { recursive: true, force: true });
});

const baseMessages: ConversationMessage[] = [
  { role: 'system', content: 'system prompt' },
  { role: 'user', content: 'Initial request' },
  { role: 'assistant', content: 'Response' },
] as ConversationMessage[];

test('sessionStore saves, lists, and loads sessions', () => {
  const summary = saveSessionSnapshot({
    profile: 'general',
    provider: 'openai',
    model: 'gpt-5.1',
    workspaceRoot: '/tmp/project',
    messages: baseMessages,
    title: 'My session',
  });
  assert.ok(summary.id);
  const sessions = listSessions('general');
  assert.equal(sessions.length, 1);
  const first = sessions[0];
  assert.ok(first);
  assert.equal(first?.title, 'My session');
  const loaded = loadSessionById(summary.id);
  assert.ok(loaded);
  assert.equal(loaded?.messages.length, baseMessages.length);
  assert.equal(loaded?.workspaceRoot, '/tmp/project');
  assert.equal(deleteSession(summary.id), true);
  assert.equal(listSessions('general').length, 0);
});

test('sessionStore autosave helpers round trip', () => {
  saveAutosaveSnapshot('general', {
    provider: 'openai',
    model: 'gpt-5.1',
    workspaceRoot: '/tmp/project',
    messages: baseMessages,
    title: 'Autosave session',
  });
  const autosaved = loadAutosaveSnapshot('general');
  assert.ok(autosaved);
  assert.equal(autosaved?.title, 'Autosave session');
  const autosaveMessages = autosaved?.messages ?? [];
  const second = autosaveMessages[1];
  assert.ok(second);
  assert.equal(second?.role, 'user');
  clearAutosaveSnapshot('general');
  const cleared = loadAutosaveSnapshot('general');
  assert.equal(cleared, null);
});
