import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [setupHtml, setupJs] = await Promise.all([
  readFile(new URL('../setup.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/setup.js', import.meta.url), 'utf8')
]);

test('settings use deployment-specific school, church, and organisation wording', () => {
  assert.match(setupJs, /'sidebar-title': 'School settings'/);
  assert.match(setupJs, /'sidebar-title': 'Church settings'/);
  assert.match(setupJs, /'sidebar-title': 'Organisation settings'/);
  assert.match(setupJs, /faith: 'Church'/);
  assert.match(setupJs, /node\.hidden = edition !== 'school'/);
  assert.match(setupHtml, /data-school-settings-only/);
});

test('client settings do not expose central Dynamax pricing administration', () => {
  assert.doesNotMatch(setupHtml, /href="plan-management\.html"/);
  assert.doesNotMatch(setupHtml, /Manage monthly and yearly pricing/);
});
