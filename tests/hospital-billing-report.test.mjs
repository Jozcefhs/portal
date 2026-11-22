import assert from 'node:assert/strict';
import test from 'node:test';
import { createBillingReport } from '../functions/lib/hospital-billing-report.js';

const now = '2026-11-22T11:20:00.000Z';
const dates = {fromDate:'2026-11-01', toDate:'2026-11-05'};
function fixture(rows, capability='billing.read') {
  const calls = [];
  const load = createBillingReport({
    clock:()=>now, eq:(field,value)=>({field,op:'==',value}),
    requireCapability:name=>assert.equal(name,capability),
    branch:async body=>{assert.equal(body.BranchId,'main');return 'main';},
    page:async (...args)=>{calls.push(args);return {rows, next:{value:now,id:'next'}};}
  });
  return {calls, run:extra=>load({Report:'invoices',BranchId:'main',DateRange:dates,...extra})};
}
test('invoiced balances use existing payer counters and count each unpaid invoice once',async()=>{
  const {calls,run}=fixture([
    {PatientCents:10000,PatientCreditCents:500,PatientPaidCents:4500,PatientRefundCents:100,PatientAllocationReturnCents:200,
      HmoCents:2400,HmoCreditCents:400,CorporateCents:1500,CorporateCreditCents:300,CorporatePaidCents:1200},
    {PatientCents:100,PatientCreditCents:100,PatientPaidCents:70,HmoCents:0,HmoCreditCents:0}
  ]);
  const r=await run();
  assert.equal(r.count,2); assert.equal(r.unpaid,1);
  assert.deepEqual(r.groups[0],{label:'Patient',billed:10100,credits:600,applied:4270,outstanding:5300,overpaid:70});
  assert.equal(r.groups[1].outstanding,2000);assert.equal(r.groups[2].outstanding,0);
  assert.equal(calls.length,1);
  const [name,filters,field,body,options]=calls[0];
  assert.equal(name,'Invoices');assert.equal(field,'CreatedAt');assert.equal(options.readTime,now);
  assert.deepEqual(filters.map(f=>f.value),['main','2026-10-31T23:00:00.000Z','2026-11-05T23:00:00.000Z']);
  assert.ok(!options.select.includes('PatientName'));assert.ok(!options.select.includes('Lines'));
});
test('claims group by insurer and recorded status, with partial settlement preserved',async()=>{
  const {run,calls}=fixture([
    {Insurer:'A',Status:'Submitted',AmountCents:500},
    {Insurer:'A',Status:'Submitted',AmountCents:100},
    {Insurer:'A',Status:'Partially settled',AmountCents:900,SettledCents:250}
  ],'hmo.work');
  const readTime='2026-11-22T11:10:00.000Z';
  const r=await run({Report:'claims',Cursor:{id:'p',value:now},ReadTime:readTime});
  assert.equal(calls[0][0],'Claims');assert.equal(calls[0][4].readTime,readTime);
  assert.deepEqual(r.groups,[{label:'A',status:'Submitted',count:2,claimed:600,settled:0},
    {label:'A',status:'Partially settled',count:1,claimed:900,settled:250}]);
});
test('scope, permissions, dates, and snapshot expiry are checked before reading',async()=>{
  const {run,calls}=fixture([]);
  for(const input of [{BranchId:'other'},{Report:'claims'},{Report:'other'},{DateRange:{}},
    {Cursor:{id:'x'},ReadTime:'2026-11-22T09:00:00.000Z'}]) await assert.rejects(run(input));
  assert.equal(calls.length,0);assert.deepEqual((await run()).groups,[]);
});
