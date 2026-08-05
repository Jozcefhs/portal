import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  accountingRequestBranch,
  accountingRowsForBranch,
  accountingWriteBranch
} from '../functions/lib/accounting-branch-scope.js';

test('an assigned accounting user is restricted to that branch', () => {
  const body = { UserBranchId: 'west', BranchId: 'west' };
  assert.equal(accountingRequestBranch(body), 'west');
  assert.deepEqual(
    accountingRowsForBranch([
      { Reference: 'legacy-main' },
      { Reference: 'main', BranchId: 'main' },
      { Reference: 'west', BranchId: 'west' }
    ], accountingRequestBranch(body)).map((row) => row.Reference),
    ['west']
  );
});

test('legacy accounting records belong to main and cannot leak to another branch', () => {
  assert.deepEqual(accountingRowsForBranch([{ Reference: 'legacy' }], 'west'), []);
  assert.deepEqual(accountingRowsForBranch([{ Reference: 'legacy' }], 'main').map((row) => row.Reference), ['legacy']);
});

test('an unassigned organisation administrator may request all branches', () => {
  assert.equal(accountingRequestBranch({ UserBranchId: '', BranchId: 'all' }), 'all');
  assert.equal(accountingRowsForBranch([{ BranchId: 'main' }, { BranchId: 'west' }], 'all').length, 2);
});

test('accounting writes reject attempts to edit another branch', () => {
  assert.throws(
    () => accountingWriteBranch({ UserBranchId: 'west', BranchId: 'west' }, { BranchId: 'main' }),
    (error) => error.status === 403
  );
  assert.throws(
    () => accountingWriteBranch({ UserBranchId: 'west' }, { JournalNo: 'LEGACY-MAIN' }),
    (error) => error.status === 403
  );
  assert.equal(accountingWriteBranch({ UserBranchId: 'west' }), 'west');
  assert.equal(accountingWriteBranch({ CostCentre: 'east' }), 'east');
});

test('desktop overview scopes every financial register before building reports', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.match(source, /const branchId = accountingRequestBranch\(body\)/);
  assert.match(source, /buildAccountingReport\(scopedChart, scopedJournals, scopedExpenses, scopedBudgets, filter, scopedInvoices\)/);
  assert.match(source, /payrollProfiles: scopedPayrollProfiles/);
  assert.match(source, /payrollTaxOverrides: scopedPayrollTaxOverrides/);
  assert.match(source, /donations: scopedDonations/);
  assert.match(source, /BranchId: branchId, Department: payload\.Department/);
  assert.match(source, /BranchId: branchId, RunId: runId/);
});
