import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { firestoreDocumentToObject, objectToFirestoreFields } from '../functions/lib/firestore.js';

const source = await readFile(new URL('../functions/lib/firestore.js', import.meta.url), 'utf8');
const section = source.slice(source.indexOf('export async function getDocuments('), source.indexOf('export async function getDocument(')).replace('export ', '');
const base = 'https://firestore.googleapis.com/v1/projects/test/databases/(default)/documents';
function fixture(change = rows => rows) {
  const calls = [];
  const get = vm.runInNewContext(`(${section})`, {
    getFirestoreAccessToken: async () => 'test-token', firestoreBaseUrl: () => base, firestoreDocumentToObject,
    firestoreErrorStatus: (data, status) => ({ status, code: data.error.status, upstreamCode: data.error.status }),
    fetch: async (url, options) => {
      assert.equal(url, `${base}:batchGet`); assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, 'Bearer test-token');
      const { documents } = JSON.parse(options.body); calls.push(documents);
      const rows = documents.map(name => name.endsWith('/missing') ? { missing: name } : {
        found: { name, updateTime: '2026-10-15T08:00:00Z', fields: objectToFirestoreFields({ ItemName: name.split('/').at(-1), Quantity: 2.125 }) }
      }).reverse();
      return new Response(JSON.stringify(change(rows, calls.length)), { status: 200 });
    }
  });
  return { get, calls };
}

test('batch reads preserve order, missing entries, literal IDs and versions across every bounded batch', async () => {
  const f = fixture(), ids = ['a b', 'Unicode-界', 'encoded%20id', 'missing', ...Array.from({ length: 110 }, (_, i) => `item-${i}`), 'a b'];
  const rows = await f.get({}, 'items', ids);
  assert.equal(rows.length, ids.length); assert.equal(rows[3], null);
  rows.forEach((row, index) => { if (row) { assert.equal(row.__id, ids[index]); assert.equal(row.Quantity, 2.125); assert.equal(row.__updateTime, '2026-10-15T08:00:00Z'); } });
  assert.deepEqual(f.calls.map(call => call.length), [25, 25, 25, 25, 14]);
  assert.equal(new Set(f.calls.flat()).size, 114);
  assert.ok(f.calls.flat().includes('projects/test/databases/(default)/documents/items/a b'));
  const empty = fixture(); assert.equal((await empty.get({}, 'items', [])).length, 0); assert.equal(empty.calls.length, 0);
});

test('batch reads never return partial success for truncated, duplicate, malformed or unrelated responses', async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `item-${i}`);
  for (const change of [rows => rows.slice(1), rows => [...rows, rows[0]], () => ({}),
    rows => [{ missing: 'projects/test/databases/(default)/documents/other/item' }, ...rows.slice(1)]]) {
    const f = fixture((rows, call) => call === 2 ? change(rows) : rows);
    await assert.rejects(f.get({}, 'items', ids), /incomplete|unexpected/);
    assert.equal(f.calls.length, 2);
  }
});

test('batch reads reject invalid document paths without contacting the database', async () => {
  const f = fixture();
  for (const [collection, ids] of [['', ['id']], ['items/id', ['id']], ['../items/rows', ['id']], ['items', null], ['items', ['']], ['items', ['../escape']]])
    await assert.rejects(f.get({}, collection, ids));
  assert.equal(f.calls.length, 0);
});

test('batch reads propagate failed HTTP responses instead of treating them as missing records', async () => {
  const get = vm.runInNewContext(`(${section})`, {
    getFirestoreAccessToken: async () => 'test-token', firestoreBaseUrl: () => base, firestoreDocumentToObject,
    firestoreErrorStatus: (data, status) => ({ status, code: data.error.status }),
    fetch: async () => new Response(JSON.stringify({ error: { message: 'Quota unavailable', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 })
  });
  await assert.rejects(get({}, 'items', ['item']), error => error.status === 429 && error.code === 'RESOURCE_EXHAUSTED');
});
