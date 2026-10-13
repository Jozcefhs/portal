import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { extractFunction, fixture, renderWorkspace } from './helpers/academic-register-fixture.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const refs = html => [...html.matchAll(/data-academic-attendance-student data-student-ref="([^"]+)"/g)].map(match => match[1]);

test('class and lesson registers sort by displayed names, ignoring case and accents, with stable reference ties', () => {
  const input = fixture();
  const before = structuredClone(input);
  for (const daily of [true, false]) {
    const html = renderWorkspace('attendance', input, daily);
    assert.deepEqual(refs(html), ['TEST/4', 'TEST/1', 'TEST/2', 'TEST/3', 'TEST/8', 'TEST/10']);
    assert.match(html, /Ada &amp; Chidi/);
  }
  assert.deepEqual(input, before, 'sorting must not mutate membership order or saved data');
});

test('alphabetical rendering keeps saved attendance on the correct student and excludes out-of-scope memberships', () => {
  const input = fixture();
  const member = input.rows.studentMemberships[0];
  input.rows.studentMemberships.push(
    { ...member, StudentRef: 'OTHER/1', Status: 'Withdrawn' },
    { ...member, StudentRef: 'OTHER/2', SessionId: 'other' },
    { ...member, StudentRef: 'OTHER/3', TermId: 'other' },
    { ...member, StudentRef: 'OTHER/4', ClassId: 'other' },
    { ...member, StudentRef: 'OTHER/5', ArmId: 'other' },
    { ...member, StudentRef: 'TEST/99' }
  );
  const html = renderWorkspace('attendance', input);
  assert.deepEqual(refs(html), ['TEST/4', 'TEST/1', 'TEST/2', 'TEST/3', 'TEST/8', 'TEST/99', 'TEST/10']);
  const lateRow = html.match(/<tr data-academic-attendance-student data-student-ref="TEST\/3">[\s\S]*?<\/tr>/)[0];
  assert.match(lateRow, /<option selected>Late/);
  assert.match(lateRow, /data-academic-attendance-minutes value="12"/);
  assert.match(lateRow, /data-academic-attendance-note value="Bus delay"/);
  assert.doesNotMatch(html, /OTHER\//);
  input.rows.studentMemberships = [];
  assert.match(renderWorkspace('attendance', input), /No active students are assigned to this classroom/);
});

test('offline attendance drafts still restore by student reference after rows are sorted', () => {
  const sorted = ['TEST/1', 'TEST/3', 'TEST/10'].map(StudentRef => ({
    dataset: { studentRef: StudentRef }, fields: {},
    querySelector(selector) { return this.fields[selector] ||= {}; }
  }));
  const form = { querySelectorAll: () => sorted, querySelector: () => ({}) };
  const restored = runInNewContext(`(${extractFunction('restoreAcademicAttendanceLocalDraft')})(form)`, {
    form, academicAttendanceLocalDraftKey: () => 'draft', clean: value => String(value ?? '').trim(),
    localStorage: { getItem: () => JSON.stringify({ entries: [
      { StudentRef: 'TEST/10', Status: 'Absent', Note: 'Away' },
      { StudentRef: 'test/3', Status: 'Late', MinutesLate: 7 }
    ] }) }, DynamaxTime: { formatDateTime: () => '' }
  });
  assert.equal(restored, true);
  assert.equal(sorted[1].fields['[data-academic-attendance-status]'].value, 'Late');
  assert.equal(sorted[1].fields['[data-academic-attendance-minutes]'].value, 7);
  assert.equal(sorted[2].fields['[data-academic-attendance-status]'].value, 'Absent');
  assert.equal(sorted[2].fields['[data-academic-attendance-note]'].value, 'Away');
  assert.deepEqual(sorted[0].fields, {});
});

test('both workspace headers retain roster totals and use wrapping headers with nonshrinking single-line badges', async () => {
  assert.match(renderWorkspace('attendance'), /data-academic-attendance-count>6 students<\/strong>/);
  assert.match(renderWorkspace('scorebook'), /<strong>6 students<\/strong>/);
  const css = await read('css/style.css');
  const prefix = ':is(.academic-attendance-register,.academic-attendance-report,.academic-scorebook)>.academic-management-editor-heading';
  assert.ok(css.includes(`${prefix}{flex-wrap:wrap}`));
  assert.ok(css.includes(`${prefix}>div{flex:1 1 260px;min-width:0}`));
  assert.ok(css.includes(`${prefix}>strong{flex:0 0 auto;white-space:nowrap;overflow-wrap:normal;word-break:normal;`));
  const shell = await read('admin.html');
  assert.match(shell, /css\/style\.css\?v=[^"]*20261013-academic-register/);
  assert.match(shell, /js\/admin\.js\?v=[^"]*20261013-academic-register/);
  assert.match(await read('sw.js'), /dynamax-v374-settings-heading/);
});
