import { requiredDeploymentIdentity } from '../lib/deployment-identity.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import {
  academicPolicyScopeChain,
  normalizeAcademicPolicyPeriod,
  normalizeAcademicPolicyScope
} from '../lib/academic-policy.js';
import {
  activateAcademicPolicyDraft,
  inheritAcademicPolicyAtScope,
  loadAcademicPolicyView,
  saveAcademicPolicyDraft
} from '../lib/academic-policy-store.js';
import { assertConfiguredProfileBranch } from '../lib/branch-profile-settings.js';
import { finishRequestMetric, startRequestMetric } from '../lib/request-metrics.js';
import { readJsonBody } from '../lib/request-security.js';
import { requireSetupAdministrator } from '../lib/setup-auth.js';

const clean = (value) => String(value ?? '').trim();

function schoolOnly(env) {
  const deployment = requiredDeploymentIdentity(env);
  if (deployment.edition !== 'school') {
    const error = new Error('Academic policy settings are available only in the School edition.');
    error.status = 404;
    throw error;
  }
  return deployment;
}

async function requestScope(env, body = {}) {
  const settingsScope = clean(body.SettingsScope || body.settingsScope || body.Scope?.Type).toLowerCase();
  if (!['', 'organisation', 'organization', 'branch'].includes(settingsScope)) {
    const error = new Error('The first academic-policy release supports organisation and branch scopes.');
    error.status = 400;
    throw error;
  }
  if (settingsScope === 'branch') {
    const branch = await assertConfiguredProfileBranch(env, body.BranchId || body.branchId || body.Scope?.Id);
    return {
      scope: normalizeAcademicPolicyScope({ Type: 'branch', Id: branch.id }),
      scopeChain: academicPolicyScopeChain({ BranchId: branch.id })
    };
  }
  return {
    scope: normalizeAcademicPolicyScope({ Type: 'organisation' }),
    scopeChain: academicPolicyScopeChain()
  };
}

function responseView(view = {}) {
  return {
    Scope: view.Scope,
    Period: view.Period,
    AssignmentId: view.AssignmentId,
    InheritedPolicy: view.InheritedPolicy,
    ActivePolicy: view.ActivePolicy,
    Policy: view.Policy,
    ActiveRevisionId: view.ActiveRevisionId,
    DraftRevisionId: view.DraftRevisionId,
    ActivationIssues: view.ActivationIssues,
    CanActivate: view.CanActivate,
    Sources: view.Sources
  };
}

export async function onRequestPost(context) {
  const metric = startRequestMetric(context.request, '/api/academic-policy');
  let action = 'load';
  try {
    const { request, env } = context;
    schoolOnly(env);
    const body = await readJsonBody(request, { maxBytes: 512 * 1024 });
    const actor = await requireSetupAdministrator(env, request, body.password);
    requireFirestoreEnv(env);
    action = clean(body.action || body.Action || 'load').toLowerCase();
    const { scope, scopeChain } = await requestScope(env, body);
    const period = normalizeAcademicPolicyPeriod({
      Session: body.Session || body.AcademicSession,
      Term: body.Term
    });
    let view;
    let message = 'Academic policy loaded.';
    if (action === 'save' || action === 'savedraft') {
      view = await saveAcademicPolicyDraft(env, {
        scope,
        scopeChain,
        period,
        policy: body.policy || body.Policy,
        actor
      });
      message = view.CanActivate
        ? 'Academic policy draft saved and ready for activation.'
        : 'Academic policy draft saved. Resolve the listed requirements before activation.';
    } else if (action === 'activate') {
      view = await activateAcademicPolicyDraft(env, { scope, scopeChain, period, actor });
      message = 'Academic policy activated for the selected scope, session and term.';
    } else if (action === 'inherit' || action === 'reset') {
      view = await inheritAcademicPolicyAtScope(env, { scope, scopeChain, period, actor });
      message = 'This branch now inherits the organisation academic policy for the selected period.';
    } else if (action === 'load') {
      view = await loadAcademicPolicyView(env, { scope, scopeChain, period });
    } else {
      const error = new Error('Unsupported academic policy action.');
      error.status = 400;
      throw error;
    }
    finishRequestMetric(metric, { status: 200, action: `academic-policy-${action}` });
    return Response.json({ ok: true, message, view: responseView(view) }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    finishRequestMetric(metric, { status, action: `academic-policy-${action}`, outcome: error?.code || 'error' });
    return Response.json({
      ok: false,
      message: clean(error?.message) || 'Academic policy request failed.',
      issues: Array.isArray(error?.issues) ? error.issues : []
    }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
