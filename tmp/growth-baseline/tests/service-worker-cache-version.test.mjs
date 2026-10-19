import test from 'node:test';
import assert from 'node:assert/strict';
import { assertServiceWorkerCacheVersion } from './helpers/service-worker-cache-version.mjs';

test('cache checks accept the minimum generation and later releases with different descriptions', () => {
  for (const value of ['dynamax-v378-controlled-subject-changes', 'dynamax-v380-requisition-approval-settings', 'dynamax-v1000-future-release']) {
    assert.equal(assertServiceWorkerCacheVersion(`const CACHE = '${value}';\nconst SHELL = [];`, 378), value);
  }
});

test('cache checks still reject an older generation even when its suffix looks current', () => {
  assert.throws(() => assertServiceWorkerCacheVersion("const CACHE = 'dynamax-v377-requisition-approval-settings';", 378), /v378 or newer/);
});

test('missing, malformed, misleading or duplicate cache declarations are rejected', () => {
  for (const source of [
    '', "// const CACHE = 'dynamax-v380-valid';", "const CACHE = 'dynamax-v380';",
    "const CACHE = 'unversioned';", "const CACHE = 'dynamax-v0-invalid';",
    "const CACHE = 'dynamax-v380-Invalid';", "const CACHE = 'dynamax-v380-trailing-';",
    "const CACHE = 'dynamax-v380-valid';\nconst CACHE = 'dynamax-v381-duplicate';"
  ]) assert.throws(() => assertServiceWorkerCacheVersion(source, 378), /one versioned, descriptive/);
  for (const minimum of [0, -1, NaN, 1.5]) assert.throws(() => assertServiceWorkerCacheVersion('', minimum), /positive minimum/);
});
