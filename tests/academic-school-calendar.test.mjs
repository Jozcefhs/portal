import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  normalizeSchoolCalendar, schoolCalendarDate, schoolCalendarDayIsOpen,
  schoolCalendarOpenDays, schoolCalendarSummary
} from '../functions/lib/academic-school-calendar.js';
import { academicTermAttendanceSummary } from '../functions/lib/academic-timetable-attendance.js';

const term = { StartDate: '2026-09-28', EndDate: '2026-10-05' };
const calendar = normalizeSchoolCalendar({
  OperatingWeekdays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  Exceptions: '2026-10-01 | Closed | National Day\n2026-10-03 | Open | Make-up school day'
}, term);

test('dated closures subtract and make-up open dates add to the term count', () => {
  assert.equal(schoolCalendarDayIsOpen(calendar, '2026-10-01'), false);
  assert.equal(schoolCalendarDayIsOpen(calendar, '2026-10-03'), true);
  assert.equal(schoolCalendarDayIsOpen(calendar, '2026-10-04'), false);
  assert.equal(schoolCalendarOpenDays(term, calendar), 6);
  assert.deepEqual(schoolCalendarSummary(term, calendar, '2026-10-03'), {
    Configured: true, PlannedOpenDays: 6, OpenDaysToDate: 5, ClosedDates: 1, AddedOpenDates: 1
  });
});

test('calendar rejects impossible, repeated, out-of-term and unexplained dates', () => {
  assert.throws(() => schoolCalendarDate('2026-02-29'), /real date/i);
  assert.equal(schoolCalendarDate('2028-02-29'), '2028-02-29');
  assert.throws(() => normalizeSchoolCalendar({ OperatingWeekdays: ['MON'], Exceptions: '2026-10-01 | Closed | One\n2026-10-01 | Open | Two' }, term), /more than once/i);
  assert.throws(() => normalizeSchoolCalendar({ OperatingWeekdays: ['MON'], Exceptions: '2026-10-06 | Closed | Late' }, term), /outside/i);
  assert.throws(() => normalizeSchoolCalendar({ OperatingWeekdays: ['MON'], Exceptions: '2026-10-01 | Closed |' }, term), /reason/i);
});

test('Daily attendance excludes closed dates and uses open days as denominator', () => {
  const membership = [{ StudentRef: 'S1', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', Status: 'Active' }];
  const attendance = [
    { StudentRef: 'S1', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', Mode: 'Daily', AttendanceDate: '2026-09-28', Status: 'Present' },
    { StudentRef: 'S1', SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', Mode: 'Daily', AttendanceDate: '2026-10-01', Status: 'Present' }
  ];
  const [row] = academicTermAttendanceSummary(attendance, membership, {
    SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: 'a1', Mode: 'Daily', SchoolCalendar: calendar,
    TermDates: term, AsOfDate: '2026-10-03'
  });
  assert.equal(row.Total, 1);
  assert.equal(row.SchoolDaysOpen, 5);
  assert.equal(row.AttendancePercentage, 20);
});

test('calendar controls are available in web and desktop and attendance writes are guarded', async () => {
  const [backend, web, desktop] = await Promise.all([
    readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../../suite/modules/academic_management.py', import.meta.url), 'utf8')
  ]);
  assert.match(backend, /saveAcademicSchoolCalendar/);
  assert.match(backend, /ACADEMIC_SCHOOL_CLOSED/);
  assert.match(web, /data-academic-school-calendar/);
  assert.match(web, /Make-up open dates are optional/);
  assert.doesNotMatch(web, /placeholder="2026-10-01 \| Closed/);
  assert.match(desktop, /School Calendar/);
});
