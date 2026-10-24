import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture, evaluate } from './helpers/academic-archived-memberships-fixture.mjs';

const report = input => JSON.parse(JSON.stringify(evaluate('academicArchivedMembershipRows(data, rows)', input)));

test('archived memberships link the old classroom to the retained membership without modifying data', () => {
  const input = fixture(), before = structuredClone(input);
  const rows = report(input);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].StudentName, 'Ada Test');
  assert.equal(rows[0].StudentRef, 'TEST/001');
  assert.equal(rows[0].ArchivedClassroom, 'Grade 10 / Reserved');
  assert.equal(rows[0].RetainedClassroom, 'Grade 10 / Perfection');
  assert.equal(rows[0].RetainedStatus, 'Active');
  assert.equal(rows[1].RetainedStatus, 'Withdrawn');
  assert.equal(rows[1].ArchivedClassroom, 'Grade 10 / Unassigned arm');
  assert.deepEqual(input, before);
});

test('links follow later supersessions and show later transfers on the retained membership', () => {
  const input = fixture();
  const retained = input.rows.studentMemberships[1];
  input.rows.studentMemberships.push({ ...retained, MembershipId: 'latest', ArmId: 'reserved' });
  Object.assign(retained, { Status: 'Archived', SupersededByMembershipId: 'latest' });
  assert.equal(report(input).find(row => row.ArchivedMembershipId === 'old-a').RetainedMembershipId, 'latest');
  assert.equal(report(input).find(row => row.ArchivedMembershipId === 'old-a').RetainedClassroom, 'Grade 10 / Reserved');
});

for (const field of ['StudentRef', 'BranchId', 'SchoolSection', 'SessionId', 'TermId']) {
  test(`retained lookup does not cross ${field} boundaries or trust missing identity`, () => {
    for (const value of ['another', '']) {
      const input = fixture(); input.rows.studentMemberships[1][field] = value;
      const row = report(input)[0];
      assert.equal(row.RetainedMembershipId, '');
      assert.equal(row.RetainedStatus, 'Not verified');
      assert.match(row.RetainedClassroom, /could not be verified/);
    }
  });
}

test('missing, ambiguous and cyclic links do not guess a classroom from the student profile', () => {
  for (const mode of ['missing', 'ambiguous', 'cycle', 'self']) {
    const input = fixture(), members = input.rows.studentMemberships;
    input.data.students[0].ClassArm = 'Some other arm';
    if (mode === 'missing') members.splice(1, 1);
    if (mode === 'ambiguous') members.push({ ...members[1] });
    if (mode === 'cycle') Object.assign(members[1], { Status: 'Archived', SupersededByMembershipId: 'old-a' });
    if (mode === 'self') members[0].SupersededByMembershipId = 'old-a';
    assert.equal(report(input).find(row => row.ArchivedMembershipId === 'old-a').RetainedStatus, 'Not verified');
  }
});

test('manual archives remain visible without inventing a retained entry, reason or date', () => {
  const input = fixture();
  input.rows.studentMemberships.push({ ...input.rows.studentMemberships[1], MembershipId: 'manual', Status: 'Archived' });
  const row = report(input).find(row => row.ArchivedMembershipId === 'manual');
  assert.equal(row.RetainedClassroom, 'No retained membership linked');
  assert.equal(row.Reason, 'Reason not recorded');
  assert.equal(row.ArchivedAt, '');
});

test('archive view respects the selected section, session and term', () => {
  const input = fixture();
  for (const [field, value] of [['SchoolSection', 'primary'], ['SessionId', 'past'], ['TermId', 'second']]) {
    input.data.studentMemberships.push({ ...input.data.studentMemberships[0], [field]: value, MembershipId: value });
  }
  assert.equal(evaluate('academicArchivedMembershipRows(data, academicCurrentRows(data)).length', input), 2);
});

test('read-only table escapes all stored fields, includes searchable IDs and formats archive dates in WAT', () => {
  const input = fixture();
  input.data.students[0].StudentName = '<img src=x onerror=alert(1)>';
  input.rows.studentMemberships[0].SupersededReason = '<script>bad()</script>';
  const html = evaluate('academicArchivedMembershipWorkspace(data, rows)', input);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.match(html, /2026-10-23 11:15:00 WAT/);
  assert.match(html, /data-admin-list-search/);
  assert.match(html, /old-a kept-a/);
  assert.match(html, /Retained class \/ arm \(current\)/);
  assert.doesNotMatch(html, /<button|<form|data-academic-(edit|archive|delete)=|<script>|<img/);
});

test('empty and primary-school views have accurate labels; active register still hides superseded duplicates', () => {
  const input = fixture(); input.rows.studentMemberships = [];
  const html = evaluate('academicManagementFilters.section = "primary"; academicArchivedMembershipWorkspace(data, rows)', input);
  assert.match(html, /0 archived memberships/);
  assert.match(html, /No archived memberships in the selected academic period/);
  assert.match(html, />Pupil</);
  assert.equal(evaluate('academicCurrentMembershipRegisterRows(rows.studentMemberships).length'), 2);
});

test('student workspace, task menu and cache include the archived screen', async () => {
  const [admin, html, sw] = await Promise.all(['js/admin.js', 'admin.html', 'sw.js'].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  assert.match(admin, /key: 'archived', label: 'Archived memberships'/);
  assert.match(admin, /\$\{academicArchivedMembershipWorkspace\(data, rows\)\}/);
  assert.match(html, /js\/admin\.js\?v=[^"]*archived-memberships/);
  assert.match(html, /css\/academic-archived-memberships\.css\?v=/);
  assert.match(sw, /SHELL.push\('\/css\/academic-archived-memberships.css'\)/);
});
