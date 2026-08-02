import { requireStaffSession } from '../lib/staff-auth.js';
import {
  archiveNotification,
  createNotification,
  listNotifications,
  loadNotificationSettings,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_CATEGORIES,
  notificationTargetsRecipient,
  saveNotificationSettings
} from '../lib/notifications.js';
import { getDocument, upsertDocument } from '../lib/firestore.js';
import {
  listPushSubscriptions,
  publicMessagingConfig,
  removePushSubscription,
  savePushSubscription
} from '../lib/firebase-messaging.js';
import { readJsonBody } from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

function recipientFor(user, env = {}) {
  return {
    audience: 'Staff',
    recipientKey: user.username,
    username: user.username,
    role: user.role,
    department: user.department,
    schoolId: env.DYNAMAX_WORKSPACE_ID,
    branchId: user.branchId,
    schoolSectionAccess: user.schoolSectionAccess
  };
}

function response(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' }
  });
}

function intervals(value, fallback) {
  const rows = Array.isArray(value) ? value : clean(value).split(',');
  const result = [...new Set(rows.map(Number).filter((item) => Number.isInteger(item) && item >= 0))].sort((a, b) => b - a);
  return result.length ? result : fallback;
}

function templates(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, template]) => [
    clean(key).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
    {
      Title: clean(template?.Title).slice(0, 160),
      Message: clean(template?.Message).slice(0, 2000),
      Version: clean(template?.Version || '1').slice(0, 20)
    }
  ]).filter(([key, template]) => key && template.Title && template.Message));
}

function workflowRecipients(value, fallback = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const roles = (input) => (Array.isArray(input) ? input : clean(input).split(','))
    .map(clean).filter(Boolean).slice(0, 20).map((role) => role.slice(0, 80));
  return {
    SubmittedRoles: roles(value.SubmittedRoles),
    ProcessingRoles: roles(value.ProcessingRoles),
    ManagementRoles: roles(value.ManagementRoles)
  };
}

function audiencePolicies(value = {}, fallback = {}) {
  return Object.fromEntries(['Parent', 'Staff'].map((audience) => {
    const input = value?.[audience] && typeof value[audience] === 'object' ? value[audience] : {};
    const existing = fallback?.[audience] && typeof fallback[audience] === 'object' ? fallback[audience] : {};
    return [audience, {
      Channels: {
        InApp: input.Channels?.InApp !== undefined ? input.Channels.InApp === true : existing.Channels?.InApp !== false,
        Push: input.Channels?.Push !== undefined ? input.Channels.Push === true : existing.Channels?.Push !== false
      },
      Categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [
        category,
        audience === 'Parent' && category === 'Requisitions'
          ? false
          : input.Categories?.[category] !== undefined
          ? input.Categories[category] === true
          : existing.Categories?.[category] !== false
      ]))
    }];
  }));
}

async function saveSystemSettings(env, user, input = {}) {
  if (clean(user.role) !== 'Super Admin') {
    const error = new Error('Only Super Admin can change organisation notification defaults.');
    error.status = 403;
    throw error;
  }
  const existing = await getDocument(env, 'notificationSettings', 'system').catch(() => null) || {};
  const record = {
    ...existing,
    SettingsId: 'system',
    SchoolId: clean(env.DYNAMAX_WORKSPACE_ID).toLowerCase(),
    Timezone: clean(input.Timezone || existing.Timezone || 'Africa/Lagos'),
    FeeDueIntervals: intervals(input.FeeDueIntervals, [14, 7, 3, 1, 0]),
    FeeOverdueIntervals: intervals(input.FeeOverdueIntervals, [30, 14, 7, 1]),
    Templates: templates(input.Templates, existing.Templates || {}),
    WorkflowRecipients: workflowRecipients(input.WorkflowRecipients, existing.WorkflowRecipients || {}),
    AudiencePolicies: audiencePolicies(input.AudiencePolicies, existing.AudiencePolicies || {}),
    UpdatedAt: new Date().toISOString(),
    UpdatedBy: user.username
  };
  await upsertDocument(env, 'notificationSettings', 'system', record);
  return record;
}

async function loadForUser(env, user, options = {}) {
  return listNotifications(env, recipientFor(user, env), { limit: 50, ...options });
}

export async function onRequestGet(context) {
  try {
    const user = await requireStaffSession(context.env, context.request);
    const url = new URL(context.request.url);
    const options = {
      limit: Number(url.searchParams.get('limit') || 50),
      before: clean(url.searchParams.get('before')),
      category: clean(url.searchParams.get('category')),
      unread: url.searchParams.get('unread') === 'true',
      archived: url.searchParams.get('archived') === 'true'
    };
    const [data, settings, subscriptions] = await Promise.all([
      loadForUser(context.env, user, options),
      loadNotificationSettings(context.env, 'Staff', user.username),
      listPushSubscriptions(context.env, user.username)
    ]);
    return response({ ok: true, ...data, settings, subscriptions, messaging: publicMessagingConfig(context.env), canManageSystemSettings: clean(user.role) === 'Super Admin' });
  } catch (error) {
    return response({ ok: false, message: error?.message || String(error) }, error?.status || 500);
  }
}

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 32 * 1024 });
    const action = clean(body.action || body.Action || 'markRead').toLowerCase();
    const recipient = recipientFor(user, env);
    const current = await loadForUser(env, user, { limit: 100, archived: action === 'unarchive' });
    if (action === 'markallread') {
      await markAllNotificationsRead(env, current.notifications, user.username);
    } else if (action === 'markread') {
      const notificationId = clean(body.notificationId || body.NotificationId);
      if (!notificationId) {
        const error = new Error('Select a notification to mark as read.');
        error.status = 400;
        throw error;
      }
      const notification = await getDocument(env, 'notifications', notificationId);
      if (!notification || !notificationTargetsRecipient(notification, recipient)) {
        const error = new Error('This notification is not available to your account.');
        error.status = 404;
        throw error;
      }
      await markNotificationRead(env, notificationId, user.username);
    } else if (action === 'archive' || action === 'unarchive') {
      const notificationId = clean(body.notificationId || body.NotificationId);
      const notification = await getDocument(env, 'notifications', notificationId);
      if (!notification || !notificationTargetsRecipient(notification, recipient)) {
        const error = new Error('This notification is not available to your account.');
        error.status = 404;
        throw error;
      }
      await archiveNotification(env, notificationId, user.username, action === 'archive');
    } else if (action === 'savesettings') {
      await saveNotificationSettings(env, 'Staff', user.username, body.settings || body.Settings || {});
    } else if (action === 'savesystemsettings') {
      await saveSystemSettings(env, user, body.settings || body.Settings || {});
    } else if (action === 'subscribepush') {
      await savePushSubscription(env, {
        ...(body.subscription || body.Subscription || body),
        SchoolId: env.DYNAMAX_WORKSPACE_ID,
        Audience: 'Staff',
        RecipientKey: user.username,
        UserAgent: request.headers.get('User-Agent') || ''
      });
    } else if (action === 'unsubscribepush') {
      await removePushSubscription(env, user.username, clean(body.deviceId || body.DeviceId));
    } else if (action === 'testpush') {
      const deviceId = clean(body.deviceId || body.DeviceId);
      const subscriptions = await listPushSubscriptions(env, user.username);
      if (!deviceId || !subscriptions.some((row) => clean(row.DeviceId) === deviceId)) {
        const error = new Error('Enable push on this device before sending a test notification.');
        error.status = 409;
        throw error;
      }
      const testResult = await createNotification(env, {
        EventKey: `test-push:${clean(user.username).toLowerCase()}:${deviceId}:${Date.now()}`,
        Type: 'Test Push', Category: 'System', Audience: 'Staff', Channels: ['Push'],
        TargetUsernames: [user.username], Title: 'Notifications are working',
        Message: 'This device can receive Dynamax browser notifications.',
        ActionUrl: 'admin.html?section=notifications', BranchId: user.branchId,
        SchoolSection: clean(user.schoolSectionAccess) === 'All' ? '' : user.schoolSectionAccess,
        CreatedBy: user.username
      }, { ignorePreferences: true, deviceId });
      if (!testResult.pushDeliveries.some((delivery) => delivery.status === 'Delivered')) {
        const failure = testResult.pushDeliveries.find((delivery) => delivery.error);
        const error = new Error(failure?.error || 'The push service did not deliver the test notification. Reconnect this device and try again.');
        error.status = 502;
        throw error;
      }
    } else {
      const error = new Error('Unsupported notification action.');
      error.status = 400;
      throw error;
    }
    const [data, settings, subscriptions] = await Promise.all([
      loadForUser(env, user),
      loadNotificationSettings(env, 'Staff', user.username),
      listPushSubscriptions(env, user.username)
    ]);
    return response({ ok: true, ...data, settings, subscriptions, messaging: publicMessagingConfig(env), canManageSystemSettings: clean(user.role) === 'Super Admin' });
  } catch (error) {
    return response({ ok: false, message: error?.message || String(error) }, error?.status || 500);
  }
}
