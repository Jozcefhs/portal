import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extractFunction } from './helpers/academic-register-fixture.mjs';

const context = vm.createContext({
  clean: value => String(value ?? '').trim(),
  escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
});
vm.runInContext(['academicClassRegisterView', 'academicClassRegisterTable', 'academicClassRegisterPrintHtml'].map(extractFunction).join('\n'), context);

export function registerFixture() {
  const Columns = Array.from({ length: 7 }, (_, i) => ['CA1', 'Exam'].map(TestId => ({
    Id: `subject-${i}-${TestId}`, SubjectId: `subject-${i}`, SubjectName: `Subject ${i}`, TestId, TestName: TestId
  }))).flat();
  return { ClassId: 'class', ClassName: 'Grade 8', SessionId: 'session', TermId: 'term', StudentCount: 65, SubjectCount: 7, Columns,
    Rows: Array.from({ length: 65 }, (_, i) => ({ StudentName: `Learner ${i}`, StudentRef: `TEST/${String(i).padStart(3, '0')}`, ArmName: 'Excellence',
      Cells: Columns.map(column => ({ ColumnId: column.Id, State: 'Numeric', RawScore: i, MaximumScore: 100, SheetStatus: 'Draft' })) })) };
}

test('multiple subject and test filters preserve students, marks and source data', () => {
  const register = registerFixture(), before = structuredClone(register);
  const view = context.academicClassRegisterView(register, { subjectIds: ['subject-1', 'subject-3'], testId: 'CA1' });
  assert.equal(view.columns.length, 2);
  assert.equal(view.rows.length, 65);
  assert.equal(context.academicClassRegisterView(register, { subjectIds: [] }).columns.length, 0);
  assert.equal(context.academicClassRegisterView(register, { query: ' test/064 ' }).rows[0].StudentName, 'Learner 64');
  assert.deepEqual(register, before);
});

test('preview includes every matching student and only selected subject/test columns', () => {
  const register = registerFixture();
  const html = context.academicClassRegisterPrintHtml(register, { subjectIds: ['subject-1', 'subject-3'], testId: 'CA1' }, 'School & Academy', '2026/2027 · First Term');
  assert.equal((html.match(/TEST\//g) || []).length, 65);
  assert.match(html, /TEST\/064/);
  assert.match(html, /Subject 1/);
  assert.match(html, /Subject 3/);
  assert.doesNotMatch(html, /Subject 2|Exam/);
  assert.match(html, /School &amp; Academy/);
  assert.match(html, /Not a published result/);
});

test('wide print repeats identities in bounded subject sections and keeps exceptional score states', () => {
  const register = registerFixture();
  register.Rows[0].Cells[0].State = 'Absent';
  register.Rows[0].Cells[1].State = 'Exempt';
  register.Rows[0].Cells[2].State = 'Not enrolled';
  register.Rows[0].Cells[3].State = 'Not recorded';
  const html = context.academicClassRegisterPrintHtml(register, { query: 'TEST/000' }, 'School', 'Term');
  assert.equal((html.match(/<section>/g) || []).length, 3);
  assert.equal((html.match(/<td>TEST\/000<\/td>/g) || []).length, 3);
  for (const text of ['Absent', 'Exempt', 'Not enrolled', 'Not recorded', '0 / 100']) assert.ok(html.includes(text));
  assert.doesNotMatch(html, /TEST\/001/);
  for (const heading of html.matchAll(/<thead>(.*?)<\/thead>/g)) assert.ok((heading[1].match(/<th /g) || []).length <= 9);
});

test('names and labels are escaped in table and preview', () => {
  const register = registerFixture();
  register.Rows[0].StudentName = '<img src=x onerror=alert(1)>';
  register.Columns[0].SubjectName = '<script>alert(1)</script>';
  const html = context.academicClassRegisterPrintHtml(register, {}, '<school>', '<term>');
  assert.doesNotMatch(html, /<img|<script|<school>|<term>/);
  assert.match(html, /&lt;script&gt;/);
});

function scoreFilterFixture() {
  const Columns = [
    { Id: 'math-ca1', SubjectId: 'math', SubjectName: 'Maths', TestId: 'CA1', TestName: 'CA1' },
    { Id: 'english-ca1', SubjectId: 'english', SubjectName: 'English', TestId: 'CA1', TestName: 'CA1' },
    { Id: 'math-theory', SubjectId: 'math', SubjectName: 'Maths', TestId: 'CA2:theory', TestName: 'CA2 Theory' }
  ];
  const cases = [
    ['zero', 'Numeric', 0], ['low', 'Numeric', '49.5'], ['boundary', 'Numeric', 50],
    ['high', 'Numeric', 85], ['missing', 'Not recorded'], ['unfinished', 'Incomplete'],
    ['pending', 'Missing'], ['absent', 'Absent', 0], ['exempt', 'Exempt'],
    ['not-enrolled', 'Not enrolled'], ['duplicate', 'Review duplicate'],
    ['null-mark', 'Numeric', null], ['blank-mark', 'Numeric', ''], ['invalid-mark', 'Numeric', 'bad'],
    ['no-cell'], ['no-state', '']
  ];
  return { ClassName: 'Grade 8', Columns, Rows: cases.map(([StudentRef, State, RawScore]) => ({
    StudentRef, StudentName: `Learner ${StudentRef}`, ArmName: 'Classic', Cells: [
      ...(StudentRef === 'no-cell' ? [] : [{ ColumnId: 'math-ca1', State, RawScore, MaximumScore: 100 }]),
      { ColumnId: 'english-ca1', State: 'Numeric', RawScore: 70, MaximumScore: 100 },
      { ColumnId: 'math-theory', State: 'Not recorded', RawScore: null, MaximumScore: 50 }
    ]
  })) };
}

test('missing-score filter includes only missing selected marks, not zero or resolved exceptional states', () => {
  const register = scoreFilterFixture(), before = structuredClone(register);
  const filters = { testId: 'CA1', subjectIds: ['math'], scoreFilter: 'missing' };
  assert.deepEqual(Array.from(context.academicClassRegisterView(register, filters).rows, row => row.StudentRef),
    ['missing', 'unfinished', 'pending', 'null-mark', 'blank-mark', 'invalid-mark', 'no-cell', 'no-state']);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: ['english'] }).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: ['math', 'english'] }).rows.length, 8);
  assert.equal(context.academicClassRegisterView(register, { ...filters, testId: 'CA2:theory' }).rows.length, register.Rows.length);
  assert.equal(context.academicClassRegisterView(register, { ...filters, query: ' unfinished ' }).rows.length, 1);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: [] }).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, testId: 'unknown' }).rows.length, 0);
  assert.deepEqual(register, before);
});

test('below-score filter uses strict raw numeric comparison, includes zero, and excludes missing or nonnumeric states', () => {
  const register = scoreFilterFixture(), before = structuredClone(register);
  const filters = { testId: 'CA1', subjectIds: ['math'], scoreFilter: 'below', scoreThreshold: '50' };
  assert.deepEqual(Array.from(context.academicClassRegisterView(register, filters).rows, row => row.StudentRef), ['zero', 'low']);
  assert.equal(context.academicClassRegisterView(register, { ...filters, scoreThreshold: '50.1' }).rows.length, 3);
  assert.equal(context.academicClassRegisterView(register, { ...filters, scoreThreshold: '0' }).rows.length, 0);
  for (const scoreThreshold of ['', ' ', null, undefined, '-1', 'invalid', 'Infinity']) {
    assert.equal(context.academicClassRegisterView(register, { ...filters, scoreThreshold }).rows.length, 0);
  }
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: [] }).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, testId: 'CA2:theory' }).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, query: 'LOW' }).rows.length, 1);
  assert.equal(context.academicClassRegisterView(register, { ...filters, scoreFilter: 'all' }).rows.length, register.Rows.length);
  assert.deepEqual(register, before);
});

test('no-scores-at-all requires every applicable selected mark to be missing and preserves saved data', () => {
  const register = scoreFilterFixture();
  const filters = { testId: 'CA1', subjectIds: ['math', 'english'], scoreFilter: 'missing-all' };
  // Everyone has an English mark, including those missing Maths.
  assert.equal(context.academicClassRegisterView(register, filters).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, scoreFilter: 'missing' }).rows.length, 8);
  register.Rows.forEach(row => Object.assign(row.Cells.find(cell => cell.ColumnId === 'english-ca1'), { State: 'Not recorded', RawScore: null }));
  const before = structuredClone(register);
  const refs = Array.from(context.academicClassRegisterView(register, filters).rows, row => row.StudentRef);
  assert.deepEqual(refs, ['missing', 'unfinished', 'pending', 'exempt', 'not-enrolled', 'null-mark', 'blank-mark', 'invalid-mark', 'no-cell', 'no-state']);
  assert.equal(context.academicClassRegisterView(register, { ...filters, query: ' unfinished ' }).rows.length, 1);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: ['math'] }).rows.length, 8);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: ['english'] }).rows.length, register.Rows.length);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: [] }).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, testId: 'unknown' }).rows.length, 0);
  assert.equal(context.academicClassRegisterView(null, filters).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, testId: 'CA2:theory' }).rows.length, register.Rows.length);
  // Existing numeric marks elsewhere in the record do not count for a different selected test.
  assert.equal(context.academicClassRegisterView(register, { ...filters, testId: '' }).rows.length, 10);
  assert.deepEqual(register, before);
});

test('no-scores-at-all excludes wholly exempt/non-enrolled students and print uses the same filter', () => {
  const register = scoreFilterFixture();
  const filters = { testId: 'CA1', subjectIds: ['math', 'english'], scoreFilter: 'missing-all' };
  register.Rows.forEach(row => Object.assign(row.Cells.find(cell => cell.ColumnId === 'english-ca1'), { State: 'Not recorded', RawScore: null }));
  for (const ref of ['exempt', 'not-enrolled']) {
    register.Rows.find(row => row.StudentRef === ref).Cells.forEach(cell => { cell.State = ref === 'exempt' ? 'Exempt' : 'Not enrolled'; });
  }
  const html = context.academicClassRegisterPrintHtml(register, filters, 'School', 'Term');
  assert.match(html, /8 matching students/);
  assert.match(html, /No scores at all—missing every applicable selected subject\/test/);
  assert.match(html, /Learner missing/);
  assert.doesNotMatch(html, /Learner zero|Learner absent|Learner exempt|Learner not-enrolled|Learner duplicate/);
});

test('filtered preview prints only matching students and describes the separate missing/below criteria', () => {
  const register = scoreFilterFixture();
  const filters = { testId: 'CA1', subjectIds: ['math'], scoreFilter: 'below', scoreThreshold: '50' };
  const low = context.academicClassRegisterPrintHtml(register, filters, 'School', 'Term');
  assert.match(low, /2 matching students/);
  assert.match(low, /Raw score below 50/);
  assert.match(low, /0 \/ 100/);
  assert.doesNotMatch(low, /Learner boundary|Learner missing|Learner absent/);
  const missing = context.academicClassRegisterPrintHtml(register, { ...filters, scoreFilter: 'missing' }, 'School', 'Term');
  assert.match(missing, /8 matching students/);
  assert.match(missing, /Missing scores in at least one selected subject\/test/);
  assert.doesNotMatch(missing, /Learner zero|Learner absent|Learner exempt|Learner duplicate/);
});

test('all-scored filter requires numeric marks in every selected subject, includes zero and leaves scores untouched', () => {
  const register = scoreFilterFixture(), before = structuredClone(register);
  const filters = { testId: 'CA1', subjectIds: ['math', 'english'], scoreFilter: 'scored-all' };
  assert.deepEqual(Array.from(context.academicClassRegisterView(register, filters).rows, row => row.StudentRef),
    ['zero', 'low', 'boundary', 'high']);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: ['english'] }).rows.length, register.Rows.length);
  assert.equal(context.academicClassRegisterView(register, { ...filters, query: ' ZERO ' }).rows.length, 1);
  assert.equal(context.academicClassRegisterView(register, { ...filters, query: 'missing' }).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: null }).rows.length, 4);
  for (const patch of [{ subjectIds: [] }, { subjectIds: ['unknown'] }, { subjectIds: ['math', 'unknown'] },
    { testId: 'unknown' }, { testId: 'CA2:theory' }, { testId: '' }]) {
    assert.equal(context.academicClassRegisterView(register, { ...filters, ...patch }).rows.length, 0);
  }
  assert.equal(context.academicClassRegisterView(null, filters).rows.length, 0);
  assert.deepEqual(register, before);
});

test('all-scored filter checks the chosen split test and rejects selected subjects without that test', () => {
  const register = scoreFilterFixture();
  const filters = { testId: 'CA2:theory', subjectIds: ['math'], scoreFilter: 'scored-all' };
  Object.assign(register.Rows[0].Cells.find(cell => cell.ColumnId === 'math-theory'), { State: 'Numeric', RawScore: 0 });
  assert.deepEqual(Array.from(context.academicClassRegisterView(register, filters).rows, row => row.StudentRef), ['zero']);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: ['math', 'english'] }).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, subjectIds: null }).rows.length, 0);
  assert.equal(context.academicClassRegisterView(register, { ...filters, testId: '', subjectIds: ['math', 'english'] }).rows.length, 1);
});

test('all-scored print includes every matching student, zero marks and the filter description', () => {
  const register = registerFixture();
  register.Rows[1].Cells.find(cell => cell.ColumnId === 'subject-1-CA1').State = 'Not recorded';
  const filters = { testId: 'CA1', subjectIds: ['subject-1', 'subject-3'], scoreFilter: 'scored-all' };
  const html = context.academicClassRegisterPrintHtml(register, filters, 'School', 'Term');
  assert.match(html, /64 matching students/);
  assert.equal((html.match(/TEST\//g) || []).length, 64);
  assert.match(html, /Scores in all selected subjects/);
  assert.match(html, /TEST\/000/);
  assert.match(html, /TEST\/064/);
  assert.match(html, /0 \/ 100/);
  assert.doesNotMatch(html, /TEST\/001|Subject 2|Exam/);
});
