import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);

test('read-only staff requests retry transient non-JSON edge responses', async () => {
  const admin = await readFile(new URL('js/admin.js', portalRoot), 'utf8');
  assert.match(admin, /const TRANSIENT_API_STATUS_CODES = new Set/);
  assert.match(admin, /const retrySafe = options\.dynamaxRetrySafe === true/);
  assert.match(admin, /dynamaxRetryAttempts/);
  assert.match(admin, /await response\.arrayBuffer\(\)\.catch/);
  assert.match(admin, /dynamaxRetrySafe: true,[\s\S]{0,180}body: JSON\.stringify\(\{ mode/);
  assert.match(admin, /normalizedAction === 'bootstrap'[\s\S]{0,180}startsWith\('preview'\)/);
  assert.match(admin, /normalizedMethod === 'GET'[\s\S]{0,180}body\?\.action[\s\S]{0,260}dynamaxRetryAttempts: retrySafe \? 3 : 1/);
  assert.match(admin, /Cloudflare temporarily returned a web page while checking staff access/);
});

test('a transient dashboard shell failure does not deny an authenticated user access', async () => {
  const [admin, serviceWorker] = await Promise.all([
    readFile(new URL('js/admin.js', portalRoot), 'utf8'),
    readFile(new URL('sw.js', portalRoot), 'utf8')
  ]);
  assert.match(admin, /mode === 'shell' && Array\.isArray\(currentUser\?\.allowedSections\)/);
  assert.match(admin, /Workspace opened from your verified sign-in/);
  assert.match(serviceWorker, /dynamax-v285-email-provider/);
});
