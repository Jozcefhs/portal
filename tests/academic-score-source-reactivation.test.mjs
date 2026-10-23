import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { academicAssessmentScheme, academicEffectiveScoreSources, academicScoreSourceIssues,
  calculateAcademicStudentScore, validateAcademicScoreImport } from '../functions/lib/academic-scorebook.js';
import { reactivateAcademicClassScoreEditing, academicLockedScoreChanges,
  academicManualScoreCorrection } from '../functions/lib/academic-management.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const functionSource = name => {
  const start = source.search(new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const rest = source.slice(start);
  const end = rest.slice(1).search(/^(?:export )?(?:async )?function /m);
  return rest.slice(0, end < 0 ? undefined : end + 1).replace(/^export /, '');
};
const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const failure = (message, status, code) => Object.assign(new Error(message), { status, code });
const plain = value => JSON.parse(JSON.stringify(value));
const policy = { Assessment: { Components: [
  { Id: 'ca1', Name: 'CA1', MaximumScore: 100, WeightPercentage: 10, SourceMode: 'built-in-cbt' },
  { Id: 'exam', Name: 'Exam', MaximumScore: 100, WeightPercentage: 90, SourceMode: 'built-in-cbt',
    ScoreEntryMode: 'objective-theory', ObjectiveMaximumScore: 40, TheoryMaximumScore: 60 }
], GradeBands: [{ Grade: 'A', MinimumPercentage: 0, MaximumPercentage: 100 }] } };
const marks = [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 85 }, { ComponentId: 'exam', Parts: [
  { PartId: 'objective', State: 'Numeric', RawScore: 32 }, { PartId: 'theory', State: 'Numeric', RawScore: 49 }
] }];
const snapshot = academicAssessmentScheme(policy, { RevisionId: 'old' });
const anyPolicy = structuredClone(policy);
anyPolicy.Assessment.Components.forEach(component => { component.SourceMode = 'any'; });
const active = academicAssessmentScheme(anyPolicy, { RevisionId: 'new' });

test('Any approved source applies to both parts and all supported entry channels', () => {
  assert.deepEqual(active.Components[1].ScoreParts.map(part => part.SourceMode), ['any', 'any']);
  for (const mode of ['manual', 'spreadsheet', 'built-in-cbt', 'external-cbt']) {
    assert.deepEqual(academicScoreSourceIssues(active, marks, mode), []);
  }
  assert.ok(academicScoreSourceIssues(snapshot, marks, 'manual').length);
});

test('existing scorebook overlay changes only permissions, not marks, weights, maxima, grades or layout', () => {
  const changed = structuredClone(active);
  changed.Components[0].MaximumScore = 10;
  changed.Components[1].ScoreParts[0].MaximumScore = 5;
  changed.GradeBands[0].Grade = 'F';
  const before = structuredClone(snapshot), originalMarks = structuredClone(marks);
  const effective = academicEffectiveScoreSources(snapshot, changed);
  assert.deepEqual(snapshot, before);
  assert.equal(effective.RevisionId, 'old');
  assert.equal(effective.Components[0].MaximumScore, 100);
  assert.equal(effective.Components[1].ScoreParts[0].MaximumScore, 40);
  assert.deepEqual(effective.GradeBands, snapshot.GradeBands);
  const marksAndTotals = scheme => JSON.parse(JSON.stringify(calculateAcademicStudentScore(scheme, marks),
    (key, value) => key === 'SourceMode' ? undefined : value));
  assert.deepEqual(marksAndTotals(effective), marksAndTotals(snapshot));
  assert.deepEqual(marks, originalMarks);
  assert.deepEqual(academicScoreSourceIssues(effective, marks, 'manual'), []);
  assert.equal(validateAcademicScoreImport([{ StudentRef: 'fictional', ComponentScores: marks }], {
    scheme: effective, roster: [{ StudentRef: 'fictional' }]
  }).Ready, true);
});

test('only matching active Any components broaden permissions; invalid policies do not', () => {
  assert.equal(academicEffectiveScoreSources(snapshot, { ...active, Ready: false }), snapshot);
  const unmatched = { ...active, Components: [{ ...active.Components[0], Id: 'other' }] };
  assert.deepEqual(academicEffectiveScoreSources(snapshot, unmatched), snapshot);
  const restricted = { ...active, Components: [{ ...active.Components[0], SourceMode: 'manual' }] };
  assert.deepEqual(academicEffectiveScoreSources(snapshot, restricted), snapshot);
});

test('Any does not unlock saved CBT scores or bypass correction authorisation', () => {
  const scheme = academicEffectiveScoreSources(snapshot, active);
  const previous = { ComponentScores: marks, CbtScoreSources: [{ CellId: 'ca1' }] };
  const edited = structuredClone(marks); edited[0].RawScore = 90;
  assert.ok(academicLockedScoreChanges(previous, edited, false).length);
  assert.throws(() => academicManualScoreCorrection(scheme, previous, edited, {}), { code: 'ACADEMIC_SCORE_SOURCE_FORBIDDEN' });
  const corrections = academicManualScoreCorrection(scheme, previous, edited, {
    ScoreEditingReactivated: true, ScoreEditingReactivationReason: 'Verified script correction'
  });
  assert.equal(corrections[0].Before.RawScore, 85);
  assert.equal(corrections[0].After.RawScore, 90);
  assert.equal(previous.ComponentScores[0].RawScore, 85);
});

test('score-sheet writes retain the snapshot, not the effective permission overlay', () => {
  const context = vm.createContext({ clean, lower, actorName: () => 'manager' });
  vm.runInContext(functionSource('academicScoreSheetRecord'), context);
  const record = context.academicScoreSheetRecord({ scope: { branchId: 'b', section: 'secondary' },
    session: {}, term: {}, schoolClass: {}, arm: {}, subject: {}, allocation: {}, roster: [],
    scheme: academicEffectiveScoreSources(snapshot, active), snapshotScheme: snapshot
  }, {}, {}, 'now');
  assert.deepEqual(record.AssessmentComponents, snapshot.Components);
  assert.equal(record.AssessmentRevisionId, 'old');
});

test('legacy recorded CBT provenance remains audited after Any, while empty split fields allow manual entry', () => {
  const effective = academicEffectiveScoreSources(snapshot, active);
  const previous = { ComponentScores: marks };
  const edited = structuredClone(marks); edited[0].RawScore = 90; edited[1].Parts[0].RawScore = 35;
  const sheet = { AssessmentComponents: snapshot.Components, ScoreEditingReactivated: true,
    ScoreEditingReactivationReason: 'Reviewed original script' };
  const corrections = academicManualScoreCorrection(effective, previous, edited, sheet);
  assert.deepEqual(corrections.map(row => row.CellId), ['ca1', 'exam:objective']);
  assert.deepEqual(academicManualScoreCorrection(effective, null, marks, sheet), []);
  const originallyManual = { ...sheet, AssessmentComponents: active.Components };
  assert.deepEqual(academicManualScoreCorrection(effective, previous, edited, originallyManual), []);
});

const period = { BranchId: 'b', SchoolSection: 'secondary', SessionId: 's', TermId: 't', ClassId: 'g7' };
const sheet = (id, patch = {}) => ({ ...period, SheetId: id, RecordId: id, ArmId: 'a', SubjectId: 'math',
  Status: 'Locked', AssessmentComponents: snapshot.Components, AssessmentRevisionId: 'old',
  GradeBands: snapshot.GradeBands, EnteredCount: 40, __updateTime: `revision-${id}`, ...patch });
function harness(sheets, commitError) {
  const writes = [];
  const ctx = vm.createContext({ clean, lower, failure,
    academicOperationalContext: async (_env, _user, input, capability, options) => {
      assert.equal(capability, 'canManageScoreCorrections');
      assert.deepEqual(plain(options.stateKeys), ['sessions', 'terms', 'classes', 'scoreSheets']);
      return { scope: { branchId: 'b', section: 'secondary' }, session: { SessionId: 's' }, term: { TermId: 't' },
        state: { scoreSheets: sheets, classes: [{ ClassId: 'g7', Name: 'Grade 7', SchoolSection: 'secondary' }] } };
    },
    findById: (rows, id) => rows.find(row => row.ClassId === id),
    assertReference: record => { if (!record) throw failure('Class forbidden', 403); return record; },
    ACADEMIC_SCORE_SHEET_STATUSES: ['Draft', 'Submitted', 'Approved', 'Locked'],
    ACADEMIC_MANAGEMENT_COLLECTIONS: { scoreSheets: 'sheets' },
    nowIso: () => 'now', actorName: () => 'Manager', actorUsername: () => 'manager',
    withoutMetadata: row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__'))),
    auditWrite: (_user, action, _type, row, reason) => ({ collectionPath: 'audit', data: { action, reason, SheetId: row.SheetId } }),
    batchCommitDocuments: async (_env, batch, options) => {
      assert.equal(options.allowLargeAtomicBatch, true);
      if (commitError) throw commitError;
      writes.push(...batch);
    }
  });
  for (const name of ['writePrecondition', 'commitAcademicBatch', 'reactivateAcademicClassScoreEditing']) vm.runInContext(functionSource(name), ctx);
  return { run: input => ctx.reactivateAcademicClassScoreEditing({}, {}, { ...period, Reason: 'Verified correction', ...input }), writes };
}

test('class reactivation updates metadata across all arms/subjects, not scores or other classes/periods/branches', async () => {
  const sheets = [sheet('one'), sheet('two', { ArmId: 'b', SubjectId: 'english', Status: 'Submitted' }),
    sheet('open', { Status: 'Draft', ScoreEditingReactivated: true }),
    ...[{ ClassId: 'g8' }, { TermId: 'old' }, { SessionId: 'old' }, { BranchId: 'other' },
      { SchoolSection: 'primary' }, { Status: 'Archived' }].map((patch, i) => sheet(`excluded-${i}`, patch))];
  const before = structuredClone(sheets), { run, writes } = harness(sheets);
  const result = await run();
  assert.equal(result.ReactivatedCount, 2); assert.equal(result.AlreadyReactivatedCount, 1);
  assert.equal(writes.length, 4);
  for (const write of writes.filter(row => row.collectionPath === 'sheets')) {
    const original = sheets.find(row => row.SheetId === write.documentId);
    assert.equal(write.updateTime, original.__updateTime);
    assert.equal(write.data.ScoreEditingReactivated, true);
    assert.equal(write.data.Status, 'Draft');
    assert.deepEqual(write.data.AssessmentComponents, original.AssessmentComponents);
    assert.deepEqual(write.data.GradeBands, original.GradeBands);
    assert.equal(write.data.AssessmentRevisionId, original.AssessmentRevisionId);
    assert.equal(write.data.EnteredCount, 40);
  }
  assert.deepEqual(sheets, before);
  assert.ok(writes.every(row => ['sheets', 'audit'].includes(row.collectionPath)));
});

test('whole-class reactivation handles more than 250 sheets in a single atomic commit', async () => {
  const { run, writes } = harness(Array.from({ length: 260 }, (_, i) => sheet(String(i))));
  assert.equal((await run()).ReactivatedCount, 260);
  assert.equal(writes.length, 520);
});

test('short reasons, invalid classes, empty classes and concurrent writes never report success', async () => {
  for (const input of [{ Reason: 'x' }, { ClassId: 'g8' }]) {
    const { run, writes } = harness([sheet('one')]);
    await assert.rejects(run(input)); assert.equal(writes.length, 0);
  }
  await assert.rejects(harness([]).run(), { code: 'ACADEMIC_SCORE_SHEET_EMPTY' });
  const conflict = harness([sheet('one')], { status: 412 });
  await assert.rejects(conflict.run(), { code: 'ACADEMIC_WRITE_CONFLICT' });
  assert.equal(conflict.writes.length, 0);
  const already = harness([sheet('open', { Status: 'Draft', ScoreEditingReactivated: true })]);
  assert.equal((await already.run()).ReactivatedCount, 0); assert.equal(already.writes.length, 0);
});

test('ordinary teachers cannot reopen a class before data loading', async () => {
  await assert.rejects(reactivateAcademicClassScoreEditing({}, { role: 'Teacher', username: 'teacher' }, period),
    error => error.status === 403);
});

test('live permission overlay is used by score contexts without replacing the historical snapshot', () => {
  const body = functionSource('academicScoreSheetContext');
  assert.match(body, /academicAssessmentForPeriod[\s\S]*classId: schoolClass.ClassId, subjectId: subject.SubjectId/);
  assert.match(body, /academicEffectiveScoreSources\(snapshotScheme, activeScheme\)/);
  assert.match(body, /snapshotScheme, activeScheme/);
});
