import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  attendanceDocumentId,
  attendanceSummary,
  normalizeAttendance,
  normalizeAttendanceCount,
  normalizeChurchService,
  normalizeServiceOccurrence,
  serviceCapabilities
} from '../functions/lib/church-services.js';

const adminJs = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const serviceApi = fs.readFileSync(new URL('../functions/lib/church-services.js', import.meta.url), 'utf8');

test('church service capabilities separate schedule management from attendance recording', () => {
  assert.equal(serviceCapabilities({ role: 'Pastor' }).canManageServices, true);
  assert.equal(serviceCapabilities({ role: 'Church Administrator' }).canManageOccurrences, true);
  assert.equal(serviceCapabilities({ role: 'Membership Officer' }).canManageServices, false);
  assert.equal(serviceCapabilities({ role: 'Membership Officer' }).canRecordAttendance, true);
  assert.equal(serviceCapabilities({ role: 'Treasurer' }).canView, false);
});

test('service definitions normalize reusable schedule fields', () => {
  const service = normalizeChurchService({
    ServiceId: 'SUN-AM',
    Name: 'Sunday Celebration',
    DayOfWeek: 'Sunday',
    StartTime: '09:00',
    Frequency: 'Weekly'
  }, 'Main');
  assert.equal(service.BranchId, 'main');
  assert.equal(service.Active, 'YES');
  assert.equal(service.Frequency, 'Weekly');
  assert.throws(() => normalizeChurchService({ Name: 'No ID' }), /ServiceId/);
});

test('service occurrences require a service, stable ID, and ISO date', () => {
  const occurrence = normalizeServiceOccurrence({
    OccurrenceId: 'OCC-001',
    ServiceId: 'SUN-AM',
    Date: '2026-07-26',
    Status: 'Scheduled'
  }, 'Lagos');
  assert.equal(occurrence.BranchId, 'lagos');
  assert.equal(occurrence.Date, '2026-07-26');
  assert.throws(
    () => normalizeServiceOccurrence({ OccurrenceId: 'OCC-1', ServiceId: 'SUN-AM', Date: '26/07/2026' }),
    /YYYY-MM-DD/
  );
  assert.throws(
    () => normalizeServiceOccurrence({ OccurrenceId: 'OCC-2', ServiceId: 'SUN-AM', Date: '2026-02-31' }),
    /valid YYYY-MM-DD/
  );
});

test('member attendance IDs are deterministic per occurrence and member', () => {
  const first = attendanceDocumentId({ OccurrenceId: 'OCC-001', MemberId: 'MEM-001' });
  const second = attendanceDocumentId({ OccurrenceId: 'OCC-001', MemberId: 'MEM-001' });
  assert.equal(first, second);
  assert.equal(first, 'OCC-001--member--MEM-001');
});

test('visitor attendance requires identity and a visitor reference', () => {
  const attendance = normalizeAttendance({
    OccurrenceId: 'OCC-001',
    AttendanceType: 'Visitor',
    VisitorReference: 'VIS-001',
    DisplayName: 'First Visitor',
    FirstTimeVisitor: true
  }, 'main');
  assert.equal(attendance.AttendanceType, 'Visitor');
  assert.equal(attendance.FirstTimeVisitor, true);
  assert.equal(attendance.AttendanceId, 'OCC-001--visitor--VIS-001');
  assert.throws(
    () => normalizeAttendance({ OccurrenceId: 'OCC-001', VisitorReference: 'VIS-2' }),
    /Visitor name/
  );
  assert.throws(
    () => normalizeAttendance({ OccurrenceId: 'OCC-001', AttendanceType: 'Member', DisplayName: 'Not linked' }),
    /MemberId/
  );
});

test('attendance summaries distinguish members, visitors, and first-time visitors', () => {
  const result = attendanceSummary(
    [{ OccurrenceId: 'OCC-001', ServiceName: 'Sunday Celebration' }],
    [
      { OccurrenceId: 'OCC-001', AttendanceType: 'Member', MemberId: 'MEM-1' },
      { OccurrenceId: 'OCC-001', AttendanceType: 'Visitor', FirstTimeVisitor: true },
      { OccurrenceId: 'OCC-001', AttendanceType: 'Visitor', FirstTimeVisitor: false }
    ]
  );
  assert.deepEqual(
    {
      total: result[0].TotalAttendance,
      members: result[0].MemberAttendance,
      visitors: result[0].VisitorAttendance,
      firstTime: result[0].FirstTimeVisitors
    },
    { total: 3, members: 1, visitors: 2, firstTime: 1 }
  );
});

test('an aggregate headcount is validated and remains the occurrence total', () => {
  assert.equal(normalizeAttendanceCount('275'), 275);
  assert.equal(normalizeAttendanceCount(0), 0);
  assert.throws(() => normalizeAttendanceCount('-1'), /whole number/);
  assert.throws(() => normalizeAttendanceCount('2.5'), /whole number/);
  const result = attendanceSummary(
    [{ OccurrenceId: 'OCC-002', AttendanceCount: 275 }],
    [{ OccurrenceId: 'OCC-002', AttendanceType: 'Member', MemberId: 'MEM-1' }]
  );
  assert.equal(result[0].TotalAttendance, 275);
  assert.equal(result[0].MemberAttendance, 1);
});

test('the web services workspace records occurrences, totals, and individual check-ins', () => {
  assert.match(adminJs, /id="churchOccurrenceForm"/);
  assert.match(adminJs, /churchServiceAction\('saveOccurrence', payload\)/);
  assert.match(adminJs, /id="churchAttendanceTotalForm"/);
  assert.match(adminJs, /name="AttendanceCount" type="number"/);
  assert.match(adminJs, /churchServiceAction\('recordAttendanceTotal', payload\)/);
  assert.match(adminJs, /id="churchAttendanceForm"/);
  assert.match(adminJs, /churchServiceAction\('recordAttendance', payload\)/);
  assert.match(serviceApi, /recordChurchAttendanceTotal/);
  assert.match(serviceApi, /AttendanceCountRecordedAt/);
});
