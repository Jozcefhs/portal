import test from 'node:test';
import assert from 'node:assert/strict';
import { createHospitalService } from '../functions/lib/hospital-service.js';
import { cardUid, hospitalCapabilities } from '../functions/lib/hospital-model.js';
import { resolveOrganizationConfig, staffRoleAllowedForEdition, featureFlagsForEdition } from '../functions/lib/organization-config.js';
import { defaultModulesForRole, modulesForEdition } from '../functions/lib/role-module-access.js';
import { subscriptionModulesForEdition, subscriptionPlanEntitlements, normalizeSubscriptionPlanCatalog } from '../functions/lib/subscription-plans.js';
import { requiredDeploymentIdentity } from '../functions/lib/deployment-identity.js';

import { env, actor, profile, request, fixture } from './helpers/hospital-fixture.mjs';

test('a standalone Hospital owner demo includes clinical modules while keeping explicit preferences', () => {
  const config=resolveOrganizationConfig({env,organizationProfile:{OwnerDemo:true,Plan:'Owner Demo'}});
  for(const key of ['hospitalConsultations','hospitalNursing','hospitalPharmacy','hospitalLaboratory','hospitalBilling'])assert.equal(config.FeatureFlags[key],true,key);
  assert.equal(config.FeatureFlags.students,false);
  const limited=resolveOrganizationConfig({env,organizationProfile:{OwnerDemo:true,Plan:'Owner Demo',DisabledFeatureEntitlements:['hospitalPharmacy']}});
  assert.equal(limited.FeatureFlags.hospitalPharmacy,false);
});

test('Hospital has a distinct identity, catalogue and dependency-aware plans', () => {
  assert.equal(requiredDeploymentIdentity(env).edition, 'hospital');
  const config = resolveOrganizationConfig({ env });
  assert.equal(config.Name, 'Your Hospital Name');
  assert.equal(config.FeatureFlags.hospitalPatients, true);
  assert.equal(config.FeatureFlags.students, false);
  assert.ok(subscriptionPlanEntitlements('Starter', 'hospital').includes('hospitalPatients'));
  assert.ok(normalizeSubscriptionPlanCatalog().Plans.Professional.EntitlementsByEdition.hospital.includes('hospitalReception'));
  assert.ok(!subscriptionModulesForEdition('school').some(row => row.Key.startsWith('hospital')));
  assert.ok(!modulesForEdition('faith').some(row => row.key.startsWith('hospital')));
  assert.equal(staffRoleAllowedForEdition('Doctor', 'hospital'), true);
  assert.equal(staffRoleAllowedForEdition('Doctor', 'school'), false);
  assert.equal(staffRoleAllowedForEdition('Teacher', 'hospital'), false);
});

test('cashiers and finance staff do not gain patient access from shared administration', () => {
  for (const role of ['Accounts Officer', 'Payroll Officer', 'External Auditor']) {
    assert.deepEqual(hospitalCapabilities({ ...actor, role }), []);
    assert.ok(!defaultModulesForRole(role, { edition: 'hospital', featureFlags: featureFlagsForEdition('hospital') }).includes('hospitalPatients'));
  }
});

test('other editions cannot open the Hospital service', () => {
  assert.throws(() => fixture(actor, { ...env, ORGANISATION_EDITION: 'school' }), /Hospital edition/);
  assert.throws(() => fixture({ ...actor, edition: 'school' }), /Hospital edition/);
});

test('opening the workspace loads only branch settings and no patient or visit history', async () => {
  const f = fixture(), state = await f.service.state();
  assert.deepEqual(state.branches.map(row => row.id), ['main']);
  assert.equal(f.queries.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.commits.length, 0);
});

test('registration replay and concurrent retries create one patient, number and audit event', async () => {
  const f = fixture(), input = request({ Patient: profile });
  const results = await Promise.all([f.service.savePatient(input), f.service.savePatient(input)]);
  assert.equal(results[0].PatientId, results[1].PatientId);
  assert.equal(f.rows('Patients').length, 1); assert.equal(f.rows('Numbers').length, 1);
  assert.equal(f.rows('Audit').length, 1); assert.equal(f.rows('Operations').length, 1);
  assert.equal((await f.service.savePatient(input)).replayed, true);
  await assert.rejects(f.service.savePatient({ ...input, Patient: { ...profile, FirstName: 'Different' } }), /different information/);
});

test('invalid dates and forged patient fields cannot create unsafe records', async () => {
  const f = fixture();
  await assert.rejects(f.register({ Patient: { ...profile, DateOfBirth: '2026-02-30' } }), /valid date/);
  await assert.rejects(f.register({ Patient: { ...profile, DateOfBirth: '2027-01-01' } }), /valid date/);
  const result = await f.register({ Patient: { ...profile, CardKey: 'forged', AccessBranchIds: ['north'], Status: 'Deleted' } });
  const row = f.rows('Patients')[0]; assert.equal(row.PatientId, result.PatientId);
  assert.deepEqual(row.AccessBranchIds, ['main']); assert.equal(row.CardKey, undefined); assert.equal(row.Status, 'Active');
});

test('registration edits require the current revision and preserve identity and NFC linkage', async () => {
  const f = fixture(), { PatientId } = await f.register(), patient = await f.details(PatientId);
  const body = request({ PatientId, Revision: patient.Revision, Patient: { ...profile, Phone: '08111111111' } });
  await f.service.savePatient(body);
  await assert.rejects(f.service.savePatient(request({ ...body, RequestId: crypto.randomUUID() })), /changed/);
  assert.equal((await f.details(PatientId)).HospitalNumber, patient.HospitalNumber);
});

test('branch-scoped users and empty assignments cannot search or view another branch', async () => {
  const f = fixture(), { PatientId } = await f.register();
  await assert.rejects(f.service.search(request({ BranchId: 'north', Query: 'Patient' })), /assigned access/);
  const other = createHospitalService(env, { ...actor, assignedBranchIds: ['north'] }, f.db);
  await assert.rejects(other.details(request({ BranchId: 'north', PatientId })), /not available/);
  assert.equal((await other.search(request({ BranchId: 'north', Query: 'Patient' }))).patients.length, 0);
  const none = createHospitalService(env, { ...actor, assignedBranchIds: [] }, f.db);
  await assert.rejects(none.search(request({ Query: 'Patient' })), /assigned access/);
});

test('explicitly removed modules and read-only subscriptions block writes', async () => {
  const f = fixture({ ...actor, allowedSections: [] });
  await assert.rejects(f.register(), /role does not permit/);
  await assert.rejects(fixture({ ...actor, subscriptionReadOnly: true }).register(), /viewing only/);
});

test('patient queries are limited and branch-filtered and cannot load the entire register', async () => {
  const f = fixture(); await f.register();
  await assert.rejects(f.service.search(request({ Query: '' })), /at least two/);
  const result = await f.service.search(request({ Query: 'patient' }));
  assert.equal(result.patients.length, 1); assert.equal(result.patients[0].Phone, undefined);
  assert.equal(f.queries[0].limit, 31);
  assert.ok(f.queries[0].filters.some(row => row.field === 'AccessBranchIds' && row.value === 'main'));
});

test('NFC serial formats normalise consistently without accepting malformed cards', () => {
  assert.equal(cardUid('04:00:AA:BB:CC:DD:EE'), '0400AABBCCDDEE');
  assert.equal(cardUid('01 02 03 04'), '01020304');
  assert.throws(() => cardUid('patient/medical/file'), /hexadecimal/);
});

test('NFC assignment and lookup use an opaque index, not raw UID or medical data', async () => {
  const f = fixture(), { PatientId } = await f.register(), patient = await f.details(PatientId);
  await f.service.assignCard(request({ PatientId, Revision: patient.Revision, CardUid: '04:00:AA:BB:CC:DD:EE' }));
  const input = request({ CardUid: '0400AABBCCDDEE' });
  assert.equal((await f.service.search(input)).patients[0].PatientId, PatientId);
  const logs = f.rows('Audit').length; await f.service.search(input); assert.equal(f.rows('Audit').length, logs);
  assert.equal(f.queries.length, 0);
  assert.ok(!JSON.stringify([...f.store]).includes('0400AABBCCDDEE'));
});

test('concurrent assignment cannot give the same NFC card to two patients', async () => {
  const f = fixture(), a = await f.register(), b = await f.register({ Patient: { ...profile, FirstName: 'Second' } });
  const aRow = await f.details(a.PatientId), bRow = await f.details(b.PatientId);
  const results = await Promise.allSettled([aRow, bRow].map(row => f.service.assignCard(request({ PatientId: row.PatientId, Revision: row.Revision, CardUid: '01020304' }))));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(f.rows('Cards').length, 1); assert.equal(f.rows('Patients').filter(row => row.CardKey).length, 1);
});

test('replacing and revoking a card invalidates previous cards and preserves history', async () => {
  const f = fixture(), { PatientId } = await f.register();
  let row = await f.details(PatientId);
  await f.service.assignCard(request({ PatientId, Revision: row.Revision, CardUid: '01020304' }));
  row = await f.details(PatientId);
  await assert.rejects(f.service.assignCard(request({ PatientId, Revision: row.Revision, CardUid: '05060708' })), /reason/);
  await f.service.assignCard(request({ PatientId, Revision: row.Revision, CardUid: '05060708', Reason: 'Lost card' }));
  await assert.rejects(f.service.search(request({ CardUid: '01020304' })), /not active/);
  row = await f.details(PatientId);
  await f.service.revokeCard(request({ PatientId, Revision: row.Revision, Reason: 'Replacement no longer required' }));
  await assert.rejects(f.service.search(request({ CardUid: '05060708' })), /not active/);
  assert.deepEqual(f.rows('Cards').map(card => card.Status).sort(), ['Replaced', 'Revoked']);
  assert.equal(f.rows('Patients').length, 1);
});

test('reception dates are mandatory and use WAT day boundaries', async () => {
  const f = fixture();
  await assert.rejects(f.service.visits(request()), /Choose valid/);
  assert.equal(f.queries.length, 0);
  await f.service.visits(request({ DateRange: { fromDate: '2026-10-26', toDate: '2026-10-26' } }));
  assert.deepEqual(f.queries[0].filters.slice(1).map(row => row.value), ['2026-10-25T23:00:00.000Z', '2026-10-26T23:00:00.000Z']);
});

test('check-in retry and competing requests cannot create duplicate open visits', async () => {
  const f = fixture(), { PatientId } = await f.register(), body = request({ PatientId, Department: 'Outpatients' });
  const first = await f.service.checkIn(body);
  assert.equal((await f.service.checkIn(body)).VisitId, first.VisitId);
  await assert.rejects(f.service.checkIn(request({ PatientId, Department: 'Outpatients' })), /already has an open visit/);
  assert.equal(f.rows('Visits').length, 1);
  const row = f.rows('Visits')[0];
  await f.service.updateVisit(request({ VisitId: row.VisitId, Revision: row.__updateTime, Status: 'Completed' }));
  await f.service.checkIn(request({ PatientId, Department: 'Outpatients' }));
  assert.equal(f.rows('Visits').length, 2); assert.equal(f.rows('Visits')[0].Status, 'Completed');
});

test('a new request for a matching identity requires documented review without merging records', async () => {
  const f = fixture(), first = await f.register();
  await assert.rejects(f.register(), /matching patient registration/);
  assert.equal(f.rows('Patients').length, 1);
  const second = await f.register({ DuplicateReviewReason: 'Confirmed different persons from identification documents.' });
  assert.notEqual(first.PatientId, second.PatientId);
  assert.equal(f.rows('Patients').length, 2);
  assert.match(f.rows('Audit').at(-1).DuplicateReviewReason, /different persons/);
});

test('working-branch policies cannot be reused in another assigned branch', async () => {
  const f = fixture({ ...actor, assignedBranchIds: ['main', 'north'], activeBranchId: 'main' });
  assert.deepEqual((await f.service.state()).branches.map(row => row.id), ['main', 'north']);
  await assert.rejects(f.service.search(request({ BranchId: 'north', Query: 'patient' })), /working branch/);
  assert.equal(f.queries.length, 0);
});

test('patient pagination is bounded and does not repeat or skip equal surname matches', async () => {
  const f = fixture();
  for (let i = 0; i < 33; i++) await f.register({ Patient: { ...profile, FirstName: `Person${String(i).padStart(2,'0')}` } });
  const first = await f.service.search(request({ Query: 'patient' }));
  const second = await f.service.search(request({ Query: 'patient', Cursor: first.next }));
  assert.equal(first.patients.length, 30); assert.equal(second.patients.length, 3); assert.equal(second.next, null);
  assert.equal(new Set([...first.patients,...second.patients].map(row => row.PatientId)).size, 33);
});

test('a lost card-assignment response can be retried without another assignment or audit', async () => {
  const f = fixture(), saved = await f.register(), row = await f.details(saved.PatientId);
  const input = request({ PatientId:row.PatientId,Revision:row.Revision,CardUid:'01020304' });
  const original = f.db.batchCommitLiteralDocuments;
  let loseResponse = true;
  const service = createHospitalService(env, actor, { ...f.db, batchCommitLiteralDocuments: async (...args) => {
    await original(...args);
    if (loseResponse) { loseResponse = false; throw new Error('Connection interrupted after commit'); }
  } });
  await assert.rejects(service.assignCard(input), /Connection interrupted/);
  assert.equal((await service.assignCard(input)).replayed, true);
  assert.equal(f.rows('Cards').length, 1);
  assert.equal(f.rows('Audit').filter(row => row.Action === 'Assign patient NFC card').length, 1);
});
