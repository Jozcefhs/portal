import { listCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { buildIncomeAnalytics, journalMatchesIncomeBranch } from '../lib/income-analytics.js';
import { actorBranchScope, resolveRequestedBranch } from '../lib/branch-scope.js';
import { readJsonBody } from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
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
    const [chart, journals] = await Promise.all([
      listCollection(env, 'chartOfAccounts'),
      listCollection(env, 'accountingJournals')
    ]);
    const privileged = ['Super Admin', 'Accounts Officer', 'Management', 'Treasurer', 'Auditor'].includes(clean(user.role));
    const assignedBranch = actorBranchScope(user);
    const effectiveBranch = resolveRequestedBranch(user, body.branchId, {
      allowAll: privileged,
      fallback: 'main'
    });
    const scopedJournals = journals.filter((journal) => journalMatchesIncomeBranch(journal, effectiveBranch));
    const analytics = buildIncomeAnalytics(chart, scopedJournals, { ...body, branchId: effectiveBranch });
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
