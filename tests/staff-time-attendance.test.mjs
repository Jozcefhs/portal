import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attendanceClockInWindow,
  attendanceScheduleFor,
  calculateAttendanceMetrics,
  canManageStaffAttendance,
  canReportStaffAttendance,
  evaluateAttendancePresence,
  haversineDistanceMetres,
  normalizeAttendancePolicy,
  normalizeAttendanceReportPeriod,
  normalizeAttendanceSite
} from '../functions/lib/staff-time-attendance.js';

const adminJs = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const adminHtml = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const portalCss = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const attendanceSource = await readFile(new URL('../functions/lib/staff-time-attendance.js', import.meta.url), 'utf8');
const attendanceApiSource = await readFile(new URL('../functions/api/staff-attendance.js', import.meta.url), 'utf8');
const passkeyApiSource = await readFile(new URL('../functions/api/staff-passkey.js', import.meta.url), 'utf8');
const attendanceActionStateSource = attendanceSource.slice(
  attendanceSource.indexOf('async function getStaffAttendanceActionState'),
  attendanceSource.indexOf('export async function clockStaffAttendance')
);
const clockHandlerSource = attendanceSource.slice(
  attendanceSource.indexOf('export async function clockStaffAttendance'),
  attendanceSource.indexOf('export async function recordPresenceCheck')
);
const presenceHandlerSource = attendanceSource.slice(
  attendanceSource.indexOf('export async function recordPresenceCheck'),
  attendanceSource.indexOf('export async function recordManualAttendance')
);
const presenceButtonSource = adminJs.slice(
  adminJs.indexOf("document.getElementById('staffPresenceButton')"),
  adminJs.indexOf("document.getElementById('setupAttendancePasskey')")
);

test('geofence distance is calculated in metres', () => {
  assert.ok(haversineDistanceMetres(9.0765, 7.3986, 9.0765, 7.3986) < 1);
  assert.ok(haversineDistanceMetres(9.0765, 7.3986, 9.0774, 7.3986) > 90);
});

test('default attendance policy accepts a good geofence or an approved network', () => {
  const site = normalizeAttendanceSite({
    Name: 'Main church', Latitude: 9.0765, Longitude: 7.3986,
    RadiusMetres: 150, MaxAccuracyMetres: 100, AllowedPublicIps: '203.0.113.20'
  });
  assert.equal(evaluateAttendancePresence(site, { Latitude: 9.0766, Longitude: 7.3986, Accuracy: 20 }, '').passed, true);
  assert.equal(evaluateAttendancePresence(site, {}, '203.0.113.20').passed, true);
  assert.equal(evaluateAttendancePresence(site, { Latitude: 9.08, Longitude: 7.3986, Accuracy: 20 }, '198.51.100.1').passed, false);
});

test('poor GPS accuracy cannot satisfy geofence-only attendance', () => {
  const site = normalizeAttendanceSite({
    Name: 'Main church', Latitude: 9.0765, Longitude: 7.3986,
    RadiusMetres: 150, MaxAccuracyMetres: 50, Policy: 'GEOFENCE_ONLY'
  });
  const result = evaluateAttendancePresence(site, { Latitude: 9.0765, Longitude: 7.3986, Accuracy: 200 }, '');
  assert.equal(result.geofencePassed, false);
  assert.equal(result.passed, false);
});

test('attendance location capture retries precisely and saved locations can be deleted', () => {
  assert.match(adminJs, /navigator\.permissions\.query\(\{ name: 'geolocation' \}\)/);
  assert.match(adminJs, /enableHighAccuracy: true, timeout: 30000, maximumAge: 15000/);
  assert.match(adminJs, /enableHighAccuracy: false, timeout: 15000, maximumAge: 30000/);
  assert.match(adminJs, /data-delete-attendance-site/);
  assert.match(adminJs, /staffAttendanceRequest\('deletesite'/);
  assert.match(attendanceSource, /export async function deleteAttendanceSite/);
  assert.match(attendanceSource, /deleteDocument\(env, collectionPath, id\)/);
  assert.match(attendanceSource, /action === 'deletesite'/);
});

test('daily attendance policy normalizes work hours and rejects an invalid closing time', () => {
  const policy = normalizeAttendancePolicy({
    ResumptionTime: '08:00',
    ClosingTime: '17:00',
    GraceMinutes: '15',
    OvertimeMinimumMinutes: '20',
    WorkDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    TimeZone: 'Africa/Lagos'
  });
  assert.deepEqual(policy.WorkDays, ['MON', 'TUE', 'WED', 'THU', 'FRI']);
  assert.equal(policy.GraceMinutes, 15);
  assert.equal(policy.ClockInOpenMinutesBefore, 60);
  assert.equal(policy.OvertimeMinimumMinutes, 20);
  assert.equal(normalizeAttendancePolicy({ IdentityVerification: 'FACE' }).IdentityVerification, 'FACE');
  assert.equal(normalizeAttendancePolicy({ IdentityVerification: 'PASSKEY_OR_FACE' }).IdentityVerification, 'PASSKEY');
  assert.throws(() => normalizeAttendancePolicy({ ResumptionTime: '17:00', ClosingTime: '08:00' }), /Closing time must be later/);
  assert.throws(() => normalizeAttendancePolicy({ ClockInOpenMinutesBefore: 361 }), /between 0 and 360/);
});

test('clock-in opens only within the configured lead time for each working day', () => {
  const policy = normalizeAttendancePolicy({
    ClockInOpenMinutesBefore: 60,
    DaySchedules: {
      MON: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00' },
      TUE: { Enabled: true, ResumptionTime: '07:00', ClosingTime: '16:00' }
    },
    WorkDays: ['MON', 'TUE'],
    TimeZone: 'Africa/Lagos'
  });
  const tooEarly = attendanceClockInWindow(policy, '2026-08-03T06:59:00+01:00');
  const mondayOpen = attendanceClockInWindow(policy, '2026-08-03T07:00:00+01:00');
  const tuesdayOpen = attendanceClockInWindow(policy, '2026-08-04T06:00:00+01:00');
  assert.equal(tooEarly.allowed, false);
  assert.equal(tooEarly.opensAt, '07:00');
  assert.equal(tooEarly.minutesBeforeOpening, 1);
  assert.equal(mondayOpen.allowed, true);
  assert.equal(tuesdayOpen.allowed, true);
  assert.equal(tuesdayOpen.opensAt, '06:00');
});

test('different work hours can be configured and calculated for every day', () => {
  const policy = normalizeAttendancePolicy({
    ResumptionTime: '08:00',
    ClosingTime: '17:00',
    GraceMinutes: 5,
    DaySchedules: {
      MON: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00' },
      TUE: { Enabled: true, ResumptionTime: '07:30', ClosingTime: '16:00' },
      WED: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00' },
      THU: { Enabled: true, ResumptionTime: '08:00', ClosingTime: '17:00' },
      FRI: { Enabled: true, ResumptionTime: '08:30', ClosingTime: '15:00' },
      SAT: { Enabled: true, ResumptionTime: '09:00', ClosingTime: '13:00' },
      SUN: { Enabled: false, ResumptionTime: '09:00', ClosingTime: '12:00' }
    },
    TimeZone: 'Africa/Lagos'
  });
  assert.deepEqual(policy.WorkDays, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']);
  assert.deepEqual(attendanceScheduleFor(policy, 'TUE'), {
    Enabled: true, ResumptionTime: '07:30', ClosingTime: '16:00'
  });
  const tuesday = calculateAttendanceMetrics(policy, {
    Direction: 'IN', Timestamp: '2026-08-04T07:50:00+01:00'
  });
  const saturday = calculateAttendanceMetrics(policy, {
    Direction: 'OUT', Timestamp: '2026-08-08T13:25:00+01:00',
    FirstClockIn: '2026-08-08T09:00:00+01:00'
  });
  assert.equal(tuesday.ScheduledResumptionTime, '07:30');
  assert.equal(tuesday.LateMinutes, 20);
  assert.equal(saturday.ScheduledClosingTime, '13:00');
  assert.equal(saturday.OvertimeMinutes, 25);
  assert.throws(() => normalizeAttendancePolicy({
    DaySchedules: { MON: { Enabled: true, ResumptionTime: '17:00', ClosingTime: '08:00' } }
  }), /MON closing time must be later/);
});

test('clock-in automatically distinguishes present and late staff', () => {
  const policy = normalizeAttendancePolicy({
    ResumptionTime: '08:00', ClosingTime: '17:00', GraceMinutes: 15,
    WorkDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'], TimeZone: 'Africa/Lagos'
  });
  const present = calculateAttendanceMetrics(policy, {
    Direction: 'IN', Timestamp: '2026-08-04T08:10:00+01:00'
  });
  const late = calculateAttendanceMetrics(policy, {
    Direction: 'IN', Timestamp: '2026-08-04T08:20:00+01:00'
  });
  assert.equal(present.AttendanceStatus, 'Present');
  assert.equal(present.LateMinutes, 0);
  assert.equal(late.AttendanceStatus, 'Late');
  assert.equal(late.LateMinutes, 20);
});

test('clock-out calculates work duration, early departure and overtime', () => {
  const policy = normalizeAttendancePolicy({
    ResumptionTime: '08:00', ClosingTime: '17:00', GraceMinutes: 15,
    OvertimeMinimumMinutes: 15, WorkDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    TimeZone: 'Africa/Lagos'
  });
  const overtime = calculateAttendanceMetrics(policy, {
    Direction: 'OUT', Timestamp: '2026-08-04T17:35:00+01:00',
    FirstClockIn: '2026-08-04T08:20:00+01:00', ExistingStatus: 'Late'
  });
  const early = calculateAttendanceMetrics(policy, {
    Direction: 'OUT', Timestamp: '2026-08-04T16:30:00+01:00',
    FirstClockIn: '2026-08-04T08:20:00+01:00', ExistingStatus: 'Late'
  });
  assert.equal(overtime.AttendanceStatus, 'Late');
  assert.equal(overtime.WorkMinutes, 555);
  assert.equal(overtime.OvertimeMinutes, 35);
  assert.equal(overtime.EarlyDepartureMinutes, 0);
  assert.equal(early.OvertimeMinutes, 0);
  assert.equal(early.EarlyDepartureMinutes, 30);
});

test('attendance reporting grants HR time roles without widening unrelated HR roles', () => {
  assert.equal(canReportStaffAttendance({ role: 'HR Manager' }), true);
  assert.equal(canReportStaffAttendance({ role: 'HR Officer' }), true);
  assert.equal(canReportStaffAttendance({ role: 'HR Assistant' }), true);
  assert.equal(canReportStaffAttendance({ role: 'Employee Relations Officer' }), true);
  assert.equal(canReportStaffAttendance({ role: 'Line Manager' }), true);
  assert.equal(canReportStaffAttendance({ role: 'Recruitment Officer' }), false);
  assert.equal(canReportStaffAttendance({ role: 'Payroll Officer' }), false);
  assert.equal(canReportStaffAttendance({ role: 'Church Administrator' }), true);
});

test('attendance administration is available to senior HR roles only', () => {
  assert.equal(canManageStaffAttendance({ role: 'Super Admin' }), true);
  assert.equal(canManageStaffAttendance({ role: 'HR Director' }), true);
  assert.equal(canManageStaffAttendance({ role: 'HR Manager' }), true);
  assert.equal(canManageStaffAttendance({ role: 'HR Officer' }), true);
  assert.equal(canManageStaffAttendance({ role: 'Line Manager' }), false);
  assert.equal(canManageStaffAttendance({ role: 'Recruitment Officer' }), false);
});

test('attendance report periods are valid, ordered and bounded to one year', () => {
  assert.deepEqual(normalizeAttendanceReportPeriod({ FromDate: '2026-08-01', ToDate: '2026-08-31' }), {
    FromDate: '2026-08-01', ToDate: '2026-08-31'
  });
  assert.throws(() => normalizeAttendanceReportPeriod({ FromDate: '2026-08-31', ToDate: '2026-08-01' }), /on or after/);
  assert.throws(() => normalizeAttendanceReportPeriod({ FromDate: '2026-02-31', ToDate: '2026-03-01' }), /valid report start date/i);
  assert.throws(() => normalizeAttendanceReportPeriod({ FromDate: '2025-01-01', ToDate: '2026-08-31' }), /366 days or less/);
});

test('HR attendance report supports period filters, sorting and printing', () => {
  assert.match(attendanceSource, /ATTENDANCE_REPORT_LIMIT = 5000/);
  assert.match(attendanceSource, /field: 'Date', op: '>='/);
  assert.match(attendanceSource, /field: 'Date', op: '<='/);
  assert.match(adminJs, /HR attendance report/);
  assert.match(adminJs, /name="FromDate" type="date"/);
  assert.match(adminJs, /name="ToDate" type="date"/);
  assert.match(adminJs, /Lateness/);
  assert.match(adminJs, /Absence/);
  assert.match(adminJs, /Sort by/);
  assert.match(adminJs, /function printStaffAttendanceReport\(/);
  assert.match(adminJs, /Print \/ Save as PDF/);
});

test('attendance state resets by date and preserves the first successful daily times', () => {
  assert.match(attendanceSource, /clean\(storedState\?\.AttendanceDate\) === todayAttendanceDate/);
  assert.match(attendanceSource, /todayState = clean\(todayDaily\?\.FirstClockIn\)/);
  assert.match(attendanceSource, /state: direction === 'IN' \? 'CLOCKED_IN' : 'COMPLETED'/);
  assert.match(attendanceSource, /Repeated clocking cannot change them/);
  assert.match(attendanceSource, /first clock-in is already recorded/);
  assert.match(attendanceSource, /first clock-out is already recorded/);
  assert.match(attendanceSource, /normalizeAttendanceSite\(body, existing \|\| \{\}\)/);
  assert.match(attendanceSource, /EARLY_CLOCK_IN_REJECTED/);
  assert.match(attendanceSource, /This early attempt was not recorded as attendance/);
  assert.match(adminJs, /name="ClockInOpenMinutesBefore"/);
  assert.ok(clockHandlerSource.indexOf('attendanceClockInWindow') < clockHandlerSource.indexOf('verifiedAttendanceIdentity'));
});

test('attendance UI and API support device unlock, guided live face checks, and random continued-presence checks', () => {
  assert.match(adminJs, /Weekly schedule/);
  assert.match(adminJs, /Device unlock required/);
  assert.match(adminJs, /PIN, password, fingerprint or built-in face unlock/);
  assert.match(adminJs, /Live face recognition required/);
  assert.match(adminJs, /Enroll or replace my face/);
  assert.match(adminJs, /Remove face enrollment/);
  assert.match(adminJs, /Confirm presence/);
  assert.match(adminJs, /payload\.DaySchedules/);
  assert.match(adminJs, /attendanceVerificationEvidence\(policy, siteId, nextDirection\)/);
  assert.match(attendanceApiSource, /readStaffAttendanceProof/);
  assert.match(attendanceApiSource, /action === 'presence' \? 'CHECK'/);
  assert.match(attendanceSource, /recordPresenceCheck/);
  assert.match(attendanceSource, /Random presence check missed/);
  assert.match(attendanceSource, /IDENTITY_VERIFICATION_MODES = new Set\(\['NONE', 'PASSKEY', 'FACE'\]\)/);
  assert.match(attendanceSource, /required === 'FACE' \? method === 'face' : method === 'passkey'/);
  assert.match(attendanceSource, /return method === 'face' \? 'Live face recognition' : 'Device unlock'/);
});

test('continued-presence confirmation uses focused reads and updates the UI without a full reload', () => {
  assert.doesNotMatch(presenceHandlerSource, /listStaffAttendance|listCollection|queryCollection/);
  assert.match(presenceHandlerSource, /getStaffAttendanceActionState/);
  assert.doesNotMatch(attendanceActionStateSource, /listStaffAttendance|listCollection|queryCollection/);
  assert.equal((attendanceActionStateSource.match(/getDocument\(/g) || []).length, 4);
  assert.match(attendanceActionStateSource, /getDocument\(env, attendancePolicyPath\(branchId\), 'default'\)/);
  assert.match(attendanceActionStateSource, /const \[site, storedState, existingDaily\] = await Promise\.all/);
  assert.match(attendanceActionStateSource, /getDocument\(env, dailyPath, dailyId\)/);
  assert.match(presenceHandlerSource, /batchCommitDocuments/);
  assert.doesNotMatch(presenceButtonSource, /loadStaffAttendance\(/);
  assert.match(presenceButtonSource, /updateAttendancePresenceCard/);
});

test('attendance policy settings use compact accessible tabs on mobile', () => {
  assert.match(adminJs, /class="attendance-settings-tabs" role="tablist"/);
  assert.match(adminJs, /data-attendance-policy-tab="general"/);
  assert.match(adminJs, /data-attendance-policy-tab="identity"/);
  assert.match(adminJs, /data-attendance-policy-tab="presence"/);
  assert.match(adminJs, /data-attendance-policy-tab="schedule"/);
  assert.match(adminJs, /data-attendance-policy-panel="schedule" hidden/);
  assert.match(adminJs, /activatePolicyTab/);
  assert.match(adminJs, /policyTabStorageKey/);
  assert.match(adminJs, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(adminJs, /addEventListener\('invalid'/);
  assert.match(portalCss, /\.attendance-settings-panel\[hidden\]\{display:none!important\}/);
  assert.match(portalCss, /@media\(max-width:760px\)\{\.attendance-settings-tabs/);
  assert.match(portalCss, /\.attendance-week-schedule-row\{grid-template-columns:minmax\(0,1fr\) auto/);
});

test('dashboard provides a live clock and protected attendance quick action', () => {
  assert.match(adminHtml, /id="staffDashboardClock"/);
  assert.match(adminJs, /function updateDashboardClockFace\(\)/);
  assert.match(adminJs, /window\.setInterval\(updateDashboardClockFace, 1000\)/);
  assert.match(adminJs, /staffAttendanceRequest\('quick'\)/);
  assert.match(adminJs, /id="dashboardAttendanceClockButton"/);
  assert.match(adminJs, /attendanceVerificationEvidence\(policy, siteId, direction\)/);
  assert.match(adminJs, /staffAttendanceRequest\('clock'/);
  assert.match(adminJs, /Location: location/);
  assert.match(attendanceSource, /export async function getStaffAttendanceQuickState/);
  assert.match(attendanceSource, /todayDaily: todayDaily \|\| null/);
  assert.match(attendanceApiSource, /!\['list', 'quick'\]\.includes\(action\)/);
  assert.match(portalCss, /\.dashboard-time-attendance\{display:grid/);
  assert.match(portalCss, /\.dashboard-digital-clock strong\{/);
  assert.match(portalCss, /\.attendance-clock-controls\{display:grid;grid-template-columns:minmax\(190px,260px\) minmax\(140px,1fr\) max-content/);
  assert.match(portalCss, /\.attendance-clock-controls select\{box-sizing:border-box;width:100%;min-width:0\}/);
  assert.match(portalCss, /\.attendance-clock-controls>small\{[^}]*overflow-wrap:normal;word-break:normal/);
  assert.match(portalCss, /\.workflow-intro>button\{[^}]*min-width:max-content;white-space:nowrap/);
  assert.match(portalCss, /@media\(max-width:1200px\)\{\.attendance-clock-card\{grid-template-columns:1fr/);
  assert.match(portalCss, /@media\(max-width:760px\)\{\.management-split,\.attendance-clock-card\{grid-template-columns:1fr/);
  assert.match(portalCss, /@media\(max-width:760px\)\{\.dashboard-time-attendance\{grid-template-columns:1fr/);
});

test('mobile attendance sequences location and configured identity checks without competing permission prompts', () => {
  assert.match(adminJs, /const location = await browserPosition\(\)\.catch\(\(\) => \(\{\}\)\)/);
  assert.match(adminJs, /const attendanceProof = await attendanceIdentityProof\(policy, siteId, direction\)/);
  assert.match(adminJs, /warmAttendanceIdentity\(policy/);
  assert.match(adminJs, /function attendanceFaceModule\(\)/);
  assert.match(adminJs, /captureStaffAttendanceFace\(\{ mode: 'verify', siteId, direction \}\)/);
  assert.match(adminJs, /preloadStaffAttendanceFace\(\)/);
  assert.match(adminJs, /captureStaffAttendanceFace\(\{ mode: 'enroll', attendanceProof: proof \}\)/);
  assert.match(adminJs, /revokeStaffAttendanceFace\(proof\)/);
  assert.match(clockHandlerSource, /getStaffAttendanceActionState/);
  assert.doesNotMatch(clockHandlerSource, /listStaffAttendance|listCollection|queryCollection/);
  assert.match(passkeyApiSource, /getDocument\(env, 'staffPasskeys', await documentIdForCredential\(credentialId\)\)/);
  assert.match(passkeyApiSource, /method: 'Device unlock'/);
});
