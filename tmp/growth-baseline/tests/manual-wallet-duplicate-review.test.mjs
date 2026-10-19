import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewManualWalletTopup } from '../functions/lib/manual-wallet-duplicate-review.js';
import { paymentAuditSummary } from '../functions/lib/audit-language.js';

const scope = { branchId:'main', schoolSectionAccess:'secondary', references:['TEST/001','APP/001'] };
const student = { __id:'TEST-001', __scopePath:'students', AccountRef:'TEST/001', AdmissionNo:'TEST/001', BranchId:'main', SchoolSection:'secondary', DisplayName:'Test Student' };
const body = { AccountRef:'TEST/001', FeeCode:'WALLET_TOPUP', FeeCategory:'Wallet', Reference:'NEW', Amount:22400, Currency:'NGN', UserUsername:'accounts', RecordedBy:'Test Accountant' };
const payment = (Reference='OLD', extra={}) => ({ ...student, __id:Reference, __updateTime:'v1', Reference, Amount:22400, Currency:'NGN',
  FeeCode:'WALLET_TOPUP', FeeCategory:'Wallet', Status:'Paid', Gateway:'Manual', PaidAt:'2026-10-10T10:00:00Z', RecordedBy:'Test Admin', ...extra });
const call = (options={}) => reviewManualWalletTopup({body,student,scope,payments:[],ledger:[],...options});

test('matching historical batch upload requires review and includes evidence, not a claimed duplicate',async()=>{
  const result=await call({payments:[payment('BATCH',{Channel:'Historical Payment Import',ReceiptNo:'WAL-1'})]});
  assert.equal(result.required,true);assert.equal(result.response.ok,false);assert.equal(result.response.code,'WALLET_DUPLICATE_REVIEW_REQUIRED');
  assert.match(result.response.message,/Possible duplicate/);assert.match(result.response.message,/No new payment was recorded/);
  const review=result.response.duplicateReview;assert.equal(review.MatchCount,1);assert.equal(review.Matches[0].Source,'Batch upload');
  assert.equal(review.Matches[0].ReceiptNo,'WAL-1');assert.equal(review.Matches[0].RecordedBy,'Test Admin');
  assert.equal(review.Matches[0].Date,'2026-10-10T10:00:00Z');assert.ok(review.ReviewDigest);assert.equal(review.Matches[0].Version,undefined);
});

test('one receipt and its ledger count once; legacy ledger-only credits and other payment sources also warn',async()=>{
  const result=await call({payments:[payment('MANUAL'),payment('BANK',{Gateway:'Direct Bank Transfer'}),payment('ONLINE',{Gateway:'Paystack'})],
    ledger:[payment('MANUAL',{Credit:22400,EntryType:'Wallet Deposit'}),payment('LEGACY',{Credit:22400,EntryType:'Wallet Deposit',Gateway:'',Metadata:'Historical payment import'})]});
  assert.equal(result.response.duplicateReview.MatchCount,4);
  assert.equal(result.response.duplicateReview.Matches.find(row=>row.Reference==='LEGACY').Source,'Batch upload');
  assert.ok(result.response.duplicateReview.Matches.some(row=>row.Source==='Direct Bank Transfer'));
});

test('matches are not limited to the recent 80, current session or current wallet balance',async()=>{
  const payments=Array.from({length:125},(_,i)=>payment(`OLD-${i}`,{PaidAt:'2020-01-01',AcademicSession:'2020/2021'}));
  const result=await call({payments,ledger:[payment('SPEND',{Credit:0,Debit:2800000,EntryType:'Wallet Purchase'})]});
  const review=result.response.duplicateReview;assert.equal(review.MatchCount,125);assert.equal(review.Matches.length,50);assert.equal(review.MoreMatches,75);
  assert.doesNotMatch(JSON.stringify(review),/WalletBalance/);
});

test('non-wallet, different amount/currency, pending, fully reversed and same-reference retries do not warn',async()=>{
  assert.equal(await call(),null);
  assert.equal(await call({body:{...body,FeeCode:'SCHOOL_FEES_TOTAL',FeeCategory:'School Fee'},payments:[payment()]}),null);
  assert.equal(await call({payments:[payment('OTHERAMOUNT',{Amount:22399.99}),payment('CURRENCY',{Currency:'USD'}),
    payment('PENDING',{Status:'Pending'}),payment('FEES',{FeeCode:'TUITION',FeeCategory:'School Fee'}),payment('NEW'),payment('REVERSED',{CorrectionTotal:22400})],
    ledger:[payment('REVERSED',{Credit:22400,EntryType:'Wallet Deposit'}),payment('DEBIT',{Credit:0,Debit:22400,EntryType:'Wallet Purchase'})]}),null);
});

test('partially corrected credits show both original and remaining amounts',async()=>{
  const result=await call({payments:[payment('PARTIAL',{CorrectionTotal:400})]});
  assert.equal(result.response.duplicateReview.Matches[0].Amount,22400);assert.equal(result.response.duplicateReview.Matches[0].RemainingCredit,22000);
  await assert.rejects(call({payments:[payment('BAD',{CorrectionTotal:22401})]}),/inconsistent corrections/);
});

test('acknowledgement is bound to the student, amount, reference, currency, actor, scope and matching versions',async()=>{
  const payments=[payment()], first=await call({payments}), digest=first.response.duplicateReview.ReviewDigest;
  const acknowledged=await call({payments,body:{...body,DuplicateWalletReviewDigest:digest}});
  assert.equal(acknowledged.required,false);assert.equal(acknowledged.acknowledgement.ReviewedBy,'Test Accountant');
  assert.deepEqual(acknowledged.acknowledgement.References,['OLD']);
  for(const change of [{Reference:'ANOTHER'},{UserUsername:'different'},{AccountRef:'APP/001'},{PaidAt:'2026-10-14'},{AcademicSession:'other'}]) {
    assert.equal((await call({payments,body:{...body,DuplicateWalletReviewDigest:digest,...change}})).required,true);
  }
  for(const changedPayments of [[payment('OLD',{__updateTime:'v2'})],[payment(),payment('RECENT')]]) {
    assert.equal((await call({payments:changedPayments,body:{...body,DuplicateWalletReviewDigest:digest}})).required,true);
  }
  assert.equal((await call({payments:[payment('OLD',{Amount:10000})],body:{...body,Amount:10000,DuplicateWalletReviewDigest:digest}})).required,true);
  assert.equal((await call({payments:[payment('OLD',{Currency:'USD'})],body:{...body,Currency:'USD',DuplicateWalletReviewDigest:digest}})).required,true);
});

test('student, branch, section and conflicting account ownership are checked before evidence is returned',async()=>{
  for (const options of [{student:null},{scope:null},{payments:[payment('FOREIGN',{BranchId:'north'})]},
    {ledger:[payment('FOREIGN',{Credit:22400,SchoolSection:'primary'})]},{payments:[payment('FOREIGN',{AdmissionNo:'OTHER'})]}]) {
    await assert.rejects(call(options),{status:403});
  }
});

test('review digest is deterministic despite source ordering and invalid acknowledgements never silently continue',async()=>{
  const a=await call({payments:[payment('A'),payment('B')]}),b=await call({payments:[payment('B'),payment('A')]});
  assert.equal(a.response.duplicateReview.ReviewDigest,b.response.duplicateReview.ReviewDigest);
  for(const digest of [true,'yes','wrong',{}]) assert.equal((await call({payments:[payment()],body:{...body,DuplicateWalletReviewDigest:digest}})).required,true);
});

test('recorded audit wording distinguishes an acknowledged new credit from an idempotent retry',()=>{
  const p={...payment(),DuplicateWalletReview:{MatchCount:2,ReviewedBy:'Test Accountant'}};
  assert.match(paymentAuditSummary(p),/confirmed this was a separate payment after reviewing 2 existing same-amount wallet credit/);
  assert.doesNotMatch(paymentAuditSummary(p,{duplicate:true}),/credited|confirmed this was a separate/);
});

test('public desktop manual entry always enables review; clients cannot post a flag to disable it',()=>{
  const source=readFileSync(new URL('../functions/api/backend.js',import.meta.url),'utf8');
  assert.match(source,/case 'recordManualPayment':[\s\S]*?return recordManualPayment\(env, body, \{ reviewWalletDuplicates: true \}\)/);
  assert.match(source,/if \(!payment && reviewWalletDuplicates\)/);
  assert.match(source,/strict: reviewWalletDuplicates/);
});
