import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attendancePresenceNotificationCandidate,
  processAttendancePresenceNotifications
} from '../functions/lib/attendance-presence-notifications.js';

const schedulerSource = await readFile(new URL('../functions/api/notification-scheduler.js', import.meta.url), 'utf8');
const workflowSource = await readFile(new URL('../.github/workflows/attendance-presence-notifications.yml', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const attendanceSource = await readFile(new URL('../functions/lib/staff-time-attendance.js', import.meta.url), 'utf8');

const policy = {
  ResumptionTime: '08:00', ClosingTime: '17:00', WorkDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  TimeZone: 'Africa/Lagos', PresenceCheckMode: 'RANDOM', PresenceCheckMinimumMinutes: 90,
  PresenceCheckMaximumMinutes: 180, PresenceCheckGraceMinutes: 20, PresenceCheckPushEnabled: 'YES'
};

test('presence push candidate is due only for the current active attendance day', () => {
  const now = new Date('2026-08-13T10:05:00.000Z');
  const state = {
    Username: 'staff.one', State: 'CLOCKED_IN', AttendanceDate: '2026-08-13',
    NextPresenceNotificationAt: '2026-08-13T10:00:00.000Z'
  };
  assert.equal(attendancePresenceNotificationCandidate(policy, state, now).eligible, true);
  assert.equal(attendancePresenceNotificationCandidate({ ...policy, PresenceCheckPushEnabled: 'NO' }, state, now).eligible, false);
  assert.equal(attendancePresenceNotificationCandidate(policy, { ...state, State: 'COMPLETED' }, now).eligible, false);
  assert.equal(attendancePresenceNotificationCandidate(policy, { ...state, PresenceNotificationSentForDueAt: state.NextPresenceNotificationAt }, now).eligible, false);
});

test('scheduler creates one urgent targeted notification and clears its due delivery marker', async () => {
  const notices = [];
  const patches = [];
  const result = await processAttendancePresenceNotifications({}, {
    now: '2026-08-13T10:05:00.000Z',
    structure: { Branches: [{ Id: 'main' }] },
    getDocument: async () => policy,
    queryCollection: async () => [{
      __id: 'staff.one', __updateTime: '2026-08-13T10:01:00.000Z', Username: 'staff.one',
      State: 'CLOCKED_IN', AttendanceDate: '2026-08-13', LastEventId: 'TIME-1',
      NextPresenceNotificationAt: '2026-08-13T10:00:00.000Z'
    }],
    createNotification: async (_env, notification, options) => {
      notices.push({ notification, options });
      return { created: true, notification, pushDeliveries: [{ status: 'Delivered' }] };
    },
    patchDocumentFields: async (...args) => { patches.push(args); }
  });
  assert.equal(result.created, 1);
  assert.equal(result.delivered, 1);
  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].notification.TargetUsernames, ['staff.one']);
  assert.equal(notices[0].notification.Category, 'Attendance');
  assert.equal(notices[0].notification.Severity, 'Urgent');
  assert.match(notices[0].notification.ActionUrl, /section=overview/);
  assert.equal(notices[0].options.retryDelivery, false);
  assert.equal(patches.length, 1);
  assert.equal(patches[0][3].NextPresenceNotificationAt, '');
  assert.equal(patches[0][3].PresenceNotificationSentForDueAt, '2026-08-13T10:00:00.000Z');
});

test('attendance settings and protected scheduler expose configurable push delivery', () => {
  assert.match(adminSource, /name="PresenceCheckPushEnabled"/);
  assert.match(adminSource, /Send a push notification when each random confirmation becomes due/);
  assert.match(adminSource, /payload\.PresenceCheckPushEnabled = formData\.has\('PresenceCheckPushEnabled'\) \? 'YES' : 'NO'/);
  assert.match(attendanceSource, /PresenceCheckPushEnabled: 'YES'/);
  assert.match(attendanceSource, /NextPresenceNotificationAt: direction === 'IN' && presencePushEnabled \? nextPresenceDueAt : ''/);
  assert.match(attendanceSource, /presenceCheck\r?\n  };/);
  assert.match(schedulerSource, /attendanceOnly = body\.attendanceOnly === true/);
  assert.match(schedulerSource, /processAttendancePresenceNotifications/);
  assert.match(schedulerSource, /announcementsOnly \? \{ skipped: true \} : await retryFailedPushDeliveries/);
  assert.match(workflowSource, /cron: "\*\/5 \* \* \* \*"/);
  assert.match(workflowSource, /organisation-deployment-matrix\.mjs/);
  assert.match(workflowSource, /matrix\.organisation\.githubEnvironment/);
  assert.match(workflowSource, /expectedWorkspaceId/);
  assert.match(workflowSource, /expectedEdition/);
  assert.doesNotMatch(workflowSource, /NOTIFICATION_SCHEDULER_URL/);
});
