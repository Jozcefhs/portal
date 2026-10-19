import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addAttendanceDays, attendanceGroupFor, attendanceLocalDate, attendanceShiftForDate,
  normalizeAttendanceGroup, resolveAttendanceShift
} from '../functions/lib/staff-attendance-schedules.js';

const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const policy = { TimeZone: 'Africa/Lagos', WorkDays: days.slice(0, 5), ResumptionTime: '08:00', ClosingTime: '17:00', GraceMinutes: 15, ClockInOpenMinutesBefore: 60, OvertimeMinimumMinutes: 15, Active: 'YES' };
const off = () => ({ Enabled: false, ResumptionTime: '08:00', ClosingTime: '17:00', EndDayOffset: 0 });
const duty = (start = '08:00', end = '17:00', offset = 0) => ({ Enabled: true, ResumptionTime: start, ClosingTime: end, EndDayOffset: offset });
const weekly = (overrides = {}) => Object.fromEntries(days.map((day) => [day, overrides[day] || off()]));
function fixed(overrides = {}) {
  return normalizeAttendanceGroup({ GroupId: 'nurses', Name: 'Nurses', ScheduleType: 'FIXED', EffectiveFrom: '2026-10-01', DaySchedules: weekly({ MON: duty('20:00', '08:00', 1), WED: duty('20:00', '08:00', 1) }), ...overrides }, {}, policy);
}
function rotating(overrides = {}) {
  return normalizeAttendanceGroup({ GroupId: 'security', Name: 'Security 24 on / 48 off', ScheduleType: 'ROTATING', EffectiveFrom: '2026-10-01', AnchorDate: '2026-10-01', CycleDays: [duty('08:00', '08:00', 1), off(), off()], ...overrides }, {}, policy);
}
function roster(group, assignments = [{ Username: 'nurse.one', GroupId: group.GroupId, EffectiveFrom: '2026-10-01' }]) {
  return { Revision: 1, Groups: [group], Assignments: assignments };
}

test('fixed groups normalize separate weekdays and inherited timing allowances', () => {
  const group = fixed();
  assert.equal(group.DaySchedules.MON.EndDayOffset, 1);
  assert.equal(group.DaySchedules.TUE.Enabled, false);
  assert.equal(group.GraceMinutes, 15);
  assert.deepEqual(group.CycleDays, []);
  assert.equal(group.AnchorDate, '');
  const changed = normalizeAttendanceGroup({ Name: 'Ward nurses', DaySchedules: { MON: { ClosingTime: '09:00' } }, GraceMinutes: 0 }, group, policy);
  assert.equal(changed.DaySchedules.MON.ResumptionTime, '20:00');
  assert.equal(changed.DaySchedules.MON.ClosingTime, '09:00');
  assert.equal(changed.DaySchedules.WED.Enabled, true);
  assert.equal(changed.GraceMinutes, 0);
  assert.equal(group.DaySchedules.MON.ClosingTime, '08:00');
});

test('all editions use the same default schedule until staff are assigned', () => {
  for (const Edition of ['School', 'Faith', 'Organisation']) {
    const shift = attendanceShiftForDate({ ...policy, Edition }, {}, 'staff', '2026-10-12');
    assert.equal(shift.GroupId, '');
    assert.equal(shift.StartAt, '2026-10-12T07:00:00.000Z');
    assert.equal(shift.EndAt, '2026-10-12T16:00:00.000Z');
    assert.equal(attendanceShiftForDate({ ...policy, Edition }, {}, 'staff', '2026-10-11'), null);
  }
});

test('assigned group can be active while the unused default policy is inactive', () => {
  const inactive = { ...policy, Active: 'NO' };
  assert.equal(attendanceShiftForDate(inactive, {}, 'other', '2026-10-12').Active, 'NO');
  assert.equal(attendanceShiftForDate(inactive, roster(fixed()), 'nurse.one', '2026-10-12').Active, 'YES');
});

test('default policy per-day overrides are preserved', () => {
  const branch = { ...policy, DaySchedules: { MON: duty('09:30', '14:00'), SAT: duty('10:00', '12:00') } };
  assert.equal(attendanceShiftForDate(branch, {}, 'staff', '2026-10-12').StartAt, '2026-10-12T08:30:00.000Z');
  assert.equal(attendanceShiftForDate(branch, {}, 'staff', '2026-10-10').StartAt, '2026-10-10T09:00:00.000Z');
});

test('assignment history is case-insensitive and allows an effective return to default', () => {
  const group = fixed();
  const state = roster(group, [
    { Username: 'Nurse.One', GroupId: '', EffectiveFrom: '2026-10-20' },
    { Username: 'Nurse.One', GroupId: 'nurses', EffectiveFrom: '2026-10-12' }
  ]);
  assert.equal(attendanceGroupFor(state, ' nurse.ONE ', '2026-10-11'), null);
  assert.equal(attendanceGroupFor(state, 'NURSE.ONE', '2026-10-12').GroupId, 'nurses');
  assert.equal(attendanceGroupFor(state, 'nurse.one', '2026-10-13').GroupId, 'nurses');
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-13'), null);
  assert.equal(attendanceGroupFor(state, 'nurse.one', '2026-10-20'), null);
});

test('unknown assigned group fails closed instead of falling back to general hours', () => {
  assert.throws(() => attendanceShiftForDate(policy, { Groups: [], Assignments: [{ Username: 'staff', GroupId: 'missing', EffectiveFrom: '2026-01-01' }] }, 'staff', '2026-10-12'), (error) => error.status === 409);
});

test('group effective date prevents retroactive assigned shifts', () => {
  const group = fixed({ EffectiveFrom: '2026-10-15' });
  assert.equal(attendanceGroupFor(roster(group), 'nurse.one', '2026-10-12').GroupId, 'nurses');
  assert.equal(attendanceShiftForDate(policy, roster(group), 'nurse.one', '2026-10-12'), null);
});

test('date-specific group history preserves previous hours and names after schedule edits', () => {
  const original = fixed({ EffectiveFrom: '2026-10-01', Name: 'Old nurses', GraceMinutes: 5 });
  const middle = fixed({ EffectiveFrom: '2026-10-13', Name: 'Middle nurses', GraceMinutes: 10,
    DaySchedules: weekly({ WED: duty('19:00', '06:00', 1) }) });
  const current = fixed({ EffectiveFrom: '2026-10-16', Name: 'Current nurses', GraceMinutes: 20,
    DaySchedules: weekly({ MON: duty('08:00', '16:00') }) });
  const state = roster({ ...current, History: [middle, original] });
  const previous = attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-12');
  assert.equal(previous.GroupName, 'Old nurses');
  assert.equal(previous.GraceMinutes, 5);
  assert.equal(previous.StartAt, '2026-10-12T19:00:00.000Z');
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-14').GroupName, 'Middle nurses');
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-19').GroupName, 'Current nurses');
  assert.equal(attendanceGroupFor(state, 'nurse.one', '2026-10-12').History, undefined);
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-09-28')?.GroupId || '', '');
});

test('current definition wins ties and earlier rotating patterns retain their anchor', () => {
  const previous = rotating({ EffectiveFrom: '2026-10-01' });
  const current = fixed({ EffectiveFrom: '2026-10-10', DaySchedules: weekly({ FRI: duty() }) });
  const state = roster({ ...current, GroupId: previous.GroupId, History: [previous, { ...current, Name: 'Superseded same-day edit' }] });
  assert.equal(attendanceGroupFor(state, 'nurse.one', '2026-10-10').Name, 'Nurses');
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-07').ScheduleType, 'ROTATING');
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-08'), null);
});

test('overnight duty stays on its starting attendance date across midnight', () => {
  const state = roster(fixed());
  const shift = resolveAttendanceShift(policy, state, 'nurse.one', '2026-10-13T03:30:00Z');
  assert.equal(shift.AttendanceDate, '2026-10-12');
  assert.equal(shift.StartAt, '2026-10-12T19:00:00.000Z');
  assert.equal(shift.EndAt, '2026-10-13T07:00:00.000Z');
  assert.equal(resolveAttendanceShift(policy, state, 'nurse.one', '2026-10-13T08:30:00Z'), null);
});

test('rotating 24 on / 48 off repeats without absences on rest days', () => {
  const group = rotating();
  const state = roster(group);
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-01').EndAt, '2026-10-02T07:00:00.000Z');
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-02'), null);
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-03'), null);
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-04').StartAt, '2026-10-04T07:00:00.000Z');
  assert.equal(resolveAttendanceShift(policy, state, 'nurse.one', '2026-10-02T06:59:00Z').AttendanceDate, '2026-10-01');
  assert.equal(resolveAttendanceShift(policy, state, 'nurse.one', '2026-10-02T07:00:00Z'), null);
});

test('cycle anchor supports positive and negative offsets independently of effective date', () => {
  const group = rotating({ EffectiveFrom: '2026-09-01', AnchorDate: '2026-10-04' });
  const state = roster(group, [{ Username: 'nurse.one', GroupId: group.GroupId, EffectiveFrom: '2026-09-01' }]);
  assert.ok(attendanceShiftForDate(policy, state, 'nurse.one', '2026-10-01'));
  assert.equal(attendanceShiftForDate(policy, state, 'nurse.one', '2026-09-30'), null);
});

test('48-hour shifts resolve from two calendar days earlier', () => {
  const group = rotating({ CycleDays: [duty('08:00', '08:00', 2), off(), off(), off()] });
  const shift = resolveAttendanceShift(policy, roster(group), 'nurse.one', '2026-10-03T06:30:00Z');
  assert.equal(shift.AttendanceDate, '2026-10-01');
  assert.equal(shift.EndDayOffset, 2);
});

test('early opening can select tomorrow across midnight but never a distant future rest-day duty', () => {
  const group = rotating({ CycleDays: [duty('00:30', '08:00'), off(), off()], ClockInOpenMinutesBefore: 120 });
  const state = roster(group);
  assert.equal(resolveAttendanceShift(policy, state, 'nurse.one', '2026-10-03T21:00:00Z'), null);
  assert.equal(resolveAttendanceShift(policy, state, 'nurse.one', '2026-10-03T21:30:00Z').AttendanceDate, '2026-10-04');
});

test('ongoing shift wins over next duty opening window at a handover', () => {
  const group = rotating({ CycleDays: [duty('08:00', '08:00', 1)] });
  const state = roster(group);
  assert.equal(resolveAttendanceShift(policy, state, 'nurse.one', '2026-10-02T06:30:00Z').AttendanceDate, '2026-10-01');
  assert.equal(resolveAttendanceShift(policy, state, 'nurse.one', '2026-10-02T07:00:00Z').AttendanceDate, '2026-10-02');
});

test('invalid schedules, times, dates, bounds and all-off patterns are rejected', () => {
  for (const changes of [
    { Name: '' }, { GroupId: '../bad' }, { ScheduleType: 'RANDOM' }, { EffectiveFrom: '2026-02-30' },
    { DaySchedules: [] }, { DaySchedules: weekly() }, { DaySchedules: weekly({ MON: duty('25:00', '08:00', 1) }) },
    { DaySchedules: weekly({ MON: duty('20:00', '08:00') }) }, { DaySchedules: weekly({ MON: duty('08:00', '09:00', 2) }) },
    { DaySchedules: weekly({ MON: duty('08:00', '08:00', -1) }) }, { GraceMinutes: 181 }, { ClockInOpenMinutesBefore: 361 }, { OvertimeMinimumMinutes: 1.5 }
  ]) assert.throws(() => fixed(changes), changes.Name || JSON.stringify(changes));
  for (const changes of [{ AnchorDate: '' }, { CycleDays: [] }, { CycleDays: [off()] }, { CycleDays: Array.from({ length: 63 }, off) }, { CycleDays: 'invalid' }]) {
    assert.throws(() => rotating(changes));
  }
  assert.throws(() => normalizeAttendanceGroup(fixed(), {}, { TimeZone: 'Unknown/Nowhere' }), /time zone/);
});

test('overlap is rejected within and across weekly and rotating cycle boundaries', () => {
  assert.throws(() => fixed({ DaySchedules: weekly({ MON: duty('20:00', '09:00', 1), TUE: duty('08:00', '17:00') }) }), /overlap/);
  assert.throws(() => fixed({ DaySchedules: weekly({ SUN: duty('20:00', '09:00', 1), MON: duty('08:00', '17:00') }) }), /overlap/);
  assert.throws(() => rotating({ CycleDays: [duty('08:00', '08:00', 2)] }), /overlap/);
  assert.throws(() => rotating({ CycleDays: [duty('08:00', '17:00'), duty('20:00', '09:00', 1)] }), /overlap/);
  assert.doesNotThrow(() => fixed({ DaySchedules: weekly({ SUN: duty('20:00', '08:00', 1), MON: duty('08:00', '17:00') }) }));
});

test('date utilities respect branch timezone, fractional offsets and leap days', () => {
  assert.equal(attendanceLocalDate('2026-10-01T23:30:00Z', 'Africa/Lagos'), '2026-10-02');
  assert.equal(attendanceLocalDate('2026-10-01T19:00:00Z', 'Asia/Kathmandu'), '2026-10-02');
  assert.equal(addAttendanceDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addAttendanceDays('2028-03-01', -1), '2028-02-29');
  assert.throws(() => addAttendanceDays('2026-02-30', 1));
  assert.throws(() => addAttendanceDays('2026-10-01', 1.2));
  assert.throws(() => attendanceLocalDate('not-a-date', 'Africa/Lagos'));
  const shift = attendanceShiftForDate({ ...policy, TimeZone: 'Asia/Kathmandu' }, {}, 'staff', '2026-10-12');
  assert.equal(shift.StartAt, '2026-10-12T02:15:00.000Z');
});

test('DST transitions use actual elapsed time and reject nonexistent configured instants', () => {
  const london = { ...policy, TimeZone: 'Europe/London' };
  const group = fixed({ EffectiveFrom: '2026-01-01', DaySchedules: weekly({ SUN: duty('00:00', '08:00') }) });
  const state = roster(group, [{ Username: 'nurse.one', GroupId: 'nurses', EffectiveFrom: '2026-01-01' }]);
  const spring = attendanceShiftForDate(london, state, 'nurse.one', '2026-03-29');
  const autumn = attendanceShiftForDate(london, state, 'nurse.one', '2026-10-25');
  assert.equal((Date.parse(spring.EndAt) - Date.parse(spring.StartAt)) / 3600000, 7);
  assert.equal((Date.parse(autumn.EndAt) - Date.parse(autumn.StartAt)) / 3600000, 9);
  const gap = fixed({ EffectiveFrom: '2026-01-01', DaySchedules: weekly({ SUN: duty('01:30', '08:00') }) });
  const gapState = roster(gap, state.Assignments);
  assert.throws(() => attendanceShiftForDate(london, gapState, 'nurse.one', '2026-03-29'), (error) => error.code === 'ATTENDANCE_LOCAL_TIME_GAP');
  assert.equal(attendanceShiftForDate(london, gapState, 'nurse.one', '2026-10-25').StartAt, '2026-10-25T00:30:00.000Z');
});

test('a future DST gap does not prevent working a valid current shift', () => {
  const group = fixed({ EffectiveFrom: '2026-01-01', DaySchedules: weekly({ SAT: duty('08:00', '17:00'), SUN: duty('01:30', '08:00') }) });
  const state = roster(group, [{ Username: 'nurse.one', GroupId: 'nurses', EffectiveFrom: '2026-01-01' }]);
  assert.equal(resolveAttendanceShift({ ...policy, TimeZone: 'Europe/London' }, state, 'nurse.one', '2026-03-28T10:00:00Z').AttendanceDate, '2026-03-28');
  assert.throws(() => resolveAttendanceShift({ ...policy, TimeZone: 'Europe/London' }, state, 'nurse.one', '2026-03-29T10:00:00Z'), /does not exist/);
});
