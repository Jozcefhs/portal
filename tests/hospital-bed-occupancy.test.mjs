import test from 'node:test';
import assert from 'node:assert/strict';
import {createHospitalInpatientService} from '../functions/lib/hospital-inpatient-service.js';
const range={fromDate:'2026-11-01',toDate:'2026-11-02'};
const snapshot='2026-11-22T09:00:00.000Z';
function fixture(records, allowed=true) {
  const calls=[];
  const db={async countCollection(env,path,options) {
    calls.push(options);
    assert.equal(path,'Admissions');
    const count=records.filter(row=>options.filters.every(({field,op,value})=>
      op==='=='?row[field]===value:op==='<'?row[field]<value:row[field]>=value)).length;
    return {count,readTime:snapshot};
  }};
  const service=createHospitalInpatientService({env:{},db,clock:()=>snapshot,collection:x=>x,branch:async()=>'main',
    requireCapability:c=>{assert.equal(c,'inpatient.read');if(!allowed)throw Error('Denied');},
    eq:(field,value)=>({field,op:'==',value})});
  return {calls,load:DateRange=>service.inpatientOccupancyReport({DateRange})};
}
test('opening, admissions and discharge reconcile across WAT boundaries at one snapshot',async()=>{
  const rows=[['main','2026-10-23','2026-10-27'],['main','2026-10-25','2026-10-31T23:00:00.000Z'],
    ['main','2026-11-01','2026-11-01T20:00:00Z'],['main','2026-11-02'],['other','2026-11-01'],
    ['main','2026-11-02T23:00:00.000Z']].map(([BranchId,CreatedAt,DischargedAt])=>({BranchId,CreatedAt,DischargedAt}));
  const {calls,load}=fixture(rows);
  assert.deepEqual(await load(range),{ok:true,branchId:'main',opening:1,admissions:2,discharges:2,closing:1,readTime:snapshot});
  assert.equal(calls.length,4);assert.ok(calls.slice(1).every(q=>q.readTime===snapshot));
});
test('empty period and invalid or unauthorised requests',async()=>{
  const {load,calls}=fixture([]); assert.equal((await load(range)).closing,0);assert.equal(calls.length,3);
  for(const invalid of [{},{fromDate:'2026-01-01',toDate:'2026-11-01'},{fromDate:'2027-01-01',toDate:'2027-01-02'}])
    await assert.rejects(load(invalid));
  assert.equal(calls.length,3);
  const denied=fixture([],false);await assert.rejects(denied.load(range));assert.equal(denied.calls.length,0);
});
