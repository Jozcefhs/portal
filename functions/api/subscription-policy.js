import { queryCollection } from '../lib/firestore.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';

const clean = (value) => String(value ?? '').trim();

function publicPolicy(row = {}) {
  return {
    WorkspaceId: clean(row.WorkspaceId),
    Edition: clean(row.Edition),
    Plan: clean(row.Plan),
    BillingCycle: clean(row.BillingCycle || 'monthly'),
    UserLimit: Math.max(1, Number(row.UserLimit || 5) || 5),
    SubscriptionStatus: clean(row.SubscriptionStatus),
    PaymentStatus: clean(row.PaymentStatus),
    TrialStartedAt: clean(row.TrialStartedAt),
    TrialEndsAt: clean(row.TrialEndsAt),
    LifecycleStage: clean(row.LifecycleStage),
    PaidThroughAt: clean(row.PaidThroughAt),
    RenewalDueAt: clean(row.RenewalDueAt || row.PaidThroughAt),
    GracePeriodEndsAt: clean(row.GracePeriodEndsAt),
    DataRetentionEndsAt: clean(row.DataRetentionEndsAt),
    PlanCatalogRevision: clean(row.PlanCatalogRevision),
    PendingPlan: clean(row.PendingPlan),
    PendingBillingCycle: clean(row.PendingBillingCycle),
    UpdatedAt: clean(row.UpdatedAt || row.CreatedAt)
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    const url = new URL(request.url);
    const workspaceId = clean(request.headers.get('X-Dynamax-Workspace') || url.searchParams.get('workspace')).toLowerCase();
    if (!workspaceId) return Response.json({ ok: false, message: 'Workspace is required.' }, { status: 400 });
    const rows = await queryCollection(platformEnv, 'tenantRegistrations', {
      filters: [{ field: 'WorkspaceId', op: '==', value: workspaceId }],
      limit: 20
    });
    const registration = rows
      .filter((row) => !['rejected', 'cancelled', 'retired', 'terminated', 'deleted'].includes(clean(row.Status).toLowerCase()))
      .sort((left, right) => clean(right.UpdatedAt || right.CreatedAt).localeCompare(clean(left.UpdatedAt || left.CreatedAt)))[0];
    if (!registration) return Response.json({ ok: false, message: 'No active subscription record was found for this workspace.' }, { status: 404 });
    return Response.json({ ok: true, policy: publicPolicy(registration) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
