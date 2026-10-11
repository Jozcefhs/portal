import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { requirePlatformAdmin } from '../functions/lib/platform-admin.js';
import {
  HELP_CONFIG_DOCUMENT_ID, HELP_CONFIG_MAX_BYTES, DEFAULT_HARDWARE_SHOP_URL,
  normalizeHelpConfig, validateHelpConfig, readHelpConfigJson, isHelpOwnerHost,
  loadPublishedHelpConfig, saveHelpConfig
} from '../functions/lib/help-config.js';
import { onRequestPost, onRequestGet } from '../functions/api/help-config.js';

const env = {
  FIREBASE_PROJECT_ID: 'school-tenant',
  DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID: 'dynamax-platform',
  DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL: 'platform@example.test',
  DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY: 'mock-key',
  ADMIN_WEB_PASSWORD: 'owner-test-password'
};
const bridge = { ALLOW_CANONICAL_API_PROXY: 'true', CANONICAL_API_PROXY_SCOPE: 'platform-subscriptions', CANONICAL_PORTAL_URL: 'https://dynamax.cc' };
const draft = (changes = {}) => ({ SupportEmail: 'support+software@example.test', HardwareShopUrl: DEFAULT_HARDWARE_SHOP_URL,
  Faqs: [{ Question: 'How can I get help?', Answer: 'Ask your institution administrator.' }], ...changes });
const request = (body, url = 'https://dynamax.cc/api/help-config', headers = {}) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

function storage(initial = null) {
  let saved = initial && structuredClone(initial), serial = 0;
  const writes = [];
  return {
    get: async (platformEnv, collection, id) => {
      assert.equal(platformEnv.FIREBASE_PROJECT_ID, 'dynamax-platform');
      assert.equal(collection, 'settings'); assert.equal(id, HELP_CONFIG_DOCUMENT_ID);
      return saved && structuredClone(saved);
    },
    commit: async (platformEnv, changes) => {
      assert.equal(platformEnv.FIREBASE_PROJECT_ID, 'dynamax-platform');
      assert.equal(changes.length, 1);
      const change = changes[0];
      assert.equal(change.documentId, HELP_CONFIG_DOCUMENT_ID); assert.equal(change.collectionPath, 'settings');
      if ((change.exists === false && saved) || (change.updateTime && change.updateTime !== saved?.__updateTime)) throw Object.assign(new Error('Write conflict'), { status: 409 });
      writes.push(structuredClone(change)); saved = { ...structuredClone(change.data), __updateTime: `version-${++serial}` };
    },
    writes,
    current: () => saved && structuredClone(saved)
  };
}

test('public defaults contain a known shop URL, no invented support address and revision zero', () => {
  const defaults = normalizeHelpConfig();
  assert.equal(defaults.SupportEmail, ''); assert.equal(defaults.HardwareShopUrl, DEFAULT_HARDWARE_SHOP_URL);
  assert.equal(defaults.Revision, 0); assert.equal(defaults.UpdatedAt, ''); assert.ok(defaults.Faqs.length > 0);
  defaults.Faqs[0].Answer = 'changed'; assert.notEqual(normalizeHelpConfig().Faqs[0].Answer, 'changed');
});

test('valid configuration is plain data with no secret or arbitrary stored fields', () => {
  const result = validateHelpConfig({ ...draft(), Password: 'secret', UpdatedBy: 'untrusted', Revision: 500 });
  assert.deepEqual(Object.keys(result), ['SupportEmail', 'HardwareShopUrl', 'Faqs']);
  assert.equal(validateHelpConfig(draft({ SupportEmail: '', Faqs: [] })).SupportEmail, '');
  assert.deepEqual(validateHelpConfig(draft({ Faqs: [] })).Faqs, []);
  assert.equal(normalizeHelpConfig({ ...result, __id: 'id', __updateTime: 'v1', privateKey: 'secret', Revision: 3 }).Revision, 3);
  assert.doesNotMatch(JSON.stringify(normalizeHelpConfig({ privateKey: 'secret' })), /privateKey|secret/);
});

for (const SupportEmail of ['mailto:help@example.test', 'help@example.test\r\nBcc:other@example.test', 'help%0d%0a@example.test',
  'help?subject=x@example.test', 'help&bcc=x@example.test', 'help#x@example.test', 'x@@example.test', 'x@example', 'x@-example.test',
  '.help@example.test', 'help..desk@example.test', `${'a'.repeat(65)}@example.test`, 123]) {
  test(`support email rejects unsafe/malformed value ${JSON.stringify(SupportEmail)}`, () => assert.throws(() => validateHelpConfig(draft({ SupportEmail })), error => error.status === 400));
}

for (const HardwareShopUrl of ['http://example.test/shop', 'javascript:alert(1)', 'data:text/html,hi', '/shop', 'https://user:secret@example.test',
  'https://example.test/line\nbreak', 'https://example.test/a b', `https://example.test/${'x'.repeat(2048)}`, '']) {
  test(`shop destination rejects ${HardwareShopUrl.slice(0, 60)}`, () => assert.throws(() => validateHelpConfig(draft({ HardwareShopUrl })), error => error.status === 400));
}

test('FAQ limits reject missing or overlong entries and permit intentionally empty catalogue', () => {
  for (const Faqs of [null, {}, Array(31).fill({ Question: 'Q', Answer: 'A' }), [{ Question: '', Answer: 'A' }],
    [{ Question: 'Q'.repeat(181), Answer: 'A' }], [{ Question: 'Q', Answer: 'A'.repeat(3001) }], [{ Question: 'Q', Answer: '\u0000hidden' }]])
    assert.throws(() => validateHelpConfig(draft({ Faqs })), error => error.status === 400);
  assert.equal(validateHelpConfig(draft({ Faqs: [{ Question: 'Q'.repeat(180), Answer: 'A'.repeat(3000) }] })).Faqs[0].Answer.length, 3000);
  assert.deepEqual(validateHelpConfig(draft({ Faqs: [] })).Faqs, []);
});

test('normalization does not publish malformed saved URLs, emails, metadata or revision', () => {
  const result = normalizeHelpConfig({ SupportEmail: 'mailto:bad@example.test', HardwareShopUrl: 'javascript:alert(1)', Faqs: 'bad', Revision: -2, UpdatedAt: {}, credentials: 'secret' });
  assert.deepEqual(result, normalizeHelpConfig());
  assert.equal(normalizeHelpConfig({ Faqs: [], Revision: 7 }).Faqs.length, 0);
});

test('streamed JSON rejects oversized declared and chunked bodies without reading beyond limit', async () => {
  await assert.rejects(readHelpConfigJson(request({}, undefined, { 'Content-Length': String(HELP_CONFIG_MAX_BYTES + 1) })), error => error.status === 413);
  let cancelled = false, reads = 0;
  const body = new ReadableStream({ pull(controller) { reads += 1; controller.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
  await assert.rejects(readHelpConfigJson(new Response(body), { maxBytes: 2048 }), error => error.status === 413);
  assert.equal(cancelled, true); assert.ok(reads <= 4);
  for (const source of ['not-json', '[]', 'null', '"text"']) await assert.rejects(readHelpConfigJson(new Response(source)), error => error.status === 400);
});

test('direct central reads are shared across editions and never fall back to tenant settings', async () => {
  const f = storage({ ...draft(), Revision: 2, __updateTime: 'v2', UpdatedBy: 'private owner' });
  for (const edition of ['school', 'faith', 'organization']) {
    const result = await loadPublishedHelpConfig({ ...env, ...bridge, ORGANISATION_EDITION: edition }, 'https://tenant.test/api/help-config', { ...f, fetch: () => { throw new Error('Bridge not needed'); } });
    assert.equal(result.published, true); assert.equal(result.config.Revision, 2); assert.equal(result.config.SupportEmail, draft().SupportEmail);
    assert.doesNotMatch(JSON.stringify(result), /private owner|__updateTime/);
  }
  const unpublished = await loadPublishedHelpConfig(env, 'https://dynamax.cc/api/help-config', storage());
  assert.equal(unpublished.published, false); assert.equal(unpublished.unavailable, undefined);
});

test('tenant bridge uses canonical public route without any caller credentials or redirects', async () => {
  let calls = 0;
  const result = await loadPublishedHelpConfig({ ...bridge, BACKEND_API_KEY: 'secret', ADMIN_WEB_PASSWORD: 'password' }, 'https://tenant.test/api/help-config?password=private', {
    fetch: async (url, options) => { calls += 1; assert.equal(String(url), 'https://dynamax.cc/api/help-config');
      assert.deepEqual(options.headers, { Accept: 'application/json' }); assert.equal(options.redirect, 'manual'); assert.ok(options.signal);
      return Response.json({ ok: true, published: true, config: { ...draft(), Revision: 4, PrivateKey: 'do not leak' } }); }
  });
  assert.equal(calls, 1); assert.equal(result.config.Revision, 4); assert.doesNotMatch(JSON.stringify(result), /do not leak/);
});

test('failed direct access can fall back to the public central bridge', async () => {
  const result = await loadPublishedHelpConfig({ ...env, ...bridge }, 'https://tenant.test/api/help-config', {
    get: async () => { throw new Error('Private credential failure'); },
    fetch: async () => Response.json({ ok: true, published: true, config: draft() })
  });
  assert.equal(result.published, true); assert.equal(result.config.SupportEmail, draft().SupportEmail);
});

test('every tenant edition loads published help without subscription proxy configuration', async () => {
  for (const edition of ['school', 'faith', 'organization']) {
    for (const proxySettings of [{}, { ALLOW_CANONICAL_API_PROXY: 'false', CANONICAL_API_PROXY_SCOPE: 'none' }]) {
      let calls = 0;
      const result = await loadPublishedHelpConfig({ ORGANISATION_EDITION: edition, ...proxySettings }, 'https://tenant.test/api/help-config', {
        fetch: async (url, options) => {
          calls += 1;
          assert.equal(String(url), 'https://dynamax.cc/api/help-config');
          assert.deepEqual(options.headers, { Accept: 'application/json' });
          return Response.json({ ok: true, published: true, config: { ...draft(), Revision: 7 } });
        }
      });
      assert.equal(calls, 1);
      assert.equal(result.published, true);
      assert.equal(result.config.SupportEmail, draft().SupportEmail);
      assert.equal(result.config.Revision, 7);
    }
  }
});

test('missing tenant-side platform record still loads the published central help', async () => {
  const result = await loadPublishedHelpConfig(env, 'https://tenant.test/api/help-config', {
    get: async () => null,
    fetch: async () => Response.json({ ok: true, published: true, config: draft() })
  });
  assert.equal(result.published, true);
  assert.equal(result.config.SupportEmail, draft().SupportEmail);
});

test('canonical timeout also aborts a response body that has not finished streaming', async () => {
  let signal;
  const result = await loadPublishedHelpConfig(bridge, 'https://tenant.test/api/help-config', {
    fetch: async (_url, options) => {
      signal = options.signal;
      const body = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"ok":'));
        signal.addEventListener('abort', () => controller.error(new Error('Aborted unfinished response')), { once: true });
      } });
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    }
  });
  assert.equal(signal.aborted, true); assert.equal(result.unavailable, true);
  assert.equal(result.config.SupportEmail, '');
});

test('bridge errors and malformed/oversized responses return safe unavailable defaults', async () => {
  for (const response of [Response.json({ ok: true, published: true, config: draft() }, { status: 503 }),
    new Response(null, { status: 302, headers: { Location: 'https://untrusted.test/help' } }),
    Response.json({ ok: true, published: true, unavailable: true, config: draft() }), Response.json({ ok: true, published: 'true', config: draft() }),
    new Response('<html>error</html>'), new Response('x'.repeat(HELP_CONFIG_MAX_BYTES + 1), { headers: { 'Content-Type': 'application/json' } })]) {
    const result = await loadPublishedHelpConfig(bridge, 'https://tenant.test/api/help-config', { fetch: async () => response });
    assert.equal(result.unavailable, true); assert.equal(result.config.SupportEmail, ''); assert.equal(result.config.HardwareShopUrl, DEFAULT_HARDWARE_SHOP_URL);
  }
});

test('owner hosts never proxy recursively and invalid canonical destinations never fetch', async () => {
  const fetch = () => { throw new Error('Must not fetch'); };
  for (const host of ['dynamax.cc', 'www.dynamax.cc', 'dynamaxms.pages.dev']) {
    assert.equal(isHelpOwnerHost(`https://${host}/api/help-config`), true);
    const result = await loadPublishedHelpConfig(bridge, `https://${host}/api/help-config`, { fetch });
    assert.equal(result.unavailable, true);
  }
  for (const CANONICAL_PORTAL_URL of ['http://dynamax.cc', 'https://other.test', 'https://user:password@dynamax.cc', 'https://dynamax.cc:444', 'not-a-url'])
    assert.equal((await loadPublishedHelpConfig({ ...bridge, CANONICAL_PORTAL_URL }, 'https://tenant.test/api/help-config', { fetch })).unavailable, true);
});

test('owner publishing creates centrally and updates using version and revision preconditions', async () => {
  const f = storage();
  const first = await saveHelpConfig(env, { config: draft(), ExpectedRevision: 0 }, f);
  assert.equal(first.Revision, 1); assert.equal(f.writes[0].exists, false);
  const second = await saveHelpConfig(env, { config: draft({ SupportEmail: '', Faqs: [] }), ExpectedRevision: 1 }, f);
  assert.equal(second.Revision, 2); assert.equal(f.writes[1].updateTime, 'version-1');
  assert.equal(second.SupportEmail, ''); assert.deepEqual(second.Faqs, []); assert.equal(f.current().UpdatedBy, 'Dynamax owner');
});

test('missing, stale and concurrently changed revisions cannot overwrite saved help settings', async () => {
  const f = storage({ ...draft(), Revision: 5, __updateTime: 'version-5' });
  for (const ExpectedRevision of [undefined, null, '5', -1, NaN]) await assert.rejects(saveHelpConfig(env, { config: draft(), ExpectedRevision }, f), error => error.status === 428);
  await assert.rejects(saveHelpConfig(env, { config: draft(), ExpectedRevision: 4 }, f), error => error.status === 409);
  await assert.rejects(saveHelpConfig(env, { config: draft(), ExpectedRevision: 5 }, { ...f, commit: async () => { throw Object.assign(new Error('concurrent'), { status: 412 }); } }), error => error.status === 409 && error.code === 'HELP_CONFIG_CONFLICT');
  assert.equal(f.writes.length, 0);
});

test('real POST route denies tenant publishing, invalid credentials and non-JSON body before database access', async () => {
  const body = { password: env.ADMIN_WEB_PASSWORD, config: draft(), ExpectedRevision: 0 };
  const tenant = await onRequestPost({ env, request: request(body, 'https://tenant.test/api/help-config') });
  assert.equal(tenant.status, 403);
  const denied = await onRequestPost({ env, request: request({ ...body, password: 'incorrect' }) }); assert.equal(denied.status, 401);
  const noPassword = await onRequestPost({ env, request: request({ config: draft(), ExpectedRevision: 0 }) }); assert.equal(noPassword.status, 401);
  const wrongType = await onRequestPost({ env, request: request(body, undefined, { 'Content-Type': 'text/plain' }) }); assert.equal(wrongType.status, 415);
  const unavailable = await onRequestPost({ env: {}, request: request(body) }); assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /ADMIN_WEB_PASSWORD|owner-test-password|mock-key/);
});

test('public route returns usable safe defaults without authentication on an unconfigured owner deployment', async () => {
  const response = await onRequestGet({ env: {}, request: new Request('https://dynamax.cc/api/help-config') });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(body.unavailable, true);
  assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(body.config.SupportEmail, '');
});

test('route publishes through authenticated bounded reader and returns only the public config', async () => {
  const f = storage();
  const source = (await readFile(new URL('../functions/api/help-config.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const context = vm.createContext({ Response, Error, requirePlatformAdmin, isHelpOwnerHost, readHelpConfigJson,
    saveHelpConfig: (configEnv, body) => saveHelpConfig(configEnv, body, f), loadPublishedHelpConfig });
  vm.runInContext(`${source}\nthis.handlers = { onRequestGet, onRequestPost };`, context);
  const response = await context.handlers.onRequestPost({ env, request: request({ password: env.ADMIN_WEB_PASSWORD, config: draft(), ExpectedRevision: 0 }) });
  const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.published, true); assert.equal(body.config.Revision, 1);
  assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.doesNotMatch(JSON.stringify(body), /owner-test-password|mock-key|UpdatedBy/);
});
