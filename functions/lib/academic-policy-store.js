import { createDocumentIfAbsent, getDocument, upsertDocument } from './firestore.js';
import {
  academicPolicyAssignmentId,
  academicPolicyIssues,
  applyAcademicPolicyOverrides,
  assertAcademicPolicyActivatable,
  deriveAcademicPolicyOverrides,
  normalizeAcademicPolicy,
  normalizeAcademicPolicyPeriod,
  normalizeAcademicPolicyScope,
  resolveAcademicPolicyChain
} from './academic-policy.js';

const clean = (value) => String(value ?? '').trim();

export const ACADEMIC_POLICY_ASSIGNMENTS_COLLECTION = 'academicPolicyAssignments';
export const ACADEMIC_POLICY_REVISIONS_COLLECTION = 'academicPolicyRevisions';

function sameScope(left = {}, right = {}) {
  const a = normalizeAcademicPolicyScope(left);
  const b = normalizeAcademicPolicyScope(right);
  return a.Type === b.Type && a.Id === b.Id;
}

function actorName(actor = {}) {
  return clean(actor.displayName || actor.DisplayName || actor.username || actor.Username || actor.UpdatedBy) || 'Administrator';
}

export async function loadAcademicPolicyAssignment(env, scopeValue = {}, periodValue = {}) {
  const id = academicPolicyAssignmentId(scopeValue, periodValue);
  return getDocument(env, ACADEMIC_POLICY_ASSIGNMENTS_COLLECTION, id);
}

export async function loadAcademicPolicyRevision(env, revisionId) {
  const id = clean(revisionId);
  if (!id) return null;
  return getDocument(env, ACADEMIC_POLICY_REVISIONS_COLLECTION, id);
}

async function activeScopeEntry(env, scope, period) {
  const assignment = await loadAcademicPolicyAssignment(env, scope, period);
  const revision = await loadAcademicPolicyRevision(env, assignment?.ActiveRevisionId);
  return { scope, assignment, revision };
}

export async function loadAcademicPolicyView(env, {
  scope: scopeValue = {},
  scopeChain = [],
  period: periodValue = {}
} = {}) {
  const scope = normalizeAcademicPolicyScope(scopeValue);
  const period = normalizeAcademicPolicyPeriod(periodValue);
  const chain = (Array.isArray(scopeChain) && scopeChain.length ? scopeChain : [scope])
    .map(normalizeAcademicPolicyScope);
  if (!chain.some((candidate) => sameScope(candidate, scope))) {
    const error = new Error('The selected academic policy scope is outside the requested inheritance chain.');
    error.status = 400;
    throw error;
  }
  const targetIndex = chain.findIndex((candidate) => sameScope(candidate, scope));
  const applicableChain = chain.slice(0, targetIndex + 1);
  const entries = [];
  for (const candidate of applicableChain) {
    entries.push(await activeScopeEntry(env, candidate, period));
  }
  const targetEntry = entries.at(-1);
  const draftRevision = await loadAcademicPolicyRevision(env, targetEntry?.assignment?.DraftRevisionId);
  const inheritedRevisions = entries.slice(0, -1).map((entry) => entry.revision).filter(Boolean);
  const inheritedPolicy = resolveAcademicPolicyChain(inheritedRevisions);
  const activePolicy = targetEntry?.revision
    ? applyAcademicPolicyOverrides(inheritedPolicy, targetEntry.revision.Overrides || {})
    : inheritedPolicy;
  const draftPolicy = draftRevision
    ? applyAcademicPolicyOverrides(inheritedPolicy, draftRevision.Overrides || {})
    : activePolicy;
  const draftIssues = academicPolicyIssues(draftPolicy, { forActivation: true });
  return {
    Scope: scope,
    Period: period,
    AssignmentId: academicPolicyAssignmentId(scope, period),
    InheritedPolicy: inheritedPolicy,
    ActivePolicy: activePolicy,
    Policy: draftPolicy,
    DraftOverrides: draftRevision?.Overrides || {},
    ActiveRevisionId: clean(targetEntry?.assignment?.ActiveRevisionId),
    DraftRevisionId: clean(targetEntry?.assignment?.DraftRevisionId),
    ActiveRevision: targetEntry?.revision || null,
    DraftRevision: draftRevision || null,
    ActivationIssues: draftIssues,
    CanActivate: Boolean(draftRevision) && draftIssues.length === 0,
    Sources: entries.filter((entry) => entry.revision).map((entry) => ({
      Scope: entry.scope,
      RevisionId: clean(entry.revision?.RevisionId || entry.assignment?.ActiveRevisionId)
    }))
  };
}

function revisionId(assignmentId) {
  const suffix = globalThis.crypto.randomUUID();
  return `${assignmentId}__revision__${suffix}`;
}

export async function saveAcademicPolicyDraft(env, {
  scope,
  scopeChain,
  period,
  policy,
  actor = {}
} = {}) {
  const view = await loadAcademicPolicyView(env, { scope, scopeChain, period });
  const submitted = normalizeAcademicPolicy(policy);
  const overrides = deriveAcademicPolicyOverrides(view.InheritedPolicy, submitted);
  const issues = academicPolicyIssues(submitted, { forActivation: true });
  const id = revisionId(view.AssignmentId);
  const now = new Date().toISOString();
  const revision = {
    RevisionId: id,
    AssignmentId: view.AssignmentId,
    Scope: view.Scope,
    Period: view.Period,
    Overrides: overrides,
    ActivationIssues: issues,
    CreatedAt: now,
    CreatedBy: actorName(actor)
  };
  const created = await createDocumentIfAbsent(env, ACADEMIC_POLICY_REVISIONS_COLLECTION, id, revision);
  if (!created.created) {
    const error = new Error('Could not allocate a unique academic policy revision. Try saving again.');
    error.status = 409;
    throw error;
  }
  await upsertDocument(env, ACADEMIC_POLICY_ASSIGNMENTS_COLLECTION, view.AssignmentId, {
    AssignmentId: view.AssignmentId,
    Scope: view.Scope,
    Period: view.Period,
    ActiveRevisionId: view.ActiveRevisionId,
    DraftRevisionId: id,
    UpdatedAt: now,
    UpdatedBy: actorName(actor)
  });
  return loadAcademicPolicyView(env, { scope, scopeChain, period });
}

export async function activateAcademicPolicyDraft(env, {
  scope,
  scopeChain,
  period,
  actor = {}
} = {}) {
  const view = await loadAcademicPolicyView(env, { scope, scopeChain, period });
  if (!view.DraftRevision) {
    const error = new Error('Save an academic policy draft before activating it.');
    error.status = 409;
    throw error;
  }
  assertAcademicPolicyActivatable(view.Policy);
  const now = new Date().toISOString();
  await upsertDocument(env, ACADEMIC_POLICY_ASSIGNMENTS_COLLECTION, view.AssignmentId, {
    AssignmentId: view.AssignmentId,
    Scope: view.Scope,
    Period: view.Period,
    ActiveRevisionId: view.DraftRevisionId,
    DraftRevisionId: '',
    ActiveAt: now,
    ActiveBy: actorName(actor),
    UpdatedAt: now,
    UpdatedBy: actorName(actor)
  });
  return loadAcademicPolicyView(env, { scope, scopeChain, period });
}

export async function inheritAcademicPolicyAtScope(env, {
  scope,
  scopeChain,
  period,
  actor = {}
} = {}) {
  const view = await loadAcademicPolicyView(env, { scope, scopeChain, period });
  if (view.Scope.Type === 'organisation') {
    const error = new Error('The organisation academic policy cannot inherit from a higher scope.');
    error.status = 400;
    throw error;
  }
  const now = new Date().toISOString();
  await upsertDocument(env, ACADEMIC_POLICY_ASSIGNMENTS_COLLECTION, view.AssignmentId, {
    AssignmentId: view.AssignmentId,
    Scope: view.Scope,
    Period: view.Period,
    ActiveRevisionId: '',
    DraftRevisionId: '',
    ResetAt: now,
    ResetBy: actorName(actor),
    UpdatedAt: now,
    UpdatedBy: actorName(actor)
  });
  return loadAcademicPolicyView(env, { scope, scopeChain, period });
}
