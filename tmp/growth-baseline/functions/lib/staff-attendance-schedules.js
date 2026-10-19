const DAY_KEYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
const MINUTE = 60000;
const DAY = 86400000;
const clean = (value) => String(value ?? '').trim();

function fail(message, status = 400, code = '') {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  throw error;
}

function enabled(value, fallback = true) {
  if (value === undefined || value === null || clean(value) === '') return fallback;
  return !['no', 'false', '0', 'inactive', 'disabled', 'off'].includes(clean(value).toLowerCase());
}

function dateValue(value, label = 'attendance date') {
  const date = clean(value);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    fail(`Enter a valid ${label}.`);
  }
  return date;
}

function wholeNumber(value, fallback, maximum, label) {
  const number = value === undefined || value === null || clean(value) === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maximum) fail(`${label} must be a whole number between 0 and ${maximum}.`);
  return number;
}

function timeMinutes(value, label) {
  const match = clean(value).match(/^(\d{2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) fail(`Enter a valid ${label} in 24-hour time.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function dateFormatter(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
  } catch (_error) {
    fail('Enter a valid attendance time zone, for example Africa/Lagos.');
  }
}

function localParts(timestamp, formatter) {
  const instant = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(instant.getTime())) fail('Enter a valid attendance time.');
  const parts = Object.fromEntries(formatter.formatToParts(instant)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, second: parts.second };
}

export function attendanceLocalDate(timestamp, timeZone = 'Africa/Lagos') {
  return localParts(timestamp, dateFormatter(timeZone)).date;
}

export function addAttendanceDays(date, delta) {
  dateValue(date);
  if (!Number.isInteger(delta)) fail('Attendance day offset must be a whole number.');
  const shifted = new Date(new Date(`${date}T00:00:00Z`).getTime() + delta * DAY);
  if (Number.isNaN(shifted.getTime()) || shifted.toISOString().length !== 24) fail('Attendance day offset is outside the supported date range.');
  return shifted.toISOString().slice(0, 10);
}

function dayKey(date) {
  return DAY_KEYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
}

function normalizeSlot(input = {}, fallback = {}, label = 'shift') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(`Enter a valid ${label}.`);
  const slot = {
    Enabled: enabled(input.Enabled ?? fallback.Enabled, false),
    ResumptionTime: clean(input.ResumptionTime ?? fallback.ResumptionTime ?? '08:00'),
    ClosingTime: clean(input.ClosingTime ?? fallback.ClosingTime ?? '17:00'),
    EndDayOffset: wholeNumber(input.EndDayOffset ?? fallback.EndDayOffset, 0, 2, `${label} closing-day offset`)
  };
  const start = timeMinutes(slot.ResumptionTime, `${label} resumption time`);
  const end = timeMinutes(slot.ClosingTime, `${label} closing time`) + slot.EndDayOffset * 1440;
  if (slot.Enabled && (end <= start || end - start > 2880)) fail(`${label} must end after it starts and last no more than 48 hours. Set the closing-day offset for overnight shifts.`);
  return slot;
}

function assertNoOverlap(slots) {
  const intervals = slots.flatMap((slot, index) => slot.Enabled ? [{
    start: index * 1440 + timeMinutes(slot.ResumptionTime, 'resumption time'),
    end: (index + slot.EndDayOffset) * 1440 + timeMinutes(slot.ClosingTime, 'closing time')
  }] : []);
  if (!intervals.length) fail('An attendance group must have at least one working shift.');
  const cycleMinutes = slots.length * 1440;
  for (let index = 0; index < intervals.length; index += 1) {
    const nextStart = index + 1 < intervals.length ? intervals[index + 1].start : intervals[0].start + cycleMinutes;
    if (intervals[index].end > nextStart) fail('Attendance shifts must not overlap, including when the weekly or rotating cycle repeats.');
  }
}

export function normalizeAttendanceGroup(input = {}, existing = {}, basePolicy = {}) {
  const name = clean(input.Name ?? existing.Name);
  if (!name || name.length > 100) fail('Enter an attendance group name of 100 characters or fewer.');
  const groupId = clean(input.GroupId ?? existing.GroupId);
  if (groupId && !/^[A-Za-z0-9_-]{1,100}$/.test(groupId)) fail('The attendance group ID is invalid.');
  const scheduleType = clean(input.ScheduleType ?? existing.ScheduleType ?? 'FIXED').toUpperCase();
  if (!['FIXED', 'ROTATING'].includes(scheduleType)) fail('Choose a fixed weekly or rotating attendance schedule.');
  const effectiveFrom = dateValue(input.EffectiveFrom ?? existing.EffectiveFrom, 'group effective date');
  dateFormatter(clean(basePolicy.TimeZone || 'Africa/Lagos'));
  let daySchedules = {};
  let cycleDays = [];
  let anchorDate = '';
  if (scheduleType === 'FIXED') {
    if (input.DaySchedules !== undefined && (!input.DaySchedules || typeof input.DaySchedules !== 'object' || Array.isArray(input.DaySchedules))) {
      fail('Enter valid weekly attendance days.');
    }
    const workDays = Array.isArray(basePolicy.WorkDays) ? basePolicy.WorkDays : DAY_KEYS.slice(0, 5);
    daySchedules = Object.fromEntries(DAY_KEYS.map((day) => {
      const fallback = existing.ScheduleType === 'FIXED' && existing.DaySchedules?.[day]
        ? existing.DaySchedules[day]
        : basePolicy.DaySchedules?.[day] || {
          Enabled: workDays.includes(day), ResumptionTime: basePolicy.ResumptionTime || '08:00',
          ClosingTime: basePolicy.ClosingTime || '17:00', EndDayOffset: 0
        };
      return [day, normalizeSlot(input.DaySchedules?.[day] ?? {}, fallback, `${day} shift`)];
    }));
    assertNoOverlap(DAY_KEYS.map((day) => daySchedules[day]));
  } else {
    anchorDate = dateValue(input.AnchorDate ?? existing.AnchorDate, 'cycle anchor date');
    const source = input.CycleDays ?? existing.CycleDays;
    if (!Array.isArray(source) || source.length < 1 || source.length > 62) fail('A rotating schedule must have between 1 and 62 cycle days.');
    cycleDays = source.map((slot, index) => normalizeSlot(slot, {}, `Cycle day ${index + 1}`));
    assertNoOverlap(cycleDays);
  }
  return {
    GroupId: groupId, Name: name, ScheduleType: scheduleType, DaySchedules: daySchedules,
    AnchorDate: anchorDate, CycleDays: cycleDays, EffectiveFrom: effectiveFrom,
    GraceMinutes: wholeNumber(input.GraceMinutes ?? existing.GraceMinutes, Number(basePolicy.GraceMinutes ?? 15), 180, 'Grace period'),
    ClockInOpenMinutesBefore: wholeNumber(input.ClockInOpenMinutesBefore ?? existing.ClockInOpenMinutesBefore, Number(basePolicy.ClockInOpenMinutesBefore ?? 60), 360, 'Clock-in opening allowance'),
    OvertimeMinimumMinutes: wholeNumber(input.OvertimeMinimumMinutes ?? existing.OvertimeMinimumMinutes, Number(basePolicy.OvertimeMinimumMinutes ?? 15), 240, 'Minimum overtime')
  };
}

export function attendanceGroupFor(roster = {}, username, date) {
  dateValue(date);
  const wanted = clean(username).toLowerCase();
  if (!wanted) return null;
  let chosen = null;
  for (const assignment of Array.isArray(roster.Assignments) ? roster.Assignments : []) {
    if (clean(assignment.Username).toLowerCase() !== wanted) continue;
    const effectiveFrom = dateValue(assignment.EffectiveFrom, 'assignment effective date');
    if (effectiveFrom <= date && (!chosen || effectiveFrom >= chosen.EffectiveFrom)) chosen = { ...assignment, EffectiveFrom: effectiveFrom };
  }
  const groupId = clean(chosen?.GroupId);
  if (!groupId) return null;
  const group = (Array.isArray(roster.Groups) ? roster.Groups : []).find((item) => clean(item.GroupId) === groupId);
  if (!group) fail('The assigned attendance group is unavailable. Ask an administrator to review the staff assignment.', 409);
  let version = null;
  for (const candidate of [...(Array.isArray(group.History) ? group.History : []), group]) {
    const effectiveFrom = dateValue(candidate.EffectiveFrom, 'group effective date');
    if (effectiveFrom <= date && (!version || effectiveFrom >= version.EffectiveFrom)) {
      version = { ...candidate, EffectiveFrom: effectiveFrom };
    }
  }
  // Full definitions are retained when schedules change. This lets a missed
  // overnight duty still generate absence against the schedule it started on.
  const { History: _history, ...selected } = version || group;
  return { ...selected, GroupId: groupId };
}

function localInstant(date, time, formatter, timeZone) {
  const wallTime = new Date(`${date}T${time}:00Z`).getTime();
  const offsets = new Set();
  // Probe both sides of a potential transition. This handles fractional offsets,
  // DST folds and even date-line changes without assuming a one-hour transition.
  for (const hours of [-48, -12, 0, 12, 48]) {
    const probe = wallTime + hours * 3600000;
    const parts = localParts(probe, formatter);
    offsets.add(new Date(`${parts.date}T${parts.time}:${parts.second}Z`).getTime() - probe);
  }
  const matches = [...offsets].map((offset) => wallTime - offset).filter((candidate) => {
    const parts = localParts(candidate, formatter);
    return parts.date === date && parts.time === time && parts.second === '00';
  });
  if (!matches.length) fail(`The configured attendance time ${date} ${time} does not exist in ${timeZone} because the local clock changes. Review this shift.`, 400, 'ATTENDANCE_LOCAL_TIME_GAP');
  // A repeated wall-clock time always means its first occurrence.
  return Math.min(...matches);
}

export function attendanceShiftForDate(policy = {}, roster = {}, username, date) {
  dateValue(date);
  const day = dayKey(date);
  const assigned = attendanceGroupFor(roster, username, date);
  const group = assigned ? normalizeAttendanceGroup(assigned, {}, policy) : null;
  if (group && date < group.EffectiveFrom) return null;
  let slot;
  if (group?.ScheduleType === 'ROTATING') {
    const days = Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${group.AnchorDate}T00:00:00Z`)) / DAY);
    const index = ((days % group.CycleDays.length) + group.CycleDays.length) % group.CycleDays.length;
    slot = group.CycleDays[index];
  } else if (group) {
    slot = group.DaySchedules[day];
  } else {
    const workDays = Array.isArray(policy.WorkDays) ? policy.WorkDays : DAY_KEYS.slice(0, 5);
    slot = normalizeSlot(policy.DaySchedules?.[day] || {}, {
      Enabled: workDays.includes(day), ResumptionTime: policy.ResumptionTime || '08:00',
      ClosingTime: policy.ClosingTime || '17:00', EndDayOffset: 0
    }, `${day} shift`);
  }
  if (!slot?.Enabled) return null;
  const timeZone = clean(policy.TimeZone || 'Africa/Lagos');
  const formatter = dateFormatter(timeZone);
  const startAt = localInstant(date, slot.ResumptionTime, formatter, timeZone);
  const endAt = localInstant(addAttendanceDays(date, slot.EndDayOffset), slot.ClosingTime, formatter, timeZone);
  if (endAt <= startAt) fail('The attendance shift has no duration after the local clock change. Review this shift.');
  return {
    AttendanceDate: date, Day: day, GroupId: group?.GroupId || '', GroupName: group?.Name || 'Branch default',
    ScheduleType: group?.ScheduleType || 'FIXED', StartAt: new Date(startAt).toISOString(), EndAt: new Date(endAt).toISOString(),
    ResumptionTime: slot.ResumptionTime, ClosingTime: slot.ClosingTime, EndDayOffset: slot.EndDayOffset, TimeZone: timeZone,
    GraceMinutes: group?.GraceMinutes ?? wholeNumber(policy.GraceMinutes, 15, 180, 'Grace period'),
    ClockInOpenMinutesBefore: group?.ClockInOpenMinutesBefore ?? wholeNumber(policy.ClockInOpenMinutesBefore, 60, 360, 'Clock-in opening allowance'),
    OvertimeMinimumMinutes: group?.OvertimeMinimumMinutes ?? wholeNumber(policy.OvertimeMinimumMinutes, 15, 240, 'Minimum overtime'),
    Active: (group || enabled(policy.Active, true)) ? 'YES' : 'NO'
  };
}

export function resolveAttendanceShift(policy = {}, roster = {}, username, timestamp) {
  const instant = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
  if (!Number.isFinite(instant)) fail('Enter a valid attendance time.');
  const today = attendanceLocalDate(instant, clean(policy.TimeZone || 'Africa/Lagos'));
  const candidates = [];
  let todayGap = null;
  for (const delta of [-2, -1, 0, 1]) {
    try {
      const shift = attendanceShiftForDate(policy, roster, username, addAttendanceDays(today, delta));
      if (shift) candidates.push(shift);
    } catch (error) {
      if (error.code !== 'ATTENDANCE_LOCAL_TIME_GAP') throw error;
      if (delta === 0) todayGap = error;
    }
  }
  const current = candidates.filter((shift) => instant >= Date.parse(shift.StartAt) && instant < Date.parse(shift.EndAt))
    .sort((left, right) => Date.parse(left.StartAt) - Date.parse(right.StartAt));
  if (current.length) return current[0];
  const opening = candidates.filter((shift) => instant < Date.parse(shift.StartAt)
    && instant >= Date.parse(shift.StartAt) - shift.ClockInOpenMinutesBefore * MINUTE)
    .sort((left, right) => Date.parse(left.StartAt) - Date.parse(right.StartAt));
  if (opening.length) return opening[0];
  if (todayGap) throw todayGap;
  // The caller still checks StartAt minus the opening allowance before clock-in.
  // Keeping today's completed/future shift lets the dashboard explain its hours.
  return candidates.find((shift) => shift.AttendanceDate === today) || null;
}
