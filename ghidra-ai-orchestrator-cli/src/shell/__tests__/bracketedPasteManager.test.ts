import assert from 'node:assert/strict';
import test from 'node:test';

import { BracketedPasteManager } from '../bracketedPasteManager.js';

const START = '\u001b[200~';
const END = '\u001b[201~';

test('combines bracketed paste across multiple lines', () => {
  const manager = new BracketedPasteManager(true);

  let result = manager.process(`${START}what happened in`);
  assert.equal(result.handled, true);
  assert.equal(result.result, undefined);

  result = manager.process(`  Trump\'s 2025 trip to${END}`);
  assert.equal(result.handled, true);
  assert.equal(result.result, "what happened in\n  Trump's 2025 trip to");
});

test('captures pastes that end with a newline', () => {
  const manager = new BracketedPasteManager(true);

  manager.process(`${START}first line`);
  manager.process('second line');
  const result = manager.process(`${END}`);

  assert.equal(result.handled, true);
  assert.equal(result.result, 'first line\nsecond line\n');
});

test('preserves prefix and suffix text outside paste markers', () => {
  const manager = new BracketedPasteManager(true);
  const result = manager.process(`Tell me ${START}something${END} please`);

  assert.equal(result.handled, true);
  assert.equal(result.result, 'Tell me something please');
});

test('falls back gracefully when bracketed paste is disabled', () => {
  const manager = new BracketedPasteManager(false);

  let result = manager.process('just text');
  assert.equal(result.handled, false);

  result = manager.process(`${START}multi${END}`);
  assert.equal(result.handled, false);
});
