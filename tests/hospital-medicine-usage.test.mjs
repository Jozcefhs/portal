import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, request } from './helpers/hospital-fixture.mjs';
import { actors, medicine } from './helpers/hospital-orders-fixture.mjs';

const range={fromDate:'2026-10-26',toDate:'2026-10-26'};
function setup(actor=actors.pharmacist) {
  const f=fixture(actor), root='hospitalWorkspaces/test-hospital/hospital';
  const label={...medicine,MedicineKey:'tablet-1'};
  const movement=(id,type,fields={})=>f.store.set(root+'StockMovements/'+id,{__id:id,BranchId:'main',BatchId:'batch-aaa',
    Type:type,CreatedAt:'2026-10-25T23:00:00.000Z',Quantity:-1,UsageMedicine:label,...fields});
  const report=(fields={})=>f.service.getMedicineUsage(request({DateRange:range,...fields}));
  return {...f,root,label,movement,report};
}
test('usage reflects signed pharmacy movements by period and unit, without writes or patient reads',async()=>{
  const f=setup();
  f.movement('d','Dispense',{Quantity:-1.125,EmergencyReference:'private'});
  f.movement('r','Patient return',{Quantity:0,QuarantinedQuantity:2});
  f.movement('other','Dispense',{Quantity:-0.5,UsageMedicine:{...f.label,MedicineKey:'liquid',Form:'Liquid',Unit:'mL'}});
  f.movement('early','Dispense',{CreatedAt:'2026-10-25T22:59:59.999Z'});
  f.movement('late','Dispense',{CreatedAt:'2026-10-26T23:00:00.000Z'});
  f.movement('north','Dispense',{BranchId:'north'});
  for(const type of ['Receipt','Quarantine','Disposal']) f.movement(type,type);
  const before=structuredClone([...f.store]);
  const result=await f.report();
  assert.deepEqual(result.groups.map(g=>[g.key,g.dispensed,g.returned]),[['tablet-1',1.125,2],['liquid',0.5,0]]);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(f.queries.length,1);assert.equal(f.reads.length,0);assert.equal(f.commits.length,0);
  assert.deepEqual([...f.store],before);
});
test('historical movements resolve a distinct batch once per page and do not merge unresolved batches', async()=>{
  const f=setup();
  f.store.set(f.root+'MedicineBatches/batch-aaa',{BranchId:'main',...f.label});
  for(const key of ['a','b','c']) f.movement(key,'Dispense',{UsageMedicine:undefined});
  f.movement('d','Patient return',{BatchId:'absent-batch',UsageMedicine:undefined,Quantity:0,QuarantinedQuantity:0.5});
  const result=await f.report();
  assert.equal(f.reads.length,2);assert.equal(f.queries.length,1);assert.equal(f.commits.length,0);
  assert.deepEqual(result.groups.map(g=>[g.key,g.dispensed,g.returned]),[['tablet-1',3,0],['unknown:absent-batch',0,0.5]]);
});
test('pages share a stable snapshot and retries produce the same totals without writes',async()=>{
  const f=setup();
  for(let i=0;i<34;i++) f.movement('movement-'+i,'Dispense');
  const a=await f.report(), args={Cursor:a.next,ReadTime:a.readTime};
  const b=await f.report(args);assert.deepEqual(await f.report(args),b);
  assert.equal(b.next,null);assert.equal(a.groups[0].dispensed,30);assert.equal(b.groups[0].dispensed,4);
  assert.ok(f.queries.every(q=>q.readTime===a.readTime && q.limit===31));
  await assert.rejects(f.report({...args,ReadTime:'2020-01-01T00:00:00.000Z'}),{status:409});
  assert.equal(f.queries.length,3);assert.equal(f.commits.length,0);
});
test('invalid periods, branches and unauthorised staff are rejected before querying movements', async()=>{
  for(const [actor,fields] of [[actors.laboratory,{}],[actors.pharmacist,{BranchId:'north'}],[actors.pharmacist,{DateRange:{fromDate:'2025-01-01',toDate:'2026-10-26'}}]]){
    const f=setup(actor);await assert.rejects(f.report(fields));assert.equal(f.queries.length+f.commits.length+f.reads.length,0);
  }
});
