import assert from 'node:assert/strict';

// Feature tests pin a minimum generation, not a particular release's suffix.
// Later cache bumps must remain valid without weakening the stale-cache guard.
export function assertServiceWorkerCacheVersion(source, minimumVersion) {
  assert.ok(Number.isSafeInteger(minimumVersion) && minimumVersion > 0, 'A positive minimum cache version is required.');
  const declarations = [...source.matchAll(/^\s*const\s+CACHE\s*=\s*(['"])(dynamax-v([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*)\1\s*;?\s*$/gm)];
  assert.equal(declarations.length, 1, 'sw.js must declare one versioned, descriptive Dynamax cache identifier.');
  const version = Number(declarations[0][3]);
  assert.ok(Number.isSafeInteger(version) && version >= minimumVersion,
    `The browser cache must be v${minimumVersion} or newer; found ${declarations[0][2]}.`);
  return declarations[0][2];
}
