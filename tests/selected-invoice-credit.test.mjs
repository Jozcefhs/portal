import assert from 'node:assert/strict';
import test from 'node:test';
import { schoolFeeInvoiceCredit, enforceDesktopDeviceActionScope } from '../functions/api/backend.js';
import { schoolFeeCreditSummaryId } from '../functions/lib/school-fee-credit-scope.js';

function fixture(branch = 'north', managed = false) {
  const env = { DYNAMAX_EDITION: 'school' };
  const student = { AdmissionNo: 'P/01', BranchId: branch, SchoolSection: 'primary',
    __scopePath: 'schoolBranches/'+branch+'/sections/primary/students', __id: 'P-01', __updateTime: 'student-v1' };
  const body = { UserRole: 'Accounts Officer', UserUsername: 'finance', UserBranchId: branch, DeviceBranchId: branch,
    BranchId: branch, SchoolSection: 'primary', AccountRef: 'P/01', RecordedBy: 'Finance', Operation: 'preview' };
  const scoped = { AccountRef: body.AccountRef, BranchId: branch, SchoolSection: 'primary' };
  const invoice = { ...scoped, __id: 'i', __updateTime: 'i-v1', InvoiceId: 'i', FeeCategory: 'School Fee',
    FeeName: 'Tuition', FeeCode: 'TUITION', DueDate: '2099-09-14', AcademicSession: '2026/2027', Term: 'First Term',
    Amount: 100, PaidAmount: 20, BalanceAmount: 80, Balance: 80, Status: 'Part Paid' };
  const invoices = [invoice, { ...invoice, __id:'store',InvoiceId:'store',FeeCategory:'Store' },
    { ...invoice,__id:'paid',InvoiceId:'paid',Status:'Paid',Amount:10,PaidAmount:10,BalanceAmount:0 }];
  const ledger = [{ ...scoped, FeeCategory:'School Fee',FeeCode:'SCHOOL_FEES_TOTAL',EntryType:'Payment', Credit:110 },
    { ...scoped, FeeCategory:'Wallet',FeeCode:'WALLET_TOPUP',EntryType:'Payment',Credit:500 }];
  const summaryId = managed ? schoolFeeCreditSummaryId('P/01',{branchId:branch,schoolSectionAccess:'primary'}) : 'P-01';
  const summary = { ...scoped,__id:summaryId,__updateTime:'s-v1',CreditBalance:80,SchoolFeeCreditManaged:managed };
  const commits = [], journals = new Map();
  const db = {
    findStudentByAccountRef:async()=>student,
    getDocument:async(_,col,id)=>col==='accountingJournals'?journals.get(id):managed?summary:null,
    readSchoolFeeCreditHistory:async(_,scope)=>({scope,invoices,ledger,summary:managed?summary:null}),
    assertScopedAccountSummary:async()=>summary, syncSchoolAccountCreditJournals:async()=>({}),
    accountingPeriodIsClosed:async()=>false, loadNotificationSettings:async()=>({}),
    batchCommitDocuments:async(_,writes)=>{
      if(writes.some(w=>w.collectionPath==='accountingJournals'&&journals.has(w.documentId))) throw Error('commit conflict');
      commits.push(writes); const j=writes.find(w=>w.collectionPath==='accountingJournals');journals.set(j.documentId,j.data);
    }
  };
  const run=(change={})=>schoolFeeInvoiceCredit(env,{...body,...change},db);
  const apply={Operation:'apply',Amount:80,InvoiceId:'i',InvoiceRevision:'i-v1',Reference:'test-reference',Notes:'Apply the existing receipt'};
  return {student,body,invoices,ledger,summary,summaryId,commits,db,run,apply};
}

for(const [branch,managed,amount] of [['main',false,80],['the-lord-s-garden-primary',false,30],['area-1-primary',true,25]]) {
  test('preview and apply existing credit in '+branch,async()=>{
    const f=fixture(branch,managed);
    enforceDesktopDeviceActionScope({type:'device',branchId:branch},'schoolFeeInvoiceCredit',f.body);
    const preview=await f.run();
    assert.equal(preview.AvailableCredit,80);assert.deepEqual(preview.invoices.map(x=>[x.InvoiceId,x.Balance]),[['i',80]]);
    assert.equal(f.commits.length,0);
    const request={...f.apply,Amount:amount};
    assert.equal((await f.run(request)).ok,true);
    const writes=f.commits[0], update=writes.find(w=>w.collectionPath==='invoices');
    assert.equal(update.documentId,'i');assert.equal(update.updateTime,'i-v1');
    assert.equal(update.data.PaidAmount,20+amount);assert.equal(update.data.BalanceAmount,80-amount);
    assert.equal(update.data.Status,amount===80?'Paid':'Part Paid');
    assert.deepEqual(writes.map(w=>w.collectionPath).sort(),['accountSummaries','accountingAudit','accountingJournals','invoices',f.student.__scopePath].sort());
    const summary=writes.find(w=>w.collectionPath==='accountSummaries');
    assert.equal(summary.documentId,f.summaryId);assert.equal(summary.updateTime,'s-v1');assert.equal(summary.data.CreditBalance,80-amount);
    if(managed)assert.equal(summary.data.PendingSchoolFeeCredit,80-amount);
    const journal=writes.find(w=>w.collectionPath==='accountingJournals');
    assert.equal(journal.exists,false);assert.equal(journal.data.TotalDebit,amount);assert.equal(journal.data.TotalCredit,amount);
    assert.equal((await f.run(request)).duplicate,true);assert.equal(f.commits.length,1);
    await assert.rejects(f.run({...request,Amount:1}),/different allocation/);
  });
}
test('reject unauthorised, stale, ineligible and overdrawn allocations with no writes',async()=>{
  const f=fixture();
  for(const change of [{UserRole:'Teacher'},{BranchId:'different'},{UserSchoolSectionAccess:'secondary'},
    {InvoiceId:'store'},{InvoiceId:'paid'},{InvoiceId:'somebody-elses-invoice'},{InvoiceRevision:'old'},{Amount:81},{Amount:0},{Amount:'0.005'}]){
    await assert.rejects(f.run({...f.apply,...change}));
  }
  f.db.accountingPeriodIsClosed=async()=>true;await assert.rejects(f.run(f.apply),/closed/);
  f.db.accountingPeriodIsClosed=async()=>false;f.ledger[0].Credit=35;
  await assert.rejects(f.run({...f.apply,Amount:6}),/exceeds/);
  f.summary.SchoolFeeCreditReviewRequired=true;await assert.rejects(f.run(f.apply),/review/);
  assert.equal(f.commits.length,0);
});

test('another branch or school section cannot use a same-numbered pupil or summary', async () => {
  const f = fixture();
  f.student.BranchId = 'south';
  await assert.rejects(f.run(), /branch/i);
  f.student.BranchId = 'north';
  f.student.SchoolSection = 'secondary';
  await assert.rejects(f.run(), /section/i);
  f.student.SchoolSection = 'primary';
  f.summary.BranchId = 'south';
  await assert.rejects(f.run(f.apply), /branch/i);
  assert.equal(f.commits.length, 0);
});

test('two simultaneous invoice selections cannot both spend the same credit', async () => {
  const f = fixture();
  f.invoices.push({ ...f.invoices[0], __id: 'j', InvoiceId: 'j', PaidAmount: 0, BalanceAmount: 100 });
  let version = 's-v1';
  const commit = f.db.batchCommitDocuments;
  f.db.batchCommitDocuments = async (env, writes) => {
    const summary = writes.find(w => w.collectionPath === 'accountSummaries');
    if (summary.updateTime !== version) throw Error('summary version conflict');
    version = 's-v2';
    await commit(env, writes);
  };
  const results = await Promise.allSettled([f.run(f.apply), f.run({ ...f.apply, InvoiceId: 'j', Reference: 'second' })]);
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected']);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /version conflict/);
  assert.equal(f.commits.length, 1);
});
