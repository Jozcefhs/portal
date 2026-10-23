import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { ACADEMIC_MANAGEMENT_COLLECTIONS as collections } from '../functions/lib/academic-management.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const firestore = await readFile(new URL('../functions/lib/firestore.js', import.meta.url), 'utf8');
const paging = firestore.slice(firestore.indexOf('export async function queryCollectionPages'),
  firestore.indexOf('export async function findOneByField')).replace('export ', '');

function fixture(records, failPage = 0) {
  const calls = [];
  let scorePages = 0;
  const queryCollection = async (_env, collection, options) => {
    calls.push({ collection, ...structuredClone(options) });
    if (collection === collections.studentScores && ++scorePages === failPage) throw new Error('Interrupted database read');
    const field = options.filters[0];
    const rows = (records[collection] || []).filter(row => row[field.field] === field.value)
      .filter(row => !options.startAfterName || row.__name > options.startAfterName);
    return structuredClone(rows.slice(0, options.limit || rows.length));
  };
  const queryCollectionPages = vm.runInNewContext(`(${paging})`, { queryCollection });
  const context = vm.createContext({ queryCollection, queryCollectionPages, console, crypto, TextEncoder });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  return { calls, load: (keys, scope = {}) => context.loadScopedAcademicState({},
    {branchId:'main',section:'secondary'}, keys, scope) };
}

test('large score reads include the last page, every arm and saved zero marks', async () => {
  const records = Array.from({length:1003}, (_,i) => ({__name:`scores/${String(i).padStart(5,'0')}`,
    BranchId:'main', SchoolSection:'secondary', ClassId:'grade12', SubjectId:'chemistry', SessionId:'s', TermId:'t',
    ArmId:i%2 ? 'merit' : '', StudentRef:`student-${i}`, ComponentScores:[{ComponentId:'ca1',State:'Numeric',RawScore:i%101}],
    __updateTime:`revision-${i}`, CbtScoreSources:[{CellId:'ca1',AttemptId:`attempt-${i}`}]}));
  const f = fixture({[collections.studentScores]:records});
  const result = await f.load(['studentMemberships','studentScores'], {ClassId:'grade12',SubjectId:'chemistry',SessionId:'s',TermId:'t'});
  assert.equal(result.studentScores.length,1003);
  assert.equal(result.studentScores.at(-1).StudentRef,'student-1002');
  assert.equal(result.studentScores[0].ComponentScores[0].RawScore,0);
  assert.equal(result.studentScores[0].__updateTime,'revision-0');
  assert.equal(result.studentScores[0].CbtScoreSources[0].AttemptId,'attempt-0');
  const pages = f.calls.filter(call => call.collection === collections.studentScores);
  assert.equal(pages.length,5);
  assert.ok(pages.every(call => call.limit===250 && call.filters[0].field==='ClassId'));
  assert.equal(new Set(pages.map(call=>call.readTime)).size,1);
  assert.equal(f.calls[0].collection,collections.studentMemberships);
});

test('focused scores enforce branch, section, period and subject but not arm', async () => {
  const base = {BranchId:'main',SchoolSection:'secondary',ClassId:'grade12',SubjectId:'chemistry',SessionId:'s',TermId:'t'};
  const records = [{ArmId:'merit'},{ArmId:''},{BranchId:'other'},{SchoolSection:'primary'},
    {SubjectId:'maths'},{SessionId:'old'},{TermId:'old'},{ClassId:'grade11'}]
    .map((patch,i)=>({...base,...patch,__name:`scores/${i}`}));
  const f = fixture({[collections.studentScores]:records});
  const result = await f.load(['studentScores'],base);
  assert.deepEqual(Array.from(result.studentScores,row=>row.ArmId),['merit','']);
});

test('unfocused bootstrap still pages all scores instead of silently truncating the branch', async () => {
  const records = Array.from({length:501}, (_,i)=>({BranchId:'main',SchoolSection:'secondary',__name:`scores/${String(i).padStart(5,'0')}`}));
  const f = fixture({[collections.studentScores]:records});
  assert.equal((await f.load(['studentScores'])).studentScores.length,501);
  assert.equal(f.calls.length,3);
  assert.ok(f.calls.every(call=>call.filters[0].field==='BranchId'));
});

test('failure after a successful score page aborts the context, never returns a partial scorebook', async () => {
  const records = Array.from({length:501}, (_,i)=>({BranchId:'main',SchoolSection:'secondary',__name:`scores/${String(i).padStart(5,'0')}`}));
  const f = fixture({[collections.studentScores]:records},2);
  await assert.rejects(f.load(['studentScores']),/Interrupted database read/);
});

test('register and score upload contexts explicitly request class/period reads, keeping cross-arm history', () => {
  const register = source.slice(source.indexOf('export async function getAcademicClassScoreRegister'),source.indexOf('export async function getAcademicScorebookContext'));
  assert.match(register,/ClassId: input.ClassId, SessionId: input.SessionId, TermId: input.TermId/);
  const sheet = source.slice(source.indexOf('async function academicScoreSheetContext'),source.indexOf('export async function getAcademicClassScoreRegister'));
  assert.match(sheet,/scoreReadScope: \{ ClassId: input.ClassId, SubjectId: input.SubjectId,/);
  assert.doesNotMatch(sheet,/scoreReadScope: \{[^}]*ArmId/);
});
