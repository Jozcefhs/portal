import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as hr from '../../functions/lib/human-resources.js';
import * as branches from '../../functions/lib/branch-scope.js';
import * as records from '../../functions/lib/records-desk.js';
import * as storage from '../../functions/lib/staff-attendance-storage.js';
import { featureFlagsForPlan } from '../../functions/lib/organization-config.js';
import { allowedSectionsFor } from '../../functions/lib/staff-auth.js';

function isolate(file, bindings, names) {
  const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];\s*/gm, '')
    .replace(/^export\s+/gm, '');
  return new Function(...Object.keys(bindings), `${source}\nreturn {${names.join(',')}};`)(...Object.values(bindings));
}

// All dependencies below are local in-memory doubles; no network or database is used.
const principal = { username: 'principal', role: 'Principal', edition: 'school', branchId: 'main' };
principal.allowedSections = allowedSectionsFor(principal, featureFlagsForPlan('school', 'Starter'));
assert.equal(principal.allowedSections.includes('studentConduct'), false);
const conductWrites = [];
const conduct = isolate('functions/lib/student-conduct.js', {
  ...branches,
  getSchoolStructure: async () => ({ ActiveBranchId: 'main' }),
  listSchoolCollection: async (_env, collection) => collection === 'students'
    ? [{ AdmissionNo: 'SYNTHETIC-1', DisplayName: 'Synthetic student', BranchId: 'main', SchoolSection: 'secondary' }] : [],
  schoolSectionFor: (row) => row.SchoolSection || 'secondary',
  upsertSchoolDocument: async (_env, collection, id, data) => { conductWrites.push({ collection, id }); return data; },
  deleteSchoolDocument: async () => { throw new Error('Unexpected delete'); }
}, ['handleStudentConductAction']);
const conductEndpoint = isolate('functions/api/staff-conduct.js', {
  requireFirestoreEnv: () => {},
  requireStaffSession: async () => principal,
  readJsonBody: async (request) => request.json(),
  handleStudentConductAction: conduct.handleStudentConductAction
}, ['onRequestPost']);
const conductResponse = await conductEndpoint.onRequestPost({ env: {}, request: new Request('https://synthetic.invalid/api/staff-conduct', {
  method: 'POST', body: JSON.stringify({ action: 'save', StudentRef: 'SYNTHETIC-1', IncidentDate: '2026-10-09',
    Category: 'Other misconduct', Summary: 'Synthetic audit probe' })
}) });
assert.equal(conductResponse.status, 200);
assert.equal(conductWrites.length, 2);
console.log('CONFIRMED: Principal with Starter plan/no studentConduct entitlement saves conduct case via endpoint after session validation.');

const manager = { username: 'manager-a', role: 'Line Manager', edition: 'school', branchId: 'main', allowedSections: ['humanResources'] };
const unrelatedReview = { ReviewId: 'review-other', Username: 'other-team', BranchId: 'main', Rating: 5, ReviewPeriod: 'Q3', __updateTime: 'synthetic-revision' };
const reviewWrites = [];
const hrHandlers = isolate('functions/api/staff-hr.js', {
  ...hr, ...branches, staffRecordMatchesEdition: records.staffRecordMatchesEdition,
  getDocument: async (_env, collection, id) => collection === 'hrPerformanceReviews' ? unrelatedReview
    : collection === 'hrEmployees' && id === 'direct-report' ? { Username: 'direct-report', ManagerUsername: 'manager-a', BranchId: 'main' } : null,
  listCollection: async () => [{ Username: 'direct-report', Role: 'Teacher', BranchId: 'main', OrganisationEdition: 'school' }],
  upsertDocument: async (_env, collection, id, data) => { reviewWrites.push({ collection, id, data }); },
  batchCommitDocuments: async () => {}, requireFirestoreEnv: () => {},
  requireStaffSession: async () => manager, readJsonBody: async (request) => request.json()
}, ['onRequestPost']);
const reviewResponse = await hrHandlers.onRequestPost({ env: {}, request: new Request('https://synthetic.invalid/api/staff-hr', {
  method: 'POST', body: JSON.stringify({ action: 'savereview', ReviewId: 'review-other', Username: 'direct-report', Rating: 1, ReviewPeriod: 'Q3' })
}) });
assert.equal(reviewResponse.status, 200);
assert.equal(reviewWrites[0].id, 'review-other');
assert.equal(reviewWrites[0].data.Username, 'direct-report');
console.log('CONFIRMED: Line Manager overwrites other team review by submitting its ReviewId with own direct-report Username.');

const attendance = isolate('functions/lib/staff-time-attendance.js', { ...storage, ...hr,
  staffRecordMatchesEdition: records.staffRecordMatchesEdition
}, ['normalizeAttendancePolicy', 'buildDailyAttendanceFromEvent']);
const policy = attendance.normalizeAttendancePolicy({ TimeZone: 'Africa/Lagos', ResumptionTime: '08:00', ClosingTime: '17:00' });
const old = { Username: 'synthetic-staff', FirstClockIn: '2026-10-09T07:00:00.000Z', LastClockOut: '2026-10-09T16:00:00.000Z', WorkMinutes: 540 };
const corrected = attendance.buildDailyAttendanceFromEvent(policy, { Direction: 'IN', Timestamp: '2026-10-09T08:00:00.000Z',
  Username: 'synthetic-staff', BranchId: 'main', ManualOverride: true }, old);
assert.equal(corrected.FirstClockIn, old.FirstClockIn);
assert.equal(corrected.WorkMinutes, 540);
const earlier = attendance.buildDailyAttendanceFromEvent(policy, { Direction: 'IN', Timestamp: '2026-10-09T06:00:00.000Z',
  Username: 'synthetic-staff', BranchId: 'main', ManualOverride: true }, old);
assert.equal(earlier.FirstClockIn, '2026-10-09T06:00:00.000Z');
assert.equal(earlier.WorkMinutes, 540); // New endpoints imply 600 minutes, but total is stale.
console.log('CONFIRMED: Manual IN correction cannot move clock-in later; moving it earlier leaves completed-day WorkMinutes stale (540, expected600).');

const backendSource = fs.readFileSync(new URL('../../functions/api/backend.js', import.meta.url), 'utf8');
function backendFunction(start, end, bindings) {
  const snippet = backendSource.slice(backendSource.indexOf(`async function ${start}(`), backendSource.indexOf(`async function ${end}(`));
  return new Function(...Object.keys(bindings), `${snippet}\nreturn ${start};`)(...Object.values(bindings));
}
const clean = (value) => String(value ?? '').trim();
const clinicWrites = [];
const saveClinicRecord = backendFunction('saveClinicRecord', 'saveInventoryItem', {
  clean, nowIso: () => new Date().toISOString(), safeDocumentId: (id) => id,
  ledgerDocumentId: () => 'SYNTHETIC-CLINIC',
  upsertDocument: async (_env, collection, id, data) => clinicWrites.push({ collection, id, data })
});
await saveClinicRecord({}, { RecordId: 'SYNTHETIC-CLINIC', StudentName: 'Synthetic annex student',
  AdmissionNo: 'ANNEX-1', Complaint: 'Synthetic audit probe', BranchId: 'annex', SchoolSection: 'primary',
  UserBranchId: 'annex', UserSchoolSectionAccess: 'Primary' });
assert.equal(clinicWrites[0].data.BranchId, undefined);
assert.equal(clinicWrites[0].data.SchoolSection, undefined);
assert.equal(clinicWrites[0].data.BranchId || 'main', 'main');
console.log('CONFIRMED: Clinic record supplied annex branch/primary section loses both; web staffScope interprets saved branch as main.');

const app = { ApplicationReference: 'SYNTHETIC-APP', AdmissionNo: 'ANNEX-2', BranchId: 'annex',
  SchoolSection: 'secondary', __scopePath: 'schoolBranches/annex/sections/secondary/applications',
  ResultStatus: 'Admitted', OfferSent: 'YES', AcceptanceFeePaid: 'YES', AdmissionLetterSent: 'YES',
  ApplicantName: 'Synthetic enrollee', ClassApplyingFor: 'Grade 7' };
const savedEnrollment = [];
const schoolScope = isolate('functions/lib/school-scope.js', {
  getDocument: async () => ({ ActiveBranchId: 'main', Branches: [{ Id: 'main' }, { Id: 'annex' }] }),
  normalizeClassKey: (value) => clean(value).toLowerCase().replace(/\s+/g, ''),
  withStudentProfileDefaults: (row) => ({ ...row }),
  upsertDocument: async (_env, path, id, data) => savedEnrollment.push({ path, id, data })
}, ['upsertSchoolDocument']);
const enrollStudent = backendFunction('enrollStudent', 'markApplicationFlag', {
  clean, nowIso: () => new Date().toISOString(),
  pick: (row, keys, fallback = '') => keys.map((key) => row[key]).find((value) => clean(value)) ?? fallback,
  yesNo: (value) => clean(value).toUpperCase(),
  applicationIdFrom: (body) => body.ApplicationReference,
  findApplication: async () => app,
  applicationNotFound: () => new Error('Missing'),
  admissionIntakeClassification: () => ({ EnrollmentCategory: 'New Intake' }),
  identityScopePathForCollection: (row, collection) => row.__scopePath.replace(/applications$/, collection),
  getSelectedIdentityRow: async () => null,
  querySchoolCollection: async () => [],
  configuredClassNames: async () => ['Grade 7'],
  canonicalConfiguredClass: (value) => value,
  saveStudent: async (env, student) => schoolScope.upsertSchoolDocument(env, 'students', student.AdmissionNo, student),
  saveApplication: async (_env, row) => row
});
const enrolled = await enrollStudent({}, { ApplicationReference: 'SYNTHETIC-APP', UserBranchId: 'annex' });
assert.equal(enrolled.application.Status, 'Enrolled');
assert.equal(savedEnrollment[0].path, 'schoolBranches/main/sections/secondary/students');
console.log('CONFIRMED: Enrolling annex applicant creates student in global active main branch and marks annex application enrolled.');
