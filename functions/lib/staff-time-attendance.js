import { batchCommitDocuments, listCollection, patchDocumentFields, upsertDocument } from './firestore.js';
import {
  cleanupLegacyStaffAttendanceStorage,
  getStaffAttendanceDocument,
  listStaffAttendanceCollection,
  migrateLegacyStaffAttendanceStorage,
  queryStaffAttendanceCollection,
  resolveStaffAttendanceBranch,
  safeStaffAttendanceDocumentId,
  staffAttendanceCollectionPath,
  staffAttendanceDocumentData,
  staffAttendanceReadPaths,
  staffAttendanceStorageMigrationStatus
} from './staff-attendance-storage.js';
import { staffRecordMatchesEdition } from './records-desk.js';
import { hrCapabilitiesFor } from './human-resources.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const MANAGE_ROLES = new Set(['Super Admin', 'Church Administrator']);
const ATTENDANCE_ADMIN_ROLES = new Set([
  ...MANAGE_ROLES,
  'HR Director',
  'HR Manager',
  'HR Business Partner',
  'HR Officer'
]);
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
  return REPORT_ROLES.has(role) || hrCapabilitiesFor(user).canManageTime;
}

export function canManageStaffAttendance(user = {}) {
  return ATTENDANCE_ADMIN_ROLES.has(clean(user.role || user.Role));
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

function attendancePolicySnapshot(policy = {}, day = '') {
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
  const { __id: _documentId, __createTime: _createdAt, __updateTime: _updatedAt, ...storedExisting } = existing;
  const storedFirstClockIn = clean(existing.FirstClockIn);
  const storedLastClockOut = clean(existing.LastClockOut);
  const firstClockIn = event.Direction === 'IN'
    ? !storedFirstClockIn || event.Timestamp < storedFirstClockIn ? event.Timestamp : storedFirstClockIn
    : storedFirstClockIn;
  const lastClockOut = event.Direction === 'OUT'
    ? !storedLastClockOut || event.Timestamp > storedLastClockOut ? event.Timestamp : storedLastClockOut
    : storedLastClockOut;
  const metrics = calculateAttendanceMetrics(policy, {
    Direction: event.Direction,
    Timestamp: event.Direction === 'OUT' ? lastClockOut : firstClockIn,
    FirstClockIn: firstClockIn,
    ExistingStatus: event.Direction === 'OUT' ? existing.AttendanceStatus : ''
  });
  const id = dailyAttendanceId(metrics.Date, event.Username);
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
    AttendanceStatus: scheduleActive ? metrics.AttendanceStatus : clean(existing.AttendanceStatus) || 'Recorded',
    FirstClockIn: firstClockIn,
    LastClockOut: lastClockOut,
    LateMinutes: scheduleActive && event.Direction === 'IN' ? metrics.LateMinutes : Number(existing.LateMinutes || 0),
    OvertimeMinutes: scheduleActive && event.Direction === 'OUT' ? metrics.OvertimeMinutes : Number(existing.OvertimeMinutes || 0),
    EarlyDepartureMinutes: scheduleActive && event.Direction === 'OUT' ? metrics.EarlyDepartureMinutes : Number(existing.EarlyDepartureMinutes || 0),
    WorkMinutes: event.Direction === 'OUT' ? metrics.WorkMinutes : Number(existing.WorkMinutes || 0),
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

async function synchronizeAutomaticAbsences(env, branchId, policy, now, directory, leaveRows, dailyRows) {
  if (lower(policy.Active) === 'no' || lower(policy.AutoRecordAbsence) === 'no') return dailyRows;
  const local = localAttendanceParts(now, policy.TimeZone);
  const schedule = policy.DaySchedules?.[local.day];
  if (!schedule?.Enabled || local.minuteOfDay < timeMinutes(schedule.ClosingTime, 'Closing time')) return dailyRows;
  const current = dailyRows.filter((row) => clean(row.Date) === local.date);
  const currentUsernames = new Set(current.map((row) => lower(row.Username)));
  const timestamp = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const created = directory.filter((row) => !currentUsernames.has(lower(row.Username))).map((row) => {
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
  if (!created.length) return dailyRows;
  let conflict = false;
  for (let index = 0; index < created.length; index += 400) {
    const chunk = created.slice(index, index + 400);
    try {
      await batchCommitDocuments(env, chunk.map((row) => ({
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
  if (!conflict) return [...created, ...dailyRows];
  const refreshed = await queryStaffAttendanceCollection(env, 'daily', branchId, {
    filters: [{ field: 'Date', op: '==', value: local.date }],
    limit: 500
  }).catch(() => current);
  return [...refreshed, ...dailyRows.filter((row) => clean(row.Date) !== local.date)];
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
    : patchDocumentFields(env, statePath, safeStaffAttendanceDocumentId(username), fields, state.__updateTime ? { updateTime: state.__updateTime } : {});
  await write.catch((error) => {
    if (![409, 412].includes(Number(error?.status))) throw error;
  });
}

export async function getStaffAttendanceQuickState(env, user, body = {}) {
  const branchId = branchFor(user, body);
  const username = actorId(user);
  if (!username) fail('The signed-in staff account has no username.', 401);
  const policyDocumentPromise = getStaffAttendanceDocument(env, 'policy', branchId, 'default');
  const sitesPromise = listStaffAttendanceCollection(env, 'sites', branchId);
  const storedPolicy = await policyDocumentPromise;
  const policy = normalizeAttendancePolicy(storedPolicy || { Active: 'NO' });
  const today = localAttendanceParts(new Date(), policy.TimeZone);
  const statePath = staffAttendanceCollectionPath(env, 'state', branchId);
  const todayDailyPromise = getStaffAttendanceDocument(env, 'daily', branchId, dailyAttendanceId(today.date, username));
  const storedStatePromise = getStaffAttendanceDocument(env, 'state', branchId, safeStaffAttendanceDocumentId(username));
  const [sites, todayDaily, storedState] = await Promise.all([sitesPromise, todayDailyPromise, storedStatePromise]);
  const state = clean(todayDaily?.FirstClockIn)
    ? clean(todayDaily?.LastClockOut) ? 'COMPLETED' : 'CLOCKED_IN'
    : 'CLOCKED_OUT';
  const todayStoredState = clean(storedState?.AttendanceDate) === today.date ? storedState : {};
  const presenceCheck = presenceCheckView(policy, todayStoredState, state === 'CLOCKED_IN');
  await ensurePresenceNotificationSchedule(env, statePath, username, policy, todayStoredState, presenceCheck);
  return {
    ok: true,
    branchId,
    sites: sites
      .filter((row) => lower(row.Active || 'YES') !== 'no')
      .sort((a, b) => clean(a.Name).localeCompare(clean(b.Name))),
    policy,
    policyConfigured: Boolean(storedPolicy),
    todayAttendanceDate: today.date,
    todayAttendanceDay: today.day,
    todaySchedule: policy.DaySchedules?.[today.day] || null,
    todayDaily: todayDaily || null,
    state,
    nextDirection: state === 'CLOCKED_IN' ? 'OUT' : state === 'CLOCKED_OUT' ? 'IN' : '',
    presenceCheck
  };
}

export async function listStaffAttendance(env, user, body = {}) {
  const branchId = branchFor(user, body);
  const username = actorId(user);
  if (!username) fail('The signed-in staff account has no username.', 401);
  const canManage = canManageStaffAttendance(user);
  const canReport = canReportStaffAttendance(user);
  const reportPeriod = canReport ? normalizeAttendanceReportPeriod(body) : { FromDate: '', ToDate: '' };
  const [sites, events, storedState, storedPolicy, dailySource, staffUsers, employees, leaveRows] = await Promise.all([
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
    listCollection(env, 'staffUsers').catch(() => []),
    listCollection(env, 'hrEmployees').catch(() => []),
    listCollection(env, 'hrLeaveRequests').catch(() => [])
  ]);
  const policy = normalizeAttendancePolicy(storedPolicy || { Active: 'NO' });
  const exited = new Set(employees.filter((row) => /exited|terminated/i.test(clean(row.Status))).map((row) => lower(row.Username)));
  const directory = staffUsers.filter((row) => staffRecordMatchesEdition(row, user)
    && staffBranchMatches(row, branchId)
    && activeStaffValue(row.Active === undefined ? true : row.Active)
    && !exited.has(lower(row.Username || row.__id)))
    .map((row) => ({
      Username: lower(row.Username || row.__id),
      DisplayName: clean(row.DisplayName || row.Username || row.__id),
      Role: clean(row.Role),
      Department: clean(row.Department)
    })).filter((row) => row.Username).sort((a, b) => a.DisplayName.localeCompare(b.DisplayName));
  const dailyRows = await synchronizeAutomaticAbsences(env, branchId, policy, new Date(), directory, leaveRows, dailySource);
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
  const todayLocal = localAttendanceParts(new Date(), policy.TimeZone);
  const todayAttendanceDate = todayLocal.date;
  const todayDaily = ownDaily.find((row) => clean(row.Date) === todayAttendanceDate) || null;
  const todayState = clean(todayDaily?.FirstClockIn)
    ? clean(todayDaily?.LastClockOut) ? 'COMPLETED' : 'CLOCKED_IN'
    : 'CLOCKED_OUT';
  const todayStoredState = clean(storedState?.AttendanceDate) === todayAttendanceDate ? storedState : {};
  const presenceCheck = presenceCheckView(policy, todayStoredState, todayState === 'CLOCKED_IN');
  await ensurePresenceNotificationSchedule(
    env,
    staffAttendanceCollectionPath(env, 'state', branchId),
    username,
    policy,
    todayStoredState,
    presenceCheck
  );
  return {
    ok: true,
    branchId,
    sites: sortedSites.filter((row) => lower(row.Active || 'YES') !== 'no'),
    configuredSites: canManage ? sortedSites : [],
    policy,
    policyConfigured: Boolean(storedPolicy),
    todayAttendanceDate,
    todayAttendanceDay: todayLocal.day,
    todaySchedule: policy.DaySchedules?.[todayLocal.day] || null,
    staffDirectory: canManage ? directory : [],
    myEvents: own,
    myDailyRecords: ownDaily,
    recentEvents: canReport ? sorted.slice(0, 250) : [],
    recentDailyRecords: canReport ? reportDailyRows : [],
    reportPeriod,
    reportTruncated: canReport && reportDailyRows.length >= ATTENDANCE_REPORT_LIMIT,
    state: todayState,
    nextDirection: todayState === 'CLOCKED_IN' ? 'OUT' : todayState === 'CLOCKED_OUT' ? 'IN' : '',
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
  await upsertDocument(env, collectionPath, id, site);
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
    documentId: id,
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
  const storedPolicy = await getStaffAttendanceDocument(env, 'policy', branchId, 'default');
  const policy = normalizeAttendancePolicy(storedPolicy || { Active: 'NO' });
  const today = localAttendanceParts(new Date(), policy.TimeZone);
  const statePath = staffAttendanceCollectionPath(env, 'state', branchId);
  const dailyPath = dailyAttendancePath(env, branchId);
  const dailyId = dailyAttendanceId(today.date, username);
  const [site, storedState, existingDaily] = await Promise.all([
    getStaffAttendanceDocument(env, 'sites', branchId, siteId),
    getStaffAttendanceDocument(env, 'state', branchId, safeStaffAttendanceDocumentId(username)),
    getStaffAttendanceDocument(env, 'daily', branchId, dailyId)
  ]);
  if (!site || !activeValue(site.Active, true)) fail('The selected attendance location is inactive or unavailable.', 404);
  const state = clean(existingDaily?.FirstClockIn)
    ? clean(existingDaily?.LastClockOut) ? 'COMPLETED' : 'CLOCKED_IN'
    : 'CLOCKED_OUT';
  const todayState = clean(storedState?.AttendanceDate) === today.date ? storedState : {};
  return {
    policy,
    today,
    statePath,
    dailyPath,
    dailyId,
    site,
    storedState,
    existingDaily,
    state,
    nextDirection: state === 'CLOCKED_IN' ? 'OUT' : state === 'CLOCKED_OUT' ? 'IN' : '',
    presenceCheck: presenceCheckView(policy, todayState, state === 'CLOCKED_IN')
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
  if (!expected) fail('Today\'s first clock-in and first clock-out are already recorded. Repeated clocking cannot change them.', 409);
  const direction = clean(body.Direction || expected).toUpperCase();
  if (!['IN', 'OUT'].includes(direction)) fail('Choose Clock in or Clock out.');
  if (direction !== expected) fail(expected === 'IN' ? 'You are already clocked out.' : 'You are already clocked in.', 409);
  const timestamp = nowIso();
  if (direction === 'IN') {
    const opening = attendanceClockInWindow(workspace.policy, timestamp);
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
  await batchCommitDocuments(env, [
    { collectionPath: eventPath, documentId: eventId, data: event, exists: false },
    {
      collectionPath: workspace.statePath,
      documentId: safeStaffAttendanceDocumentId(username),
      data: stateDocument,
      ...canonicalWritePrecondition(workspace.storedState)
    },
    {
      collectionPath: workspace.dailyPath,
      documentId: daily.DailyId,
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
  await batchCommitDocuments(env, [
    {
      collectionPath: staffAttendanceCollectionPath(env, 'events', branchId),
      documentId: eventId,
      data: event,
      exists: false
    },
    {
      collectionPath: workspace.statePath,
      documentId: safeStaffAttendanceDocumentId(username),
      data: state,
      ...canonicalWritePrecondition(storedState)
    },
    {
      collectionPath: workspace.dailyPath,
      documentId: workspace.dailyId,
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
  const requestedTimestamp = clean(body.Timestamp) || nowIso();
  const parsedTimestamp = new Date(requestedTimestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) fail('Enter a valid correction date and time.');
  const timestamp = parsedTimestamp.toISOString();
  const eventId = safeStaffAttendanceDocumentId(`MANUAL-${timestamp}-${username}-${crypto.randomUUID().slice(0, 8)}`);
  const event = {
    EventId: eventId,
    BranchId: branchId,
    Username: username,
    DisplayName: clean(body.DisplayName) || username,
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
  const policy = normalizeAttendancePolicy(await getStaffAttendanceDocument(env, 'policy', branchId, 'default') || { Active: 'NO' });
  const attendanceDate = calculateAttendanceMetrics(policy, { Direction: direction, Timestamp: timestamp }).Date;
  const dailyId = dailyAttendanceId(attendanceDate, username);
  const [currentState, existingDaily] = await Promise.all([
    getStaffAttendanceDocument(env, 'state', branchId, stateId),
    getStaffAttendanceDocument(env, 'daily', branchId, dailyId)
  ]);
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
      documentId: daily.DailyId,
      data: daily,
      ...canonicalWritePrecondition(existingDaily)
    },
    ...(!currentState?.LastTimestamp || timestamp >= currentState.LastTimestamp ? [{
      collectionPath: statePath,
      documentId: stateId,
      data: {
        Username: username,
        BranchId: branchId,
        State: direction === 'IN' ? 'CLOCKED_IN' : 'COMPLETED',
        NextDirection: direction === 'IN' ? 'OUT' : '',
        AttendanceDate: attendanceDate,
        LastEventId: eventId,
        LastTimestamp: timestamp,
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
  if (action === 'list') return listStaffAttendance(env, user, body);
  if (action === 'quick') return getStaffAttendanceQuickState(env, user, body);
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
