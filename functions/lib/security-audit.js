import { queryCollection, upsertDocument } from './firestore.js';
import { readStaffSession } from './staff-auth.js';

export const SECURITY_AUDIT_COLLECTION = 'platformSecurityAudit';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

const AUDIT_SOURCES = Object.freeze([
  Object.freeze({ collection: SECURITY_AUDIT_COLLECTION, module: '' }),
  Object.freeze({ collection: 'staffSecurityAudit', module: 'Identity & access' }),
  Object.freeze({ collection: 'staffRecordsAudit', module: 'Records centre' }),
  Object.freeze({ collection: 'hrAudit', module: 'Human Resources' }),
  Object.freeze({ collection: 'accountingAudit', module: 'Finance & accounting' }),
  Object.freeze({ collection: 'payrollAudit', module: 'Payroll' }),
  Object.freeze({ collection: 'executiveCorrespondenceAudit', module: 'Executive Office' })
]);

const ROUTE_MODULES = Object.freeze([
  ['/api/security-audit', 'Security audit'],
  ['/api/staff-session', 'Identity & access'],
  ['/api/staff-passkey', 'Identity & access'],
  ['/api/staff-users', 'Staff & permissions'],
  ['/api/staff-records', 'Records centre'],
  ['/api/staff-hr', 'Human Resources'],
  ['/api/staff-attendance', 'Staff attendance'],
  ['/api/staff-correspondence', 'Executive Office'],
  ['/api/finance-workflow', 'Bills & requisitions'],
  ['/api/income-analytics', 'Income analytics'],
  ['/api/accounting', 'Finance & accounting'],
  ['/api/parent-dashboard', 'Parent portal'],
  ['/api/staff-notifications', 'Notifications'],
  ['/api/settings', 'Settings'],
  ['/api/admin', 'Dashboard'],
  ['/api/backend', 'Desktop operations']
]);

const SENSITIVE_ACTION_KEYS = new Set([
  'password', 'newpassword', 'currentpassword', 'confirmpassword', 'pin',
  'secret', 'token', 'authorization', 'credential', 'assertion', 'signature'
]);

function titleWords(value) {
  return clean(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_./:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function safeField(body, names) {
  for (const name of names) {
    if (SENSITIVE_ACTION_KEYS.has(lower(name))) continue;
    const value = body?.[name];
    if (['string', 'number'].includes(typeof value) && clean(value)) return clean(value).slice(0, 180);
  }
  return '';
}

function sourcePlatform(request) {
  const declared = clean(request.headers.get('X-Dynamax-Client'));
  if (declared) return declared.slice(0, 80);
  const agent = lower(request.headers.get('User-Agent'));
  if (/electron|python-requests|pywebview|desktop/.test(agent)) return 'Desktop';
  if (/android|iphone|ipad|mobile/.test(agent)) return 'Mobile web';
  return 'Web';
}

function maskedClientAddress(value) {
  const address = clean(value);
  if (!address) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    const parts = address.split('.');
    return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  const parts = address.split(':').filter(Boolean);
  return parts.length ? `${parts.slice(0, 3).join(':')}::` : '';
}

export function securityAuditModuleForRoute(pathname) {
  const path = lower(pathname);
  return ROUTE_MODULES.find(([prefix]) => path.startsWith(prefix))?.[1] || 'Platform operations';
}

export function securityAuditOutcome(status) {
  const value = Number(status || 0);
  if ([401, 403].includes(value)) return 'Denied';
  if (value >= 400 || value === 0) return 'Failed';
  return 'Success';
}

export function securityAuditAction({ pathname = '', method = 'GET', body = {} } = {}) {
  const path = lower(pathname);
  const verb = clean(method || 'GET').toUpperCase();
  if (path === '/api/admin' && safeField(body, ['section'])) {
    return `VIEW ${titleWords(safeField(body, ['section']))}`.slice(0, 120);
  }
  const declared = safeField(body, ['action', 'Action', 'mode', 'Mode', 'operation', 'Operation']);
  if (declared) return titleWords(declared).slice(0, 120);
  if (path === '/api/staff-session') {
    if (verb === 'DELETE') return 'SIGN OUT';
    if (verb === 'POST') return 'SIGN IN';
    return 'CHECK SESSION';
  }
  const target = titleWords(path.split('/').filter(Boolean).pop() || 'API');
  const operation = verb === 'GET' || verb === 'HEAD' ? 'VIEW' : verb === 'POST' ? 'USE' : verb;
  return `${operation} ${target}`.slice(0, 120);
}

async function requestAuditInput(request, pathname) {
  let body = {};
  const method = clean(request.method || 'GET').toUpperCase();
  const contentType = lower(request.headers.get('Content-Type'));
  const declaredSize = Number(request.headers.get('Content-Length') || 0);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)
      && contentType.includes('application/json')
      && (!declaredSize || declaredSize <= 64 * 1024)) {
    body = await request.clone().json().catch(() => ({}));
    if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  }
  return {
    body,
    action: securityAuditAction({ pathname, method, body }),
    actorHint: safeField(body, ['ActorUsername', 'actorUsername', 'RecordedBy', 'recordedBy', 'UpdatedBy', 'updatedBy', 'Username', 'username', 'Email', 'email']),
    subject: safeField(body, ['TargetUsername', 'targetUsername', 'Username', 'username', 'AdmissionNo', 'admissionNo', 'Reference', 'reference']),
    entityType: safeField(body, ['EntityType', 'entityType', 'RecordType', 'recordType', 'section', 'Section']),
    entityId: safeField(body, ['EntityId', 'entityId', 'RecordId', 'recordId', 'Reference', 'reference', 'id', 'Id']),
    branchId: safeField(body, ['BranchId', 'branchId'])
  };
}

export async function prepareSecurityAudit(request, pathname = '') {
  const { body: _discardedBody, ...input } = await requestAuditInput(request, pathname);
  return {
    ...input,
    pathname: clean(pathname),
    method: clean(request.method || 'GET').toUpperCase(),
    sourcePlatform: sourcePlatform(request),
    requestedBranchId: clean(request.headers.get('X-Dynamax-Branch')),
    clientAddress: maskedClientAddress(request.headers.get('CF-Connecting-IP')),
    country: clean(request.cf?.country || request.headers.get('CF-IPCountry')).slice(0, 8),
    colo: clean(request.cf?.colo).slice(0, 12)
  };
}

export function shouldPersistSecurityAudit(prepared = {}, actor = null) {
  if (actor) return true;
  if (['GET', 'HEAD', 'OPTIONS'].includes(clean(prepared.method).toUpperCase())) return false;
  // Public mutations and login attempts are security-relevant even before a staff session exists.
  return true;
}

export async function writeSecurityAudit(env, event = {}) {
  if (!clean(env?.FIREBASE_PROJECT_ID) || !clean(env?.FIREBASE_CLIENT_EMAIL) || !clean(env?.FIREBASE_PRIVATE_KEY)) return null;
  const timestamp = clean(event.timestamp) || new Date().toISOString();
  const requestId = clean(event.requestId || crypto.randomUUID()).slice(0, 96);
  const id = `AUD-${timestamp.replace(/\D/g, '').slice(0, 17)}-${requestId.replace(/[^a-z0-9-]/gi, '').slice(-36) || crypto.randomUUID().slice(0, 12)}`;
  const payload = {
    AuditId: id,
    Timestamp: timestamp,
    Action: clean(event.action || 'PLATFORM ACTION').slice(0, 120),
    Module: clean(event.module || 'Platform operations').slice(0, 100),
    Outcome: clean(event.outcome || 'Success').slice(0, 30),
    HttpStatus: Math.max(0, Number(event.status || 0) || 0),
    Method: clean(event.method).slice(0, 12),
    Route: clean(event.route).slice(0, 180),
    RequestId: requestId,
    Actor: clean(event.actorDisplayName || event.actorUsername || 'External user').slice(0, 180),
    ActorUsername: clean(event.actorUsername || 'external').slice(0, 180),
    ActorRole: clean(event.actorRole || 'External').slice(0, 100),
    Subject: clean(event.subject).slice(0, 180),
    EntityType: clean(event.entityType).slice(0, 100),
    EntityId: clean(event.entityId).slice(0, 180),
    BranchId: clean(event.branchId || 'main').slice(0, 120),
    SourcePlatform: clean(event.sourcePlatform || 'Web').slice(0, 80),
    ClientAddress: clean(event.clientAddress).slice(0, 80),
    Country: clean(event.country).slice(0, 8),
    Colo: clean(event.colo).slice(0, 12),
    DurationMs: Math.max(0, Number(event.durationMs || 0) || 0),
    Details: clean(event.details).slice(0, 500)
  };
  await upsertDocument(env, SECURITY_AUDIT_COLLECTION, id, payload);
  return payload;
}

export async function persistRequestSecurityAudit({ env, request, prepared, response, failure, requestId, durationMs } = {}) {
  const actor = await readStaffSession(env, request).catch(() => null);
  if (!shouldPersistSecurityAudit(prepared, actor)) return null;
  const status = Number(response?.status || failure?.status || 500);
  const headerBranch = clean(prepared.requestedBranchId);
  const branchId = clean(actor?.branchId || (headerBranch && lower(headerBranch) !== 'all' ? headerBranch : '') || prepared.branchId || 'main');
  return writeSecurityAudit(env, {
    timestamp: new Date().toISOString(),
    requestId,
    action: prepared.action,
    module: securityAuditModuleForRoute(prepared.pathname),
    outcome: securityAuditOutcome(status),
    status,
    method: prepared.method,
    route: prepared.pathname,
    actorDisplayName: actor?.displayName,
    actorUsername: actor?.username || prepared.actorHint,
    actorRole: actor?.role,
    subject: prepared.subject,
    entityType: prepared.entityType,
    entityId: prepared.entityId,
    branchId,
    sourcePlatform: prepared.sourcePlatform,
    clientAddress: prepared.clientAddress,
    country: prepared.country,
    colo: prepared.colo,
    durationMs,
    details: `${prepared.method} ${prepared.pathname}`
  });
}

function sourceDateRange(fromDate, toDate) {
  const from = /^\d{4}-\d{2}-\d{2}$/.test(clean(fromDate)) ? clean(fromDate) : '';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(clean(toDate)) ? clean(toDate) : '';
  return {
    from: from ? `${from}T00:00:00.000Z` : '',
    to: to ? `${to}T23:59:59.999Z` : ''
  };
}

function normalizedLegacyAudit(row, source) {
  const actorUsername = clean(row.ActorUsername || row.UserName || row.Username || row.Actor);
  const actor = clean(row.Actor || row.UserName || actorUsername || 'System');
  const module = clean(row.Module || source.module || 'Platform operations');
  const status = Number(row.HttpStatus || 0) || 0;
  return {
    AuditId: clean(row.AuditId || row.__id),
    Timestamp: clean(row.Timestamp || row.CreatedAt || row.UpdatedAt),
    Action: clean(row.Action || 'PLATFORM ACTION'),
    Module: module,
    Outcome: clean(row.Outcome || (status ? securityAuditOutcome(status) : 'Success')),
    HttpStatus: status,
    Method: clean(row.Method),
    Route: clean(row.Route),
    RequestId: clean(row.RequestId),
    Actor: actor,
    ActorUsername: actorUsername,
    ActorRole: clean(row.ActorRole || row.UserRole || row.Role),
    Subject: clean(row.Subject || row.Username || row.Reference || row.EntityId),
    EntityType: clean(row.EntityType || row.RecordType),
    EntityId: clean(row.EntityId || row.Reference || row.CorrespondenceId),
    BranchId: clean(row.BranchId || 'main'),
    SourcePlatform: clean(row.SourcePlatform || (source.collection === SECURITY_AUDIT_COLLECTION ? 'Web' : 'Legacy audit')),
    ClientAddress: clean(row.ClientAddress),
    Country: clean(row.Country),
    DurationMs: Math.max(0, Number(row.DurationMs || 0) || 0),
    Details: clean(row.Details || row.Query || row.DeliveryStatus),
    SourceCollection: source.collection
  };
}

export async function loadAggregatedSecurityAudit(env, options = {}) {
  const range = sourceDateRange(options.fromDate, options.toDate);
  const filters = [];
  if (range.from) filters.push({ field: 'Timestamp', op: '>=', value: range.from });
  if (range.to) filters.push({ field: 'Timestamp', op: '<=', value: range.to });
  const perSourceLimit = Math.min(500, Math.max(50, Number(options.perSourceLimit || 250) || 250));
  const groups = await Promise.all(AUDIT_SOURCES.map(async (source) => {
    try {
      const rows = await queryCollection(env, source.collection, {
        filters,
        orderBy: [{ field: 'Timestamp', direction: 'DESCENDING' }],
        limit: perSourceLimit
      });
      return { rows: rows.map((row) => normalizedLegacyAudit(row, source)), warning: '' };
    } catch (error) {
      console.warn(JSON.stringify({ event: 'security_audit_source_unavailable', source: source.collection, message: clean(error?.message).slice(0, 200) }));
      return { rows: [], warning: `${source.module || source.collection} audit records could not be loaded.` };
    }
  }));
  return {
    rows: groups.flatMap((group) => group.rows).filter((row) => row.Timestamp).sort((a, b) => b.Timestamp.localeCompare(a.Timestamp)),
    warnings: groups.map((group) => group.warning).filter(Boolean)
  };
}
