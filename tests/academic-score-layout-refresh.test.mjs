import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { academicAssessmentScheme, migrateAcademicScoreLayout } from '../functions/lib/academic-scorebook.js';

const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const clean = v => String(v ?? '').trim();
const lower = v => clean(v).toLowerCase();
const plain = v => JSON.parse(JSON.stringify(v));
const payload = { SheetId: 'sheet', SessionId: 'session', TermId: 'term', ClassId: 'grade7', ArmId: 'merit', SubjectId: 'math' };
const stale = { scoreSheets: [{ ...payload, AssessmentRevisionId: 'old' }, { SheetId: 'other' }],
  studentScores: [{ SheetId: 'sheet', RawScore: 0 }, { SheetId: 'other', RawScore: 72 }],
  scorebookContext: { ...payload, LayoutUpdateAvailable: true }, assessmentScheme: { RevisionId: 'old' },
  activeAssessmentScheme: { RevisionId: 'new' }, scorebookSnapshot: { SheetId: 'sheet', scores: [] } };
const fresh = { ok: true, partialAcademicManagement: true,
  assessmentScheme: { RevisionId: 'new', Components: [{ Id: 'ca1', ScoreEntryMode: 'objective-theory' }] },
  scorebookContext: { ...payload, LayoutUpdateAvailable: false, ActiveAssessmentRevisionId: '' },
  scorebookSnapshot: { SheetId: 'sheet', sheet: { ...payload, AssessmentRevisionId: 'new', RevisionToken: 'new-revision' },
    scores: [{ SheetId: 'sheet', ComponentScores: [{ ComponentId: 'ca1', Parts: [{ PartId: 'objective', State: 'Numeric', RawScore: 0 }] }], LockedScoreCellIds: ['ca1:objective'] }] } };

function web(responseFor) {
  const calls = [];
  const runtime = vm.createContext({ clean, selectedBranchId: 'main', currentUser: {},
    academicManagementView: 'scorebook', academicManagementFilters: { section: 'secondary', sessionId: 'session', termId: 'term' },
    academicManagementData: structuredClone(stale),
    staffFetch: async (_url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      return responseFor(body, calls.length);
    } });
  const start = admin.indexOf('async function academicManagementRequest(');
  vm.runInContext(admin.slice(start, admin.indexOf('\nasync function showAcademicCalculationFailure', start)), runtime);
  return { runtime, calls };
}
const response = data => ({ status: 200, json: async () => structuredClone(data) });

test('applying a layout reads back the selected sheet, replaces stale columns/marks and removes the old warning', async () => {
  for (const action of ['applyActiveAcademicScoreLayout', 'applyActiveScoreLayout']) {
    const { runtime, calls } = web(body => response(body.action === 'getAcademicScorebookContext'
      ? fresh : { ok: true, refreshAcademicManagement: true, message: 'Layout applied.' }));
    const before = plain(runtime.academicManagementData);
    const result = await runtime.academicManagementRequest(action, payload);
    assert.deepEqual(calls.map(row => row.action), [action, 'getAcademicScorebookContext']);
    assert.equal(result.scorebookContext.LayoutUpdateAvailable, false);
    assert.equal(result.assessmentScheme.Components[0].ScoreEntryMode, 'objective-theory');
    assert.equal(result.scoreSheets.find(row => row.SheetId === 'sheet').RevisionToken, 'new-revision');
    assert.equal(result.studentScores.find(row => row.SheetId === 'sheet').ComponentScores[0].Parts[0].RawScore, 0);
    assert.equal(result.studentScores.find(row => row.SheetId === 'other').RawScore, 72);
    assert.equal(result.message, 'Layout applied.');
    assert.deepEqual(plain(runtime.academicManagementData), before);
  }
});

test('an already-applied retry still refreshes the saved layout rather than reusing the old warning', async () => {
  const { runtime } = web(body => response(body.action === 'getAcademicScorebookContext'
    ? fresh : { ok: true, refreshAcademicManagement: true, message: 'This Draft already uses the active assessment layout.' }));
  const result = await runtime.academicManagementRequest('applyActiveAcademicScoreLayout', payload);
  assert.equal(result.scorebookContext.LayoutUpdateAvailable, false);
  assert.equal(result.scoreSheets.find(row => row.SheetId === 'sheet').AssessmentRevisionId, 'new');
});

test('failed or mismatched readback cannot display a successful layout refresh', async () => {
  for (const result of [{ ok: false, message: 'Temporary read failure' }, { ...fresh, scorebookContext: { SheetId: 'wrong' } }]) {
    const { runtime } = web(body => response(body.action === 'getAcademicScorebookContext'
      ? result : { ok: true, refreshAcademicManagement: true, message: 'Layout applied.' }));
    await assert.rejects(runtime.academicManagementRequest('applyActiveAcademicScoreLayout', payload), /saved columns could not be refreshed/);
  }
});

test('general mutation refresh discards stale sheet context so rendering can load fresh marks once', async () => {
  const { runtime, calls } = web(body => response(body.action === 'bootstrap'
    ? { ok: true, partialAcademicManagement: true, assessmentScheme: { RevisionId: 'branch-default' } }
    : { ok: true, refreshAcademicManagement: true, message: 'Saved.' }));
  const result = await runtime.academicManagementRequest('saveAcademicScoreDraft', payload);
  assert.deepEqual(calls.map(row => row.action), ['saveAcademicScoreDraft', 'bootstrap']);
  for (const key of ['scorebookContext', 'scorebookSnapshot', 'activeAssessmentScheme']) assert.equal(result[key], undefined);
  assert.equal(result.studentScores.length, 2, 'unrelated loaded data is not discarded');
});

function migration({ conflict = false, excessive = false } = {}) {
  const policy = { Assessment: { Components: [{ Id: 'ca1', Name: 'CA1', MaximumScore: 100, WeightPercentage: 100, SourceMode: 'any' }],
    GradeBands: [{ Grade: 'A', MinimumPercentage: 0, MaximumPercentage: 100, GradePoint: 5, Classification: 'pass' }] } };
  const old = academicAssessmentScheme(policy, { RevisionId: 'old' });
  const active = academicAssessmentScheme({ Assessment: { ...policy.Assessment, Components: [
    { ...policy.Assessment.Components[0], ScoreEntryMode: 'objective-theory', ObjectiveMaximumScore: 50, TheoryMaximumScore: 50 }
  ] } }, { RevisionId: 'new' });
  const scores = [
    { SheetId: 'sheet', ScoreId: 'cbt', StudentRef: 'one', SourceType: 'BuiltInCBT', AttemptId: 'keep-attempt', __updateTime: 'cbt-before',
      ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: excessive ? 80 : 40 }] },
    { SheetId: 'sheet', ScoreId: 'manual', StudentRef: 'two', SourceType: 'Manual', __updateTime: 'manual-before',
      ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 0 }] },
    { SheetId: 'other', ScoreId: 'untouched', ComponentScores: [{ RawScore: 72 }] }
  ];
  const existing = { ...payload, Status: 'Draft', TeacherUsername: 'teacher', AssessmentRevisionId: 'old', __updateTime: 'sheet-before' };
  let batches = [];
  const context = { ...payload, existing, scheme: old, snapshotScheme: old, state: { studentScores: scores },
    scope: { branchId: 'main', section: 'secondary' }, session: { SessionId: 'session' }, term: { TermId: 'term' },
    schoolClass: { ClassId: 'grade7' }, arm: { ArmId: 'merit' }, subject: { SubjectId: 'math', Name: 'Mathematics' },
    allocation: { TeacherUsername: 'teacher' }, roster: [{ StudentRef: 'one' }, { StudentRef: 'two' }] };
  const runtime = vm.createContext({ clean, lower, migrateAcademicScoreLayout,
    failure: (message, status, code) => Object.assign(new Error(message), { status, code }),
    academicScoreSheetContext: async () => context, academicAssessmentForPeriod: async () => active,
    nowIso: () => '2026-10-26T01:00:00Z', actorName: () => 'Officer', actorUsername: () => 'officer',
    academicRecordedScoreComponentIds: () => ['ca1'], academicRecordedScoreCellIds: rows => rows.flatMap(row => row.Parts
      .filter(part => part.State === 'Numeric').map(part => `${row.ComponentId}:${part.PartId}`)),
    academicScoreMembershipGuards: () => [],
    withoutMetadata: row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('__'))),
    writePrecondition: (row, revision) => ({ updateTime: revision || row.__updateTime }),
    auditWrite: (_user, action) => ({ collectionPath: 'audit', documentId: 'event', data: { action } }),
    ACADEMIC_MANAGEMENT_COLLECTIONS: { studentScores: 'scores', scoreSheets: 'sheets' },
    commitAcademicBatch: async (_env, writes) => {
      if (conflict) throw new Error('The score sheet changed; nothing was saved.');
      batches.push(plain(writes));
    }
  });
  for (const name of ['academicScoreSheetRecord', 'academicScoreSheetCounts', 'applyActiveAcademicScoreLayout']) {
    const match = server.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([\\s\\S]*?\\n}`));
    assert.ok(match, name); vm.runInContext(match[0].replace('export ', ''), runtime);
  }
  return { runtime, scores, batches };
}

test('layout action commits sheet and migrated marks together, preserving zero, CBT evidence and locked cells', async () => {
  const { runtime, scores, batches } = migration();
  const before = structuredClone(scores);
  const result = await runtime.applyActiveAcademicScoreLayout({}, {}, { ...payload, RevisionToken: 'sheet-before' });
  assert.equal(result.ok, true); assert.equal(batches.length, 1);
  const marks = batches[0].filter(write => write.collectionPath === 'scores');
  assert.equal(marks.length, 2);
  assert.equal(marks[0].data.AttemptId, 'keep-attempt');
  assert.equal(marks[0].data.ComponentScores[0].Parts[0].RawScore, 40);
  assert.deepEqual(marks[0].data.LockedScoreCellIds, ['ca1:objective']);
  assert.equal(marks[1].data.ComponentScores[0].Parts[1].RawScore, 0);
  assert.deepEqual(marks[1].data.LockedScoreCellIds, ['ca1:theory']);
  assert.equal(batches[0].find(write => write.collectionPath === 'sheets').data.AssessmentRevisionId, 'new');
  assert.equal(batches[0].find(write => write.collectionPath === 'sheets').updateTime, 'sheet-before');
  assert.deepEqual(scores, before);
});

test('unsafe layout changes and concurrent edits cannot report success or partially overwrite marks', async () => {
  for (const options of [{ excessive: true }, { conflict: true }]) {
    const { runtime, scores, batches } = migration(options);
    const before = structuredClone(scores);
    await assert.rejects(runtime.applyActiveAcademicScoreLayout({}, {}, payload));
    assert.equal(batches.length, 0); assert.deepEqual(scores, before);
  }
});
