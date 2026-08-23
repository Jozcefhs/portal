const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase().replace(/^church$/, 'faith');

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function notificationSchedulerSettings(env = {}) {
  const endpoint = new URL(clean(env.SCHEDULER_ENDPOINT));
  if (endpoint.protocol !== 'https:') throw new Error('The notification scheduler endpoint must use HTTPS.');
  const workspaceId = lower(env.EXPECTED_WORKSPACE_ID);
  const edition = lower(env.EXPECTED_EDITION);
  const secret = clean(env.SCHEDULER_SECRET);
  if (!workspaceId) throw new Error('EXPECTED_WORKSPACE_ID is required.');
  if (!['school', 'faith', 'organization'].includes(edition)) throw new Error('EXPECTED_EDITION is invalid.');
  if (!secret) throw new Error('SCHEDULER_SECRET is required.');
  return {
    endpoint: endpoint.toString(),
    workspaceId,
    edition,
    secret,
    announcementCalls: boundedInteger(env.MAX_ANNOUNCEMENT_CALLS, 15, 1, 25),
    attendanceCalls: boundedInteger(env.MAX_ATTENDANCE_CALLS, 5, 1, 10)
  };
}

async function readSchedulerResponse(response) {
  const contentLength = Number(response.headers.get('Content-Length') || 0);
  if (contentLength > 128 * 1024) throw new Error('The notification scheduler response was unexpectedly large.');
  const text = await response.text();
  if (text.length > 128 * 1024) throw new Error('The notification scheduler response was unexpectedly large.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The notification scheduler did not return JSON (HTTP ${response.status}).`);
  }
}

export async function invokeNotificationScheduler(env, body, options = {}) {
  const settings = options.settings || notificationSchedulerSettings(env);
  const fetcher = options.fetch || fetch;
  const response = await fetcher(settings.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.secret}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...body,
      expectedWorkspaceId: settings.workspaceId,
      expectedEdition: settings.edition
    }),
    signal: AbortSignal.timeout(25_000)
  });
  const result = await readSchedulerResponse(response);
  if (!response.ok || result?.ok !== true) {
    throw new Error(clean(result?.message) || `The notification scheduler returned HTTP ${response.status}.`);
  }
  if (lower(result.workspaceId) !== settings.workspaceId || lower(result.edition) !== settings.edition) {
    throw new Error('The notification scheduler returned a different workspace identity.');
  }
  return result;
}

export async function runNotificationScheduler(env, options = {}) {
  const settings = notificationSchedulerSettings(env);
  const invoke = (body) => invokeNotificationScheduler(env, body, { ...options, settings });
  let announcementResult = null;
  let announcementCalls = 0;
  for (; announcementCalls < settings.announcementCalls; announcementCalls += 1) {
    announcementResult = await invoke({ announcementsOnly: true, pushJobLimit: 1 });
    if (Number(announcementResult?.announcements?.failed || 0) > 0) {
      throw new Error('One or more scheduled announcements could not be delivered.');
    }
    if (Number(announcementResult?.announcementPush?.failed || 0) > 0) {
      throw new Error('One or more scheduled announcement push batches failed.');
    }
    const remaining = Number(announcementResult?.announcementPush?.remaining || 0);
    const processed = Number(announcementResult?.announcements?.processed || 0);
    if (remaining <= 0 && processed <= 0) {
      announcementCalls += 1;
      break;
    }
  }

  let attendanceResult = null;
  let attendanceCalls = 0;
  if (settings.edition === 'school') {
    for (; attendanceCalls < settings.attendanceCalls; attendanceCalls += 1) {
      attendanceResult = await invoke({ attendanceOnly: true, attendanceLimit: 10 });
      const eligible = Number(attendanceResult?.attendancePresence?.eligible || 0);
      const retryBacklog = Number(attendanceResult?.pushRetries?.inspected || 0);
      if (eligible < 10 && retryBacklog < 50) {
        attendanceCalls += 1;
        break;
      }
    }
  }

  return {
    ok: true,
    workspaceId: settings.workspaceId,
    edition: settings.edition,
    announcementCalls,
    attendanceCalls,
    announcements: announcementResult?.announcements || { processed: 0, sent: 0, failed: 0 },
    announcementPush: announcementResult?.announcementPush || { inspected: 0, delivered: 0, failed: 0, remaining: 0 },
    attendancePresence: attendanceResult?.attendancePresence || { skipped: true },
    pushRetries: attendanceResult?.pushRetries || { skipped: true }
  };
}

export default {
  async scheduled(controller, env) {
    try {
      const result = await runNotificationScheduler(env);
      console.log(JSON.stringify({
        event: 'notification-scheduler.completed',
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
        ...result
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'notification-scheduler.failed',
        cron: controller.cron,
        scheduledTime: controller.scheduledTime,
        error: clean(error?.message || error)
      }));
      throw error;
    }
  }
};
