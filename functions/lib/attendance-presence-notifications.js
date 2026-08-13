import { getDocument, patchDocumentFields, queryCollection } from './firestore.js';
import { CHURCH_COLLECTIONS, churchCollectionPath, safeChurchDocumentId } from './church-foundation.js';
import { createNotification } from './notifications.js';
import { getSchoolStructure } from './school-scope.js';
import { normalizeAttendancePolicy } from './staff-time-attendance.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function localDate(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function attendancePresenceNotificationCandidate(policy = {}, state = {}, now = new Date()) {
  const dueAt = clean(state.NextPresenceNotificationAt);
  const dueTime = Date.parse(dueAt);
  const pushEnabled = clean(policy.PresenceCheckPushEnabled).toUpperCase() !== 'NO';
  const randomEnabled = clean(policy.PresenceCheckMode).toUpperCase() === 'RANDOM';
  const currentDate = localDate(now, clean(policy.TimeZone) || 'Africa/Lagos');
  const sentForDueAt = clean(state.PresenceNotificationSentForDueAt);
  return {
    eligible: Boolean(
      pushEnabled && randomEnabled && dueAt && Number.isFinite(dueTime) && dueTime <= now.getTime()
      && clean(state.State).toUpperCase() === 'CLOCKED_IN'
      && clean(state.AttendanceDate) === currentDate
      && sentForDueAt !== dueAt
    ),
    dueAt,
    currentDate,
    graceEndsAt: Number.isFinite(dueTime)
      ? new Date(dueTime + (Number(policy.PresenceCheckGraceMinutes || 0) * 60000)).toISOString()
      : ''
  };
}

function branchIds(structure = {}) {
  const rows = Array.isArray(structure.Branches) && structure.Branches.length
    ? structure.Branches
    : [{ Id: 'main' }];
  return [...new Set(rows.map((row) => lower(typeof row === 'string' ? row : row.Id || row.id || row.Name || row.name) || 'main'))];
}

export async function processAttendancePresenceNotifications(env, options = {}) {
  const now = clean(options.now) ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Enter a valid attendance notification processing time.');
  const nowIso = now.toISOString();
  const limit = Math.max(1, Math.min(10, Number(options.limit || 2)));
  const getStructure = options.getSchoolStructure || getSchoolStructure;
  const get = options.getDocument || getDocument;
  const query = options.queryCollection || queryCollection;
  const notify = options.createNotification || createNotification;
  const patch = options.patchDocumentFields || patchDocumentFields;
  const structure = options.structure || await getStructure(env);
  let inspected = 0;
  let eligible = 0;
  let created = 0;
  let duplicates = 0;
  let delivered = 0;
  let failed = 0;

  for (const branchId of branchIds(structure)) {
    if (eligible >= limit) break;
    const policyPath = churchCollectionPath(CHURCH_COLLECTIONS.staffAttendancePolicy, branchId);
    const statePath = churchCollectionPath(CHURCH_COLLECTIONS.staffTimeState, branchId);
    const storedPolicy = await get(env, policyPath, 'default').catch(() => null);
    if (!storedPolicy) continue;
    const policy = normalizeAttendancePolicy(storedPolicy);
    if (clean(policy.PresenceCheckMode).toUpperCase() !== 'RANDOM'
      || clean(policy.PresenceCheckPushEnabled).toUpperCase() === 'NO') continue;
    const states = await query(env, statePath, {
      filters: [{ field: 'NextPresenceNotificationAt', op: '<=', value: nowIso }],
      orderBy: [{ field: 'NextPresenceNotificationAt', direction: 'ASCENDING' }],
      limit: Math.max(1, limit - eligible)
    }).catch(() => []);
    inspected += states.length;
    for (const state of states) {
      if (eligible >= limit) break;
      const candidate = attendancePresenceNotificationCandidate(policy, state, now);
      if (!candidate.eligible) continue;
      eligible += 1;
      const username = lower(state.Username || state.__id);
      if (!username) continue;
      const result = await notify(env, {
        EventKey: `attendance-presence-due:${branchId}:${username}:${candidate.dueAt}`,
        Type: 'Presence confirmation',
        Category: 'Attendance',
        Channels: ['InApp', 'Push'],
        Severity: 'Urgent',
        Audience: 'Staff',
        TargetUsernames: [username],
        Title: 'Random presence confirmation due',
        Message: 'Your continued-presence confirmation is ready. Open the staff dashboard and confirm before the grace period ends.',
        ActionUrl: 'admin.html?section=overview',
        RecordType: 'Staff attendance',
        RecordId: clean(state.LastEventId),
        DueDate: candidate.dueAt,
        BranchId: branchId,
        ActorType: 'System',
        ActorId: 'Attendance scheduler',
        CreatedBy: 'Attendance scheduler',
        ExpiresAt: candidate.graceEndsAt
      }, { retryDelivery: false, date: now });
      if (result.created) created += 1;
      else duplicates += 1;
      delivered += (result.pushDeliveries || []).filter((row) => row.status === 'Delivered').length;
      failed += (result.pushDeliveries || []).filter((row) => ['Failed', 'Invalid subscription'].includes(row.status)).length;
      await patch(env, statePath, safeChurchDocumentId(username), {
        NextPresenceNotificationAt: '',
        PresenceNotificationSentForDueAt: candidate.dueAt,
        PresenceNotificationSentAt: nowIso,
        PresenceNotificationTrackingVersion: 1
      }, state.__updateTime ? { updateTime: state.__updateTime } : {}).catch((error) => {
        if (![409, 412].includes(Number(error?.status))) throw error;
      });
    }
  }
  return { ok: true, processedAt: nowIso, inspected, eligible, created, duplicates, delivered, failed };
}
