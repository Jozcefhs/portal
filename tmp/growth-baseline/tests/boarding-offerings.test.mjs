import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { handleBoardingOfferings, isOfferingBoarder, offeringCents, offeringScope, OFFERING_COLLECTION, OFFERING_BATCH_SIZE } from '../functions/lib/boarding-offerings.js';
import { summarizeWalletActivity, buildWalletPurchaseAccountingJournal } from '../functions/api/backend.js';

const user = { username: 'accountant', role: 'Accounts Officer', edition: 'school', branchId: 'main', schoolSectionAccess: 'All', allowedSections: ['accounts'] };
const env = { BACKEND_SHARED_SECRET: 'test-only-preview-and-pin-secret' };
const path = 'schoolBranches/main/sections/secondary/students';
const copy = value => structuredClone(value);
function fixture(count = 2) {
  const store = new Map(), commits = [], reads = []; let version = 1, conflict = false, authorized = true;
  const put = (collection, id, row) => store.set(`${collection}/${id}`, { ...copy(row), __id: id, __updateTime: `v${version++}` });
  const list = collection => [...store].filter(([key]) => key.slice(0, key.lastIndexOf('/')) === collection).map(([, row]) => copy(row));
  const chart = [{ Code: '2200', Name: 'Student Wallet Liability', Type: 'Liability', Group: 'Student Wallets' },
    { Code: '2000', Name: 'Accounts Payable', Type: 'Liability', Group: 'Payables' },
    { Code: '1020', Name: 'Bank', Type: 'Asset', Group: 'Cash and Bank' },
    { Code: '4040', Name: 'School Store Revenue', Type: 'Revenue', Group: 'Operating Revenue' }];
  const addStudent = (id, overrides = {}, collection = path) => {
    const row = { AdmissionNo: id, DisplayName: `Boarder ${id}`, ClassName: 'Grade 7', BranchId: 'main', SchoolSection: 'secondary',
      StudentType: 'Boarding Student', Status: 'Active', WalletCardStatus: 'Active', OpeningWallet: 1000, WalletPinThreshold: 0, WalletTxnLimit: 0, WalletDailyLimit: 0, ...overrides };
    put(collection, id, row); return row;
  };
  for (let i = 0; i < count; i++) addStudent(`DCA-${String(i + 1).padStart(3, '0')}`);
  const deps = {
    get: async (_env, collection, id) => { reads.push({ collection, id }); return copy(store.get(`${collection}/${id}`) || null); },
    list: async (_env, collection) => list(collection),
    paths: async () => ['students', path, 'schoolBranches/main/sections/primary/students'],
    chart: async () => chart,
    query: async (_env, collection, options) => list(collection).filter(row => options.filters.every(f => row[f.field] === f.value)),
    authorize: async () => authorized,
    wallet: async (_env, student) => ({ ...student, AccountRef: student.AdmissionNo, WalletCardStatus: student.WalletCardStatus || 'Active',
      WalletBalance: student.OpeningWallet + list('ledger').filter(row => row.AccountRef === student.AdmissionNo).reduce((sum, row) => sum + row.Credit - row.Debit, 0),
      WalletSpentToday: list('ledger').filter(row => row.AccountRef === student.AdmissionNo).reduce((sum, row) => sum + row.Debit, 0) }),
    commit: async (_env, writes) => {
      if (conflict) throw Object.assign(new Error('Concurrent write'), { status: 409 });
      for (const write of writes) {
        const current = store.get(`${write.collectionPath}/${write.documentId}`);
        if ((write.exists === false && current) || (write.updateTime && write.updateTime !== current?.__updateTime)) throw Object.assign(new Error('Version mismatch'), { status: 409 });
      }
      commits.push(copy(writes));
      for (const write of writes) {
        const current = store.get(`${write.collectionPath}/${write.documentId}`);
        const data = write.updateMask ? { ...current, ...write.data } : write.data;
        put(write.collectionPath, write.documentId, data);
      }
    }
  };
  const run = (body, actor = user) => handleBoardingOfferings(env, actor, body, deps);
  const input = (overrides = {}) => ({ Reference: 'CHAPEL-20261010', Date: '2026-10-10', ServiceName: 'Sunday service', ChurchName: 'Receiving church',
    PayableAccount: '2000', Notes: 'Authorised instruction', Rows: list(path).map(row => ({ StudentKey: `secondary|${row.AdmissionNo.toLowerCase()}`, StudentDocumentId: row.__id, Amount: 100 })), ...overrides });
  const start = async (body = input()) => {
    const sorted = [...body.Rows].sort((a, b) => a.StudentKey.localeCompare(b.StudentKey)), PreviewTokens = [];
    for (let offset = 0; offset < sorted.length; offset += OFFERING_BATCH_SIZE) {
      const result = await run({ ...body, action: 'preview', Rows: sorted.slice(offset, offset + OFFERING_BATCH_SIZE) });
      assert.equal(result.Ready, true); PreviewTokens.push(result.PreviewToken);
    }
    return run({ ...body, action: 'start', PreviewTokens, Authorized: true, approvalPassword: 'not-stored' });
  };
  return { store, chart, put, list, addStudent, deps, run, input, start, commits, reads,
    setConflict: value => { conflict = value; }, setAuthorized: value => { authorized = value; } };
}

test('offering amounts reject negative, nonfinite, over-precise or excessive inputs', () => {
  assert.equal(offeringCents('12.34'), 1234); assert.equal(offeringCents(0), 0);
  for (const value of [-1, NaN, Infinity, '1e3', '1,000', '0.001', '10000001', '', {}]) assert.throws(() => offeringCents(value));
});
test('boarder detection honours saved canonical profile values and excludes inactive / non-boarding students', () => {
  for (const type of ['Boarding Student', 'Boarder', 'Hostel', 'Resident']) assert.equal(isOfferingBoarder({ StudentType: type }), true);
  for (const type of ['Non-boarding', 'Non Boarding Student', 'Day Student', '', 'Not boarding']) assert.equal(isOfferingBoarder({ StudentType: type }), false, type);
  assert.equal(isOfferingBoarder({ StudentType: 'Day Student', studentType: 'Boarding Student' }), false);
  assert.equal(isOfferingBoarder({ StudentType: 'Boarding Student', Status: 'Withdrawn' }), false);
});
test('only accountant / director / superadmin school accounts in one branch may access offerings', () => {
  for (const role of ['Accounts Officer', 'Director', 'Super Admin']) assert.equal(offeringScope({ ...user, role }).BranchId, 'main');
  for (const change of [{ role: 'Vendor User' }, { role: 'Teacher' }, { role: 'Management' }, { edition: 'faith' }, { edition: 'organization' }, { allowedSections: [] }, { branchId: '' }, { branchId: 'all' }, { username: '' }]) assert.throws(() => offeringScope({ ...user, ...change }), error => error.status === 403);
});
test('roster is scoped, deduplicated, active boarders only and contains no credentials or parent information', async () => {
  const f = fixture(); f.addStudent('DAY', { StudentType: 'Day Student' }); f.addStudent('LEFT', { Status: 'Withdrawn' });
  f.addStudent('FOREIGN', { BranchId: 'other' }, 'students'); f.addStudent('PROTECTED', { WalletPinHash: 'secret', ParentEmail: 'private@example.test', ParentLoginCode: 'private-code' });
  f.addStudent('PRIMARY', { SchoolSection: 'primary', ClassName: 'Primary 4' }, 'schoolBranches/main/sections/primary/students');
  const result = await f.run({ action: 'bootstrap' }, { ...user, schoolSectionAccess: 'Secondary' });
  assert.equal(result.Students.length, 3); assert.doesNotMatch(JSON.stringify(result), /secret|private@example|private-code/);
  assert.ok(result.Students.every(row => row.SchoolSection === 'secondary'));
  assert.deepEqual(result.PayableAccounts.map(row => row.Code), ['2000']);
  assert.equal(f.commits.length, 0);
  f.chart[0].Group = 'Payables';
  await assert.rejects(f.run({ ...f.input(), action: 'preview', Rows: f.input().Rows.slice(0, 1), PayableAccount: '2200' }), /Choose an active Payables/);
});
test('preview is read-only, reports individual balances, signs ready amounts and rejects unknown / repeated students', async () => {
  const f = fixture(), body = f.input(); const result = await f.run({ ...body, action: 'preview' });
  assert.equal(result.Ready, true); assert.equal(result.Total, 200); assert.equal(result.Rows[0].BalanceAfter, 900); assert.ok(result.PreviewToken);
  assert.equal(f.commits.length, 0); assert.doesNotMatch(JSON.stringify(result), /StudentPath|StudentVersion|StudentId|PinHash/);
  await assert.rejects(f.run({ ...body, action: 'preview', Rows: [body.Rows[0], body.Rows[0]] }), /once/);
  await assert.rejects(f.run({ ...body, action: 'preview', Rows: [{ StudentKey: 'secondary|nonexistent', StudentDocumentId: 'nonexistent', Amount: 100 }] }), /no longer/);
});

test('preview reads only selected document IDs and treats client IDs as untrusted lookup hints', async () => {
  const f = fixture(100), row = f.input().Rows[0];
  const originalList = f.deps.list;
  f.deps.list = async (env, collection) => {
    assert.ok(!collection.endsWith('students'), 'preview must not list the school roster');
    return originalList(env, collection);
  };
  const result = await f.run({ ...f.input(), action: 'preview', Rows: [row] });
  assert.equal(result.Ready, true);
  assert.equal(f.reads.filter(read => read.collection.endsWith('students')).length, 3);
  await assert.rejects(f.run({ ...f.input(), action: 'preview', Rows: [{ ...row, StudentDocumentId: 'DCA-002' }] }), /no longer/);
  await assert.rejects(f.run({ ...f.input(), action: 'preview', Rows: [{ ...row, StudentDocumentId: '../other' }] }), /no longer/);
  f.addStudent('FOREIGN', { BranchId: 'other' }, 'students');
  await assert.rejects(f.run({ ...f.input(), action: 'preview', Rows: [{ StudentKey: 'secondary|foreign', StudentDocumentId: 'FOREIGN', Amount: 100 }] }), /no longer/);
});
test('insufficient / inactive / transaction-limited / daily-limited / invalid wallets cannot produce a ready preview', async () => {
  for (const change of [{ OpeningWallet: 99 }, { WalletCardStatus: 'Blocked' }, { WalletCardStatus: 'Lost' }, { WalletTxnLimit: 99 }, { WalletDailyLimit: 99 }]) {
    const f = fixture(1); f.addStudent('DCA-001', change);
    const result = await f.run({ ...f.input(), action: 'preview' }); assert.equal(result.Ready, false); assert.equal(result.PreviewToken, ''); assert.ok(result.Rows[0].Errors.length); assert.equal(f.commits.length, 0);
  }
  const f = fixture(1); f.addStudent('DCA-001', { WalletTxnLimit: 'invalid' });
  await assert.rejects(f.run({ ...f.input(), action: 'preview' }), /restrictions are invalid/);
});
test('PIN protected offerings require the existing wallet PIN and never persist or echo it', async () => {
  const f = fixture(1), hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.BACKEND_SHARED_SECRET}:1234`));
  f.addStudent('DCA-001', { WalletPinHash: Buffer.from(hash).toString('hex'), WalletPinThreshold: 50 });
  const body = f.input(); assert.equal((await f.run({ ...body, action: 'preview' })).Ready, false);
  body.Rows[0].Pin = '1234'; const result = await f.run({ ...body, action: 'preview' }); assert.equal(result.Ready, true);
  const started = await f.start(body); await f.run({ action: 'postNext', ServiceId: started.Service.ServiceId, Offset: 0, Rows: body.Rows, Authorized: true });
  assert.doesNotMatch(JSON.stringify(f.list(OFFERING_COLLECTION)), /1234|PinHash|not-stored/);
  assert.doesNotMatch(JSON.stringify(f.list('ledger')), /1234|PinHash/);
});
test('preview signatures bind student amounts, service details, staff and scope', async () => {
  const f = fixture(), body = f.input(); const p = await f.run({ ...body, action: 'preview' });
  for (const change of [{ ChurchName: 'Different church' }, { PayableAccount: '4040' }, { Rows: [{ ...body.Rows[0], Amount: 999 }] }, { Reference: 'DIFFERENT' }])
    await assert.rejects(f.run({ ...body, ...change, action: 'start', PreviewTokens: [p.PreviewToken], Authorized: true }), /changed/);
  await assert.rejects(f.run({ ...body, action: 'start', PreviewTokens: [p.PreviewToken], Authorized: true }, { ...user, username: 'another-accountant' }), /changed/);
  assert.equal(f.commits.length, 0);
});
test('missing preview, expired signatures, consent, password and read-only subscription all block writes', async () => {
  const f = fixture(), body = f.input();
  await assert.rejects(f.run({ ...body, action: 'start', Authorized: false }), error => error.status === 403);
  await assert.rejects(f.run({ ...body, action: 'start', Authorized: true }), /Preview every/);
  await assert.rejects(f.run({ ...body, action: 'start', Authorized: true, PreviewTokens: [`1000000000000.${'a'.repeat(64)}`] }), /expired/);
  f.setAuthorized(false); await assert.rejects(f.run({ ...body, action: 'start', Authorized: true }), error => error.status === 403);
  f.setAuthorized(true); await assert.rejects(f.run({ ...body, action: 'start', Authorized: true }, { ...user, subscriptionReadOnly: true }), /read-only/);
  assert.equal(f.commits.length, 0);
});
test('deductions atomically create student ledger, payable journal, wallet guard, progress and audit; retry never repeats a student', async () => {
  const f = fixture(), { Service } = await f.start();
  assert.equal(f.list('ledger').length, 0); assert.equal(Service.PostedCount, 0);
  const body = { action: 'postNext', ServiceId: Service.ServiceId, Offset: 0, Authorized: true };
  const posted = await f.run(body); assert.equal(posted.Service.Collected, 200); assert.equal(posted.Service.Outstanding, 200);
  assert.equal(f.list('ledger').length, 2); assert.equal(f.list('accountingJournals').length, 2);
  for (const j of f.list('accountingJournals')) { assert.deepEqual(j.Lines.map(line => line.AccountCode), ['2200', '2000']); assert.equal(j.TotalDebit, j.TotalCredit); }
  const guard = f.commits.at(-1).find(row => row.collectionPath === path);
  assert.ok(guard.updateTime); assert.deepEqual(guard.updateMask, ['WalletLastPurchaseAt', 'WalletLastPurchaseNo']);
  assert.equal(f.list(path)[0].StudentType, 'Boarding Student');
  assert.equal((await f.run(body)).replayed, true); assert.equal(f.list('ledger').length, 2);
  assert.equal((await f.start()).Service.ServiceId, Service.ServiceId); assert.equal(f.list('ledger').length, 2);
});
test('larger selections use bounded atomic batches and resume from saved progress', async () => {
  const f = fixture(OFFERING_BATCH_SIZE + 2), { Service } = await f.start();
  const first = await f.run({ action: 'postNext', ServiceId: Service.ServiceId, Offset: 0, Authorized: true });
  assert.equal(first.Service.PostedCount, OFFERING_BATCH_SIZE); assert.equal(first.Service.Status, 'Partially collected');
  assert.equal(f.list('ledger').length, OFFERING_BATCH_SIZE);
  const next = await f.run({ action: 'postNext', ServiceId: Service.ServiceId, Offset: first.Service.PostedCount, Authorized: true });
  assert.equal(next.Service.Status, 'Collected'); assert.equal(next.Service.Count, OFFERING_BATCH_SIZE + 2);
  assert.equal(f.list('ledger').length, OFFERING_BATCH_SIZE + 2); assert.ok(f.commits.every(writes => writes.length <= OFFERING_BATCH_SIZE * 3 + 2));
});
test('a wallet change, lost card, invalid PIN or withdrawal after preview blocks the whole current batch', async () => {
  for (const change of [{ OpeningWallet: 0 }, { WalletCardStatus: 'Blocked' }, { WalletPinHash: 'new-pin', WalletPinThreshold: 1 }, { Status: 'Withdrawn' }, { StudentType: 'Day Student' }]) {
    const f = fixture(), { Service } = await f.start(); f.addStudent('DCA-002', change);
    await assert.rejects(f.run({ action: 'postNext', ServiceId: Service.ServiceId, Offset: 0, Authorized: true }), error => error.status === 409);
    assert.equal(f.list('ledger').length, 0); assert.equal(f.list('accountingJournals').length, 0); assert.equal(f.list(OFFERING_COLLECTION)[0].PostedCount, 0);
  }
});
test('optimistic conflicts and lost responses are safe to retry without partial duplicate postings', async () => {
  const f = fixture(), { Service } = await f.start(); f.setConflict(true);
  const body = { action: 'postNext', ServiceId: Service.ServiceId, Offset: 0, Authorized: true };
  await assert.rejects(f.run(body), /not partially posted/); assert.equal(f.list('ledger').length, 0);
  f.setConflict(false); await f.run(body); await f.run(body); assert.equal(f.list('ledger').length, 2);
});
test('closed periods, inactive payable and missing wallet liability cannot be used', async () => {
  for (const mutate of [f => { f.chart.find(row => row.Code === '2200').Active = 'NO'; }, f => { f.chart.splice(0, 1); }, f => { f.put('accountingPeriods', 'closed', { Status: 'Closed', StartDate: '2026-01-01', EndDate: '2026-12-31' }); }]) {
    const f = fixture(); mutate(f); await assert.rejects(f.run({ ...f.input(), action: 'preview' })); assert.equal(f.commits.length, 0);
  }
  const f = fixture(); await assert.rejects(f.run({ ...f.input({ PayableAccount: '4040' }), action: 'preview' }), /Payables liability/);
});
test('service ownership, section boundaries and duplicate references cannot be forged', async () => {
  const f = fixture(), { Service } = await f.start();
  for (const actor of [{ ...user, branchId: 'other' }, { ...user, schoolSectionAccess: 'Primary' }])
    await assert.rejects(f.run({ action: 'postNext', ServiceId: Service.ServiceId, Offset: 0, Authorized: true }, actor), error => error.status === 404);
  await assert.rejects(f.start(f.input({ ChurchName: 'Different recipient' })), /different details/);
  assert.equal(f.list('ledger').length, 0);
});
test('remittance is bounded by collected funds, posts liability to cash/bank, and is idempotent', async () => {
  const f = fixture(), { Service } = await f.start();
  const body = { action: 'remit', ServiceId: Service.ServiceId, Amount: 150, Date: '2026-10-10', RemittanceReference: 'BANK-123', PaymentAccount: '1020', Authorized: true };
  await assert.rejects(f.run(body), /exceeds/);
  await f.run({ action: 'postNext', ServiceId: Service.ServiceId, Offset: 0, Authorized: true });
  const result = await f.run(body); assert.equal(result.Service.Outstanding, 50); assert.equal(result.Service.Remitted, 150);
  const j = f.list('accountingJournals').find(row => row.Source === 'Boarding Offering Remittance'); assert.deepEqual(j.Lines.map(line => line.AccountCode), ['2000', '1020']);
  assert.equal((await f.run(body)).replayed, true); assert.equal(f.list('boardingOfferingRemittances').length, 1);
  await assert.rejects(f.run({ ...body, Amount: 100 }), /different details/);
  await assert.rejects(f.run({ ...body, Amount: 51, RemittanceReference: 'BANK-124' }), /exceeds/);
  assert.equal(f.list('ledger').length, 2);
});
test('offering debits reduce ledger wallet balance and count towards the same daily spending cap as purchases', () => {
  const summary = summarizeWalletActivity([{ AccountRef: 'DCA-1', FeeCategory: 'Wallet', EntryType: 'Wallet Deposit', Credit: 1000, Debit: 0 },
    { AccountRef: 'DCA-1', FeeCategory: 'Wallet', EntryType: 'Wallet Offering', Credit: 0, Debit: 50, Date: '2026-10-10T09:00:00Z' },
    { AccountRef: 'DCA-1', FeeCategory: 'Wallet', EntryType: 'Wallet Purchase', Credit: 0, Debit: 100, Date: '2026-10-10T09:00:00Z' }], 'DCA-1', new Date('2026-10-10T12:00:00Z'));
  assert.deepEqual(summary, { balance: 850, spentToday: 150 });
});

test('non-stock wallet purchases use the same atomic student guard as offerings and fail closed on a concurrent debit', async () => {
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const source = backend.slice(backend.indexOf('export async function recordWalletPurchase'), backend.indexOf('export function buildCreditActionAccountingJournal')).replace('export ', '');
  const make = ({ concurrent = false, missingVersion = false, writeFailure = false } = {}) => {
    let saved = [], version = 'v1', walletCalls = 0;
    const student = { __id: 'DCA-001', __scopePath: path, __updateTime: missingVersion ? '' : version,
      AdmissionNo: 'DCA-001', AccountRef: 'DCA-001', BranchId: 'main', SchoolSection: 'secondary', WalletCardStatus: 'Active' };
    const run = vm.runInNewContext(`(${source})`, {
      clean: value => String(value ?? '').trim(), normalizeMatchText: value => String(value ?? '').trim().toLowerCase(),
      asMoneyNumber: value => Number(value) || 0, requestedStudentScope: () => ({}), schoolSectionFor: () => 'secondary',
      findStudentByAccountRef: async () => copy(student), ledgerDocumentId: () => 'WALLET-TEST', safeDocumentId: value => value,
      nowIso: () => '2026-10-10T12:00:00Z', buildWalletPurchaseAccountingJournal,
      walletAccountPayload: async () => { walletCalls++; if (concurrent) version = 'v2'; return { ...student, WalletBalance: saved.length ? 900 : 1000, WalletSpentToday: 0 }; },
      batchCommitDocuments: async (_env, writes) => {
        if (writeFailure) throw new Error('Simulated journal/storage failure');
        if (writes[0].updateTime !== version) throw Object.assign(new Error('Concurrent offering debit'), { status: 409 });
        saved = copy(writes);
      }
    });
    return { run: () => run(env, { AccountRef: 'DCA-001', Department: 'Clinic', Amount: 100 }), saved: () => saved, walletCalls: () => walletCalls };
  };
  const success = make(), result = await success.run();
  assert.equal(result.balance, 900); assert.equal(success.walletCalls(), 2);
  assert.deepEqual(success.saved().map(write => write.collectionPath), [path, 'ledger', 'accountingJournals']);
  assert.deepEqual(success.saved()[0].updateMask, ['WalletLastPurchaseAt', 'WalletLastPurchaseNo']);
  assert.equal(success.saved()[0].updateTime, 'v1');
  for (const [settings, message] of [[{ concurrent: true }, /wallet changed/], [{ missingVersion: true }, /version is unavailable/], [{ writeFailure: true }, /storage failure/]]) {
    const attempt = make(settings); await assert.rejects(attempt.run(), message); assert.equal(attempt.saved().length, 0);
  }
});
test('UI and API wire school Accounts, individual / flat fields, explicit preview, and protected server requests', async () => {
  const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
  const [admin, html, ui, api, backend] = await Promise.all(['js/admin.js', 'admin.html', 'js/boarding-offerings.js', 'functions/api/staff-boarding-offerings.js', 'functions/api/backend.js'].map(read));
  assert.match(admin, /DynamaxBoardingOfferings\?\.canAccess\(currentUser\)/); assert.match(html, /boarding-offerings\.js\?v=/);
  for (const text of ['Apply to selected', 'Preview deductions', 'Confirm wallet deductions', 'authorised student / guardian', 'Record remittance', 'Resume deductions']) assert.ok(ui.includes(text));
  assert.match(api, /requireStaffSession/); assert.match(api, /readJsonBody/); assert.match(api, /no-store/);
  assert.match(backend, /financialScope \|\| options.strict/); assert.match(backend, /wallet offering/); assert.match(backend, /purchaseJournal.*\n[\s\S]*batchCommitDocuments/);
});
