import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAttendancePresence,
  haversineDistanceMetres,
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

