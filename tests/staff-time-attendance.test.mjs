import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAttendanceMetrics,
  evaluateAttendancePresence,
  haversineDistanceMetres,
  normalizeAttendancePolicy,
  normalizeAttendanceSite
} from '../functions/lib/staff-time-attendance.js';

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
