import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHospitalService } from '../functions/lib/hospital-service.js';
import { buildStructuredQuery } from '../functions/lib/firestore.js';
import { actor, env, fixture } from './helpers/hospital-fixture.mjs';

const registers = {
  hospitalPatients:'Patients', hospitalReception:'Visits', hospitalTriage:'ClinicalEntries',
  hospitalConsultations:'Consultations', hospitalOrders:'Orders', hospitalPharmacy:'Orders',
  hospitalLaboratory:'Orders', hospitalImaging:'Orders', hospitalTheatre:'ProcedureCases',
  hospitalNursing:'NursingHandovers', hospitalInpatients:'Admissions', hospitalBilling:'Payments', hospitalHmo:'Claims'
};
const readTime = '2026-11-21T08:00:00.000Z';
function setup(user, rows) {
  const f = fixture(user);
  const queries = [];
  const service = createHospitalService(env, user, { ...f.db, async countCollection(_, path, options) {
    const { structuredQuery } = buildStructuredQuery(path, options);
    if (path.endsWith('/hospitalPatients')) assert.equal(structuredQuery.where.fieldFilter.op, 'ARRAY_CONTAINS');
    queries.push({path, ...options});
    const count = rows.filter(row => options.filters.every(({field, op, value}) =>
      op === 'ARRAY_CONTAINS' ? row[field]?.includes(value) : row[field] === value)).length;
    return { count, readTime };
  }});
  return { dashboard: (Module, BranchId='main') => service.moduleDashboard({ Module, BranchId }), queries, f };
}
for (const [key, name] of Object.entries(registers)) {
  test(key + ' dashboard reads only its branch register and returns empty counts without further reads', async () => {
    const { dashboard, queries, f } = setup({ ...actor, allowedSections:[key] }, [{BranchId:'north',AccessBranchIds:['north']}]);
    const result = await dashboard(key);
    assert.equal(result.total.count, 0);
    assert.ok(result.metrics.every(metric => metric.count === 0));
    assert.equal(queries.length, 1);
    assert.ok(queries[0].path.endsWith('/hospital' + name));
    assert.equal(f.commits.length + f.reads.length + f.queries.length, 0);
  });
}
test('pharmacy indicators count only prescriptions and share the total snapshot', async () => {
  const { dashboard, queries } = setup({ ...actor, allowedSections:['hospitalPharmacy'] }, [
    {BranchId:'main',Kind:'Prescription',Status:'Ready to dispense'}, {BranchId:'main',Kind:'Imaging',Status:'Requested'},
    {BranchId:'north',Kind:'Prescription',Status:'Awaiting pharmacy review'}
  ]);
  const data = await dashboard('hospitalPharmacy');
  assert.equal(data.total.count, 1);
  assert.deepEqual(data.metrics.map(m => m.count), [0,1,0]);
  assert.ok(queries.slice(1).every(q => q.readTime === readTime));
});
test('unassigned module, unknown module and other branches cannot read the registers', async () => {
  const { dashboard, queries } = setup(actor, []);
  for(const [key, branch] of [['hospitalBilling','main'],['constructor','main'],['hospitalPatients','north'],['hospitalPatients','all']]) {
    await assert.rejects(dashboard(key, branch));
  }
  assert.equal(queries.length, 0);
});
test('every hospital sidebar module is wired to the final panel renderer and has a workflow', () => {
  const read = path => readFileSync(new URL(path, import.meta.url),'utf8');
  const admin = read('../js/admin.js');
  const ui = read('../js/hospital-module-dashboards.js');
  const keys = [...admin.slice(admin.indexOf('const tabConfig = ['), admin.indexOf("['recordsDesk'",admin.indexOf('const tabConfig = ['))).matchAll(/\['(hospital\w+)'/g)].map(m => m[1]);
  assert.deepEqual(keys.sort(), Object.keys(registers).sort());
  assert.ok(keys.every(key => ui.includes(key + ': [')));
  assert.match(admin.slice(admin.indexOf('function renderSection(active)')), /dashboards\.mount\(panelEl,/);
});
