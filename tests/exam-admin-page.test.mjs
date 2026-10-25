import test from 'node:test';
import assert from 'node:assert/strict';
import { secureExamAdminPage } from '../functions/lib/exam-admin-page.js';
import { onRequest } from '../functions/_middleware.js';

test('exam editor nonce rendering does not load deployment settings or any database', async () => {
  const response = await onRequest({ request: new Request('https://school.test/exams-admin.html'),
    env: new Proxy({}, { get() { throw new Error('No backend settings may be read for this page'); } }),
    next: async () => new Response('<head></head>', { headers: { 'Content-Type': 'text/html' } }) });
  assert.match(await response.text(), /exam-style-nonce/);
});

test('document editor styles receive a fresh nonce without allowing inline scripts or unrestricted styles', async () => {
  const page = () => new Response('<html><head></head><body>Exams</body></html>', { headers: { 'Content-Type': 'text/html', ETag: 'stale' } });
  const first = await secureExamAdminPage(page()), second = await secureExamAdminPage(page());
  const html = await first.text(), nonce = /name="exam-style-nonce" content="([A-Za-z0-9+/=]+)"/.exec(html)[1];
  const csp = first.headers.get('Content-Security-Policy');
  assert.match(csp, /script-src 'self';/);
  assert.ok(csp.includes(`style-src 'self' 'nonce-${nonce}'`));
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|blob:/);
  assert.notEqual(csp, second.headers.get('Content-Security-Policy'));
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.equal(first.headers.has('ETag'), false);
});

test('missing pages and non-HTML responses are left intact', async () => {
  for (const response of [new Response('missing', { status: 404 }), Response.json({ ok: false })]) {
    assert.equal(await secureExamAdminPage(response), response);
  }
});
