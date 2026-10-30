import test from 'node:test';
import assert from 'node:assert/strict';
import {financeRequestPage,completedFinanceRequest} from '../functions/lib/finance-request-queue.js';
import {buildStructuredQuery} from '../functions/lib/firestore.js';
const now='2026-10-30T11:00:00.000Z', user={username:'officer',role:'Super Admin',branchId:'main'};
function fixture(records=[],mode='indexed') {
  const calls=[],original=structuredClone(records);
  const rows=records.map((r,i)=>({...r,__name:`projects/p/databases/(default)/documents/accountingExpenses/r${String(i).padStart(4,'0')}`}));
  const db={now:()=>now,branchReadPlan:async()=>({mode}),queryCollection:async(_env,collection,options)=>{
    calls.push(options);buildStructuredQuery(collection,options);
    let selected=rows.filter(r=>options.filters.every(f=>f.op==='=='?r[f.field]===f.value:f.op==='in'?f.value.includes(r[f.field]):f.op==='not-in'?!f.value.includes(r[f.field]):f.op==='>='?r[f.field]>=f.value:r[f.field]<=f.value));
    const field=options.orderBy[0].field;selected.sort((a,b)=>a[field].localeCompare(b[field])||a.__name.localeCompare(b.__name));
    if(options.startAfterName)selected=selected.filter(r=>r[field]>options.startAfterFieldValue||(r[field]===options.startAfterFieldValue&&r.__name>options.startAfterName));
    return selected.slice(0,options.limit);
  }};
  return {calls,db,assertPreserved:()=>assert.deepEqual(records,original)};
}
test('old submitted, confirmed, approved and returned-for-edit requests load without dates in every edition',async()=>{
  for(const edition of ['school','faith','organization','hospital']) {
    const records=['Submitted','Accounts Confirmed','Admin Reviewed','Approved','Rejected','Posted','Paid'].map(Status=>({Status,BranchId:'main',Date:'2020-01-01'}));
    const f=fixture(records),r=await financeRequestPage({ORGANISATION_EDITION:edition},user,'requisitions',{},r=>r,f.db);
    assert.deepEqual(r.rows.map(r=>r.Status).sort(),['Submitted','Accounts Confirmed','Admin Reviewed','Approved','Rejected'].sort());
    assert.equal(r.view,'pending');assert.equal(f.calls.length,1);assert.ok(!f.calls[0].filters.some(f=>f.field==='Date'));assert.equal(f.calls[0].limit,51);f.assertPreserved();
  }
});
test('posted supplier bills and unretired advances remain open until their workflow is complete',()=>{
  assert.equal(completedFinanceRequest('bills',{Status:'Posted'}),false);
  for(const Status of ['Submitted','Approved','Issued','Retirement Submitted'])assert.equal(completedFinanceRequest('imprests',{Status}),false);
  for(const Status of ['Retired','Rejected','Cancelled'])assert.equal(completedFinanceRequest('imprests',{Status}),true);
  assert.equal(completedFinanceRequest('bills',{Status:'Paid'}),true);
});
test('completed history requires valid dates before any database access and never mixes pending requests',async()=>{
  const f=fixture([{Status:'Paid',BranchId:'main',Date:'2026-10-30'},{Status:'Paid',BranchId:'main',Date:'2020-01-01'},{Status:'Submitted',BranchId:'main',Date:'2026-10-30'}]);
  for(const dates of [{view:'completed'},{view:'completed',fromDate:'2026-02-30',toDate:'2026-03-01'}])await assert.rejects(financeRequestPage({},user,'requisitions',{HistoryDateRange:dates},r=>r,f.db),/valid/);
  assert.equal(f.calls.length,0);
  const r=await financeRequestPage({},user,'requisitions',{HistoryDateRange:{view:'completed',fromDate:'2026-10-30',toDate:'2026-10-30'}},r=>r,f.db);
  assert.equal(r.rows.length,1);assert.equal(r.rows[0].Status,'Paid');assert.equal(r.next,'');f.assertPreserved();
});
test('same-status pagination preserves every request without duplicates and binds cursors to scope',async()=>{
  const f=fixture(Array.from({length:113},()=>({Status:'Submitted',BranchId:'main',Date:'2020-01-01'})));
  const first=await financeRequestPage({},user,'requisitions',{},r=>r,f.db),second=await financeRequestPage({},user,'requisitions',{QueueCursor:first.next},r=>r,f.db),last=await financeRequestPage({},user,'requisitions',{QueueCursor:second.next},r=>r,f.db);
  assert.deepEqual([first.rows.length,second.rows.length,last.rows.length],[50,50,13]);assert.equal(new Set([...first.rows,...second.rows,...last.rows].map(r=>r.__name)).size,113);assert.equal(last.next,'');
  for(const [other,kind,extra] of [[{...user,branchId:'east'},'requisitions',{}],[user,'bills',{}],[user,'requisitions',{HistoryDateRange:{view:'completed',fromDate:'2026-10-01',toDate:'2026-10-30'}}]])await assert.rejects(financeRequestPage({},other,kind,{QueueCursor:first.next,...extra},r=>r,f.db),/another view/);
  const expired={...JSON.parse(first.next),readTime:'2026-10-30T09:00:00Z'};await assert.rejects(financeRequestPage({},user,'requisitions',{QueueCursor:JSON.stringify(expired)},r=>r,f.db),/expired/);
  f.assertPreserved();
});
test('legacy branch coverage still enforces officer visibility, with a bounded scan and continuation',async()=>{
  const f=fixture(Array.from({length:280},(_,i)=>({Status:'Submitted',BranchId:i===270?'main':'east',Date:'2020-01-01'})),'legacy');
  const visible=rows=>rows.filter(r=>r.BranchId==='main');
  const first=await financeRequestPage({},user,'requisitions',{},visible,f.db);assert.equal(first.rows.length,0);assert.ok(first.next);assert.equal(f.calls.length,5);
  const next=await financeRequestPage({},user,'requisitions',{QueueCursor:first.next},visible,f.db);assert.equal(next.rows.length,1);assert.equal(next.next,'');f.assertPreserved();
});
test('query failures are surfaced and invalid queue selections never query history',async()=>{
  await assert.rejects(financeRequestPage({},user,'anything',{},r=>r,{branchReadPlan:()=>assert.fail('Unexpected query')}),/valid request queue/);
  await assert.rejects(financeRequestPage({},user,'requisitions',{},r=>r,{branchReadPlan:async()=>({mode:'indexed'}),queryCollection:async()=>{throw Error('Index unavailable');}}),/Index unavailable/);
});
