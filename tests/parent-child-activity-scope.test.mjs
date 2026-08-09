import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  recordMatchesSelectedChildScope,
  selectedChildActivityScope
} from '../functions/api/parent-dashboard.js';

const source = await readFile(
  new URL('../functions/api/parent-dashboard.js', import.meta.url),
  'utf8'
);

test('selected child activity scope uses the validated identity path as authority', () => {
  const scope = selectedChildActivityScope(
    'schoolBranches/west/sections/primary/students',
    'students',
    { BranchId: 'main', SchoolSection: 'secondary' }
  );
  assert.deepEqual(scope, {
    scopePath: 'schoolBranches/west/sections/primary/students',
    branchId: 'west',
    schoolSection: 'primary'
  });
  assert.equal(selectedChildActivityScope('', 'students', {}), null);
  assert.equal(
    selectedChildActivityScope('schoolBranches/west/sections/primary/payments', 'students', {}),
    null
  );
});

test('activity records with a duplicate account reference are accepted only in the selected scope', () => {
  const scope = {
    scopePath: 'schoolBranches/west/sections/primary/students',
    branchId: 'west',
    schoolSection: 'primary'
  };
  assert.equal(recordMatchesSelectedChildScope({
    AccountRef: 'DCA/26/001',
    BranchId: 'WEST',
    SchoolSection: 'Primary'
  }, scope), true);
  assert.equal(recordMatchesSelectedChildScope({
    AccountRef: 'DCA/26/001',
    BranchId: 'main',
    SchoolSection: 'primary'
  }, scope), false);
  assert.equal(recordMatchesSelectedChildScope({
    AccountRef: 'DCA/26/001',
    BranchId: 'west'
  }, scope), false);
});

test('a scoped collection path may provide scope without trusting conflicting fields', () => {
  const scope = {
    branchId: 'west',
    schoolSection: 'secondary'
  };
  assert.equal(recordMatchesSelectedChildScope({
    BranchId: 'main',
    SchoolSection: 'primary',
    __scopePath: 'schoolBranches/west/sections/secondary/storeOrders'
  }, scope), true);
});

test('legacy root finance records use the main-branch section defaults', () => {
  const mainSecondary = {
    branchId: 'main',
    schoolSection: 'secondary'
  };
  assert.equal(recordMatchesSelectedChildScope({
    AccountRef: 'DCA/26/001'
  }, mainSecondary), true);
  assert.equal(recordMatchesSelectedChildScope({
    AccountRef: 'DCA/26/001',
    ClassName: 'Primary 4'
  }, mainSecondary), false);
  assert.equal(recordMatchesSelectedChildScope({
    AccountRef: 'DCA/26/001'
  }, {
    branchId: 'west',
    schoolSection: 'secondary'
  }), false);
});

test('child activity and wallet mutations require and preserve selected-child scope', () => {
  assert.match(
    source,
    /if \(!requestedScopeValue \|\| !requestedScopePath\) \{[\s\S]*?selected child scope is required/i
  );
  assert.match(
    source,
    /const scopedLedgerRows = ledgerRows\.filter\(\(row\) => recordMatchesSelectedChildScope\(row, selectedScope\)\)/
  );
  assert.match(
    source,
    /const scopedInvoiceRows = invoiceRows\.filter\(\(row\) => recordMatchesSelectedChildScope\(row, selectedScope\)\)/
  );
  assert.match(
    source,
    /const scopedPaymentRows = paymentRows\.filter\(\(row\) => recordMatchesSelectedChildScope\(row, selectedScope\)\)/
  );
  assert.match(
    source,
    /const scopedClinicRows = clinicRows\.filter\(\(row\) => recordMatchesSelectedChildScope\(row, selectedScope\)\)/
  );
  assert.match(
    source,
    /const scopedSummaryRows = summaryRows\.filter\(\(row\) =>[\s\S]*?recordMatchesSelectedChildScope\(row, selectedScope\)/
  );
  assert.match(
    source,
    /const scopedStoreOrderRows = storeOrderRows\.filter\(\(row\) =>[\s\S]*?recordMatchesSelectedChildScope\(row, selectedScope\)/
  );
  assert.match(
    source,
    /const selectedRow = await getSelectedIdentityRow\(env, 'students', accountRef, requestedScopePath\)/
  );
  assert.match(source, /safeDocumentId\(student\.__id \|\| student\.AdmissionNo \|\| student\.AccountRef\)/);
});
