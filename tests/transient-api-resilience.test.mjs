import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);

test('read-only staff requests retry transient non-JSON edge responses', async () => {
  const admin = await readFile(new URL('js/admin.js', portalRoot), 'utf8');
  assert.match(admin, /const TRANSIENT_API_STATUS_CODES = new Set/);
  assert.match(admin, /const retrySafe = options\.dynamaxRetrySafe === true/);
  assert.match(admin, /await response\.arrayBuffer\(\)\.catch/);
  assert.match(admin, /dynamaxRetrySafe: true,[\s\S]{0,180}body: JSON\.stringify\(\{ mode/);
  assert.match(admin, /normalizedAction === 'bootstrap'[\s\S]{0,180}startsWith\('preview'\)/);
});

test('a transient dashboard shell failure does not deny an authenticated user access', async () => {
  const [admin, serviceWorker] = await Promise.all([
    readFile(new URL('js/admin.js', portalRoot), 'utf8'),
    readFile(new URL('sw.js', portalRoot), 'utf8')
  ]);
  assert.match(admin, /mode === 'shell' && Array\.isArray\(currentUser\?\.allowedSections\)/);
  assert.match(admin, /Workspace opened from your verified sign-in/);
  assert.match(serviceWorker, /dynamax-v265-hotel-self-service/);
});
