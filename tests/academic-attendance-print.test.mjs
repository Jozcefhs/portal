import test from 'node:test';
import assert from 'node:assert/strict';
import { attendancePrintHtml } from '../js/academic-attendance-print.js';
import { readFile } from 'node:fs/promises';

test('inspector preview includes all dated registers, names, references and school context without modifying data', () => {
  const records = Array.from({length: 320}, (_, i) => ({ AttendanceDate: `2026-10-${String(i % 20 + 1).padStart(2, '0')}`, StudentRef: `ST/${i}`, Mode: 'Daily', Status: i % 2 ? 'Present' : 'Absent', Note: '<script>alert(1)</script>' }));
  const before = structuredClone(records);
  const html = attendancePrintHtml({ schoolName: 'School & Academy', classroom: 'Grade 7 / A', period: '2026/2027 · First term', mode: 'Daily',
    records, summaries: [{StudentRef:'ST/0', Present:0, Absent:1, AttendancePercentage:0, SchoolDaysOpen:20}], studentName: ref => `Student ${ref}`, subjectName: id => id });
  assert.match(html, /School &amp; Academy/);
  assert.match(html, /2026\/2027 · First term/);
  assert.match(html, /Dated attendance register/);
  assert.match(html, /Student ST\/319/);
  assert.match(html, /320 saved attendance entries/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /display:table-header-group/);
  assert.deepEqual(records, before);
});

test('attendance preview filters class, arm, term and mode before rendering', async () => {
  const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const fn = source.slice(source.indexOf('async function printAcademicAttendanceReport'), source.indexOf('function academicAttendanceWorkspace'));
  for (const required of ['row.SessionId === sessionId', 'row.TermId === termId', 'row.ClassId === arm.ClassId', 'row.ArmId === arm.ArmId', "mode === 'All' || row.Mode === mode", 'attendancePrintHtml(options)']) assert.ok(fn.includes(required));
});

test('individual preview uses an exact admission number and the loaded classroom, term and register', async () => {
  const { runInNewContext } = await import('node:vm');
  const { fixture, source } = await import('./helpers/academic-register-fixture.mjs');
  const { studentAttendancePrintHtml } = await import('../js/academic-attendance-print.js');
  const { data, rows } = fixture();
  data.workspaceRecordSelection = { ClassId: 'class', ArmId: 'arm' };
  const original = rows.studentAttendance[0];
  rows.studentAttendance.push({ ...original, AttendanceDate: '2026-10-12', Note: '<b>Earlier</b>' },
    ...[{ StudentRef: 'TEST/30' }, { StudentRef: 'TEST/4' }, { SessionId: 'old' }, { TermId: 'old' },
      { ClassId: 'other' }, { ArmId: 'other' }, { Mode: 'Period' }].map(extra => ({...original, Note: 'Outside selection', ...extra})));
  let html = '';
  const preview = {document: {write: text => {html = text;}, close() {}}, focus() {}};
  const code = source.slice(source.indexOf('function academicAttendanceHistoryRows('), source.indexOf('function academicAttendanceWorkspace('))
    .replace("await import('./academic-attendance-print.js')", 'printModule');
  const before = structuredClone(rows);
  await runInNewContext(code + "\npreviewStudentAttendance('test/3')", {
    academicManagementData: data, academicManagementView: 'presence', academicCurrentRows: () => rows,
    academicManagementFilters: {sessionId: 'session', termId: 'term'},
    lower: value => value.toLowerCase(), currentUser: {}, academicLabel: (_rows, id) => id,
    window: {open: () => preview}, printModule: {studentAttendancePrintHtml}
  });
  assert.match(html, /chioma Bello/);
  assert.match(html, /2 saved attendance entries/);
  assert.match(html, /Print \/ Save as PDF/);
  assert.match(html, /&lt;b&gt;Earlier&lt;\/b&gt;/);
  assert.ok(html.indexOf('2026-10-12') < html.indexOf('2026-10-13'));
  assert.doesNotMatch(html, /Outside selection/);
  assert.deepEqual(rows, before);
});

test('history search includes both the name and admission number and keeps namesakes individually selectable', async () => {
  const { fixture, renderWorkspace } = await import('./helpers/academic-register-fixture.mjs');
  const input = fixture();
  const row = input.rows.studentAttendance[0];
  input.rows.studentAttendance = ['TEST/1', 'TEST/2'].map(StudentRef => ({ ...row, StudentRef }));
  let entries;
  input.table = (title, rows, columns, options) => {
    if (title === 'Student Attendance History') {
      assert.equal(options.searchable, true);
      entries = rows.map(record => ({
        name: columns.find(col => col.label === 'Student').value(record),
        ref: columns.find(col => col.label === 'Admission number').value(record),
        action: columns.find(col => col.label === 'Pupil history').render(record)
      }));
    }
    return '';
  };
  renderWorkspace('attendance', input);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(entry => entry.name.toLowerCase() === 'alex musa'));
  assert.deepEqual(Array.from(entries, entry => entry.ref), ['TEST/1', 'TEST/2']);
  for (const entry of entries) assert.ok(entry.action.includes(`data-student-attendance-preview="${entry.ref}"`));
});
