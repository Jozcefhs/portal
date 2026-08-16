const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export const ACADEMIC_TIMETABLE_VERSION_STATUSES = Object.freeze(['Draft', 'Approved', 'Published', 'Withdrawn']);
export const ACADEMIC_TIMETABLE_PERIOD_KINDS = Object.freeze(['Lesson', 'Break', 'Assembly']);
export const ACADEMIC_TIMETABLE_LESSON_TYPES = Object.freeze(['Single', 'Double', 'Practical']);
export const ACADEMIC_ATTENDANCE_STATUSES = Object.freeze(['Present', 'Absent', 'Late', 'Excused', 'Left Early']);
export const ACADEMIC_ATTENDANCE_MODES = Object.freeze(['Daily', 'Period', 'Subject']);

function failure(message, code = '') {
  const error = new Error(message);
  error.status = 400;
  if (code) error.code = code;
  return error;
}

function oneOf(value, choices, fallback = '') {
  const wanted = lower(value);
  return choices.find((choice) => lower(choice) === wanted) || fallback;
}

function wholeNumber(value, fallback = 0, minimum = 0, maximum = 1000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

function timeValue(value, label) {
  const result = clean(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw failure(`Enter a valid ${label} in HH:MM format.`);
  return result;
}

function uniqueBy(rows, key, label) {
  const seen = new Set();
  rows.forEach((row) => {
    const value = lower(row[key]);
    if (seen.has(value)) throw failure(`${label} ${row[key]} is repeated.`);
    seen.add(value);
  });
  return rows;
}

function suppliedRows(value, separatorPattern) {
  if (Array.isArray(value)) return value;
  const text = clean(value);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch (_error) {
    // Human-friendly line input is supported by both the web and desktop clients.
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => line.split(separatorPattern).map(clean));
}

export function normalizeAcademicTimetableDays(value) {
  const rows = suppliedRows(value, /\s*\|\s*/).map((row, index) => {
    const source = Array.isArray(row) ? { DayCode: row[0], Name: row[1], SortOrder: row[2] } : row;
    const dayCode = clean(source.DayCode || source.Code).toUpperCase();
    const name = clean(source.Name || source.DayName);
    if (!/^[A-Z0-9_-]{2,12}$/.test(dayCode)) throw failure(`Day ${index + 1} needs a short code such as MON.`);
    if (!name) throw failure(`Day ${index + 1} needs a display name.`);
    return { DayCode: dayCode, Name: name, SortOrder: wholeNumber(source.SortOrder, index + 1, 1, 100) };
  });
  if (!rows.length) throw failure('Configure at least one school day.');
  return uniqueBy(rows, 'DayCode', 'Day code').sort((a, b) => a.SortOrder - b.SortOrder || a.Name.localeCompare(b.Name));
}

function normalizedPeriodDayCodes(source = {}) {
  const supplied = source.DayCodes ?? source.DayCode ?? source.Days ?? 'ALL';
  const values = Array.isArray(supplied) ? supplied : clean(supplied).split(/[\s,]+/);
  const result = [...new Set(values.map((value) => clean(value).toUpperCase()).filter(Boolean))];
  return result.length ? result : ['ALL'];
}

function validatePeriodSequence(periods = [], dayLabel = '') {
  if (!periods.some((row) => row.Kind === 'Lesson')) {
    throw failure(`Configure at least one lesson period${dayLabel ? ` for ${dayLabel}` : ''}.`);
  }
  periods.forEach((row, index) => {
    const prior = periods[index - 1];
    if (prior && row.StartTime < prior.EndTime) {
      throw failure(`${row.Name} overlaps ${prior.Name}${dayLabel ? ` on ${dayLabel}` : ''}.`);
    }
  });
}

export function academicTimetablePeriodsForDay(settings = {}, dayCode = '') {
  const target = clean(dayCode).toUpperCase();
  const defaults = new Map();
  const overrides = new Map();
  (settings.Periods || []).forEach((row) => {
    const dayCodes = normalizedPeriodDayCodes(row);
    const key = clean(row.PeriodCode).toUpperCase();
    if (dayCodes.includes('ALL')) defaults.set(key, row);
    if (target && dayCodes.includes(target)) overrides.set(key, row);
  });
  const effective = new Map(defaults);
  overrides.forEach((row, key) => effective.set(key, row));
  return [...effective.values()].sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0)
    || clean(a.StartTime).localeCompare(clean(b.StartTime)) || clean(a.PeriodCode).localeCompare(clean(b.PeriodCode)));
}

export function normalizeAcademicTimetablePeriods(value, days = []) {
  const configuredDays = (days || []).map((row) => ({ DayCode: clean(row.DayCode).toUpperCase(), Name: clean(row.Name || row.DayCode) }));
  const configuredDayCodes = new Set(configuredDays.map((row) => row.DayCode));
  const rows = suppliedRows(value, /\s*\|\s*/).map((row, index) => {
    const scopedLine = Array.isArray(row) && row.length >= 7;
    const source = Array.isArray(row) ? (scopedLine
      ? { DayCodes: row[0], PeriodCode: row[1], Name: row[2], StartTime: row[3], EndTime: row[4], Kind: row[5], SortOrder: row[6] }
      : { DayCodes: 'ALL', PeriodCode: row[0], Name: row[1], StartTime: row[2], EndTime: row[3], Kind: row[4], SortOrder: row[5] })
      : row;
    const dayCodes = normalizedPeriodDayCodes(source);
    if (dayCodes.includes('ALL') && dayCodes.length > 1) throw failure(`Period ${index + 1} cannot combine ALL with individual days.`);
    const unknownDay = dayCodes.find((dayCode) => dayCode !== 'ALL' && configuredDayCodes.size && !configuredDayCodes.has(dayCode));
    if (unknownDay) throw failure(`Period ${index + 1} uses ${unknownDay}, which is not a configured school day.`);
    const periodCode = clean(source.PeriodCode || source.Code).toUpperCase();
    const name = clean(source.Name || source.PeriodName);
    const startTime = timeValue(source.StartTime, `start time for ${name || periodCode || `period ${index + 1}`}`);
    const endTime = timeValue(source.EndTime, `end time for ${name || periodCode || `period ${index + 1}`}`);
    const kind = oneOf(source.Kind, ACADEMIC_TIMETABLE_PERIOD_KINDS, 'Lesson');
    if (!/^[A-Z0-9_-]{1,16}$/.test(periodCode)) throw failure(`Period ${index + 1} needs a short code such as P1.`);
    if (!name) throw failure(`Period ${index + 1} needs a display name.`);
    if (endTime <= startTime) throw failure(`${name} must end after it starts.`);
    return {
      DayCodes: dayCodes, PeriodCode: periodCode, Name: name, StartTime: startTime, EndTime: endTime,
      Kind: kind, SortOrder: wholeNumber(source.SortOrder, index + 1, 1, 200)
    };
  });
  const occupied = new Set();
  rows.forEach((row) => {
    row.DayCodes.forEach((dayCode) => {
      const key = `${dayCode}:${row.PeriodCode}`;
      if (occupied.has(key)) throw failure(`Period code ${row.PeriodCode} is repeated for ${dayCode === 'ALL' ? 'the default schedule' : dayCode}.`);
      occupied.add(key);
    });
  });
  const validationDays = configuredDays.length ? configuredDays : [{ DayCode: 'ALL', Name: '' }];
  validationDays.forEach((day) => {
    const effective = day.DayCode === 'ALL'
      ? rows.filter((row) => row.DayCodes.includes('ALL')).sort((a, b) => a.SortOrder - b.SortOrder || a.StartTime.localeCompare(b.StartTime))
      : academicTimetablePeriodsForDay({ Periods: rows }, day.DayCode);
    validatePeriodSequence(effective, day.Name);
  });
  const dayOrder = new Map(configuredDays.map((row, index) => [row.DayCode, index + 1]));
  return rows.sort((a, b) => {
    const firstScope = a.DayCodes.includes('ALL') ? 0 : Math.min(...a.DayCodes.map((code) => dayOrder.get(code) || 999));
    const secondScope = b.DayCodes.includes('ALL') ? 0 : Math.min(...b.DayCodes.map((code) => dayOrder.get(code) || 999));
    return firstScope - secondScope || a.SortOrder - b.SortOrder || a.StartTime.localeCompare(b.StartTime);
  });
}

export function academicTimetablePeriodCodes(settings = {}, startPeriodCode = '', durationPeriods = 1, dayCode = '') {
  const effectiveDay = clean(dayCode || settings.Days?.[0]?.DayCode).toUpperCase();
  const periods = effectiveDay
    ? academicTimetablePeriodsForDay(settings, effectiveDay)
    : (settings.Periods || []).filter((row) => normalizedPeriodDayCodes(row).includes('ALL'));
  const start = periods.findIndex((row) => lower(row.PeriodCode) === lower(startPeriodCode));
  const duration = wholeNumber(durationPeriods, 1, 1, 3);
  if (start < 0 || periods[start]?.Kind !== 'Lesson') throw failure('Choose a valid lesson period.');
  const occupied = periods.slice(start, start + duration);
  if (occupied.length !== duration || occupied.some((row) => row.Kind !== 'Lesson')) {
    throw failure('A double or practical lesson cannot cross a break, assembly or the end of the school day.');
  }
  return occupied.map((row) => row.PeriodCode);
}

export function normalizeAcademicTimetableEntry(input = {}, settings = {}, existing = null) {
  const dayCode = clean(input.DayCode ?? existing?.DayCode).toUpperCase();
  if (!(settings.Days || []).some((row) => row.DayCode === dayCode)) throw failure('Choose a configured school day.');
  const startPeriodCode = clean(input.StartPeriodCode ?? existing?.StartPeriodCode).toUpperCase();
  const durationPeriods = wholeNumber(input.DurationPeriods ?? existing?.DurationPeriods, 1, 1, 3);
  const periodCodes = academicTimetablePeriodCodes(settings, startPeriodCode, durationPeriods, dayCode);
  const classId = clean(input.ClassId ?? existing?.ClassId);
  const armId = clean(input.ArmId ?? existing?.ArmId);
  const subjectId = clean(input.SubjectId ?? existing?.SubjectId);
  const teacherUsername = lower(input.TeacherUsername ?? existing?.TeacherUsername);
  if (!classId || !armId || !subjectId || !teacherUsername) {
    throw failure('Choose the classroom, subject and allocated teacher for this lesson.');
  }
  const lessonType = oneOf(input.LessonType, ACADEMIC_TIMETABLE_LESSON_TYPES,
    durationPeriods === 2 ? 'Double' : durationPeriods > 2 ? 'Practical' : 'Single');
  return {
    ...(existing || {}), DayCode: dayCode, StartPeriodCode: startPeriodCode,
    DurationPeriods: durationPeriods, PeriodCodes: periodCodes, ClassId: classId, ArmId: armId,
    SubjectId: subjectId, TeacherUsername: teacherUsername, Room: clean(input.Room ?? existing?.Room),
    LessonType: lessonType, Notes: clean(input.Notes ?? existing?.Notes).slice(0, 500)
  };
}

function intersects(first = [], second = []) {
  const wanted = new Set(first.map(lower));
  return second.some((value) => wanted.has(lower(value)));
}

export function academicTimetableConflicts(candidate = {}, entries = []) {
  return (entries || []).filter((row) => lower(row.VersionId) === lower(candidate.VersionId)
    && lower(row.DayCode) === lower(candidate.DayCode)
    && lower(row.EntryId || row.RecordId) !== lower(candidate.EntryId || candidate.RecordId)
    && intersects(row.PeriodCodes || [], candidate.PeriodCodes || [])).flatMap((row) => {
    const conflicts = [];
    if (lower(row.ClassId) === lower(candidate.ClassId) && lower(row.ArmId) === lower(candidate.ArmId)) {
      conflicts.push({ Type: 'Classroom', EntryId: clean(row.EntryId || row.RecordId) });
    }
    if (lower(row.TeacherUsername) === lower(candidate.TeacherUsername)) {
      conflicts.push({ Type: 'Teacher', EntryId: clean(row.EntryId || row.RecordId) });
    }
    if (clean(candidate.Room) && lower(row.Room) === lower(candidate.Room)) {
      conflicts.push({ Type: 'Room', EntryId: clean(row.EntryId || row.RecordId) });
    }
    return conflicts;
  });
}

export function normalizeAcademicAttendanceEntries(value, eligibleStudentRefs = []) {
  let supplied = value;
  if (typeof supplied === 'string') {
    try { supplied = JSON.parse(supplied); } catch (_error) { supplied = []; }
  }
  if (!Array.isArray(supplied) || !supplied.length) throw failure('The attendance register has no student rows.');
  const eligible = new Set(eligibleStudentRefs.map(lower));
  const seen = new Set();
  return supplied.map((row, index) => {
    const studentRef = clean(row.StudentRef);
    const key = lower(studentRef);
    if (!studentRef || (eligible.size && !eligible.has(key))) throw failure(`Attendance row ${index + 1} is not in this classroom.`);
    if (seen.has(key)) throw failure(`Student ${studentRef} is repeated in this attendance register.`);
    seen.add(key);
    const status = oneOf(row.Status, ACADEMIC_ATTENDANCE_STATUSES, '');
    if (!status) throw failure(`Attendance row ${index + 1} has an invalid status.`);
    return {
      StudentRef: studentRef, Status: status,
      MinutesLate: status === 'Late' ? wholeNumber(row.MinutesLate, 0, 0, 600) : 0,
      Note: clean(row.Note).slice(0, 300)
    };
  });
}

export function academicAttendanceSummary(rows = []) {
  const summary = Object.fromEntries(ACADEMIC_ATTENDANCE_STATUSES.map((status) => [status.replace(/\s+/g, ''), 0]));
  rows.forEach((row) => {
    const status = oneOf(row.Status, ACADEMIC_ATTENDANCE_STATUSES, 'Present').replace(/\s+/g, '');
    summary[status] += 1;
  });
  return { ...summary, Total: rows.length };
}
