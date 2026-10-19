import { secureTextEqual } from '../lib/backend-security.js';
import { processFeeReminderSchedule } from '../lib/notification-reminders.js';
import { processDueSchoolFeeCredits } from './backend.js';
import { retryFailedPushDeliveries } from '../lib/firebase-messaging.js';
import { readJsonBody } from '../lib/request-security.js';
import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import {
  processScheduledSchoolAnnouncements,
  processSchoolAnnouncementPushQueue
} from '../lib/school-announcements.js';
import { processScheduledChurchAnnouncements } from '../lib/church-announcements.js';
import { processAttendancePresenceNotifications } from '../lib/attendance-presence-notifications.js';
import { processLibraryDueReminders } from '../lib/school-library.js';
import { notificationSchedulerDiagnostic } from '../lib/notification-scheduler-diagnostics.js';

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
  let authorized = false;
  let stage = 'authorization';
  try {
    requireSchedulerAuthorization(context.env, context.request);
    authorized = true;
    stage = 'request-validation';
    // Assign a trusted service identity only after verifying the scheduler secret.
    context.data ||= {};
    context.data.securityAuditActor = {
      displayName: 'System — Notification Scheduler',
      username: 'system:notification-scheduler', role: 'System', sourcePlatform: 'System'
    };
    context.data.securityAuditAction = 'RUN NOTIFICATION SCHEDULER';
    const body = context.request.method === 'POST'
      ? await readJsonBody(context.request, { maxBytes: 16 * 1024 })
      : {};
    const identity = requiredDeploymentIdentity(context.env);
    const expectedWorkspaceId = clean(body.expectedWorkspaceId).toLowerCase();
    const expectedEdition = clean(body.expectedEdition).toLowerCase().replace(/^church$/, 'faith');
    if (expectedWorkspaceId && expectedWorkspaceId !== identity.workspaceId) {
      const error = new Error(`Notification scheduler workspace mismatch: expected ${expectedWorkspaceId}, received ${identity.workspaceId}.`);
      error.status = 409;
      throw error;
    }
    if (expectedEdition && expectedEdition !== identity.edition) {
      const error = new Error(`Notification scheduler edition mismatch: expected ${expectedEdition}, received ${identity.edition}.`);
      error.status = 409;
      throw error;
    }
    const announcementsOnly = body.announcementsOnly === true;
    const attendanceOnly = body.attendanceOnly === true;
    stage = 'school-fee-credits';
    const schoolFeeCredits = announcementsOnly || attendanceOnly || identity.edition !== 'school'
      ? { skipped: true }
      : await processDueSchoolFeeCredits(context.env, {
          today: clean(body.today),
          limit: Number(body.creditLimit || 1000)
        });
    stage = 'fee-reminders';
    const reminders = announcementsOnly || attendanceOnly ? { skipped: true } : await processFeeReminderSchedule(context.env, {
      today: clean(body.today),
      limit: Number(body.limit || 250)
    });
    stage = 'library-reminders';
    const libraryReminders = announcementsOnly || attendanceOnly || identity.edition !== 'school'
      ? { skipped: true }
      : await processLibraryDueReminders(context.env, {
          today: clean(body.today), limit: Number(body.libraryLimit || 250)
        });
    stage = 'school-announcements';
    const schoolAnnouncements = attendanceOnly || identity.edition !== 'school' ? { skipped: true } : await processScheduledSchoolAnnouncements(context.env, {
        now: clean(body.now),
        limit: Number(body.limit || 100)
      });
    stage = 'organisation-announcements';
    const churchAnnouncements = attendanceOnly || !['faith', 'organization'].includes(identity.edition) ? { skipped: true } : await processScheduledChurchAnnouncements(context.env, {
        now: clean(body.now),
        edition: identity.edition,
        limit: Number(body.limit || 100)
      });
    const announcements = {
      processed: Number(schoolAnnouncements.processed || 0) + Number(churchAnnouncements.processed || 0),
      sent: Number(schoolAnnouncements.sent || 0) + Number(churchAnnouncements.sent || 0),
      failed: Number(schoolAnnouncements.failed || 0) + Number(churchAnnouncements.failed || 0),
      school: schoolAnnouncements,
      church: churchAnnouncements
    };
    stage = 'announcement-push-queue';
    const announcementPush = attendanceOnly ? { skipped: true } : await processSchoolAnnouncementPushQueue(context.env, {
      now: clean(body.now),
      limit: Number(body.pushJobLimit || 1),
      edition: ['faith', 'organization'].includes(identity.edition) ? 'church' : identity.edition
    });
    stage = 'attendance-presence';
    const attendancePresence = announcementsOnly ? { skipped: true } : await processAttendancePresenceNotifications(context.env, {
      now: clean(body.now),
      limit: Number(body.attendanceLimit || 2)
    });
    stage = 'push-delivery-retries';
    const pushRetries = announcementsOnly ? { skipped: true } : await retryFailedPushDeliveries(context.env, { limit: 50 });
    stage = 'result-summary';
    const creditRunFailed = schoolFeeCredits.ok === false;
    const deliveryFailed = [reminders, libraryReminders, announcements, announcementPush, attendancePresence]
      .some((result) => result.ok === false || Number(result.failed || 0) > 0)
      || Number(pushRetries.retried || 0) > Number(pushRetries.delivered || 0);
    const creditedInvoices = Number(schoolFeeCredits.creditedInvoices || 0);
    // Only successful routine delivery/check runs are hideable. Financial
    // postings and any reported internal failures remain in the default view.
    context.data.securityAuditActivityClass = !creditRunFailed && !deliveryFailed && creditedInvoices === 0
      ? 'Routine system' : 'System activity';
    context.data.securityAuditOutcome = creditRunFailed || deliveryFailed ? 'Failed' : 'Success';
    context.data.securityAuditDetails = `Scheduler run; credited invoices: ${creditedInvoices}; announcements sent: ${Number(announcements.sent || 0)}; delivery failures reported: ${deliveryFailed ? 'yes' : 'no'}.`;
    return Response.json({
      ok: !creditRunFailed,
      ...(creditRunFailed ? { message: 'One or more due school-fee credits could not be applied; inspect schoolFeeCredits and retry.' } : {}),
      workspaceId: identity.workspaceId,
      edition: identity.edition,
      schoolFeeCredits,
      reminders,
      libraryReminders,
      announcements,
      announcementPush,
      attendancePresence,
      pushRetries
    }, { status: creditRunFailed ? 500 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const diagnostic = authorized ? notificationSchedulerDiagnostic(stage, error) : null;
    if (diagnostic) console.error(JSON.stringify({ event: 'notification-scheduler.failed', ...diagnostic }));
    return Response.json({ ok: false,
      message: diagnostic ? `Notification scheduler failed at ${stage}: ${diagnostic.reason}` : error?.message || String(error),
      ...(diagnostic ? { diagnostic } : {})
    }, {
      status: error?.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}

export const onRequestGet = run;
export const onRequestPost = run;
