import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { onRequestGet } from '../functions/api/paystack-readiness.js';
import { paystackCredentialFingerprint } from '../functions/lib/paystack-environment.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const helper = await read('js/paystack-connection-status.js');
const client = await read('js/setup.js');
const context = vm.createContext({});
vm.runInContext(helper, context);
const { createTracker, presentation } = context.DynamaxPaystackConnectionStatus;
const fingerprint = `live:${'a'.repeat(24)}`;
const previous = `live:${'b'.repeat(24)}`;
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const active = (mode, value) => ({ PaystackConnectionMode: mode, PaystackCredentialFingerprint: value });

test('pending live activation survives a Save response and page reload showing the old test environment', () => {
  const store = storage();
  let tracker = createTracker(store, 'school');
  tracker.remember({ mode: 'live', fingerprint, paystackSecretKey: 'must-never-be-retained' });
  tracker.reconcile(active('test', `test:${'c'.repeat(24)}`));
  assert.equal(presentation('test', tracker.pending()).title, 'Live activation pending');
  assert.match(presentation('test', tracker.pending()).message, /Test mode is still active/);
  assert.equal(presentation('test', tracker.pending()).live, false);
  tracker = createTracker(store, 'school');
  assert.equal(tracker.pending().fingerprint, fingerprint);
  assert.doesNotMatch([...store.values.values()].join(''), /secret|must-never/);
  tracker.reconcile(active('live', fingerprint));
  assert.equal(tracker.pending(), null);
  assert.equal(store.values.size, 0);
  assert.equal(presentation('live', tracker.pending()).title, 'Live payments connected');
});

test('live-to-live replacement requires matching the new credential, not merely the mode', () => {
  const tracker = createTracker(storage(), 'school');
  tracker.remember({ mode: 'live', fingerprint });
  tracker.reconcile(active('live', previous));
  assert.equal(tracker.pending().fingerprint, fingerprint);
  tracker.reconcile(active('live', undefined));
  assert.equal(tracker.pending().fingerprint, fingerprint);
  tracker.reconcile(active('test', fingerprint));
  assert.equal(tracker.pending().fingerprint, fingerprint);
  tracker.reconcile(active('live', fingerprint));
  assert.equal(tracker.pending(), null);
});

test('pending test activation and first-time connections are never labelled live', () => {
  const tracker = createTracker(storage(), 'faith');
  tracker.remember({ mode: 'test', fingerprint: `test:${'a'.repeat(24)}` });
  assert.equal(presentation('live', tracker.pending()).title, 'Test activation pending');
  assert.equal(presentation('live', tracker.pending()).live, false);
  assert.match(presentation('not-configured', tracker.pending()).message, /not active yet/);
  assert.equal(presentation('not-configured', null).title, 'No Paystack account connected');
});

test('pending metadata is workspace-isolated, shape-limited, and storage failure is non-fatal', () => {
  const store = storage();
  const tracker = createTracker(store, 'school');
  tracker.remember({ mode: 'live', fingerprint });
  assert.equal(createTracker(store, 'faith').pending(), null);
  for (const bad of [null, { mode: 'invalid', fingerprint }, { mode: 'live', fingerprint: 'sk_live_not-a-fingerprint' }]) {
    assert.equal(tracker.remember(bad), null);
  }
  store.setItem('dynamax:paystack-activation:school', '{broken');
  assert.equal(createTracker(store, 'school').pending(), null);
  const blocked = createTracker({ getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } }, 'school');
  blocked.remember({ mode: 'live', fingerprint });
  assert.equal(blocked.pending().mode, 'live');
  assert.equal(blocked.reconcile(active('live', fingerprint)), null);
});

test('UI uses active runtime mode, retains pending status and checks without resetting unsaved form data', async () => {
  assert.match(client, /paystackActivationTracker\.remember\(\{ mode: data.mode, fingerprint: data.credentialFingerprint \}\)/);
  assert.doesNotMatch(client, /paystackConnectionMode = String\(data\.mode/);
  assert.match(client, /PaystackConnectionMode: data.activeMode \|\| paystackConnectionMode/);
  const check = client.slice(client.indexOf("checkPaystackActivationButton?.addEventListener"), client.indexOf("document.getElementById('copyPaystackWebhook')"));
  assert.match(check, /action: 'load'/);
  assert.match(check, /password: unlockedPassword/);
  assert.match(check, /updatePaystackConnectionUI\(data.profile/);
  assert.doesNotMatch(check, /applyProfile|profileFromForm/);
  const page = await read('setup.html');
  assert.ok(page.indexOf('js/paystack-connection-status.js') < page.indexOf('js/setup.js'));
  assert.match(await read('sw.js'), /\/js\/paystack-connection-status.js/);
});

test('active credential fingerprint is authenticated, environment-derived, and excluded from saved/public settings', async () => {
  const api = await read('functions/api/settings.js');
  assert.match(api, /profile.PaystackCredentialFingerprint = await paystackCredentialFingerprint\(env.PAYSTACK_SECRET_KEY\)/);
  assert.match(api, /delete profile.PaystackCredentialFingerprint/);
  const publicProjection = api.slice(api.indexOf('function publicProfile'), api.indexOf('function profileForSettingsAccess'));
  assert.doesNotMatch(publicProjection, /PaystackCredentialFingerprint/);
  const connection = await read('functions/api/paystack-connection.js');
  assert.match(connection, /activeMode: currentMode/);
  assert.match(connection, /credentialFingerprint: await paystackCredentialFingerprint\(paystackSecretKey\)/);
  assert.notEqual(await paystackCredentialFingerprint('sk_live_example_first'), await paystackCredentialFingerprint('sk_live_example_second'));
});

test('deployment readiness exposes only active mode, never credentials or fingerprint, and is not cached', async () => {
  for (const [key, mode] of [['sk_live_example', 'live'], ['sk_test_example', 'test'], ['', 'not-configured']]) {
    const response = onRequestGet({ env: { PAYSTACK_SECRET_KEY: key } });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: true, mode });
  }
});
