import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { academicAssessmentScheme, calculateAcademicStudentScore, normalizeAcademicComponentScores } from '../functions/lib/academic-scorebook.js';
import { academicWeightedResultComponents, academicResultWithWeightedComponents } from '../functions/lib/academic-result-marks.js';
import { academicManualScoreCorrection } from '../functions/lib/academic-management.js';
import { publicAcademicResult } from '../functions/lib/academic-result-access.js';

const policy = { Assessment: { Components: [
  { Id: 'ca1', Name: 'CA1', MaximumScore: 100, WeightPercentage: 10, SourceMode: 'built-in-cbt', Required: true },
  { Id: 'ca2', Name: 'CA2', MaximumScore: 100, WeightPercentage: 10, SourceMode: 'built-in-cbt', ScoreEntryMode: 'objective-theory',
    ObjectiveMaximumScore: 50, TheoryMaximumScore: 50, ObjectiveSourceMode: 'built-in-cbt', TheorySourceMode: 'manual', Required: true },
  { Id: 'ca3', Name: 'CA3', MaximumScore: 10, WeightPercentage: 10, SourceMode: 'manual', Required: true },
  { Id: 'exam', Name: 'Exam', MaximumScore: 100, WeightPercentage: 70, SourceMode: 'external-cbt', Required: true }
], GradeBands: [{ Grade: 'A', MinimumPercentage: 0, MaximumPercentage: 100, GradePoint: 5 }] } };
const scheme = academicAssessmentScheme(policy);
const raw = [ { ComponentId: 'ca1', RawScore: 85 },
  { ComponentId: 'ca2', Parts: [{ PartId: 'objective', RawScore: 40 }, { PartId: 'theory', RawScore: 30 }] },
  { ComponentId: 'ca3', RawScore: 9 }, { ComponentId: 'exam', RawScore: 80 } ];
const subject = (input = raw) => ({ SubjectId: 'maths', SubjectName: 'Mathematics', ...calculateAcademicStudentScore(scheme, input) });
const result = () => { const score = subject(); return { Status: 'Published', PolicySnapshot: policy, Subjects: [{ ...score, Total: score.Percentage }] }; };

test('CA1, split CA2, CA3 and exam show weighted marks, with unchanged total and grade', () => {
  const original = result(), before = structuredClone(original);
  const projected = academicResultWithWeightedComponents(original);
  const marks = projected.Subjects[0].WeightedComponents;
  assert.deepEqual(marks.map(row => row.Name), ['CA1', 'CA2', 'CA3', 'Exam']);
  assert.deepEqual(marks.map(row => row.WeightedMark), [8.5, 7, 9, 56]);
  assert.deepEqual(marks.map(row => row.MaximumMark), [10, 10, 10, 70]);
  assert.equal(projected.Subjects[0].Total, 80.5);
  assert.equal(projected.Subjects[0].Grade, 'A');
  assert.deepEqual(original, before);
});

test('exempt components and split parts use the same adjusted denominator as the saved total', () => {
  const input = structuredClone(raw); input[1].Parts[0] = { PartId: 'objective', State: 'Exempt' };
  input[3] = { ComponentId: 'exam', State: 'Exempt' };
  const score = subject(input), marks = academicWeightedResultComponents(score, policy);
  assert.deepEqual(marks.map(row => row.WeightedMark), [34, 12, 36, null]);
  assert.deepEqual(marks.map(row => row.MaximumMark), [40, 20, 40, null]);
  assert.equal(marks[3].State, 'Exempt');
  assert.equal(score.Percentage, 82);
});

test('absent is zero; missing, unknown legacy metadata and inconsistent snapshots never invent marks', () => {
  const input = structuredClone(raw); input[0] = { ComponentId: 'ca1', State: 'Absent' };
  assert.equal(academicWeightedResultComponents(subject(input), policy)[0].WeightedMark, 0);
  input[0] = { ComponentId: 'ca1', State: 'Missing' };
  assert.equal(academicWeightedResultComponents(subject(input), policy)[0].WeightedMark, null);
  const legacy = { Total: 85, ComponentScores: [{ ComponentId: 'ca1', RawScore: 85, State: 'Numeric' }] };
  assert.equal(academicWeightedResultComponents(legacy, policy)[0].State, 'Unavailable');
  assert.deepEqual(academicWeightedResultComponents({ Total: 85 }), []);
  assert.ok(academicWeightedResultComponents({ ...subject(), Total: 99 }, policy).every(row => row.WeightedMark === null));
});

test('mid-term saved scaled weights and custom names are honoured without applying current policy weights', () => {
  const score = { Total: 65, ComponentScores: [{ ComponentId: 'project', ComponentName: 'Research project', State: 'Numeric', RawScore: 65, MaximumScore: 100, WeightPercentage: 100 }] };
  assert.deepEqual(academicWeightedResultComponents(score, policy)[0], {
    ComponentId: 'project', Name: 'Research project', State: 'Numeric', WeightedMark: 65, MaximumMark: 100
  });
  const changedPolicy = structuredClone(policy); changedPolicy.Assessment.Components[0].WeightPercentage = 90;
  const publicResult = publicAcademicResult(result(), { Allowed: true }, changedPolicy);
  assert.equal(publicResult.Subjects[0].WeightedComponents[0].WeightedMark, 8.5);
  assert.equal('ComponentScores' in publicResult.Subjects[0], false);
  assert.equal('Subjects' in publicAcademicResult(result(), { Allowed: false }, policy), false);
});

test('only server-authorised recorded CBT corrections bypass source-mode restrictions', () => {
  const previous = subject(), next = normalizeAcademicComponentScores([{ ComponentId: 'ca1', RawScore: 90 }], scheme, { existing: previous.ComponentScores, partial: true });
  assert.throws(() => academicManualScoreCorrection(scheme, previous, next), { code: 'ACADEMIC_SCORE_SOURCE_FORBIDDEN' });
  assert.throws(() => academicManualScoreCorrection(scheme, previous, next, { ScoreEditingReactivated: true }), { code: 'ACADEMIC_SCORE_SOURCE_FORBIDDEN' });
  const unlock = { ScoreEditingReactivated: true, ScoreEditingReactivationReason: 'Verified marking correction', ScoreEditingReactivatedByUsername: 'principal' };
  const changes = academicManualScoreCorrection(scheme, previous, next, unlock);
  assert.equal(changes[0].Before.RawScore, 85); assert.equal(changes[0].After.RawScore, 90);
  assert.equal(changes[0].AuthorisedBy, 'principal');
  assert.throws(() => academicManualScoreCorrection(scheme, null, next, unlock), { code: 'ACADEMIC_SCORE_SOURCE_FORBIDDEN' });
  assert.deepEqual(academicManualScoreCorrection(scheme, previous, previous.ComponentScores), []);
  assert.throws(() => normalizeAcademicComponentScores([{ ComponentId: 'ca1', RawScore: 101 }], scheme), /maximum|between|exceed/i);
});

test('split objective CBT corrections retain theory marks and external CBT corrections are audited too', () => {
  const previous = subject(), unlock = { ScoreEditingReactivated: true, ScoreEditingReactivationReason: 'Approved correction' };
  const next = normalizeAcademicComponentScores([{ ComponentId: 'ca2', Parts: [{ PartId: 'objective', RawScore: 45 }] },
    { ComponentId: 'exam', RawScore: 82 }], scheme, { existing: previous.ComponentScores, partial: true });
  const changes = academicManualScoreCorrection(scheme, previous, next, unlock);
  assert.deepEqual(changes.map(row => row.CellId), ['ca2:objective', 'exam']);
  assert.equal(next[1].Parts[1].RawScore, 30);
});

test('parent screen and print rows include weighted marks and escape labels', async () => {
  const source = await readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(await readFile(new URL('../js/academic-result-template.js', import.meta.url), 'utf8'), ctx);
  const record = academicResultWithWeightedComponents(result()); record.Subjects[0].SubjectName = '<Maths>';
  const markup = ctx.DynamaxAcademicResultTemplate.weightedMarkup(record);
  assert.match(markup, /CA1.*Weighted/s);
  assert.match(markup, /8.5 \/ 10/);
  assert.match(markup, /&lt;Maths&gt;/);
  assert.match(source, /DynamaxAcademicResultTemplate\.weightedMarkup\(record\)/);
  assert.match(source, /DynamaxAcademicResultTemplate\.render\(child, record/);
});
