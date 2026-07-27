import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const middleware = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');

test('Dynamax Pages can use the canonical secured API without copying secrets', () => {
  assert.match(middleware, /https:\/\/digc-suite\.pages\.dev/);
  assert.match(middleware, /env\.FIREBASE_PROJECT_ID/);
  assert.match(middleware, /if \(!isApi \|\| hasLocalBackend\) return next\(\)/);
  assert.doesNotMatch(middleware, /PRIVATE_KEY|SHARED_SECRET|SESSION_SECRET/);
});
