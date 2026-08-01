import {
  createDocumentIfAbsent,
  deleteDocument,
  getDocument,
  queryCollection,
  upsertDocument
} from './firestore.js';
import { getGoogleAccessToken } from './google-service-account.js';

const MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const clean = (value) => String(value ?? '').trim();

function safeId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/[^a-zA-Z0-9._:-]+/g, '-').slice(0, 180);
}

function hash(value) {
  let result = 2166136261;
  for (const character of clean(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function subscriptionDocumentId(recipientKey, deviceId) {
  return `SUB-${safeId(`${clean(recipientKey).toLowerCase()}:${clean(deviceId)}`).slice(0, 130)}-${hash(`${recipientKey}:${deviceId}`)}`;
}

export function deliveryDocumentId(notificationId, channel, recipientKey, deviceId = '') {
  const key = `${notificationId}:${clean(channel).toLowerCase()}:${clean(recipientKey).toLowerCase()}:${deviceId}`;
  return `DEL-${safeId(key).slice(0, 130)}-${hash(key)}`;
}

export function publicMessagingConfig(env = {}) {
  const config = {
    apiKey: clean(env.FIREBASE_WEB_API_KEY),
    projectId: clean(env.FIREBASE_PROJECT_ID),
    appId: clean(env.FIREBASE_APP_ID),
    messagingSenderId: clean(env.FIREBASE_MESSAGING_SENDER_ID),
    vapidKey: clean(env.FCM_VAPID_KEY)
  };
  return { enabled: Object.values(config).every(Boolean), ...config };
}

export async function savePushSubscription(env, input = {}) {
  const recipientKey = clean(input.RecipientKey || input.recipientKey).toLowerCase();
  const deviceId = clean(input.DeviceId || input.deviceId);
  const token = clean(input.Token || input.token);
  if (!recipientKey || !deviceId || !token) {
    const error = new Error('Recipient, device and push token are required.');
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  const record = {
    SubscriptionId: subscriptionDocumentId(recipientKey, deviceId),
    SchoolId: clean(input.SchoolId || input.schoolId),
    Audience: clean(input.Audience || input.audience),
    RecipientKey: recipientKey,
    DeviceId: deviceId,
    Token: token,
    DeviceName: clean(input.DeviceName || input.deviceName).slice(0, 120),
    Platform: clean(input.Platform || input.platform).slice(0, 80),
    UserAgent: clean(input.UserAgent || input.userAgent).slice(0, 300),
    Active: true,
    CreatedAt: clean(input.CreatedAt) || now,
    UpdatedAt: now,
    LastSeenAt: now
  };
  const existingForToken = await queryCollection(env, 'notificationSubscriptions', {
    filters: [{ field: 'Token', op: '==', value: token }],
    limit: 20
  }).catch(() => []);
  await Promise.all(existingForToken
    .filter((row) => clean(row.SubscriptionId || row.__id) !== record.SubscriptionId)
    .map((row) => deleteDocument(env, 'notificationSubscriptions', clean(row.SubscriptionId || row.__id)).catch(() => null)));
  await upsertDocument(env, 'notificationSubscriptions', record.SubscriptionId, record);
  return record;
}

export async function removePushSubscription(env, recipientKey, deviceId) {
  await deleteDocument(env, 'notificationSubscriptions', subscriptionDocumentId(recipientKey, deviceId));
}

export async function listPushSubscriptions(env, recipientKey, { includeToken = false } = {}) {
  const key = clean(recipientKey).toLowerCase();
  if (!key) return [];
  const rows = await queryCollection(env, 'notificationSubscriptions', {
    filters: [{ field: 'RecipientKey', op: '==', value: key }],
    limit: 100
  });
  return rows.filter((row) => row.Active !== false).map((row) => {
    if (includeToken) return row;
    const copy = { ...row };
    delete copy.Token;
    return copy;
  });
}

function invalidTokenResponse(status, data) {
  const code = clean(data?.error?.details?.find?.((item) => item?.errorCode)?.errorCode || data?.error?.status);
  return status === 404 || ['UNREGISTERED', 'INVALID_ARGUMENT'].includes(code);
}

async function sendToFcm(env, token, notification) {
  const accessToken = await getGoogleAccessToken(env, MESSAGING_SCOPE);
  let actionLink = '';
  const baseUrl = clean(env.PORTAL_BASE_URL || env.PUBLIC_BASE_URL);
  try {
    const candidate = new URL(clean(notification.ActionUrl || '/'), baseUrl || undefined);
    if (candidate.protocol === 'https:') actionLink = candidate.href;
  } catch {}
  const webpush = {
    headers: { Urgency: clean(notification.Severity).toLowerCase() === 'urgent' ? 'high' : 'normal' }
  };
  if (actionLink) webpush.fcm_options = { link: actionLink };
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: clean(notification.Title), body: clean(notification.Message) },
        data: {
          notificationId: clean(notification.NotificationId),
          category: clean(notification.Category || notification.Type),
          actionUrl: clean(notification.ActionUrl || '/')
        },
        webpush
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Push delivery failed (${response.status}).`);
    error.status = response.status;
    error.invalidToken = invalidTokenResponse(response.status, data);
    throw error;
  }
  return data;
}

export async function deliverPushNotification(env, notification, recipientKey, options = {}) {
  const allSubscriptions = options.subscriptions || await listPushSubscriptions(env, recipientKey, { includeToken: true });
  const subscriptions = clean(options.deviceId)
    ? allSubscriptions.filter((row) => clean(row.DeviceId) === clean(options.deviceId))
    : allSubscriptions;
  const results = [];
  for (const subscription of subscriptions) {
    const deliveryId = deliveryDocumentId(notification.NotificationId, 'push', recipientKey, subscription.DeviceId);
    const pending = {
      DeliveryId: deliveryId,
      SchoolId: clean(notification.SchoolId),
      NotificationId: clean(notification.NotificationId),
      RecipientKey: clean(recipientKey).toLowerCase(),
      DeviceId: clean(subscription.DeviceId),
      Channel: 'Push',
      Status: 'Pending',
      AttemptCount: 0,
      CreatedAt: new Date().toISOString(),
      UpdatedAt: new Date().toISOString()
    };
    const claim = await createDocumentIfAbsent(env, 'notificationDeliveries', deliveryId, pending);
    if (!claim.created && ['Delivered', 'Suppressed'].includes(clean(claim.document?.Status))) {
      results.push({ deliveryId, status: clean(claim.document.Status), duplicate: true });
      continue;
    }
    try {
      const sent = await sendToFcm(env, subscription.Token, notification);
      const delivered = { ...pending, Status: 'Delivered', AttemptCount: Number(claim.document?.AttemptCount || 0) + 1, ProviderMessageId: clean(sent.name), DeliveredAt: new Date().toISOString(), UpdatedAt: new Date().toISOString() };
      await upsertDocument(env, 'notificationDeliveries', deliveryId, delivered);
      results.push({ deliveryId, status: 'Delivered' });
    } catch (error) {
      const failed = { ...pending, Status: error.invalidToken ? 'Invalid subscription' : 'Failed', AttemptCount: Number(claim.document?.AttemptCount || 0) + 1, LastError: clean(error.message).slice(0, 500), UpdatedAt: new Date().toISOString() };
      await upsertDocument(env, 'notificationDeliveries', deliveryId, failed);
      if (error.invalidToken) await deleteDocument(env, 'notificationSubscriptions', clean(subscription.SubscriptionId || subscription.__id)).catch(() => null);
      results.push({ deliveryId, status: failed.Status, error: failed.LastError });
    }
  }
  return results;
}

export async function retryFailedPushDeliveries(env, options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const failures = await queryCollection(env, 'notificationDeliveries', {
    filters: [{ field: 'Status', op: '==', value: 'Failed' }],
    limit
  });
  let retried = 0;
  let delivered = 0;
  for (const failure of failures.filter((row) => Number(row.AttemptCount || 0) < 5)) {
    const [notification, subscriptions] = await Promise.all([
      getDocument(env, 'notifications', clean(failure.NotificationId)),
      listPushSubscriptions(env, clean(failure.RecipientKey), { includeToken: true })
    ]);
    if (!notification) continue;
    const deviceSubscriptions = subscriptions.filter((row) => clean(row.DeviceId) === clean(failure.DeviceId));
    if (!deviceSubscriptions.length) continue;
    const results = await deliverPushNotification(env, notification, failure.RecipientKey, { subscriptions: deviceSubscriptions });
    retried += 1;
    if (results.some((result) => result.status === 'Delivered')) delivered += 1;
  }
  return { inspected: failures.length, retried, delivered };
}
