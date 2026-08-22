import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  academicAttendanceSummary,
  academicTermAttendanceSummary,
  academicTeacherLoadIssues,
  academicTimetableConflicts,
  academicTimetablePeriodCodes,
  academicTimetablePeriodsForDay,
  normalizeAcademicAttendanceEntries,
  normalizeAcademicTeacherUnavailableSlots,
  normalizeAcademicTimetableDays,
  normalizeAcademicTimetableEntry,
  normalizeAcademicTimetablePeriods
} from '../functions/lib/academic-timetable-attendance.js';
import { academicManagementCapabilities, academicTimetableTargetCopyPlan } from '../functions/lib/academic-management.js';

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

test('teacher availability and workload limits use exact lesson periods', () => {
  const constraint = {
    Status: 'Active', MaxPeriodsPerDay: 2, MaxPeriodsPerWeek: 4,
    UnavailableSlots: normalizeAcademicTeacherUnavailableSlots('MON | P1\nTUE | P2', settings)
  };
  assert.deepEqual(constraint.UnavailableSlots, ['MON:P1', 'TUE:P2']);
  const candidate = {
    ...normalizeAcademicTimetableEntry({
      DayCode: 'MON', StartPeriodCode: 'P1', DurationPeriods: 1,
      ClassId: 'class-10', ArmId: 'arm-a', SubjectId: 'math', TeacherUsername: 'teacher-a'
    }, settings), EntryId: 'candidate', VersionId: 'version-1'
  };
  assert.equal(academicTeacherLoadIssues(candidate, [], constraint)[0].Type, 'Availability');
  const availableCandidate = { ...candidate, DayCode: 'TUE', StartPeriodCode: 'P1', PeriodCodes: ['P1'] };
  const loadIssues = academicTeacherLoadIssues(availableCandidate, [
    { EntryId: 'one', VersionId: 'version-1', DayCode: 'TUE', PeriodCodes: ['P3', 'P4'], TeacherUsername: 'teacher-a' }
  ], constraint);
  assert.equal(loadIssues.find((row) => row.Type === 'DailyLoad')?.Actual, 3);
  assert.throws(() => normalizeAcademicTeacherUnavailableSlots('FRI | P1', settings), /unconfigured school day/i);
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

test('term attendance summaries keep register modes explicit and calculate promotion-ready percentages', () => {
  const memberships = [
    { StudentRef: 'S-1', SessionId: '2026', TermId: 'term-1', ClassId: 'class-10', ArmId: 'arm-a', Status: 'Active' },
    { StudentRef: 'S-2', SessionId: '2026', TermId: 'term-1', ClassId: 'class-10', ArmId: 'arm-a', Status: 'Active' }
  ];
  const attendance = [
    { StudentRef: 'S-1', SessionId: '2026', TermId: 'term-1', ClassId: 'class-10', ArmId: 'arm-a', Mode: 'Daily', Status: 'Present' },
    { StudentRef: 'S-1', SessionId: '2026', TermId: 'term-1', ClassId: 'class-10', ArmId: 'arm-a', Mode: 'Daily', Status: 'Late' },
    { StudentRef: 'S-1', SessionId: '2026', TermId: 'term-1', ClassId: 'class-10', ArmId: 'arm-a', Mode: 'Daily', Status: 'Absent' },
    { StudentRef: 'S-1', SessionId: '2026', TermId: 'term-1', ClassId: 'class-10', ArmId: 'arm-a', Mode: 'Period', Status: 'Absent' }
  ];
  const summary = academicTermAttendanceSummary(attendance, memberships, {
    SessionId: '2026', TermId: 'term-1', ClassId: 'class-10', ArmId: 'arm-a', Mode: 'Daily'
  });
  assert.equal(summary[0].AttendancePercentage, 66.7);
  assert.equal(summary[0].Total, 3);
  assert.equal(summary[1].Total, 0);
});

test('targeted timetable copying maps one classroom into a draft and previews allocation failures', () => {
  const sourceVersion = { VersionId: 'source', Name: 'Source', Status: 'Published', SessionId: '2025', TermId: 'old-term', ...settings };
  const targetVersion = { VersionId: 'target', Name: 'Target', Status: 'Draft', SessionId: '2026', TermId: 'term-1', ...settings };
  const state = {
    classes: [{ ClassId: 'class-10', Status: 'Active' }, { ClassId: 'class-11', Status: 'Active' }],
    arms: [{ ArmId: 'arm-a', ClassId: 'class-10', Status: 'Active' }, { ArmId: 'arm-b', ClassId: 'class-11', Status: 'Active' }],
    timetableVersions: [sourceVersion, targetVersion], timetableConstraints: [],
    timetableEntries: [{
      EntryId: 'lesson-1', VersionId: 'source', SessionId: '2025', TermId: 'old-term',
      DayCode: 'MON', StartPeriodCode: 'P1', DurationPeriods: 1, PeriodCodes: ['P1'],
      ClassId: 'class-10', ArmId: 'arm-a', SubjectId: 'math', TeacherUsername: 'teacher-a', Status: 'Active'
    }],
    teacherAllocations: [{
      AllocationId: 'allocation-1', SessionId: '2026', TermId: 'term-1', ClassId: 'class-11', ArmId: 'arm-b',
      SubjectId: 'math', TeacherUsername: 'teacher-a', AllocationRole: 'Subject Teacher', Status: 'Active'
    }]
  };
  const input = { SourceVersionId: 'source', TargetVersionId: 'target', SourceClassId: 'class-10', SourceArmId: 'arm-a', TargetClassId: 'class-11', TargetArmId: 'arm-b' };
  const context = { session: { SessionId: '2026' }, term: { TermId: 'term-1' }, scope: { branchId: 'main', section: 'secondary' } };
  const plan = academicTimetableTargetCopyPlan(state, input, context);
  assert.equal(plan.NewCount, 1);
  assert.equal(plan.Issues.length, 0);
  state.teacherAllocations = [];
  assert.match(academicTimetableTargetCopyPlan(state, input, context).Issues[0].Message, /allocation is not active/i);
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
    'saveAcademicTimetableConstraint', 'copyAcademicTimetableVersion', 'changeAcademicTimetableVersionStatus',
    'previewAcademicTimetableCopy', 'copyAcademicTimetableSelection',
    'saveAcademicTimetableSubstitution', 'cancelAcademicTimetableSubstitution',
    'saveAcademicStudentAttendance', 'decideAcademicAttendanceCorrection'
  ]) assert.match(source, new RegExp(`export async function ${action}`));
  assert.match(source, /ACADEMIC_TIMETABLE_CONFLICT/);
  assert.match(source, /ACADEMIC_TEACHER_UNAVAILABLE/);
  assert.match(source, /status: 'Copying'/i);
  assert.match(source, /offset \+= 450/);
  assert.match(source, /Only an allocated form, assistant or subject teacher may mark this register/);
  assert.match(source, /REQUEST_CORRECTION/);
  assert.match(source, /APPROVE_CORRECTION/);
  assert.match(source, /AttendanceRevision/);
  assert.match(source, /academicTimetableSubstitutions/);
  assert.match(source, /academic-absence:/);
  assert.match(source, /TargetAccountRefs: contacts\.accountRefs/);
  assert.match(source, /The substitute teacher already has another substitution during this period/);
  assert.match(source, /substituteClassrooms\.forEach\(\(row\) => visibleKeys\.add/);
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
  assert.match(adminSource, /data-academic-timetable-constraint/);
  assert.match(adminSource, /form\.academic-management-editor-wide/);
  assert.match(adminSource, /academic-management-form-grid academic-timetable-constraint-grid/);
  assert.match(adminSource, /data-academic-timetable-copy/);
  assert.match(adminSource, /data-academic-timetable-target-copy/);
  assert.match(adminSource, /data-academic-timetable-copy-preview/);
  assert.match(adminSource, /data-academic-timetable-substitution/);
  assert.match(adminSource, /data-academic-timetable-print="class"/);
  assert.match(adminSource, /Print-ready schedules/);
  assert.match(adminSource, /data-academic-timetable-open-version/);
  assert.match(adminSource, /The server rejects overlapping classrooms, teachers or rooms/);
  assert.match(adminSource, /data-academic-attendance-register/);
  assert.match(adminSource, /data-academic-attendance-all="Present"/);
  assert.match(adminSource, /data-academic-attendance-decision/);
  assert.match(adminSource, /ACADEMIC_ATTENDANCE_DRAFT_PREFIX/);
  assert.match(adminSource, /data-academic-attendance-save-draft/);
  assert.match(adminSource, /data-academic-attendance-report/);
  assert.match(adminSource, /printAcademicAttendanceReport/);
  assert.match(adminSource, /All students start as Present/);
  assert.match(adminHtml, /js\/admin\.js\?v=20260822-cbt-score-commit-imprest-report-preview/);
  assert.match(portalCss, /\.academic-attendance-table\{max-height:480px;overflow:auto/);
  assert.match(portalCss, /\.academic-attendance-table th\{[^}]*white-space:nowrap;overflow-wrap:normal;word-break:normal/);
  assert.match(portalCss, /\.academic-attendance-report \.academic-attendance-table td:first-child\{font-size:12px;line-height:1\.3\}/);
  assert.match(portalCss, /\.academic-attendance-register \.academic-attendance-table td:first-child\{font-size:12px;line-height:1\.25\}/);
  assert.match(portalCss, /\.academic-management-editor>button\{width:fit-content;max-width:100%;margin:1px 0 0\}/);
  assert.match(portalCss, /\.academic-timetable-constraint-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(portalCss, /\.academic-attendance-draft-bar\{/);
  assert.match(portalCss, /\.academic-timetable-copy-preview\{/);
  assert.match(portalCss, /\[data-academic-timetable-constraint-clear\]\{flex:0 0 auto;min-width:max-content;white-space:nowrap\}/);
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
