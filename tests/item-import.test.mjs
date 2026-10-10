import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { ITEM_IMPORT_LIMITS, ITEM_IMPORT_MODULES, normalizeItemImportRow, parseItemImportCsv, duplicateItemImportRows, itemImportKey } from '../js/item-import-csv.js';
import { productCsv } from '../js/vendor-product-import.js';
import { enforceActorBranch } from '../functions/lib/branch-scope.js';
import { schoolSectionFor } from '../functions/lib/school-scope.js';
import { categoryApplies, categoryKey } from '../functions/lib/store-categories.js';
import { canonicalConfiguredClass } from '../functions/lib/class-names.js';
import { requireSchoolLibraryAccess } from '../functions/lib/school-library.js';

const source = (await readFile(new URL('../functions/lib/item-import.js', import.meta.url), 'utf8')).replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/export /g, '');
const user = { username: 'officer', displayName: 'Officer', role: 'Librarian', edition: 'school', branchId: 'main', schoolSectionAccess: 'All', allowedSections: Object.keys(ITEM_IMPORT_MODULES) };
const rowFor = section => section === 'library' ? { Title: 'Mathematics', Author: 'A. Writer', Barcode: 'LIB-001', RowNumber: 2 }
  : ['clinic', 'kitchen'].includes(section) ? { ItemName: 'Sample supply', Quantity: '12.5', RowNumber: 2 }
    : { ItemCode: 'ITEM-001', ItemName: 'Sample item', Price: '1,300.00', Quantity: '12', RowNumber: 2 };

function fixture(initial = []) {
  const documents = new Map(initial.map(([collection, id, data]) => [`${collection}/${id}`, { ...structuredClone(data), __id: id }]));
  const commits = []; let reads = 0, conflict = false;
  const list = collection => [...documents.entries()].filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => structuredClone(row));
  const context = { crypto: webcrypto, TextEncoder, ITEM_IMPORT_LIMITS, ITEM_IMPORT_MODULES, normalizeItemImportRow, duplicateItemImportRows, itemImportKey, enforceActorBranch, schoolSectionFor, requireSchoolLibraryAccess, categoryApplies, categoryKey, canonicalConfiguredClass,
    listCollection: async (_env, collection) => { reads++; return list(collection); },
    queryCollection: async (_env, collection, options) => { reads++; return list(collection).filter(row => options.filters.every(filter => row[filter.field] === filter.value)); },
    getDocument: async (_env, collection, id) => { reads++; return structuredClone(documents.get(`${collection}/${id}`) || null); },
    batchCommitDocuments: async (_env, writes) => {
      if (conflict) { conflict = false; throw Object.assign(new Error('Conflict'), { status: 409 }); }
      assert.equal(new Set(writes.map(write => `${write.collectionPath}/${write.documentId}`)).size, writes.length);
      for (const write of writes) {
        assert.equal(write.exists, false, 'Imports must only create, never overwrite');
        if (documents.has(`${write.collectionPath}/${write.documentId}`)) throw Object.assign(new Error('Conflict'), { status: 409 });
      }
      commits.push(structuredClone(writes));
      for (const write of writes) documents.set(`${write.collectionPath}/${write.documentId}`, { ...structuredClone(write.data), __id: write.documentId });
    }
  };
  const handle = vm.runInNewContext(`${source}\nhandleItemImport`, context);
  const preview = (section, Rows = [rowFor(section)], actor = user) => handle({}, actor, { section, Rows, action: 'preview', BranchId: 'main' });
  const save = (section, Rows, PreviewDigest, RequestId = 'request-0001') => handle({}, user, { section, Rows, action: 'import', Confirmed: true, PreviewDigest, RequestId, BranchId: 'main' });
  return { handle, preview, save, commits, list, documents, get reads() { return reads; }, conflict: () => { conflict = true; } };
}

test('all five modules have separate round-trippable CSV templates', () => {
  assert.deepEqual(Object.keys(ITEM_IMPORT_MODULES), ['clinic', 'kitchen', 'bookstore', 'uniformStore', 'library']);
  for (const section of Object.keys(ITEM_IMPORT_MODULES)) {
    const config = ITEM_IMPORT_MODULES[section], row = rowFor(section);
    row[section === 'library' ? 'Title' : 'ItemName'] = 'Quoted, "item"\nsecond line';
    const parsed = parseItemImportCsv(productCsv(config.columns, [row]), section);
    assert.equal(parsed[0][section === 'library' ? 'Title' : 'ItemName'], row[section === 'library' ? 'Title' : 'ItemName']);
    assert.deepEqual(normalizeItemImportRow(parsed[0], section).errors, []);
  }
});

test('CSV rejects malformed headers, cell counts, quotes, excessive size and row count', () => {
  for (const text of ['ItemName,Quantity,Quantity\nx,1,1', 'ItemName,Unknown\nx,1', 'ItemName,Quantity\nx,1,2', 'ItemName,Quantity\n"x,1']) assert.throws(() => parseItemImportCsv(text, 'clinic'));
  assert.throws(() => parseItemImportCsv('x'.repeat(ITEM_IMPORT_LIMITS.bytes + 1), 'clinic'), /512 KB/);
  assert.throws(() => parseItemImportCsv('ItemName,Quantity\n' + 'x,1\n'.repeat(1001), 'clinic'), /1,000/);
});

test('numeric values, barcodes and acquisition dates are validated without coercing bad data to zero', () => {
  for (const Quantity of ['-1', 'NaN', 'Infinity', '1e5', '12,34', '1.234']) assert.ok(normalizeItemImportRow({ ItemName: 'x', Quantity }, 'clinic').errors.length);
  assert.ok(normalizeItemImportRow({ ...rowFor('bookstore'), Quantity: '1.5' }, 'bookstore').errors.length);
  assert.ok(normalizeItemImportRow({ ...rowFor('library'), AcquiredAt: '2026-02-30' }, 'library').errors.length);
  assert.ok(normalizeItemImportRow({ ...rowFor('library'), Barcode: '../../copy' }, 'library').errors.length);
  assert.equal(normalizeItemImportRow(rowFor('kitchen'), 'kitchen').row.Quantity, 12.5);
});

test('preview is read-only and each module imports new records atomically with an audit receipt', async () => {
  for (const section of Object.keys(ITEM_IMPORT_MODULES)) {
    const f = fixture(), Rows = [rowFor(section)], preview = await f.preview(section, Rows);
    assert.equal(preview.valid, true); assert.equal(f.commits.length, 0);
    const saved = await f.save(section, Rows, preview.PreviewDigest);
    assert.equal(saved.created, 1); assert.equal(f.commits.length, 1); assert.equal(f.list('itemImportBatches').length, 1);
    if (section === 'library') { assert.equal(f.list('libraryTitles').length, 1); assert.equal(f.list('libraryCopies')[0].Status, 'Available'); assert.equal(f.list('libraryAudit').length, 1); }
    if (['bookstore', 'uniformStore'].includes(section)) assert.equal(f.list('storeItems')[0].Price, 1300);
  }
});

test('unauthorised users, read-only subscriptions and cross-branch / section rows cannot import', async () => {
  const f = fixture();
  for (const actor of [{ ...user, allowedSections: [] }, { ...user, subscriptionReadOnly: true }, { ...user, subscriptionActive: false }]) await assert.rejects(f.preview('clinic', undefined, actor), error => error.status === 403);
  await assert.rejects(f.preview('library', undefined, { ...user, role: 'Teacher' }), error => error.status === 403);
  await assert.rejects(f.preview('library', undefined, { ...user, edition: 'faith' }), error => error.status === 403);
  assert.equal(f.reads, 0);
  await assert.rejects(f.handle({}, user, { section: 'clinic', action: 'preview', BranchId: 'other', Rows: [rowFor('clinic')] }), error => error.status === 403);
  const preview = await f.preview('clinic', [{ ...rowFor('clinic'), SchoolSection: 'Secondary' }], { ...user, schoolSectionAccess: 'Primary' });
  assert.equal(preview.valid, false); assert.equal(f.commits.length, 0);
});

test('existing stock and on-loan copies are skipped, not overwritten or made available', async () => {
  const f = fixture([
    ['clinicInventory', 'legacy', { BranchId: 'main', SchoolSection: 'Secondary', ItemName: 'Sample supply', Quantity: 3 }],
    ['libraryTitles', 'title', { BranchId: 'main', TitleId: 'title', Title: 'Mathematics', Author: 'A. Writer' }],
    ['libraryCopies', 'main--LIB-001', { BranchId: 'main', CopyId: 'main--LIB-001', TitleId: 'title', Barcode: 'LIB-001', Status: 'On Loan', CurrentLoanId: 'loan' }]
  ]);
  for (const section of ['clinic', 'library']) { const Rows = [rowFor(section)], p = await f.preview(section, Rows); assert.equal(p.skipped, 1); const result = await f.save(section, Rows, p.PreviewDigest); assert.equal(result.created, 0); }
  assert.equal(f.list('clinicInventory')[0].Quantity, 3); assert.equal(f.list('libraryCopies')[0].Status, 'On Loan'); assert.equal(f.list('libraryCopies')[0].CurrentLoanId, 'loan');
});

test('library batch shares one title across copies and refuses conflicting ISBN / barcode assignments', async () => {
  const f = fixture(), Rows = [rowFor('library'), { ...rowFor('library'), Barcode: 'LIB-002', RowNumber: 3 }];
  const p = await f.preview('library', Rows); await f.save('library', Rows, p.PreviewDigest);
  assert.equal(f.list('libraryTitles').length, 1); assert.equal(f.list('libraryCopies').length, 2);
  const invalid = await f.preview('library', [{ ...rowFor('library'), Title: 'Different title' }]);
  assert.equal(invalid.valid, false);
  const conflict = fixture([['libraryTitles', 'old', { BranchId: 'main', TitleId: 'old', Title: 'Other title', ISBN: '123' }]]);
  assert.equal((await conflict.preview('library', [{ ...rowFor('library'), ISBN: '123' }])).valid, false);
});

test('batch replay is exactly-once even if stock was sold after the original import', async () => {
  const f = fixture(), Rows = [rowFor('bookstore')], p = await f.preview('bookstore', Rows);
  await f.save('bookstore', Rows, p.PreviewDigest);
  const item = f.list('storeItems')[0]; f.documents.get(`storeItems/${item.__id}`).Quantity = 2;
  const retry = await f.save('bookstore', Rows, p.PreviewDigest);
  assert.equal(retry.created, 1); assert.equal(retry.replayed, true); assert.equal(f.commits.length, 1); assert.equal(f.list('storeItems')[0].Quantity, 2);
  const otherRows = [{ ...rowFor('bookstore'), ItemCode: 'OTHER' }], other = await f.preview('bookstore', otherRows);
  await assert.rejects(f.save('bookstore', otherRows, other.PreviewDigest), /different import/);
});

test('tampered confirmation, rows and conflict cannot cause a partial batch write', async () => {
  const f = fixture(), Rows = [rowFor('clinic')], p = await f.preview('clinic', Rows);
  await assert.rejects(f.save('clinic', [{ ...Rows[0], Quantity: '99' }], p.PreviewDigest), /Preview/);
  await assert.rejects(f.handle({}, user, { section: 'clinic', action: 'import', Rows, PreviewDigest: p.PreviewDigest, RequestId: 'request-0001' }), /confirm/);
  f.conflict(); await assert.rejects(f.save('clinic', Rows, p.PreviewDigest), /Stock changed/); assert.equal(f.commits.length, 0);
  await assert.rejects(f.preview('clinic', Array.from({ length: 21 }, () => rowFor('clinic'))), /1–20/);
  assert.equal(f.list('clinicInventory').length, 0);
});

test('duplicate detection works across CSV chunks, not just inside each server batch', () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ ...rowFor('clinic'), ItemName: `item ${i}`, RowNumber: i + 2 }));
  rows[20].ItemName = 'ITEM 0';
  assert.deepEqual([...duplicateItemImportRows(rows, 'clinic')], [2, 22]);
});

test('module buttons, lazy dialog, scope guards and mobile overflow styles are wired', async () => {
  const [admin, dialog, css, html, endpoint] = await Promise.all(['js/admin.js', 'js/item-import-dialog.js', 'css/item-import.css', 'admin.html', 'functions/api/staff-item-import.js'].map(path => readFile(new URL('../' + path, import.meta.url), 'utf8')));
  assert.match(admin, /if \(canManage\) bindModuleItemImport\('library'\)/);
  assert.match(admin, /\['clinic', 'kitchen'\]\.includes\(section\)\) bindModuleItemImport\(section\)/);
  assert.match(admin, /if \(!organisationStore\) bindModuleItemImport\(section\)/);
  assert.match(admin, /currentUser === user && selectedBranchId === branch && activeSection === workspace/);
  assert.match(dialog, /parseItemImportCsv/); assert.match(dialog, /PreviewDigest: previews\[next\]\.PreviewDigest/); assert.match(dialog, /RequestId: requestIds\[next\]/);
  assert.match(css, /overflow:auto/); assert.match(css, /@media\(max-width:560px\)/);
  assert.match(html, /css\/item-import.css\?v=/); assert.match(endpoint, /requireStaffSession\(env, request\)/); assert.match(endpoint, /maxBytes: 96 \* 1024/);
});
