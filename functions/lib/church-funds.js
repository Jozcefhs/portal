import { getDocument, listCollection, upsertDocument } from './firestore.js';
import {
  CHURCH_COLLECTIONS,
  churchCollectionPath,
  safeChurchDocumentId
} from './church-foundation.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { resolveMembershipBranch } from './church-membership.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const inputError = (message) => {
  const error = new Error(message);
  error.status = 400;
  return error;
};

const VIEW_ROLES = new Set(['Super Admin', 'Pastor', 'Church Administrator', 'Treasurer', 'Auditor']);
const MANAGE_ROLES = new Set(['Super Admin', 'Treasurer']);

export function fundCapabilities(user = {}) {
  const role = clean(user.role || user.Role);
  return {
    canView: VIEW_ROLES.has(role),
    canManageFunds: MANAGE_ROLES.has(role),
    canManageMappings: MANAGE_ROLES.has(role),
    canViewAudit: VIEW_ROLES.has(role)
  };
}

function yesNo(value, fallback = 'YES') {
  const normalized = lower(value);
  if (['no', 'false', '0', 'inactive', 'disabled'].includes(normalized)) return 'NO';
  if (['yes', 'true', '1', 'active', 'enabled'].includes(normalized)) return 'YES';
  return fallback;
}

function validDate(value, label) {
  const date = clean(value);
  if (!date) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw inputError(`${label} must use a valid YYYY-MM-DD date.`);
  }
  return date;
}

export function normalizeChurchFund(input = {}, branchId = 'main') {
  const fundId = clean(input.FundId || input.fundId);
  const name = clean(input.Name || input.name || input.FundName || input.fundName);
  const fundTypes = {
    unrestricted: 'Unrestricted',
    restricted: 'Restricted',
    designated: 'Designated'
  };
  const fundType = fundTypes[lower(input.FundType || input.fundType || 'Unrestricted')];
  const currency = clean(input.Currency || input.currency).toUpperCase() || 'NGN';
  if (!fundId) throw inputError('FundId is required.');
  if (!name) throw inputError('Fund name is required.');
  if (!fundType) {
    throw inputError('Fund type must be Unrestricted, Restricted, or Designated.');
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw inputError('Fund currency must use a three-letter currency code.');
  const startDate = validDate(input.StartDate || input.startDate, 'Fund start date');
  const endDate = validDate(input.EndDate || input.endDate, 'Fund end date');
  if (startDate && endDate && endDate < startDate) throw inputError('Fund end date cannot be before its start date.');
  return {
    FundId: fundId,
    BranchId: resolveMembershipBranch({}, branchId),
    Name: name,
    FundType: fundType,
    Purpose: clean(input.Purpose || input.purpose),
    Currency: currency,
    StartDate: startDate,
    EndDate: endDate,
    AllowOnline: yesNo(input.AllowOnline ?? input.allowOnline ?? 'NO', 'NO'),
    Active: yesNo(input.Active ?? input.active ?? 'YES'),
    Notes: clean(input.Notes || input.notes)
  };
}

export function normalizeFundMapping(input = {}, branchId = 'main') {
  const fundId = clean(input.FundId || input.fundId);
  const debitAccountCode = clean(input.DebitAccountCode || input.debitAccountCode);
  const incomeAccountCode = clean(input.IncomeAccountCode || input.incomeAccountCode || input.CreditAccountCode || input.creditAccountCode);
  if (!fundId) throw inputError('FundId is required for an accounting mapping.');
  if (!debitAccountCode || !incomeAccountCode) throw inputError('Debit and income account codes are required.');
  if (debitAccountCode === incomeAccountCode) throw inputError('Debit and income accounts must be different.');
  const effectiveFrom = validDate(input.EffectiveFrom || input.effectiveFrom, 'Mapping effective-from date');
  const effectiveTo = validDate(input.EffectiveTo || input.effectiveTo, 'Mapping effective-to date');
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw inputError('Mapping effective-to date cannot be before its effective-from date.');
  }
  return {
    MappingId: clean(input.MappingId || input.mappingId) ||
      `FUND-MAP-${safeChurchDocumentId(fundId)}-${effectiveFrom || 'CURRENT'}`,
    FundId: fundId,
    BranchId: resolveMembershipBranch({}, branchId),
    DebitAccountCode: debitAccountCode,
    IncomeAccountCode: incomeAccountCode,
    EffectiveFrom: effectiveFrom,
    EffectiveTo: effectiveTo,
    Active: yesNo(input.Active ?? input.active ?? 'YES'),
    Notes: clean(input.Notes || input.notes)
  };
}

function activeChartAccount(chart = [], code) {
  return (chart || []).find((row) =>
    clean(row.Code || row.__id) === clean(code) && yesNo(row.Active ?? 'YES') === 'YES'
  );
}

export function validateFundMappingAccounts(mapping, chart = []) {
  const debit = activeChartAccount(chart, mapping.DebitAccountCode);
  const income = activeChartAccount(chart, mapping.IncomeAccountCode);
  if (!debit) throw inputError(`Debit account ${mapping.DebitAccountCode} does not exist or is inactive.`);
  if (!income) throw inputError(`Income account ${mapping.IncomeAccountCode} does not exist or is inactive.`);
  if (lower(debit.Type) !== 'asset') throw inputError(`Debit account ${mapping.DebitAccountCode} must be an Asset account.`);
  if (lower(income.Type) !== 'revenue') throw inputError(`Income account ${mapping.IncomeAccountCode} must be a Revenue account.`);
  return {
    ...mapping,
    DebitAccountName: clean(debit.Name),
    IncomeAccountName: clean(income.Name)
  };
}

export function effectiveFundMapping(mappings = [], fundId, date = '') {
  const targetDate = clean(date) || new Date().toISOString().slice(0, 10);
  return (mappings || [])
    .filter((row) =>
      clean(row.FundId) === clean(fundId) &&
      yesNo(row.Active ?? 'YES') === 'YES' &&
      (!clean(row.EffectiveFrom) || clean(row.EffectiveFrom) <= targetDate) &&
      (!clean(row.EffectiveTo) || clean(row.EffectiveTo) >= targetDate)
    )
    .sort((a, b) => clean(b.EffectiveFrom).localeCompare(clean(a.EffectiveFrom)))[0] || null;
}

function requireCapability(user, capability) {
  const capabilities = fundCapabilities(user);
  if (!capabilities[capability]) {
    const error = new Error('This church role is not permitted to perform that fund action.');
    error.status = 403;
    throw error;
  }
  return capabilities;
}

async function requireFundsEdition(env) {
  const [organizationProfile, legacyProfile] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
  if (!['church', 'faith', 'organization'].includes(organization.Edition) || !organization.FeatureFlags.funds || !organization.FeatureFlags.accounting) {
    const error = new Error('Church funds and shared accounting are not enabled for this organisation.');
    error.status = 403;
    throw error;
  }
}

const actorName = (user = {}) => clean(user.displayName || user.DisplayName || user.username || user.Username || 'Unknown staff');

async function writeFundAudit(env, branchId, user, action, entityType, entityId, details = '') {
  const auditId = `FUND-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, churchCollectionPath(CHURCH_COLLECTIONS.fundAudit, branchId), auditId, {
    AuditId: auditId,
    Timestamp: nowIso(),
    Action: clean(action),
    EntityType: clean(entityType),
    EntityId: clean(entityId),
    BranchId: branchId,
    Actor: actorName(user),
    ActorUsername: clean(user.username || user.Username),
    ActorRole: clean(user.role || user.Role),
    Details: clean(details)
  });
}

export async function listChurchFunds(env, user, body = {}) {
  await requireFundsEdition(env);
  const capabilities = requireCapability(user, 'canView');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const [funds, mappings, chart, audit] = await Promise.all([
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.funds, branchId)).catch(() => []),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.fundMappings, branchId)).catch(() => []),
    listCollection(env, 'chartOfAccounts').catch(() => []),
    capabilities.canViewAudit
      ? listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.fundAudit, branchId)).catch(() => [])
      : Promise.resolve([])
  ]);
  const publicChart = chart.filter((row) => yesNo(row.Active ?? 'YES') === 'YES').map((row) => ({
    Code: clean(row.Code || row.__id),
    Name: clean(row.Name),
    Type: clean(row.Type),
    Group: clean(row.Group),
    NormalBalance: clean(row.NormalBalance)
  })).sort((a, b) => a.Code.localeCompare(b.Code));
  return {
    ok: true,
    branchId,
    capabilities,
    funds: funds.sort((a, b) => clean(a.Name).localeCompare(clean(b.Name))),
    mappings: mappings.sort((a, b) => clean(a.FundId).localeCompare(clean(b.FundId))),
    chart: publicChart,
    audit: audit.sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp))).slice(0, 100)
  };
}

export async function saveChurchFund(env, user, body = {}) {
  await requireFundsEdition(env);
  requireCapability(user, 'canManageFunds');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const fund = normalizeChurchFund(body.fund || body.Fund || body, branchId);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.funds, branchId);
  const id = safeChurchDocumentId(fund.FundId);
  const existing = await getDocument(env, path, id).catch(() => null);
  const payload = {
    ...(existing || {}), ...fund,
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, id, payload);
  await writeFundAudit(env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Fund', fund.FundId, `${fund.Name} | ${fund.FundType}`);
  return { ok: true, message: existing ? 'Fund updated.' : 'Fund created.', fund: payload };
}

export async function saveFundMapping(env, user, body = {}) {
  await requireFundsEdition(env);
  requireCapability(user, 'canManageMappings');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const mapping = normalizeFundMapping(body.mapping || body.Mapping || body, branchId);
  const fund = await getDocument(
    env,
    churchCollectionPath(CHURCH_COLLECTIONS.funds, branchId),
    safeChurchDocumentId(mapping.FundId)
  ).catch(() => null);
  if (!fund) throw inputError('The selected fund does not exist in this branch.');
  const chart = await listCollection(env, 'chartOfAccounts').catch(() => []);
  const validated = validateFundMappingAccounts(mapping, chart);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.fundMappings, branchId);
  const id = safeChurchDocumentId(validated.MappingId);
  const existing = await getDocument(env, path, id).catch(() => null);
  const payload = {
    ...(existing || {}), ...validated,
    FundName: clean(fund.Name),
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(), UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, id, payload);
  await writeFundAudit(
    env, branchId, user, existing ? 'UPDATE' : 'CREATE', 'Fund Mapping',
    validated.MappingId, `${validated.FundId}: ${validated.DebitAccountCode} / ${validated.IncomeAccountCode}`
  );
  return { ok: true, message: existing ? 'Fund accounting mapping updated.' : 'Fund accounting mapping created.', mapping: payload };
}

export async function handleChurchFundAction(env, user, body = {}) {
  const action = lower(body.Action || body.action || 'list');
  if (['list', 'getchurchfunds'].includes(action)) return listChurchFunds(env, user, body);
  if (['savefund', 'savechurchfund'].includes(action)) return saveChurchFund(env, user, body);
  if (['savemapping', 'savechurchfundmapping'].includes(action)) return saveFundMapping(env, user, body);
  throw inputError('Choose a valid church fund action.');
}
