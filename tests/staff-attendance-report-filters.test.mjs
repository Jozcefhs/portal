import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import '../js/display-time.js';

const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const start = adminSource.indexOf('function filteredAttendanceReportRows(');
const end = adminSource.indexOf('function requestBrowserPosition(', start);
assert.ok(start >= 0 && end > start, 'Exercise the shared production report functions');
const reportSource = adminSource.slice(start, end);
const clean = (value) => String(value ?? '').trim();
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

function reportFunctions(organisation = 'Destiny Christian Academy') {
  let printedHtml = '';
  let printScheduled = false;
  const printable = {
    opener: {},
    document: { write: (html) => { printedHtml = html; }, close() {} },
    focus() {},
    print() {}
  };
  const functions = runInNewContext(`${reportSource}\n({ filteredAttendanceReportRows, attendanceReportSummary, printStaffAttendanceReport })`, {
    DynamaxTime: globalThis.DynamaxTime,
    clean,
    lower: (value) => clean(value).toLowerCase(),
    escapeHtml,
    attendanceMinutesLabel: (value) => Number(value) > 0 ? `${Number(value)} min` : '—',
    document: {
      querySelector: (selector) => selector === '[data-school-name]' ? { textContent: organisation } : null
    },
    staffBrand: null,
    currentUser: { displayName: 'HR officer' },
    window: {
      open: () => printable,
      setTimeout: () => { printScheduled = true; }
    }
  });
  return { ...functions, html: () => printedHtml, printScheduled: () => printScheduled, printable };
}

const filters = { Status: 'Present', FromDate: '2026-10-07', ToDate: '2026-10-07', SortBy: 'staff', SortDirection: 'asc' };
const records = Object.freeze([
  { Username: 'late', DisplayName: 'Beta Staff', Role: 'Staff', Date: '2026-10-07', AttendanceStatus: 'Late', LateMinutes: 20, FirstClockIn: '2026-10-07T07:20:00Z', LastClockOut: '2026-10-07T15:00:00Z', WorkMinutes: 460, OvertimeMinutes: 0, EarlyDepartureMinutes: 0 },
  { Username: 'present', DisplayName: 'Alpha Staff', Role: 'Staff', Date: '2026-10-07', AttendanceStatus: 'Present', LateMinutes: 0, FirstClockIn: '2026-10-07T07:00:00Z', LastClockOut: '', OvertimeMinutes: 30, EarlyDepartureMinutes: 0 },
  { Username: 'absent', DisplayName: 'Absent Staff', Date: '2026-10-07', AttendanceStatus: 'Absent', LateMinutes: 0 },
  { Username: 'leave', DisplayName: 'Leave Staff', Date: '2026-10-07', AttendanceStatus: 'Approved leave', LateMinutes: 0 },
  { Username: 'incomplete', DisplayName: 'Incomplete Staff', Date: '2026-10-07', AttendanceStatus: 'Incomplete', LateMinutes: 0 },
  { Username: 'offday', DisplayName: 'Off-day Staff', Date: '2026-10-07', AttendanceStatus: 'Overtime day', LateMinutes: 0, OvertimeMinutes: 60 }
].map(Object.freeze));

test('Present includes on-time and late arrivals without changing any attendance records', () => {
  const { filteredAttendanceReportRows, attendanceReportSummary } = reportFunctions();
  const before = JSON.stringify(records);
  const result = filteredAttendanceReportRows(records, filters);
  assert.deepEqual(result.map((row) => row.Username), ['present', 'late']);
  assert.equal(result[1], records[0]);
  assert.equal(result[1].AttendanceStatus, 'Late');
  assert.equal(result[1].LateMinutes, 20);
  assert.deepEqual(JSON.parse(JSON.stringify(attendanceReportSummary(result))), { records: 2, late: 1, absent: 0, overtime: 1 });
  assert.equal(JSON.stringify(records), before);
});

test('Present filter handles existing case and whitespace variations', () => {
  const { filteredAttendanceReportRows } = reportFunctions();
  const result = filteredAttendanceReportRows([
    { AttendanceStatus: ' PRESENT ', DisplayName: 'A' },
    { AttendanceStatus: ' late ', DisplayName: 'B' },
    { AttendanceStatus: 'ABSENT', DisplayName: 'C', LateMinutes: 20 }
  ], { ...filters, Status: ' present ' });
  assert.deepEqual(result.map((row) => row.DisplayName), ['A', 'B']);
});

test('Lateness, absence, leave, incomplete and overtime filters retain their separate meanings', () => {
  const { filteredAttendanceReportRows } = reportFunctions();
  const usernames = (status) => filteredAttendanceReportRows(records, { ...filters, Status: status }).map((row) => row.Username);
  assert.deepEqual(usernames('Late'), ['late']);
  assert.deepEqual(usernames('Absent'), ['absent']);
  assert.deepEqual(usernames('Approved leave'), ['leave']);
  assert.deepEqual(usernames('Incomplete'), ['incomplete']);
  assert.deepEqual(usernames('Overtime'), ['present', 'offday']);
  assert.equal(usernames('All').length, records.length);
});

test('Present retains staff search and sorting for included late arrivals', () => {
  const { filteredAttendanceReportRows } = reportFunctions();
  const byName = filteredAttendanceReportRows(records, { ...filters, StaffSearch: 'BETA' });
  assert.deepEqual(byName.map((row) => row.Username), ['late']);
  const byUsername = filteredAttendanceReportRows(records, { ...filters, StaffSearch: 'late' });
  assert.deepEqual(byUsername.map((row) => row.Username), ['late']);
  const byLateness = filteredAttendanceReportRows(records, { ...filters, SortBy: 'late', SortDirection: 'desc' });
  assert.deepEqual(byLateness.map((row) => row.Username), ['late', 'present']);
});

for (const [edition, organisation] of [
  ['school', 'Destiny Christian Academy'],
  ['church', 'Dunamis Church'],
  ['other organisation', 'Dynamax Organisation']
]) {
  test(`${edition} printed Present report includes late staff, late minutes and consistent totals`, () => {
    const report = reportFunctions(organisation);
    const rows = report.filteredAttendanceReportRows(records, filters);
    report.printStaffAttendanceReport(rows, filters);
    const html = report.html();
    assert.ok(html.includes(`<h1>${organisation}</h1>`));
    assert.match(html, /Present records \(including late arrivals\)/);
    assert.match(html, /Matching records<\/span><strong>2<\/strong>/);
    assert.match(html, /Late<\/span><strong>1<\/strong>/);
    assert.match(html, /<td>Beta Staff<\/td><td>Late<\/td>/);
    assert.match(html, /<td>20 min<\/td>/);
    assert.match(html, /<td>Alpha Staff<\/td><td>Present<\/td>/);
    assert.doesNotMatch(html, /Absent Staff|Leave Staff|Incomplete Staff|Off-day Staff/);
    assert.ok(report.printScheduled());
    assert.equal(report.printable.opener, null);
  });
}

test('attendance print respects its configured zone rather than the browser zone', () => {
  const report = reportFunctions();
  report.printStaffAttendanceReport([records[0]], filters, 'Africa/Nairobi');
  assert.match(report.html(), /10:20/);
  assert.match(report.html(), /18:00/);
  assert.doesNotMatch(report.html(), /07:20/);
});

test('Screen and print share the filtered rows and the UI explicitly includes late arrivals', () => {
  assert.match(adminSource, /attendanceReportRows = filteredAttendanceReportRows\(data\.recentDailyRecords \|\| \[\], reportFilters\)/);
  assert.match(adminSource, /printStaffAttendanceReport\(attendanceReportRows, reportFilters, policy\.TimeZone\)/);
  assert.match(adminSource, /value="Present"[^>]*>Present \(including late\)<\/option>/);
});
