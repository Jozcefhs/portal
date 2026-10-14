import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { extractFunction, fixture, renderWorkspace, source } from './helpers/academic-register-fixture.mjs';
import { normalizeAcademicScoreImportRows } from '../functions/lib/academic-scorebook.js';
import '../js/list-sorting.js';

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
  let output = '';
  const popup = { document: { write: html => { output = html; }, close() {} }, focus() {} };
  runInNewContext(`${helpers}\n(${extractFunction('printAcademicAttendanceReport')})(data, rows, rows.arms[0], 'Daily', reports)`, {
    ...input, clean, escapeHtml, window: { open: () => popup },
    academicManagementFilters: { sessionId: 'session', termId: 'term' },
    reports: [{ StudentRef: 'TEST/4', Present: 2, AttendancePercentage: 100 }, { StudentRef: 'TEST/3', Present: 1, AttendancePercentage: 50 }]
  });
  assert.deepEqual(serials(output), [1, 2]);
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

test('membership search matches names, references and classrooms without replacing the selected student or draft', () => {
  const input = { value: '', addEventListener(_event, callback) { this.filter = callback; } };
  const status = { textContent: '' };
  const options = [
    { value: '', textContent: 'Choose student membership' },
    { value: 'm1', textContent: 'Émile Ade · DCA/26/001 — Grade 7 / Brilliance' },
    { value: 'm2', textContent: 'Ada James · DCA/26/002 — Grade 8 / Merit — Withdrawn' }
  ];
  const select = { options, value: '', addEventListener(_event, callback) { this.change = callback; }, replaceChildren(...nodes) { this.options = nodes; } };
  const form = { elements: { RecordId: select, Reason: { value: 'Approved move' }, ClassId: { value: 'target-class' }, RevisionToken: { value: 'r1' } }, querySelector: selector => selector.endsWith('-status]') ? status : input };
  runInNewContext(`(${extractFunction('bindAcademicMembershipSearch')})(form)`, { form, clean });
  input.value = 'emile brilliance'; input.filter();
  assert.deepEqual(select.options.map(option => option.value), ['', 'm1']);
  assert.equal(select.value, '', 'a search must never select another student automatically');
  input.value = 'dca/26/002'; input.filter();
  assert.deepEqual(select.options.map(option => option.value), ['', 'm2']);
  select.value = 'm2'; select.change();
  input.value = 'no match'; input.filter();
  assert.deepEqual(select.options.map(option => option.value), ['', 'm2']);
  assert.equal(select.value, 'm2');
  assert.match(status.textContent, /0 matching memberships; current selection kept/);
  assert.equal(form.elements.Reason.value, 'Approved move');
  assert.equal(form.elements.ClassId.value, 'target-class');
  assert.equal(form.elements.RevisionToken.value, 'r1');
  form.resetMembershipSearch();
  assert.equal(select.options.length, 3);
  assert.equal(select.value, 'm2');
  select.value = ''; input.value = 'no match'; input.filter();
  assert.deepEqual(select.options.map(option => option.value), ['']);
  assert.match(source, /bindAcademicMembershipSearch\(movementForm\)/);
  assert.match(source, /data-academic-membership-search placeholder="Search by name, admission number or classroom"/);
});

test('serial column stays compact and scorebook student names remain sticky beside it', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.match(css, /th\.academic-serial,td\.academic-serial\{[^}]*width:52px;min-width:52px/);
  assert.match(css, /td\.academic-student-cell\{position:sticky;left:52px/);
  assert.match(css, /academic-serial\{white-space:nowrap!important/);
});
