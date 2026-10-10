import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { rejectDirectTransfer } from '../functions/lib/direct-transfer-review.js';
import { normalizeNotification, notificationTargetsRecipient, parentTransferRejectionNotification } from '../functions/lib/notifications.js';
import { transferHistoryForChild, paymentHistoryForChild } from '../functions/api/parent-dashboard.js';

const child = { SourceType: 'Student', Status: 'Active', AccountRef: 'STD-1', AdmissionNo: 'STD-1' };
const scope = { branchId: 'main', schoolSection: 'secondary' };
const user = { username: 'accounts', displayName: 'Accounts Office' };
const transfer = (extra = {}) => ({
  Reference: 'DBT-1', Context: 'school-payment', BranchId: 'main', Amount: 5000, Currency: 'NGN',
  PayerEmail: 'parent@example.test', Status: 'Awaiting Verification', CreatedAt: '2026-10-10T19:00:00Z',
  __updateTime: '2026-10-10T19:00:01Z',
  Payload: { AccountRef: 'STD-1', AdmissionNo: 'STD-1', SchoolSection: 'Secondary',
    ParentEmail: 'parent@example.test', DisplayName: 'Sample Student', FeeName: 'Student Wallet Top-up', FeeCategory: 'Wallet' },
  ...extra
});
const noticeResult = input => ({ created: false, notification: normalizeNotification(input), pushDeliveries: [] });

test('school rejection atomically saves the parent notice and no money movement', async () => {
  let saved, pushed;
  const result = await rejectDirectTransfer({ DYNAMAX_WORKSPACE_ID: 'school' }, 'DBT-1', transfer(), user, 'No proof attached', {
    now: '2026-10-10T20:00:00Z',
    batchCommitDocuments: async (_env, writes) => { saved = writes; },
    createNotification: async (_env, input) => { pushed = input; return noticeResult(input); }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(saved.map(row => row.collectionPath), ['directTransferRequests', 'notifications']);
  assert.equal(saved[0].updateTime, transfer().__updateTime);
  assert.equal(saved[0].data.Status, 'Rejected');
  assert.equal(saved[0].data.RejectionReason, 'No proof attached');
  assert.equal(saved[0].data.ReviewedAt, '2026-10-10T20:00:00Z');
  assert.equal(saved[0].data.__updateTime, undefined);
  assert.equal(saved[1].exists, false);
  assert.equal(saved[1].data.SchoolId, 'school');
  assert.equal(saved[1].data.NotificationId, normalizeNotification(pushed).NotificationId);
  assert.match(saved[1].data.Message, /No proof attached/);
  assert.match(saved[1].data.Message, /No payment or wallet credit was added/);
  assert.match(result.message, /parent rejection notice is available/);
});

test('rejection retries reuse the saved event and never overwrite the reason or status', async () => {
  const rejected = transfer({ Status: 'Rejected', RejectionReason: 'No proof attached', ReviewedAt: '2026-10-10T20:00:00Z' });
  let commits = 0;
  const seen = [];
  const options = {
    batchCommitDocuments: async () => { commits++; },
    createNotification: async (_env, input) => { seen.push(normalizeNotification(input).NotificationId); return noticeResult(input); }
  };
  for (let attempt = 0; attempt < 2; attempt++) assert.equal((await rejectDirectTransfer({}, 'DBT-1', rejected, user, rejected.RejectionReason, options)).alreadyRejected, true);
  assert.equal(commits, 0);
  assert.equal(seen[0], seen[1]);
  await assert.rejects(rejectDirectTransfer({}, 'DBT-1', rejected, user, 'Different note', options), { status: 409 });
});

test('push failure cannot remove the already-persisted inbox notice', async () => {
  let committed = false;
  const result = await rejectDirectTransfer({}, 'DBT-1', transfer(), user, 'No proof attached', {
    batchCommitDocuments: async () => { committed = true; },
    createNotification: async () => { assert.equal(committed, true); throw new Error('Push unavailable'); }
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /available in the dashboard; browser push needs attention/);
  assert.equal(result.notification.ok, false);
});

test('a commit failure or competing approval cannot create a stray rejection alert', async () => {
  let pushes = 0;
  await assert.rejects(rejectDirectTransfer({}, 'DBT-1', transfer(), user, 'No proof attached', {
    batchCommitDocuments: async () => { throw Object.assign(new Error('Record changed'), { status: 409 }); },
    createNotification: async () => { pushes++; }
  }), { status: 409 });
  assert.equal(pushes, 0);
});

test('processed transfers, missing versions, empty notes and interrupted approvals fail closed', async () => {
  for (const row of [transfer({ Status: 'Verified' }), transfer({ Status: 'Verification in progress' }), transfer({ VerificationError: 'Earlier approval error' })]) {
    await assert.rejects(rejectDirectTransfer({}, 'DBT-1', row, user, 'No proof attached'), { status: 409 });
  }
  await assert.rejects(rejectDirectTransfer({}, 'DBT-1', transfer(), user, ' '), { status: 400 });
  await assert.rejects(rejectDirectTransfer({}, 'DBT-1', transfer({ __updateTime: '' }), user, 'No proof attached'), { status: 428 });
});

test('a legacy rejection whose notice cannot be created reports the failure honestly', async () => {
  const result = await rejectDirectTransfer({}, 'DBT-1', transfer({ Status: 'Rejected', RejectionReason: 'No proof attached' }), user, 'No proof attached', {
    createNotification: async () => { throw new Error('Database unavailable'); }
  });
  assert.match(result.message, /parent notification could not be saved/);
  assert.doesNotMatch(result.message, /notice is available/);
});

test('non-school rejections retain their existing workflow without parent targeting', async () => {
  let writes = 0;
  await rejectDirectTransfer({}, 'DBT-1', transfer({ Context: 'church-donation' }), user, 'No proof attached', {
    updateDocumentIfCurrent: async (_env, collection, id, row, current) => {
      writes++; assert.equal(collection, 'directTransferRequests'); assert.equal(row.Status, 'Rejected'); assert.equal(current.__updateTime, transfer().__updateTime);
    },
    createNotification: async () => { assert.fail('Must not create a school parent notice'); }
  });
  assert.equal(writes, 1);
});

test('parent rejection notice includes the saved reason and targets only the correct scope', () => {
  const input = parentTransferRejectionNotification(transfer({ Status: 'Rejected', RejectionReason: 'Attach proof and contact Accounts' }));
  const notice = normalizeNotification(input);
  assert.equal(notice.Category, 'Payments');
  assert.deepEqual(notice.Channels, ['InApp', 'Push']);
  assert.equal(notice.ActionUrl, 'parent-dashboard.html?tab=payments');
  assert.match(notice.Message, /Sample Student/);
  assert.match(notice.Message, /Attach proof and contact Accounts/);
  const recipient = { audience: 'Parent', email: 'parent@example.test', scopes: [{ accountRef: 'std-1', branchId: 'main', schoolSection: 'secondary' }] };
  assert.equal(notificationTargetsRecipient(notice, recipient), true);
  assert.equal(notificationTargetsRecipient(notice, { ...recipient, email: 'other@example.test', scopes: [{ accountRef: 'std-2', branchId: 'main', schoolSection: 'secondary' }] }), false);
  for (const outside of [{ branchId: 'west', schoolSection: 'secondary' }, { branchId: 'main', schoolSection: 'primary' }]) {
    assert.equal(notificationTargetsRecipient(notice, { ...recipient, scopes: [{ accountRef: 'std-1', ...outside }] }), false);
  }
  assert.equal(parentTransferRejectionNotification(transfer({ Payload: { ClassName: 'Primary 4' } })).SchoolSection, 'primary');
});

test('historical rejected transfers expose their note without becoming paid records or leaking proofs', () => {
  const original = transfer({ Status: 'Rejected', RejectionReason: '<script>bad</script> No proof', ProofDataUrl: 'data:image/png;base64,secret', BankReference: 'PRIVATE-BANK-REF', PayerPhone: 'private' });
  const history = transferHistoryForChild(child, [original], scope);
  assert.equal(history.length, 1);
  assert.equal(history[0].RejectionReason, original.RejectionReason);
  assert.equal(history[0].HasProof, true);
  for (const key of ['Payload', 'ProofDataUrl', 'BankReference', 'PayerPhone', 'PayerEmail', '__updateTime', 'Credit', 'Debit']) assert.equal(history[0][key], undefined);
  assert.deepEqual(paymentHistoryForChild(child, [original], []), []);
  assert.equal(original.Status, 'Rejected');
});

test('transfer history does not cross a sibling, branch, section or payment context', () => {
  const wrongStudent = transfer({ Payload: { ...transfer().Payload, AccountRef: 'STD-2', AdmissionNo: 'STD-2' } });
  const wrongSection = transfer({ Payload: { ...transfer().Payload, SchoolSection: 'Primary' } });
  const rows = [wrongStudent, wrongSection, transfer({ BranchId: 'west' }), transfer({ Context: 'admission-form' })];
  assert.deepEqual(transferHistoryForChild(child, rows, scope), []);
  assert.deepEqual(transferHistoryForChild(child, rows, { branchId: 'main' }), []);
});

test('parent rejection rendering uses text nodes, local display time, and child-scoped history', async () => {
  const source = await readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8');
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.append(node); }
    replaceChildren() { this.children = []; }
  }
  const panel = new Element('div'), records = new Element('div');
  const history = transferHistoryForChild(child, [transfer({ Status: 'Rejected', RejectionReason: '<img src=x onerror=alert(1)> Missing proof' })], scope);
  const context = {
    parentTransferHistory: panel, parentTransferRecords: records,
    dashboard: { transferRequests: { 'STD-1': history } },
    childResult: (map, selected, fallback) => map[selected.AccountRef] || fallback,
    activityTarget: (el) => el, money: n => `NGN ${n}`,
    DynamaxTime: { formatDateTime: () => '10 Oct 2026, 8:00 PM WAT' },
    document: { createElement: tag => new Element(tag) }
  };
  vm.runInNewContext(`${source.slice(source.indexOf('function renderTransferRequests(child)'), source.indexOf('function renderPayments(child)'))}; this.render = renderTransferRequests;`, context);
  context.render(child);
  assert.equal(panel.hidden, false);
  assert.equal(records.children.length, 1);
  const nodes = records.children[0].children;
  assert.match(nodes[1].textContent, /Rejected/);
  assert.match(nodes[2].textContent, /8:00 PM WAT/);
  assert.equal(nodes[3].textContent, 'Reason: <img src=x onerror=alert(1)> Missing proof');
  assert.match(nodes[4].textContent, /No payment or wallet credit/);
  assert.equal(nodes.some(node => node.tag === 'img'), false);
  context.render({ AccountRef: 'STD-2' });
  assert.equal(panel.hidden, true);
  assert.equal(records.children.length, 0);
  assert.match(source, /setChildResult\(dashboard\.transferRequests, child, activityData\.transferRequests \|\| \[\]\)/);
});

test('authenticated endpoint checks scope before rejecting and queries only linked child references', async () => {
  const staff = await readFile(new URL('../functions/api/staff-direct-transfers.js', import.meta.url), 'utf8');
  assert.match(staff, /verifyScope\(user, transfer\);\s*if \(action === 'reject'\)/);
  assert.match(staff, /requireStaffSession\(context.env, context.request\)/);
  const api = await readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8');
  assert.match(api, /queryRowsForReferences\(env, 'directTransferRequests', \['Payload.AccountRef', 'Payload.AdmissionNo', 'Payload.ApplicationReference'\], keys\)/);
  assert.match(api, /transferRequests: transferHistoryForChild\(child, transferRows, selectedScope\)/);
  assert.doesNotMatch(api, /listCollection\(env, 'directTransferRequests'/);
});
