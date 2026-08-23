import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildNotificationWorkerConfig } from '../scripts/generate-notification-worker-config.mjs';
import {
  notificationSchedulerSettings,
  runNotificationScheduler
} from '../workers/notification-scheduler/index.js';

const env = {
  SCHEDULER_ENDPOINT: 'https://destinychristianacademy.pages.dev/api/notification-scheduler',
  EXPECTED_WORKSPACE_ID: 'school',
  EXPECTED_EDITION: 'school',
  SCHEDULER_SECRET: 'test-secret',
  MAX_ANNOUNCEMENT_CALLS: '15',
  MAX_ATTENDANCE_CALLS: '5'
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('the Cloudflare scheduler validates its tenant-bound configuration', () => {
  assert.equal(notificationSchedulerSettings(env).workspaceId, 'school');
  assert.throws(() => notificationSchedulerSettings({ ...env, SCHEDULER_ENDPOINT: 'http://example.test' }), /HTTPS/);
  assert.throws(() => notificationSchedulerSettings({ ...env, SCHEDULER_SECRET: '' }), /SCHEDULER_SECRET/);
});

test('the Cloudflare scheduler stops draining an idle queue and processes school attendance', async () => {
  const bodies = [];
  const fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    bodies.push(body);
    if (body.announcementsOnly) {
      return response({
        ok: true,
        workspaceId: 'school',
        edition: 'school',
        announcements: { processed: 0, sent: 0, failed: 0 },
        announcementPush: { inspected: 0, delivered: 0, failed: 0, remaining: 0 }
      });
    }
    return response({
      ok: true,
      workspaceId: 'school',
      edition: 'school',
      attendancePresence: { eligible: 0, created: 0, failed: 0 },
      pushRetries: { inspected: 0, retried: 0, delivered: 0 }
    });
  };
  const result = await runNotificationScheduler(env, { fetch });
  assert.equal(result.announcementCalls, 1);
  assert.equal(result.attendanceCalls, 1);
  assert.equal(bodies.length, 2);
  assert.ok(bodies.every((body) => body.expectedWorkspaceId === 'school' && body.expectedEdition === 'school'));
});

test('the Cloudflare scheduler drains remaining announcement batches', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return response({
      ok: true,
      workspaceId: 'faith',
      edition: 'faith',
      announcements: { processed: calls === 1 ? 1 : 0, sent: calls === 1 ? 1 : 0, failed: 0 },
      announcementPush: { inspected: 1, delivered: 1, failed: 0, remaining: calls === 1 ? 1 : 0 }
    });
  };
  const result = await runNotificationScheduler({
    ...env,
    EXPECTED_WORKSPACE_ID: 'faith',
    EXPECTED_EDITION: 'faith'
  }, { fetch });
  assert.equal(result.announcementCalls, 2);
  assert.equal(result.attendanceCalls, 0);
  assert.equal(calls, 2);
});

test('the Cloudflare scheduler rejects workspace identity drift', async () => {
  const fetch = async () => response({
    ok: true,
    workspaceId: 'another-school',
    edition: 'school',
    announcements: { processed: 0, sent: 0, failed: 0 },
    announcementPush: { inspected: 0, delivered: 0, failed: 0, remaining: 0 }
  });
  await assert.rejects(runNotificationScheduler(env, { fetch }), /different workspace identity/i);
});

test('generated scheduler configuration is cron-only, observable and contains no secret', async () => {
  const config = buildNotificationWorkerConfig({
    id: 'destinychristianacademy',
    name: 'Destiny Christian Academy',
    cloudflareProject: 'destinychristianacademy',
    workspaceId: 'school',
    edition: 'school'
  });
  assert.equal(config.workers_dev, false);
  assert.deepEqual(config.triggers.crons, ['*/5 * * * *']);
  assert.equal(config.observability.enabled, true);
  assert.equal(config.vars.SCHEDULER_ENDPOINT, 'https://destinychristianacademy.pages.dev/api/notification-scheduler');
  assert.equal('SCHEDULER_SECRET' in config.vars, false);

  const workflow = await readFile(new URL('../.github/workflows/deploy-notification-schedulers.yml', import.meta.url), 'utf8');
  assert.match(workflow, /matrix\.organisation\.githubEnvironment/);
  assert.match(workflow, /--secrets-file/);
  assert.match(workflow, /NOTIFICATION_SCHEDULER_SECRET/);
  assert.doesNotMatch(workflow, /echo[^\n]*SCHEDULER_SECRET/);
});
