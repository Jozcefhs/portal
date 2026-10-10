import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeAcademicGenerationRules, buildAcademicGenerationProblem,
  advanceAcademicTimetableGeneration, validateAcademicGeneratedEntries
} from '../functions/lib/academic-timetable-generator.js';
import { normalizeAcademicTimetableDays, normalizeAcademicTimetablePeriods } from '../functions/lib/academic-timetable-attendance.js';
import { academicGenerationSnapshot, academicManagementCapabilities, academicTimetableBatchPlan, academicTimetableTargetCopyPlan } from '../functions/lib/academic-management.js';
import { timetableHarness } from './helpers/timetable-generator-harness.mjs';

function fixture(overrides = {}) {
  const Days = normalizeAcademicTimetableDays('MON | Monday\nTUE | Tuesday\nWED | Wednesday\nTHU | Thursday\nFRI | Friday');
  const Periods = normalizeAcademicTimetablePeriods([
    { PeriodCode: 'P1', Name: 'One', StartTime: '08:00', EndTime: '08:40', Kind: 'Lesson' },
    { PeriodCode: 'P2', Name: 'Two', StartTime: '08:40', EndTime: '09:20', Kind: 'Lesson' },
    { PeriodCode: 'BRK', Name: 'Break', StartTime: '09:20', EndTime: '09:40', Kind: 'Break' },
    { PeriodCode: 'P3', Name: 'Three', StartTime: '09:40', EndTime: '10:20', Kind: 'Lesson' },
    { PeriodCode: 'P4', Name: 'Four', StartTime: '10:20', EndTime: '11:00', Kind: 'Lesson' }
  ], Days);
  const requirement = (ArmId, SubjectId, changes = {}) => ({ ClassId: 'class', ArmId, SubjectId, PeriodsPerWeek: 5,
    DoubleLessonsPerWeek: 0, MaxPeriodsPerDay: 1, LatestLessonNumber: 0, ...changes });
  const version = { VersionId: 'source', Name: 'Source', SessionId: 'session', TermId: 'term', Status: 'Draft', Days, Periods,
    GenerationRules: { Requirements: [requirement('a', 'math', { LatestLessonNumber: 2 }), requirement('a', 'english'), requirement('b', 'math', { LatestLessonNumber: 2 }), requirement('b', 'english')], MaxConsecutiveTeacherPeriods: 2 }, ...overrides };
  const state = { classes: [{ ClassId: 'class', Name: 'Grade 7', Status: 'Active' }],
    arms: ['a', 'b'].map((ArmId) => ({ ClassId: 'class', ArmId, Name: ArmId, Status: 'Active' })),
    subjects: ['math', 'english'].map((SubjectId) => ({ SubjectId, Name: SubjectId, Status: 'Active' })),
    teacherAllocations: ['math', 'english'].map((SubjectId) => ({ ClassId: 'class', SubjectId, ArmId: '',
      TeacherUsername: SubjectId, AllocationRole: 'Subject Teacher', Status: 'Active', SessionId: 'session', TermId: 'term' })),
    timetableConstraints: [], timetableVersions: [version], timetableEntries: [] };
  return { version, state, requirement };
}
function solve(problem, budget = 30) {
  let result, checkpoint = null;
  for (let step = 0; step < 5000; step++) {
    result = advanceAcademicTimetableGeneration(problem, checkpoint, budget);
    if (result.Done) return result;
    checkpoint = JSON.parse(JSON.stringify(result.Checkpoint));
  }
  throw new Error('Search did not terminate');
}

test('fills both arms exactly, spreads subjects and avoids shared teacher clashes', () => {
  const { version, state } = fixture();
  const problem = buildAcademicGenerationProblem(state, version);
  const result = solve(problem, 7);
  assert.equal(result.Complete, true);
  assert.equal(result.ScheduledPeriods, 20);
  assert.equal(result.Unscheduled.length, 0);
  assert.equal(result.Checkpoint, null);
  const seen = new Set();
  for (const entry of result.Entries) {
    for (const period of entry.PeriodCodes) {
      const key = `${entry.TeacherUsername}/${entry.DayCode}/${period}`;
      assert.equal(seen.has(key), false); seen.add(key);
      if (entry.SubjectId === 'math') assert.ok(['P1', 'P2'].includes(period));
    }
  }
  validateAcademicGeneratedEntries(problem, result.Entries, true);
  assert.equal(state.timetableEntries.length, 0);
});

test('checkpoints reproduce the same deterministic schedule as a single larger step', () => {
  const { version, state } = fixture();
  const problem = buildAcademicGenerationProblem(state, version);
  assert.deepEqual(solve(problem, 2).Entries, solve(problem, 2400).Entries);
});

test('double lessons finish before cutoff and cannot cross a break', () => {
  const { version, state, requirement } = fixture();
  version.GenerationRules = { Requirements: [requirement('a', 'math', { PeriodsPerWeek: 6, DoubleLessonsPerWeek: 3, LatestLessonNumber: 2, MaxPeriodsPerDay: 2 })] };
  const result = solve(buildAcademicGenerationProblem(state, version));
  assert.equal(result.Complete, true);
  assert.equal(result.Entries.length, 3);
  result.Entries.forEach((entry) => assert.deepEqual(entry.PeriodCodes, ['P1', 'P2']));
  version.GenerationRules.Requirements[0].LatestLessonNumber = 1;
  const impossible = solve(buildAcademicGenerationProblem(state, version));
  assert.equal(impossible.Complete, false);
  assert.match(impossible.Issues.join(' '), /no available double|cannot fit/);
});

test('teacher availability, daily and weekly limits are enforced', () => {
  const { version, state, requirement } = fixture();
  version.GenerationRules = { Requirements: [requirement('a', 'math', { PeriodsPerWeek: 2, LatestLessonNumber: 2 })] };
  state.timetableConstraints = [{ TeacherUsername: 'math', UnavailableSlots: ['MON:P1', 'MON:P2'], MaxPeriodsPerDay: 1, MaxPeriodsPerWeek: 2, Status: 'Active' }];
  const problem = buildAcademicGenerationProblem(state, version), result = solve(problem);
  assert.equal(result.Complete, true);
  assert.equal(result.Entries.some((entry) => entry.DayCode === 'MON'), false);
  version.GenerationRules.Requirements[0].PeriodsPerWeek = 3;
  assert.equal(solve(buildAcademicGenerationProblem(state, version)).Complete, false);
});

test('locked lessons survive regeneration and count towards weekly requirements', () => {
  const { version, state } = fixture();
  state.timetableEntries.push({ VersionId: 'source', EntryId: 'fixed', ClassId: 'class', ArmId: 'a', SubjectId: 'math',
    TeacherUsername: 'math', DayCode: 'FRI', StartPeriodCode: 'P2', DurationPeriods: 1, GeneratorLocked: true });
  const problem = buildAcademicGenerationProblem(state, version), result = solve(problem);
  assert.equal(result.Complete, true);
  assert.equal(result.Entries[0].GeneratorLocked, true);
  assert.equal(result.Entries[0].DayCode, 'FRI');
  assert.equal(result.Entries[0].StartPeriodCode, 'P2');
  assert.throws(() => validateAcademicGeneratedEntries(problem, result.Entries.slice(1), true), /incomplete|locked/);
});

test('room conflicts and day restrictions are hard constraints', () => {
  const { version, state, requirement } = fixture();
  version.GenerationRules = { Requirements: [requirement('a', 'math', { PeriodsPerWeek: 1, AllowedDayCodes: ['MON'], Room: 'Lab' }),
    requirement('b', 'english', { PeriodsPerWeek: 1, AllowedDayCodes: ['MON'], Room: 'Lab' })] };
  const result = solve(buildAcademicGenerationProblem(state, version));
  assert.equal(result.Complete, true);
  assert.ok(result.Entries.every((entry) => entry.DayCode === 'MON'));
  assert.notEqual(result.Entries[0].StartPeriodCode, result.Entries[1].StartPeriodCode);
});

test('consecutive teacher limits count adjacent lessons but reset at breaks', () => {
  const { version, state, requirement } = fixture();
  version.GenerationRules = { Requirements: [requirement('a', 'math', { PeriodsPerWeek: 2, MaxPeriodsPerDay: 2, AllowedDayCodes: ['MON'] })], MaxConsecutiveTeacherPeriods: 1 };
  const result = solve(buildAcademicGenerationProblem(state, version));
  assert.equal(result.Complete, true);
  assert.deepEqual(result.Entries.map((entry) => entry.StartPeriodCode), ['P1', 'P3']);
});

test('bad rules and missing allocations are rejected without modifying records', () => {
  const { version, state } = fixture();
  assert.throws(() => normalizeAcademicGenerationRules({ Requirements: [{ ...version.GenerationRules.Requirements[0], PeriodsPerWeek: -1 }] }, version), /whole number/);
  assert.throws(() => normalizeAcademicGenerationRules({ Requirements: [version.GenerationRules.Requirements[0], version.GenerationRules.Requirements[0]] }, version), /only once/);
  state.teacherAllocations = [];
  assert.throws(() => buildAcademicGenerationProblem(state, version), /Allocate a subject teacher/);
  assert.throws(() => normalizeAcademicGenerationRules({ Requirements: [{ ...version.GenerationRules.Requirements[0], AllowedDayCodes: ['SUN'] }] }, version), /configured school days/);
});

test('overfilled weeks report the reason and never provide a saveable result', () => {
  const { version, state } = fixture();
  version.GenerationRules.Requirements.forEach((row) => { row.PeriodsPerWeek = 15; row.MaxPeriodsPerDay = 0; });
  const result = solve(buildAcademicGenerationProblem(state, version));
  assert.equal(result.Done, true); assert.equal(result.Complete, false);
  assert.match(result.Issues.join(' '), /exceed|cannot fit/);
});

test('malformed or poisoned checkpoints and client previews cannot bypass validation', () => {
  const { version, state } = fixture();
  const problem = buildAcademicGenerationProblem(state, version);
  assert.throws(() => advanceAcademicTimetableGeneration(problem, { Frames: [{}], Best: [], Checks: 0 }), /checkpoint|Search position|Invalid/);
  const result = solve(problem);
  const entries = structuredClone(result.Entries);
  entries[0].TeacherUsername = 'unallocated';
  assert.throws(() => validateAcademicGeneratedEntries(problem, entries, true), /not allocated/);
  const collision = structuredClone(result.Entries);
  collision[1] = { ...collision[0] };
  assert.throws(() => validateAcademicGeneratedEntries(problem, collision, true), /conflict/);
});

test('manual batch edits on generated versions enforce cutoffs and quotas too', () => {
  const { version, state } = fixture();
  const input = { VersionId: 'source', Entries: [{ ClassId: 'class', ArmId: 'a', SubjectId: 'math', TeacherUsername: 'math',
    DayCode: 'MON', StartPeriodCode: 'P4', DurationPeriods: 1 }] };
  assert.throws(() => academicTimetableBatchPlan(state, input, { session: { SessionId: 'session' }, term: { TermId: 'term' }, scope: { branchId: 'main', section: 'secondary' } }), /after permitted period/);
});

test('source snapshots detect data changes but ignore other generated versions', () => {
  const { version, state } = fixture();
  const original = academicGenerationSnapshot(state, version);
  state.timetableVersions.push({ VersionId: 'target', Status: 'Generating' });
  assert.deepEqual(academicGenerationSnapshot(state, version), original);
  state.teacherAllocations[0].TeacherUsername = 'replacement';
  assert.notDeepEqual(academicGenerationSnapshot(state, version), original);
});

test('backend and desktop routes share the generator and are restricted to timetable managers', async () => {
  const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  for (const action of ['saveAcademicTimetableGenerationRules', 'previewAcademicTimetableGeneration', 'saveAcademicTimetableGeneration']) {
    assert.ok(backend.includes(`case '${action}':`));
    const part = source.slice(source.indexOf(`export async function ${action}(`));
    assert.match(part.slice(0, 350), /canManageTimetables/);
  }
  assert.match(source, /delete copy.GenerationPlan/);
  assert.equal(academicManagementCapabilities({ role: 'Teacher', edition: 'school' }).canManageTimetables, false);
  assert.match(source, /offset \+ 60/);
});

test('real generation actions preserve published versions and reject stale or incomplete previews', async () => {
  const { state, version } = fixture();
  version.__updateTime = 'source-revision';
  state.timetableVersions.push({ ...version, VersionId: 'live', Status: 'Published' });
  const harness = timetableHarness(state);
  const response = await harness.run('previewAcademicTimetableGeneration');
  assert.equal(response.generation.Complete, true);
  assert.equal(harness.commits.length, 0);
  await assert.rejects(harness.run('saveAcademicTimetableGeneration', {
    Name: 'Incomplete', SaveRequestId: 'unique-save-request-1', SourceSignature: response.generation.SourceSignature,
    Entries: response.generation.Entries.slice(1)
  }), /incomplete/);
  assert.equal(harness.commits.length, 0);
  harness.state.teacherAllocations[0].TeacherUsername = 'replacement';
  await assert.rejects(harness.run('saveAcademicTimetableGeneration', {
    Name: 'Stale', SaveRequestId: 'unique-save-request-1', SourceSignature: response.generation.SourceSignature,
    Entries: response.generation.Entries
  }), /changed/);
  await assert.rejects(harness.run('previewAcademicTimetableGeneration', {}, { role: 'Teacher', edition: 'school' }), /Permission/);
  await assert.rejects(harness.run('previewAcademicTimetableGeneration', { BranchId: 'other' }), /Scope/);
  assert.equal(harness.state.timetableVersions.find((row) => row.VersionId === 'live').Status, 'Published');
});

test('atomic staged saving resumes interruptions without duplicates and finalizes only as Draft', async () => {
  const { state, version, requirement } = fixture();
  version.Periods = normalizeAcademicTimetablePeriods(Array.from({ length: 16 }, (_unused, index) => ({
    PeriodCode: `P${index + 1}`, Name: `Period ${index + 1}`, Kind: 'Lesson',
    StartTime: `${String(8 + Math.floor(index / 3)).padStart(2, '0')}:${String(index % 3 * 20).padStart(2, '0')}`,
    EndTime: `${String(8 + Math.floor((index + 1) / 3)).padStart(2, '0')}:${String((index + 1) % 3 * 20).padStart(2, '0')}`
  })), version.Days);
  version.GenerationRules = { Requirements: [requirement('a', 'math', { PeriodsPerWeek: 35, MaxPeriodsPerDay: 0 }), requirement('a', 'english', { PeriodsPerWeek: 35, MaxPeriodsPerDay: 0 })] };
  const harness = timetableHarness(state);
  let response = await harness.run('previewAcademicTimetableGeneration');
  for (let step = 0; !response.generation.Done && step < 120; step++) response = await harness.run('previewAcademicTimetableGeneration', { Checkpoint: response.generation.Checkpoint, SourceSignature: response.generation.SourceSignature });
  assert.equal(response.generation.Complete, true);
  const payload = { Name: 'Generated draft', SaveRequestId: 'unique-save-request-2', Entries: response.generation.Entries, SourceSignature: response.generation.SourceSignature };
  const first = await harness.run('saveAcademicTimetableGeneration', payload);
  assert.equal(first.generationSave.Complete, false);
  assert.equal(first.generationSave.Written, 60);
  const target = harness.state.timetableVersions.find((row) => row.VersionId === first.generationSave.VersionId);
  assert.equal(target.Status, 'Generating');
  assert.ok(target.GenerationPlan);
  harness.interruptNextCommit();
  await assert.rejects(harness.run('saveAcademicTimetableGeneration', { TargetVersionId: target.VersionId }), /interruption/);
  assert.equal(harness.state.timetableEntries.length, 60);
  const completed = await harness.run('saveAcademicTimetableGeneration', { TargetVersionId: target.VersionId });
  assert.equal(completed.generationSave.Complete, true);
  assert.equal(harness.state.timetableEntries.length, 70);
  assert.equal(new Set(harness.state.timetableEntries.map((entry) => entry.EntryId)).size, 70);
  assert.equal(harness.state.timetableVersions.find((row) => row.VersionId === target.VersionId).Status, 'Draft');
  assert.equal(completed.timetableVersions.find((row) => row.VersionId === target.VersionId).GenerationPlan, undefined);
  const count = harness.commits.length;
  await harness.run('saveAcademicTimetableGeneration', payload);
  await harness.run('saveAcademicTimetableGeneration', { TargetVersionId: target.VersionId });
  assert.equal(harness.commits.length, count);
});

test('requirements edits require Draft status and a current revision', async () => {
  const { state, version } = fixture();
  version.__updateTime = 'current';
  const harness = timetableHarness(state);
  await assert.rejects(harness.run('saveAcademicTimetableGenerationRules', { ...version.GenerationRules, RevisionToken: 'old' }), /Revision/);
  const result = await harness.run('saveAcademicTimetableGenerationRules', { ...version.GenerationRules, RevisionToken: 'current' });
  assert.ok(result.timetableVersions[0].GenerationRules);
  harness.state.timetableVersions[0].Status = 'Published';
  await assert.rejects(harness.run('saveAcademicTimetableGenerationRules', { ...version.GenerationRules }), /only on a Draft/);
});

test('a full-size sample week schedules twenty arms without conflicts or quota omissions', () => {
  const { state, version } = fixture();
  version.Periods = normalizeAcademicTimetablePeriods(Array.from({ length: 8 }, (_unused, index) => ({ PeriodCode: `P${index + 1}`, Name: `Period ${index + 1}`, Kind: 'Lesson',
    StartTime: `${String(8 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
    EndTime: `${String(8 + Math.floor((index + 1) / 2)).padStart(2, '0')}:${(index + 1) % 2 ? '30' : '00'}` })), version.Days);
  state.arms = Array.from({ length: 20 }, (_unused, index) => ({ ArmId: `arm-${index}`, ClassId: 'class' }));
  state.subjects = Array.from({ length: 10 }, (_unused, index) => ({ SubjectId: `subject-${index}` }));
  state.teacherAllocations = [];
  const requirements = [];
  for (let arm = 0; arm < 20; arm++) for (let subject = 0; subject < 10; subject++) {
    const row = { ClassId: 'class', ArmId: `arm-${arm}`, SubjectId: `subject-${subject}`, PeriodsPerWeek: 4, MaxPeriodsPerDay: 1 };
    requirements.push(row);
    state.teacherAllocations.push({ ...row, TeacherUsername: `teacher-${subject}-${Math.floor(arm / 5)}`, AllocationRole: 'Subject Teacher' });
  }
  version.GenerationRules = { Requirements: requirements };
  const problem = buildAcademicGenerationProblem(state, version);
  const result = solve(problem, 1200);
  assert.equal(result.Complete, true, result.Message);
  assert.equal(result.ScheduledPeriods, 800);
  validateAcademicGeneratedEntries(problem, result.Entries, true);
});

test('malformed requirement records produce a clear validation error', () => {
  const { version } = fixture();
  for (const invalid of [null, 'not-a-record', []]) {
    assert.throws(() => normalizeAcademicGenerationRules({ Requirements: [invalid] }, version), /classroom-subject record/);
  }
});

test('unfinished generated versions cannot be used as classroom-copy sources', () => {
  const { state, version } = fixture();
  state.timetableVersions.push({ ...version, VersionId: 'target' });
  for (const status of ['Generating', 'Deleting', 'Copying']) {
    version.Status = status;
    assert.throws(() => academicTimetableTargetCopyPlan(state, { SourceVersionId: 'source', TargetVersionId: 'target' }), /available source/);
  }
});

test('primary branches use the same actions while preserving scope and edition boundaries', async () => {
  const { state } = fixture();
  const harness = timetableHarness(state, { branchId: 'primary-campus', section: 'primary' });
  const result = await harness.run('previewAcademicTimetableGeneration');
  assert.equal(result.generation.Complete, true);
  const saved = await harness.run('saveAcademicTimetableGeneration', {
    Name: 'Primary generated draft', SaveRequestId: 'primary-save-request-0001',
    SourceSignature: result.generation.SourceSignature, Entries: result.generation.Entries
  });
  const target = harness.state.timetableVersions.find((row) => row.VersionId === saved.generationSave.VersionId);
  assert.equal(target.BranchId, 'primary-campus');
  assert.equal(target.SchoolSection, 'primary');
  assert.ok(harness.state.timetableEntries.every((entry) => entry.BranchId === 'primary-campus' && entry.SchoolSection === 'primary'));
  await assert.rejects(harness.run('previewAcademicTimetableGeneration', { SchoolSection: 'secondary' }), /Scope/);
  await assert.rejects(harness.run('previewAcademicTimetableGeneration', {}, { role: 'Super Admin', edition: 'faith' }), /Permission/);
  await assert.rejects(harness.run('previewAcademicTimetableGeneration', {}, { role: 'Super Admin', edition: 'organization' }), /Permission/);
});

test('timetable web assets have new version identifiers for existing browser installations', async () => {
  const [html, serviceWorker] = await Promise.all([
    readFile(new URL('../admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../sw.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /css\/style\.css\?v=[^"]*timetable-generator-20261009/);
  assert.match(html, /js\/admin\.js\?v=[^"]*timetable-generator-20261009/);
  assert.match(serviceWorker, /const CACHE = 'dynamax-v360-transfer-rejections-batch-items-vendor-statement-figures'/);
});
