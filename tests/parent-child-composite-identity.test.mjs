import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { parentChildIdentity } from '../functions/api/parent-dashboard.js';

const [source, apiSource] = await Promise.all([
  readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8')
]);

function loadIdentityHelpers() {
  const start = source.indexOf('function childIdentity(child)');
  const end = source.indexOf('function passportPhotoCacheKey(child, reference)');
  assert.notEqual(start, -1, 'childIdentity helper must exist');
  assert.ok(end > start, 'identity helpers must be declared together');
  const context = {};
  vm.runInNewContext(
    `${source.slice(start, end)}
     globalThis.identityHelpers = { childIdentity, childResult, setChildResult, normalizeChildResultMaps };`,
    context
  );
  return context.identityHelpers;
}

test('the same account reference in two scopes has two independent identities', () => {
  const { childIdentity } = loadIdentityHelpers();
  const primary = { __scopePath: '/schools/primary/students/', AccountRef: ' DCA/26/001 ' };
  const secondary = { __scopePath: 'schools/secondary/students', AccountRef: 'dca/26/001' };

  assert.equal(childIdentity(primary), 'schools/primary/students|dca/26/001');
  assert.equal(childIdentity(secondary), 'schools/secondary/students|dca/26/001');
  assert.notEqual(childIdentity(primary), childIdentity(secondary));
});

test('the parent API and browser use the same composite child identity format', () => {
  const { childIdentity } = loadIdentityHelpers();
  const child = {
    __scopePath: '/schoolBranches/Main/sections/Primary/students/',
    AccountRef: ' DCA/26/001 '
  };

  assert.equal(
    parentChildIdentity(child),
    'schoolbranches/main/sections/primary/students|dca/26/001'
  );
  assert.equal(parentChildIdentity(child), childIdentity(child));
});

test('initial dashboard result maps are written with the composite identity', () => {
  assert.match(source, /function childIdentity\(child\)/);
  assert.match(apiSource, /const identity = parentChildIdentity\(child\);/);
  for (const field of [
    'accountSummaries',
    'walletActivity',
    'paymentRecords',
    'payableItems',
    'dueNotifications',
    'clinicVisits',
    'entranceResults'
  ]) {
    assert.match(apiSource, new RegExp(`${field}\\[identity\\] =`));
    assert.doesNotMatch(apiSource, new RegExp(`${field}\\[child\\.AccountRef\\] =`));
  }
});

test('child-scoped result maps cannot overwrite a duplicate reference in another scope', () => {
  const { childIdentity, childResult, setChildResult } = loadIdentityHelpers();
  const primary = { __scopePath: 'schools/primary/students', AccountRef: 'DCA/26/001' };
  const secondary = { __scopePath: 'schools/secondary/students', AccountRef: 'DCA/26/001' };
  const results = {};

  setChildResult(results, primary, [{ Receipt: 'PRIMARY' }]);
  setChildResult(results, secondary, [{ Receipt: 'SECONDARY' }]);

  assert.equal(Object.keys(results).length, 2);
  assert.equal(childResult(results, primary, [])[0].Receipt, 'PRIMARY');
  assert.equal(childResult(results, secondary, [])[0].Receipt, 'SECONDARY');
  assert.ok(Object.hasOwn(results, childIdentity(primary)));
  assert.ok(Object.hasOwn(results, childIdentity(secondary)));
});

test('legacy reference-only dashboard maps are not copied across ambiguous siblings', () => {
  const { childIdentity, normalizeChildResultMaps } = loadIdentityHelpers();
  const primary = { __scopePath: 'schools/primary/students', AccountRef: 'DCA/26/001' };
  const secondary = { __scopePath: 'schools/secondary/students', AccountRef: 'DCA/26/001' };
  const data = {
    children: [primary, secondary],
    walletActivity: { 'DCA/26/001': [{ Source: 'ambiguous legacy result' }] },
    storeCatalog: [{ ItemCode: 'SHARED' }],
    storeOrders: [{ AccountRef: 'DCA/26/001', OrderNo: 'AMBIGUOUS' }]
  };

  normalizeChildResultMaps(data);

  assert.deepEqual(Object.keys(data.walletActivity), []);
  assert.equal(data.storeCatalogByChild[childIdentity(primary)], undefined);
  assert.equal(data.storeCatalogByChild[childIdentity(secondary)], undefined);
  assert.equal(data.storeOrdersByChild[childIdentity(primary)], undefined);
  assert.equal(data.storeOrdersByChild[childIdentity(secondary)], undefined);
});

test('selection, lazy-load cache, upload cache, and child result rendering all use the composite key', () => {
  assert.match(source, /find\(\(child\) => childIdentity\(child\) === selectedChildKey\)/);
  assert.match(source, /button\.className = 'child-card' \+ \(identity === selectedChildKey/);
  assert.match(source, /loadedPayables\.has\(identity\)/);
  assert.match(source, /loadedPayables\.add\(identity\)/);
  assert.match(source, /parentDocumentUploadIdentity[\s\S]*?childIdentity\(child\)/);
  assert.match(source, /dashboard\.storeCatalogByChild\[identity\] = activityData\.storeCatalog/);
  assert.match(source, /dashboard\.storeOrdersByChild\[identity\] = activityData\.storeOrders/);
  assert.match(source, /childResult\(dashboard\.walletActivity, child, \[\]\)/);
  assert.match(source, /childResult\(dashboard\.paymentRecords, child, \[\]\)/);
  assert.doesNotMatch(source, /selectedAccountRef/);
  assert.doesNotMatch(source, /dashboard\.\w+\?\.\[child\.AccountRef\]/);
});
