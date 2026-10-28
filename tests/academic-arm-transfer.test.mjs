import test from 'node:test';
import assert from 'node:assert/strict';
import { planAcademicArmDataTransfer, isAcademicArmTransfer } from '../functions/lib/academic-arm-transfer.js';
import { academicCarriedScoreReview, academicCarriedScoreSnapshot } from '../functions/lib/academic-carried-score-review.js';
import { academicComponentReviews } from '../functions/lib/academic-component-review.js';
import { academicAssessmentScheme, calculateAcademicStudentScore } from '../functions/lib/academic-scorebook.js';
import { calculateAcademicTermResultDrafts } from '../functions/lib/academic-term-results.js';
import { defaultAcademicPolicy } from '../functions/lib/academic-policy.js';
import { findExistingAttendance, attendanceCorrectionMatches } from '../functions/lib/academic-attendance-identity.js';

const clone = value => structuredClone(value);
const components = [{ Id: 'ca1', Name: 'CA1', MaximumScore: 100, WeightPercentage: 20, Required: true },
  { Id: 'exam', Name: 'Exam', MaximumScore: 100, WeightPercentage: 80, Required: true }];
const bands = [{ Grade: 'A', MinimumPercentage: 0, MaximumPercentage: 100 }];
const idOf = row => row.ScoreId || row.SheetId || row.ResultId || row.AttendanceId || row.CorrectionId;

function fixture({ section = 'secondary', grade = 'Grade 10', sourceStatus = 'Approved', destinationStatus = 'Approved', createDestination = true } = {}) {
  const period = { BranchId: 'main', SchoolSection: section, SessionId: '2026', TermId: 'first', ClassId: grade };
  const before = { ...period, StudentRef: 'P1', MembershipId: 'member', ArmId: 'perfection', Status: 'Active',
    SubjectIds: ['math'], CoreSubjectIds: ['math'], __updateTime: 'member-v1' };
  const after = { ...before, ArmId: 'genius' };
  const source = { ...period, SheetId: 'source', SubjectId: 'math', ArmId: before.ArmId, Status: sourceStatus,
    AssessmentComponents: clone(components), GradeBands: clone(bands), AssessmentRevisionId: 'scheme', __updateTime: 'source-v1' };
  const destination = { ...clone(source), SheetId: 'destination', ArmId: after.ArmId, Status: destinationStatus, __updateTime: 'destination-v1' };
  const scheme = academicAssessmentScheme({ Assessment: { Components: components, GradeBands: bands } }, { RevisionId: 'scheme' });
  const score = { ...period, ScoreId: 'original-score-id', SheetId: 'source', SubjectId: 'math', StudentRef: 'P1', ArmId: before.ArmId,
    AssessmentRevisionId: 'scheme', ...calculateAcademicStudentScore(scheme, [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 0 },
      { ComponentId: 'exam', State: 'Numeric', RawScore: 85 }]), SourceType: 'Built-in CBT', CbtAttemptIds: ['attempt-1'], __updateTime: 'score-v1' };
  const peer = { ...score, ScoreId: 'peer-score', StudentRef: 'P2', SheetId: 'destination', ArmId: after.ArmId, __updateTime: 'peer-v1' };
  const result = { ...period, ResultId: 'published-result', StudentRef: 'P1', ArmId: before.ArmId, ArmName: 'Perfection', Status: 'Published',
    ResultType: 'Mid-Term', ResultReference: 'PARENT-LINK', Subjects: [{ SubjectId: 'math', Total: 68 }], OverallPosition: 4,
    PublishedAt: '2026-10-27T12:00:00Z', __updateTime: 'result-v1' };
  const attendance = { ...period, AttendanceId: 'old-attendance-id', StudentRef: 'P1', ArmId: before.ArmId,
    Mode: 'Daily', AttendanceDate: '2026-10-27', Status: 'Present', Note: 'Original note', __updateTime: 'attendance-v1' };
  const correction = { ...attendance, AttendanceId: attendance.AttendanceId, AttendanceRevision: attendance.__updateTime,
    CorrectionId: 'correction', RequestedStatus: 'Late', Status: 'Pending', __updateTime: 'correction-v1' };
  const dbState = { academicScoreSheets: createDestination ? [source, destination] : [source],
    academicStudentScores: createDestination ? [score, peer] : [score], academicResults: [result],
    academicStudentAttendance: [attendance], academicAttendanceCorrections: [correction] };
  const state = { arms: [{ ArmId: 'genius', Name: 'Genius' }], subjects: [{ SubjectId: 'math', Name: 'Mathematics' }],
    teacherAllocations: [], studentMemberships: [before, { ...after, StudentRef: 'P2', MembershipId: 'other' }] };
  const reads = [];
  const deps = {
    getDocuments: async (_env, collection, ids) => { reads.push({ collection, ids }); return ids.map(id => clone(dbState[collection].find(row => row.SheetId === id) || null)); },
    queryCollection: async (_env, collection, options) => {
      reads.push({ collection, options });
      return clone((dbState[collection] || []).filter(row => options.filters.every(f => row[f.field] === f.value)));
    }
  };
  const plan = (previous = before, next = after) => planAcademicArmDataTransfer({}, { before: previous, after: next, state,
    evidence: { studentScores: dbState.academicStudentScores.filter(row => row.StudentRef === 'P1'), termResults: dbState.academicResults },
    sheetIdFor: () => next.ArmId === 'genius' ? 'destination' : 'source', actor: { timestamp: '2026-10-28T12:00:00Z', name: 'Officer' } }, deps);
  function commit(writes) {
    for (const w of writes) {
      const previous = (dbState[w.collectionPath] || []).find(row => (w.collectionPath === 'academicAttendanceCorrections' ? row.CorrectionId : idOf(row)) === w.documentId);
      if ((w.exists === false && previous) || (w.updateTime && previous?.__updateTime !== w.updateTime)) throw new Error('Concurrent change');
    }
    for (const w of writes) {
      const rows = dbState[w.collectionPath], index = rows.findIndex(row => (w.collectionPath === 'academicAttendanceCorrections' ? row.CorrectionId : idOf(row)) === w.documentId);
      const row = { ...(w.updateMask ? rows[index] : {}), ...clone(w.data), __updateTime: `next-${w.documentId}` };
      if (index < 0) rows.push(row); else rows[index] = row;
    }
    state.studentMemberships[0] = { ...after };
  }
  return { before, after, state, dbState, source, destination, score, peer, result, attendance, correction, reads, plan, commit };
}

for (const [section, grade] of [['primary', 'Nursery 2'], ['primary', 'Grade 4'], ['secondary', 'Grade 7'], ['secondary', 'Grade 12']]) {
  test(`${grade}: same IDs, exact marks, saved subjects, published results and attendance follow the student`, async () => {
    const f = fixture({ section, grade }), original = clone(f.dbState);
    const p = await f.plan();
    assert.deepEqual(f.dbState, original, 'planning is read-only');
    f.commit(p.writes);
    const moved = f.dbState.academicStudentScores.find(row => row.StudentRef === 'P1');
    assert.equal(moved.ScoreId, f.score.ScoreId); assert.equal(moved.ArmId, 'genius'); assert.equal(moved.SheetId, 'destination');
    for (const key of ['ComponentScores', 'WeightedTotal', 'Percentage', 'Grade', 'CbtAttemptIds', 'SourceType']) assert.deepEqual(moved[key], f.score[key]);
    assert.deepEqual(f.dbState.academicStudentScores.find(row => row.StudentRef === 'P2'), f.peer);
    assert.equal(f.dbState.academicResults[0].ArmId, 'genius');
    for (const key of ['ResultId', 'ResultReference', 'Status', 'Subjects', 'PublishedAt', 'OverallPosition']) assert.deepEqual(f.dbState.academicResults[0][key], f.result[key]);
    const record = f.dbState.academicStudentAttendance[0];
    assert.equal(record.ArmId, 'genius'); assert.equal(record.Status, 'Present'); assert.equal(record.RecordedArmId, 'perfection');
    assert.equal(findExistingAttendance([record], { ...f.attendance, ArmId: 'genius' }, 'new-generated-id').AttendanceId, f.attendance.AttendanceId);
    assert.equal(attendanceCorrectionMatches(f.dbState.academicAttendanceCorrections[0], record), true);
    assert.deepEqual(p.summary.OriginalScoreRecords[0].ComponentScores, f.score.ComponentScores);
    assert.ok(p.writes.every(w => w.operation !== 'delete' && w.data.Status !== 'Archived'));
    assert.ok(f.reads.every(read => read.ids || (read.options.filters.some(f => f.field === 'StudentRef') || read.options.filters.some(f => f.field === 'SheetId'))));
  });
}

test('approved classmates keep their test reviews when a student leaves or joins', async () => {
  const f = fixture();
  const sourcePeer = { ...f.peer, StudentRef: 'P3', SheetId: 'source', ScoreId: 'source-peer', ArmId: 'perfection' };
  f.dbState.academicStudentScores.push(sourcePeer);
  f.state.studentMemberships.push({ ...f.before, StudentRef: 'P3', MembershipId: 'third' });
  for (const sheet of [f.source, f.destination]) {
    const roster = f.state.studentMemberships.filter(row => row.ArmId === sheet.ArmId);
    const reviews = await academicComponentReviews(sheet, roster, f.dbState.academicStudentScores);
    sheet.ComponentReviews = Object.fromEntries(reviews.map(row => [row.ComponentId, { ...row, Status: 'Approved', ApprovedBy: 'Reviewer' }]));
  }
  f.commit((await f.plan()).writes);
  for (const sheet of f.dbState.academicScoreSheets) {
    const roster = f.state.studentMemberships.filter(row => row.ArmId === sheet.ArmId);
    const reviews = await academicComponentReviews(sheet, roster, f.dbState.academicStudentScores);
    assert.ok(reviews.every(row => row.Status === 'Approved' && !row.Stale));
  }
  assert.deepEqual(f.dbState.academicStudentScores.find(row => row.StudentRef === 'P3'), sourcePeer);
});

test('a transferred draft cannot inherit approvals; approved destination classmates stay approved', async () => {
  const f = fixture({ sourceStatus: 'Draft' });
  const reviews = await academicComponentReviews(f.destination, [f.state.studentMemberships[1]], [f.peer]);
  f.destination.ComponentReviews = Object.fromEntries(reviews.map(row => [row.ComponentId, { ...row, Status: 'Approved' }]));
  f.commit((await f.plan()).writes);
  const sheet = f.dbState.academicScoreSheets.find(row => row.SheetId === 'destination');
  assert.equal(sheet.Status, 'Approved'); assert.deepEqual(sheet.PendingStudentRefs, ['P1']);
  assert.equal(academicCarriedScoreReview(f.dbState.academicStudentScores[0]).Status, 'Draft');
  const current = await academicComponentReviews(sheet, f.state.studentMemberships, f.dbState.academicStudentScores);
  assert.ok(current.every(row => row.Status === 'Approved' && row.PendingStudentCount === 1));
});

test('an existing individual approval remains usable in a new Draft destination without approving other students', async () => {
  const f = fixture({ createDestination: false });
  f.commit((await f.plan()).writes);
  const policy = defaultAcademicPolicy(); policy.Position.Mode = 'exact-overall'; policy.Promotion.Mode = 'manual-review';
  policy.Assessment = { Components: components, GradeBands: bands };
  const calculate = () => calculateAcademicTermResultDrafts({ ...f.after, Memberships: f.state.studentMemberships,
    ScoreSheets: f.dbState.academicScoreSheets, StudentScores: f.dbState.academicStudentScores,
    Subjects: f.state.subjects, Policy: policy, AllowPartialResults: true });
  const output = calculate();
  assert.equal(output.Results.length, 1); assert.equal(output.Results[0].StudentRef, 'P1');
  assert.equal(output.PendingResults[0].StudentRef, 'P2');
  f.dbState.academicStudentScores[0].ComponentScores[0].RawScore = 1;
  assert.equal(academicCarriedScoreReview(f.dbState.academicStudentScores[0]), null);
  assert.equal(calculate().Results.length, 0, 'editing the carried marks requires a new review');
});

test('a different destination layout retains raw marks and original snapshot, leaving new required parts pending', async () => {
  const f = fixture();
  f.destination.AssessmentComponents[0].ScoreEntryMode = 'objective-theory';
  f.destination.AssessmentComponents[0].ObjectiveMaximumScore = 40;
  f.destination.AssessmentComponents[0].TheoryMaximumScore = 60;
  const plan = await f.plan(); f.commit(plan.writes);
  const moved = f.dbState.academicStudentScores[0];
  assert.equal(moved.ComponentScores[0].Parts.find(row => row.PartId === 'objective').RawScore, 0);
  assert.equal(moved.ComponentScores[0].Parts.find(row => row.PartId === 'theory').State, 'Missing');
  assert.deepEqual(plan.summary.OriginalScoreRecords[0].ComponentScores, f.score.ComponentScores);
  assert.equal(moved.ArmTransferReview.Status, 'Draft');
});

test('conflicting marks, unsafe layouts, missing sheets and duplicate results stop before any write', async () => {
  for (const mutate of [
    f => f.dbState.academicStudentScores.push({ ...f.peer, StudentRef: 'P1' }),
    f => { f.destination.AssessmentComponents = [f.destination.AssessmentComponents[1]]; },
    f => { f.dbState.academicScoreSheets = [f.destination]; },
    f => f.dbState.academicResults.push({ ...f.result, ResultId: 'duplicate' }),
    f => f.dbState.academicStudentAttendance.push({ ...f.attendance, AttendanceId: 'duplicate', ArmId: 'genius' })
  ]) {
    const f = fixture(); mutate(f); const previous = clone(f.dbState);
    await assert.rejects(f.plan(), { code: 'ACADEMIC_ARM_TRANSFER_CONFLICT' });
    assert.deepEqual(f.dbState, previous);
  }
});

test('score, sheet, result and attendance revisions reject an atomic transfer racing an edit', async () => {
  for (const collection of ['academicStudentScores', 'academicScoreSheets', 'academicResults', 'academicStudentAttendance', 'academicAttendanceCorrections']) {
    const f = fixture(), plan = await f.plan();
    f.dbState[collection][0].__updateTime = 'concurrent';
    const previous = clone(f.dbState);
    assert.throws(() => f.commit(plan.writes), /Concurrent/);
    assert.deepEqual(f.dbState, previous);
  }
});

test('retry and unrelated scope changes do not move or copy records', async () => {
  const f = fixture(); f.commit((await f.plan()).writes);
  const previous = clone(f.dbState), readCount = f.reads.length;
  const retry = await f.plan(f.after, f.after);
  assert.deepEqual(retry.writes, []); assert.equal(f.reads.length, readCount); assert.deepEqual(f.dbState, previous);
  for (const field of ['ClassId', 'TermId', 'SessionId', 'BranchId', 'SchoolSection', 'StudentRef']) assert.equal(isAcademicArmTransfer(f.before, { ...f.after, [field]: 'different' }), false);
});

test('prior terms and other students are never moved', async () => {
  const f = fixture();
  const historical = { ...f.result, ResultId: 'old-term', TermId: 'old' };
  f.dbState.academicResults.push(historical);
  f.commit((await f.plan()).writes);
  assert.deepEqual(f.dbState.academicResults.find(row => row.ResultId === 'old-term'), historical);
});


test('missing, absent, exempt and zero marks are preserved exactly during a transfer',async()=>{
  for(const State of ['Numeric','Absent','Exempt','Missing']){
    const f=fixture();
    f.score.ComponentScores[0]={ComponentId:'ca1',State,RawScore:State==='Numeric'?0:null,Note:'Original note'};
    const marks=clone(f.score.ComponentScores);
    f.commit((await f.plan()).writes);
    assert.deepEqual(f.dbState.academicStudentScores[0].ComponentScores,marks);
  }
});

test('carried approvals survive field-order differences but not controlled reopening',async()=>{
  const f=fixture();f.commit((await f.plan()).writes);
  const moved=f.dbState.academicStudentScores[0];
  moved.ComponentScores=moved.ComponentScores.map(row=>Object.fromEntries(Object.entries(row).reverse()));
  assert.equal(academicCarriedScoreReview(moved).Status,'Approved');
  assert.equal(academicCarriedScoreReview(moved,{ReopenedAt:'2026-10-28T12:01:00Z'}),null);
});

test('pending attendance corrections follow an unchanged register but do not authorize a later edited record',async()=>{
  const f=fixture();f.commit((await f.plan()).writes);
  const row=f.dbState.academicStudentAttendance[0], correction=f.dbState.academicAttendanceCorrections[0];
  const snapshot=record=>academicCarriedScoreSnapshot(Object.fromEntries(Object.entries(record).filter(([key])=>!key.startsWith('__'))));
  assert.equal(correction.AttendanceTransferState,snapshot(row));
  assert.notEqual(correction.AttendanceTransferState,snapshot({...row,Status:'Absent'}));
});

test('moving back reuses original score/result/attendance IDs without duplicate records',async()=>{
  const f=fixture();f.commit((await f.plan()).writes);
  const returning=await f.plan(f.after,f.before);f.commit(returning.writes);
  assert.equal(f.dbState.academicStudentScores.filter(row=>row.StudentRef==='P1').length,1);
  assert.equal(f.dbState.academicStudentScores[0].ScoreId,'original-score-id');
  assert.equal(f.dbState.academicStudentScores[0].SheetId,'source');
  assert.deepEqual(f.dbState.academicStudentScores[0].ComponentScores,f.score.ComponentScores);
  assert.equal(f.dbState.academicResults.length,1);assert.equal(f.dbState.academicResults[0].ResultId,'published-result');
  assert.equal(f.dbState.academicStudentAttendance.length,1);
});
