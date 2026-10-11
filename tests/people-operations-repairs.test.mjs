import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { featureFlagsForEdition, featureFlagsForPlan } from '../functions/lib/organization-config.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';

// Execute real module functions with only their external dependencies replaced.
// In particular, enrollment runs the real school-scope persistence/path logic.
async function load(file, overrides, names) {
  const url = new URL(`../${file}`, import.meta.url);
  const source = await readFile(url, 'utf8');
  const imports = [...source.matchAll(/^import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?/gm)];
  const bindings = {};
  for (const [, fields, path] of imports) {
    const module = await import(new URL(path, url));
    for (const binding of fields.split(',').map(s => s.trim()).filter(Boolean)) {
      const [original, local = original] = binding.split(/\s+as\s+/);
      bindings[local] = module[original];
    }
  }
  Object.assign(bindings, overrides);
  const code = source.replace(/^(?:import|export)\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(bindings), `${code}\nreturn {${names.join(',')}};`)(...Object.values(bindings));
}

function memory() {
  let revision = 0;
  const rows = new Map(), commits = [];
  const put = (path, id, data) => rows.set(`${path}/${id}`, { ...structuredClone(data), __id: id, __updateTime: `revision-${++revision}` });
  const getDocument = async (_env, path, id) => structuredClone(rows.get(`${path}/${id}`) || null);
  const listCollection = async (_env, path) => [...rows.entries()].filter(([key]) => key.slice(0, key.lastIndexOf('/')) === path).map(([, row]) => structuredClone(row));
  const queryCollection = async (env, path, options = {}) => (await listCollection(env, path))
    .filter(row => (options.filters || []).every(filter => row[filter.field] === filter.value)).slice(0, options.limit || Infinity);
  const batchCommitDocuments = async (_env, writes) => {
    for (const write of writes) {
      const prior = rows.get(`${write.collectionPath}/${write.documentId}`);
      if ((write.exists === false && prior) || (write.updateTime && write.updateTime !== prior?.__updateTime)) {
        throw Object.assign(new Error('Concurrent update'), { status: 409 });
      }
    }
    commits.push(structuredClone(writes));
    for (const write of writes) put(write.collectionPath, write.documentId, write.data);
  };
  const upsertDocument = (env, path, id, data, options = {}) => batchCommitDocuments(env, [{ collectionPath: path, documentId: id, data, ...options }]);
  return { rows, commits, put, io: { getDocument, listCollection, queryCollection, batchCommitDocuments, upsertDocument } };
}

async function fixture({ edition = 'school', role = 'Super Admin', branch = 'annex', section = 'Primary', plan = '', readOnly = false, disabled = false } = {}) {
  const db = memory();
  const env = { FIREBASE_PROJECT_ID: `synthetic-${edition}`, ORGANISATION_EDITION: edition, DYNAMAX_WORKSPACE_ID: `synthetic-${edition}` };
  db.put('settings', 'schoolStructure', { ActiveBranchId: 'main', Branches: [{ Id: 'main' }, { Id: 'annex' }] });
  const actor = { username: 'verified-user', displayName: 'Verified User', role, branchId: branch, schoolSectionAccess: section, edition, tabAccess: [] };
  const access = { edition, subscriptionActive: !disabled, subscriptionReadOnly: readOnly,
    allowedSections: allowedSectionsFor(actor, plan ? featureFlagsForPlan(edition, plan) : featureFlagsForEdition(edition)) };
  const school = await load('functions/lib/school-scope.js', db.io,
    ['listSchoolCollection', 'getSchoolDocumentsById', 'getSchoolDocumentById', 'querySchoolCollection', 'upsertSchoolDocument', 'getSchoolStructure']);
  const conduct = await load('functions/lib/student-conduct.js', school, ['handleStudentConductAction']);
  const clinic = await load('functions/lib/clinic-stock-usage.js', { ...db.io, batchCommitLiteralDocuments: db.io.batchCommitDocuments }, ['commitClinicVisit']);
  let verified = 0;
  const backend = await load('functions/api/backend.js', {
    ...db.io, ...school, ...conduct, ...clinic,
    staffAccessFor: async () => access,
    resolveAuthoritativeDesktopActorForEnv: async () => { verified++; return actor; },
    verifyDesktopSecret: () => ({ type: 'legacy-secret' }),
    verifyDesktopCredential: async () => ({ type: 'device', branchId: branch }),
    requireFirestoreEnv: () => {}, loadDeploymentIdentity: async () => ({ edition, workspaceId: `synthetic-${edition}` }),
    assertExpectedDeploymentIdentity: () => ({ edition, workspaceId: `synthetic-${edition}` }),
    startRequestMetric: () => ({}), finishRequestMetric: () => {}
  }, ['onRequestPost', 'routeAction', 'enrollStudent', 'saveClinicRecord', 'getClinicRecords']);
  const body = { UserUsername: actor.username, UserRole: role, UserAssignedRole: role, UserBranchId: branch,
    UserSchoolSectionAccess: section, RecordedBy: actor.displayName };
  const post = async (Action, payload = {}, device = false) => backend.onRequestPost({ env, request: new Request('https://synthetic.invalid/api/backend', {
    method: 'POST', body: JSON.stringify({ ...body, Action, Secret: device ? 'DXD.synthetic' : 'synthetic', ...payload })
  }) });
  return { db, env, backend, actor, access, body, school, conduct, post, verified: () => verified };
}

const application = { ApplicationReference: 'APP-1', AdmissionNo: 'STUDENT-1', BranchId: 'annex', SchoolSection: 'primary',
  ResultStatus: 'Admitted', OfferSent: 'YES', AcceptanceFeePaid: 'YES', AdmissionLetterSent: 'YES',
  ApplicantName: 'Synthetic Student', FirstName: 'Synthetic', Surname: 'Student', ClassApplyingFor: 'Grade 1' };
const appPath = 'schoolBranches/annex/sections/primary/applications';
const studentPath = 'schoolBranches/annex/sections/primary/students';
const student = { AdmissionNo: 'STUDENT-1', DisplayName: 'Synthetic Student', BranchId: 'annex', SchoolSection: 'primary', ClassName: 'Grade 1' };
const incident = { StudentRef: 'STUDENT-1', IncidentDate: '2026-10-09', Category: 'Other misconduct', Summary: 'Synthetic incident' };

for (const device of [false, true]) {
  test(`enrollment preserves applicant ownership and atomically links both records (${device ? 'branch device' : 'legacy credential'})`, async () => {
    const f = await fixture();
    f.db.put(appPath, 'APP-1', application);
    const response = await f.post('enrollStudent', { ApplicationReference: 'APP-1' }, device);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal(f.verified(), 1);
    assert.equal(f.db.commits.length, 1);
    assert.equal(f.db.commits[0].length, 2);
    assert.equal(f.db.rows.get(`${studentPath}/STUDENT-1`).BranchId, 'annex');
    assert.equal(f.db.rows.get(`${studentPath}/STUDENT-1`).SchoolSection, 'primary');
    assert.equal(f.db.rows.get(`${appPath}/APP-1`).Enrolled, 'YES');
    assert.equal([...f.db.rows.keys()].some(key => key.includes('schoolBranches/main/') && key.endsWith('/STUDENT-1')), false);
    assert.equal(f.db.commits[0][0].exists, false);
    assert.ok(f.db.commits[0][1].updateTime);
  });

  test(`clinic saves authoritative student scope and filters reads (${device ? 'branch device' : 'legacy credential'})`, async () => {
    const f = await fixture();
    f.db.put(studentPath, 'STUDENT-1', student);
    f.db.put('clinicRecords', 'MAIN', { AdmissionNo: 'OTHER', Complaint: 'Private', SchoolSection: 'primary' });
    f.db.put('clinicRecords', 'SECONDARY', { AdmissionNo: 'OTHER', Complaint: 'Private', BranchId: 'annex', SchoolSection: 'secondary' });
    const response = await f.post('saveClinicRecord', { AdmissionNo: 'STUDENT-1', StudentName: 'Forged name', ClassName: 'Forged class', Complaint: 'Synthetic visit', RecordId: 'CLINIC-1' }, device);
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const saved = f.db.rows.get('clinicRecords/CLINIC-1');
    assert.equal(saved.StudentName, 'Synthetic Student');
    assert.equal(saved.ClassName, 'Grade 1');
    assert.equal(saved.BranchId, 'annex');
    assert.equal(saved.SchoolSection, 'primary');
    const read = await f.post('getClinicRecords', {}, device);
    assert.equal(read.status, 200);
    assert.deepEqual((await read.json()).records.map(row => row.RecordId), ['CLINIC-1']);
    assert.equal(f.verified(), 2);
    const forged = await f.post('getClinicRecords', { UserBranchId: 'main', UserRole: 'Super Admin' }, device);
    assert.equal(forged.status, device ? 403 : 200);
    if (!device) assert.deepEqual((await forged.json()).records.map(row => row.RecordId), ['CLINIC-1']);
    assert.equal((await f.post('saveClinicRecord', { AdmissionNo: 'STUDENT-1', Complaint: 'Synthetic visit', RecordId: 'MAIN' }, device)).status, 403);
  });
}

test('enrollment refuses conflicting scope, missing versions and concurrent students without partially enrolling', async () => {
  const f = await fixture();
  f.db.put(appPath, 'APP-1', application);
  assert.equal((await f.post('enrollStudent', { ApplicationReference: 'APP-1', BranchId: 'main' })).status, 403);
  assert.equal((await f.post('enrollStudent', { ApplicationReference: 'APP-1', SchoolSection: 'Secondary' })).status, 403);
  delete f.db.rows.get(`${appPath}/APP-1`).__updateTime;
  assert.equal((await f.post('enrollStudent', { ApplicationReference: 'APP-1' })).status, 409);
  assert.equal(f.db.commits.length, 0);
  f.db.put(appPath, 'APP-1', application);
  const results = await Promise.all([f.post('enrollStudent', { ApplicationReference: 'APP-1' }), f.post('enrollStudent', { ApplicationReference: 'APP-1' })]);
  assert.deepEqual(results.map(row => row.status).sort(), [200, 409]);
  assert.equal(f.db.commits.length, 1);
});

for (const legacyStudent of [true, false]) {
  test(`enrollment reconciles ${legacyStudent ? 'scoped application with legacy student' : 'legacy application with scoped student'} without duplicates`, async () => {
    const f = await fixture();
    const applicationPath = legacyStudent ? appPath : 'applications';
    const existingStudentPath = legacyStudent ? 'students' : studentPath;
    f.db.put(applicationPath, 'APP-1', application);
    f.db.put(existingStudentPath, 'STUDENT-1', { ...student, FirstName: 'Synthetic', Surname: 'Student', MedicalCondition: 'Preserve existing profile' });
    const response = await f.post('enrollStudent', { ApplicationReference: 'APP-1' });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).reconciled, true);
    assert.equal([...f.db.rows.keys()].filter(key => /\/students\/STUDENT-1$|^students\/STUDENT-1$/.test(key)).length, 1);
    assert.equal(f.db.rows.get(`${existingStudentPath}/STUDENT-1`).MedicalCondition, 'Preserve existing profile');
    assert.equal(f.db.rows.get(`${applicationPath}/APP-1`).Enrolled, 'YES');
    assert.equal(f.db.commits[0][0].collectionPath, existingStudentPath);
    assert.ok(f.db.commits[0][0].updateTime);
  });
}

test('enrollment rejects duplicate legacy and scoped student identities without any changes', async () => {
  const f = await fixture();
  f.db.put(appPath, 'APP-1', application);
  f.db.put('students', 'STUDENT-1', student);
  f.db.put(studentPath, 'STUDENT-1', student);
  assert.equal((await f.post('enrollStudent', { ApplicationReference: 'APP-1' })).status, 409);
  assert.equal(f.db.commits.length, 0);
});

test('clinic blocks a student selected by a forged foreign-branch scope path', async () => {
  const f = await fixture();
  f.db.put('schoolBranches/main/sections/primary/students', 'STUDENT-1', { ...student, BranchId: 'main' });
  const response = await f.post('saveClinicRecord', { AdmissionNo: 'STUDENT-1', Complaint: 'Synthetic', StudentScopePath: 'schoolBranches/main/sections/primary/students' });
  assert.equal(response.status, 404);
  assert.equal(f.db.commits.length, 0);
});

test('desktop clinic dispensing uses exact scoped stock and persists visit plus stock atomically', async () => {
  const f = await fixture({ role: 'Clinic User' });
  f.db.put(studentPath, 'STUDENT-1', student);
  f.db.put('clinicInventory', 'SYNTHETIC-MED', { ItemName: 'Synthetic supply', Quantity: 10, Unit: 'pcs', BranchId: 'annex', SchoolSection: 'primary' });
  const body = { RecordId: 'CLINIC-STOCK-1', RequestId: 'stock-first', AdmissionNo: 'STUDENT-1', Complaint: 'Synthetic visit', DispensedItems: [{ InventoryId: 'SYNTHETIC-MED', Quantity: 2 }] };
  const response = await f.post('saveClinicRecord', body, true);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal(f.db.rows.get('clinicInventory/SYNTHETIC-MED').Quantity, 8);
  assert.equal(f.db.commits.length, 1);
  assert.equal(f.db.commits[0].length, 4);
  assert.equal((await f.post('saveClinicRecord', body, true)).status, 200);
  assert.equal(f.db.commits.length, 1);
  const shortage = await f.post('saveClinicRecord', { ...body, RecordId: 'CLINIC-STOCK-2', RequestId: 'stock-second', DispensedItems: [{ InventoryId: 'SYNTHETIC-MED', Quantity: 12 }] }, true);
  assert.equal(shortage.status, 409);
  assert.equal(f.db.rows.has('clinicRecords/CLINIC-STOCK-2'), false);
});

test('posted administrator roles cannot elevate a verified teacher into clinic or admissions', async () => {
  const f = await fixture({ role: 'Teacher' });
  for (const action of ['enrollStudent', 'saveClinicRecord', 'getClinicRecords']) {
    assert.equal((await f.post(action, { UserRole: 'Super Admin', UserAssignedRole: 'Super Admin',
      ApplicationReference: 'APP-1', AdmissionNo: 'STUDENT-1', Complaint: 'Synthetic' })).status, 403);
  }
  assert.equal(f.db.commits.length, 0);
});

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: conduct requires effective subscription/module access on web and desktop`, async () => {
    const f = await fixture({ edition, role: 'Principal', plan: 'Starter' });
    assert.equal(f.access.allowedSections.includes('studentConduct'), false);
    const endpoint = await load('functions/api/staff-conduct.js', {
      requireFirestoreEnv: () => {}, requireStaffSession: async () => ({ ...f.actor, ...f.access }), ...f.conduct
    }, ['onRequestPost']);
    const web = await endpoint.onRequestPost({ env: f.env, request: new Request('https://synthetic.invalid/api/staff-conduct', { method: 'POST', body: JSON.stringify({ action: 'save', ...incident }) }) });
    assert.equal(web.status, 403);
    assert.equal((await f.post('saveStudentConductCase', { ...incident, OrganisationEdition: 'school', UserTabAccess: ['studentConduct'] })).status, 403);
    assert.equal(f.db.commits.length, 0);
  });

  test(`${edition}: HR rejects review reassignment and checks the persisted employee, while allowing own-team reviews`, async () => {
    const db = memory();
    const user = { username: 'manager', role: 'Line Manager', edition, branchId: 'main', allowedSections: ['humanResources'] };
    for (const username of ['direct-report', 'other-team']) {
      db.put('staffUsers', username, { Username: username, Role: 'Department User', BranchId: 'main', OrganisationEdition: edition });
      db.put('hrEmployees', username, { Username: username, BranchId: 'main', ManagerUsername: username === 'direct-report' ? 'manager' : 'another-manager' });
      db.put('hrPerformanceReviews', username, { ReviewId: username, Username: username, BranchId: 'main', Rating: 5, ReviewPeriod: 'Q3' });
    }
    const api = await load('functions/api/staff-hr.js', { ...db.io, requireFirestoreEnv: () => {}, requireStaffSession: async () => user }, ['onRequestPost']);
    const post = async payload => api.onRequestPost({ env: {}, request: new Request('https://synthetic.invalid/api/staff-hr', { method: 'POST', body: JSON.stringify({ action: 'savereview', Rating: 2, ReviewPeriod: 'Q3', ...payload }) }) });
    assert.equal((await post({ ReviewId: 'other-team', Username: 'direct-report' })).status, 409);
    assert.equal((await post({ ReviewId: 'other-team', Username: 'other-team' })).status, 403);
    assert.equal(db.commits.length, 0);
    assert.equal((await post({ ReviewId: 'direct-report', Username: 'direct-report' })).status, 200);
    assert.ok(db.commits[0][0].updateTime);
    assert.equal(db.rows.get('hrPerformanceReviews/other-team').Rating, 5);
    assert.equal((await post({ Username: 'direct-report' })).status, 200);
    assert.equal(db.commits[2][0].exists, false);
  });

  test(`${edition}: concurrent completed HR exits cannot remove both remaining Super Admins`, async () => {
    const db = memory();
    const integrity = await load('functions/lib/staff-account-integrity.js', {
      ...db.io, batchCommitLiteralDocuments: db.io.batchCommitDocuments
    }, ['beginStaffAccountChange', 'commitStaffAccountChanges', 'staffAccountCondition']);
    const user = { username: 'hr', role: 'HR Manager', edition, branchId: 'main', allowedSections: ['humanResources'] };
    for (const username of ['admin-one', 'admin-two']) db.put('staffUsers', username,
      { Username: username, Role: 'Super Admin', Active: true, BranchId: 'main', OrganisationEdition: edition });
    const api = await load('functions/api/staff-hr.js', { ...db.io, ...integrity, requireFirestoreEnv: () => {}, requireStaffSession: async () => user }, ['onRequestPost']);
    const post = Username => api.onRequestPost({ env: {}, request: new Request('https://synthetic.invalid/api/staff-hr', {
      method: 'POST', body: JSON.stringify({ action: 'saveexit', Username, Status: 'Completed', LastWorkingDate: '2026-10-09' })
    }) });
    const responses = await Promise.all([post('admin-one'), post('admin-two')]);
    assert.deepEqual(responses.map(row => row.status).sort(), [200, 409]);
    assert.equal([...db.rows.values()].filter(row => row.Role === 'Super Admin' && row.Active).length, 1);
    assert.equal(db.commits.length, 1);
    assert.equal(db.commits[0].some(row => row.collectionPath === 'settings' && row.documentId === 'staffAccountIntegrity'), true);
  });
}

for (const edition of ['faith', 'organization']) {
  test(`${edition}: clinical and school-enrollment desktop actions reject edition spoofing`, async () => {
    const f = await fixture({ edition });
    for (const action of ['enrollStudent', 'saveClinicRecord', 'getClinicRecords']) {
      assert.equal((await f.post(action, { OrganisationEdition: 'school', ApplicationReference: 'APP-1', AdmissionNo: 'STUDENT-1', Complaint: 'Synthetic' })).status, 403);
    }
    assert.equal(f.db.commits.length, 0);
  });
}

test('authorized conduct remains available and readonly subscriptions cannot mutate', async () => {
  const f = await fixture({ role: 'Principal' });
  f.db.put(studentPath, 'STUDENT-1', student);
  assert.equal((await f.post('saveStudentConductCase', incident, true)).status, 200);
  assert.equal(f.db.commits.length, 2); // Case plus its audit record.
  f.access.subscriptionReadOnly = true;
  assert.equal((await f.post('getStudentConductCases', {}, true)).status, 200);
  assert.equal((await f.post('saveStudentConductCase', incident, true)).status, 403);
  f.access.subscriptionActive = false;
  assert.equal((await f.post('getStudentConductCases', {}, true)).status, 403);
});
