import assert from 'node:assert/strict';
import test from 'node:test';
import vm from './helpers/module-policy-vm.mjs';
import { readFile } from 'node:fs/promises';
import { canonicalCatalogueClassName } from '../functions/lib/class-names.js';
import { schoolSectionFor } from '../functions/lib/school-scope.js';

const source = async file => (await readFile(new URL(`../${file}`, import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '').replace(/^export /gm, '');
const rows = [
  { ClassId: 'garden-nursery', ClassName: 'Nursery2', BranchId: 'garden', SchoolSection: 'primary', Active: 'YES', Arms: 'Excellence', LegacyDocumentId: 'NURSERY_2' },
  { ClassId: 'main-nursery', ClassName: 'NURSERY 2', BranchId: 'main', SchoolSection: 'primary', Active: 'YES' },
  { ClassId: 'garden-secondary', ClassName: 'Grade 10', BranchId: 'garden', SchoolSection: 'secondary', Active: 'YES' }
];
function reader(classes = rows) {
  const calls = [];
  return { calls, getBranchClassCatalogue: async (_env, scope) => {
    calls.push(structuredClone(scope));
    assert.ok(scope.branchId && scope.branchId !== 'all');
    return { classes: structuredClone(classes.filter(row => row.BranchId === scope.branchId
      && (!scope.section || scope.section === 'all' || row.SchoolSection === scope.section)
      && (scope.includeInactive !== false || row.Active === 'YES'))) };
  } };
}

test('catalogue normalization prefers exact names and rejects ambiguous aliases without merging IDs', () => {
  const classes = [{ ClassId: 'one', ClassName: 'Grade 1' }, { ClassId: 'two', ClassName: 'Primary 1' }];
  assert.equal(canonicalCatalogueClassName('grade 1', classes), 'Grade 1');
  assert.throws(() => canonicalCatalogueClassName('Basic One', classes), error => error.status === 409);
  assert.equal(canonicalCatalogueClassName('Basic One', classes, { allowAmbiguous: true }), 'Basic One');
  assert.equal(canonicalCatalogueClassName('All', classes), 'All');
  assert.equal(canonicalCatalogueClassName('Unchanged legacy class', []), 'Unchanged legacy class');
  assert.equal(canonicalCatalogueClassName('nursery 2', [rows[0]]), 'Nursery2');
});

test('student class edits use the saved pupil branch and section, not the submitted branch or global catalogue', async () => {
  const catalogue = reader(), saved = [];
  const existing = { __id: 'pupil', __updateTime: 'v1', AdmissionNo: 'S/001', BranchId: 'garden', SchoolSection: 'primary', ClassName: 'Nursery2', AcademicClassId: 'garden-nursery' };
  const user = { edition: 'school', branchId: 'garden', schoolSectionAccess: 'All', allowedSections: ['students'], username: 'admin' };
  const route = vm.runInNewContext(`${await source('functions/api/staff-students.js')}\nonRequestPost`, {
    Response, schoolSectionFor, canonicalCatalogueClassName, ...catalogue,
    requireFirestoreEnv: () => {}, requireStaffSession: async () => user, readJsonBody: request => request.json(),
    listSchoolCollection: async () => [structuredClone(existing)],
    listCollection: async () => { throw new Error('Unrequested global catalogue'); },
    studentProfilePlacementChanged: () => false,
    upsertSchoolDocument: async (_env, _path, id, row) => { saved.push({ id, row }); return row; }
  });
  const response = await route({ env: {}, request: { json: async () => ({ action: 'update', AccountRef: 'S/001', ClassName: 'NURSERY 2', BranchId: 'main', SchoolSection: 'secondary' }) } });
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.equal(saved[0].row.ClassName, 'Nursery2');
  assert.equal(saved[0].row.AcademicClassId, 'garden-nursery');
  assert.deepEqual(catalogue.calls, [{ branchId: 'garden', section: 'primary', includeArms: false, includeInactive: true }]);
});

for (const [edition, section, storeType] of [['school', 'bookstore', 'Bookstore'], ['faith', 'organizationStore', 'Organisation Store']]) {
  test(`${edition} stock edit reads only its own class catalogue when applicable`, async () => {
    const catalogue = reader(), writes = [];
    const user = { edition, branchId: 'garden', schoolSectionAccess: 'All', allowedSections: [section], username: 'admin' };
    const item = { __id: 'item', __updateTime: 'v1', BranchId: 'garden', SchoolSection: 'Primary', StoreType: storeType, OrganisationEdition: edition, ItemCode: 'BOOK', ItemName: 'Book', Quantity: 4 };
    const route = vm.runInNewContext(`${await source('functions/api/staff-stores.js')}\nonRequestPost`, {
      Response, schoolSectionFor, canonicalCatalogueClassName, ...catalogue,
      requireFirestoreEnv: () => {}, requireStaffSession: async () => user, readJsonBody: request => request.json(),
      resolveStoreCategory: async () => ({ CategoryId: 'general', Name: 'General' }),
      listBranchCollection: async () => [structuredClone(item)],
      listCollection: async () => { throw new Error('Unrequested global catalogue'); },
      loadProcurementInventoryControl: async () => false, assertProcurementInventoryEdit: () => {},
      batchCommitDocuments: async (_env, data) => writes.push(...structuredClone(data))
    });
    const response = await route({ env: {}, request: { json: async () => ({ action: 'saveitem', section, ItemId: 'item', ItemCode: 'BOOK', ItemName: 'Book', ClassName: 'NURSERY 2', BranchId: 'main' }) } });
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(writes[0].data.ClassName, edition === 'school' ? 'Nursery2' : 'All');
    assert.equal(writes[0].documentId, 'item');
    assert.equal(writes[0].data.Quantity, 4);
    assert.equal(writes[0].updateTime, 'v1');
    assert.equal(catalogue.calls.length, edition === 'school' ? 1 : 0);
    if (catalogue.calls.length) assert.deepEqual(catalogue.calls[0], { branchId: 'garden', section: 'primary', includeArms: false, includeInactive: false });
  });
}

async function executiveFixture(classes = rows) {
  const catalogue = reader(classes);
  const api = vm.runInNewContext(`${await source('functions/lib/executive-correspondence.js')}\n({bootstrap,metricData,searchDirectory,authoritativeRecipientTokens,executiveOfficeCapabilities})`, {
    ...catalogue,
    listCollection: async (_env, collection) => {
      assert.notEqual(collection, 'settings/academics/classes');
      return [];
    },
    getDocument: async () => ({ MetricIds: ['classTotal'] }),
    loadStaffApprovalProfile: async () => null, publicStaffApprovalProfile: row => row,
    loadStaffPosition: async () => ({}), schoolSectionFor
  });
  const scope = { edition: 'school', branchId: 'garden', schoolSection: 'primary' };
  const user = { edition: 'school', role: 'Principal', username: 'head', allowedSections: ['executiveOffice'] };
  return { ...catalogue, api, scope, user, capabilities: api.executiveOfficeCapabilities(user, scope.edition) };
}

test('Executive Office bootstrap counts the same scoped classes without reading them twice', async () => {
  const f = await executiveFixture();
  const result = await f.api.bootstrap({}, f.user, f.scope, f.capabilities, {});
  assert.equal(f.calls.length, 1);
  assert.deepEqual(Array.from(result.classes, row => row.id), ['garden-nursery']);
  assert.equal(result.metrics[0].value, 1);
  assert.equal(f.calls[0].section, 'primary');
});

test('Executive Office search uses canonical IDs and old class letters resolve only inside the same branch', async () => {
  const f = await executiveFixture();
  const result = await f.api.searchDirectory({}, { type: 'class', query: 'nursery' }, f.capabilities, f.scope, f.user);
  assert.deepEqual(Array.from(result.results, row => row.id), ['garden-nursery']);
  assert.equal(result.results[0].schoolSection, 'primary');
  const old = await f.api.authoritativeRecipientTokens({}, { RecipientType: 'class', RecipientId: 'NURSERY_2' }, f.scope, f.user);
  assert.equal(old.CLASS, 'Nursery2');
  await assert.rejects(f.api.authoritativeRecipientTokens({}, { RecipientType: 'class', RecipientId: 'main-nursery' }, f.scope, f.user), /no longer uniquely available/);
});

test('Executive Office refuses ambiguous legacy links and does not read classes for unselected metrics', async () => {
  const f = await executiveFixture([...rows, { ...rows[0], ClassId: 'another-real-class' }]);
  await assert.rejects(f.api.authoritativeRecipientTokens({}, { RecipientType: 'class', RecipientId: 'NURSERY_2' }, f.scope, f.user), error => error.status === 409);
  f.calls.length = 0;
  await f.api.metricData({}, f.scope, ['issuedCorrespondence'], [], f.user);
  assert.equal(f.calls.length, 0);
});
