import test from 'node:test';
import assert from 'node:assert/strict';
import { handleManualPaymentCorrection } from '../functions/lib/manual-payment-corrections.js';
import { buildStructuredQuery } from '../functions/lib/firestore.js';

const user = { username: 'accountant', role: 'Accounts Officer', edition: 'school', branchId: 'main', schoolSectionAccess: 'secondary', allowedSections: ['accounts'] };
const env = { FIREBASE_PROJECT_ID: 'test-project' };
const prefix = 'projects/test-project/databases/(default)/documents/payments/';
const student = { __id: 'TEST-001', __scopePath: 'students', AdmissionNo: 'TEST/001', AccountRef: 'TEST/001', ApplicationReference: 'APP/001',
  DisplayName: 'Test Student', ClassName: 'Grade 10', BranchId: 'main', SchoolSection: 'secondary' };
function payment(id, extra = {}) {
  return { __id: id, __name: prefix + id, AccountRef: 'TEST/001', Reference: `REF-${id}`, ReceiptNo: `RECEIPT-${id}`,
    BranchId: 'main', SchoolSection: 'secondary', FeeCode: 'WALLET_TOPUP', FeeCategory: 'Wallet', FeeName: 'Student Wallet Top-up',
    Amount: 22400, Gateway: 'Manual', Status: 'Paid', ProcessingStatus: 'Completed', Currency: 'NGN', PaidAt: '2025-10-10T10:00:00Z', ...extra };
}
function fixture(payments = [], identity = student) {
  const pages = [], students = [], forbidden = () => { throw new Error('Search must not read broad collections, inspect balances, authorize a correction or write anything'); };
  const io = { student: async (_env, ref, scope) => { students.push({ ref, scope }); return [identity?.AdmissionNo, identity?.AccountRef, identity?.ApplicationReference].includes(ref) ? identity : null; },
    page: async (_env, collection, options) => {
      pages.push({ collection, options }); assert.equal(collection, 'payments'); assert.equal(options.filterJoin, 'OR');
      assert.ok(options.filters.length <= 30, 'within Firestore disjunction limit');
      assert.deepEqual(options.orderBy, [{ field: '__name__' }]);
      return payments.filter(row => options.filters.some(f => row[f.field] === f.value))
        .filter(row => !options.startAfterName || row.__name > options.startAfterName)
        .sort((a,b) => a.__name.localeCompare(b.__name)).slice(0, options.limit);
    }, get: forbidden, query: forbidden, rows: forbidden, list: forbidden, wallet: forbidden, chart: forbidden, authorize: forbidden, commit: forbidden };
  const call = (body = {}, actor = user) => handleManualPaymentCorrection(env, actor, { action: 'search', AccountRef: 'TEST/001', ...body }, io);
  return { call, pages, students, io };
}

test('full student history includes old imports and manual receipts beyond the recent 80, across all dates and sessions', async () => {
  const rows = Array.from({ length: 207 }, (_, i) => payment(String(i).padStart(4, '0'), {
    AcademicSession: i < 100 ? '2024/2025' : '2026/2027', Channel: i === 0 ? 'Historical Payment Import' : '', ParentEmail: 'private@example.test', ProofDataUrl: 'private-proof' }));
  const f = fixture([...rows, ...Array.from({length: 90}, (_,i) => payment(`other-${i}`, { AccountRef: 'OTHER/001' }))]);
  const loaded = []; let Cursor;
  do {
    const result = await f.call({ Cursor }); loaded.push(...result.Rows); Cursor = result.NextCursor;
    assert.equal(result.Complete, !Cursor); assert.deepEqual(result.Student, { AccountRef: 'TEST/001', DisplayName: 'Test Student', ClassName: 'Grade 10', SchoolSection: 'secondary' });
  } while (Cursor);
  assert.equal(loaded.length, 207); assert.equal(new Set(loaded.map(row => row.Id)).size, 207);
  assert.equal(f.pages.length, 3); assert.equal(loaded[0].Source, 'Batch import'); assert.equal(loaded[206].Source, 'Manual payment');
  assert.equal(loaded[0].CanSelect, true); assert.equal(loaded[0].Amount, 22400);
  assert.doesNotMatch(JSON.stringify(loaded), /private|__name|WalletBalance/);
  for (const {options} of f.pages) {
    assert.equal(options.limit, 101);
    assert.ok(!options.filters.some(f => /Date|PaidAt|AcademicSession|Term/.test(f.field)));
    assert.ok(!options.select.includes('ParentEmail')); assert.ok(options.select.includes('accountRef'));
    const query = buildStructuredQuery('payments', options).structuredQuery;
    assert.equal(query.where.compositeFilter.op, 'OR'); assert.equal(query.limit, 101);
    if (options.startAfterName) assert.deepEqual(query.startAt, { values: [{ referenceValue: options.startAfterName }], before: false });
  }
});

test('search is case-insensitive for admission numbers and includes canonical account and application aliases', async () => {
  const f = fixture([payment('a'), payment('b', {AccountRef:'test/001'}), payment('c', { AccountRef:'APP/001' }),
    payment('d', {AccountRef:undefined,AdmissionNo:'TEST/001'}), payment('e', {AccountRef:'TeSt/001',AccountRefNormalized:'test001'})]);
  const result = await f.call({AccountRef:'test/001'});
  assert.equal(result.Rows.length, 5); assert.deepEqual(f.students.map(row => row.ref), ['test/001', 'TEST/001']);
  assert.equal(result.Rows.find(row=>row.Id==='d').CanSelect, false, 'incomplete legacy receipts need review before correction');
});

test('same admission number in other branches/sections and conflicting aliases are never disclosed', async () => {
  const f = fixture([payment('main'), payment('legacy', {BranchId:undefined,SchoolSection:undefined}), payment('branch',{BranchId:'other'}),
    payment('section',{SchoolSection:'primary'}), payment('conflict',{AdmissionNo:'OTHER/001'}), payment('lower-alias',{accountRef:'OTHER/001'})]);
  assert.deepEqual((await f.call()).Rows.map(row=>row.Id), ['legacy','main']);
  await assert.rejects(f.call({}, {...user,branchId:'other'}), /branch/);
  await assert.rejects(f.call({}, {...user,schoolSectionAccess:'primary'}), /section/);
  assert.equal(f.pages.length, 1, 'student scope is checked before payment queries');
});

test('a filtered-out page still provides the next cursor so authorised older history is reachable', async () => {
  const f = fixture([...Array.from({length:100},(_,i)=>payment(String(i).padStart(4,'0'),{BranchId:'other'})),payment('9999')]);
  const first = await f.call(); assert.equal(first.Rows.length,0); assert.ok(first.NextCursor); assert.equal(first.Complete,false);
  const last = await f.call({Cursor:first.NextCursor}); assert.deepEqual(last.Rows.map(row=>row.Id),['9999']); assert.equal(last.Complete,true);
});

test('pagination cursors cannot cross student, branch, query or database scope', async () => {
  const f = fixture(Array.from({length:101},(_,i)=>payment(String(i).padStart(4,'0'))));
  const first = await f.call(), cursor = JSON.parse(first.NextCursor);
  for (const Cursor of ['not json', JSON.stringify({...cursor,binding:'other'}), JSON.stringify({...cursor,last:prefix+'a/subcollection/b'}),
    JSON.stringify({...cursor,last:'projects/other/databases/(default)/documents/payments/a'}), JSON.stringify({...cursor,version:2}), 'x'.repeat(4001)]) {
    await assert.rejects(f.call({Cursor}), /different search or scope/);
  }
  await assert.rejects(f.call({AccountRef:'APP/001',Cursor:first.NextCursor}), /different search or scope/);
  const other = fixture([], {...student,BranchId:'other'});
  await assert.rejects(other.call({Cursor:first.NextCursor},{...user,branchId:'other'}),/different search or scope/);
  assert.equal(f.pages.length,1);
});

test('all payment types are visible but only potentially correctable manual receipts are selectable', async () => {
  const f = fixture([payment('manual'),payment('school',{FeeCode:'SCHOOL_FEES_TOTAL',FeeCategory:'School Fee'}),
    payment('online',{Gateway:'Paystack'}),payment('pending',{Status:'Pending'}), payment('processing',{ProcessingStatus:'Processing'}),
    payment('corrected',{CorrectionTotal:22400}),payment('overcorrected',{CorrectionTotal:22401}),payment('negative',{CorrectionTotal:-1}),
    payment('invalid',{Amount:'invalid'}),payment('currency',{Currency:'USD'}),payment('charges',{GatewayFee:100}),
    payment('acceptance',{FeeCode:'ACC',FeeName:'Acceptance fee',FeeCategory:'Admission'}),payment('net',{NetAmount:21000})]);
  const result = await f.call(); assert.equal(result.Rows.length,13);
  assert.deepEqual(result.Rows.filter(row=>row.CanSelect).map(row=>row.Id), ['manual','school']);
  assert.match(result.Rows.find(row=>row.Id==='corrected').UnavailableReason,/fully corrected/);
});

test('search uses existing correction permissions and rejects invalid or absent student identities', async () => {
  const f = fixture();
  for (const actor of [{...user,role:'Teacher'},{...user,allowedSections:[]},{...user,edition:'hotel'},{...user,branchId:'All'}, {...user,username:''}]) {
    await assert.rejects(f.call({},actor),{status:403});
  }
  for (const AccountRef of ['', '/', 'A', 'x'.repeat(181)]) await assert.rejects(f.call({AccountRef}),{status:400});
  await assert.rejects(f.call({AccountRef:'UNKNOWN'}), {status:404});
  assert.equal(f.pages.length,0);
});

test('no-match history is complete and read failures never masquerade as an empty successful history', async () => {
  const f = fixture(); const empty = await f.call(); assert.deepEqual(empty.Rows,[]); assert.equal(empty.Complete,true);
  f.io.page = async () => { throw Error('Database unavailable'); };
  await assert.rejects(f.call(),/Database unavailable/);
});
