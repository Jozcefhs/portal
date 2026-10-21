import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { extractFunction, fixture, renderWorkspace, source } from './helpers/academic-register-fixture.mjs';
import { normalizeAcademicScoreImportRows } from '../functions/lib/academic-scorebook.js';
import '../js/list-sorting.js';
import { attendancePrintHtml } from '../js/academic-attendance-print.js';

const clean = value => String(value ?? '').trim();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const helpers = ['academicRecordId', 'academicFind', 'academicLabel', 'academicIsActive'].map(extractFunction).join('\n');
const serials = html => [...html.matchAll(/<td class="academic-serial">(\d+)<\/td>/g)].map(match => Number(match[1]));

test('class, lesson and score registers number the displayed roster without changing identity or saved data', () => {
  const input = fixture();
  const original = structuredClone(input);
  for (const [kind, daily] of [['attendance', true], ['attendance', false], ['scorebook', true]]) {
    const html = renderWorkspace(kind, input, daily);
    assert.match(html, /<th scope="col" class="academic-serial">S\/N<\/th><th class="academic-student-cell">Student<\/th>/);
    assert.deepEqual(serials(html), [1, 2, 3, 4, 5, 6]);
    assert.match(html, /<td class="academic-serial">1<\/td><td class="academic-student-cell">(?:<strong>)?Ada &amp; Chidi/);
  }
  assert.deepEqual(input, original);
  input.rows.studentMemberships = [];
  assert.match(renderWorkspace('attendance', input), /colspan="5">No active students/);
  assert.match(renderWorkspace('scorebook', input), /colspan="6">Choose an allocated/);
});

test('printed attendance summary includes one sequential number per student', () => {
  const input = fixture();
  const output = attendancePrintHtml({
    schoolName: 'School', classroom: 'Grade 7 / Excellence', period: 'Session · Term', mode: 'Daily', records: [],
    studentName: ref => ref === 'TEST/4' ? 'Ada & Chidi' : 'Other student', subjectName: id => id,
    summaries: [{ StudentRef: 'TEST/4', Present: 2, AttendancePercentage: 100 }, { StudentRef: 'TEST/3', Present: 1, AttendancePercentage: 50 }]
  });
  assert.deepEqual([...output.matchAll(/<tr><td>(\d+)<\/td>/g)].map(match => Number(match[1])), [1, 2]);
  assert.match(output, /S\/N<\/th>/);
  assert.match(output, /Ada &amp; Chidi/);
});

test('score CSV uses the scorebook order and S/N remains informational during import', () => {
  const input = fixture();
  const csv = runInNewContext(`${helpers}\n(${extractFunction('academicScoreTemplateCsv')})(data)`, {
    ...input, clean, academicCurrentRows: () => input.rows,
    academicScorebookDraft: { classId: 'class', armId: 'arm', subjectId: 'math' }
  });
  const records = csv.split('\r\n').map(line => line.split(',').map(value => value.slice(1, -1)));
  assert.deepEqual(records[0], ['S/N', 'StudentRef', 'StudentName', 'exam']);
  assert.deepEqual(records.slice(1).map(row => Number(row[0])), [1, 2, 3, 4, 5, 6]);
  assert.equal(records[1][1], 'TEST/4');
  const imported = normalizeAcademicScoreImportRows([{ 'S/N': '999', StudentRef: 'TEST/4', StudentName: 'Ada & Chidi', exam: '76' }], input.data.assessmentScheme);
  assert.equal(imported[0].StudentRef, 'TEST/4');
  assert.equal(imported[0].ComponentScores[0].RawScore, '76');
  assert.equal(imported[0]['S/N'], undefined);
});

test('numbered shared registers follow selected sort and update after filtering', () => {
  const sorting = globalThis.DynamaxListSorting;
  const context = {
    clean, escapeHtml, rows: [{ Name: 'Zara' }, { Name: 'Ada' }],
    columns: [{ label: 'Student', value: row => row.Name }],
    savedAdminListSort: () => 'name-asc', adminListNameValue: sorting.nameValue,
    adminListTimestamp: sorting.timestamp, sortAdminListEntries: sorting.sortEntries,
    ADMIN_LIST_CREATED_FIELDS: sorting.createdFields, ADMIN_LIST_MODIFIED_FIELDS: sorting.modifiedFields,
    ADMIN_LIST_SORT_MODES: [], adminListStorageKey: title => title, DynamaxTime: { formatCell: value => value }
  };
  const html = runInNewContext(`(${extractFunction('table')})('Register', rows, columns, { numbered: true, searchable: true })`, context);
  assert.match(html, /data-list-serial>1<\/td><td>Ada<\/td>/);
  assert.match(html, /data-list-serial>2<\/td><td>Zara<\/td>/);
  const unnumbered = runInNewContext(`(${extractFunction('table')})('Other module', rows, columns)`, context);
  assert.doesNotMatch(unnumbered, /data-list-serial/);
  const rows = [true, false, false].map(hidden => ({ hidden, cell: {}, querySelector() { return this.cell; } }));
  runInNewContext(`(${extractFunction('renumberAdminListRows')})(rows)`, { rows });
  assert.deepEqual(rows.map(row => row.cell.textContent), ['', '1', '2']);
  assert.match(source, /renumberAdminListRows\(body\.querySelectorAll/);
  assert.match(source, /renumberAdminListRows\(rows\)/);
});

function membershipSearchFixture(memberships = [
  { RecordId: 'm1', StudentRef: 'DCA/26/001', RevisionToken: 'revision-1', SessionId: 'session-1', TermId: 'term-1', ClassId: 'grade-7', ArmId: 'brilliance', DepartmentId: '' },
  { RecordId: 'm2', StudentRef: 'DCA/26/002', RevisionToken: 'revision-2', SessionId: 'session-1', TermId: 'term-1', ClassId: 'grade-8', ArmId: 'merit', DepartmentId: 'science' }
]) {
  const input = { value: '', addEventListener(_event, callback) { this.filter = callback; } };
  const status = { textContent: '' };
  const options = [
    { value: '', textContent: 'Choose student membership' },
    { value: 'm1', textContent: 'Émile Ade · DCA/26/001 — Grade 7 / Brilliance' },
    { value: 'm2', textContent: 'Ada James · DCA/26/002 — Grade 8 / Merit — Withdrawn' }
  ];
  const select = {
    options: options.filter(option => !option.value || memberships.some(row => row.RecordId === option.value)), value: '', listeners: [], changes: 0,
    addEventListener(_event, callback) { this.listeners.push(callback); },
    dispatchEvent(event) { this.changes++; event.target = this; this.listeners.forEach(callback => callback(event)); },
    replaceChildren(...nodes) { this.options = nodes; }
  };
  const elements = { RecordId: select, Reason: { value: 'Approved move' }, EffectiveDate: { value: '2026-10-14' } };
  for (const key of ['ClassId', 'ArmId', 'DepartmentId', 'SessionId', 'TermId', 'RevisionToken']) elements[key] = { value: '' };
  elements.namedItem = key => elements[key];
  const form = { elements, querySelector: selector => selector.endsWith('-status]') ? status : input };
  runInNewContext(`${helpers}\n${extractFunction('populateAcademicMovementForm')}\n(${extractFunction('bindAcademicMembershipSearch')})(form);
    form.elements.RecordId.addEventListener('change', event => populateAcademicMovementForm(form, academicFind(memberships, event.target.value)));`, {
    form, memberships, clean, Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } }
  });
  return { input, status, select, form };
}

test('one search match selects current membership and loads the correct student context and revision', () => {
  const { input, status, select, form } = membershipSearchFixture();
  assert.equal(select.value, '', 'initial load must leave the placeholder selected');
  input.value = 'emile brilliance'; input.filter();
  assert.deepEqual(select.options.map(option => option.value), ['', 'm1']);
  assert.equal(select.value, 'm1');
  assert.equal(form.elements.RevisionToken.value, 'revision-1');
  assert.equal(form.elements.ClassId.value, 'grade-7');
  assert.equal(form.elements.ArmId.value, 'brilliance');
  assert.match(status.textContent, /1 matching membership selected/);
  input.value = 'dca/26/002'; input.filter();
  assert.deepEqual(select.options.map(option => option.value), ['', 'm2']);
  assert.equal(select.value, 'm2');
  for (const [key, value] of Object.entries({ RevisionToken: 'revision-2', ClassId: 'grade-8', ArmId: 'merit', SessionId: 'session-1', TermId: 'term-1' })) {
    assert.equal(form.elements[key].value, value);
  }
  assert.equal(select.changes, 2, 'each new match triggers one normal selection event without recursion');
  assert.equal(form.elements.DepartmentId.value, '', 'a legacy student department must not populate a transfer override');
  assert.equal(form.elements.Reason.value, 'Approved move');
  assert.equal(form.elements.EffectiveDate.value, '2026-10-14');
});

test('searching the same student again preserves the entered transfer destination', () => {
  const { input, select, form } = membershipSearchFixture();
  input.value = 'DCA/26/002'; input.filter();
  form.elements.ClassId.value = 'target-class';
  form.elements.ArmId.value = 'target-arm';
  input.value = '  ada  merit  '; input.filter();
  assert.equal(select.value, 'm2');
  assert.equal(select.changes, 1);
  assert.equal(form.elements.ClassId.value, 'target-class');
  assert.equal(form.elements.ArmId.value, 'target-arm');
  assert.equal(form.elements.RevisionToken.value, 'revision-2');
});

test('multiple matches require selection; empty and unmatched searches preserve the current membership and draft', () => {
  const { input, status, select, form } = membershipSearchFixture();
  input.value = 'grade'; input.filter();
  assert.deepEqual(select.options.map(option => option.value), ['', 'm1', 'm2']);
  assert.equal(select.value, '');
  assert.equal(select.changes, 0);
  select.value = 'm2'; select.dispatchEvent({ type: 'change' });
  form.elements.ClassId.value = 'target-class';
  input.value = 'no match'; input.filter();
  assert.deepEqual(select.options.map(option => option.value), ['', 'm2']);
  assert.equal(select.value, 'm2');
  assert.match(status.textContent, /0 matching memberships; current selection kept/);
  assert.equal(form.elements.Reason.value, 'Approved move');
  assert.equal(form.elements.ClassId.value, 'target-class');
  assert.equal(form.elements.RevisionToken.value, 'revision-2');
  form.resetMembershipSearch();
  assert.equal(select.options.length, 3);
  assert.equal(select.value, 'm2');
  assert.equal(form.elements.ClassId.value, 'target-class');
  select.value = ''; input.value = 'no match'; input.filter();
  assert.deepEqual(select.options.map(option => option.value), ['']);
  assert.match(source, /bindAcademicMembershipSearch\(movementForm\)/);
  assert.match(source, /data-academic-membership-search placeholder="Search by name, admission number or classroom"/);
});

test('an empty search does not auto-select even when only one membership exists', () => {
  const { input, select, form } = membershipSearchFixture([{ RecordId: 'm1', RevisionToken: 'revision-1' }]);
  assert.equal(select.value, '');
  input.value = ' '; input.filter();
  assert.equal(select.value, '');
  form.resetMembershipSearch();
  assert.equal(select.value, '');
  input.value = 'DCA/26/001'; input.filter();
  assert.equal(select.value, 'm1');
  assert.equal(form.elements.RevisionToken.value, 'revision-1');
});

test('serial column stays compact and scorebook student names remain sticky beside it', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /th\.academic-serial,td\.academic-serial\{[^}]*width:52px;min-width:52px/);
  assert.match(css, /td\.academic-student-cell\{position:sticky;left:52px/);
  assert.match(css, /academic-serial\{white-space:nowrap!important/);
});
