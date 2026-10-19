import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as workflow from '../functions/lib/requisition-workflow.js';
import { resolveOrganizationConfig } from '../functions/lib/organization-config.js';
import { buildRequisitionResubmission } from '../functions/api/finance-workflow.js';
import { staffRequisitionEventNotification } from '../functions/lib/notifications.js';
import { buildRequisitionPosting } from '../functions/lib/requisition-posting.js';
import { vendorRequestPrintReport } from '../functions/lib/vendor-request-print.js';
import { requisitionChangedFields } from '../functions/lib/requisition-edit-history.js';

const source = (await readFile(new URL('../functions/lib/approval-settings.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');

test('desktop API captures the server policy once and records the actual final approver in all editions', async () => {
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const code = backend.slice(backend.indexOf('function accountingRequisitionActor('), backend.indexOf('\nfunction validImprestDate('));
  for (const edition of ['school','faith','organization']) for (let mask=1; mask<8; mask++) {
    const stages = workflow.APPROVAL_STAGES.filter((_,i) => mask & (1<<i)).map(s => s.id);
    let saved = {}, snapshots = 0;
    const save = vm.runInNewContext(`(()=>{${code};return saveAccountingExpense})()`, {
      ...workflow, requisitionChangedFields, clean: v => String(v ?? '').trim(), lower: v => String(v ?? '').trim().toLowerCase(),
      requireAccountingRole(){}, DEPARTMENT_ACCOUNTING_ROLES:[], getDocumentByIdOrField:async()=>saved,
      accountingWriteBranch:()=> 'main', accountingRequestBranch:()=> 'main', accountingDepartment:()=> 'Accounts',
      asMoneyNumber:Number, nowIso:()=> '2026-10-15T10:00:00Z', enforceDepartmentSubmission:()=> 'Accounts',
      approvalSnapshot:async()=>{snapshots++;return {Stages:stages,Edition:edition};},
      recordRequisitionEdit:()=>null, accountingAuditWrite:()=>({collectionPath:'accountingAudit',data:{}}),
      safeDocumentId:v=>v, notifyStaffRequisitionEvent:async()=>{},
      batchUpsertDocuments:async(_env,writes)=>{saved={...writes[0].data,__updateTime:'v'+Math.random()};}
    });
    const submit={ExpenseNo:'REQ',Status:'Submitted',Amount:100,Description:'Supplies',Date:'2026-10-15',Department:'Accounts',UserUsername:'requester',UserRole:'Teacher',ApprovalFlow:{Stages:['FORGED']}};
    await save({},submit);
    assert.deepEqual([...saved.ApprovalFlow.Stages],stages);
    for(const stage of stages) {
      const next=workflow.requisitionPendingTransition(saved), role=(next.roles || [next.role])[0];
      await assert.rejects(save({}, {...saved,Status:next.nextStatus,UserUsername:'wrong',UserRole:'Teacher'}),e=>e.status===403);
      await save({}, {...saved,Status:next.nextStatus,UserUsername:'officer',UserRole:role,RecordedBy:role,ApprovalFlow:{Stages:['FORGED']}});
      if(next.nextStatus==='Approved') { assert.equal(saved.FinalApprovedRole,role); assert.equal(saved.FinalApprovedStage,stage); assert.ok(saved.AdminReviewedAt); }
    }
    assert.equal(snapshots,1);
    assert.equal(saved.Status,'Approved');
    assert.deepEqual([...saved.ApprovalFlow.Stages],stages);
  }
});
function fixture(edition) {
  const store = new Map(), writes = [];
  let serial = 0;
  const handlers = vm.runInNewContext(`${source}\n({handleApprovalSettings, approvalSnapshot})`, {
    ...workflow, resolveOrganizationConfig, crypto: webcrypto, Date,
    getDocument: async (_env, collection, id) => structuredClone(store.get(`${collection}/${id}`) || null),
    batchCommitDocuments: async (_env, changes) => {
      for (const w of changes) {
        const existing = store.get(`${w.collectionPath}/${w.documentId}`);
        if (w.exists === false && existing || w.updateTime && w.updateTime !== existing?.__updateTime)
          throw Object.assign(new Error('Conflict'), { status: 409 });
      }
      for (const w of changes) store.set(`${w.collectionPath}/${w.documentId}`, { ...structuredClone(w.data), __updateTime: `v${++serial}` });
      writes.push(changes);
    }
  });
  const env = { ORGANISATION_EDITION: edition };
  const user = { username: 'owner', assignedRole: 'Super Admin', branchId: 'main' };
  return { store, writes, run: (body = {}, actor = user) => handlers.handleApprovalSettings(env, actor, body),
    snapshot: kind => handlers.approvalSnapshot(env, kind) };
}

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: policies are independent, version checked, audited and captured only for new requests`, async () => {
    const f = fixture(edition);
    const initial = await f.run();
    assert.equal(initial.edition, edition);
    assert.equal(initial.policies.staff.length, 3);
    await f.run({ action: 'save', recordVersion: '', policies: { staff: ['director'], vendor: ['accounts', 'admin-review'] } });
    const staff = await f.snapshot('staff'), vendor = await f.snapshot('vendor');
    assert.deepEqual([...staff.Stages], ['director']);
    assert.deepEqual([...vendor.Stages], ['accounts', 'admin-review']);
    const saved = await f.run();
    await assert.rejects(f.run({ action: 'save', recordVersion: '', policies: saved.policies }), /changed/);
    await f.run({ action: 'save', recordVersion: saved.recordVersion, policies: { staff: ['accounts'], vendor: ['director'] } });
    assert.deepEqual([...staff.Stages], ['director']);
    assert.deepEqual([...(await f.snapshot('staff')).Stages], ['accounts']);
    assert.equal(f.writes.length, 2);
    assert.match(f.writes[0][1].data.Details, /new requests only/);
    assert.equal(f.writes[0][0].documentId, `requisition-approvals-${edition}`);
  });
  for (let mask = 1; mask < 8; mask++) {
    test(`${edition}: enabled stages ${mask} enforce exact roles, order, final approval and payment separation`, () => {
      const stages = workflow.APPROVAL_STAGES.filter((_, i) => mask & (1 << i)).map(s => s.id);
      let r = { ExpenseNo: 'REQ', Status: 'Submitted', ApprovalFlow: { Version: 1, Stages: stages },
        Amount: 100, Date: '2026-10-15', __updateTime: 'v1', RequestedByUsername: 'requester' };
      for (const stage of stages) {
        const next = workflow.requisitionPendingTransition(r);
        assert.equal(next.stage, stage);
        const role = (next.roles || [next.role])[0];
        for (const bad of ['Vendor User', 'Teacher', ...['Accounts Officer', 'Admin', 'Director'].filter(r => !(next.roles || [next.role]).includes(r))])
          assert.throws(() => workflow.assertRequisitionTransition(r, bad, next.nextStatus), e => e.status === 403);
        assert.throws(() => workflow.assertRequisitionTransition(r, role, 'Posted'), e => e.status === 409);
        assert.equal(workflow.assertRequisitionTransition(r, role, 'Rejected').nextStatus, 'Rejected');
        const notification = staffRequisitionEventNotification(r, r.Status === 'Submitted' ? 'Submitted' : 'Confirmed');
        assert.deepEqual(notification.TargetRoles, next.roles || [next.role]);
        const transition = workflow.assertRequisitionTransition(r, role, next.nextStatus);
        r = { ...r, Status: transition.nextStatus };
      }
      assert.equal(r.Status, 'Approved');
      assert.equal(workflow.requisitionPendingTransition(r).stage, 'posting');
      assert.throws(() => workflow.assertRequisitionTransition(r, 'Director', 'Posted'), e => e.status === 403);
      assert.throws(() => workflow.assertRequisitionTransition(r, 'Accounts Officer', 'Rejected'), e => e.status === 409);
      assert.equal(buildRequisitionPosting(r, { role: 'Accounts Officer' }).journal.TotalDebit, 100);
    });
  }
}

test('invalid policies, spoofed role, and read-only subscription cannot alter settings', async () => {
  const f = fixture('school');
  for (const stages of [[], ['other'], ['accounts', 'accounts'], 'accounts', null]) {
    await assert.rejects(f.run({ action: 'save', policies: { staff: stages, vendor: ['director'] } }), e => e.status === 400);
  }
  for (const role of ['Accounts Officer', 'Admin', 'Director', 'Vendor User'])
    await assert.rejects(f.run({ action: 'save' }, { username: 'other', role: 'Super Admin', assignedRole: role }), e => e.status === 403);
  await assert.rejects(f.run({ action: 'save' }, { username: 'owner', role: 'Super Admin', subscriptionReadOnly: true }), e => e.status === 403);
  assert.equal(f.writes.length, 0);
});

test('resubmission preserves the captured flow and legacy requests keep all original stages', () => {
  const initial = { ExpenseNo: 'REQ', Status: 'Submitted', Date: '2026-10-15', Amount: 100,
    ApprovalFlow: { Version: 1, Stages: ['admin-review'] } };
  const { payload } = buildRequisitionResubmission(initial, { description: 'Corrected', date: initial.Date, amount: 150 }, { username: 'admin' });
  assert.deepEqual(payload.ApprovalFlow, initial.ApprovalFlow);
  assert.equal(workflow.requisitionPendingTransition(payload).role, 'Admin');
  assert.equal(workflow.requisitionPendingTransition({ Status: 'Submitted' }).role, 'Accounts Officer');
  assert.equal(workflow.requisitionWorkflowStatus({ Status: 'Approved' }), 'Management Authorized');
});

test('full and summary report totals include every saved sale and distinguish partial claims', () => {
  const request = { Allocations: [], Snapshot: [] };
  for (let i = 0; i < 150; i++) {
    request.Allocations.push({ LotId: `L${i}`, AmountCents: 123 });
    request.Snapshot.push({ LotId: `L${i}`, Gross: 10.03, Refund: 0.01, Charge: 1.01, Net: 9.01 });
  }
  const { rows, total } = vendorRequestPrintReport(request);
  assert.equal(rows.length, 150);
  assert.equal(total.Count, 150);
  assert.equal(total.Gross, 1504.5);
  assert.equal(total.Claimed, 184.5);
  assert.equal(total.Net, 1351.5);
  assert.equal(rows[149].Serial, 150);
  assert.equal(rows[149].Claimed, 1.23);
});
