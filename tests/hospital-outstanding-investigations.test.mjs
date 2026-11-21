import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, env, request } from './helpers/hospital-fixture.mjs';
import { actors } from './helpers/hospital-orders-fixture.mjs';
import { createHospitalService } from '../functions/lib/hospital-service.js';

const period = {fromDate:'2026-10-26',toDate:'2026-10-26'};
function setup(user = actors.doctor) {
  const f = fixture(user);
  const path = 'hospitalWorkspaces/test-hospital/hospitalOrders/';
  const add = (number, status, kind='Laboratory', extra={}) => {
    const id = 'order-' + String(number).padStart(5,'0');
    f.store.set(path+id,{ __id:id, OrderNumber:'INV-'+number, Kind:kind, Status:status, BranchId:'main',
      CreatedAt:'2026-10-25T23:00:00.000Z', Fields:{Service:'Synthetic investigation', Priority:'Urgent'},
      PatientName:'Synthetic patient', HospitalNumber:'Patient number', ...extra });
  };
  const report = (extra={}) => f.service.getOutstandingInvestigations(request({Kind:'All',DateRange:period,...extra}));
  return {...f,add,report};
}
test('investigations include verified, rejected specimens and open amendments in the WAT order period', async () => {
  const f=setup();
  f.add(1,'Released'); f.add(2,'Cancelled'); f.add(3,'Result draft','Imaging',{ReleasedReportId:'earlier'});
  f.add(4,'Specimen rejected'); f.add(5,'Verified','Imaging'); f.add(6,'Requested','Prescription');
  f.add(7,'Requested','Laboratory',{BranchId:'north'}); f.add(8,'Requested','Laboratory',{CreatedAt:'2026-10-26T23:00:00.000Z'});
  f.add(9,'Requested','Laboratory',{EmergencyReference:'WRIST-001'});
  const before=structuredClone([...f.store]);
  const r=await f.report();
  assert.equal(r.orders.length,4);
  assert.deepEqual(new Set(r.orders.map(o=>o.stage)),new Set(['Awaiting verification','Recollection needed','Awaiting release','Requested']));
  assert.equal(r.orders.find(o=>o.number==='INV-9').reference,'WRIST-001');
  assert.equal(r.groups.reduce((s,g)=>s+g.urgent,0),4);
  assert.deepEqual([...f.store].filter(([p])=>p.includes('/hospitalOrders/')),before);
  assert.equal(f.queries.length,1);
  assert.ok(f.commits.flat().every(w=>w.collectionPath.endsWith('/hospitalAudit')));
});
test('configuration access receives only counts with no patient fields queried or audit writes', async () => {
  const user={...actors.doctor,role:'Hospital Administrator',allowedSections:['hospitalLaboratory']};
  const f=setup(user); f.add(1,'Requested'); f.add(2,'Verified','Imaging');
  const r=await f.report();
  assert.deepEqual(r.departments,['Laboratory']); assert.deepEqual(r.orders,[]);
  assert.deepEqual(r.groups,[{kind:'Laboratory',stage:'Requested',count:1,urgent:1}]);
  assert.ok(!JSON.stringify(r).includes('Synthetic patient'));
  assert.deepEqual(f.queries[0].select,['Kind','Status','CreatedAt','Fields.Priority']);
  assert.equal(f.reads.length+f.commits.length,0);
  await assert.rejects(f.report({Kind:'Imaging'}),{status:403});
});
test('pages use stable order IDs and one snapshot, with bounded reads and no duplicated retry audit', async () => {
  const f=setup(); for(let i=1;i<=33;i++)f.add(i,i<=30?'Requested':'Verified','Imaging');
  const a=await f.report(); assert.ok(a.next);assert.equal(a.orders.length,30);
  const extra={Cursor:a.next,ReadTime:a.readTime,RequestId:crypto.randomUUID()};
  const b=await f.report(extra), retry=await f.report(extra);
  assert.deepEqual(retry,b);
  assert.equal(b.next,null); assert.equal(new Set(b.orders.map(o=>o.id)).size,3);
  assert.equal(f.rows('Audit').length,2);
  assert.equal(new Set([...a.orders,...b.orders].map(o=>o.id)).size,33);
  assert.ok(f.queries.every(q=>q.limit===31 && q.readTime===a.readTime));
  await assert.rejects(f.report({...extra,ReadTime:'2026-10-26T08:00:00.000Z'}),{status:409});
  assert.equal(f.queries.length,3);
});
test('unauthorised branches and departments and invalid ranges cause no register reads',async()=>{
  const f=setup(actors.laboratory);
  for(const payload of [{Kind:'Prescription'},{Kind:'Imaging'},{BranchId:'north'},{DateRange:{fromDate:'2020-01-01',toDate:'2026-10-26'}}]) {
    await assert.rejects(f.report(payload));
  }
  await assert.rejects(createHospitalService(env,actors.pharmacist,f.db).getOutstandingInvestigations(request({Kind:'All',DateRange:period})),{status:403});
  assert.equal(f.queries.length,0);
});
