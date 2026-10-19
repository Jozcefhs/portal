import { requireStaffSession } from '../lib/staff-auth.js';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTargetsRecipient
} from '../lib/notifications.js';
import { getDocument } from '../lib/firestore.js';
import { readJsonBody } from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

function recipientFor(user) {
  return {
    audience: 'Staff',
    recipientKey: user.username,
    username: user.username,
    role: user.role,
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

async function loadForUser(env, user) {
  return listNotifications(env, recipientFor(user), { limit: 50 });
}

export async function onRequestGet(context) {
  try {
    const user = await requireStaffSession(context.env, context.request);
    const data = await loadForUser(context.env, user);
    return response({ ok: true, ...data });
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
    const recipient = recipientFor(user);
    const current = await loadForUser(env, user);
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
    } else {
      const error = new Error('Unsupported notification action.');
      error.status = 400;
      throw error;
    }
    const data = await loadForUser(env, user);
    return response({ ok: true, ...data });
  } catch (error) {
    return response({ ok: false, message: error?.message || String(error) }, error?.status || 500);
  }
}
