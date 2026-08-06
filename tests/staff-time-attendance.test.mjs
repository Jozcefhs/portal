import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
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
const portalCss = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const attendanceSource = await readFile(new URL('../functions/lib/staff-time-attendance.js', import.meta.url), 'utf8');
const attendanceApiSource = await readFile(new URL('../functions/api/staff-attendance.js', import.meta.url), 'utf8');
const attendanceFaceSource = await readFile(new URL('../functions/api/staff-attendance-face.js', import.meta.url), 'utf8');

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
  assert.equal(policy.OvertimeMinimumMinutes, 20);
  assert.throws(() => normalizeAttendancePolicy({ ResumptionTime: '17:00', ClosingTime: '08:00' }), /Closing time must be later/);
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
});

test('attendance UI and API enforce identity and random continued-presence checks', () => {
  assert.match(adminJs, /Weekly schedule/);
  assert.match(adminJs, /PASSKEY_OR_FACE/);
  assert.match(adminJs, /Confirm presence/);
  assert.match(adminJs, /payload\.DaySchedules/);
  assert.match(adminJs, /attendanceIdentityProof\(policy, siteId, nextDirection\)/);
  assert.match(attendanceApiSource, /readStaffAttendanceProof/);
  assert.match(attendanceApiSource, /action === 'presence' \? 'CHECK'/);
  assert.match(attendanceSource, /recordPresenceCheck/);
  assert.match(attendanceSource, /Random presence check missed/);
  assert.match(attendanceFaceSource, /encryptFaceDescriptor/);
  assert.match(attendanceFaceSource, /decryptFaceDescriptor/);
  assert.match(attendanceFaceSource, /createStaffAttendanceProof/);
  assert.match(attendanceFaceSource, /Live face recognition did not match/);
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
