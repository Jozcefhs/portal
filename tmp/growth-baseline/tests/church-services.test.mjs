import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  attendanceDocumentId,
  attendanceSummary,
  normalizeAttendance,
  normalizeAttendanceBreakdown,
  normalizeAttendanceCount,
  normalizeChurchService,
  normalizeServiceOccurrence,
  normalizeServiceOccurrenceStatus,
  canCompleteServiceOccurrence,
  serviceCapabilities
} from '../functions/lib/church-services.js';

const adminJs = fs.readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
const serviceApi = fs.readFileSync(new URL('../functions/lib/church-services.js', import.meta.url), 'utf8');
const portalCss = fs.readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');

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
  assert.equal(normalizeServiceOccurrenceStatus('in progress'), 'In Progress');
  assert.throws(() => normalizeServiceOccurrenceStatus('Held'), /must be Scheduled/);
  assert.equal(canCompleteServiceOccurrence('Scheduled'), true);
  assert.equal(canCompleteServiceOccurrence('In Progress'), true);
  assert.equal(canCompleteServiceOccurrence('Completed'), false);
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

test('attendance breakdown validates age, gender, first-timer and conversion totals', () => {
  assert.deepEqual(normalizeAttendanceBreakdown({
    AttendanceCount: 275,
    ChildrenCount: 75,
    AdultCount: 200,
    MaleCount: 120,
    FemaleCount: 80,
    FirstTimerCount: 18,
    NewConvertCount: 6
  }), {
    AttendanceCount: 275,
    ChildrenCount: 75,
    AdultCount: 200,
    MaleCount: 120,
    FemaleCount: 80,
    FirstTimerCount: 18,
    NewConvertCount: 6
  });
  assert.deepEqual(normalizeAttendanceBreakdown({ AttendanceCount: 25 }), { AttendanceCount: 25 });
  assert.throws(() => normalizeAttendanceBreakdown({ AttendanceCount: 10, ChildrenCount: 3 }), /both the children and adult/);
  assert.throws(() => normalizeAttendanceBreakdown({ AttendanceCount: 10, ChildrenCount: 3, AdultCount: 6 }), /add up to the total/);
  assert.throws(() => normalizeAttendanceBreakdown({ AttendanceCount: 10, ChildrenCount: 2, AdultCount: 8, MaleCount: 4, FemaleCount: 5 }), /adult attendance/);
  assert.throws(() => normalizeAttendanceBreakdown({ AttendanceCount: 10, FirstTimerCount: 11 }), /First-timers/);
  assert.throws(() => normalizeAttendanceBreakdown({ AttendanceCount: 10, NewConvertCount: 11 }), /New converts/);
});

test('the web services workspace records occurrences, totals, and individual check-ins', () => {
  assert.match(adminJs, /id="churchOccurrenceForm"/);
  assert.match(adminJs, /id="churchOccurrenceForm" class="workflow-card compact-form church-service-entry-form"/);
  assert.match(adminJs, /churchServiceAction\('saveOccurrence', payload\)/);
  assert.match(adminJs, /data-complete-service-occurrence/);
  assert.match(adminJs, /churchServiceAction\('completeOccurrence', \{ OccurrenceId: occurrenceId \}\)/);
  assert.match(adminJs, /Completed · locked/);
  assert.match(adminJs, /id="churchAttendanceTotalForm"/);
  assert.match(adminJs, /name="AttendanceCount" type="number"/);
  assert.match(adminJs, /name="ChildrenCount" type="number"/);
  assert.match(adminJs, /name="AdultCount" type="number"/);
  assert.match(adminJs, /name="MaleCount" type="number"/);
  assert.match(adminJs, /name="FemaleCount" type="number"/);
  assert.match(adminJs, /name="FirstTimerCount" type="number"/);
  assert.match(adminJs, /name="NewConvertCount" type="number"/);
  assert.match(adminJs, /renderChurchAttendanceBreakdown/);
  assert.match(adminJs, /Age composition/);
  assert.match(adminJs, /Gender composition/);
  assert.match(adminJs, /Included response groups/);
  assert.match(adminJs, /Enter any two of Adults, Male and Female; the third is calculated automatically/);
  assert.match(adminJs, /setCalculatedAttendanceValue\('AdultCount', male \+ female\)/);
  assert.match(adminJs, /adults - male/);
  assert.match(adminJs, /adults - female/);
  assert.match(adminJs, /table\('Attendance Summary'/);
  assert.match(adminJs, /churchServiceAction\('recordAttendanceTotal', payload\)/);
  assert.match(adminJs, /id="churchAttendanceForm"/);
  assert.match(adminJs, /id="churchAttendanceForm" class="workflow-card compact-form church-service-entry-form"/);
  assert.match(adminJs, /churchServiceAction\('recordAttendance', payload\)/);
  assert.match(serviceApi, /recordChurchAttendanceTotal/);
  assert.match(serviceApi, /export async function completeServiceOccurrence/);
  assert.match(serviceApi, /This service occurrence is completed and locked\. It can no longer be edited\./);
  assert.match(serviceApi, /\['completeoccurrence', 'completechurchserviceoccurrence'\]/);
  assert.match(serviceApi, /normalizeAttendanceBreakdown\(incoming\)/);
  assert.match(serviceApi, /AttendanceCountRecordedAt/);
  assert.match(portalCss, /\.service-attendance-workspace\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(portalCss, /\.attendance-breakdown-fields\s*\{[\s\S]*?repeat\(3,/);
  assert.match(portalCss, /\.church-service-entry-grid\s*\{[\s\S]*?repeat\(3,/);
  assert.match(portalCss, /\.church-service-entry-grid input:not\(\[type="checkbox"\]\),[\s\S]*?width: 100%;[\s\S]*?height: 44px;/);
  assert.match(portalCss, /@media \(max-width: 900px\)[\s\S]*?\.church-service-entry-grid[\s\S]*?repeat\(2,/);
  assert.match(portalCss, /@media \(max-width: 560px\)[\s\S]*?\.church-service-entry-grid[\s\S]*?grid-template-columns: 1fr/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.attendance-total-field/);
  assert.match(portalCss, /@media \(max-width: 560px\)[\s\S]*?\.attendance-breakdown-fields[\s\S]*?repeat\(2,/);
});
