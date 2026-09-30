import { listCollection, queryCollection, queryCollectionPages, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { buildIncomeAnalytics, journalMatchesIncomeBranch, resolveIncomePeriod } from '../lib/income-analytics.js';
import { actorBranchScope, resolveRequestedBranch } from '../lib/branch-scope.js';
import { readJsonBody } from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

function nextDate(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function journalsForPeriod(env, period) {
  return queryCollectionPages(env, 'accountingJournals', {
    filters: [
      { field: 'Date', op: '>=', value: period.previousDateFrom },
      { field: 'Date', op: '<', value: nextDate(period.dateTo) }
    ],
    cursorField: 'Date',
    pageSize: 500,
    maxRows: 10000
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('incomeAnalytics')) {
      const error = new Error('Your staff account is not allowed to view income analytics.');
      error.status = 403;
      throw error;
    }
    const body = await readJsonBody(request, { maxBytes: 256 * 1024 });
    const period = resolveIncomePeriod(body);
    const [chart, journals] = await Promise.all([
      listCollection(env, 'chartOfAccounts'),
      journalsForPeriod(env, period)
    ]);
    const privileged = ['Super Admin', 'Accounts Officer', 'Management', 'Treasurer', 'Auditor'].includes(clean(user.role));
    const assignedBranch = actorBranchScope(user);
    const effectiveBranch = resolveRequestedBranch(user, body.branchId, {
      allowAll: privileged,
      fallback: 'main'
    });
    const scoped = (rows) => rows.filter((journal) => journalMatchesIncomeBranch(journal, effectiveBranch));
    let scopedJournals = scoped(journals);
    const implicitMonth = (!clean(body.period) || clean(body.period).toLowerCase() === 'monthly')
      && !clean(body.anchorDate) && !clean(body.dateFrom) && !clean(body.dateTo);
    if (implicitMonth && !scopedJournals.length) {
      // Only inspect a small recent index slice to locate the latest available month.
      const recent = await queryCollection(env, 'accountingJournals', {
        orderBy: [{ field: 'Date', direction: 'DESCENDING' }], limit: 200
      });
      scopedJournals = scoped(recent);
    }
    let analytics = buildIncomeAnalytics(chart, scopedJournals, { ...body, branchId: effectiveBranch });
    if (analytics.period.usedLatestAvailable) {
      const latestPeriod = resolveIncomePeriod({ period: 'monthly', anchorDate: analytics.period.dateFrom });
      scopedJournals = scoped(await journalsForPeriod(env, latestPeriod));
      analytics = buildIncomeAnalytics(chart, scopedJournals, {
        ...body, period: 'monthly', anchorDate: latestPeriod.dateFrom, branchId: effectiveBranch
      });
      analytics.period.usedLatestAvailable = true;
    }
    const branchOptions = assignedBranch
      ? [assignedBranch]
      : privileged
        ? [...new Set(['all', ...(analytics.options.branches || [])].filter(Boolean))]
        : [effectiveBranch];
    analytics.options.branches = branchOptions;
    analytics.filter = { ...body, branchId: effectiveBranch };
    return Response.json({ ok: true, message: 'Income analytics loaded.', ...analytics }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500 });
  }
}
