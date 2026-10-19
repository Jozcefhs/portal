import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { libraryCopyViews } from '../functions/lib/school-library.js';
import { enforceActorBranch } from '../functions/lib/branch-scope.js';
import { safeScopeId } from '../functions/lib/school-scope.js';

const source = (await readFile(new URL('../functions/lib/school-library.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
const actor = { username: 'officer', role: 'Librarian', edition: 'school', branchId: 'main', allowedSections: ['library'] };
const copy = (extra = {}) => ({ CopyId: 'main--LIB-0001', TitleId: 'TITLE-1', Barcode: 'LIB-0001', Title: 'Test book',
  BranchId: 'main', Status: 'Available', Condition: 'Good', ...extra });
const loan = (extra = {}) => ({ LoanId: 'LOAN-1', CopyId: 'main--LIB-0001', Barcode: 'LIB-0001', TitleId: 'TITLE-1', Title: 'Test book',
  BranchId: 'main', BorrowerType: 'Student', BorrowerRef: 'TEST/001', BorrowerName: 'Test reader', Status: 'On Loan', DueDate: '2026-12-01', ...extra });
const borrowerId = 'main--student--test%2F001';

function fixture(rows = []) {
  const store = new Map();
  const commits = [];
  const put = (collection, id, data) => store.set(`${collection}/${id}`, { ...data, __id: decodeURIComponent(id), __updateTime: 'r1' });
  put('libraryTitles', 'TITLE-1', { TitleId: 'TITLE-1', Title: 'Test book', BranchId: 'main' });
  for (const [collection, id, row] of rows) put(collection, id, row);
  const deps = {
    crypto: webcrypto, Intl, Date, console, enforceActorBranch, safeScopeId, schoolSectionFor: () => 'secondary',
    getSchoolStructure: async () => ({ ActiveBranchId: 'main' }),
    getDocument: async (_env, collection, id) => store.get(`${collection}/${id}`) || null,
    queryCollection: async (_env, collection, options = {}) => [...store.entries()]
      .filter(([key, row]) => key.startsWith(`${collection}/`) && (options.filters || []).every(f => row[f.field] === f.value)).map(([, row]) => row),
    listSchoolCollection: async () => [{ AdmissionNo: 'TEST/001', DisplayName: 'Test reader', Status: 'Active' },
      { AdmissionNo: 'TEST/002', DisplayName: 'Other reader', Status: 'Active' }],
    listCollection: async () => [], createNotification: async () => ({}),
    batchCommitDocuments: async (_env, writes) => {
      // Simulate Firestore's resource-name IDs, including escaped admission refs.
      for (const w of writes) {
        const existing = store.get(`${w.collectionPath}/${encodeURIComponent(w.documentId)}`);
        if (w.exists === false && existing || w.updateTime && existing?.__updateTime !== w.updateTime) throw Object.assign(new Error('Conflict'), { status: 409 });
      }
      commits.push(writes);
      for (const w of writes) put(w.collectionPath, encodeURIComponent(w.documentId), w.data);
    }
  };
  const action = vm.runInNewContext(`${source}\nhandleSchoolLibraryAction`, deps);
  return { store, commits, run: (actionName, body = {}, user = actor) => action({}, user, { action: actionName, ...body }) };
}

test('reservation status is separate from a physical checkout; inconsistent copies are flagged, not silently returned', () => {
  const pending = [{ TitleId: 'TITLE-1', Status: 'Pending' }];
  assert.equal(libraryCopyViews([copy()], [], pending)[0].DisplayStatus, 'Reserved');
  const active = libraryCopyViews([copy({ Status: 'On Loan', CurrentLoanId: 'LOAN-1' })], [loan()], pending)[0];
  assert.equal(active.DisplayStatus, 'On Loan');
  assert.equal(active.ReservationCount, 1);
  assert.equal(active.ActiveLoanId, 'LOAN-1');
  const stale = libraryCopyViews([copy({ Status: 'On Loan', CurrentLoanId: 'MISSING' })], [], pending)[0];
  assert.equal(stale.DisplayStatus, 'Status needs review');
  assert.equal(stale.Status, 'On Loan');
  assert.equal(stale.ActiveLoanId, '');
});

test('reserving does not modify a copy or create a loan and escaped reservation IDs cannot be duplicated', async () => {
  const f = fixture([['libraryCopies', copy().CopyId, copy()]]);
  await f.run('reserve', { TitleId: 'TITLE-1', BorrowerType: 'Student', BorrowerRef: 'TEST/001' });
  assert.equal(f.store.get('libraryCopies/main--LIB-0001').Status, 'Available');
  assert.ok(![...f.store.keys()].some(key => key.startsWith('libraryLoans/')));
  await assert.rejects(f.run('reserve', { TitleId: 'TITLE-1', BorrowerType: 'Student', BorrowerRef: 'TEST/001' }), /already has a reservation/);
  const reservation = [...f.store.values()].find(row => row.ReservationId);
  await f.run('cancelReservation', { ReservationId: reservation.ReservationId });
  assert.equal([...f.store.values()].find(row => row.ReservationId).Status, 'Cancelled');
});

test('checkout respects the reservation queue and fulfils only the selected borrower reservation', async () => {
  const f = fixture([['libraryCopies', copy().CopyId, copy()]]);
  await f.run('reserve', { TitleId: 'TITLE-1', BorrowerType: 'Student', BorrowerRef: 'TEST/001' });
  await assert.rejects(f.run('checkout', { CopyId: copy().CopyId, BorrowerType: 'Student', BorrowerRef: 'TEST/002' }), /next borrower/);
  await f.run('checkout', { CopyId: copy().CopyId, BorrowerType: 'Student', BorrowerRef: 'TEST/001' });
  assert.equal(f.store.get('libraryCopies/main--LIB-0001').Status, 'On Loan');
  assert.equal([...f.store.values()].find(row => row.ReservationId).Status, 'Fulfilled');
});

test('an actual checkout can be returned even when the borrower counter ID contains encoded slashes', async () => {
  const f = fixture([['libraryCopies', copy().CopyId, copy()]]);
  const issued = await f.run('checkout', { CopyId: copy().CopyId, BorrowerType: 'Student', BorrowerRef: 'TEST/001' });
  await f.run('return', { LoanId: issued.loan.LoanId, Outcome: 'Returned' });
  assert.equal(f.store.get('libraryCopies/main--LIB-0001').Status, 'Available');
  assert.equal(f.store.get(`libraryLoans/${issued.loan.LoanId}`).Status, 'Returned');
  assert.equal([...f.store.values()].find(row => row.BorrowerId).ActiveLoans, 0);
  await assert.rejects(f.run('return', { LoanId: issued.loan.LoanId }), /already been closed/);
});

test('borrower limits are enforced with existing escaped counter IDs', async () => {
  const f = fixture([['libraryCopies', copy().CopyId, copy()],
    ['libraryBorrowers', encodeURIComponent(borrowerId), { BorrowerId: borrowerId, BranchId: 'main', ActiveLoans: 3 }]]);
  await assert.rejects(f.run('checkout', { CopyId: copy().CopyId, BorrowerType: 'Student', BorrowerRef: 'TEST/001' }), /borrowing limit/);
  assert.equal(f.commits.length, 0);
});

test('branchless legacy loans are recovered only through a matching copy link', async () => {
  const f = fixture([['libraryCopies', copy().CopyId, copy({ Status: 'On Loan', CurrentLoanId: 'LOAN-1' })],
    ['libraryLoans', 'LOAN-1', loan({ BranchId: undefined })], ['libraryLoans', 'UNRELATED', loan({ LoanId: 'UNRELATED', BranchId: undefined })]]);
  const loaded = await f.run('list');
  assert.equal(loaded.summary.OnLoan, 1);
  assert.equal(loaded.loans.length, 1);
  assert.equal(loaded.copies[0].ActiveLoanId, 'LOAN-1');
});

test('other branch loans are never revealed through a copy pointer', async () => {
  const f = fixture([['libraryCopies', copy().CopyId, copy({ Status: 'On Loan', CurrentLoanId: 'LOAN-1' })],
    ['libraryLoans', 'LOAN-1', loan({ BranchId: 'annex' })]]);
  const loaded = await f.run('list');
  assert.equal(loaded.loans.length, 0);
  assert.equal(loaded.copies[0].DisplayStatus, 'Status needs review');
});

test('explicit stale sample correction preserves reservation, old link and audit history', async () => {
  const pending = { ReservationId: 'RES-1', TitleId: 'TITLE-1', BranchId: 'main', Status: 'Pending' };
  const f = fixture([['libraryCopies', copy().CopyId, copy({ Status: 'On Loan', CurrentLoanId: 'SAMPLE-LOAN' })],
    ['libraryReservations', 'RES-1', pending]]);
  await f.run('repairCopyStatus', { CopyId: copy().CopyId, ConfirmNoActiveLoan: true, Note: 'Stale sample checkout confirmed by administrator' });
  const saved = f.store.get('libraryCopies/main--LIB-0001');
  assert.equal(saved.Status, 'Available');
  assert.equal(saved.PreviousLoanId, 'SAMPLE-LOAN');
  assert.equal(f.store.get('libraryReservations/RES-1').Status, 'Pending');
  assert.equal(f.commits[0].length, 2);
  assert.equal(f.commits[0][1].data.Action, 'Repair stale copy checkout status');
});

test('status repair requires confirmation, reason, authorised role, writable subscription and branch', async () => {
  const f = fixture([['libraryCopies', copy().CopyId, copy({ Status: 'On Loan' })]]);
  const body = { CopyId: copy().CopyId, ConfirmNoActiveLoan: true, Note: 'Sample record' };
  await assert.rejects(f.run('repairCopyStatus', { ...body, ConfirmNoActiveLoan: false }), /Confirm/);
  await assert.rejects(f.run('repairCopyStatus', { ...body, Note: '' }), /reason/);
  await assert.rejects(f.run('repairCopyStatus', body, { ...actor, role: 'Teacher' }), /authorised/);
  await assert.rejects(f.run('repairCopyStatus', body, { ...actor, subscriptionReadOnly: true }), /read-only/);
  await assert.rejects(f.run('repairCopyStatus', { ...body, BranchId: 'annex' }), /another branch/);
  assert.equal(f.commits.length, 0);
});

test('status repair cannot erase an active, conflicting, damaged or lost loan', async () => {
  for (const status of ['On Loan', 'Lost', 'Damaged']) {
    const f = fixture([['libraryCopies', copy().CopyId, copy({ Status: 'On Loan', CurrentLoanId: 'LOAN-1' })],
      ['libraryLoans', 'LOAN-1', loan({ Status: status })]]);
    await assert.rejects(f.run('repairCopyStatus', { CopyId: copy().CopyId, ConfirmNoActiveLoan: true, Note: 'Test' }), /needs review/);
    assert.equal(f.commits.length, 0);
  }
  const f = fixture([['libraryCopies', copy().CopyId, copy({ Status: 'On Loan', CurrentLoanId: 'MISSING' })],
    ['libraryLoans', 'LOAN-1', loan()]]);
  await assert.rejects(f.run('repairCopyStatus', { CopyId: copy().CopyId, ConfirmNoActiveLoan: true, Note: 'Test' }), /needs review/);
});

test('normal return keeps pending reservations and lost/damaged returns do not become available', async () => {
  for (const outcome of ['Returned', 'Damaged', 'Lost']) {
    const f = fixture([['libraryCopies', copy().CopyId, copy()]]);
    const issued = await f.run('checkout', { CopyId: copy().CopyId, BorrowerType: 'Student', BorrowerRef: 'TEST/001' });
    await f.run('reserve', { TitleId: 'TITLE-1', BorrowerType: 'Student', BorrowerRef: 'TEST/002' });
    await f.run('return', { LoanId: issued.loan.LoanId, Outcome: outcome });
    const data = await f.run('list');
    assert.equal(data.copies[0].DisplayStatus, outcome === 'Returned' ? 'Reserved' : outcome);
    assert.equal(data.summary.Reservations, 1);
  }
});
