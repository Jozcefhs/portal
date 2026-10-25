import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extractFunction } from './helpers/academic-register-fixture.mjs';
const createCache = vm.runInNewContext(`(${extractFunction('createAcademicClassRegisterCache')})`);

test('class cache expires from the original load time, not subsequent visits', () => {
  let now = 100;
  const cache = createCache({ now: () => now, maxAge: 600 });
  cache.set('grade7', { loadedAt: now, register: { Rows: [] } });
  now = 500;
  const saved = cache.get('grade7');
  assert.ok(saved);
  cache.set('grade7', saved);
  now = 700;
  assert.equal(cache.get('grade7'), null);
});

test('class caches are bounded, independent per workspace, and explicitly clearable', () => {
  const cache = createCache({ now: () => 1, limit: 2 });
  for (const id of ['7', '8', '9']) cache.set(id, { loadedAt: 1 });
  assert.equal(cache.get('7'), null);
  assert.ok(cache.get('8'));
  assert.equal(createCache().get('8'), null);
  cache.clear();
  assert.equal(cache.get('8'), null);
});
