import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import * as management from '../functions/lib/academic-management.js';
import * as scorebook from '../functions/lib/academic-scorebook.js';
import * as policies from '../functions/lib/academic-policy.js';
import * as timetable from '../functions/lib/academic-timetable-attendance.js';
import * as attendanceIdentity from '../functions/lib/academic-attendance-identity.js';
import { safeScopeId } from '../functions/lib/school-scope.js';
import { calculateAcademicMidTermResultDrafts } from '../functions/lib/academic-term-results.js';
import { evaluateAcademicResultAccess } from '../functions/lib/academic-result-access.js';

const stripModules = source => source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, '');
const managementSource = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../functions/lib/academic-policy-store.js', import.meta.url), 'utf8');
const setupSource = await readFile(new URL('../js/setup.js', import.meta.url), 'utf8');
const uploadSource = await readFile(new URL('../functions/api/staff-cbt-paper.js', import.meta.url), 'utf8');
const actor = { edition: 'school', role: 'Super Admin', username: 'reviewer', allowedSections: ['academics'], branchId: 'main', schoolSectionAccess: 'secondary' };
const classroom = { SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1' };
const row = data => ({ BranchId: 'main', SchoolSection: 'secondary', Status: 'Active', ...data });
const input = { ...classroom, BranchId: 'main', SchoolSection: 'secondary', IncludePeople: false, IncludeAssessmentPolicy: false };
const conflict = () => Object.assign(new Error('Concurrent update'), { status: 409 });

function managementHarness(records = {}) {
  const context = {
    ...management, ...scorebook, ...timetable, ...attendanceIdentity, TextEncoder, TextDecoder, crypto: webcrypto,
    getSchoolStructure: async () => ({ ActiveBranchId: 'main', Branches: [{ Id: 'main' }], Sections: ['primary', 'secondary'] }),
    enforceActorBranch: (_actor, branch) => branch, safeScopeId,
    queryCollection: async (_env, collection) => structuredClone(records[collection] || []),
    listCollection: async (_env, collection) => structuredClone(records[collection] || []),
    listSchoolCollection: async () => [],
    getDocument: async (_env, collection, id) => structuredClone((records[collection] || []).find(record => (record.RecordId || record.CbtTestId) === id) || null),
    batchCommitDocuments: async (_env, changes) => {
      for (const change of changes) {
        const existing = (records[change.collectionPath] || []).find(record => (record.RecordId || record.VersionId || record.CbtTestId) === change.documentId);
        if ((change.exists === false && existing) || (change.updateTime && existing?.__updateTime !== change.updateTime)) throw conflict();
      }
      for (const change of changes) {
        const collection = records[change.collectionPath] ||= [];
        const index = collection.findIndex(record => (record.RecordId || record.VersionId || record.CbtTestId) === change.documentId);
        if (index >= 0) collection.splice(index, 1);
        if (change.operation !== 'delete') collection.push({ ...structuredClone(change.data), __updateTime: webcrypto.randomUUID() });
      }
      return { writeResults: changes.map(() => ({ updateTime: 'committed' })) };
    }
  };
  vm.createContext(context);
  vm.runInContext(stripModules(managementSource), context);
  return context;
}

test('AM-01 all or omitted sections remain confined to the assigned section', async () => {
  const context = managementHarness({ academicClasses: [row({ ClassId: 'secondary' }), row({ ClassId: 'primary', SchoolSection: 'primary' })] });
  for (const SchoolSection of ['all', '']) {
    const result = await context.bootstrapAcademicManagement({}, { ...actor, role: 'Admin', schoolSectionAccess: 'primary' }, { ...input, SchoolSection, View: 'classrooms' });
    assert.deepEqual(Array.from(result.classes, item => item.ClassId), ['primary']);
    assert.equal(result.scope.SchoolSection, 'primary');
  }
  await assert.rejects(context.bootstrapAcademicManagement({}, { ...actor, schoolSectionAccess: 'primary' }, input), { code: 'ACADEMIC_SECTION_FORBIDDEN' });
});

test('AM-02 teachers cannot read another subject or period; form teachers retain classroom access', async () => {
  const allocation = row({ ...classroom, TeacherUsername: 'teacher-a', SubjectId: 'math', AllocationRole: 'Subject Teacher' });
  const records = {
    academicTeacherAllocations: [allocation],
    academicStudentMemberships: [row({ ...classroom, StudentRef: 'S1', SubjectIds: ['math'] }), row({ ...classroom, SessionId: 'next', StudentRef: 'S2', SubjectIds: ['math'] })],
    academicScoreSheets: [row({ ...classroom, SheetId: 'own', SubjectId: 'math' }), row({ ...classroom, SheetId: 'english', SubjectId: 'english' }), row({ ...classroom, SessionId: 'next', SheetId: 'next', SubjectId: 'math' })],
    academicStudentScores: [row({ SheetId: 'own', StudentRef: 'S1' }), row({ SheetId: 'english', StudentRef: 'S1' })],
    academicResults: [row({ ...classroom, StudentRef: 'S1', ResultId: 'own' }), row({ ...classroom, StudentRef: 'S1', TermId: 'other', ResultId: 'other' })],
    academicCumulativeResults: [row({ ...classroom, StudentRef: 'S1', CumulativeResultId: 'own' }), row({ ...classroom, StudentRef: 'S1', SessionId: 'next', CumulativeResultId: 'next' })],
    academicTranscripts: [row({ StudentRef: 'S1', TranscriptId: 'history' })]
  };
  const result = await managementHarness(records).bootstrapAcademicManagement({}, { ...actor, role: 'Teacher', username: 'teacher-a' }, { ...input, View: 'scorebook' });
  assert.deepEqual(Array.from(result.scoreSheets, item => item.SheetId), ['own']);
  assert.equal(result.studentMemberships.length, 1);
  assert.equal(result.studentScores.length, 1);
  const teacher = { ...actor, role: 'Teacher', username: 'teacher-a' };
  const results = await managementHarness(records).bootstrapAcademicManagement({}, teacher, { ...input, View: 'results' });
  assert.deepEqual(Array.from(results.termResults, item => item.ResultId), ['own']);
  const outcomes = await managementHarness(records).bootstrapAcademicManagement({}, teacher, { ...input, View: 'outcomes' });
  assert.deepEqual(Array.from(outcomes.cumulativeResults, item => item.CumulativeResultId), ['own']);
  assert.equal(outcomes.transcripts.length, 0);
  const sheet = { ...classroom, SubjectId: 'english' };
  assert.equal(management.academicTeacherCanReadScoreSheet(sheet, [{ ...allocation, AllocationRole: 'Form Teacher' }]), true);
  assert.equal(management.academicTeacherCanReadScoreSheet(sheet, [{ ...allocation, Status: 'Inactive' }]), false);
  assert.equal(management.academicTeacherCanReadScoreSheet(sheet, [], [{ ...sheet, TermId: 'other' }]), false);
  assert.equal(management.academicTeacherCanReadScoreSheet(sheet, [], [sheet]), true);
});

function completePolicy() {
  const policy = policies.defaultAcademicPolicy();
  policy.ResultAccess.VisibilityMode = 'all-published';
  policy.ResultAccess.FinancialClearance.Mode = 'none';
  policy.Promotion.Mode = 'manual-review';
  policy.Position.Mode = 'none';
  policy.MidTerm = { Enabled: true, ComponentIds: ['exam'] };
  policy.Assessment.Components = [{ Id: 'exam', Name: 'Exam', MaximumScore: 100, WeightPercentage: 100, Required: true, ScoreEntryMode: 'objective-theory', ObjectiveMaximumScore: 50, TheoryMaximumScore: 50 }];
  policy.Assessment.GradeBands = [{ Grade: 'A', MinimumPercentage: 70, MaximumPercentage: 100 }, { Grade: 'F', MinimumPercentage: 0, MaximumPercentage: 69.99, Classification: 'fail' }];
  return policy;
}

test('AM-03 midterm uses part-aware exemption weights and retains incomplete states', () => {
  const policy = completePolicy();
  const scheme = scorebook.academicAssessmentScheme(policy, { RevisionId: 'r1' });
  for (const [State, expected, ready] of [['Exempt', 100, true], ['Absent', 50, true], ['Missing', null, false]]) {
    const score = scorebook.calculateAcademicStudentScore(scheme, [{ ComponentId: 'exam', Parts: [{ PartId: 'objective', State: 'Numeric', RawScore: 50 }, { PartId: 'theory', State }] }]);
    const result = calculateAcademicMidTermResultDrafts({ ...classroom, Policy: policy,
      Memberships: [{ ...classroom, StudentRef: 'S1', SubjectIds: ['math'], Status: 'Active' }], Subjects: [{ SubjectId: 'math', Name: 'Mathematics' }],
      ScoreSheets: [{ ...classroom, SheetId: 'sheet', SubjectId: 'math', Status: 'Approved', AssessmentRevisionId: 'r1' }],
      StudentScores: [{ ...score, SheetId: 'sheet', StudentRef: 'S1', SubjectId: 'math', AssessmentRevisionId: 'r1' }]
    });
    assert.equal(result.Ready, ready);
    if (ready) {
      assert.equal(result.Results[0].OverallAverage, expected);
      assert.equal(result.Results[0].Subjects[0].ComponentScores[0].Parts.find(part => part.PartId === 'theory').State, State);
    }
  }
});

function policyHarness(onCreate = () => {}) {
  let assignment = null;
  const revisions = new Map();
  const context = { ...policies, crypto: webcrypto,
    getDocument: async (_env, collection, id) => structuredClone(collection === 'academicPolicyAssignments' ? assignment : revisions.get(id) || null),
    createDocumentIfAbsent: async (_env, _collection, id, revision) => { revisions.set(id, revision); onCreate(() => assignment, value => { assignment = value; }); return { created: true }; },
    upsertDocument: async (_env, _collection, _id, data, condition) => {
      if ((condition.exists === false && assignment) || (condition.updateTime && condition.updateTime !== assignment?.__updateTime)) throw conflict();
      assignment = { ...data, __updateTime: webcrypto.randomUUID() };
    }
  };
  vm.createContext(context);
  vm.runInContext(stripModules(storeSource), context);
  return { context, get: () => assignment, set: value => { assignment = value; } };
}
const policyArgs = { scope: { Type: 'organisation' }, period: { Session: '2026/2027', Term: 'First Term' } };

test('AM-04 draft creation, activation and inheritance require the reviewed version', async () => {
  const { context } = policyHarness();
  await assert.rejects(context.saveAcademicPolicyDraft({}, { ...policyArgs, policy: completePolicy() }), { status: 428 });
  const draft = await context.saveAcademicPolicyDraft({}, { ...policyArgs, policy: completePolicy(), expectedRevision: 'absent' });
  await assert.rejects(context.activateAcademicPolicyDraft({}, { ...policyArgs, expectedRevision: draft.RevisionToken, expectedDraftRevisionId: 'another-draft' }), { status: 409 });
  const active = await context.activateAcademicPolicyDraft({}, { ...policyArgs, expectedRevision: draft.RevisionToken, expectedDraftRevisionId: draft.DraftRevisionId });
  assert.equal(active.ActiveRevisionId, draft.DraftRevisionId);
  await assert.rejects(context.saveAcademicPolicyDraft({}, { ...policyArgs, policy: completePolicy(), expectedRevision: draft.RevisionToken }), { status: 409 });
});

test('AM-04 a concurrent activation cannot be overwritten by draft save', async () => {
  const harness = policyHarness((get, set) => set({ ...get(), ActiveRevisionId: 'newly-activated', __updateTime: 'concurrent' }));
  harness.set({ ActiveRevisionId: 'old-active', __updateTime: 'old-version' });
  await assert.rejects(harness.context.saveAcademicPolicyDraft({}, { ...policyArgs, policy: completePolicy(), expectedRevision: 'old-version' }), { code: 'ACADEMIC_POLICY_CONFLICT' });
  assert.equal(harness.get().ActiveRevisionId, 'newly-activated');
});

test('AM-04 inheritance reset cannot overwrite a concurrent policy activation', async () => {
  const harness = policyHarness();
  harness.set({ ActiveRevisionId: 'old', __updateTime: 'reviewed' });
  const write = harness.context.upsertDocument;
  harness.context.upsertDocument = async (...args) => {
    harness.set({ ActiveRevisionId: 'new', __updateTime: 'concurrent' });
    return write(...args);
  };
  await assert.rejects(harness.context.inheritAcademicPolicyAtScope({}, {
    ...policyArgs, scope: { Type: 'branch', Id: 'main' }, expectedRevision: 'reviewed'
  }), { code: 'ACADEMIC_POLICY_CONFLICT' });
  assert.equal(harness.get().ActiveRevisionId, 'new');
});

function timetableRecords() {
  return {
    academicSessions: [row({ SessionId: 's1', Name: '2026/2027' })],
    academicTerms: [row({ SessionId: 's1', TermId: 't1', Name: 'First Term', StartDate: '2026-09-01', EndDate: '2026-12-31' })],
    academicClasses: [row({ ClassId: 'c1' })], academicArms: [row({ ArmId: 'a1', ClassId: 'c1' })], academicSubjects: [row({ SubjectId: 'math' })],
    academicTeacherAllocations: [row({ ...classroom, TeacherUsername: 'teacher', SubjectId: 'math', AllocationRole: 'Subject Teacher' })],
    academicTimetableVersions: [row({ ...classroom, VersionId: 'v1', Status: 'Draft', __updateTime: 'v1-original', Days: [{ DayCode: 'MON' }], Periods: [{ PeriodCode: 'P1', Name: 'First', StartTime: '08:00', EndTime: '09:00', Kind: 'Lesson', SortOrder: 1, DayCodes: ['ALL'] }] })],
    academicTimetableEntries: []
  };
}
test('AM-05 an empty classroom roster rejects attendance before any write', async () => {
  const records = timetableRecords();
  await assert.rejects(managementHarness(records).saveAcademicStudentAttendance({}, actor, { ...input, AttendanceDate: '2026-10-09', Mode: 'Daily', Entries: [{ StudentRef: 'outside', Status: 'Present' }] }), /not in this classroom/);
  assert.equal(records.academicStudentAttendance, undefined);
  assert.equal(timetable.normalizeAcademicAttendanceEntries([{ StudentRef: 'S1', Status: 'Present' }], ['S1']).length, 1);
});

function dailyAttendanceFixture() {
  const scope = { branchId: 'main', section: 'secondary' };
  const session = management.normalizeAcademicSession({ Name: '2026/2027', StartDate: '2026-09-01', EndDate: '2027-07-31' }, scope);
  const term = management.normalizeAcademicTerm({ SessionId: session.SessionId, Name: 'First Term', StartDate: '2026-09-01', EndDate: '2026-12-31' }, scope);
  const schoolClass = management.normalizeAcademicClass({ Name: 'Grade 10' }, scope);
  const arm = management.normalizeAcademicArm({ ClassId: schoolClass.ClassId, Name: 'Brilliance' }, scope);
  const register = { SessionId: session.SessionId, TermId: term.TermId, ClassId: schoolClass.ClassId, ArmId: arm.ArmId };
  const records = { academicSessions: [session], academicTerms: [term], academicClasses: [schoolClass], academicArms: [arm],
    academicSubjects: [row({ SubjectId: 'math' }), row({ SubjectId: 'english' })],
    academicStudentMemberships: [row({ ...register, MembershipId: 'membership', StudentRef: 'TEST/24/1633' })],
    academicTeacherAllocations: [row({ ...register, TeacherUsername: 'teacher', AllocationRole: 'Form Teacher' })] };
  const teacher = { ...actor, role: 'Teacher', username: 'teacher' };
  const form = { ...input, ...register, AttendanceDate: '2026-10-15', Mode: 'Daily', Entries: [{ StudentRef: 'TEST/24/1633', Status: 'Absent' }] };
  const context = managementHarness(records);
  return { records, teacher, form, context, save: changes => context.saveAcademicStudentAttendance({}, teacher, { ...form, ...changes }) };
}

test('attendance keeps consecutive days separate with real generated, long session and term IDs', async () => {
  const h = dailyAttendanceFixture();
  await h.save({});
  const original = structuredClone(h.records.academicStudentAttendance[0]);
  for (const Status of ['Present', 'Absent']) {
    await h.save({ AttendanceDate: Status === 'Present' ? '2026-10-16' : '2026-10-19', Entries: [{ StudentRef: 'TEST/24/1633', Status }] });
  }
  assert.equal(h.records.academicStudentAttendance.length, 3);
  assert.deepEqual(h.records.academicStudentAttendance[0], original);
  assert.equal(new Set(h.records.academicStudentAttendance.map(r => r.AttendanceId)).size, 3);
  await h.save({});
  assert.equal(h.records.academicStudentAttendance.length, 3, 'same-day repeat is idempotent');
  assert.equal(h.records.academicAttendanceCorrections, undefined);
});

test('legacy same-day history keeps its ID, genuine corrections require approval, and the next day creates a new row', async () => {
  const h = dailyAttendanceFixture();
  await h.save({});
  const original = h.records.academicStudentAttendance[0];
  original.RecordId = original.AttendanceId = `${safeScopeId(original.RegisterId)}__${safeScopeId(original.StudentRef)}`;
  const legacy = structuredClone(original);
  await h.save({});
  assert.deepEqual(h.records.academicStudentAttendance, [legacy]);
  const Entries = [{ StudentRef: 'TEST/24/1633', Status: 'Present' }];
  await assert.rejects(h.save({ Entries }), /Explain the correction/);
  await h.save({ Entries, CorrectionReason: 'Confirmed classroom roll' });
  assert.deepEqual(h.records.academicStudentAttendance, [legacy]);
  const correction = h.records.academicAttendanceCorrections[0];
  assert.equal(correction.AttendanceId, legacy.AttendanceId);
  await h.save({ AttendanceDate: '2026-10-16', Entries });
  assert.equal(h.records.academicStudentAttendance.length, 2);
  await h.context.decideAcademicAttendanceCorrection({}, actor, { ...h.form, CorrectionId: correction.CorrectionId,
    Decision: 'Approved', Reason: 'Class register checked', RevisionToken: correction.__updateTime });
  assert.equal(h.records.academicStudentAttendance.find(r => r.AttendanceId === legacy.AttendanceId).Status, 'Present');
  assert.equal(h.records.academicStudentAttendance.length, 2);
});

test('old cross-day correction requests cannot alter history but can be rejected', async () => {
  const h = dailyAttendanceFixture();
  await h.save({});
  await h.save({ Entries: [{ StudentRef: 'TEST/24/1633', Status: 'Present' }], CorrectionReason: 'Legacy request' });
  const correction = h.records.academicAttendanceCorrections[0];
  correction.AttendanceDate = '2026-10-16';
  const decision = { ...h.form, CorrectionId: correction.CorrectionId, Decision: 'Approved', Reason: 'Review', RevisionToken: correction.__updateTime };
  await assert.rejects(h.context.decideAcademicAttendanceCorrection({}, actor, decision), { code: 'ACADEMIC_ATTENDANCE_REGISTER_MISMATCH' });
  await h.context.decideAcademicAttendanceCorrection({}, actor, { ...decision, Decision: 'Rejected' });
  assert.equal(h.records.academicStudentAttendance[0].Status, 'Absent');
});

test('attendance identity distinguishes modes, subjects, periods, classrooms and long student references', async () => {
  const h = dailyAttendanceFixture();
  const base = { ...h.form, BranchId: 'main', SchoolSection: 'secondary', StudentRef: 'TEST/24/1633' };
  const variants = [{}, { AttendanceDate: '2026-10-16' }, { Mode: 'Subject', SubjectId: 'math' },
    { Mode: 'Subject', SubjectId: 'english' }, { Mode: 'Period', TimetableEntryId: 'lesson1' },
    { Mode: 'Period', TimetableEntryId: 'lesson2' }, { ArmId: 'another-arm' }, { ClassId: 'another-class' },
    { BranchId: 'another-branch' }, { SchoolSection: 'primary' }, { TermId: 'another-term' },
    { StudentRef: `${'student'.repeat(20)}a` }, { StudentRef: `${'student'.repeat(20)}b` }];
  const ids = await Promise.all(variants.map(v => attendanceIdentity.academicAttendanceId({ ...base, ...v })));
  assert.equal(new Set(ids).size, variants.length);
  assert.equal(await attendanceIdentity.academicAttendanceId(base), ids[0]);
  assert.throws(() => attendanceIdentity.findExistingAttendance([base, base], base, ids[0]), { code: 'ACADEMIC_ATTENDANCE_AMBIGUOUS' });
  assert.equal(attendanceIdentity.attendanceCorrectionMatches(base, { ...base, BranchId: '', SchoolSection: '' }), true);
  assert.equal(attendanceIdentity.attendanceCorrectionMatches({ ...base, Mode: undefined }, { ...base, Mode: 'Subject', SubjectId: 'math' }), true);
  assert.equal(attendanceIdentity.attendanceCorrectionMatches({ ...base, Mode: 'Subject', SubjectId: 'english' }, { ...base, Mode: 'Subject', SubjectId: 'math' }), false);
});

test('concurrent new attendance saves cannot create duplicate daily records', async () => {
  const h = dailyAttendanceFixture();
  const results = await Promise.allSettled([h.save({}), h.save({})]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal(h.records.academicStudentAttendance.length, 1);
  for (const result of results.filter(result => result.status === 'rejected')) assert.equal(result.reason.status, 409);
});

test('attendance correction approval still checks revisions and marking still checks teacher allocation', async () => {
  const h = dailyAttendanceFixture();
  await assert.rejects(h.context.saveAcademicStudentAttendance({}, { ...h.teacher, username: 'unallocated' }, h.form), { status: 403 });
  await h.save({});
  await h.save({ Entries: [{ StudentRef: 'TEST/24/1633', Status: 'Present' }], CorrectionReason: 'Correction request' });
  const correction = h.records.academicAttendanceCorrections[0];
  h.records.academicStudentAttendance[0].__updateTime = 'newer-revision';
  await assert.rejects(h.context.decideAcademicAttendanceCorrection({}, actor, { ...h.form, CorrectionId: correction.CorrectionId,
    Decision: 'Approved', Reason: 'Reviewed', RevisionToken: correction.__updateTime }), { code: 'ACADEMIC_WRITE_CONFLICT' });
  assert.equal(h.records.academicStudentAttendance[0].Status, 'Absent');
});

test('AM-06 concurrent timetable additions share an atomic version guard', async () => {
  const records = timetableRecords();
  const context = managementHarness(records);
  const commit = context.batchCommitDocuments;
  let count = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  context.batchCommitDocuments = async (...args) => { if (++count === 2) release(); await barrier; return commit(...args); };
  const lesson = { ...input, VersionId: 'v1', SubjectId: 'math', TeacherUsername: 'teacher', DayCode: 'MON', StartPeriodCode: 'P1' };
  const results = await Promise.allSettled([context.saveAcademicTimetableEntry({}, actor, lesson), context.saveAcademicTimetableEntry({}, actor, lesson)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'ACADEMIC_WRITE_CONFLICT');
  assert.equal(records.academicTimetableEntries.length, 1);
});

test('AM-07 newly added and existing midterm components serialize their own IDs', () => {
  const field = (value = '', checked = false) => ({ value, checked });
  const component = (name, selected, id = '') => ({ dataset: { policyId: id }, children: [field(name), field('50'), field('50'), field('manual'), field(), field('50'), field('0'), field('', true), field('', selected)] });
  for (const id of ['', 'saved-second-test']) {
    const fields = { academicComponents: { children: [component('First Test', false), component('Second Test', true, id)] }, academicGradeBands: { children: [] }, academicCumulativeTerms: { children: [] }, academicMidTermEnabled: field('', true) };
    const context = { loadedAcademicPolicyView: null, policyField: name => fields[name] || field(), policyNumber: (_name, fallback = null) => fallback, policyList: () => [] };
    vm.createContext(context);
    vm.runInContext(setupSource.slice(setupSource.indexOf('function academicPolicyFromForm('), setupSource.indexOf('function renderAcademicPolicyIssues(')), context);
    const result = policies.normalizeAcademicPolicy(context.academicPolicyFromForm());
    assert.equal(result.MidTerm.ComponentIds[0], id || 'second-test');
  }
});

test('AM-08 settings explain clearance without offering unsupported switches or changing scholarship billing', async () => {
  const access = { result: { Status: 'Published' }, hasActivePolicy: true, student: { BillingCategory: 'Full Scholarship' }, scholarshipFees: [], finance: { TotalDebit: 1000, TotalCredit: 0, OutstandingBalance: 1000 } };
  for (const recognize of [false, true]) {
    const policy = { ResultAccess: { VisibilityMode: 'all-published', FinancialClearance: { Mode: 'manual-clearance', RecognizeScholarships: recognize, AllowManualExemptions: false } } };
    assert.equal(evaluateAcademicResultAccess({ ...access, policy }).Allowed, true);
    assert.equal(access.finance.OutstandingBalance, 1000);
  }
  const html = await readFile(new URL('../setup.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /id="academicRecognize(?:Scholarships|PaymentPlans)"/);
  assert.match(html, /Payment plans do not automatically release results/);
  assert.match(html, /assigned scholarship charges/);
});

test('CBT-05 upload cleanup preserves files on uncertain save and removes them on definite rejection', async () => {
  for (const status of [400, 409, 503]) {
    const deleted = [];
    const context = { Response,
      requiredDeploymentIdentity: () => ({ edition: 'school' }), requireFirestoreEnv: () => {}, requireStaffSession: async () => actor,
      readJsonBody: async () => ({ Files: [{ FileName: 'paper.pdf', FileBase64: 'synthetic' }] }),
      validateAcademicCbtTestInput: async () => ({ context: { scope: { branchId: 'main', section: 'secondary' } }, record: { CbtTestId: 'test' } }),
      validateAcademicCbtPaper: () => ({ mimeType: 'application/pdf', byteLength: 1, fileName: 'paper.pdf' }), academicCbtPaperDigest: async () => 'digest',
      beginIdempotentRequest: async () => ({ enabled: true, owner: true, documentId: 'op' }), resolveDocumentStorage: async () => ({ configured: true }),
      putStoredDocument: async () => ({ documentUrl: 'r2://synthetic-paper' }),
      saveAcademicCbtTest: async () => { throw Object.assign(new Error('save failed'), { status }); },
      deleteStoredDocument: async (_env, url) => deleted.push(url), failIdempotentRequest: async () => {}
    };
    vm.createContext(context);
    vm.runInContext(stripModules(uploadSource), context);
    const response = await context.onRequestPost({ request: {}, env: {} });
    assert.equal(response.status, status);
    assert.equal(deleted.length, status >= 500 ? 0 : 1);
    assert.equal((await response.json()).outcomeUncertain, status >= 500);
  }
});

test('CBT-05 a committed paper save with a lost acknowledgement is reconciled by its exact record', async () => {
  for (const committed of [true, false]) {
    const records = {};
    const context = managementHarness(records);
    const commit = context.batchCommitDocuments;
    context.batchCommitDocuments = async (...args) => {
      if (committed) await commit(...args);
      throw Object.assign(new Error('Lost response'), { status: 503 });
    };
    const validation = { record: row({ CbtTestId: 'cbt-recovery', UpdatedAt: '2026-10-11T10:00:00Z', PaperMode: 'single', AssessmentComponentName: 'Test', RosterCount: 1 }) };
    const save = context.saveAcademicCbtTest({}, actor, { PaperFiles: [{ Url: 'https://example.test/paper.pdf', FileName: 'paper.pdf', MimeType: 'application/pdf', Digest: 'a'.repeat(64), ByteLength: 100, PageNumber: 1 }] }, { validation });
    if (committed) {
      const result = await save;
      assert.equal(result.ok, true);
      assert.equal(result.cbtTest.RevisionToken, records.academicCbtTests[0].__updateTime);
      assert.equal(result.cbtTest.PaperUrl, 'https://example.test/paper.pdf');
    } else {
      await assert.rejects(save, { status: 503, code: 'ACADEMIC_CBT_SAVE_UNCERTAIN', outcomeUncertain: true });
    }
  }
});
