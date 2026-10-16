import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { isActiveClinicVisit, normalizeClinicDispensedItems } from '../functions/lib/clinic-stock-usage.js';

const source = await readFile(new URL('../functions/lib/clinic-stock-usage.js', import.meta.url), 'utf8');
function fixture() {
  const rows = new Map(); let version = 0, batches = 0, conflict = false, lostResponse = false, missReceiptOnce = false;
  const put = (collection, id, row) => rows.set(`${collection}/${id}`, { ...structuredClone(row), __id: id, __updateTime: `v${++version}` });
  const read = (collection, id) => structuredClone(rows.get(`${collection}/${id}`) || null);
  const getDocument = async (_env, collection, id) => {
    if (collection === 'clinicRecordOperations' && missReceiptOnce) { missReceiptOnce = false; return null; }
    return read(collection, id);
  };
  const batchCommitLiteralDocuments = async (_env, writes) => {
    if (conflict) throw Object.assign(new Error('Concurrent write'), { status: 409 });
    for (const write of writes) {
      const existing = read(write.collectionPath, write.documentId);
      if ((write.exists === false && existing) || (write.updateTime && existing?.__updateTime !== write.updateTime)) {
        throw Object.assign(new Error('Concurrent write'), { status: 409 });
      }
    }
    batches++;
    for (const write of writes) put(write.collectionPath, write.documentId, write.data);
    if (lostResponse) { lostResponse = false; throw Object.assign(new Error('Upstream response lost'), { status: 503 }); }
  };
  const commit = new Function('getDocument', 'batchCommitLiteralDocuments',
    source.replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '') + '\nreturn commitClinicVisit;')(getDocument, batchCommitLiteralDocuments);
  const payload = { RecordId: 'VISIT-1', RecordNo: 'VISIT-1', AdmissionNo: 'S-1', StudentName: 'Synthetic',
    BranchId: 'main', SchoolSection: 'secondary', OrganisationEdition: 'school', Complaint: 'Synthetic visit', Date: '2026-10-11' };
  const user = { username: 'nurse', displayName: 'Nurse', role: 'Clinic User' };
  put('clinicInventory', 'MED-1', { BranchId: 'main', SchoolSection: 'Secondary', ItemName: 'Synthetic supply', Unit: 'pcs', Quantity: 10, ProcurementManaged: true });
  const save = (body = {}, changes = {}) => commit({}, { documentId: 'VISIT-1', payload: { ...payload, ...changes }, body, user });
  return { put, read, rows, save, user, batches: () => batches, conflict: () => { conflict = true; },
    loseResponse: () => { lostResponse = true; }, missReceipt: () => { missReceiptOnce = true; } };
}

test('dispensing validates exact IDs, unique items, finite positive quantities and bounded precision', () => {
  for (const value of [null, {}, [{ InventoryId: 'MED-1', Quantity: 0 }], [{ InventoryId: '../x', Quantity: 1 }],
    [{ InventoryId: '..', Quantity: 1 }], [{ InventoryId: 'bad\u0000', Quantity: 1 }],
    [{ InventoryId: 'MED-1', Quantity: Infinity }], [{ InventoryId: 'MED-1', Quantity: 0.00001 }],
    [{ InventoryId: 'MED-1', Quantity: true }], [{ InventoryId: 'MED-1', Quantity: '1e2' }], [{ InventoryId: 'MED-1', Quantity: null }],
    [{ InventoryId: 'MED-1', Quantity: 1 }, { InventoryId: 'MED-1', Quantity: 2 }], Array(31).fill({})]) {
    assert.throws(() => normalizeClinicDispensedItems(value));
  }
  assert.deepEqual(normalizeClinicDispensedItems([{ InventoryId: 'MED-1', Quantity: 0.125 }]), [{ InventoryId: 'MED-1', Quantity: 0.125 }]);
});

test('visit, stock, movement and durable retry receipt are saved in one atomic batch', async () => {
  const f = fixture(), body = { RequestId: 'first', DispensedItems: [{ InventoryId: 'MED-1', Quantity: 3 }] };
  const result = await f.save(body);
  assert.equal(result.record.Revision, 1);
  assert.equal(f.batches(), 1);
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 7);
  assert.equal(f.read('clinicInventory', 'MED-1').ProcurementManaged, true);
  assert.equal(f.read('clinicRecords', 'VISIT-1').DispensedItems[0].ItemName, 'Synthetic supply');
  assert.equal((await f.save(body)).replayed, true);
  assert.equal(f.batches(), 1);
  await assert.rejects(f.save({ ...body, DispensedItems: [{ InventoryId: 'MED-1', Quantity: 4 }] }), /different visit details/);
});

test('shortage, cross-branch, cross-section and vendor ownership fail without partial visits', async () => {
  for (const changes of [{ Quantity: 1 }, { BranchId: 'annex' }, { SchoolSection: 'Primary' }, { VendorId: 'vendor' }, { OwnershipType: 'Vendor' }, { OwnerType: 'Vendor' }, { OrganisationEdition: 'faith' }]) {
    const f = fixture();
    f.put('clinicInventory', 'MED-1', { ...f.read('clinicInventory', 'MED-1'), ...changes });
    await assert.rejects(f.save({ DispensedItems: [{ InventoryId: 'MED-1', Quantity: 2 }] }));
    assert.equal(f.batches(), 0);
    assert.equal(f.read('clinicRecords', 'VISIT-1'), null);
  }
});

test('reviewed correction applies only delta; old clients omitting lines preserve prior usage', async () => {
  const f = fixture();
  await f.save({ RequestId: 'first', DispensedItems: [{ InventoryId: 'MED-1', Quantity: 3 }] });
  await f.save({ RequestId: 'correct', ExpectedRevision: 1, ChangeReason: 'Corrected recorded quantity', DispensedItems: [{ InventoryId: 'MED-1', Quantity: 2 }] });
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 8);
  const legacy = await f.save({ RequestId: 'notes', ExpectedRevision: 2, ChangeReason: 'Clinical note correction' }, { Notes: 'Follow-up' });
  assert.equal(legacy.record.DispensedItems[0].Quantity, 2);
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 8);
  await assert.rejects(f.save({ RequestId: 'stale', ExpectedRevision: 1, ChangeReason: 'Old form' }), /Reload/);
  await assert.rejects(f.save({ RequestId: 'reason', ExpectedRevision: 3 }), /reason/);
});

test('cancelling a clinical record keeps used stock unless unused stock is explicitly returned', async () => {
  const f = fixture();
  await f.save({ RequestId: 'first', DispensedItems: [{ InventoryId: 'MED-1', Quantity: 3 }] });
  await f.save({ RequestId: 'cancel', ExpectedRevision: 1, ChangeReason: 'Duplicate clinical record; stock was consumed', Status: 'Cancelled' });
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 7);
  const returned = { RequestId: 'return', ExpectedRevision: 2, ChangeReason: 'Unused items physically returned', Status: 'Cancelled', RestoreDispensedStock: true };
  await f.save(returned);
  await f.save(returned);
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 10);
  assert.equal(f.read('clinicRecords', 'VISIT-1').DispensedItems.length, 0);
  const audits = [...f.rows.entries()].filter(([key]) => key.startsWith('clinicRecordOperations/')).map(([, row]) => row);
  assert.equal(audits.at(-1).PreviousRecord.DispensedItems[0].Quantity, 3);
  assert.equal(audits.at(-1).StockChanges[0].Change, 3);
});

test('historical free text does not infer stock and new corrections cannot change student identity', async () => {
  const f = fixture();
  f.put('clinicRecords', 'VISIT-1', { RecordId: 'VISIT-1', AdmissionNo: 'S-1', BranchId: 'main', SchoolSection: 'secondary', Treatment: 'Three units mentioned in old free text' });
  await f.save({ RequestId: 'legacy', ExpectedRevision: 0, ChangeReason: 'Corrected note' });
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 10);
  await assert.rejects(f.save({ RequestId: 'student', ExpectedRevision: 1, ChangeReason: 'Change' }, { AdmissionNo: 'S-2' }), /reassigned/);
});

test('conflicting writes and read-only sessions never partially save', async () => {
  const f = fixture(); f.conflict();
  await assert.rejects(f.save({ DispensedItems: [{ InventoryId: 'MED-1', Quantity: 2 }] }), /no partial update/);
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 10);
  assert.equal(f.read('clinicRecords', 'VISIT-1'), null);
  const readOnly = fixture(); readOnly.user.subscriptionReadOnly = true;
  await assert.rejects(readOnly.save({}), /cannot record/);
});

test('fractional dispensing conserves stock across reviewed corrections and cancellation returns', async () => {
  const f = fixture();
  f.put('clinicInventory', 'MED-1', { ...f.read('clinicInventory', 'MED-1'), Quantity: 1.125 });
  await f.save({ RequestId: 'fraction', DispensedItems: [{ InventoryId: 'MED-1', Quantity: 0.125 }] });
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 1);
  await f.save({ RequestId: 'correct', ExpectedRevision: 1, ChangeReason: 'Entry correction', DispensedItems: [{ InventoryId: 'MED-1', Quantity: 0.001 }] });
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 1.124);
  await f.save({ RequestId: 'cancel', ExpectedRevision: 2, ChangeReason: 'Unused supply returned', Status: 'Cancelled', RestoreDispensedStock: true });
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 1.125);
  const invalid = fixture();
  invalid.put('clinicInventory', 'MED-1', { ...invalid.read('clinicInventory', 'MED-1'), Quantity: 1.12345 });
  await assert.rejects(invalid.save({ DispensedItems: [{ InventoryId: 'MED-1', Quantity: 0.1 }] }), /three decimal places/);
  assert.equal(invalid.batches(), 0);
});

test('reactivating a returned cancelled visit deducts only its newly entered quantities', async () => {
  const f = fixture();
  await f.save({ RequestId: 'first', DispensedItems: [{ InventoryId: 'MED-1', Quantity: 3 }] });
  await f.save({ RequestId: 'cancel', ExpectedRevision: 1, ChangeReason: 'Unused supply returned', Status: 'Cancelled', RestoreDispensedStock: true });
  await f.save({ RequestId: 'reopen', ExpectedRevision: 2, ChangeReason: 'Reopened with correct usage', Status: 'Active', DispensedItems: [{ InventoryId: 'MED-1', Quantity: 1 }] });
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 9);
  assert.equal(f.read('clinicRecords', 'VISIT-1').StockReturnedOnCancellation, false);
});

test('exact legacy inventory IDs with spaces, percent encoding and non-ASCII characters are never rewritten', async () => {
  const f = fixture(), id = 'main-Secondary-Bandage%20Élas tic';
  f.put('clinicInventory', id, { ...f.read('clinicInventory', 'MED-1'), ItemName: 'Synthetic legacy supply' });
  await f.save({ RequestId: 'literal', DispensedItems: [{ InventoryId: id, Quantity: 3 }] });
  assert.equal(f.read('clinicInventory', id).Quantity, 7);
  assert.equal(f.read('clinicInventory', encodeURIComponent(id)), null);
  assert.equal(f.read('clinicRecords', 'VISIT-1').DispensedItems[0].InventoryId, id);
  assert.match(source, /await batchCommitLiteralDocuments\(env, writes\)/);
});

test('receipt replay recovers a lost commit response and an initial stale receipt read before revision validation', async () => {
  const f = fixture(), body = { RequestId: 'lost', DispensedItems: [{ InventoryId: 'MED-1', Quantity: 3 }] };
  f.loseResponse();
  assert.equal((await f.save(body)).replayed, true);
  assert.equal(f.read('clinicInventory', 'MED-1').Quantity, 7);
  f.missReceipt();
  assert.equal((await f.save(body)).replayed, true);
  assert.equal(f.batches(), 1);
});

test('cancelled clinic visits stay audited but cannot be shown to parents as valid treatments', async () => {
  assert.equal(isActiveClinicVisit({}), true);
  assert.equal(isActiveClinicVisit({ Status: 'Active' }), true);
  for (const Status of ['Cancelled', 'canceled', 'VOID', 'voided']) assert.equal(isActiveClinicVisit({ Status }), false);
  const parent = await readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8');
  const staff = await readFile(new URL('../functions/api/staff-departments.js', import.meta.url), 'utf8');
  assert.match(parent, /\(sources\.clinic \|\| \[\]\)\.filter\(isActiveClinicVisit\)/);
  assert.match(parent, /scopedClinicRows\.filter\(isActiveClinicVisit\)/);
  assert.match(staff, /records\.filter\(\(row\) => isActiveClinicVisit\(row\) && sameRef/);
  assert.match(staff, /records: publicRows\(records\.rows\)/);
  assert.match(staff, /visible: row => visible\(\[row\], user\)\.length === 1/);
});
