import { batchCommitLiteralDocuments as batchCommitDocuments, listCollection, patchDocumentFields, upsertDocument } from './firestore.js';
import { staffEmploymentDetails } from './staff-employment.js';
import {
  cleanupLegacyStaffAttendanceStorage,
  getCanonicalStaffAttendanceDocument,
  getStaffAttendanceDocument,
  listStaffAttendanceCollection,
  migrateLegacyStaffAttendanceStorage,
  queryStaffAttendanceCollection,
  resolveStaffAttendanceBranch,
  safeStaffAttendanceDocumentId,
  staffAttendanceCollectionPath,
  staffAttendanceDocumentData,
  staffAttendanceWriteDocumentId,
  staffAttendanceReadPaths,
  staffAttendanceStorageMigrationStatus
} from './staff-attendance-storage.js';
import { staffRecordMatchesEdition } from './records-desk.js';
import { hrCapabilitiesFor } from './human-resources.js';
import { addAttendanceDays, attendanceGroupFor, attendanceShiftForDate, resolveAttendanceShift } from './staff-attendance-schedules.js';
import { assignAttendanceGroups, attendanceHrRecordMatchesScope, canManageAttendanceGroups, deleteAttendanceGroup, loadAttendanceRoster, requireAttendanceStaff, saveAttendanceGroup } from './staff-attendance-groups.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const MANAGE_ROLES = new Set(['Super Admin', 'Church Administrator']);
const REPORT_ROLES = new Set([...MANAGE_ROLES, 'Pastor', 'Treasurer', 'Auditor']);
const ATTENDANCE_REPORT_LIMIT = 5000;
const DAY_KEYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
const IDENTITY_VERIFICATION_MODES = new Set(['NONE', 'PASSKEY', 'FACE']);
const PRESENCE_CHECK_MODES = new Set(['NONE', 'RANDOM']);
const DEFAULT_ATTENDANCE_POLICY = Object.freeze({
  ResumptionTime: '08:00',
  ClosingTime: '17:00',
  GraceMinutes: 15,
  ClockInOpenMinutesBefore: 60,
  OvertimeMinimumMinutes: 15,
  WorkDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  TimeZone: 'Africa/Lagos',
  AutoRecordAbsence: 'YES',
  IdentityVerification: 'NONE',
  PresenceCheckMode: 'NONE',
  PresenceCheckMinimumMinutes: 90,
  PresenceCheckMaximumMinutes: 180,
  PresenceCheckGraceMinutes: 20,
  PresenceCheckPushEnabled: 'YES',
  Active: 'YES'
});

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function actorId(user = {}) {
  return lower(user.username || user.Username || user.email || user.Email);
}

function actorName(user = {}) {
  return clean(user.displayName || user.DisplayName || user.username || user.Username || 'Staff member');
}

function branchFor(user, body = {}) {
  return resolveStaffAttendanceBranch(user, body.BranchId || body.branchId || 'main');
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function activeValue(value, fallback = true) {
  const normalized = lower(value);
  if (!normalized) return fallback;
  return !['no', 'false', '0', 'inactive', 'disabled', 'off'].includes(normalized);
}

function timeMinutes(value, label) {
  const match = clean(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) fail(`Enter a valid ${label.toLowerCase()} in 24-hour time.`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) fail(`Enter a valid ${label.toLowerCase()} in 24-hour time.`);
  return hours * 60 + minutes;
}

function boundedWholeNumber(value, fallback, minimum, maximum, label) {
  const parsed = value === undefined || value === null || clean(value) === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${label} must be a whole number between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function attendanceDate(value, label) {
  const date = clean(value);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    fail(`Enter a valid ${label.toLowerCase()}.`);
  }
  return date;
}

export function normalizeAttendanceReportPeriod(input = {}) {
  const fromDate = clean(input.FromDate || input.fromDate);
  const toDate = clean(input.ToDate || input.toDate);
  if (!fromDate && !toDate) return { FromDate: '', ToDate: '' };
  if (!fromDate || !toDate) fail('Choose both the report start date and end date.');
  const from = attendanceDate(fromDate, 'Report start date');
  const to = attendanceDate(toDate, 'Report end date');
  if (to < from) fail('The report end date must be on or after the start date.');
  const days = Math.floor((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
  if (days > 366) fail('Choose an attendance report period of 366 days or less.');
  return { FromDate: from, ToDate: to };
}

export function canReportStaffAttendance(user = {}) {
  const role = clean(user.role || user.Role);
  return canManageStaffAttendance(user) || REPORT_ROLES.has(role) || hrCapabilitiesFor(user).canManageTime;
}

export function canManageStaffAttendance(user = {}) {
  return canManageAttendanceGroups(user);
}

function localAttendanceParts(timestamp, timeZone) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) fail('Enter a valid attendance time.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: clean(parts.weekday).slice(0, 3).toUpperCase(),
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

export function normalizeAttendancePolicy(input = {}, existing = {}) {
  const resumption = clean(input.ResumptionTime || existing.ResumptionTime || DEFAULT_ATTENDANCE_POLICY.ResumptionTime);
  const closing = clean(input.ClosingTime || existing.ClosingTime || DEFAULT_ATTENDANCE_POLICY.ClosingTime);
  const resumptionMinutes = timeMinutes(resumption, 'Resumption time');
  const closingMinutes = timeMinutes(closing, 'Closing time');
  if (closingMinutes <= resumptionMinutes) fail('Closing time must be later than resumption time on the same day.');
  const sourceDays = input.WorkDays ?? existing.WorkDays ?? DEFAULT_ATTENDANCE_POLICY.WorkDays;
  const workDays = [...new Set((Array.isArray(sourceDays) ? sourceDays : clean(sourceDays).split(/[\s,;]+/))
    .map((value) => clean(value).slice(0, 3).toUpperCase()).filter((value) => DAY_KEYS.includes(value)))];
  const inputSchedules = input.DaySchedules && typeof input.DaySchedules === 'object' && !Array.isArray(input.DaySchedules)
    ? input.DaySchedules
    : null;
  const existingSchedules = existing.DaySchedules && typeof existing.DaySchedules === 'object' && !Array.isArray(existing.DaySchedules)
    ? existing.DaySchedules
    : {};
  const daySchedules = Object.fromEntries(DAY_KEYS.map((day) => {
    const source = inputSchedules?.[day] && typeof inputSchedules[day] === 'object'
      ? inputSchedules[day]
      : existingSchedules[day] && typeof existingSchedules[day] === 'object'
        ? existingSchedules[day]
        : {};
    const enabled = source.Enabled === undefined
      ? workDays.includes(day)
      : activeValue(source.Enabled, workDays.includes(day));
    const dayResumption = clean(source.ResumptionTime || resumption);
    const dayClosing = clean(source.ClosingTime || closing);
    const dayResumptionMinutes = timeMinutes(dayResumption, `${day} resumption time`);
    const dayClosingMinutes = timeMinutes(dayClosing, `${day} closing time`);
    if (enabled && dayClosingMinutes <= dayResumptionMinutes) {
      fail(`${day} closing time must be later than its resumption time on the same day.`);
    }
    return [day, {
      Enabled: enabled,
      ResumptionTime: dayResumption,
      ClosingTime: dayClosing
    }];
  }));
  const normalizedWorkDays = DAY_KEYS.filter((day) => daySchedules[day].Enabled);
  if (!normalizedWorkDays.length) fail('Choose at least one working day.');
  const timeZone = clean(input.TimeZone || existing.TimeZone || DEFAULT_ATTENDANCE_POLICY.TimeZone);
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format(new Date());
  } catch (_error) {
    fail('Enter a valid time zone, for example Africa/Lagos.');
  }
  const requestedIdentityVerification = clean(input.IdentityVerification ?? existing.IdentityVerification ?? DEFAULT_ATTENDANCE_POLICY.IdentityVerification).toUpperCase();
  const identityVerification = requestedIdentityVerification === 'PASSKEY_OR_FACE'
    ? 'PASSKEY'
    : requestedIdentityVerification;
  if (!IDENTITY_VERIFICATION_MODES.has(identityVerification)) fail('Choose a valid attendance identity verification method.');
  const presenceCheckMode = clean(input.PresenceCheckMode ?? existing.PresenceCheckMode ?? DEFAULT_ATTENDANCE_POLICY.PresenceCheckMode).toUpperCase();
  if (!PRESENCE_CHECK_MODES.has(presenceCheckMode)) fail('Choose a valid presence-check mode.');
  const presenceCheckMinimumMinutes = boundedWholeNumber(
    input.PresenceCheckMinimumMinutes ?? existing.PresenceCheckMinimumMinutes,
    DEFAULT_ATTENDANCE_POLICY.PresenceCheckMinimumMinutes,
    15,
    480,
    'Minimum presence-check interval'
  );
  const presenceCheckMaximumMinutes = boundedWholeNumber(
    input.PresenceCheckMaximumMinutes ?? existing.PresenceCheckMaximumMinutes,
    DEFAULT_ATTENDANCE_POLICY.PresenceCheckMaximumMinutes,
    15,
    720,
    'Maximum presence-check interval'
  );
  if (presenceCheckMaximumMinutes < presenceCheckMinimumMinutes) {
    fail('Maximum presence-check interval must be greater than or equal to the minimum interval.');
  }
  return {
    ResumptionTime: resumption,
    ClosingTime: closing,
    GraceMinutes: boundedWholeNumber(input.GraceMinutes ?? existing.GraceMinutes, DEFAULT_ATTENDANCE_POLICY.GraceMinutes, 0, 180, 'Grace period'),
    ClockInOpenMinutesBefore: boundedWholeNumber(
      input.ClockInOpenMinutesBefore ?? existing.ClockInOpenMinutesBefore,
      DEFAULT_ATTENDANCE_POLICY.ClockInOpenMinutesBefore,
      0,
      360,
      'Clock-in opening allowance'
    ),
    OvertimeMinimumMinutes: boundedWholeNumber(input.OvertimeMinimumMinutes ?? existing.OvertimeMinimumMinutes, DEFAULT_ATTENDANCE_POLICY.OvertimeMinimumMinutes, 0, 240, 'Minimum overtime'),
    WorkDays: normalizedWorkDays,
    DaySchedules: daySchedules,
    TimeZone: timeZone,
    AutoRecordAbsence: activeValue(input.AutoRecordAbsence ?? existing.AutoRecordAbsence, true) ? 'YES' : 'NO',
    IdentityVerification: identityVerification,
    PresenceCheckMode: presenceCheckMode,
    PresenceCheckMinimumMinutes: presenceCheckMinimumMinutes,
    PresenceCheckMaximumMinutes: presenceCheckMaximumMinutes,
    PresenceCheckGraceMinutes: boundedWholeNumber(
      input.PresenceCheckGraceMinutes ?? existing.PresenceCheckGraceMinutes,
      DEFAULT_ATTENDANCE_POLICY.PresenceCheckGraceMinutes,
      5,
      180,
      'Presence-check grace period'
    ),
    PresenceCheckPushEnabled: activeValue(
      input.PresenceCheckPushEnabled ?? existing.PresenceCheckPushEnabled,
      true
    ) ? 'YES' : 'NO',
    Active: activeValue(input.Active ?? existing.Active, true) ? 'YES' : 'NO'
  };
}

export function attendanceScheduleFor(policyInput = {}, day) {
  const policy = normalizeAttendancePolicy(policyInput);
  const key = clean(day).slice(0, 3).toUpperCase();
  return policy.DaySchedules[key] || {
    Enabled: false,
    ResumptionTime: policy.ResumptionTime,
    ClosingTime: policy.ClosingTime
  };
}

function clockTimeLabel(minutes) {
  const bounded = Math.max(0, Math.min(1439, Number(minutes) || 0));
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

export function attendanceClockInWindow(policyInput = {}, timestamp = nowIso()) {
  const shift = policyInput.ShiftSnapshot;
  if (shift) {
    const now = Date.parse(timestamp);
    const start = Date.parse(shift.StartAt);
    const opensAt = start - Number(shift.ClockInOpenMinutesBefore || 0) * 60000;
    const closed = now >= Date.parse(shift.EndAt);
    return { allowed: now >= opensAt && !closed, closed, enforced: true, date: shift.AttendanceDate, day: shift.Day,
      opensAt: new Intl.DateTimeFormat('en-GB', { timeZone: shift.TimeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(opensAt),
      resumptionTime: shift.ResumptionTime, allowanceMinutes: Number(shift.ClockInOpenMinutesBefore || 0),
      minutesBeforeOpening: Math.max(0, Math.ceil((opensAt - now) / 60000)),
      minutesBeforeResumption: Math.max(0, Math.ceil((start - now) / 60000)) };
  }
  const policy = normalizeAttendancePolicy(policyInput);
  const local = localAttendanceParts(timestamp, policy.TimeZone);
  const schedule = policy.DaySchedules?.[local.day] || {};
  const resumptionMinute = timeMinutes(schedule.ResumptionTime || policy.ResumptionTime, 'Resumption time');
  const allowanceMinutes = Number(policy.ClockInOpenMinutesBefore || 0);
  const opensAtMinute = Math.max(0, resumptionMinute - allowanceMinutes);
  const enforced = lower(policy.Active) !== 'no' && Boolean(schedule.Enabled);
  return {
    allowed: !enforced || local.minuteOfDay >= opensAtMinute,
    enforced,
    date: local.date,
    day: local.day,
    currentMinute: local.minuteOfDay,
    opensAt: clockTimeLabel(opensAtMinute),
    resumptionTime: clean(schedule.ResumptionTime || policy.ResumptionTime),
    allowanceMinutes,
    minutesBeforeOpening: Math.max(0, opensAtMinute - local.minuteOfDay),
    minutesBeforeResumption: Math.max(0, resumptionMinute - local.minuteOfDay)
  };
}

export function calculateAttendanceMetrics(policyInput = {}, eventInput = {}) {
  const policy = normalizeAttendancePolicy(policyInput);
  const timestamp = clean(eventInput.Timestamp) || nowIso();
  const direction = clean(eventInput.Direction).toUpperCase();
  if (!['IN', 'OUT'].includes(direction)) fail('Choose Clock in or Clock out.');
  const shift = eventInput.ShiftSnapshot || policyInput.ShiftSnapshot;
  if (shift) {
    const instant = Date.parse(timestamp);
    const start = Date.parse(shift.StartAt);
    const end = Date.parse(shift.EndAt);
    if (![instant, start, end].every(Number.isFinite) || end <= start) fail('The stored attendance shift is invalid. Ask HR to review it.', 409);
    const minutes = value => Math.max(0, Math.round(value / 60000));
    const workDay = shift.WorkDay !== false;
    const late = direction === 'IN' && workDay ? minutes(instant - start) : 0;
    const lateMinutes = late > Number(shift.GraceMinutes || 0) ? late : 0;
    const first = Date.parse(eventInput.FirstClockIn);
    const workMinutes = direction === 'OUT' && Number.isFinite(first) ? minutes(instant - first) : 0;
    const rawOvertime = direction === 'OUT' ? workDay ? minutes(instant - end) : workMinutes : 0;
    return {
      Date: shift.AttendanceDate, Day: shift.Day, WorkDay: workDay,
      ScheduledResumptionTime: shift.ResumptionTime, ScheduledClosingTime: shift.ClosingTime,
      AttendanceStatus: direction === 'IN' ? workDay ? lateMinutes ? 'Late' : 'Present' : 'Overtime day'
        : clean(eventInput.ExistingStatus) || (Number.isFinite(first) ? 'Present' : 'Incomplete'),
      LateMinutes: lateMinutes,
      OvertimeMinutes: rawOvertime >= Number(shift.OvertimeMinimumMinutes || 0) ? rawOvertime : 0,
      EarlyDepartureMinutes: direction === 'OUT' && workDay ? minutes(end - instant) : 0,
      WorkMinutes: workMinutes
    };
  }
  const local = localAttendanceParts(timestamp, policy.TimeZone);
  const schedule = policy.DaySchedules[local.day];
  const workDay = Boolean(schedule?.Enabled);
  const start = timeMinutes(schedule?.ResumptionTime || policy.ResumptionTime, 'Resumption time');
  const close = timeMinutes(schedule?.ClosingTime || policy.ClosingTime, 'Closing time');
  const lateDifference = Math.max(0, local.minuteOfDay - start);
  const lateMinutes = direction === 'IN' && workDay && lateDifference > policy.GraceMinutes ? lateDifference : 0;
  const firstClockIn = clean(eventInput.FirstClockIn);
  const firstTime = firstClockIn ? new Date(firstClockIn).getTime() : NaN;
  const eventTime = new Date(timestamp).getTime();
  const workMinutes = direction === 'OUT' && Number.isFinite(firstTime) && eventTime >= firstTime
    ? Math.round((eventTime - firstTime) / 60000)
    : 0;
  const rawOvertime = direction === 'OUT'
    ? workDay ? Math.max(0, local.minuteOfDay - close) : workMinutes
    : 0;
  const overtimeMinutes = rawOvertime >= policy.OvertimeMinimumMinutes ? rawOvertime : 0;
  const earlyDepartureMinutes = direction === 'OUT' && workDay ? Math.max(0, close - local.minuteOfDay) : 0;
  const existingStatus = clean(eventInput.ExistingStatus);
  const status = direction === 'IN'
    ? workDay ? lateMinutes ? 'Late' : 'Present' : 'Overtime day'
    : existingStatus || (firstClockIn ? workDay ? 'Present' : 'Overtime day' : 'Incomplete');
  return {
    Date: local.date,
    Day: local.day,
    WorkDay: workDay,
    ScheduledResumptionTime: schedule?.ResumptionTime || policy.ResumptionTime,
    ScheduledClosingTime: schedule?.ClosingTime || policy.ClosingTime,
    AttendanceStatus: status,
    LateMinutes: lateMinutes,
    OvertimeMinutes: overtimeMinutes,
    EarlyDepartureMinutes: earlyDepartureMinutes,
    WorkMinutes: workMinutes
  };
}

export function haversineDistanceMetres(lat1, lon1, lat2, lon2) {
  const values = [lat1, lon1, lat2, lon2].map(number);
  if (values.some((value) => !Number.isFinite(value))) return Infinity;
  const [aLat, aLon, bLat, bLon] = values.map((value) => value * Math.PI / 180);
  const deltaLat = bLat - aLat;
  const deltaLon = bLon - aLon;
  const hav = Math.sin(deltaLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(deltaLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

export function normalizeAttendanceSite(input = {}, existing = {}) {
  const name = clean(input.Name || input.SiteName || existing.Name);
  const latitude = number(input.Latitude ?? existing.Latitude);
  const longitude = number(input.Longitude ?? existing.Longitude);
  const radius = number(input.RadiusMetres ?? existing.RadiusMetres ?? 150);
  const maxAccuracy = number(input.MaxAccuracyMetres ?? existing.MaxAccuracyMetres ?? 100);
  const policy = clean(input.Policy || existing.Policy || 'GEOFENCE_OR_NETWORK').toUpperCase();
  const allowedPolicies = new Set(['GEOFENCE_ONLY', 'NETWORK_ONLY', 'GEOFENCE_OR_NETWORK']);
  if (!name) fail('Enter a location name.');
  if ((!Number.isFinite(latitude) || !Number.isFinite(longitude)) && policy !== 'NETWORK_ONLY') {
    fail('Enter valid latitude and longitude for this attendance location.');
  }
  if (!Number.isFinite(radius) || radius < 20 || radius > 5000) fail('The allowed radius must be between 20 and 5,000 metres.');
  if (!Number.isFinite(maxAccuracy) || maxAccuracy < 10 || maxAccuracy > 2000) fail('Maximum location accuracy must be between 10 and 2,000 metres.');
  if (!allowedPolicies.has(policy)) fail('Choose a valid attendance verification policy.');
  const ips = Array.isArray(input.AllowedPublicIps)
    ? input.AllowedPublicIps
    : clean(input.AllowedPublicIps ?? existing.AllowedPublicIps).split(/[\s,]+/);
  return {
    Name: name,
    Latitude: Number.isFinite(latitude) ? latitude : null,
    Longitude: Number.isFinite(longitude) ? longitude : null,
    RadiusMetres: radius,
    MaxAccuracyMetres: maxAccuracy,
    Policy: policy,
    AllowedPublicIps: [...new Set(ips.map(clean).filter(Boolean))],
    Active: lower(input.Active ?? existing.Active ?? 'YES') === 'no' ? 'NO' : 'YES'
  };
}

export function evaluateAttendancePresence(site = {}, location = {}, clientIp = '') {
  const policy = clean(site.Policy || 'GEOFENCE_OR_NETWORK').toUpperCase();
  const accuracy = number(location.Accuracy ?? location.accuracy);
  const distance = haversineDistanceMetres(
    site.Latitude,
    site.Longitude,
    location.Latitude ?? location.latitude,
    location.Longitude ?? location.longitude
  );
  const geofencePassed = Number.isFinite(distance)
    && distance <= number(site.RadiusMetres || 150)
    && Number.isFinite(accuracy)
    && accuracy <= number(site.MaxAccuracyMetres || 100);
  const networkPassed = (site.AllowedPublicIps || []).map(clean).includes(clean(clientIp));
  const passed = policy === 'GEOFENCE_ONLY'
    ? geofencePassed
    : policy === 'NETWORK_ONLY'
      ? networkPassed
      : geofencePassed || networkPassed;
  return {
    passed,
    geofencePassed,
    networkPassed,
    distanceMetres: Number.isFinite(distance) ? Math.round(distance) : null,
    accuracyMetres: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
    verificationMethod: geofencePassed ? 'Geofence' : networkPassed ? 'Organisation network' : 'Not verified'
  };
}

function verifiedAttendanceIdentity(policy = {}, proof = null) {
  const required = clean(policy.IdentityVerification || 'NONE').toUpperCase();
  if (required === 'NONE') return 'Session identity';
  const method = lower(proof?.method);
  const accepted = required === 'FACE' ? method === 'face' : method === 'passkey';
  if (!accepted) {
    const verification = required === 'FACE'
      ? 'live face recognition'
      : 'the device unlock prompt';
    fail(`Verify your identity with ${verification} before completing this attendance action.`, 403);
  }
  if (method !== 'face') return 'Device unlock';
  const actionLabels = {
    BLINK: 'blink challenge',
    TURN_LEFT: 'left-turn challenge',
    TURN_RIGHT: 'right-turn challenge',
    CHIN_UP: 'chin-up challenge'
  };
  const livenessLabel = actionLabels[clean(proof?.livenessAction).toUpperCase()];
  return livenessLabel ? `Live face recognition (${livenessLabel})` : 'Live face recognition';
}

async function ipFingerprint(value) {
  const data = new TextEncoder().encode(clean(value));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

function attendancePolicyPath(env, branchId) {
  return staffAttendanceCollectionPath(env, 'policy', branchId);
}

function dailyAttendancePath(env, branchId) {
  return staffAttendanceCollectionPath(env, 'daily', branchId);
}

function dailyAttendanceId(date, username) {
  return safeStaffAttendanceDocumentId(`DAY-${date}-${lower(username)}`);
}

function canonicalWritePrecondition(record) {
  if (!record || record.__legacyStorage) return { exists: false };
  return record.__updateTime ? { updateTime: record.__updateTime } : {};
}

function randomWholeNumber(minimum, maximum) {
  const min = Math.ceil(Number(minimum));
  const max = Math.floor(Number(maximum));
  if (max <= min) return min;
  const values = crypto.getRandomValues(new Uint32Array(1));
  return min + (values[0] % (max - min + 1));
}

function nextPresenceCheckAt(policy = {}, timestamp = nowIso()) {
  if (clean(policy.PresenceCheckMode).toUpperCase() !== 'RANDOM') return '';
  const minutes = randomWholeNumber(policy.PresenceCheckMinimumMinutes, policy.PresenceCheckMaximumMinutes);
  return new Date(new Date(timestamp).getTime() + (minutes * 60000)).toISOString();
}

function presenceCheckView(policy = {}, state = {}, active, now = new Date()) {
  if (!active || clean(policy.PresenceCheckMode).toUpperCase() !== 'RANDOM') {
    return { enabled: false, status: 'NOT_REQUIRED', dueAt: '', graceEndsAt: '', canConfirm: false };
  }
  const dueAt = clean(state.NextPresenceCheckDueAt);
  if (!dueAt) return { enabled: true, status: 'PENDING_SETUP', dueAt: '', graceEndsAt: '', canConfirm: false };
  const dueTime = Date.parse(dueAt);
  const graceEndsAt = new Date(dueTime + (Number(policy.PresenceCheckGraceMinutes || 0) * 60000)).toISOString();
  const nowTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return {
    enabled: true,
    status: nowTime < dueTime ? 'UPCOMING' : nowTime <= Date.parse(graceEndsAt) ? 'DUE' : 'OVERDUE',
    dueAt,
    graceEndsAt,
    canConfirm: nowTime >= dueTime,
    lastConfirmedAt: clean(state.LastPresenceCheckAt),
    sequence: Number(state.PresenceCheckSequence || 0)
  };
}

function staffBranchMatches(row = {}, branchId = 'main') {
  return lower(row.BranchId || row.branchId || 'main') === lower(branchId || 'main');
}

function activeStaffValue(value) {
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(value));
}

export function staffAttendanceDirectoryFor(staffUsers = [], employees = [], user = {}, branchId = 'main') {
  const exited = new Set(employees.filter((row) => attendanceHrRecordMatchesScope(row, staffUsers, user, branchId)
    && /exited|terminated/i.test(clean(row.Status))).map((row) => lower(row.Username)));
  const identities = new Map();
  for (const row of staffUsers) {
    const username = lower(row.Username || row.__id);
    if (!username || identities.has(username) || !staffRecordMatchesEdition(row, user)
      || !staffBranchMatches(row, branchId)
      || !activeStaffValue(row.Active === undefined ? true : row.Active) || exited.has(username)) continue;
    const employment = staffEmploymentDetails(row, employees, user.edition || 'school');
    identities.set(username, {
      Username: username,
      DisplayName: clean(employment.DisplayName || row.DisplayName || row.Username || row.__id),
      Role: clean(row.Role),
      Department: clean(employment.Department || row.Department),
      Position: clean(employment.Position || row.Position)
    });
  }
  return [...identities.values()].sort((a, b) => a.DisplayName.localeCompare(b.DisplayName));
}

export function automaticAbsenceCandidates(directory = [], dailyRows = [], date = '') {
  const current = dailyRows.filter((row) => clean(row.Date) === date);
  const currentUsernames = new Set(current.map((row) => lower(row.Username)));
  const occupiedIds = new Set(current.map((row) => clean(row.DailyId || row.__id) || dailyAttendanceId(date, row.Username)));
  const groups = new Map();
  for (const row of directory) {
    const username = lower(row.Username);
    if (!username) continue;
    const id = dailyAttendanceId(date, username);
    if (!groups.has(id)) groups.set(id, new Map());
    if (!groups.get(id).has(username)) groups.get(id).set(username, { ...row, Username: username });
  }
  const candidates = [];
  const processingWarnings = [];
  for (const [id, identities] of groups) {
    // Legacy sanitization can map different usernames to one ID. Never merge
    // those people or pick one arbitrarily; leave their records for HR review.
    if (identities.size > 1) {
      processingWarnings.push(`Automatic absence skipped for conflicting staff record IDs: ${[...identities.keys()].join(', ')}. Ask HR to review these usernames; existing attendance is unchanged.`);
      continue;
    }
    const row = identities.values().next().value;
    if (currentUsernames.has(row.Username)) continue;
    if (occupiedIds.has(id)) {
      processingWarnings.push(`Automatic absence skipped for ${row.Username}: the stored daily record ID belongs to another staff identity. Ask HR to review this username; existing attendance is unchanged.`);
      continue;
    }
    candidates.push(row);
  }
  return { candidates, processingWarnings };
}

function attendancePolicySnapshot(policy = {}, day = '') {
  if (policy.ShiftSnapshot) {
    const shift = policy.ShiftSnapshot;
    return { ShiftSnapshot: { ...shift }, AttendanceGroupId: shift.GroupId, AttendanceGroupName: shift.GroupName,
      ScheduledStartAt: shift.StartAt, ScheduledEndAt: shift.EndAt,
      ScheduledResumptionTime: shift.ResumptionTime, ScheduledClosingTime: shift.ClosingTime,
      GraceMinutes: shift.GraceMinutes, ClockInOpenMinutesBefore: shift.ClockInOpenMinutesBefore,
      OvertimeMinimumMinutes: shift.OvertimeMinimumMinutes, TimeZone: shift.TimeZone };
  }
  const schedule = policy.DaySchedules?.[clean(day).slice(0, 3).toUpperCase()] || {};
  return {
    ScheduledResumptionTime: clean(schedule.ResumptionTime || policy.ResumptionTime),
    ScheduledClosingTime: clean(schedule.ClosingTime || policy.ClosingTime),
    GraceMinutes: Number(policy.GraceMinutes || 0),
    ClockInOpenMinutesBefore: Number(policy.ClockInOpenMinutesBefore || 0),
    OvertimeMinimumMinutes: Number(policy.OvertimeMinimumMinutes || 0),
    TimeZone: clean(policy.TimeZone)
  };
}

function buildDailyAttendanceFromEvent(policy, event, existing = {}) {
  const shift = existing.ShiftSnapshot || event.ShiftSnapshot || policy.ShiftSnapshot;
  if (shift) policy = effectiveShiftPolicy(policy, shift);
  const { __id: _documentId, __createTime: _createdAt, __updateTime: _updatedAt, ...storedExisting } = existing;
  const storedFirstClockIn = clean(existing.FirstClockIn);
  const storedLastClockOut = clean(existing.LastClockOut);
  const correction = event.ManualOverride === true;
  const firstClockIn = event.Direction === 'IN'
    ? correction || !storedFirstClockIn || event.Timestamp < storedFirstClockIn ? event.Timestamp : storedFirstClockIn
    : storedFirstClockIn;
  const lastClockOut = event.Direction === 'OUT'
    ? correction || !storedLastClockOut || event.Timestamp > storedLastClockOut ? event.Timestamp : storedLastClockOut
    : storedLastClockOut;
  if (correction && firstClockIn && lastClockOut && firstClockIn > lastClockOut) {
    fail('Clock-in must not be later than clock-out. Correct the other time first.');
  }
  const metrics = calculateAttendanceMetrics(policy, {
    Direction: event.Direction,
    Timestamp: event.Direction === 'OUT' ? lastClockOut : firstClockIn,
    FirstClockIn: firstClockIn,
    ExistingStatus: event.Direction === 'OUT' ? existing.AttendanceStatus : ''
  });
  const id = dailyAttendanceId(metrics.Date, event.Username);
  const inMetrics = correction && firstClockIn
    ? calculateAttendanceMetrics(policy, { Direction: 'IN', Timestamp: firstClockIn }) : null;
  const outMetrics = correction && lastClockOut
    ? calculateAttendanceMetrics(policy, { Direction: 'OUT', Timestamp: lastClockOut, FirstClockIn: firstClockIn,
      ExistingStatus: inMetrics?.AttendanceStatus || '' }) : null;
  const correctedMetrics = outMetrics || inMetrics;
  const scheduleActive = lower(policy.Active) !== 'no';
  return {
    ...storedExisting,
    DailyId: id,
    BranchId: event.BranchId,
    Date: metrics.Date,
    Day: metrics.Day,
    Username: event.Username,
    DisplayName: event.DisplayName,
    Role: event.Role || clean(existing.Role),
    AttendanceStatus: scheduleActive ? (correctedMetrics || metrics).AttendanceStatus : clean(existing.AttendanceStatus) || 'Recorded',
    FirstClockIn: firstClockIn,
    LastClockOut: lastClockOut,
    LateMinutes: correction ? (scheduleActive ? Number(inMetrics?.LateMinutes || 0) : 0)
      : scheduleActive && event.Direction === 'IN' ? metrics.LateMinutes : Number(existing.LateMinutes || 0),
    OvertimeMinutes: correction ? (scheduleActive ? Number(outMetrics?.OvertimeMinutes || 0) : 0)
      : scheduleActive && event.Direction === 'OUT' ? metrics.OvertimeMinutes : Number(existing.OvertimeMinutes || 0),
    EarlyDepartureMinutes: correction ? (scheduleActive ? Number(outMetrics?.EarlyDepartureMinutes || 0) : 0)
      : scheduleActive && event.Direction === 'OUT' ? metrics.EarlyDepartureMinutes : Number(existing.EarlyDepartureMinutes || 0),
    WorkMinutes: correction ? Number(outMetrics?.WorkMinutes || 0)
      : event.Direction === 'OUT' ? metrics.WorkMinutes : Number(existing.WorkMinutes || 0),
    PresenceCheckCount: Number(existing.PresenceCheckCount || 0),
    MissedPresenceChecks: Number(existing.MissedPresenceChecks || 0),
    PresenceStatus: clean(existing.PresenceStatus) || (clean(policy.PresenceCheckMode).toUpperCase() === 'RANDOM' ? 'Awaiting random check' : 'Not required'),
    LastPresenceCheckAt: clean(existing.LastPresenceCheckAt),
    ...attendancePolicySnapshot(policy, metrics.Day),
    AutoGenerated: false,
    GeneratedReason: '',
    CreatedAt: clean(existing.CreatedAt) || event.Timestamp,
    UpdatedAt: event.Timestamp,
    UpdatedBy: event.ManualOverride ? event.RecordedBy : event.DisplayName
  };
}

function approvedLeaveForDate(leaveRows = [], username, date) {
  return leaveRows.some((row) => lower(row.Username) === lower(username)
    && lower(row.Status) === 'approved'
    && clean(row.StartDate) <= date
    && clean(row.EndDate) >= date);
}

export async function synchronizeAutomaticAbsences(env, branchId, policy, now, directory, leaveRows, dailyRows, dependencies = {}) {
  const commit = dependencies.batchCommitDocuments || batchCommitDocuments;
  const query = dependencies.queryStaffAttendanceCollection || queryStaffAttendanceCollection;
  if (lower(policy.Active) === 'no' || lower(policy.AutoRecordAbsence) === 'no') return { dailyRows, processingWarnings: [] };
  const local = localAttendanceParts(now, policy.TimeZone);
  const schedule = policy.DaySchedules?.[local.day];
  if (!schedule?.Enabled || local.minuteOfDay < timeMinutes(schedule.ClosingTime, 'Closing time')) return { dailyRows, processingWarnings: [] };
  const current = dailyRows.filter((row) => clean(row.Date) === local.date);
  const { candidates, processingWarnings } = automaticAbsenceCandidates(directory, dailyRows, local.date);
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const created = candidates.map((row) => {
    const onLeave = approvedLeaveForDate(leaveRows, row.Username, local.date);
    const id = dailyAttendanceId(local.date, row.Username);
    return {
      DailyId: id,
      BranchId: branchId,
      Date: local.date,
      Day: local.day,
      Username: lower(row.Username),
      DisplayName: clean(row.DisplayName || row.Username),
      Role: clean(row.Role),
      AttendanceStatus: onLeave ? 'Approved leave' : 'Absent',
      FirstClockIn: '',
      LastClockOut: '',
      LateMinutes: 0,
      OvertimeMinutes: 0,
      EarlyDepartureMinutes: 0,
      WorkMinutes: 0,
      ...attendancePolicySnapshot(policy, local.day),
      AutoGenerated: true,
      GeneratedReason: onLeave ? 'Approved leave covers this working day.' : 'No clock-in was recorded by the configured closing time.',
      CreatedAt: timestamp,
      UpdatedAt: timestamp,
      UpdatedBy: 'Automatic attendance processing'
    };
  });
  if (!created.length) return { dailyRows, processingWarnings };
  let conflict = false;
  for (let index = 0; index < created.length; index += 400) {
    const chunk = created.slice(index, index + 400);
    try {
      await commit(env, chunk.map((row) => ({
        collectionPath: dailyAttendancePath(env, branchId),
        documentId: row.DailyId,
        data: row,
        exists: false
      })));
    } catch (error) {
      if (![409, 412].includes(Number(error?.status))) throw error;
      conflict = true;
    }
  }
  if (!conflict) return { dailyRows: [...created, ...dailyRows], processingWarnings };
  const refreshed = await query(env, 'daily', branchId, {
    filters: [{ field: 'Date', op: '==', value: local.date }],
    limit: 500
  }).catch(() => current);
  return { dailyRows: [...refreshed, ...dailyRows.filter((row) => clean(row.Date) !== local.date)], processingWarnings };
}

export async function synchronizeRosterAbsences(env, branchId, policy, roster, now, directory, leaveRows, dailyRows, dependencies = {}) {
  const local = localAttendanceParts(now, policy.TimeZone);
  const ordinary = directory.filter(row => !attendanceGroupFor(roster, row.Username, local.date));
  const legacy = await synchronizeAutomaticAbsences(env, branchId, policy, now, ordinary, leaveRows, dailyRows, dependencies);
  if (lower(policy.AutoRecordAbsence) === 'no') return legacy;
  const commit = dependencies.batchCommitDocuments || batchCommitDocuments;
  const query = dependencies.queryStaffAttendanceCollection || queryStaffAttendanceCollection;
  const instant = new Date(now).getTime();
  let rows = legacy.dailyRows;
  const warnings = [...legacy.processingWarnings];
  // Group duties can last up to 48 hours. Check their start dates, not the
  // calendar date of clock-out. Rest days never generate absence records.
  for (let offset = -2; offset <= 0; offset++) {
    const date = addAttendanceDays(local.date, offset);
    const candidatesByName = new Map();
    for (const member of directory) {
      if (!attendanceGroupFor(roster, member.Username, date)) continue;
      const shift = attendanceShiftForDate(policy, roster, member.Username, date);
      if (shift?.GroupId && instant >= Date.parse(shift.EndAt)) candidatesByName.set(member.Username, { member, shift });
    }
    const { candidates, processingWarnings } = automaticAbsenceCandidates([...candidatesByName.values()].map(row => row.member), rows, date);
    warnings.push(...processingWarnings);
    const timestamp = new Date(now).toISOString();
    const created = candidates.map(member => {
      const shift = candidatesByName.get(member.Username).shift;
      const leave = approvedLeaveForDate(leaveRows, member.Username, date);
      return { DailyId: dailyAttendanceId(date, member.Username), BranchId: branchId, Date: date, Day: shift.Day,
        Username: member.Username, DisplayName: member.DisplayName, Role: member.Role,
        AttendanceStatus: leave ? 'Approved leave' : 'Absent', FirstClockIn: '', LastClockOut: '',
        LateMinutes: 0, OvertimeMinutes: 0, EarlyDepartureMinutes: 0, WorkMinutes: 0,
        ...attendancePolicySnapshot(effectiveShiftPolicy(policy, shift), shift.Day), AutoGenerated: true,
        GeneratedReason: leave ? 'Approved leave covers this shift.' : 'No clock-in was recorded by the assigned shift end.',
        CreatedAt: timestamp, UpdatedAt: timestamp, UpdatedBy: 'Automatic attendance processing' };
    });
    for (let start = 0; start < created.length; start += 400) {
      const chunk = created.slice(start, start + 400);
      try {
        await commit(env, chunk.map(row => ({ collectionPath: dailyAttendancePath(env, branchId), documentId: row.DailyId, data: row, exists: false })));
        rows = [...chunk, ...rows];
      } catch (error) {
        if (![409, 412].includes(Number(error?.status))) throw error;
        const refreshed = await query(env, 'daily', branchId, { filters: [{ field: 'Date', op: '==', value: date }], limit: ATTENDANCE_REPORT_LIMIT });
        rows = [...refreshed, ...rows.filter(row => row.Date !== date)];
        warnings.push('Attendance changed while calculating shift absences. Refresh to complete the remaining checks.');
      }
    }
  }
  return { dailyRows: rows, processingWarnings: [...new Set(warnings)] };
}

async function ensurePresenceNotificationSchedule(env, statePath, username, policy = {}, state = {}, presenceCheck = {}) {
  const dueAt = clean(presenceCheck.dueAt || state.NextPresenceCheckDueAt);
  const pushEnabled = clean(policy.PresenceCheckPushEnabled).toUpperCase() !== 'NO';
  if (!pushEnabled || !presenceCheck.enabled || !dueAt) return;
  if (clean(state.PresenceNotificationSentForDueAt) === dueAt || clean(state.NextPresenceNotificationAt) === dueAt) return;
  const fields = {
    NextPresenceNotificationAt: dueAt,
    PresenceNotificationTrackingVersion: 1
  };
  const write = state.__legacyStorage
    ? upsertDocument(env, statePath, safeStaffAttendanceDocumentId(username), { ...staffAttendanceDocumentData(state), ...fields })
    : patchDocumentFields(env, statePath, staffAttendanceWriteDocumentId(state, safeStaffAttendanceDocumentId(username)), fields, state.__updateTime ? { updateTime: state.__updateTime } : {});
  await write.catch((error) => {
    if (![409, 412].includes(Number(error?.status))) throw error;
  });
}

function effectiveShiftPolicy(base, shift) {
  if (!shift) return base;
  return { ...base, Active: shift.Active || 'YES', GraceMinutes: shift.GraceMinutes,
    ClockInOpenMinutesBefore: shift.ClockInOpenMinutesBefore,
    OvertimeMinimumMinutes: shift.OvertimeMinimumMinutes, ShiftSnapshot: shift };
}

function recordedDefaultShift(policy, daily, username, date) {
  const day = localAttendanceParts(daily.FirstClockIn, daily.TimeZone || policy.TimeZone).day;
  const savedPolicy = { ...policy, TimeZone: daily.TimeZone || policy.TimeZone,
    Active: daily.AttendanceStatus === 'Recorded' ? 'NO' : 'YES',
    GraceMinutes: daily.GraceMinutes ?? policy.GraceMinutes,
    ClockInOpenMinutesBefore: daily.ClockInOpenMinutesBefore ?? policy.ClockInOpenMinutesBefore,
    OvertimeMinimumMinutes: daily.OvertimeMinimumMinutes ?? policy.OvertimeMinimumMinutes,
    DaySchedules: { ...policy.DaySchedules, [day]: { Enabled: true,
      ResumptionTime: daily.ScheduledResumptionTime || policy.ResumptionTime,
      ClosingTime: daily.ScheduledClosingTime || policy.ClosingTime, EndDayOffset: 0 } } };
  return { ...attendanceShiftForDate(savedPolicy, {}, username, date), ScheduleType: 'DEFAULT',
    WorkDay: daily.AttendanceStatus !== 'Overtime day' };
}

// An open group shift belongs to its start date, even after midnight or after
// an administrator reassigns its owner. Only the server-stored snapshot wins.
async function personalAttendanceContext(env, branchId, username, options = {}) {
  const timestamp = options.timestamp || nowIso();
  const [policy, roster, storedState] = await Promise.all([
    options.policy || getStaffAttendanceDocument(env, 'policy', branchId, 'default')
      .then(row => normalizeAttendancePolicy(row || { Active: 'NO' })),
    options.roster || loadAttendanceRoster(env, branchId),
    options.storedState === undefined
      ? getStaffAttendanceDocument(env, 'state', branchId, safeStaffAttendanceDocumentId(username)) : options.storedState
  ]);
  const local = localAttendanceParts(timestamp, policy.TimeZone);
  const assignedGroup = attendanceGroupFor(roster, username, local.date);
  let openShift = clean(storedState?.State) === 'CLOCKED_IN' && storedState?.ShiftSnapshot
    ? storedState.ShiftSnapshot : null;
  let openDaily = null;
  if (!openShift && assignedGroup && clean(storedState?.State) === 'CLOCKED_IN' && storedState.AttendanceDate) {
    openDaily = await getStaffAttendanceDocument(env, 'daily', branchId, dailyAttendanceId(storedState.AttendanceDate, username));
    if (openDaily?.FirstClockIn && !openDaily.LastClockOut) {
      openShift = openDaily.ShiftSnapshot || recordedDefaultShift(policy, openDaily, username, storedState.AttendanceDate);
    }
  }
  // Resolve a new assignment only after checking the saved open duty. A later
  // schedule edit must never prevent clock-out or recalculate that duty.
  const scheduled = openShift || resolveAttendanceShift(policy, roster, username, timestamp);
  let currentShift = openShift || (scheduled?.GroupId ? scheduled : null);
  const date = currentShift?.AttendanceDate || local.date;
  const dailyId = dailyAttendanceId(date, username);
  const existingDaily = openDaily && openDaily.Date === date ? openDaily
    : await getStaffAttendanceDocument(env, 'daily', branchId, dailyId);
  if (openShift && (!existingDaily?.FirstClockIn || existingDaily.LastClockOut)) {
    fail('The open shift and attendance record disagree. Ask HR to review this attendance record.', 409);
  }
  if (existingDaily?.ShiftSnapshot) currentShift = existingDaily.ShiftSnapshot;
  else if (assignedGroup && existingDaily?.FirstClockIn) currentShift = recordedDefaultShift(policy, existingDaily, username, date);
  const grouped = Boolean(currentShift?.GroupId || assignedGroup);
  const state = clean(existingDaily?.FirstClockIn)
    ? clean(existingDaily?.LastClockOut) ? 'COMPLETED' : 'CLOCKED_IN'
    : grouped && (!currentShift || Date.parse(timestamp) >= Date.parse(currentShift.EndAt)) ? 'OFF_DUTY' : 'CLOCKED_OUT';
  const today = { ...local, date, day: currentShift?.Day || local.day };
  const myPolicy = effectiveShiftPolicy(policy, currentShift);
  const todayState = clean(storedState?.AttendanceDate) === date ? storedState : {};
  return { policy: myPolicy, basePolicy: policy, roster, today, currentShift, assignedGroup,
    attendanceDate: date, todayCalendarDate: local.date, existingDaily, storedState, dailyId, grouped, state,
    nextDirection: state === 'CLOCKED_IN' ? 'OUT' : state === 'CLOCKED_OUT' ? 'IN' : '',
    todaySchedule: currentShift ? { Enabled: true, ResumptionTime: currentShift.ResumptionTime,
      ClosingTime: currentShift.ClosingTime, EndDayOffset: currentShift.EndDayOffset }
      : grouped ? { Enabled: false } : policy.DaySchedules?.[today.day] || null,
    presenceCheck: presenceCheckView(myPolicy, todayState, state === 'CLOCKED_IN') };
}

export async function getStaffAttendanceQuickState(env, user, body = {}) {
  const branchId = branchFor(user, body);
  const username = actorId(user);
  if (!username) fail('The signed-in staff account has no username.', 401);
  const policyDocumentPromise = getStaffAttendanceDocument(env, 'policy', branchId, 'default');
  const sitesPromise = listStaffAttendanceCollection(env, 'sites', branchId);
  const storedPolicy = await policyDocumentPromise;
  const policy = normalizeAttendancePolicy(storedPolicy || { Active: 'NO' });
  const statePath = staffAttendanceCollectionPath(env, 'state', branchId);
  const [sites, workspace] = await Promise.all([sitesPromise, personalAttendanceContext(env, branchId, username, { policy })]);
  const { today, state, presenceCheck, existingDaily: todayDaily, storedState } = workspace;
  await ensurePresenceNotificationSchedule(env, statePath, username, workspace.policy, storedState || {}, presenceCheck);
  return {
    ok: true,
    branchId,
    sites: sites
      .filter((row) => lower(row.Active || 'YES') !== 'no')
      .sort((a, b) => clean(a.Name).localeCompare(clean(b.Name))),
    policy: workspace.policy,
    myPolicy: workspace.policy,
    currentShift: workspace.currentShift,
    selfgroup: workspace.assignedGroup ? { GroupId: workspace.assignedGroup.GroupId, Name: workspace.assignedGroup.Name } : null,
    todayCalendarDate: workspace.todayCalendarDate,
    attendanceDate: workspace.attendanceDate,
    policyConfigured: Boolean(storedPolicy),
    todayAttendanceDate: today.date,
    todayAttendanceDay: today.day,
    todaySchedule: workspace.todaySchedule,
    todayDaily: todayDaily || null,
    state,
    nextDirection: workspace.nextDirection,
    presenceCheck
  };
}

export async function getStaffAttendancePresenceState(env, user, body = {}) {
  const branchId = branchFor(user, body);
  const username = actorId(user);
  if (!username) fail('The signed-in staff account has no username.', 401);
  const storedState = await getCanonicalStaffAttendanceDocument(
    env,
    'state',
    branchId,
    safeStaffAttendanceDocumentId(username)
  );
  return {
    ok: true,
    branchId,
    attendanceDate: clean(storedState?.AttendanceDate),
    state: clean(storedState?.State || 'CLOCKED_OUT').toUpperCase(),
    nextPresenceCheckDueAt: clean(storedState?.NextPresenceCheckDueAt),
    lastPresenceCheckAt: clean(storedState?.LastPresenceCheckAt),
    presenceCheckSequence: Number(storedState?.PresenceCheckSequence || 0)
  };
}

export async function listStaffAttendance(env, user, body = {}) {
  const branchId = branchFor(user, body);
  const username = actorId(user);
  if (!username) fail('The signed-in staff account has no username.', 401);
  const canManage = canManageStaffAttendance(user);
  const canReport = canReportStaffAttendance(user);
  const reportPeriod = canReport ? normalizeAttendanceReportPeriod(body) : { FromDate: '', ToDate: '' };
  // These reads precede automatic absence writes. A failed HR/leave read must
  // not turn an exited employee or approved leave into a persisted absence.
  const [sites, events, storedState, storedPolicy, dailySource, staffUsers, employees, leaveRows, roster] = await Promise.all([
    listStaffAttendanceCollection(env, 'sites', branchId),
    queryStaffAttendanceCollection(env, 'events', branchId, {
      orderBy: [{ field: 'Timestamp', direction: 'DESCENDING' }],
      limit: 500
    }),
    getStaffAttendanceDocument(env, 'state', branchId, safeStaffAttendanceDocumentId(username)),
    getStaffAttendanceDocument(env, 'policy', branchId, 'default'),
    queryStaffAttendanceCollection(env, 'daily', branchId, {
      orderBy: [{ field: 'Date', direction: 'DESCENDING' }],
      limit: 500
    }),
    listCollection(env, 'staffUsers'),
    listCollection(env, 'hrEmployees'),
    listCollection(env, 'hrLeaveRequests'),
    loadAttendanceRoster(env, branchId)
  ]);
  const policy = normalizeAttendancePolicy(storedPolicy || { Active: 'NO' });
  const directory = staffAttendanceDirectoryFor(staffUsers, employees, user, branchId);
  const scopedLeaveRows = leaveRows.filter((row) => attendanceHrRecordMatchesScope(row, staffUsers, user, branchId));
  const { dailyRows, processingWarnings } = await synchronizeRosterAbsences(env, branchId, policy, roster, new Date(), directory, scopedLeaveRows, dailySource);
  const sorted = events.sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp)));
  const sortedDaily = dailyRows.sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)) || clean(a.DisplayName).localeCompare(clean(b.DisplayName)));
  let reportDailyRows = sortedDaily;
  if (canReport && reportPeriod.FromDate) {
    reportDailyRows = await queryStaffAttendanceCollection(env, 'daily', branchId, {
      filters: [
        { field: 'Date', op: '>=', value: reportPeriod.FromDate },
        { field: 'Date', op: '<=', value: reportPeriod.ToDate }
      ],
      orderBy: [{ field: 'Date', direction: 'DESCENDING' }],
      limit: ATTENDANCE_REPORT_LIMIT
    });
    reportDailyRows.sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)) || clean(a.DisplayName).localeCompare(clean(b.DisplayName)));
  }
  const sortedSites = sites.sort((a, b) => clean(a.Name).localeCompare(clean(b.Name)));
  const own = sorted.filter((row) => actorId(row) === username).slice(0, 100);
  const ownDaily = sortedDaily.filter((row) => actorId(row) === username).slice(0, 100);
  const latest = own[0] || null;
  const personal = await personalAttendanceContext(env, branchId, username, { policy, roster, storedState });
  if (personal.existingDaily && !ownDaily.some(row => row.Date === personal.attendanceDate)) ownDaily.unshift(personal.existingDaily);
  const todayLocal = personal.today;
  const todayAttendanceDate = personal.attendanceDate;
  const todayState = personal.state;
  const presenceCheck = personal.presenceCheck;
  await ensurePresenceNotificationSchedule(
    env,
    staffAttendanceCollectionPath(env, 'state', branchId),
    username,
    personal.policy,
    storedState || {},
    presenceCheck
  );
  return {
    ok: true,
    branchId,
    sites: sortedSites.filter((row) => lower(row.Active || 'YES') !== 'no'),
    configuredSites: canManage ? sortedSites : [],
    policy,
    myPolicy: personal.policy,
    currentShift: personal.currentShift,
    selfgroup: personal.assignedGroup ? { GroupId: personal.assignedGroup.GroupId, Name: personal.assignedGroup.Name } : null,
    todayCalendarDate: personal.todayCalendarDate,
    attendanceDate: personal.attendanceDate,
    roster: canManage ? { Revision: clean(roster.Revision), Groups: roster.Groups || [], Assignments: roster.Assignments || [] } : undefined,
    policyConfigured: Boolean(storedPolicy),
    todayAttendanceDate,
    todayAttendanceDay: todayLocal.day,
    todaySchedule: personal.todaySchedule,
    staffDirectory: canManage ? directory : [],
    processingWarnings: canReport ? processingWarnings : [],
    myEvents: own,
    myDailyRecords: ownDaily,
    recentEvents: canReport ? sorted.slice(0, 250) : [],
    recentDailyRecords: canReport ? reportDailyRows : [],
    reportPeriod,
    reportTruncated: canReport && reportDailyRows.length >= ATTENDANCE_REPORT_LIMIT,
    state: todayState,
    nextDirection: personal.nextDirection,
    stateVersion: clean(storedState?.__updateTime),
    presenceCheck,
    capabilities: {
      canManage,
      canReport,
      canMigrateStorage: clean(user.role || user.Role) === 'Super Admin'
    }
  };
}

export async function saveAttendanceSite(env, user, body = {}) {
  if (!canManageStaffAttendance(user)) fail('Only organisation or HR attendance administrators can manage attendance locations.', 403);
  const branchId = branchFor(user, body);
  const id = safeStaffAttendanceDocumentId(clean(body.SiteId) || `SITE-${crypto.randomUUID().slice(0, 8)}`);
  const collectionPath = staffAttendanceCollectionPath(env, 'sites', branchId);
  const existing = await getStaffAttendanceDocument(env, 'sites', branchId, id);
  const site = {
    SiteId: id,
    ...normalizeAttendanceSite(body, existing || {}),
    BranchId: branchId,
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  await upsertDocument(env, collectionPath, staffAttendanceWriteDocumentId(existing, id), site);
  return { ok: true, site, message: 'Attendance location saved.' };
}

export async function deleteAttendanceSite(env, user, body = {}) {
  if (!canManageStaffAttendance(user)) fail('Only organisation or HR attendance administrators can delete attendance locations.', 403);
  const branchId = branchFor(user, body);
  const id = safeStaffAttendanceDocumentId(body.SiteId);
  if (!id) fail('Choose the attendance location to delete.');
  const existing = await getStaffAttendanceDocument(env, 'sites', branchId, id);
  if (!existing) fail('The attendance location no longer exists.', 404);
  await batchCommitDocuments(env, staffAttendanceReadPaths(env, 'sites', branchId).map((collectionPath) => ({
    collectionPath,
    documentId: existing.__storagePath === collectionPath ? clean(existing.__id) || id : id,
    operation: 'delete'
  })));
  return {
    ok: true,
    siteId: id,
    message: `${clean(existing.Name) || 'Attendance location'} deleted. Existing attendance history is unchanged.`
  };
}

export async function saveAttendancePolicy(env, user, body = {}) {
  if (!canManageStaffAttendance(user)) fail('Only organisation or HR attendance administrators can manage daily work hours.', 403);
  const branchId = branchFor(user, body);
  const existing = await getStaffAttendanceDocument(env, 'policy', branchId, 'default');
  const normalized = normalizeAttendancePolicy(body, existing || {});
  const policy = {
    PolicyId: 'default',
    BranchId: branchId,
    ...normalized,
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  await upsertDocument(env, attendancePolicyPath(env, branchId), 'default', policy);
  return { ok: true, policy, message: 'Daily work hours saved. Lateness, absence and overtime will now be calculated automatically.' };
}

async function getStaffAttendanceActionState(env, branchId, username, siteId) {
  const [site, workspace] = await Promise.all([
    getStaffAttendanceDocument(env, 'sites', branchId, siteId),
    personalAttendanceContext(env, branchId, username)
  ]);
  if (!site || !activeValue(site.Active, true)) fail('The selected attendance location is inactive or unavailable.', 404);
  return {
    ...workspace, site,
    statePath: staffAttendanceCollectionPath(env, 'state', branchId),
    dailyPath: dailyAttendancePath(env, branchId)
  };
}

export async function clockStaffAttendance(env, user, body = {}, requestContext = {}) {
  const branchId = branchFor(user, body);
  const username = actorId(user);
  if (!username) fail('The signed-in staff account has no username.', 401);
  const siteId = safeStaffAttendanceDocumentId(body.SiteId);
  if (!siteId) fail('Choose the attendance location.');
  const workspace = await getStaffAttendanceActionState(env, branchId, username, siteId);
  const expected = workspace.nextDirection;
  if (workspace.state === 'OFF_DUTY') fail('There is no open shift scheduled for you now. Ask HR to review your attendance group if this is incorrect.', 409);
  if (!expected) fail('Today\'s first clock-in and first clock-out are already recorded. Repeated clocking cannot change them.', 409);
  const direction = clean(body.Direction || expected).toUpperCase();
  if (!['IN', 'OUT'].includes(direction)) fail('Choose Clock in or Clock out.');
  if (direction !== expected) fail(expected === 'IN' ? 'You are already clocked out.' : 'You are already clocked in.', 409);
  const timestamp = nowIso();
  if (direction === 'IN') {
    const opening = attendanceClockInWindow(workspace.policy, timestamp);
    if (opening.closed) fail('This shift has ended. Ask HR to record a correction if you missed clocking in.', 409);
    if (!opening.allowed) {
      const attemptKey = clean(body.idempotencyKey) || crypto.randomUUID();
      const auditId = safeStaffAttendanceDocumentId(`EARLY-IN-${opening.date}-${username}-${attemptKey}`);
      await upsertDocument(env, staffAttendanceCollectionPath(env, 'audit', branchId), auditId, {
        AuditId: auditId,
        Action: 'EARLY_CLOCK_IN_REJECTED',
        BranchId: branchId,
        Username: username,
        DisplayName: actorName(user),
        Role: clean(user.role || user.Role),
        SiteId: siteId,
        SiteName: clean(workspace.site.Name),
        Timestamp: timestamp,
        AttendanceDate: opening.date,
        ScheduledResumptionTime: opening.resumptionTime,
        ClockInOpensAt: opening.opensAt,
        ClockInOpenMinutesBefore: opening.allowanceMinutes,
        MinutesBeforeOpening: opening.minutesBeforeOpening,
        MinutesBeforeResumption: opening.minutesBeforeResumption,
        Reason: 'Clock-in attempted before the configured opening window.'
      });
      fail(`Clock-in opens at ${opening.opensAt}, ${opening.allowanceMinutes} minute(s) before today's ${opening.resumptionTime} resumption time. This early attempt was not recorded as attendance.`, 403);
    }
  }
  const site = workspace.site;
  const identityMethod = verifiedAttendanceIdentity(workspace.policy, requestContext.identityProof);
  const presence = evaluateAttendancePresence(site, body.Location || body, requestContext.clientIp || '');
  if (!presence.passed) {
    const details = presence.accuracyMetres && presence.accuracyMetres > Number(site.MaxAccuracyMetres)
      ? 'Your device location is not accurate enough. Move outdoors or connect to the approved organisation network.'
      : 'You appear to be outside the approved premises and network.';
    fail(details, 403);
  }
  const existingDaily = workspace.existingDaily;
  if (direction === 'IN' && clean(existingDaily?.FirstClockIn)) {
    fail('Today\'s first clock-in is already recorded and cannot be replaced by a repeated clock-in.', 409);
  }
  if (direction === 'OUT' && clean(existingDaily?.LastClockOut)) {
    fail('Today\'s first clock-out is already recorded and cannot be replaced by a repeated clock-out.', 409);
  }
  if (direction === 'OUT' && !clean(existingDaily?.FirstClockIn)) {
    fail('Clock in successfully before attempting to clock out.', 409);
  }
  const eventId = safeStaffAttendanceDocumentId(`TIME-${timestamp}-${username}-${crypto.randomUUID().slice(0, 8)}`);
  const event = {
    EventId: eventId,
    BranchId: branchId,
    Username: username,
    DisplayName: actorName(user),
    Role: clean(user.role || user.Role),
    Direction: direction,
    Timestamp: timestamp,
    SiteId: siteId,
    SiteName: clean(site.Name),
    VerificationMethod: `${presence.verificationMethod} + ${identityMethod}`,
    DistanceMetres: presence.distanceMetres,
    AccuracyMetres: presence.accuracyMetres,
    IpFingerprint: await ipFingerprint(requestContext.clientIp || ''),
    Notes: clean(body.Notes),
    ManualOverride: false
  };
  if (workspace.currentShift) event.ShiftSnapshot = workspace.currentShift;
  const daily = buildDailyAttendanceFromEvent(workspace.policy, event, existingDaily || {});
  if (direction === 'OUT' && workspace.presenceCheck?.status === 'OVERDUE') {
    daily.MissedPresenceChecks = Number(daily.MissedPresenceChecks || 0) + 1;
    daily.PresenceStatus = 'Random presence check missed';
  }
  Object.assign(event, {
    AttendanceDate: daily.Date,
    AttendanceStatus: daily.AttendanceStatus,
    LateMinutes: daily.LateMinutes,
    OvertimeMinutes: daily.OvertimeMinutes,
    EarlyDepartureMinutes: daily.EarlyDepartureMinutes,
    WorkMinutes: daily.WorkMinutes
  });
  const eventPath = staffAttendanceCollectionPath(env, 'events', branchId);
  const nextPresenceDueAt = direction === 'IN' ? nextPresenceCheckAt(workspace.policy, timestamp) : '';
  const presencePushEnabled = clean(workspace.policy.PresenceCheckPushEnabled).toUpperCase() !== 'NO';
  const stateDocument = {
    Username: username,
    BranchId: branchId,
    State: direction === 'IN' ? 'CLOCKED_IN' : 'COMPLETED',
    NextDirection: direction === 'IN' ? 'OUT' : '',
    AttendanceDate: daily.Date,
    LastPresenceCheckAt: direction === 'IN' ? '' : clean(workspace.presenceCheck?.lastConfirmedAt),
    NextPresenceCheckDueAt: nextPresenceDueAt,
    NextPresenceNotificationAt: direction === 'IN' && presencePushEnabled ? nextPresenceDueAt : '',
    PresenceNotificationSentForDueAt: '',
    PresenceNotificationSentAt: '',
    PresenceNotificationTrackingVersion: 1,
    PresenceCheckSequence: direction === 'IN' ? 0 : Number(workspace.presenceCheck?.sequence || 0),
    LastEventId: eventId,
    LastTimestamp: timestamp,
    UpdatedAt: timestamp
  };
  if (workspace.currentShift) stateDocument.ShiftSnapshot = workspace.currentShift;
  await batchCommitDocuments(env, [
    { collectionPath: eventPath, documentId: eventId, data: event, exists: false },
    {
      collectionPath: workspace.statePath,
      documentId: staffAttendanceWriteDocumentId(workspace.storedState, safeStaffAttendanceDocumentId(username)),
      data: stateDocument,
      ...canonicalWritePrecondition(workspace.storedState)
    },
    {
      collectionPath: workspace.dailyPath,
      documentId: staffAttendanceWriteDocumentId(existingDaily, daily.DailyId),
      data: daily,
      ...canonicalWritePrecondition(existingDaily)
    }
  ]);
  const timing = direction === 'IN' && daily.LateMinutes
    ? ` ${daily.LateMinutes} minute(s) late.`
    : direction === 'OUT' && daily.OvertimeMinutes
      ? ` ${daily.OvertimeMinutes} overtime minute(s) recorded.`
      : direction === 'OUT' && daily.EarlyDepartureMinutes
        ? ` ${daily.EarlyDepartureMinutes} minute(s) before closing time.`
        : '';
  return {
    ok: true,
    event,
    daily,
    state: direction === 'IN' ? 'CLOCKED_IN' : 'COMPLETED',
    message: `${direction === 'IN' ? 'Clock-in' : 'Clock-out'} recorded.${timing}`
  };
}

export async function recordPresenceCheck(env, user, body = {}, requestContext = {}) {
  const branchId = branchFor(user, body);
  const username = actorId(user);
  if (!username) fail('The signed-in staff account has no username.', 401);
  const siteId = safeStaffAttendanceDocumentId(body.SiteId);
  if (!siteId) fail('Choose the attendance location.');
  const workspace = await getStaffAttendanceActionState(env, branchId, username, siteId);
  if (workspace.state !== 'CLOCKED_IN') fail('Clock in before confirming your continued presence.', 409);
  const { policy, today, site, storedState, existingDaily } = workspace;
  const currentPresenceCheck = workspace.presenceCheck;
  if (!currentPresenceCheck.enabled) fail('Random presence confirmations are not enabled for this branch.', 409);
  if (!currentPresenceCheck.canConfirm) {
    fail(`Your next random presence confirmation is not due yet${currentPresenceCheck.dueAt ? ` (${currentPresenceCheck.dueAt})` : ''}.`, 409);
  }
  const identityMethod = verifiedAttendanceIdentity(policy, requestContext.identityProof);
  const presence = evaluateAttendancePresence(site, body.Location || body, requestContext.clientIp || '');
  if (!presence.passed) fail('You appear to be outside the approved premises and network.', 403);
  const timestamp = nowIso();
  if (!existingDaily?.FirstClockIn || existingDaily?.LastClockOut) fail('An active attendance day was not found.', 409);
  const { __id: _id, __createTime: _createTime, __updateTime: _updateTime, ...storedDaily } = existingDaily;
  const overdue = currentPresenceCheck.status === 'OVERDUE';
  const daily = {
    ...storedDaily,
    PresenceCheckCount: Number(existingDaily.PresenceCheckCount || 0) + 1,
    MissedPresenceChecks: Number(existingDaily.MissedPresenceChecks || 0) + (overdue ? 1 : 0),
    PresenceStatus: overdue ? 'Confirmed after random-check window' : 'Random presence confirmed',
    LastPresenceCheckAt: timestamp,
    UpdatedAt: timestamp,
    UpdatedBy: actorName(user)
  };
  const eventId = safeStaffAttendanceDocumentId(`PRESENCE-${timestamp}-${username}-${crypto.randomUUID().slice(0, 8)}`);
  const event = {
    EventId: eventId,
    BranchId: branchId,
    Username: username,
    DisplayName: actorName(user),
    Role: clean(user.role || user.Role),
    Direction: 'CHECK',
    Timestamp: timestamp,
    AttendanceDate: today.date,
    AttendanceStatus: daily.PresenceStatus,
    SiteId: siteId,
    SiteName: clean(site.Name),
    VerificationMethod: `${presence.verificationMethod} + ${identityMethod}`,
    DistanceMetres: presence.distanceMetres,
    AccuracyMetres: presence.accuracyMetres,
    IpFingerprint: await ipFingerprint(requestContext.clientIp || ''),
    ManualOverride: false
  };
  const nextDueAt = nextPresenceCheckAt(policy, timestamp);
  const presencePushEnabled = clean(policy.PresenceCheckPushEnabled).toUpperCase() !== 'NO';
  const state = {
    Username: username,
    BranchId: branchId,
    State: 'CLOCKED_IN',
    NextDirection: 'OUT',
    AttendanceDate: today.date,
    LastEventId: eventId,
    LastTimestamp: timestamp,
    LastPresenceCheckAt: timestamp,
    NextPresenceCheckDueAt: nextDueAt,
    NextPresenceNotificationAt: presencePushEnabled ? nextDueAt : '',
    PresenceNotificationSentForDueAt: '',
    PresenceNotificationSentAt: '',
    PresenceNotificationTrackingVersion: 1,
    PresenceCheckSequence: Number(currentPresenceCheck.sequence || 0) + 1,
    UpdatedAt: timestamp
  };
  if (workspace.currentShift) {
    event.ShiftSnapshot = workspace.currentShift;
    state.ShiftSnapshot = workspace.currentShift;
  }
  await batchCommitDocuments(env, [
    {
      collectionPath: staffAttendanceCollectionPath(env, 'events', branchId),
      documentId: eventId,
      data: event,
      exists: false
    },
    {
      collectionPath: workspace.statePath,
      documentId: staffAttendanceWriteDocumentId(storedState, safeStaffAttendanceDocumentId(username)),
      data: state,
      ...canonicalWritePrecondition(storedState)
    },
    {
      collectionPath: workspace.dailyPath,
      documentId: staffAttendanceWriteDocumentId(existingDaily, workspace.dailyId),
      data: daily,
      ...canonicalWritePrecondition(existingDaily)
    }
  ]);
  return {
    ok: true,
    event,
    daily,
    presenceCheck: { ...presenceCheckView(policy, state, true), dueAt: nextDueAt },
    message: overdue
      ? 'Presence confirmed, but the random confirmation window had already expired and was flagged for review.'
      : 'Continued presence confirmed successfully.'
  };
}

export async function recordManualAttendance(env, user, body = {}) {
  if (!canManageStaffAttendance(user)) fail('Only organisation or HR attendance administrators can record an attendance correction.', 403);
  const branchId = branchFor(user, body);
  const username = lower(body.Username);
  const direction = clean(body.Direction).toUpperCase();
  const reason = clean(body.Reason);
  if (!username) fail('Enter the staff username.');
  if (!['IN', 'OUT'].includes(direction)) fail('Choose Clock in or Clock out.');
  if (reason.length < 5) fail('Enter a clear reason for the manual correction.');
  // HR can correct historical attendance after an employee leaves, but the
  // target must still be an authoritative account in this branch and edition.
  const staffMember = await requireAttendanceStaff(env, user, branchId, username, { allowInactive: true });
  const requestedTimestamp = clean(body.Timestamp) || nowIso();
  const parsedTimestamp = new Date(requestedTimestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) fail('Enter a valid correction date and time.');
  const timestamp = parsedTimestamp.toISOString();
  const eventId = safeStaffAttendanceDocumentId(`MANUAL-${timestamp}-${username}-${crypto.randomUUID().slice(0, 8)}`);
  const event = {
    EventId: eventId,
    BranchId: branchId,
    Username: username,
    DisplayName: staffMember.DisplayName,
    Role: staffMember.Role,
    Direction: direction,
    Timestamp: timestamp,
    SiteId: clean(body.SiteId),
    SiteName: clean(body.SiteName),
    VerificationMethod: 'Authorised correction',
    ManualOverride: true,
    OverrideReason: reason,
    RecordedBy: actorName(user),
    CreatedAt: nowIso()
  };
  const eventPath = staffAttendanceCollectionPath(env, 'events', branchId);
  const auditPath = staffAttendanceCollectionPath(env, 'audit', branchId);
  const statePath = staffAttendanceCollectionPath(env, 'state', branchId);
  const stateId = safeStaffAttendanceDocumentId(username);
  const [storedPolicy, roster, currentState] = await Promise.all([
    getStaffAttendanceDocument(env, 'policy', branchId, 'default'), loadAttendanceRoster(env, branchId),
    getStaffAttendanceDocument(env, 'state', branchId, stateId)
  ]);
  let policy = normalizeAttendancePolicy(storedPolicy || { Active: 'NO' });
  const localDate = localAttendanceParts(timestamp, policy.TimeZone).date;
  const openShift = direction === 'OUT' && currentState?.State === 'CLOCKED_IN' && currentState.ShiftSnapshot
    && timestamp >= currentState.ShiftSnapshot.StartAt
    && Date.parse(timestamp) <= Date.parse(currentState.ShiftSnapshot.EndAt) + 86400000 ? currentState.ShiftSnapshot : null;
  const requestedDate = clean(body.AttendanceDate) ? attendanceDate(body.AttendanceDate, 'Shift start date') : '';
  let attendanceDateValue = requestedDate || openShift?.AttendanceDate || localDate;
  let existingDaily = await getStaffAttendanceDocument(env, 'daily', branchId, dailyAttendanceId(attendanceDateValue, username));
  let shift = existingDaily?.ShiftSnapshot || (openShift?.AttendanceDate === attendanceDateValue ? openShift : null);
  if (!shift) {
    shift = requestedDate ? attendanceShiftForDate(policy, roster, username, requestedDate)
      : resolveAttendanceShift(policy, roster, username, timestamp);
    if (!requestedDate && shift?.GroupId && shift.AttendanceDate !== attendanceDateValue && !existingDaily?.FirstClockIn) {
      attendanceDateValue = shift.AttendanceDate;
      existingDaily = await getStaffAttendanceDocument(env, 'daily', branchId, dailyAttendanceId(attendanceDateValue, username));
    }
    if (existingDaily?.ShiftSnapshot) shift = existingDaily.ShiftSnapshot;
    else if (existingDaily?.FirstClockIn && attendanceGroupFor(roster, username, attendanceDateValue)) {
      shift = recordedDefaultShift(policy, existingDaily, username, attendanceDateValue);
    }
  }
  const group = attendanceGroupFor(roster, username, attendanceDateValue);
  if (group && !shift?.GroupId && shift?.ScheduleType !== 'DEFAULT') fail('This is a rest day for the selected attendance group. Choose the shift start date.');
  if (shift?.GroupId || shift?.ScheduleType === 'DEFAULT') {
    const earliest = Date.parse(shift.StartAt) - Number(shift.ClockInOpenMinutesBefore || 0) * 60000;
    const latest = Date.parse(shift.EndAt) + (direction === 'OUT' ? 86400000 : 0);
    if (Date.parse(timestamp) < earliest || Date.parse(timestamp) > latest) fail('The correction time is outside the selected shift. Check the shift start date.');
    policy = effectiveShiftPolicy(policy, shift);
    event.ShiftSnapshot = shift;
  } else if (attendanceDateValue !== localDate) fail('The correction date must match the attendance date for branch-default staff.');
  if (direction === 'OUT' && !existingDaily?.FirstClockIn) fail('Record or correct the shift clock-in before its clock-out.', 409);
  const daily = buildDailyAttendanceFromEvent(policy, event, existingDaily || {});
  Object.assign(event, {
    AttendanceDate: daily.Date,
    AttendanceStatus: daily.AttendanceStatus,
    LateMinutes: daily.LateMinutes,
    OvertimeMinutes: daily.OvertimeMinutes,
    EarlyDepartureMinutes: daily.EarlyDepartureMinutes,
    WorkMinutes: daily.WorkMinutes
  });
  const writes = [
    { collectionPath: eventPath, documentId: eventId, data: event, exists: false },
    { collectionPath: auditPath, documentId: eventId, data: { ...event, Action: 'MANUAL_ATTENDANCE_CORRECTION' }, exists: false },
    {
      collectionPath: dailyAttendancePath(env, branchId),
      documentId: staffAttendanceWriteDocumentId(existingDaily, daily.DailyId),
      data: daily,
      ...canonicalWritePrecondition(existingDaily)
    },
    ...(!currentState?.LastTimestamp || currentState.AttendanceDate === attendanceDateValue || timestamp >= currentState.LastTimestamp ? [{
      collectionPath: statePath,
      documentId: staffAttendanceWriteDocumentId(currentState, stateId),
      data: {
        ...Object.fromEntries(Object.entries(currentState?.AttendanceDate === attendanceDateValue ? currentState : {}).filter(([key]) => !key.startsWith('__'))),
        Username: username,
        BranchId: branchId,
        State: daily.LastClockOut ? 'COMPLETED' : 'CLOCKED_IN',
        NextDirection: daily.LastClockOut ? '' : 'OUT',
        AttendanceDate: attendanceDateValue,
        ...(daily.ShiftSnapshot ? { ShiftSnapshot: daily.ShiftSnapshot } : {}),
        LastEventId: eventId,
        LastTimestamp: daily.LastClockOut || daily.FirstClockIn,
        UpdatedAt: nowIso(),
        UpdatedBy: actorName(user)
      },
      ...canonicalWritePrecondition(currentState)
    }] : [])
  ];
  await batchCommitDocuments(env, writes);
  return { ok: true, event, daily, message: 'Attendance correction recorded with an audit trail and recalculated daily totals.' };
}

function requireStorageMigrationAdministrator(user = {}) {
  if (clean(user.role || user.Role) !== 'Super Admin') {
    fail('Only a Super Administrator can migrate staff-attendance storage.', 403);
  }
}

export async function getStaffAttendanceStorageMigration(env, user, body = {}) {
  requireStorageMigrationAdministrator(user);
  const status = await staffAttendanceStorageMigrationStatus(env, branchFor(user, body));
  return {
    ok: true,
    ...status,
    message: status.legacyRecords
      ? status.verified
        ? `${status.legacyRecords} legacy record(s) have verified canonical copies and may be cleaned up.`
        : `${status.missingCanonicalRecords} of ${status.legacyRecords} legacy record(s) still require migration.`
      : 'No legacy staff-attendance records remain in this branch.'
  };
}

export async function migrateStaffAttendanceStorage(env, user, body = {}) {
  requireStorageMigrationAdministrator(user);
  const result = await migrateLegacyStaffAttendanceStorage(env, branchFor(user, body));
  return {
    ok: true,
    ...result,
    message: `${result.copied} legacy staff-attendance record(s) copied. ${result.missingCanonicalRecords} remain unverified.`
  };
}

export async function cleanupStaffAttendanceStorage(env, user, body = {}) {
  requireStorageMigrationAdministrator(user);
  const result = await cleanupLegacyStaffAttendanceStorage(
    env,
    branchFor(user, body),
    body.Confirmation || body.confirmation
  );
  return {
    ok: true,
    ...result,
    message: `${result.deleted} verified legacy staff-attendance record(s) deleted. Canonical records were retained.`
  };
}

export async function handleStaffAttendanceAction(env, user, body = {}, requestContext = {}) {
  const action = lower(body.action || body.Action || 'list');
  if (['savegroup', 'assigngroups', 'deletegroup'].includes(action)) {
    if (user.subscriptionReadOnly) fail('The subscription is read-only. Attendance group changes are disabled.', 403);
    if (!canManageStaffAttendance(user)) fail('Only attendance administrators can configure attendance groups.', 403);
    const branchId = branchFor(user, body);
    const policy = normalizeAttendancePolicy(await getStaffAttendanceDocument(env, 'policy', branchId, 'default') || { Active: 'NO' });
    const operation = { savegroup: saveAttendanceGroup, assigngroups: assignAttendanceGroups, deletegroup: deleteAttendanceGroup }[action];
    return operation(env, user, body, branchId, policy);
  }
  if (action === 'list') return listStaffAttendance(env, user, body);
  if (action === 'quick') return getStaffAttendanceQuickState(env, user, body);
  if (action === 'presencequick') return getStaffAttendancePresenceState(env, user, body);
  if (action === 'savesite') return saveAttendanceSite(env, user, body);
  if (action === 'deletesite') return deleteAttendanceSite(env, user, body);
  if (action === 'savepolicy') return saveAttendancePolicy(env, user, body);
  if (action === 'clock') return clockStaffAttendance(env, user, body, requestContext);
  if (action === 'presence') return recordPresenceCheck(env, user, body, requestContext);
  if (action === 'manual') return recordManualAttendance(env, user, body);
  if (action === 'storagestatus') return getStaffAttendanceStorageMigration(env, user, body);
  if (action === 'migratestorage') return migrateStaffAttendanceStorage(env, user, body);
  if (action === 'cleanupstorage') return cleanupStaffAttendanceStorage(env, user, body);
  fail('Choose a valid staff attendance action.');
}
