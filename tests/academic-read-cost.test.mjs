import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  academicBootstrapReadKeys, academicScoreReadFilters,
  ACADEMIC_MANAGEMENT_COLLECTIONS, ACADEMIC_SCOREBOOK_STATE_KEYS
} from '../functions/lib/academic-management.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const clean = value => String(value ?? '').trim();
const scope = { ClassId: 'grade-12', SubjectId: 'chemistry', SessionId: '2026', TermId: 'first' };

test('web opening is lazy, while class reports and older desktop clients retain complete scores', () => {
  const lazy = academicBootstrapReadKeys(ACADEMIC_SCOREBOOK_STATE_KEYS, 'scorebook', { ScoreRowsMode: 'on-demand' });
  assert.ok(!lazy.includes('studentScores'));
  assert.ok(lazy.includes('scoreSheets'));
  assert.deepEqual(academicBootstrapReadKeys(ACADEMIC_SCOREBOOK_STATE_KEYS, 'scorebook'), ACADEMIC_SCOREBOOK_STATE_KEYS);
  const report = academicBootstrapReadKeys(ACADEMIC_SCOREBOOK_STATE_KEYS, 'scorebook', { ScoreRowsMode: 'on-demand' }, { classRegister: true });
  assert.ok(report.includes('studentScores'));
  assert.ok(!report.includes('scoreImports'));
  assert.ok(!report.includes('scoreSyncBatches'));
});

test('score query scope includes the subject and period but never an arm', () => {
  assert.deepEqual(academicScoreReadFilters('main', { ...scope, ArmId: 'merit' }),
    Object.entries(scope).map(([field, value]) => ({ field, op: '==', value })));
  assert.deepEqual(academicScoreReadFilters('main'), [{ field: 'BranchId', op: '==', value: 'main' }]);
});

test('the actual loader reads 150 relevant marks rather than 3,000 grade marks, retaining previous-arm evidence', async () => {
  const scores = Array.from({ length: 20 }, (_, subject) => Array.from({ length: 150 }, (_, student) => ({
    ...scope, BranchId: 'main', SubjectId: subject ? `subject-${subject}` : 'chemistry',
    ArmId: student % 2 ? 'previous-arm' : 'merit', StudentRef: `student-${student}`,
    ComponentScores: [{ ComponentId: 'CA1', State: 'Numeric', RawScore: student % 101 }]
  }))).flat();
  scores.push({ ...scores[0], BranchId: 'other' }, { ...scores[1], TermId: 'previous' });
  const original = structuredClone(scores);
  const members = [{ ...scope, SubjectId: undefined, SubjectIds: ['chemistry'], BranchId: 'main', StudentRef: 'student-0' }];
  const calls = [];
  const query = async (_env, collection, options) => {
    const data = collection === 'academicStudentScores' ? scores : collection === 'academicStudentMemberships' ? members : [];
    const result = data.filter(row => options.filters.every(f => row[f.field] === f.value));
    calls.push({ collection, rows: result.length, filters: options.filters });
    return structuredClone(result);
  };
  const context = vm.createContext({ ACADEMIC_MANAGEMENT_COLLECTIONS, academicScoreReadFilters,
    clean, lower: v => clean(v).toLowerCase(), nowIso: () => '2026-10-24T12:00:00Z',
    queryCollection: query, queryCollectionPages: query, failure: message => new Error(message) });
  vm.runInContext(source.match(/async function loadAcademicState[\s\S]*?\n}/)[0], context);
  const result = await context.loadAcademicState({}, 'main', ['studentMemberships', 'studentScores'], scope);
  assert.equal(result.studentScores.length, 150);
  assert.ok(result.studentScores.some(row => row.ArmId === 'previous-arm'));
  assert.ok(result.studentScores.some(row => row.ComponentScores[0].RawScore === 0));
  assert.equal(result.studentMemberships.length, 1, 'membership SubjectIds arrays must not be filtered as a scalar SubjectId');
  assert.equal(calls[0].collection, 'academicStudentMemberships', 'membership revisions are read before score evidence');
  assert.equal(calls.find(c => c.collection === 'academicStudentScores').rows, 151, 'another branch is excluded after reading legacy-compatible scope');
  assert.deepEqual(scores, original, 'read optimization must not alter any marks');
});

test('web requests opt into lazy marks and preserve the returned saved-score snapshot', async () => {
  const calls = [];
  const saved = { ok: true, scorebookSnapshot: { SheetId: 'sheet', scores: [{ RawScore: 0 }] } };
  const context = vm.createContext({ clean, selectedBranchId: 'main', currentUser: {}, academicManagementView: 'scorebook',
    academicManagementData: null, mergeAcademicScorebookSnapshot: value => value,
    staffFetch: async (_url, options) => { calls.push(JSON.parse(options.body)); return { status: 200, json: async () => saved }; } });
  const start = admin.indexOf('async function academicManagementRequest(');
  vm.runInContext(admin.slice(start, admin.indexOf('\nfunction mergeAcademicScorebookSnapshot', start)), context);
  const result = await context.academicManagementRequest('bootstrap', { SessionId: '2026', TermId: 'first' });
  assert.equal(calls[0].ScoreRowsMode, 'on-demand');
  assert.equal(result.scorebookSnapshot.scores[0].RawScore, 0);
});
