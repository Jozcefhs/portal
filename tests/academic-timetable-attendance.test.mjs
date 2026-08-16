import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  academicAttendanceSummary,
  academicTimetableConflicts,
  academicTimetablePeriodCodes,
  academicTimetablePeriodsForDay,
  normalizeAcademicAttendanceEntries,
  normalizeAcademicTimetableDays,
  normalizeAcademicTimetableEntry,
  normalizeAcademicTimetablePeriods
} from '../functions/lib/academic-timetable-attendance.js';
import { academicManagementCapabilities } from '../functions/lib/academic-management.js';

const source = await readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const adminHtml = await readFile(new URL('../admin.html', import.meta.url), 'utf8');
const portalCss = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const parentApi = await readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8');
const parentDashboard = await readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8');
const parentHtml = await readFile(new URL('../parent-dashboard.html', import.meta.url), 'utf8');

const timetableDays = normalizeAcademicTimetableDays('MON | Monday\nTUE | Tuesday');
const settings = {
  Days: timetableDays,
  Periods: normalizeAcademicTimetablePeriods([
    { PeriodCode: 'P1', Name: 'Period 1', StartTime: '08:00', EndTime: '08:40', Kind: 'Lesson' },
    { PeriodCode: 'P2', Name: 'Period 2', StartTime: '08:40', EndTime: '09:20', Kind: 'Lesson' },
    { PeriodCode: 'BRK', Name: 'Break', StartTime: '09:20', EndTime: '09:40', Kind: 'Break' },
    { PeriodCode: 'P3', Name: 'Period 3', StartTime: '09:40', EndTime: '10:20', Kind: 'Lesson' }
  ], timetableDays)
};

test('timetable configuration validates unique days, ordered periods and break boundaries', () => {
  assert.deepEqual(settings.Days.map((row) => row.DayCode), ['MON', 'TUE']);
  assert.deepEqual(academicTimetablePeriodCodes(settings, 'P1', 2), ['P1', 'P2']);
  assert.throws(() => academicTimetablePeriodCodes(settings, 'P2', 2), /cannot cross a break/i);
  assert.throws(() => normalizeAcademicTimetableDays('MON | Monday\nMON | Another Monday'), /repeated/i);
  assert.throws(() => normalizeAcademicTimetablePeriods([
    { PeriodCode: 'P1', Name: 'One', StartTime: '08:00', EndTime: '09:00' },
    { PeriodCode: 'P2', Name: 'Two', StartTime: '08:30', EndTime: '09:30' }
  ]), /overlaps/i);
});

test('default periods support per-day time overrides without duplicating the weekly timetable', () => {
  const dailySettings = {
    Days: timetableDays,
    Periods: normalizeAcademicTimetablePeriods([
      { DayCodes: ['ALL'], PeriodCode: 'P1', Name: 'Period 1', StartTime: '08:00', EndTime: '08:40', Kind: 'Lesson', SortOrder: 1 },
      { DayCodes: ['ALL'], PeriodCode: 'P2', Name: 'Period 2', StartTime: '08:40', EndTime: '09:20', Kind: 'Lesson', SortOrder: 2 },
      { DayCodes: ['MON'], PeriodCode: 'P1', Name: 'Period 1', StartTime: '08:20', EndTime: '09:00', Kind: 'Lesson', SortOrder: 1 },
      { DayCodes: ['MON'], PeriodCode: 'P2', Name: 'Period 2', StartTime: '09:00', EndTime: '09:40', Kind: 'Lesson', SortOrder: 2 }
    ], timetableDays)
  };
  assert.deepEqual(academicTimetablePeriodsForDay(dailySettings, 'MON').map((row) => row.StartTime), ['08:20', '09:00']);
  assert.deepEqual(academicTimetablePeriodsForDay(dailySettings, 'TUE').map((row) => row.StartTime), ['08:00', '08:40']);
  assert.deepEqual(academicTimetablePeriodCodes(dailySettings, 'P1', 2, 'MON'), ['P1', 'P2']);
  assert.equal(normalizeAcademicTimetableEntry({
    DayCode: 'MON', StartPeriodCode: 'P1', DurationPeriods: 1,
    ClassId: 'class-10', ArmId: 'arm-a', SubjectId: 'math', TeacherUsername: 'teacher-a'
  }, dailySettings).PeriodCodes[0], 'P1');
  assert.throws(() => normalizeAcademicTimetablePeriods(
    'FRI | P1 | Period 1 | 08:00 | 08:40 | Lesson | 1', timetableDays
  ), /not a configured school day/i);
});

test('timetable entries occupy exact periods and detect classroom, teacher and room conflicts', () => {
  const candidate = {
    ...normalizeAcademicTimetableEntry({
      DayCode: 'MON', StartPeriodCode: 'P1', DurationPeriods: 2,
      ClassId: 'class-10', ArmId: 'arm-a', SubjectId: 'math', TeacherUsername: 'teacher-a', Room: 'Lab 1'
    }, settings),
    EntryId: 'new', VersionId: 'version-1'
  };
  assert.deepEqual(candidate.PeriodCodes, ['P1', 'P2']);
  const conflicts = academicTimetableConflicts(candidate, [
    { EntryId: 'one', VersionId: 'version-1', DayCode: 'MON', PeriodCodes: ['P2'], ClassId: 'class-10', ArmId: 'arm-a', TeacherUsername: 'teacher-b', Room: 'Room 1' },
    { EntryId: 'two', VersionId: 'version-1', DayCode: 'MON', PeriodCodes: ['P1'], ClassId: 'class-11', ArmId: 'arm-b', TeacherUsername: 'teacher-a', Room: 'Lab 1' }
  ]);
  assert.deepEqual(conflicts.map((row) => row.Type).sort(), ['Classroom', 'Room', 'Teacher']);
});

test('attendance entries remain classroom-scoped and provide status totals', () => {
  const rows = normalizeAcademicAttendanceEntries([
    { StudentRef: 'S-1', Status: 'Present' },
    { StudentRef: 'S-2', Status: 'Late', MinutesLate: 12 },
    { StudentRef: 'S-3', Status: 'Absent' }
  ], ['S-1', 'S-2', 'S-3']);
  assert.deepEqual(academicAttendanceSummary(rows), {
    Present: 1, Absent: 1, Late: 1, Excused: 0, LeftEarly: 0, Total: 3
  });
  assert.throws(() => normalizeAcademicAttendanceEntries([{ StudentRef: 'OTHER', Status: 'Present' }], ['S-1']), /not in this classroom/i);
  assert.throws(() => normalizeAcademicAttendanceEntries([{ StudentRef: 'S-1', Status: 'Unknown' }], ['S-1']), /invalid status/i);
});

test('academic roles separate timetable publishing from allocated attendance marking', () => {
  const principal = academicManagementCapabilities({ edition: 'school', role: 'Principal', allowedSections: ['academics'] });
  const teacher = academicManagementCapabilities({ edition: 'school', role: 'Teacher', allowedSections: ['academics'] });
  assert.equal(principal.canManageTimetables, true);
  assert.equal(principal.canPublishTimetables, true);
  assert.equal(teacher.canManageTimetables, false);
  assert.equal(teacher.canPublishTimetables, false);
  assert.equal(teacher.canMarkAttendance, true);
});

test('timetable publication and attendance corrections use protected audited workflows', () => {
  for (const action of [
    'saveAcademicTimetableSettings', 'createAcademicTimetableVersion', 'saveAcademicTimetableEntry',
    'changeAcademicTimetableVersionStatus', 'saveAcademicStudentAttendance', 'decideAcademicAttendanceCorrection'
  ]) assert.match(source, new RegExp(`export async function ${action}`));
  assert.match(source, /ACADEMIC_TIMETABLE_CONFLICT/);
  assert.match(source, /Only an allocated form, assistant or subject teacher may mark this register/);
  assert.match(source, /REQUEST_CORRECTION/);
  assert.match(source, /APPROVE_CORRECTION/);
  assert.match(source, /AttendanceRevision/);
  assert.match(source, /Enter the reason for withdrawing this timetable/);
});

test('staff workspace exposes focused timetable and attendance interfaces', () => {
  assert.match(adminSource, /\['timetable', 'Timetable'\]/);
  assert.match(adminSource, /\['attendance', 'Attendance'\]/);
  assert.match(adminSource, /data-academic-timetable-settings/);
  assert.match(adminSource, /Day\(s\) \| Code \| Name \| Start \| End/);
  assert.match(adminSource, /data-academic-timetable-day/);
  assert.match(adminSource, /data-academic-timetable-entry/);
  assert.match(adminSource, /data-academic-timetable-status/);
  assert.match(adminSource, /data-academic-timetable-open-version/);
  assert.match(adminSource, /The server rejects overlapping classrooms, teachers or rooms/);
  assert.match(adminSource, /data-academic-attendance-register/);
  assert.match(adminSource, /data-academic-attendance-all="Present"/);
  assert.match(adminSource, /data-academic-attendance-decision/);
  assert.match(adminSource, /All students start as Present/);
  assert.match(adminHtml, /js\/admin\.js\?v=20260816-day-specific-timetable/);
  assert.match(portalCss, /\.academic-attendance-table\{max-height:480px;overflow:auto/);
});

test('parents receive only the published class schedule and their linked child attendance summary', () => {
  assert.match(parentApi, /queryRowsForReferences\(env, 'academicStudentAttendance', \['StudentRef'\], keys\)/);
  assert.match(parentApi, /lower\(row\.Status\) === 'published'/);
  assert.match(parentApi, /row\.ClassId === currentMembership\.ClassId && row\.ArmId === currentMembership\.ArmId/);
  assert.match(parentApi, /academicAttendanceSummary/);
  assert.match(parentApi, /DayName:/);
  assert.match(parentApi, /academicTimetablePeriodsForDay\(publishedVersion, row\.DayCode\)/);
  assert.match(parentDashboard, /function renderAcademicSchedule/);
  assert.match(parentDashboard, /function renderAcademicAttendance/);
  assert.match(parentHtml, /data-dashboard-target="academics"/);
  assert.match(parentHtml, /id="parentAcademicSchedule"/);
  assert.match(parentHtml, /id="parentAcademicAttendance"/);
});
