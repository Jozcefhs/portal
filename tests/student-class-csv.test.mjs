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
const { studentExportClass, studentClassExportCsv, studentClassExportToolbar } = runInNewContext(
  `${csvCellSource}\n${helpers}\n({ studentExportClass, studentClassExportCsv, studentClassExportToolbar })`,
  context
);

test('student class CSV includes the full selected class and excludes other classes', () => {
  const rows = [
    { AdmissionNo: '001', ClassName: 'Grade 7', ClassArm: 'Brilliance', DisplayName: '=HYPERLINK("x")' },
    { AdmissionNo: '002', ClassName: 'Grade 8', ClassArm: 'Brilliance', DisplayName: 'Other' },
    { AdmissionNo: '003', ClassName: 'Grade 7', ClassArm: 'Brilliance', DisplayName: 'Ada, Jane' },
  ];
  const csv = studentClassExportCsv(rows, 'Grade 7 / Brilliance');
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
  assert.match(source, /downloadCsvFile\(`students-\$\{fileClass\}\.csv`, studentClassExportCsv\(students, className\)\)/);
  assert.match(css, /\.student-class-export-action/);
  assert.match(html, /js\/admin\.js\?v=/);
});
