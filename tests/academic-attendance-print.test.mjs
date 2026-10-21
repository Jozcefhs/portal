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
