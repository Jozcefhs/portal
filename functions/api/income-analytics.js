import { listCollection, queryCollection, requireFirestoreEnv } from '../lib/firestore.js';
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

const INCOME_PAGE_SIZE = 500;

function validCursor(env, cursor) {
  if (!cursor) return null;
  const date = clean(cursor.date);
  const name = clean(cursor.name);
  const prefix = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/accountingJournals/`;
  if (!/^\d{4}-\d{2}-\d{2}/.test(date) || !name.startsWith(prefix) || name.length <= prefix.length) {
    const error = new Error('The income report page cursor is invalid. Refresh the report.');
    error.status = 400;
    throw error;
  }
  return { date, name };
}

async function journalsForPeriodPage(env, period, cursor = null) {
  const rows = await queryCollection(env, 'accountingJournals', {
    filters: [
      { field: 'Date', op: '>=', value: period.previousDateFrom },
      { field: 'Date', op: '<', value: nextDate(period.dateTo) }
    ],
    orderBy: [{ field: 'Date' }, { field: '__name__' }],
    ...(cursor ? { startAfterFieldValue: cursor.date, startAfterName: cursor.name } : {}),
    limit: INCOME_PAGE_SIZE + 1
  });
  const journals = rows.slice(0, INCOME_PAGE_SIZE);
  const last = journals.at(-1);
  return {
    journals,
    nextCursor: rows.length > INCOME_PAGE_SIZE && last
      ? { date: clean(last.Date), name: clean(last.__name) }
      : null
  };
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
    const privileged = ['Super Admin', 'Accounts Officer', 'Management', 'Treasurer', 'Auditor'].includes(clean(user.role));
    const assignedBranch = actorBranchScope(user);
    const effectiveBranch = resolveRequestedBranch(user, body.branchId, {
      allowAll: privileged,
      fallback: 'main'
    });
    if (body.findLatest === true) {
      const [chart, recent] = await Promise.all([
        listCollection(env, 'chartOfAccounts'),
        queryCollection(env, 'accountingJournals', {
          orderBy: [{ field: 'Date', direction: 'DESCENDING' }], limit: 200
        })
      ]);
      const scoped = recent.filter((journal) => journalMatchesIncomeBranch(journal, effectiveBranch));
      const latest = buildIncomeAnalytics(chart, scoped, { ...body, anchorDate: '', dateFrom: '', dateTo: '', period: 'monthly', branchId: effectiveBranch });
      return Response.json({ ok: true, latestAvailableDate: latest.period.usedLatestAvailable ? latest.period.dateFrom : null }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const fixedFilter = { ...body, anchorDate: clean(body.anchorDate) || new Date().toISOString().slice(0, 10) };
    const period = resolveIncomePeriod(fixedFilter);
    const cursor = validCursor(env, body.cursor);
    const [chart, page] = await Promise.all([
      listCollection(env, 'chartOfAccounts'),
      journalsForPeriodPage(env, period, cursor)
    ]);
    const scopedJournals = page.journals.filter((journal) => journalMatchesIncomeBranch(journal, effectiveBranch));
    const analytics = buildIncomeAnalytics(chart, scopedJournals, { ...fixedFilter, branchId: effectiveBranch });
    const branchOptions = assignedBranch
      ? [assignedBranch]
      : privileged
        ? [...new Set(['all', ...(analytics.options.branches || [])].filter(Boolean))]
        : [effectiveBranch];
    analytics.options.branches = branchOptions;
    analytics.filter = { ...body, cursor: undefined, branchId: effectiveBranch };
    return Response.json({ ok: true, message: 'Income analytics page loaded.', ...analytics,
      nextCursor: page.nextCursor, pageSize: page.journals.length }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500 });
  }
}
