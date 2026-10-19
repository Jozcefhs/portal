import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleManualPaymentCorrection } from '../functions/lib/manual-payment-corrections.js';
import { schoolInvoiceCreditJournalGap, summarizeWalletActivity, calculateAccountFinancialSummary,
  payableLedgerAfterPaymentCorrections, buildSchoolInvoiceCreditAutomaticJournal,
  correctedPayableInvoices, correctedInvoicePaidAmount } from '../functions/api/backend.js';
import { paymentHistoryForChild } from '../functions/api/parent-dashboard.js';

const user = { username: 'accountant', role: 'Accounts Officer', assignedRole: 'Accounts Officer', edition: 'school',
  branchId: 'main', schoolSectionAccess: 'All', allowedSections: ['accounts'] };
const request = { Reference: 'MANUAL-1', Kind: 'reduce', CorrectAmount: 10000, Reason: 'Proof shows 10000, not 14000', OperationId: 'test-operation-0001' };
function fixture(wallet = true) {
  const db = new Map(); let commits = 0, serial = 1;
  const add = (collection, id, row) => { db.set(`${collection}/${id}`, { ...row, __id: id, __updateTime: `v${serial++}` }); };
  const scope = { AccountRef: 'S1', AdmissionNo: 'S1', BranchId: 'main', SchoolSection: 'secondary' };
  const source = { ...scope, DisplayName: 'Source Student', ClassName: 'Grade 9', __scopePath: 'students', AcademicSession: '2026/2027', Term: 'First Term' };
  add('students', 'S1', source);
  add('students', 'S2', { ...source, AccountRef: 'S2', AdmissionNo: 'S2', DisplayName: 'Correct Student' });
  const fee = { FeeCode: wallet ? 'WALLET_TOPUP' : 'SCHOOL_FEES_TOTAL', FeeCategory: wallet ? 'Wallet' : 'School Fee' };
  add('payments', 'MANUAL-1', { ...scope, ...fee, Amount: 14000, Gateway: 'Manual', Method: 'Bank Transfer', Currency: 'NGN',
    Status: 'Paid', ProcessingStatus: 'Completed', Reference: 'MANUAL-1', PaidAt: '2026-10-10T10:00:00Z' });
  add('ledger', 'LED-MANUAL-1', { ...scope, ...fee, LedgerNo: 'LED-MANUAL-1', Reference: 'MANUAL-1', Credit: 14000, Debit: 0,
    EntryType: wallet ? 'Wallet Deposit' : 'Payment' });
  add('accountingJournals', 'SYS-PAY-MANUAL-1', { BranchId: 'main', Source: 'Fee Payment', SourceId: 'MANUAL-1',
    JournalNo: 'SYS-PAY-MANUAL-1', Status: 'Posted', Reference: 'MANUAL-1',
    Lines: [{ AccountCode: '1020', Debit: 14000, Credit: 0 }, { AccountCode: wallet ? '2200' : '2310', Credit: 14000, Debit: 0 }] });
  if (!wallet) {
    add('invoices', 'INV1', { ...scope, InvoiceId: 'INV1', Amount: 14000, Debit: 14000, Credit: 14000, Balance: 0,
      FeeCode: 'TUITION', FeeCategory: 'School Fee', Status: 'Paid', Date: '2026-10-01' });
    add('accountingJournals', 'APPLY1', { ...scope, JournalNo: 'APPLY1', Status: 'Posted', Source: 'Student Invoice Credit', SourceId: 'INV1',
      Lines: [{ AccountCode: '2310', Debit: 14000, Credit: 0 }, { AccountCode: '1100', Credit: 14000, Debit: 0 }] });
  }
  const rows = collection => [...db].filter(([key]) => key.startsWith(`${collection}/`)).map(([, row]) => structuredClone(row));
  const io = {
    get: async (_env, c, id) => structuredClone(db.get(`${c}/${id}`) || null),
    query: async (_env, c, options) => rows(c).filter(row => {
      const matches = options.filters.map(f => f.op === '==' ? row[f.field] === f.value : false);
      return options.filterJoin === 'OR' ? matches.some(Boolean) : matches.every(Boolean);
    }),
    list: async (_env, c) => rows(c),
    student: async (_env, ref) => structuredClone(db.get(`students/${ref}`) || null),
    rows: async (_env, c, ref) => rows(c).filter(row => row.AccountRef === ref),
    wallet: async (_env, student) => ({ ...student, WalletCardStatus: student.WalletCardStatus || 'Active',
      WalletBalance: summarizeWalletActivity(rows('ledger'), student.AccountRef).balance }),
    chart: async () => [{ Code: '1020', Type: 'Asset', Group: 'Cash and Bank' }, { Code: '2200', Type: 'Liability' },
      { Code: '2310', Type: 'Liability' }, { Code: '1100', Type: 'Asset' }],
    authorize: async () => true, now: () => new Date('2026-10-13T11:00:00Z'),
    commit: async (_env, writes) => {
      const keys = writes.map(w => `${w.collectionPath}/${w.documentId}`);
      assert.equal(new Set(keys).size, keys.length, 'no duplicate write targets');
      for (const w of writes) {
        const prior = db.get(`${w.collectionPath}/${w.documentId}`);
        if ((w.exists === false && prior) || (w.updateTime && prior?.__updateTime !== w.updateTime)) throw Object.assign(new Error('conflict'), { status: 409 });
      }
      for (const w of writes) add(w.collectionPath, w.documentId, { ...(w.updateMask ? db.get(`${w.collectionPath}/${w.documentId}`) : {}), ...w.data });
      commits++;
    }
  };
  const call = (action, body = {}, actor = user) => handleManualPaymentCorrection({}, actor, { ...request, ...body, action }, io);
  const post = async (body = {}) => { const preview = await call('preview', body); return call('post', { ...body, PreviewDigest: preview.PreviewDigest }); };
  return { db, rows, io, call, post, add, commits: () => commits };
}

test('receipt lookup distinguishes original amount from the live wallet balance without writes', async () => {
  const f = fixture();
  f.add('ledger', 'OTHER', { AccountRef: 'S1', FeeCategory: 'Wallet', Credit: 31000, Debit: 750 });
  f.add('accountSummaries', 'S1', { AccountRef: 'S1', BranchId: 'main', SchoolSection: 'secondary', WalletBalance: 999999 });
  const result = await f.call('lookup');
  assert.equal(result.Receipt.OriginalAmount, 14000);
  assert.equal(result.Receipt.CurrentWalletBalance, 44250);
  assert.equal(result.Receipt.RemainingAmount, 14000);
  assert.equal(f.commits(), 0);
  const preview = await f.call('preview');
  assert.equal(preview.Receipt.CurrentWalletBalance, preview.BalanceBefore);
  assert.equal(preview.BalanceBefore, 44250);
});

test('lookup represents a zero balance explicitly and does not substitute a value on read failure', async () => {
  const f = fixture(); f.add('ledger', 'SPENT', { AccountRef: 'S1', FeeCategory: 'Wallet', Debit: 14000 });
  assert.equal((await f.call('lookup')).Receipt.CurrentWalletBalance, 0);
  f.io.wallet = async () => { throw new Error('Wallet unavailable'); };
  await assert.rejects(f.call('lookup'), /Wallet unavailable/);
  assert.equal(f.commits(), 0);
  const school = fixture(false);
  school.io.wallet = async () => { throw new Error('Must not read a wallet for school fees'); };
  assert.equal(Object.hasOwn((await school.call('lookup')).Receipt, 'CurrentWalletBalance'), false);
});

test('lookup rejects an out-of-scope receipt before reading any wallet balance', async () => {
  const f = fixture(); let reads = 0;
  f.db.get('payments/MANUAL-1').BranchId = 'other';
  f.io.wallet = async () => { reads++; return { WalletBalance: 999 }; };
  await assert.rejects(f.call('lookup'), /branch/);
  assert.equal(reads, 0);
});

test('14000 wallet receipt reduced to 10000 leaves original and a linked 4000 reversal', async () => {
  const f = fixture(); const before = await f.call('preview');
  assert.equal(f.commits(), 0); assert.equal(before.Amount, 4000); assert.equal(before.BalanceAfter, 10000);
  const result = await f.post();
  assert.equal(f.commits(), 1); assert.equal(result.RemainingAmount, 10000);
  assert.equal(f.db.get('payments/MANUAL-1').Amount, 14000);
  assert.equal(f.db.get('ledger/LED-MANUAL-1').Credit, 14000);
  assert.equal(summarizeWalletActivity(f.rows('ledger'), 'S1').balance, 10000);
  const j = f.rows('accountingJournals').find(row => row.Source === 'Manual Payment Correction');
  assert.deepEqual(j.Lines.map(l => [l.AccountCode, l.Debit, l.Credit]), [['2200', 4000, 0], ['1020', 0, 4000]]);
  assert.equal(f.rows('accountingAudit')[0].ActorUsername, 'accountant');
  assert.equal(f.rows('accountingAudit')[0].Action, 'Reduce manual wallet top-up receipt');
  assert.match(f.rows('accountingAudit')[0].Summary, /4,000.00 removed from student S1's wallet/);
});
test('move corrects both wallets atomically without changing cash or creating another receipt', async () => {
  const f = fixture(); const result = await f.post({ Kind: 'move', TargetAccountRef: 'S2' });
  assert.equal(result.Target.AccountRef, 'S2'); assert.equal(f.commits(), 1);
  assert.equal(summarizeWalletActivity(f.rows('ledger'), 'S1').balance, 0);
  assert.equal(summarizeWalletActivity(f.rows('ledger'), 'S2').balance, 14000);
  assert.equal(f.rows('payments').length, 1);
  const j = f.rows('accountingJournals').find(row => row.Source === 'Manual Payment Correction');
  assert.deepEqual(j.Lines.map(l => l.AccountCode), ['2200', '2200']);
});

test('existing wallet summaries are corrected in the same commit for both students', async () => {
  const f = fixture();
  for (const ref of ['S1', 'S2']) f.add('accountSummaries', ref, { AccountRef: ref, BranchId: 'main', SchoolSection: 'secondary',
    WalletBalance: ref === 'S1' ? 14000 : 0, OutstandingBalance: 1234 });
  await f.post({ Kind: 'move', TargetAccountRef: 'S2' });
  assert.equal(f.db.get('accountSummaries/S1').WalletBalance, 0);
  assert.equal(f.db.get('accountSummaries/S2').WalletBalance, 14000);
  assert.equal(f.db.get('accountSummaries/S1').OutstandingBalance, 1234);
  assert.equal(f.commits(), 1);
});

test('pay-now uses net invoice allocation after a corrected total receipt spans two fees', () => {
  const invoices = [
    { InvoiceId: 'A', FeeCode: 'A', FeeCategory: 'School Fee', Debit: 7000, Credit: 7000 },
    { InvoiceId: 'B', FeeCode: 'B', FeeCategory: 'School Fee', Debit: 7000, Credit: 3000, PaymentCorrectionReleasedCredit: 4000 }
  ];
  const ledger = [{ FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee', Credit: 14000, CorrectionTotal: 4000 },
    { FeeCategory: 'Account Credit', Debit: 4000 }];
  const corrected = correctedPayableInvoices(invoices, ledger);
  assert.equal(correctedInvoicePaidAmount(corrected, invoices[0]), 7000);
  assert.equal(correctedInvoicePaidAmount(corrected, invoices[1]), 3000);
  // A later genuine receipt can pay the reopened balance without removing audit history.
  ledger.push({ FeeCode: 'SCHOOL_FEES_TOTAL', FeeCategory: 'School Fee', Credit: 4000 });
  assert.equal(correctedInvoicePaidAmount(correctedPayableInvoices(invoices, ledger), invoices[1]), 7000);
  assert.equal(correctedPayableInvoices(invoices, []), null);
});

test('imported invoice aliases remain consistent after school payment correction', async () => {
  const f = fixture(false);
  f.add('invoices', 'INV1', { ...f.db.get('invoices/INV1'), paidAmount: 14000, balanceAmount: 0, status: 'Paid' });
  await f.post();
  const row = f.db.get('invoices/INV1');
  assert.equal(row.Credit, 10000); assert.equal(row.paidAmount, 10000);
  assert.equal(row.Balance, 4000); assert.equal(row.balanceAmount, 4000);
  assert.equal(row.status, 'Part Paid');
  assert.equal(calculateAccountFinancialSummary([row], f.rows('ledger'), 'S1').OutstandingBalance, 4000);
});
test('full reversal and partial reductions can each occur only once per instruction', async () => {
  const f = fixture(); const first = await f.post();
  const replay = await f.call('post', { PreviewDigest: 'lost-response-retry' });
  assert.equal(replay.replayed, true); assert.equal(f.commits(), 1);
  await assert.rejects(f.call('post', { CorrectAmount: 9000 }), /different details/);
  await f.post({ Kind: 'reverse', OperationId: 'test-operation-0002' });
  assert.equal(f.commits(), 2); assert.equal(summarizeWalletActivity(f.rows('ledger'), 'S1').balance, 0);
  await assert.rejects(f.call('preview', { Kind: 'reverse', OperationId: 'test-operation-0003' }), /fully corrected/);
  assert.ok(first.CorrectionId);
});
test('spent wallet money cannot be forcibly reversed; partial correction can use remaining funds', async () => {
  const f = fixture(); f.add('ledger', 'SPENT', { AccountRef: 'S1', FeeCategory: 'Wallet', Debit: 11000, Credit: 0 });
  await assert.rejects(f.post(), /insufficient/); assert.equal(f.commits(), 0);
  await f.post({ CorrectAmount: 12000 });
  assert.equal(summarizeWalletActivity(f.rows('ledger'), 'S1').balance, 1000);
});
test('school-fee excess reopens settled invoice by 4000 and survives journal-gap reconciliation', async () => {
  const f = fixture(false); const preview = await f.call('preview');
  assert.equal(preview.SchoolFees.After.OutstandingBalance, 4000);
  await f.post();
  const invoice = f.db.get('invoices/INV1');
  assert.equal(invoice.Credit, 10000); assert.equal(invoice.Balance, 4000); assert.equal(invoice.Status, 'Part Paid');
  assert.equal(f.db.get('payments/MANUAL-1').Amount, 14000);
  assert.equal(f.db.get('accountSummaries/S1').OutstandingBalance, 4000);
  assert.equal(schoolInvoiceCreditJournalGap(invoice, f.rows('accountingJournals')).missing, 0);
  assert.equal(calculateAccountFinancialSummary(f.rows('invoices'), f.rows('ledger'), 'S1').OutstandingBalance, 4000);
  const payable = payableLedgerAfterPaymentCorrections(f.rows('ledger'));
  assert.equal(payable.length, 1); assert.equal(payable[0].Credit, 10000);
  const child = { SourceType: 'Student', Status: 'Active', AccountRef: 'S1', AdmissionNo: 'S1' };
  const history = paymentHistoryForChild(child, f.rows('payments'), f.rows('ledger'));
  assert.equal(history.filter(row => row.RecordType === 'Payment correction').length, 1);
  assert.equal(history.find(row => row.RecordType === 'Payment').CorrectionTotal, 4000);
  await f.post({ CorrectAmount: 8000, OperationId: 'test-operation-0002' });
  assert.equal(f.db.get('invoices/INV1').Credit, 8000);
  assert.equal(schoolInvoiceCreditJournalGap(f.db.get('invoices/INV1'), f.rows('accountingJournals')).missing, 0);
});
test('automatic fee allocation uses a new identity after a correction releases the same amount', () => {
  const invoice = { InvoiceId: 'I1', FeeCategory: 'School Fee', Amount: 14000, Credit: 10000 };
  const original = buildSchoolInvoiceCreditAutomaticJournal(invoice, 10000, 14000, '2026-10-13');
  const later = buildSchoolInvoiceCreditAutomaticJournal({ ...invoice, PaymentCorrectionReleasedCredit: 4000 }, 10000, 14000, '2026-10-14');
  assert.notEqual(original.JournalNo, later.JournalNo);
});
test('unallocated school advance is reduced without reopening an invoice unnecessarily', async () => {
  const f = fixture(false); f.db.delete('invoices/INV1'); f.db.delete('accountingJournals/APPLY1');
  const result = await f.post();
  assert.equal(result.SchoolFees.Invoices.length, 0);
  assert.equal(result.SchoolFees.After.CreditBalance, 10000);
});
test('school fee credit transferred away cannot be removed again', async () => {
  const f = fixture(false); f.db.delete('invoices/INV1'); f.db.delete('accountingJournals/APPLY1');
  f.add('ledger', 'TRANSFER', { AccountRef: 'S1', FeeCategory: 'Account Credit', Debit: 12000, Credit: 0 });
  await assert.rejects(f.post(), /already been transferred/); assert.equal(f.commits(), 0);
});
test('school fee receipt cannot be moved using wallet transfer', async () => {
  const f = fixture(false); await assert.rejects(f.post({ Kind: 'move', TargetAccountRef: 'S2' }), /wallet top-ups only/);
});
for (const [name, change, message] of [
  ['online payment', f => { f.db.get('payments/MANUAL-1').Gateway = 'Paystack'; }, /manual payments/],
  ['unfinished payment', f => { f.db.get('payments/MANUAL-1').ProcessingStatus = 'Processing'; }, /completed manual/],
  ['incorrect ledger amount', f => { f.db.get('ledger/LED-MANUAL-1').Credit = 16000; }, /do not agree/],
  ['foreign branch', f => { f.db.get('payments/MANUAL-1').BranchId = 'other'; }, /branch/],
  ['missing source version', f => { delete f.db.get('students/S1').__updateTime; }, /version/],
  ['closed current period', f => f.add('accountingPeriods', 'CLOSED', { Status: 'Closed', StartDate: '2026-10-01', EndDate: '2026-10-31' }), /period is closed/],
  ['existing journal reversal', f => f.add('accountingJournals', 'REV', { ReversalOf: 'SYS-PAY-MANUAL-1', Status: 'Posted' }), /already been reversed/]
]) test(`${name} is blocked without writes`, async () => {
  const f = fixture(); change(f); await assert.rejects(f.post(), message); assert.equal(f.commits(), 0);
});
for (const [name, actor] of [
  ['vendor', { ...user, role: 'Vendor User', assignedRole: 'Vendor User' }],
  ['not accounts enabled', { ...user, allowedSections: [] }],
  ['faith edition', { ...user, edition: 'faith' }],
  ['all branches', { ...user, branchId: 'all' }]
]) test(`${name} cannot access correction`, async () => {
  const f = fixture(); await assert.rejects(f.call('lookup', {}, actor), error => error.status === 403);
});
test('unauthorised password and read-only accounts cannot post', async () => {
  const f = fixture(); f.io.authorize = async () => false;
  await assert.rejects(f.post(), error => error.status === 403);
  f.io.authorize = async () => true;
  await assert.rejects(f.call('post', {}, { ...user, subscriptionReadOnly: true }), error => error.status === 403);
});
test('target cannot be same student, blocked wallet or outside authorised branch/section', async () => {
  const f = fixture();
  await assert.rejects(f.post({ Kind: 'move', TargetAccountRef: 'S1' }), /different student/);
  f.db.get('students/S2').WalletCardStatus = 'Blocked';
  await assert.rejects(f.post({ Kind: 'move', TargetAccountRef: 'S2' }), /not active/);
  f.db.get('students/S2').WalletCardStatus = 'Active'; f.db.get('students/S2').BranchId = 'other';
  await assert.rejects(f.post({ Kind: 'move', TargetAccountRef: 'S2' }), /branch/);
  f.db.get('students/S2').BranchId = 'main';
  await assert.rejects(f.call('preview', { Kind: 'move', TargetAccountRef: 'S2', TargetSchoolSection: 'primary' },
    { ...user, schoolSectionAccess: 'secondary' }), /school section/);
});
test('changed wallet since preview cannot post', async () => {
  const f = fixture(); const preview = await f.call('preview');
  f.add('students', 'S1', { ...f.db.get('students/S1'), WalletLastPurchaseNo: 'concurrent' });
  await assert.rejects(f.call('post', { PreviewDigest: preview.PreviewDigest }), /changed after preview/);
  assert.equal(f.commits(), 0);
});
test('concurrent write failure leaves every balance and receipt unchanged', async () => {
  const f = fixture(); const preview = await f.call('preview'); const prior = structuredClone([...f.db]);
  f.io.commit = async () => { throw Object.assign(new Error('concurrent write'), { status: 412 }); };
  await assert.rejects(f.call('post', { PreviewDigest: preview.PreviewDigest }), /No partial correction/);
  assert.deepEqual([...f.db], prior);
});
test('invalid amounts, missing reason and oversized amounts are rejected', async () => {
  const f = fixture();
  for (const CorrectAmount of [-1, 15000, 14000, 'NaN', 'Infinity', '10000.001']) await assert.rejects(f.post({ CorrectAmount }));
  await assert.rejects(f.post({ Reason: '' }), /reason/);
  assert.equal(f.commits(), 0);
});
test('missing invoice allocation journal blocks school correction instead of silently changing totals', async () => {
  const f = fixture(false); f.db.delete('accountingJournals/APPLY1');
  await assert.rejects(f.post(), /reconciliation/); assert.equal(f.commits(), 0);
});
test('UI and desktop API use protected correction paths and source retries preserve corrections', () => {
  const backend = readFileSync(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const frontend = readFileSync(new URL('../js/payment-corrections.js', import.meta.url), 'utf8');
  assert.match(backend, /VERIFIED_ACTOR_ACTIONS = new Set\(\[[^\]]*'manualPaymentCorrection'/);
  assert.match(backend, /BRANCH_BOUND_DEVICE_ACTIONS = new Set\(\[[^\]]*'manualPaymentCorrection'/);
  assert.match(backend, /if \(payment\?\.LastCorrectionId\) return/);
  assert.match(frontend, /const input = values\(\);/);
  assert.match(frontend, /PreviewDigest: preview.data.PreviewDigest/);
  assert.match(frontend, /const operationId = crypto.randomUUID\(\)/);
});
