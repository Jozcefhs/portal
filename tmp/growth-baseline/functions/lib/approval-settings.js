import { getDocument, batchCommitDocuments } from './firestore.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { APPROVAL_STAGES, validateApprovalStages, approvalFlowLabel } from './requisition-workflow.js';

const clean = value => String(value ?? '').trim();
const defaults = () => ({ staff: APPROVAL_STAGES.map(s => s.id), vendor: APPROVAL_STAGES.map(s => s.id) });
const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
export function canManageApprovalSettings(user = {}) {
  return clean(user.assignedRole || user.AssignedRole || user.role || user.Role) === 'Super Admin';
}
async function load(env) {
  const organizationProfile = await getDocument(env, 'settings', 'organisationProfile');
  const config = resolveOrganizationConfig({ env, organizationProfile });
  const id = `requisition-approvals-${config.Edition}`;
  const record = await getDocument(env, 'settings', id);
  const policies = record ? { staff: validateApprovalStages(record.Policies?.staff), vendor: validateApprovalStages(record.Policies?.vendor) } : defaults();
  return { id, record, policies, edition: config.Edition };
}
export async function approvalSnapshot(env, kind) {
  if (!['staff', 'vendor'].includes(kind)) fail('Unknown request type.', 400);
  const { policies, record, edition } = await load(env);
  return { Version: 1, Stages: policies[kind], Kind: kind, Edition: edition,
    SettingsRevision: record?.Revision || 0, CapturedAt: new Date().toISOString() };
}
export async function handleApprovalSettings(env, user, body = {}) {
  if (!clean(user.username) || !canManageApprovalSettings(user)) fail('Only Super Admin can configure requisition approvals.', 403);
  const action = body.Command || body.action || 'get';
  if (!['get', 'save'].includes(action)) fail('Unknown approval settings action.', 400);
  if (action === 'save' && (user.subscriptionActive === false || user.subscriptionReadOnly === true)) fail('This workspace is read-only.', 403);
  const { id, record, policies, edition } = await load(env);
  if (action === 'get') return { ok: true, policies, edition, recordVersion: record?.__updateTime || '', stages: APPROVAL_STAGES };
  const selected = { staff: validateApprovalStages(body.policies?.staff), vendor: validateApprovalStages(body.policies?.vendor) };
  if (clean(body.recordVersion) !== clean(record?.__updateTime)) fail('Approval settings changed. Reload them before saving.', 409);
  const timestamp = new Date().toISOString(), auditId = `APPROVAL-POLICY-${crypto.randomUUID()}`;
  const label = p => approvalFlowLabel({ ApprovalFlow: { Stages: p } });
  const details = `Staff requisitions: ${label(policies.staff)} → changed to ${label(selected.staff)}. Vendor payment requests: ${label(policies.vendor)} → changed to ${label(selected.vendor)}. Applies to new requests only; existing requests retain their saved paths.`;
  await batchCommitDocuments(env, [
    { collectionPath: 'settings', documentId: id, data: { Policies: selected, Revision: (record?.Revision || 0) + 1,
      Edition: edition, UpdatedAt: timestamp, UpdatedBy: user.username }, ...(record ? { updateTime: record.__updateTime } : { exists: false }) },
    { collectionPath: 'accountingAudit', documentId: auditId, exists: false, data: {
      AuditId: auditId, Timestamp: timestamp, Action: 'Configured requisition approval stages', EntityType: 'Approval settings',
      EntityId: id, User: user.displayName || user.username, ActorUsername: user.username, UserRole: 'Super Admin',
      SourcePlatform: user.sourcePlatform || 'Web', BranchId: user.branchId || 'main', OrganisationEdition: edition, Details: details } }
  ]);
  return { ok: true, message: 'Approval settings saved for new requests across all branches. Existing requests are unchanged.' };
}
