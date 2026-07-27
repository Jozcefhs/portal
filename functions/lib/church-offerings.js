import { deleteDocument, getDocument, listCollection, upsertDocument } from './firestore.js';
import {
  buildOfferingJournalDraft,
  CHURCH_COLLECTIONS,
  churchCollectionPath,
  safeChurchDocumentId
} from './church-foundation.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { resolveMembershipBranch } from './church-membership.js';
import { effectiveFundMapping } from './church-funds.js';
import { saveAccountingJournal } from '../api/backend.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();
const amount = (value) => {
  const parsed = Number(String(value ?? '0').replace(/,/g, '').trim() || '0');
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) / 100 : NaN;
};
const inputError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};
const actorName = (user = {}) =>
  clean(user.displayName || user.DisplayName || user.username || user.Username || 'Unknown staff');

const ROUTE_ROLE_SEPARATOR = /[;,]/;

function routeRoleList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value).split(ROUTE_ROLE_SEPARATOR).map(clean).map((item) => item.replace(/\s+/g, ' ')).filter(Boolean);
}

function roleInList(role, values = []) {
  const target = clean(role).toLowerCase();
  return routeRoleList(values).some((entry) => clean(entry).toLowerCase() === target);
}

const VIEW_ROLES = new Set(['Super Admin', 'Pastor', 'Church Administrator', 'Treasurer', 'Auditor']);
const CAPTURE_ROLES = new Set(['Super Admin', 'Church Administrator', 'Treasurer']);
const RECONCILE_ROLES = new Set(['Super Admin', 'Treasurer']);
const APPROVE_ROLES = new Set(['Super Admin', 'Church Administrator', 'Treasurer']);
const POST_ROLES = new Set(['Super Admin', 'Treasurer']);
const ROUTE_ROLES = new Set(['Super Admin', 'Church Administrator', 'Treasurer']);

export function offeringCapabilities(user = {}) {
  const role = clean(user.role || user.Role);
  return {
    canView: VIEW_ROLES.has(role),
    canCapture: CAPTURE_ROLES.has(role),
    canReconcile: RECONCILE_ROLES.has(role),
    canApprove: APPROVE_ROLES.has(role),
    canPost: POST_ROLES.has(role),
    canManageApprovalRoutes: ROUTE_ROLES.has(role),
    canViewAudit: VIEW_ROLES.has(role)
  };
}

function requireCapability(user, capability) {
  const capabilities = offeringCapabilities(user);
  if (!capabilities[capability]) {
    throw inputError('This church role is not permitted to perform that offering action.', 403);
  }
  return capabilities;
}

function validDate(value, label = 'Offering date') {
  const date = clean(value);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw inputError(`${label} must use a valid YYYY-MM-DD date.`);
  }
  return date;
}

function denominationSource(value) {
  if (Array.isArray(value)) return value;
  const text = clean(value);
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
    } catch (_error) {
      throw inputError('Denominations must be valid JSON or comma-separated value x quantity pairs.');
    }
  }
  return text.split(/[,;\n]+/).filter(clean).map((token) => {
    const parts = token.trim().split(/\s*[xX*:=]\s*/);
    if (parts.length !== 2) throw inputError(`Invalid denomination entry: ${token}. Use value x quantity.`);
    return { Denomination: parts[0], Quantity: parts[1] };
  });
}

export function normalizeDenominations(value) {
  const rows = denominationSource(value);
  const seen = new Set();
  return rows.map((row) => {
    const denomination = amount(row.Denomination ?? row.denomination ?? row.Value ?? row.value);
    const quantity = Number(row.Quantity ?? row.quantity ?? row.Count ?? row.count);
    if (!Number.isFinite(denomination) || denomination <= 0) throw inputError('Denomination values must be greater than zero.');
    if (!Number.isInteger(quantity) || quantity < 0) throw inputError('Denomination quantities must be whole numbers of zero or greater.');
    const key = denomination.toFixed(2);
    if (seen.has(key)) throw inputError(`Denomination ${denomination} is listed more than once.`);
    seen.add(key);
    return {
      Denomination: denomination,
      Quantity: quantity,
      Amount: amount(denomination * quantity)
    };
  }).filter((row) => row.Quantity > 0).sort((a, b) => b.Denomination - a.Denomination);
}

export function normalizeChurchOffering(input = {}, branchId = 'main') {
  const offeringId = clean(input.OfferingId || input.offeringId);
  const batchReference = clean(input.BatchReference || input.batchReference || input.BatchNo || input.batchNo);
  const fundId = clean(input.FundId || input.fundId);
  if (!offeringId) throw inputError('OfferingId is required.');
  if (!batchReference) throw inputError('Batch reference is required.');
  if (!fundId) throw inputError('FundId is required.');
  const date = validDate(input.Date || input.date);
  const currency = clean(input.Currency || input.currency).toUpperCase() || 'NGN';
  if (!/^[A-Z]{3}$/.test(currency)) throw inputError('Offering currency must use a three-letter currency code.');
  const denominations = normalizeDenominations(
    input.Denominations ?? input.denominations ?? input.DenominationBreakdown ?? input.denominationBreakdown
  );
  const components = {
    CashAmount: amount(input.CashAmount ?? input.cashAmount),
    TransferAmount: amount(input.TransferAmount ?? input.transferAmount),
    POSAmount: amount(input.POSAmount ?? input.posAmount),
    OnlineAmount: amount(input.OnlineAmount ?? input.onlineAmount),
    ChequeAmount: amount(input.ChequeAmount ?? input.chequeAmount),
    OtherAmount: amount(input.OtherAmount ?? input.otherAmount)
  };
  if (Object.values(components).some((value) => !Number.isFinite(value) || value < 0)) {
    throw inputError('Offering payment amounts must be valid numbers of zero or greater.');
  }
  const componentTotal = amount(Object.values(components).reduce((sum, value) => sum + value, 0));
  const suppliedTotal = amount(input.TotalAmount ?? input.totalAmount ?? componentTotal);
  if (!Number.isFinite(suppliedTotal) || suppliedTotal <= 0) throw inputError('Offering total must be greater than zero.');
  if (Math.abs(suppliedTotal - componentTotal) > 0.005) {
    throw inputError(`Offering components total ${componentTotal.toFixed(2)}, not ${suppliedTotal.toFixed(2)}.`);
  }
  const denominationTotal = amount(denominations.reduce((sum, row) => sum + row.Amount, 0));
  return {
    OfferingId: offeringId,
    BranchId: resolveMembershipBranch({}, branchId),
    BatchReference: batchReference,
    ExternalReference: clean(input.ExternalReference || input.externalReference),
    Date: date,
    ServiceOccurrenceId: clean(input.ServiceOccurrenceId || input.serviceOccurrenceId),
    ServiceId: clean(input.ServiceId || input.serviceId),
    FundId: fundId,
    Currency: currency,
    ...components,
    TotalAmount: componentTotal,
    Denominations: denominations,
    DenominationTotal: denominationTotal,
    ReconciliationDifference: amount(components.CashAmount - denominationTotal),
    CollectorNames: clean(input.CollectorNames || input.collectorNames),
    CountedBy: clean(input.CountedBy || input.countedBy),
    WitnessedBy: clean(input.WitnessedBy || input.witnessedBy),
    Notes: clean(input.Notes || input.notes),
    Status: 'Draft',
    ApprovalStatus: 'Pending',
    AccountingStatus: 'Unposted',
    JournalNo: ''
  };
}

export function offeringDuplicate(offerings = [], candidate, currentId = '') {
  const batchKey = lower(candidate.BatchReference);
  const externalKey = lower(candidate.ExternalReference);
  return (offerings || []).find((row) => {
    const rowId = clean(row.OfferingId || row.__id);
    if (lower(rowId) === lower(currentId)) return false;
    return lower(row.BatchReference) === batchKey ||
      (externalKey && lower(row.ExternalReference) === externalKey);
  }) || null;
}

export function validateOfferingForReconciliation(offering = {}) {
  if (amount(offering.CashAmount) > 0 && !(offering.Denominations || []).length) {
    throw inputError('Cash offerings require a denomination count before reconciliation.');
  }
  if (Math.abs(amount(offering.ReconciliationDifference)) > 0.005) {
    throw inputError(`Cash count differs by ${amount(offering.ReconciliationDifference).toFixed(2)}.`);
  }
  const countedBy = clean(offering.CountedBy);
  const witnessedBy = clean(offering.WitnessedBy);
  if (!countedBy || !witnessedBy) {
    throw inputError('Counted by and witnessed by are required before reconciliation.');
  }
  if (lower(countedBy) === lower(witnessedBy)) {
    throw inputError('The counter and witness must be different people.');
  }
  return true;
}

export function offeringSummary(offerings = []) {
  return (offerings || []).reduce((result, row) => {
    result.count += 1;
    result.total = amount(result.total + amount(row.TotalAmount));
    result.cash = amount(result.cash + amount(row.CashAmount));
    result.nonCash = amount(result.nonCash + amount(row.TotalAmount) - amount(row.CashAmount));
    if (lower(row.AccountingStatus) === 'posted') result.posted += 1;
    if (lower(row.ApprovalStatus) === 'approved') result.approved += 1;
    if (lower(row.ApprovalStatus) === 'pending') result.pendingApproval += 1;
    if (lower(row.Status) === 'reconciled') result.reconciled += 1;
    else result.draft += 1;
    return result;
  }, {
    count: 0, total: 0, cash: 0, nonCash: 0,
    draft: 0, reconciled: 0, pendingApproval: 0, approved: 0, posted: 0
  });
}

async function requireOfferingsEdition(env) {
  const [organizationProfile, legacyProfile] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
  if (!['church', 'faith', 'organization'].includes(organization.Edition) || !organization.FeatureFlags.offerings || !organization.FeatureFlags.funds) {
    throw inputError('Church offerings and funds are not enabled for this organisation.', 403);
  }
}

async function writeOfferingAudit(env, branchId, user, action, offering, details = '') {
  const auditId = `OFFERING-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, churchCollectionPath(CHURCH_COLLECTIONS.offeringAudit, branchId), auditId, {
    AuditId: auditId,
    Timestamp: nowIso(),
    Action: clean(action),
    OfferingId: clean(offering.OfferingId),
    BatchReference: clean(offering.BatchReference),
    BranchId: branchId,
    Actor: actorName(user),
    ActorUsername: clean(user.username || user.Username),
    ActorRole: clean(user.role || user.Role),
    Details: clean(details)
  });
}

async function writeOfferingApprovalHistory(env, branchId, user, action, offering, route, details = '') {
  const approvalId = `OFFAPP-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, churchCollectionPath(CHURCH_COLLECTIONS.approvals, branchId), approvalId, {
    ApprovalId: approvalId,
    Timestamp: nowIso(),
    Action: clean(action),
    OfferingId: clean(offering.OfferingId || offering.__id),
    BatchReference: clean(offering.BatchReference),
    RouteId: clean(route?.RouteId),
    BranchId: branchId,
    Actor: actorName(user),
    ActorUsername: clean(user.username || user.Username),
    ActorRole: clean(user.role || user.Role),
    AccountingStatus: clean(offering.AccountingStatus),
    ApprovalStatus: clean(offering.ApprovalStatus),
    Details: clean(details)
  });
}

async function writeOfferingApprovalRouteAudit(env, branchId, user, action, route, details = '') {
  const auditId = `OFFROUTE-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, churchCollectionPath(CHURCH_COLLECTIONS.offeringApprovalRoutesAudit, branchId), auditId, {
    AuditId: auditId,
    Timestamp: nowIso(),
    Action: clean(action),
    EntityType: 'Offering Approval Route',
    EntityId: clean(route?.RouteId),
    BranchId: branchId,
    Actor: actorName(user),
    ActorUsername: clean(user.username || user.Username),
    ActorRole: clean(user.role || user.Role),
    Details: clean(details)
  });
}

async function writeOfferingAccountingAudit(env, user, journal, details = '') {
  const auditId = `ACCOUNTING-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, 'accountingAudit', safeChurchDocumentId(auditId), {
    AuditId: auditId,
    Timestamp: nowIso(),
    Action: 'POST',
    EntityType: 'Offering Journal',
    EntityId: clean(journal.JournalNo),
    UserRole: clean(user.role || user.Role),
    UserName: actorName(user),
    Details: clean(details)
  });
}

async function offeringReferenceData(env, branchId) {
  const [funds, mappings, occurrences] = await Promise.all([
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.funds, branchId)).catch(() => []),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.fundMappings, branchId)).catch(() => []),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.serviceOccurrences, branchId)).catch(() => [])
  ]);
  return { funds, mappings, occurrences };
}

function parseRouteStatus(value, fallback = 'YES') {
  const text = lower(value);
  if (['no', 'false', '0', 'inactive', 'disabled'].includes(text)) return 'NO';
  if (['yes', 'true', '1', 'active', 'enabled'].includes(text)) return 'YES';
  return fallback;
}

function resolveRouteSortOrder(value, fallback = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function normalizeOfferingApprovalRoute(route = {}, branchId = 'main', index = 0) {
  const routeId = clean(route.RouteId || route.__id || route.routeId || `ROUTE-${index + 1}`);
  return {
    RouteId: routeId,
    BranchId: clean(route.BranchId || branchId || 'main').toLowerCase() || 'main',
    FundId: clean(route.FundId || route.fundId),
    Description: clean(route.Description || route.description || 'Default offering approval route'),
    ApprovalRoles: routeRoleList(route.ApprovalRoles || route.approvalRoles || 'Super Admin, Church Administrator, Treasurer'),
    PostingRoles: routeRoleList(route.PostingRoles || route.postingRoles || 'Super Admin, Treasurer'),
    SortOrder: resolveRouteSortOrder(route.SortOrder || route.sortOrder, 100 + index),
    Active: parseRouteStatus(route.Active, 'YES')
  };
}

export function normalizeOfferingApprovalRouteForSave(route = {}, branchId = 'main') {
  const normalized = normalizeOfferingApprovalRoute(route, branchId);
  const approvalRoles = routeRoleList(normalized.ApprovalRoles);
  const postingRoles = routeRoleList(normalized.PostingRoles);
  if (!approvalRoles.length) {
    throw inputError('A route must have at least one approval role.');
  }
  if (!postingRoles.length) {
    throw inputError('A route must have at least one posting role.');
  }
  const routeId = clean(route.RouteId || route.__id || route.routeId) || `ROUTE-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    ...normalized,
    RouteId: safeChurchDocumentId(routeId),
    ApprovalRoles: approvalRoles,
    PostingRoles: postingRoles
  };
}

export function resolveOfferingApprovalRoute(routes = [], offering = {}) {
  const normalized = (routes || [])
    .map((row, index) => normalizeOfferingApprovalRoute(row, offering.BranchId || 'main', index))
    .filter((row) => parseRouteStatus(row.Active, 'YES') === 'YES')
    .sort((a, b) => Number(a.SortOrder || 0) - Number(b.SortOrder || 0));
  const fundId = clean(offering.FundId).toLowerCase();
  return normalized.find((route) => clean(route.FundId).toLowerCase() === fundId && fundId)
    || normalized.find((route) => !route.FundId)
    || {
      RouteId: 'DEFAULT',
      BranchId: clean(offering.BranchId || 'main').toLowerCase() || 'main',
      FundId: '',
      Description: 'Default approval route',
      ApprovalRoles: ['Super Admin', 'Church Administrator', 'Treasurer'],
      PostingRoles: ['Super Admin', 'Treasurer'],
      SortOrder: 9999,
      Active: 'YES'
    };
}

export function isRoleAllowedForRoute(route, role, kind = 'approval') {
  const roles = clean(role).toLowerCase();
  if (!roles) return false;
  const allowed = kind === 'post' ? route.PostingRoles : route.ApprovalRoles;
  return (allowed || []).map(clean).map((value) => value.toLowerCase()).includes(roles);
}

async function resolveOfferingActionState(env, user, body = {}, offering) {
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const routeRows = await listCollection(
    env, churchCollectionPath(CHURCH_COLLECTIONS.offeringApprovalRoutes, branchId)
  ).catch(() => []);
  const route = resolveOfferingApprovalRoute(routeRows, offering || {});
  const role = clean(user.role || user.Role);
  return {
    branchId,
    route,
    canApprove: isRoleAllowedForRoute(route, role, 'approval'),
    canPost: isRoleAllowedForRoute(route, role, 'post')
  };
}

function publicOfferingRow(row = {}, routeState = {}, capabilities = {}) {
  return {
    ...row,
    ApprovalRoute: routeState.route?.RouteId || 'DEFAULT',
    ApprovalRouteDescription: clean(routeState.route?.Description),
    CanApprove: Boolean(capabilities.canApprove && routeState.canApprove),
    CanPost: Boolean(capabilities.canPost && routeState.canPost),
    CanReconcile: Boolean(capabilities.canReconcile)
  };
}

async function requireOfferingForAction(env, user, body = {}, options = {}) {
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const offeringId = clean(body.OfferingId || body.offeringId || body.OfferingID);
  if (!offeringId) throw inputError('OfferingId is required.');
  const path = churchCollectionPath(CHURCH_COLLECTIONS.offerings, branchId);
  const offering = await getDocument(env, path, safeChurchDocumentId(offeringId)).catch(() => null);
  if (!offering) throw inputError('Offering was not found.', 404);
  const state = await resolveOfferingActionState(env, user, body, offering);
  if (options.requireRouteFor && options.requireRouteFor === 'approve' && !state.canApprove) {
    const err = new Error('This role is not allowed to approve this offering route.');
    err.status = 403;
    throw err;
  }
  if (options.requireRouteFor && options.requireRouteFor === 'post' && !state.canPost) {
    const err = new Error('This role is not allowed to post this offering route.');
    err.status = 403;
    throw err;
  }
  return { offering, path, branchId, state };
}

async function findApprovalRouteById(env, user, body = {}) {
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const routeId = safeChurchDocumentId(clean(body.RouteId || body.routeId));
  if (!routeId) throw inputError('RouteId is required.', 400);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.offeringApprovalRoutes, branchId);
  const existing = await getDocument(env, path, routeId).catch(() => null);
  if (!existing) throw inputError('Offering approval route was not found.', 404);
  return { branchId, path, routeId, route: existing };
}

export async function saveOfferingApprovalRoute(env, user, body = {}) {
  await requireOfferingsEdition(env);
  requireCapability(user, 'canManageApprovalRoutes');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const routeInput = body.route || body.Route || body.offeringApprovalRoute || body;
  const normalizedRoute = normalizeOfferingApprovalRouteForSave(routeInput, branchId);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.offeringApprovalRoutes, branchId);
  const existing = await getDocument(env, path, normalizedRoute.RouteId).catch(() => null);
  const normalizedPayload = {
    ...(existing || {}),
    ...normalizedRoute,
    BranchId: normalizedRoute.BranchId || branchId,
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete normalizedPayload.__id;
  delete normalizedPayload.__name;
  await upsertDocument(env, path, normalizedRoute.RouteId, normalizedPayload);
  await writeOfferingApprovalRouteAudit(
    env,
    branchId,
    user,
    existing ? 'UPDATE ROUTE' : 'CREATE ROUTE',
    normalizedPayload,
    `${normalizedPayload.FundId || 'General'} | active ${normalizedPayload.Active} | sort ${normalizedPayload.SortOrder}`
  );
  return {
    ok: true,
    message: existing ? 'Offering approval route updated.' : 'Offering approval route saved.',
    route: normalizedPayload
  };
}

export async function deactivateOfferingApprovalRoute(env, user, body = {}) {
  await requireOfferingsEdition(env);
  requireCapability(user, 'canManageApprovalRoutes');
  const { branchId, path, routeId, route } = await findApprovalRouteById(env, user, body);
  const deactivated = {
    ...(route || {}),
    Active: 'NO',
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete deactivated.__id;
  delete deactivated.__name;
  await upsertDocument(env, path, routeId, deactivated);
  await writeOfferingApprovalRouteAudit(
    env,
    branchId,
    user,
    'DEACTIVATE ROUTE',
    deactivated,
    `Route ${routeId} deactivated`
  );
  return { ok: true, message: 'Offering approval route deactivated.', route: deactivated };
}

export async function deleteOfferingApprovalRoute(env, user, body = {}) {
  await requireOfferingsEdition(env);
  requireCapability(user, 'canManageApprovalRoutes');
  const { branchId, path, routeId, route } = await findApprovalRouteById(env, user, body);
  if (parseRouteStatus(route.Active, 'YES') === 'YES') {
    throw inputError('Active routes cannot be deleted. Deactivate the route before deleting.', 409);
  }
  await deleteDocument(env, path, routeId);
  await writeOfferingApprovalRouteAudit(
    env,
    branchId,
    user,
    'DELETE ROUTE',
    route,
    `Route ${routeId} removed`
  );
  return { ok: true, message: 'Offering approval route deleted.' };
}

export async function listChurchOfferings(env, user, body = {}) {
  await requireOfferingsEdition(env);
  const capabilities = requireCapability(user, 'canView');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const [offerings, references, audit, routes] = await Promise.all([
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.offerings, branchId)).catch(() => []),
    offeringReferenceData(env, branchId),
    capabilities.canViewAudit
      ? listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.offeringAudit, branchId)).catch(() => [])
    : Promise.resolve([]),
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.offeringApprovalRoutes, branchId)).catch(() => [])
  ]);
  const fundsById = new Map(references.funds.map((row) => [clean(row.FundId || row.__id), row]));
  const occurrencesById = new Map(references.occurrences.map((row) => [clean(row.OccurrenceId || row.__id), row]));
  const rows = offerings.map((row) => {
    const route = resolveOfferingApprovalRoute(routes, row);
    const role = clean(user.role || user.Role);
    return publicOfferingRow(row, {
      route,
      canApprove: isRoleAllowedForRoute(route, role, 'approval'),
      canPost: isRoleAllowedForRoute(route, role, 'post')
    }, capabilities);
  }).map((row) => ({
    ...row,
    FundName: clean(fundsById.get(clean(row.FundId))?.Name),
    ServiceName: clean(occurrencesById.get(clean(row.ServiceOccurrenceId))?.ServiceName),
    HasAccountingMapping: Boolean(effectiveFundMapping(references.mappings, row.FundId, row.Date))
  })).sort((a, b) => `${clean(b.Date)}|${clean(b.UpdatedAt)}`.localeCompare(`${clean(a.Date)}|${clean(a.UpdatedAt)}`));
  return {
    ok: true,
    branchId,
    capabilities,
    offerings: rows,
    approvalRoutes: routes.map((route, index) => normalizeOfferingApprovalRoute(route, branchId, index)),
    summary: offeringSummary(rows),
    funds: references.funds.filter((row) => lower(row.Active || 'YES') !== 'no'),
    occurrences: references.occurrences,
    audit: audit.sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp))).slice(0, 100)
  };
}

export async function saveChurchOffering(env, user, body = {}) {
  await requireOfferingsEdition(env);
  requireCapability(user, 'canCapture');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const offering = normalizeChurchOffering(body.offering || body.Offering || body, branchId);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.offerings, branchId);
  const id = safeChurchDocumentId(offering.OfferingId);
  const [existing, offerings, references] = await Promise.all([
    getDocument(env, path, id).catch(() => null),
    listCollection(env, path).catch(() => []),
    offeringReferenceData(env, branchId)
  ]);
  const caseVariantId = offerings.find((row) =>
    lower(row.OfferingId || row.__id) === lower(offering.OfferingId) &&
    clean(row.OfferingId || row.__id) !== offering.OfferingId
  );
  if (!existing && caseVariantId) {
    throw inputError(`Offering ID conflicts with existing offering ${clean(caseVariantId.OfferingId || caseVariantId.__id)}.`, 409);
  }
  if (existing && lower(existing.Status) !== 'draft') {
    throw inputError('A reconciled offering is locked and cannot be edited.', 409);
  }
  const duplicate = offeringDuplicate(
    offerings, offering, existing ? clean(existing.OfferingId || existing.__id) : ''
  );
  if (duplicate) {
    throw inputError(`This batch or external reference is already used by offering ${clean(duplicate.OfferingId || duplicate.__id)}.`, 409);
  }
  const fund = references.funds.find((row) => clean(row.FundId || row.__id) === offering.FundId);
  if (!fund || lower(fund.Active || 'YES') === 'no') throw inputError('The selected fund does not exist or is inactive.');
  if (clean(fund.StartDate) && offering.Date < clean(fund.StartDate)) throw inputError('The offering date is before the fund start date.');
  if (clean(fund.EndDate) && offering.Date > clean(fund.EndDate)) throw inputError('The offering date is after the fund end date.');
  if (offering.ServiceOccurrenceId) {
    const occurrence = references.occurrences.find((row) =>
      clean(row.OccurrenceId || row.__id) === offering.ServiceOccurrenceId
    );
    if (!occurrence) throw inputError('The selected service occurrence does not exist in this branch.');
    offering.ServiceId = clean(occurrence.ServiceId);
    offering.ServiceName = clean(occurrence.ServiceName);
  }
  const payload = {
    ...(existing || {}),
    ...offering,
    FundName: clean(fund.Name),
    CreatedAt: existing?.CreatedAt || nowIso(),
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, id, payload);
  await writeOfferingAudit(
    env, branchId, user, existing ? 'UPDATE DRAFT' : 'CREATE DRAFT', payload,
    `${payload.Currency} ${payload.TotalAmount.toFixed(2)} | difference ${payload.ReconciliationDifference.toFixed(2)}`
  );
  return { ok: true, message: existing ? 'Offering draft updated.' : 'Offering draft created.', offering: payload };
}

export async function reconcileChurchOffering(env, user, body = {}) {
  await requireOfferingsEdition(env);
  requireCapability(user, 'canReconcile');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const offeringId = clean(body.OfferingId || body.offeringId);
  if (!offeringId) throw inputError('OfferingId is required.');
  const path = churchCollectionPath(CHURCH_COLLECTIONS.offerings, branchId);
  const existing = await getDocument(env, path, safeChurchDocumentId(offeringId)).catch(() => null);
  if (!existing) throw inputError('Offering was not found.', 404);
  if (lower(existing.Status) === 'reconciled') {
    return { ok: true, duplicate: true, message: 'Offering was already reconciled.', offering: existing };
  }
  validateOfferingForReconciliation(existing);
  const mappings = await listCollection(
    env, churchCollectionPath(CHURCH_COLLECTIONS.fundMappings, branchId)
  ).catch(() => []);
  const mapping = effectiveFundMapping(mappings, existing.FundId, existing.Date);
  if (!mapping) throw inputError('No active accounting mapping covers this fund and offering date.');
  const journalDraft = buildOfferingJournalDraft(existing, mapping);
  const payload = {
    ...existing,
    Status: 'Reconciled',
    ReconciledAt: nowIso(),
    ReconciledBy: actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, safeChurchDocumentId(offeringId), payload);
  await writeOfferingAudit(
    env, branchId, user, 'RECONCILE', payload,
    `${payload.Currency} ${amount(payload.TotalAmount).toFixed(2)} | journal preview ${journalDraft.JournalNo}`
  );
  return {
    ok: true,
    message: 'Offering reconciled. It remains unposted pending the approval workflow.',
    offering: payload,
    journalDraft
  };
}

export async function approveChurchOffering(env, user, body = {}) {
  await requireOfferingsEdition(env);
  requireCapability(user, 'canApprove');
  const { offering, path, branchId, state } = await requireOfferingForAction(env, user, body, { requireRouteFor: 'approve' });
  if (lower(offering.Status) !== 'reconciled') {
    throw inputError('Only reconciled offerings can be approved.');
  }
  if (lower(offering.ApprovalStatus) === 'approved') {
    return { ok: true, duplicate: true, message: 'Offering was already approved.', offering };
  }
  if (lower(offering.AccountingStatus) === 'posted') {
    return {
      ok: true,
      duplicate: true,
      message: 'Offering was already posted and cannot be changed.',
      offering
    };
  }
  const payload = {
    ...offering,
    ApprovalStatus: 'Approved',
    ApprovalRoute: state.route.RouteId,
    ApprovedAt: nowIso(),
    ApprovedBy: actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, safeChurchDocumentId(offering.OfferingId), payload);
  await writeOfferingAudit(
    env, branchId, user, 'APPROVE', payload,
    `${payload.Currency} ${amount(payload.TotalAmount).toFixed(2)} approved via ${state.route.RouteId}`
  );
  await writeOfferingApprovalHistory(
    env, branchId, user, 'APPROVE', payload, state.route,
    `Offering approved via route ${state.route.RouteId}`
  );
  return {
    ok: true,
    message: 'Offering approved. It can now be posted when the assigned posting route allows it.',
    offering: payload
  };
}

export async function rejectChurchOffering(env, user, body = {}) {
  await requireOfferingsEdition(env);
  requireCapability(user, 'canApprove');
  const { offering, path, branchId, state } = await requireOfferingForAction(env, user, body, { requireRouteFor: 'approve' });
  if (lower(offering.Status) !== 'reconciled') {
    throw inputError('Only reconciled offerings can be rejected.');
  }
  if (lower(offering.AccountingStatus) === 'posted') {
    throw inputError('A posted offering cannot be rejected.');
  }
  if (lower(offering.ApprovalStatus) === 'rejected') {
    return { ok: true, duplicate: true, message: 'Offering was already rejected.', offering };
  }
  const reason = clean(body.Reason || body.reason);
  const payload = {
    ...offering,
    ApprovalStatus: 'Rejected',
    ApprovalRoute: state.route.RouteId,
    RejectionReason: reason || clean(offering.RejectionReason),
    RejectedAt: nowIso(),
    RejectedBy: actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, safeChurchDocumentId(offering.OfferingId), payload);
  await writeOfferingAudit(
    env, branchId, user, 'REJECT', payload,
    `${payload.Currency} ${amount(payload.TotalAmount).toFixed(2)} reason: ${reason || 'No reason provided'}`
  );
  await writeOfferingApprovalHistory(
    env, branchId, user, 'REJECT', payload, state.route,
    `Offering rejected via route ${state.route.RouteId}`
  );
  return { ok: true, message: 'Offering rejected.', offering: payload };
}

export async function postChurchOfferingToAccounting(env, user, body = {}) {
  await requireOfferingsEdition(env);
  requireCapability(user, 'canPost');
  const { offering, path, branchId, state } = await requireOfferingForAction(env, user, body, { requireRouteFor: 'post' });
  if (lower(offering.Status) !== 'reconciled') {
    throw inputError('Only reconciled offerings can be posted.');
  }
  if (lower(offering.ApprovalStatus) !== 'approved') {
    throw inputError('Only approved offerings can be posted.');
  }
  if (lower(offering.AccountingStatus) === 'posted') {
    return { ok: true, duplicate: true, message: 'Offering was already posted.', offering };
  }
  const mappings = await listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.fundMappings, branchId)).catch(() => []);
  const mapping = effectiveFundMapping(mappings, offering.FundId, offering.Date);
  if (!mapping) throw inputError('No active accounting mapping covers this fund and offering date.');
  const draft = buildOfferingJournalDraft(offering, mapping);
  const journal = await saveAccountingJournal(env, {
    ...draft,
    Status: 'Posted',
    RecordedBy: actorName(user),
    JournalNo: clean(offering.JournalNo || draft.JournalNo),
    Source: draft.Source || 'Church Offering',
    SourceId: clean(offering.OfferingId),
    Reference: clean(offering.BatchReference || offering.OfferingId)
  });
  const payload = {
    ...offering,
    AccountingStatus: 'Posted',
    JournalNo: clean(journal.JournalNo),
    PostedAt: nowIso(),
    PostedBy: actorName(user),
    UpdatedAt: nowIso(),
    UpdatedBy: actorName(user)
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, path, safeChurchDocumentId(offering.OfferingId), payload);
  await writeOfferingAudit(env, branchId, user, 'POST', payload,
    `${payload.Currency} ${amount(payload.TotalAmount).toFixed(2)} -> ${clean(journal.JournalNo)}`
  );
  await writeOfferingApprovalHistory(
    env, branchId, user, 'POST', payload, state.route,
    `Posted as ${clean(journal.JournalNo)} via route ${state.route.RouteId}`
  );
  await writeOfferingAccountingAudit(
    env, user, journal,
    `Offering ${offering.OfferingId} posted through route ${state.route.RouteId}`
  );
  return {
    ok: true,
    message: 'Offering posted to existing accounting contract.',
    offering: payload,
    journal
  };
}

export async function handleChurchOfferingAction(env, user, body = {}) {
  const action = lower(body.Action || body.action || 'list');
  if (['list', 'getchurchofferings'].includes(action)) return listChurchOfferings(env, user, body);
  if (['save', 'saveoffering', 'savechurchoffering'].includes(action)) return saveChurchOffering(env, user, body);
  if (['reconcile', 'reconcilechurchoffering'].includes(action)) return reconcileChurchOffering(env, user, body);
  if (['approve', 'approvechurchoffering'].includes(action)) return approveChurchOffering(env, user, body);
  if (['reject', 'rejectchurchoffering'].includes(action)) return rejectChurchOffering(env, user, body);
  if (['post', 'postchurchoffering', 'postchurchofferingaccounting'].includes(action)) {
    return postChurchOfferingToAccounting(env, user, body);
  }
  if (['saveofferingapprovalroute', 'saveofferingroute', 'savechurchofferingroute'].includes(action)) {
    return saveOfferingApprovalRoute(env, user, body);
  }
  if (['deactivateofferingapprovalroute', 'deactivateofferingroute', 'deactivateroute'].includes(action)) {
    return deactivateOfferingApprovalRoute(env, user, body);
  }
  if (['deleteofferingapprovalroute', 'deleteofferingroute', 'deleteroute'].includes(action)) {
    return deleteOfferingApprovalRoute(env, user, body);
  }
  throw inputError('Choose a valid church offering action.');
}
