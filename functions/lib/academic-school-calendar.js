const clean = (value) => String(value ?? '').trim();

export const SCHOOL_WEEKDAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
export const DEFAULT_SCHOOL_WEEKDAYS = Object.freeze(SCHOOL_WEEKDAYS.slice(0, 5));

function calendarError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function schoolCalendarDate(value, label = 'date') {
  const date = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw calendarError(`Enter a valid ${label} in YYYY-MM-DD format.`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw calendarError(`Enter a real ${label} in YYYY-MM-DD format.`);
  }
  return date;
}

function dateTime(date) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

export function schoolCalendarWeekday(date) {
  return SCHOOL_WEEKDAYS[(new Date(`${schoolCalendarDate(date)}T00:00:00.000Z`).getUTCDay() + 6) % 7];
}

export function normalizeSchoolCalendar(input = {}, term = {}) {
  const startDate = schoolCalendarDate(term.StartDate, 'term start date');
  const endDate = schoolCalendarDate(term.EndDate, 'term end date');
  if (endDate < startDate) throw calendarError('The term end date must follow its start date.');
  if ((dateTime(endDate) - dateTime(startDate)) / 86400000 > 730) {
    throw calendarError('A school calendar cannot span more than two years.');
  }
  const suppliedDays = input.OperatingWeekdays;
  const days = Array.isArray(suppliedDays) ? suppliedDays : clean(suppliedDays).split(/[\s,]+/);
  const operatingWeekdays = [...new Set(days.map((day) => clean(day).toUpperCase()).filter(Boolean))];
  if (!operatingWeekdays.length || operatingWeekdays.some((day) => !SCHOOL_WEEKDAYS.includes(day))) {
    throw calendarError('Choose at least one valid operating weekday.');
  }
  let suppliedExceptions = input.Exceptions;
  if (typeof suppliedExceptions === 'string') {
    const text = suppliedExceptions.trim();
    if (!text) suppliedExceptions = [];
    else if (text.startsWith('[')) {
      try { suppliedExceptions = JSON.parse(text); } catch (_error) { throw calendarError('Enter valid school calendar exception rows.'); }
    } else suppliedExceptions = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [date, status, ...reason] = line.split('|').map((part) => part.trim());
      return { Date: date, Status: status, Reason: reason.join(' | ') };
    });
  }
  if (!Array.isArray(suppliedExceptions) || suppliedExceptions.length > 366) {
    throw calendarError('Provide no more than 366 dated calendar exceptions.');
  }
  const seen = new Set();
  const exceptions = suppliedExceptions.map((item, index) => {
    const date = schoolCalendarDate(item?.Date, `calendar date on row ${index + 1}`);
    if (date < startDate || date > endDate) throw calendarError(`${date} is outside the selected term.`);
    if (seen.has(date)) throw calendarError(`${date} appears more than once in the school calendar.`);
    seen.add(date);
    const status = clean(item?.Status);
    if (!['Closed', 'Open'].includes(status)) throw calendarError(`${date} must be marked Closed or Open.`);
    const reason = clean(item?.Reason);
    if (!reason || reason.length > 160) throw calendarError(`${date} needs a reason of no more than 160 characters.`);
    return { Date: date, Status: status, Reason: reason };
  }).sort((a, b) => a.Date.localeCompare(b.Date));
  return { OperatingWeekdays: operatingWeekdays, Exceptions: exceptions };
}

export function schoolCalendarDayIsOpen(calendar, date) {
  const target = schoolCalendarDate(date);
  const override = (calendar?.Exceptions || []).find((row) => row.Date === target);
  if (override) return override.Status === 'Open';
  return (calendar?.OperatingWeekdays || DEFAULT_SCHOOL_WEEKDAYS).includes(schoolCalendarWeekday(target));
}

export function schoolCalendarOpenDays(term, calendar, throughDate = term?.EndDate) {
  const first = schoolCalendarDate(term?.StartDate, 'term start date');
  const last = schoolCalendarDate(term?.EndDate, 'term end date');
  const through = schoolCalendarDate(throughDate, 'report date');
  const final = through < last ? through : last;
  if (last < first) throw calendarError('The term end date must follow its start date.');
  if (final < first) return 0;
  const firstTime = dateTime(first);
  const finalTime = dateTime(final);
  if ((finalTime - firstTime) / 86400000 > 730) throw calendarError('A school calendar cannot span more than two years.');
  let count = 0;
  for (let time = firstTime; time <= finalTime; time += 86400000) {
    if (schoolCalendarDayIsOpen(calendar, new Date(time).toISOString().slice(0, 10))) count += 1;
  }
  return count;
}

export function schoolCalendarSummary(term, calendar, today = new Date().toISOString().slice(0, 10)) {
  return {
    Configured: Boolean(calendar),
    PlannedOpenDays: schoolCalendarOpenDays(term, calendar, term.EndDate),
    OpenDaysToDate: schoolCalendarOpenDays(term, calendar, today),
    ClosedDates: (calendar?.Exceptions || []).filter((row) => row.Status === 'Closed').length,
    AddedOpenDates: (calendar?.Exceptions || []).filter((row) => row.Status === 'Open').length
  };
}
