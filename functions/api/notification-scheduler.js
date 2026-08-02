import { secureTextEqual } from '../lib/backend-security.js';
import { processFeeReminderSchedule } from '../lib/notification-reminders.js';
import { retryFailedPushDeliveries } from '../lib/firebase-messaging.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  processScheduledSchoolAnnouncements,
  processSchoolAnnouncementPushQueue
} from '../lib/school-announcements.js';
import { processScheduledChurchAnnouncements } from '../lib/church-announcements.js';

const clean = (value) => String(value ?? '').trim();

function requireSchedulerAuthorization(env, request) {
  const expected = clean(env.NOTIFICATION_SCHEDULER_SECRET);
  if (!expected) {
    const error = new Error('Notification scheduler is not configured.');
    error.status = 503;
    throw error;
  }
  const supplied = clean(request.headers.get('Authorization')).replace(/^Bearer\s+/i, '');
  if (!supplied || !secureTextEqual(supplied, expected)) {
    const error = new Error('Notification scheduler authorization failed.');
    error.status = 401;
    throw error;
  }
}

async function run(context) {
  try {
    requireSchedulerAuthorization(context.env, context.request);
    const body = context.request.method === 'POST'
      ? await readJsonBody(context.request, { maxBytes: 16 * 1024 })
      : {};
    const announcementsOnly = body.announcementsOnly === true;
    const reminders = announcementsOnly ? { skipped: true } : await processFeeReminderSchedule(context.env, {
      today: clean(body.today),
      limit: Number(body.limit || 250)
    });
    const schoolAnnouncements = await processScheduledSchoolAnnouncements(context.env, {
      now: clean(body.now),
      limit: Number(body.limit || 100)
    });
    const churchAnnouncements = await processScheduledChurchAnnouncements(context.env, {
      now: clean(body.now),
      limit: Number(body.limit || 100)
    });
    const announcements = {
      processed: Number(schoolAnnouncements.processed || 0) + Number(churchAnnouncements.processed || 0),
      sent: Number(schoolAnnouncements.sent || 0) + Number(churchAnnouncements.sent || 0),
      failed: Number(schoolAnnouncements.failed || 0) + Number(churchAnnouncements.failed || 0),
      school: schoolAnnouncements,
      church: churchAnnouncements
    };
    const announcementPush = await processSchoolAnnouncementPushQueue(context.env, {
      now: clean(body.now),
      limit: Number(body.pushJobLimit || 1)
    });
    const pushRetries = announcementsOnly ? { skipped: true } : await retryFailedPushDeliveries(context.env, { limit: 50 });
    return Response.json({ ok: true, reminders, announcements, announcementPush, pushRetries }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error?.message || String(error) }, {
      status: error?.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

export const onRequestGet = run;
export const onRequestPost = run;
