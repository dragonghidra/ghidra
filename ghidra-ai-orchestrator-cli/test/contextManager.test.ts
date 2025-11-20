import { test } from 'node:test';
import assert from 'node:assert';
import { getContextWindowTokens } from '../src/core/contextWindow.js';
import {
  createDefaultContextManager,
  resolveContextManagerConfig,
} from '../src/core/contextManager.js';

test('getContextWindowTokens maps DeepSeek models', () => {
  assert.strictEqual(getContextWindowTokens('deepseek-reasoner'), 131_072);
  assert.strictEqual(getContextWindowTokens('deepseek-chat'), 64_000);
});

test('resolveContextManagerConfig applies headroom and target ratios', () => {
  const config = resolveContextManagerConfig('deepseek-reasoner');
  assert.ok(config.maxTokens);
  assert.ok(config.targetTokens);
  assert.strictEqual(config.maxTokens, 127_139);
  assert.strictEqual(config.targetTokens, 95_354);
});

test('createDefaultContextManager respects overrides', () => {
  const manager = createDefaultContextManager({
    maxTokens: 100,
    targetTokens: 80,
    estimatedCharsPerToken: 1,
  });

  const stats = manager.getStats([{ role: 'system', content: 'a'.repeat(50) }]);
  assert.strictEqual(stats.totalTokens, 50);
  assert.strictEqual(stats.percentage, 50);
  assert.strictEqual(stats.isApproachingLimit, false);
  assert.strictEqual(stats.isOverLimit, false);
});
