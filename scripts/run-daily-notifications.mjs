import { pathToFileURL } from 'node:url';

// Log counts and classifications only: responses may contain parent identities.
export async function runDailyNotifications(env = process.env, dependencies = {}) {
  const request = dependencies.fetch || fetch;
  const log = dependencies.log || console.log;
  const pause = dependencies.pause || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const mode = env.SCHEDULER_MODE;
  const modes = { credits: 'schoolFeeCreditsOnly', reminders: 'feeRemindersOnly', maintenance: 'dailyMaintenanceOnly' };
  if (!modes[mode] || !env.SCHEDULER_SECRET || !env.ENDPOINT || !env.EXPECTED_WORKSPACE_ID || env.EXPECTED_EDITION !== 'school') {
    throw new Error('Daily scheduler configuration is incomplete.');
  }
  const endpoint = new URL(env.ENDPOINT);
  if (endpoint.protocol !== 'https:' || endpoint.pathname !== '/api/notification-scheduler') throw new Error('Invalid scheduler endpoint.');
  const today = env.PROCESS_DATE || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || new Date(`${today}T00:00:00Z`).toISOString().slice(0, 10) !== today) throw new Error('Invalid processing date.');
  const totals = { pages: 0, inspected: 0, created: 0, duplicates: 0, updated: 0, pushQueued: 0, creditedInvoices: 0 };
  let cursor;
  for (let page = 1; page <= 1000; page++) {
    let data;
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await request(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${env.SCHEDULER_SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [modes[mode]]: true, today, creditLimit: 25, limit: 25,
          reminderCursor: cursor, expectedWorkspaceId: env.EXPECTED_WORKSPACE_ID, expectedEdition: env.EXPECTED_EDITION }),
        signal: AbortSignal.timeout(120000)
      });
      data = await response.json().catch(() => ({}));
      if (response.ok && data.ok === true) break;
      const diagnostic = data.diagnostic || {};
      const stage = /^[a-z-]+$/.test(diagnostic.stage || '') ? diagnostic.stage : 'unknown';
      const issue = /^[A-Z_]+$/.test(diagnostic.issue || '') ? diagnostic.issue : 'REQUEST_FAILED';
      log(JSON.stringify({ mode, page, attempt: attempt + 1, httpStatus: response.status, stage, issue }));
      const retryable = [429, 500, 502, 503, 504].includes(response.status)
        || (response.status === 409 && issue === 'DATABASE_PRECONDITION');
      if (!retryable || attempt === 3) throw new Error(`Daily ${mode} failed: HTTP ${response.status}, ${stage}, ${issue}. Completed work is retained.`);
      await pause(1000 * 2 ** attempt);
    }
    if (data.workspaceId !== env.EXPECTED_WORKSPACE_ID || data.edition !== env.EXPECTED_EDITION) throw new Error('Scheduler response belongs to a different workspace.');
    const result = mode === 'credits' ? data.schoolFeeCredits : mode === 'reminders' ? data.reminders : {};
    // The credit scheduler's completed-date watermark deliberately returns
    // skipped on a same-day retry: this is successful, zero-write completion.
    if (!result || (result.skipped && !(mode === 'credits' && result.ok === true && result.hasMore === false))) {
      throw new Error(`Daily ${mode} was not executed.`);
    }
    totals.pages++;
    for (const key of Object.keys(totals).filter(key => key !== 'pages')) totals[key] += Number(result[key] || 0);
    log(JSON.stringify({ mode, date: today, page, ...Object.fromEntries(Object.keys(totals).filter(key => key !== 'pages').map(key => [key, Number(result[key] || 0)])), hasMore: result.hasMore === true }));
    if (!result.hasMore) {
      log(JSON.stringify({ mode, date: today, complete: true, totals }));
      return totals;
    }
    if (mode === 'reminders') {
      if (!result.cursor || JSON.stringify(result.cursor) === JSON.stringify(cursor)) throw new Error('Reminder pagination did not advance.');
      cursor = result.cursor;
    }
  }
  throw new Error(`Daily ${mode} reached its page limit. Run again to resume safely.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDailyNotifications().catch(error => { console.error(error.message); process.exitCode = 1; });
}
