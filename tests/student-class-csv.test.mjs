import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function studentExportClass('), source.indexOf('function bindStudentClassExport('));
const csvCellSource = source.slice(source.indexOf('function csvCell('), source.indexOf('function exportIncomeAnalyticsCsv('));
const clean = (value) => String(value ?? '').trim();
const pick = (row, keys) => keys.map((key) => row?.[key]).find((value) => clean(value)) ?? '';
const context = { clean, pick, escapeHtml: (value) => String(value), };
const { studentExportClass, studentClassExportGroups, studentClassExportCsv, studentClassExportToolbar } = runInNewContext(
  `${csvCellSource}\n${helpers}\n({ studentExportClass, studentClassExportGroups, studentClassExportCsv, studentClassExportToolbar })`,
  context
);

test('student class CSV includes the full selected class and excludes other classes', () => {
  const rows = [
    { AdmissionNo: '001', ClassName: 'Grade 7', ClassArm: 'Brilliance', DisplayName: '=HYPERLINK("x")' },
    { AdmissionNo: '002', ClassName: 'Grade 8', ClassArm: 'Brilliance', DisplayName: 'Other' },
    { AdmissionNo: '003', ClassName: 'Grade 7', ClassArm: 'Brilliance', DisplayName: 'Ada, Jane' },
  ];
  const selected = studentClassExportGroups(rows).find(group => group.label === 'Grade 7 / Brilliance');
  const csv = studentClassExportCsv(rows, selected.key);
  assert.match(csv, /"001"/);
  assert.match(csv, /"003"/);
  assert.doesNotMatch(csv, /"002"/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"Ada, Jane"/);
  assert.doesNotMatch(csv, /ParentLoginCode|VerificationCode|TemporaryPassword/);
  assert.equal(studentExportClass({ ClassName: 'Grade 7 Brilliance', ClassArm: 'Brilliance' }), 'Grade 7 Brilliance');
});

test('student register exposes a responsive class picker and export action', () => {
  const toolbar = studentClassExportToolbar([{ ClassName: 'Grade 7', ClassArm: 'Brilliance' }]);
  assert.match(toolbar, /data-student-export-class/);
  assert.match(toolbar, /Grade 7 \/ Brilliance/);
  assert.match(toolbar, /data-student-export-csv disabled/);
  assert.match(source, /bindStudentClassExport\(students\)/);
  assert.match(source, /downloadCsvFile\(`students-\$\{fileClass\}\.csv`, studentClassExportCsv\(students, group.key\)\)/);
  assert.match(css, /\.student-class-export-action/);
  assert.match(html, /js\/admin\.js\?v=/);
});

const pupil = (number, ClassName, ClassArm, changes = {}) => ({ AdmissionNo: `DEMO/${number}`, ClassName, ClassArm,
  BranchId: 'the-lord-s-garden-primary', SchoolSection: 'primary', AcademicClassId: 'nursery-two', AcademicArmId: 'nursery-two-excellence', ...changes });

test('one identified classroom includes all spelling variants and preserves the loaded records', () => {
  const rows = Array.from({ length: 22 }, (_, index) => pupil(index + 1, index < 14 ? 'Nursery2' : 'NURSERY 2', 'EXCELLENCE'));
  rows.push(...Array.from({ length: 22 }, (_, index) => pupil(index + 23, 'Pre-Nursery', index ? 'EXCELLENCE' : 'Excellence',
    { AcademicClassId: 'pre-nursery', AcademicArmId: 'pre-nursery-excellence' })));
  const before = JSON.stringify(rows);
  const groups = studentClassExportGroups(rows);
  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups, group => group.rows.length), [22, 22]);
  const nursery = groups.find(group => group.classId === 'nursery-two');
  const csv = studentClassExportCsv(rows, nursery.key);
  for (let index = 1; index <= 22; index++) assert.ok(csv.includes(`"DEMO/${index}"`));
  assert.ok(!csv.includes('"DEMO/23"'));
  assert.equal((studentClassExportToolbar(rows).match(/<option /g) || []).length, 3);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(studentClassExportGroups([...rows].reverse()).find(group => group.classId === nursery.classId).key, nursery.key);
});

test('distinct class, arm, branch and section identities never merge despite equal labels', () => {
  const rows = [pupil(1, 'Nursery2', 'EXCELLENCE'),
    pupil(2, 'Nursery2', 'EXCELLENCE', { AcademicClassId: 'different-class' }),
    pupil(3, 'Nursery2', 'EXCELLENCE', { AcademicArmId: 'different-arm' }),
    pupil(4, 'Nursery2', 'EXCELLENCE', { BranchId: 'area-1-primary' }),
    pupil(5, 'Nursery2', 'EXCELLENCE', { SchoolSection: 'secondary' })];
  const groups = studentClassExportGroups(rows);
  assert.equal(groups.length, 5);
  assert.equal(new Set(groups.map(group => group.key)).size, 5);
  assert.equal(new Set(groups.map(group => group.optionLabel)).size, 5);
  for (const group of groups) assert.equal(studentClassExportCsv(rows, group.key).split('\r\n').length, 2);
});

test('legacy rows join a unique classroom with normalized spelling, but ambiguous identities stay separate', () => {
  const legacy = pupil(2, 'NURSERY 2', 'Excellence', { AcademicClassId: '', AcademicArmId: '' });
  const rows = [legacy, pupil(1, 'Nursery2', 'EXCELLENCE')];
  assert.equal(studentClassExportGroups(rows).length, 1);
  assert.equal(studentClassExportGroups(rows)[0].rows.length, 2);
  rows.push(pupil(3, 'Nursery2', 'EXCELLENCE', { AcademicClassId: 'distinct-class', AcademicArmId: 'distinct-arm' }));
  assert.equal(studentClassExportGroups(rows).length, 3);
  assert.ok(studentClassExportGroups(rows).every(group => group.rows.length === 1));
});

test('legacy labels keep distinct programmes and arms separate without semantic class aliases', () => {
  const rows = [pupil(1, 'Nursery2', 'EXCELLENCE'), pupil(2, 'NURSERY 2', 'Excellence'),
    pupil(3, 'Crèche', 'EXCELLENCE'), pupil(4, 'Playgroup', 'EXCELLENCE'),
    pupil(5, 'Nursery 2', 'DISTINCTION')].map(row => ({ ...row, AcademicClassId: '', AcademicArmId: '' }));
  const groups = studentClassExportGroups(rows);
  assert.equal(groups.length, 4);
  assert.equal(groups.find(group => group.rows.some(row => row.AdmissionNo === 'DEMO/1')).rows.length, 2);
  assert.equal(groups.find(group => group.label.startsWith('Crèche')).rows.length, 1);
  assert.equal(groups.find(group => group.label.startsWith('Playgroup')).rows.length, 1);
});

test('canonical storage scope wins over a stale branch field and partial IDs only join an unambiguous classroom', () => {
  const rows = [pupil(1, 'Nursery2', 'EXCELLENCE'),
    pupil(2, 'NURSERY 2', 'Excellence', { AcademicArmId: '' }),
    pupil(3, 'Nursery2 / EXCELLENCE', 'EXCELLENCE', { AcademicClassId: '', AcademicArmId: '', BranchId: 'main',
      __scopePath: 'schoolBranches/the-lord-s-garden-primary/sections/primary/students' })];
  const groups = studentClassExportGroups(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 3);
});

test('selection count and download use the exact same classroom identity', () => {
  const rows = [pupil(1, 'Nursery2', 'EXCELLENCE'), pupil(2, 'NURSERY 2', 'Excellence'),
    pupil(3, 'Nursery2', 'EXCELLENCE', { AcademicClassId: 'other', AcademicArmId: 'other-arm' })];
  const select = { value: '', addEventListener(type, callback) { this[type] = callback; } };
  const button = { disabled: true, addEventListener(type, callback) { this[type] = callback; } };
  const count = { textContent: '' }, downloads = [];
  const bindSource = source.slice(source.indexOf('function bindStudentClassExport('), source.indexOf('function walletAmountValue('));
  const bind = runInNewContext(`${bindSource}\nbindStudentClassExport`, { studentClassExportGroups, studentClassExportCsv,
    panelEl: { querySelector: name => name.includes('export-class') ? select : name.includes('export-csv') ? button : count },
    downloadCsvFile: (...args) => downloads.push(args) });
  bind(rows);
  select.value = studentClassExportGroups(rows).find(group => group.classId === 'nursery-two').key;
  select.change(); assert.equal(count.textContent, '2 students in this class'); assert.equal(button.disabled, false);
  button.click(); assert.equal(downloads.length, 1);
  assert.match(downloads[0][1], /"DEMO\/1"/); assert.match(downloads[0][1], /"DEMO\/2"/); assert.doesNotMatch(downloads[0][1], /"DEMO\/3"/);
  select.value = 'missing'; select.change(); button.click();
  assert.equal(button.disabled, true); assert.equal(downloads.length, 1);
});
