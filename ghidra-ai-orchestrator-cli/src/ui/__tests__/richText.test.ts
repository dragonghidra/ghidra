import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMessageBody } from '../richText.js';
import { theme } from '../theme.js';

test('renderMessageBody outputs compact, link-aware content', () => {
  const sample = [
    '• Japan stop: Trump met with business leaders and reaffirmed defense ties in Tokyo.',
    '• South Korea finale: follow-on talks at the Busan economic summit reinforced chip cooperation.',
    '',
    'Sources:',
    '- CNN recap: https://www.cnn.com/politics/trump-asia',
    '- Reuters briefing: [Full itinerary](https://www.reuters.com/world/example-trip)',
  ].join('\n');

  const body = renderMessageBody(sample, 64);

  assert.ok(!body.includes('┌'));
  assert.ok(!body.includes('│'));
  assert.ok(!body.includes('└'));

  const lines = body.split('\n');
  let blankRun = 0;

  for (const line of lines) {
    assert.equal(line, line.trimEnd());
    if (!line.trim()) {
      blankRun += 1;
      assert.ok(blankRun <= 1, 'should not render multiple consecutive blank separators');
    } else {
      blankRun = 0;
    }
  }

  const bareLink = (theme.link?.url ?? theme.info)('https://www.cnn.com/politics/trump-asia');
  assert.ok(body.includes(bareLink), 'bare links should be colorized');

  const markdownLinkLabel = (theme.link?.label ?? theme.secondary)('Full itinerary');
  const markdownLinkUrl = (theme.link?.url ?? theme.info)('(https://www.reuters.com/world/example-trip)');
  assert.ok(body.includes(markdownLinkLabel), 'markdown link labels should be highlighted');
  assert.ok(body.includes(markdownLinkUrl), 'markdown link URLs should reuse link color');
});
