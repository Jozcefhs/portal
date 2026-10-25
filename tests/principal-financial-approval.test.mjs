import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as workflow from '../functions/lib/requisition-workflow.js';
import { sectionAccessFor } from '../functions/lib/staff-auth.js';
import { featureFlagsForEdition } from '../functions/lib/organization-config.js';
import { assertFinanceRoleLimit } from '../functions/lib/accounting-mutation-guards.js';
import { resolveAuthoritativeDesktopActor, applyAuthoritativeActor } from '../functions/lib/backend-security.js';

const principal = { role:'Principal', username:'principal', displayName:'Principal', branchId:'main',
  schoolSectionAccess:'Secondary', approvalEnabled:true, approvalMaxAmount:500, approvalAccounts:['6090','2000'] };
const request = { ExpenseNo:'REQ-1', Amount:400, ExpenseAccount:'6090', Department:'Science', BranchId:'main',
  SchoolSection:'Secondary', Status:'Admin Reviewed', __updateTime:'r1', Description:'Supplies' };
const source = await readFile(new URL('../functions/api/finance-workflow.js',import.meta.url),'utf8');
function declaration(name) {
  const start = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`,'m').exec(source).index;
  const rest = source.slice(start);
  const next = /\r?\n(?:export )?(?:async )?function /g.exec(rest);
  return (next ? rest.slice(0,next.index) : rest).replace(/^export /,'');
}
const clean = value => String(value ?? '').trim(), lower = value => clean(value).toLowerCase();
function fixture(initial=request) {
  let row=structuredClone(initial); const commits=[]; let limits=[]; let authorizations=0;
  const ctx = { ...workflow, clean, lower, amount:Number, same:(a,b)=>lower(a)===lower(b),
    userDepartment:u=>u.department||'', canEditRequisitions:()=>false, canManageApprovalSettings:()=>false, assertFinanceRoleLimit,
    getDocument:async()=>structuredClone(row), findOneByField:async()=>null, listCollection:async()=>limits,
    safeId:clean, nowIso:()=> '2026-10-17T11:00:00Z', actor:u=>u.displayName,
    requireDecisionAuthorization:async()=>{authorizations++;return 'Password';}, buildEndorsement:async()=>null,
    removeFirestoreMetadata:row=>row, documentVersion:row=>row.__updateTime,
    auditWrite:()=>({collectionPath:'accountingAudit',data:{}}),
    commitFinanceDecision:async(_env,writes)=>{assert.equal(writes[0].updateTime,row.__updateTime);commits.push(writes);row=writes[0].data;},
    notifyStaffRequisitionEvent:async()=>{},
  };
  const api=vm.runInNewContext(`${['capabilities','scopedRows','requestedRequisitionStatus','advanceRequisition'].map(declaration).join('\n')}\n({capabilities,scopedRows,advanceRequisition})`,ctx);
  return {api,commits,row:()=>row,authorizations:()=>authorizations,setLimits:x=>{limits=x;},
    advance:(user=principal,body={})=>api.advanceRequisition({},user,{recordId:'REQ-1',decision:'Approved',...body},{})};
}

test('principal grant permits only final-stage decisions within every account and amount limit',()=>{
  assert.equal(workflow.requisitionCapabilities(principal).canApproveRequisitions,true);
  assert.equal(workflow.requisitionCapabilities(principal).canPostRequisitions,false);
  assert.equal(workflow.assertRequisitionTransition(request,principal,'Approved').stage,'director');
  for(const user of [{...principal,approvalEnabled:false},{...principal,approvalEnabled:'YES'},
    {...principal,approvalMaxAmount:399},{...principal,approvalMaxAmount:NaN},{...principal,approvalAccounts:[]},
    {...principal,approvalAccounts:['2000']},{...principal,role:'Teacher',approvalEnabled:false}]) {
    assert.throws(()=>workflow.assertRequisitionTransition(request,user,'Approved'),e=>e.status===403);
  }
  for(const Status of ['Submitted','Accounts Confirmed','Approved']) {
    assert.throws(()=>workflow.assertRequisitionTransition({...request,Status,ApprovalFlow:{Stages:['accounts','admin-review','director']}},principal,Status==='Approved'?'Posted':'Approved'),e=>e.status===403);
  }
  assert.equal(workflow.assertRequisitionTransition({...request,Status:'Submitted',ApprovalFlow:{Stages:['director']}},principal,'Approved').event,'Approved');
  assert.equal(workflow.assertRequisitionTransition({...request,Status:'Submitted',ApprovalFlow:{Stages:['accounts']}},principal,'Approved').event,'Approved');
  const vendor={SettlementId:'V1',Status:'Admin Reviewed',AmountCents:40000,PayableAccount:'2000',Allocations:[{PayableAccount:'2100'}]};
  assert.throws(()=>workflow.assertRequisitionTransition(vendor,principal,'Approved'),/account code/);
  assert.equal(workflow.assertRequisitionTransition({...vendor,Allocations:[]},principal,'Approved').event,'Approved');
});

test('principal sees requisitions across departments, but not other branches, sections or unrelated bills',()=>{
  const f=fixture(); const records=[request,{...request,ExpenseNo:'OTHER',BranchId:'elsewhere'},
    {...request,ExpenseNo:'PRIMARY',SchoolSection:'Primary'},{BillNo:'BILL',Department:'Science',BranchId:'main',SchoolSection:'Secondary'}];
  assert.deepEqual(Array.from(f.api.scopedRows(records,principal,f.api.capabilities(principal)),r=>r.ExpenseNo),['REQ-1']);
  const revoked={...principal,approvalEnabled:false};
  assert.equal(f.api.scopedRows(records,revoked,f.api.capabilities(revoked)).length,0);
});

test('staff requisition approval uses the saved amount, limits and account; writes status/audit only',async()=>{
  const f=fixture(); await f.advance(principal,{Amount:1,ExpenseAccount:'2000',approvalMaxAmount:99999});
  assert.equal(f.row().Status,'Approved'); assert.equal(f.row().Amount,400); assert.equal(f.row().ExpenseAccount,'6090');
  assert.equal(f.row().FinalApprovedRole,'Principal'); assert.equal(f.authorizations(),1);
  assert.deepEqual(Array.from(f.commits[0],r=>r.collectionPath),['accountingExpenses','accountingAudit']);
  await assert.rejects(f.advance(),e=>e.status===403); assert.equal(f.commits.length,1);
  for (const [user,record] of [[{...principal,branchId:'other'},request],[{...principal,approvalMaxAmount:200},request],
    [principal,{...request,Status:'Accounts Confirmed'}]]) {
    const other=fixture(record); await assert.rejects(other.advance(user)); assert.equal(other.commits.length,0);
  }
  const blocked=fixture(); blocked.setLimits([{Role:'Principal',TransactionType:'Expense',Active:'NO',MaxAmount:1000}]);
  await assert.rejects(blocked.advance(),/configured approval limit/); assert.equal(blocked.commits.length,0);
});

test('grant opens a feature-gated approval-only vendor workspace, without granting operations',()=>{
  const flags=featureFlagsForEdition('school'); const org={Edition:'school',FeatureFlags:flags,PlanFeatureFlags:flags};
  const access=sectionAccessFor(principal,org);
  assert.ok(access.allowedSections.includes('financeRequests')); assert.ok(access.allowedSections.includes('vendorSettlements'));
  assert.equal(access.vendorSettlementApprovalOnly,true);
  assert.ok(!sectionAccessFor({...principal,approvalEnabled:false},org).allowedSections.includes('vendorSettlements'));
  assert.ok(!sectionAccessFor(principal,{...org,SubscriptionActive:false}).allowedSections.length);
  for(const key of ['accounting','approvals','vendorSettlements']) {
    assert.ok(!sectionAccessFor(principal,{...org,FeatureFlags:{...flags,[key]:false}}).allowedSections.includes('vendorSettlements'));
  }
  const explicit=sectionAccessFor(principal,org,{Scopes:{main:{Principal:['vendorSettlements']}}});
  assert.equal(explicit.vendorSettlementApprovalOnly,false);
});

test('desktop actor replaces forged approval grants, amounts and accounts with current staff records',()=>{
  const body={UserUsername:'principal',UserApprovalEnabled:true,UserApprovalMaxAmount:999999,UserApprovalAccounts:['*']};
  const record={Username:'principal',Role:'Principal',ApprovalEnabled:'YES',ApprovalMaxAmount:500,ApprovalAccounts:'6090,2000'};
  const normalized=applyAuthoritativeActor(body,resolveAuthoritativeDesktopActor(body,[record]));
  assert.equal(normalized.UserApprovalMaxAmount,500); assert.deepEqual(normalized.UserApprovalAccounts,['6090','2000']);
  assert.equal(applyAuthoritativeActor(body,resolveAuthoritativeDesktopActor(body,[{...record,ApprovalEnabled:'NO'}])).UserApprovalEnabled,false);
});


test('every explicitly authorised officer may complete the last enabled stage, with scope limits retained', () => {
  for (const role of ['Teacher','Admin','Accounts Officer','HR Officer','Pastor','Department User']) {
    const officer={...principal,role};
    for (const [Stages,Status] of [[['director'],'Submitted'],[['accounts'],'Submitted'],[['accounts','admin-review'],'Accounts Confirmed']]) {
      const record={...request,Status,ApprovalFlow:{Stages}};
      assert.equal(workflow.assertRequisitionTransition(record,officer,'Approved').nextStatus,'Approved');
      assert.throws(()=>workflow.assertRequisitionTransition(record,{...officer,approvalMaxAmount:1},'Approved'),e=>e.status===403);
    }
    if (role !== 'Accounts Officer') assert.throws(()=>workflow.assertRequisitionTransition({...request,Status:'Approved',ApprovalFlow:{Stages:['director']}},officer,'Posted'),e=>e.status===403);
  }
  for (const role of ['External Auditor','Vendor User']) assert.throws(()=>workflow.assertRequisitionTransition(request,{...principal,role},'Approved'),e=>e.status===403);
});
