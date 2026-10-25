import { getDocument, batchCommitLiteralDocuments } from './firestore.js';
import { getAccountingChartRows, invalidateAccountingChartRows } from './accounting-reference-cache.js';
import { accountingChartForEdition, accountingCodeAllowedForEdition } from './accounting-edition-scope.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { assignedStaffBranches } from './staff-branch-access.js';

const clean = value => String(value ?? '').trim();
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export function canRenameRevenueAccounts(user = {}) {
  return ['Super Admin', 'Director', 'Accounts Officer', 'Treasurer'].includes(clean(user.assignedRole || user.role))
    && assignedStaffBranches(user) === null
    && ['funds', 'incomeAnalytics', 'accounting'].some(section => (user.allowedSections || []).includes(section))
    && user.subscriptionActive !== false && user.subscriptionReadOnly !== true;
}
const publicAccount = row => ({ documentId: row.__id, code: clean(row.Code), name: clean(row.Name),
  recordVersion: clean(row.__updateTime), active: !['no', 'false', '0'].includes(clean(row.Active).toLowerCase()) });

export async function handleRevenueAccountNames(env, user, body = {}) {
  if (!clean(user.username) || !canRenameRevenueAccounts(user)) {
    fail('Revenue account names can be edited by an organisation-wide Super Admin, Accounts Officer or Treasurer with finance access.', 403);
  }
  if (!['list', 'rename'].includes(body.action)) fail('Choose a valid revenue account action.');
  const allowed = body.action === 'list' ? ['action'] : ['action', 'documentId', 'code', 'name', 'recordVersion'];
  if (Object.keys(body).some(key => !allowed.includes(key))) fail('Only the revenue account name can be changed here.');
  const organizationProfile = await getDocument(env, 'settings', 'organisationProfile');
  const config = resolveOrganizationConfig({ env, organizationProfile });
  if (!config.FeatureFlags.accounting) fail('Accounting is not enabled for this organisation.', 403);
  if (body.action === 'list') {
    // Small reference list, requested only when the editor opens. Never load journals or payments.
    const rows = accountingChartForEdition(await getAccountingChartRows(env, { fresh: true }), config.Edition);
    return { ok: true, accounts: rows.filter(row => clean(row.Type).toLowerCase() === 'revenue' && clean(row.Code))
      .map(publicAccount).sort((a, b) => a.code.localeCompare(b.code)) };
  }
  const id = clean(body.documentId), code = clean(body.code), name = clean(body.name);
  if (!id || id.includes('/') || ['.', '..'].includes(id) || id.length > 1500) fail('Choose an existing revenue account.');
  if (typeof body.name !== 'string' || !name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
    fail('Enter an account name of 1 to 120 characters on one line.');
  }
  const current = await getDocument(env, 'chartOfAccounts', id);
  if (!current) fail('This account no longer exists. Reload the account list.', 404);
  if (!code || code !== clean(current.Code)) fail('The account code cannot be changed. Reload the account list.', 409);
  if (clean(current.Type).toLowerCase() !== 'revenue' || !accountingCodeAllowedForEdition(code, config.Edition)) {
    fail('Choose a revenue account available in this edition.', 403);
  }
  // A retried successful rename is a no-op, even if its response was lost.
  if (current.Name === name && current.NameCustomized === true) {
    return { ok: true, changed: false, account: publicAccount(current), message: 'This account already has that name. No records were changed.' };
  }
  if (!clean(current.__updateTime) || clean(body.recordVersion) !== current.__updateTime) {
    fail('This account changed while you were editing. Reload accounts and review its current name before saving.', 409);
  }
  const timestamp = new Date().toISOString();
  const fields = { Name: name, NameCustomized: true, UpdatedAt: timestamp, UpdatedBy: user.username };
  const auditId = `ACCOUNT-NAME-${crypto.randomUUID()}`;
  let result;
  try {
    result = await batchCommitLiteralDocuments(env, [
      { collectionPath: 'chartOfAccounts', documentId: id, updateTime: current.__updateTime,
        data: fields, updateMask: Object.keys(fields) },
      { collectionPath: 'accountingAudit', documentId: auditId, exists: false, data: {
        AuditId: auditId, Timestamp: timestamp, Action: 'Renamed revenue account', EntityType: 'Chart Account',
        EntityId: code, AccountCode: code, PreviousName: current.Name, NewName: name,
        User: user.displayName || user.username, ActorUsername: user.username, UserRole: user.assignedRole || user.role,
        SourcePlatform: 'Web', BranchId: user.branchId || 'main', Scope: 'Organisation-wide',
        OrganisationEdition: config.Edition, Details: `${code}: ${current.Name} → ${name}. Account code and transactions unchanged.`
      } }
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error.status))) fail('This account changed while you were saving. Reload accounts and review its current name.', 409);
    throw error;
  }
  invalidateAccountingChartRows();
  return { ok: true, changed: true, account: publicAccount({ ...current, ...fields, __updateTime: result.writeResults[0].updateTime }),
    message: 'Revenue account name saved across branches. Account code and existing transactions are unchanged.' };
}
