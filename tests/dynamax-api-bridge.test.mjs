import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const middleware = await readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8');
const routes = JSON.parse(await readFile(new URL('../_routes.json', import.meta.url), 'utf8'));

test('Dynamax Pages can use the canonical secured API without copying secrets', () => {
  assert.match(middleware, /https:\/\/digc-suite\.pages\.dev/);
  assert.match(middleware, /env\.FIREBASE_PROJECT_ID/);
  assert.match(middleware, /if \(!isApi\) return next\(\)/);
  assert.match(middleware, /if \(hasLocalBackend\)/);
  assert.match(middleware, /env\.CANONICAL_PORTAL_URL/);
  assert.doesNotMatch(middleware, /PRIVATE_KEY|SHARED_SECRET|SESSION_SECRET/);
});

test('only real API paths invoke Pages Functions', () => {
  assert.deepEqual(routes, {
    version: 1,
    include: ['/api', '/api/*'],
    exclude: []
  });
  assert.equal(routes.include.some((route) => route.includes('.html')), false);
  assert.equal(routes.include.some((route) => /\/(?:css|js|images|icons|fonts)\//.test(route)), false);
});
