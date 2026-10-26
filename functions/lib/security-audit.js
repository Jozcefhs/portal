import { queryCollection, upsertDocument } from './firestore.js';
import { readStaffSession } from './staff-auth.js';
import { auditWords, auditSentence, auditNarrative, auditActionContext } from './audit-language.js';

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
  ['/api/staff-mfa', 'Identity & access'],
  ['/api/staff-users', 'Staff & permissions'],
  ['/api/staff-records', 'Records centre'],
  ['/api/staff-library', 'School Library'],
  ['/api/staff-hr', 'Human Resources'],
  ['/api/staff-attendance', 'Staff attendance'],
  ['/api/staff-correspondence', 'Executive Office'],
  ['/api/finance-workflow', 'Bills & requisitions'],
  ['/api/income-analytics', 'Income analytics'],
  ['/api/accounting', 'Finance & accounting'],
  ['/api/staff-direct-transfers', 'Finance & accounting'],
  ['/api/staff-payment-corrections', 'Finance & accounting'],
  ['/api/staff-manual-payments', 'Finance & accounting'],
  ['/api/student-billing-reconciliation', 'Finance & accounting'],
  ['/api/student-billing-preview', 'Finance & accounting'],
  ['/api/staff-wallet', 'Student wallets'],
  ['/api/staff-procurement', 'Procurement'],
  ['/api/staff-vendor', 'Vendor sales & settlements'],
  ['/api/staff-academics', 'Academic management'],
  ['/api/academic-policy', 'Academic policies'],
  ['/api/staff-homework', 'Homework'],
  ['/api/staff-cbt', 'CBT'],
  ['/api/staff-student', 'Students'],
  ['/api/passport-photo', 'Students'],
  ['/api/staff-admission', 'Admissions'],
  ['/api/staff-conduct', 'Student conduct'],
  ['/api/staff-departments', 'Department inventories'],
  ['/api/staff-stores', 'School stores'],
  ['/api/staff-item-import', 'Inventory imports'],
  ['/api/staff-hotel', 'Hotel'],
  ['/api/staff-members', 'Members'],
  ['/api/staff-services', 'Services & attendance'],
  ['/api/staff-funds', 'Funds'],
  ['/api/staff-offerings', 'Offerings'],
  ['/api/staff-church-payments', 'Donations'],
  ['/api/staff-organization-departments', 'Departments'],
  ['/api/staff-payroll', 'Payroll'],
  ['/api/data-backup', 'Backup & restore'],
  ['/api/desktop-pairing', 'Device access'],
  ['/api/help-config', 'Help settings'],
  ['/api/plan-catalog', 'Plan management'],
  ['/api/tutorial-catalog', 'Tutorial links'],
  ['/api/parent-dashboard', 'Parent portal'],
  ['/api/staff-notifications', 'Notifications'],
  ['/api/notification-scheduler', 'Notifications'],
  ['/api/settings', 'Settings'],
  ['/api/admin', 'Dashboard'],
  ['/api/backend', 'Desktop operations']
]);

const SENSITIVE_ACTION_KEYS = new Set([
  'password', 'newpassword', 'currentpassword', 'confirmpassword', 'pin',
  'secret', 'token', 'authorization', 'credential', 'assertion', 'signature'
]);

function titleWords(value) {
  return auditWords(value).toUpperCase();
}

// Keep canonical comparison keys separate from human-readable action descriptions.
// This also formats historical rows at read time without rewriting their evidence.
function sentenceAction(value) {
  return auditSentence(value);
}

function isAcademicWorkspaceLoad(action, route) {
  // Only this verified read-only command is routine. Do not guess that an
  // unrelated module's "bootstrap" performs no writes.
  if (lower(route).replace(/\/+$/, '') !== '/api/staff-academics') return false;
  const key = lower(action).split('—')[0].replace(/[^a-z]/g, '');
  return ['bootstrap', 'loadacademicmanagementworkspace', 'loadedacademicmanagementworkspace',
    'failedtoloadacademicmanagementworkspace', 'accessdeniedacademicmanagementworkspace'].includes(key);
}

function academicWorkspaceLoadPresentation(row) {
  if (!isAcademicWorkspaceLoad(row.Action, row.Route)) return null;
  const status = Number(row.HttpStatus);
  const outcome = lower(row.Outcome);
  const denied = outcome === 'denied' || [401, 403].includes(status);
  const failed = outcome === 'failed' || status >= 400;
  const succeeded = outcome === 'success' && status >= 200 && status < 300 && ![202, 206].includes(status);
  const section = /(?:^|;)\s*School section:\s*(primary|secondary|all)\s*(?:;|$)/i.exec(clean(row.ActionContext))?.[1]?.toLowerCase();
  const suffix = section ? ` — ${section === 'all' ? 'All school sections' : `${sentenceAction(section)} section`}` : '';
  const workspace = `Academic Management workspace${suffix}`;
  const actor = clean(row.Actor || row.ActorUsername) || 'An unidentified user';
  const action = denied ? `Access denied: ${workspace}` : failed ? `Failed to load ${workspace}`
    : succeeded ? `Loaded ${workspace}` : `Load ${workspace}`;
  const summary = denied ? `${actor} was denied access to the ${workspace}.`
    : failed ? `${actor} attempted to load the ${workspace}, but the load request failed.`
      : succeeded ? `${actor} loaded the ${workspace}.`
        : `${actor} requested to load the ${workspace}. Completion was not confirmed.`;
  return { Action: action, Module: 'Academic management', ActivityClass: 'Routine workspace load',
    Summary: `${summary} This action reads existing information; it does not save attendance, scores or other academic records.` };
}

function isPassportPhotoRead(route, method) {
  return lower(route).replace(/\/+$/, '') === '/api/passport-photo' && clean(method).toUpperCase() === 'POST';
}

// Only reviewed, read-only commands belong here. A name beginning with "preview"
// is not enough: some document previews save files, and reset/export preparation
// needs its own audit evidence. Keep unknown actions and every failed attempt.
const ACADEMIC_PREVIEW_ACTIONS = Object.freeze([
  'previewAcademicTimetableGeneration', 'previewAcademicTimetableCopy', 'previewTimetableCopy',
  'previewAcademicScoreImport', 'previewScoreSheetImport', 'previewAcademicTermResultWithdrawal',
  'previewTermResultWithdrawal', 'previewAcademicCbtRoster', 'previewAcademicCbtRosterAdditions',
  'previewAcademicCbtLateEntry'
]);
const ROUTINE_PREVIEW_ACTIONS = Object.freeze({
  '/api/student-billing-reconciliation': ['previewAll', 'previewBatch', 'preview', 'previewReversalsAll',
    'previewReversal', 'obsoleteRoster', 'obsoleteBatch', 'previewObsoleteReversal'],
  '/api/student-billing-preview': ['Submit to student billing preview'],
  '/api/staff-students': ['previewProfileDefaults', 'previewIntakeCorrection',
    'Preview First Term intake classification across all classes by admission year'],
  '/api/staff-payment-corrections': ['Preview manual payment correction'],
  '/api/staff-academics': ACADEMIC_PREVIEW_ACTIONS,
  '/api/backend': [...ACADEMIC_PREVIEW_ACTIONS, 'Preview manual payment correction']
});
const routineActionKey = value => lower(value).split('—')[0].replace(/[^a-z0-9]/g, '');

function isRoutinePreview(action, route, method) {
  if (clean(method).toUpperCase() !== 'POST') return false;
  const commands = ROUTINE_PREVIEW_ACTIONS[lower(route).replace(/\/+$/, '')] || [];
  return commands.some(command => routineActionKey(command) === routineActionKey(action));
}

function routinePreviewPresentation(row) {
  if (!isRoutinePreview(row.OriginalAction || row.Action, row.Route, row.Method)) return null;
  const note = 'This read-only review does not save a change.';
  return { ActivityClass: 'Routine preview',
    Summary: clean(row.Summary).endsWith(note) ? clean(row.Summary) : `${clean(row.Summary)} ${note}`.trim() };
}

function passportPhotoPresentation(row) {
  if (!isPassportPhotoRead(row.Route, row.Method)) return null;
  const status = Number(row.HttpStatus), outcome = lower(row.Outcome);
  const denied = outcome === 'denied' || [401, 403].includes(status);
  const failed = outcome === 'failed' || status >= 400;
  const succeeded = outcome === 'success' && status === 200;
  const actor = clean(row.Actor || row.ActorUsername) || 'An unidentified account';
  const action = denied ? 'Access denied: existing passport photograph'
    : failed ? 'Failed to load existing passport photograph'
      : succeeded ? 'Loaded existing passport photograph for display' : 'Load existing passport photograph for display';
  const result = denied ? 'Access was denied.' : failed ? 'The photograph could not be loaded.'
    : succeeded ? 'The existing photograph was retrieved for display.' : 'Completion was not confirmed.';
  return { Action: action, Module: 'Students', ActivityClass: 'Routine photograph load',
    Summary: `The session associated with ${actor} requested an existing student/application passport photograph. ${result} This is a read-only display request, not a photograph upload or change.` };
}

const ROUTE_TARGETS = Object.freeze({
  'staff-direct-transfers': 'bank transfer', 'staff-payment-corrections': 'manual payment correction',
  'staff-procurement': 'procurement', 'staff-wallet': 'student wallet',
  'staff-users': 'staff account', 'staff-records': 'directory record',
  'finance-workflow': 'finance request', 'security-audit': 'security audit log',
  'help-config': 'help settings', 'academic-policy': 'academic policy',
  'staff-academics': 'academic record', 'staff-students': 'student record',
  'staff-library': 'library record', 'staff-hr': 'staff HR record',
  'staff-attendance': 'staff attendance', 'staff-attendance-face': 'staff attendance face enrolment',
  'staff-homework': 'homework', 'staff-conduct': 'student conduct record',
  'staff-departments': 'department inventory', 'staff-stores': 'store inventory',
  'staff-hotel': 'hotel record', 'staff-services': 'service attendance',
  'staff-members': 'member record', 'staff-offerings': 'offering',
  'staff-church-payments': 'donation', 'staff-funds': 'fund', 'staff-payroll': 'payroll',
  'data-backup': 'backup and restore', 'desktop-pairing': 'desktop access request',
  'plan-catalog': 'subscription plan', 'tutorial-catalog': 'tutorial link'
});

const COMPACT_ACTIONS = Object.freeze({
  importitems: 'Import inventory items', saveitem: 'Save inventory item',
  savepurchase: 'Save purchase', savedelivery: 'Save delivery',
  saverequest: 'Save request', confirmreceipt: 'Confirm stock received',
  login: 'Sign in', logout: 'Sign out'
});

const MODULE_ACTIONS = Object.freeze({
  'staff-students': {
    previewintakecorrection: 'Preview First Term intake classification across all classes by admission year',
    applyintakecorrection: 'Mark matching First Term students as New Intake across all classes'
  },
  'staff-procurement': { assignitems: 'Assign central stock items to departments' },
  'staff-library': {
    savetitle: 'Save library book title', addcopy: 'Add library book copy', restorecopy: 'Restore library book copy',
    repaircopystatus: 'Repair library book copy status', checkout: 'Issue library book to borrower',
    return: 'Record library book return', renew: 'Renew library loan', reserve: 'Reserve library book',
    cancelreservation: 'Cancel library reservation', savepolicy: 'Save library borrowing policy'
  },
  'staff-departments': {
    saveclinicrecord: 'Save clinic visit and items dispensed', recordmovement: 'Record department stock movement',
    prepareclinicreport: 'Prepare clinic report for review', sendclinicreport: 'Send clinic report to parent',
    prepareclinicreferral: 'Find student clinic visits for a hospital referral',
    previewclinicreferral: 'Prepare hospital referral PDF for review; no email sent',
    loadclinicreferral: 'Open saved hospital referral PDF',
    sendclinicreferral: 'Submit hospital referral PDF to the parent email provider',
    sendmarketlist: 'Send supply order to supplier'
  },
  'staff-users': { save: 'Save staff account', delete: 'Delete staff account', import: 'Import staff accounts' },
  'staff-hotel': { checkin: 'Check guest into hotel room', checkout: 'Check guest out of hotel room' }
});

const GENERIC_ACTION = /^(?:CREATE|UPDATE|EDIT|SAVE|DELETE|REMOVE|LIST|VIEW|GET|READ|PRINT|EXPORT|IMPORT|SEARCH|REVIEW|APPROVE|APPROVED|REJECT|REJECTED|POST|POSTED|SUBMIT|STATUS|USE|VERIFY|ENABLE|DISABLE|EDIT AND RESUBMIT|ACCOUNTS REVIEW|PLATFORM ACTION)$/;

export function explicitAuditAction(action, entityType = '', module = '', route = '') {
  const label = titleWords(action);
  const target = titleWords(entityType || module || route.replace(/^\/api\//, ''));
  if (!label || label === 'PLATFORM ACTION') {
    return sentenceAction(target ? `ACTION NOT RECORDED — ${target}` : 'ACTION NOT RECORDED IN SOURCE AUDIT');
  }
  return sentenceAction(GENERIC_ACTION.test(label) && target ? `${label} ${target}` : label).slice(0, 180);
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
  if (isPassportPhotoRead(path, verb)) return 'Load existing passport photograph for display';
  if (path === '/api/admin' && safeField(body, ['section'])) {
    return sentenceAction(`VIEW ${titleWords(safeField(body, ['section']))}`).slice(0, 120);
  }
  const declared = safeField(body, ['action', 'Action', 'mode', 'Mode', 'operation', 'Operation']);
  if (declared) {
    const key = lower(declared);
    if (path === '/api/staff-manual-payments') return key === 'lookup'
      ? 'Look up account and payable fee components' : 'Record manual payment';
    if (isAcademicWorkspaceLoad(declared, path)) return 'Load Academic Management workspace';
    if (path === '/api/staff-payment-corrections' || path === '/api/backend' && key === 'manualpaymentcorrection') {
      const command = path === '/api/backend' ? lower(body.Command) : key;
      const correction = { reduce: 'reduce receipt amount', reverse: 'reverse receipt credit', move: 'move credit to another student wallet' }[lower(body.Kind)];
      return command === 'search' ? 'Search a student’s payment history for receipt correction'
        : command === 'lookup' ? 'Load manual payment receipt and current wallet balance'
        : command === 'preview' ? `Preview manual payment correction${correction ? ` — ${correction}` : ''}`
          : `Post manual payment correction${correction ? ` — ${correction}` : ''}`;
    }
    const target = safeField(body, ['EntityType', 'entityType', 'RecordType', 'recordType', 'section', 'Section']);
    const routeName = path.replace(/^\/api\//, '');
    const routeTarget = ROUTE_TARGETS[routeName] || routeName;
    const named = explicitAuditAction(MODULE_ACTIONS[routeName]?.[key] || COMPACT_ACTIONS[key] || declared, target || routeTarget);
    const decision = safeField(body, ['decision', 'Decision', 'Status', 'status']);
    const qualifier = decision ? ` — requested ${sentenceAction(titleWords(decision)).toLowerCase()}` : '';
    return `${named}${qualifier}`.slice(0, 180);
  }
  if (path === '/api/staff-session') {
    if (verb === 'DELETE') return 'Sign out';
    if (verb === 'POST') return 'Sign in';
    return 'Check session';
  }
  const routeName = path.replace(/^\/api\//, '');
  const target = titleWords(ROUTE_TARGETS[routeName] || routeName || 'API');
  const operation = verb === 'GET' || verb === 'HEAD' ? 'VIEW' : verb === 'POST' ? 'SUBMIT TO' : verb === 'PATCH' || verb === 'PUT' ? 'UPDATE' : verb;
  return sentenceAction(`${operation} ${target}`).slice(0, 180);
}

async function boundedProcurementAuditBody(request) {
  const reader = request.clone().body?.getReader();
  if (!reader) return {};
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) {
        // Cancellation of a cloned stream waits for the route's reader; do
        // not wait here or the route and audit can deadlock on oversized CSV.
        void reader.cancel().catch(() => undefined);
        return {};
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return {}; } finally { reader.releaseLock(); }
}

async function requestAuditInput(request, pathname) {
  let body = {};
  const method = clean(request.method || 'GET').toUpperCase();
  const contentType = lower(request.headers.get('Content-Type'));
  const declaredSize = Number(request.headers.get('Content-Length') || 0);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)
      // Help publishing has no body routing identifiers. Its route owns the
      // bounded reader; do not create an unbounded audit clone of FAQ content.
      && clean(pathname).replace(/\/+$/, '') !== '/api/help-config'
      && contentType.includes('application/json')
      && (!declaredSize || declaredSize <= 64 * 1024)) {
    body = clean(pathname).replace(/\/+$/, '') === '/api/staff-procurement'
      ? await boundedProcurementAuditBody(request)
      : await request.clone().json().catch(() => ({}));
    if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
  }
  // Read only known routing/record identifiers from the URL; never log its raw query
  // (one-time login links, pairing codes and signatures may be present there).
  const query = new URL(request.url).searchParams;
  for (const key of ['action', 'mode', 'section', 'recordType', 'recordId', 'id', 'branchId']) {
    if (!body[key] && query.has(key)) body[key] = query.get(key);
  }
  return {
    body,
    action: securityAuditAction({ pathname, method, body }),
    actorHint: safeField(body, ['ActorUsername', 'actorUsername', 'RecordedBy', 'recordedBy', 'UpdatedBy', 'updatedBy', 'Username', 'username', 'Email', 'email']),
    subject: isPassportPhotoRead(pathname, method) ? safeField(body, ['applicationReference', 'ApplicationReference', 'accountRef', 'AccountRef'])
      : safeField(body, ['TargetUsername', 'targetUsername', 'Username', 'username', 'AdmissionNo', 'admissionNo', 'Reference', 'reference', 'NotificationId', 'notificationId']),
    entityType: isPassportPhotoRead(pathname, method) ? 'Student/application photograph'
      : safeField(body, ['EntityType', 'entityType', 'RecordType', 'recordType', 'section', 'Section']),
    entityId: safeField(body, ['EntityId', 'entityId', 'RecordId', 'recordId', 'ReferralId', 'ExpenseNo', 'expenseNo', 'BillNo', 'billNo', 'JournalNo', 'ImprestNo', 'AccountRef', 'AdmissionNo', 'StaffId', 'EmployeeId', 'LeaveId', 'ItemId', 'LoanId', 'BookId', 'VisitId', 'RequestId', 'PurchaseId', 'TransferId', 'BookingId', 'RoomId', 'MemberId', 'DepartmentId', 'ClassId', 'SubjectId', 'HomeworkId', 'Reference', 'reference', 'NotificationId', 'notificationId', 'id', 'Id']),
    requestedStatus: safeField(body, ['decision', 'Decision', 'Status', 'status']),
    actionContext: auditActionContext(body),
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

export function shouldPersistSecurityAudit(prepared = {}, actor = null, status = 200) {
  const method = clean(prepared.method).toUpperCase();
  const action = titleWords(prepared.action);
  const path = lower(prepared.pathname);
  if (method === 'OPTIONS' || method === 'HEAD') return false;
  // Recovery success is atomically audited by the reset transaction. Requests
  // deliberately have a generic result and must not imply an email was sent.
  if (path === '/api/staff-password-recovery') return false;
  // Successful workspace refreshes are reads, not academic changes. Historical
  // entries remain visible; failed, denied and unconfirmed loads stay auditable.
  if (isAcademicWorkspaceLoad(prepared.action, path)) return Number(status) !== 200;
  // Successful previews/photo loads must return before the extra actor lookup
  // and Firestore audit write. Failures and unconfirmed responses remain visible.
  if (isRoutinePreview(prepared.action, path, method) || isPassportPhotoRead(path, method)) return Number(status) !== 200;
  // Scheduler GETs perform work, unlike ordinary page reads. Preserve both
  // service runs and authorization failures; visibility is a separate concern.
  if (path === '/api/notification-scheduler') return true;
  // Completed password/passkey/MFA sign-ins already have an authoritative LOGIN
  // entry in staffSecurityAudit. Do not add a second, anonymous success entry.
  const completedLogin = (path === '/api/staff-session' && ['LOGIN', 'SIGN IN'].includes(action))
    || (path === '/api/staff-passkey' && action === 'AUTHENTICATION VERIFY')
    || (path === '/api/staff-mfa' && action === 'VERIFY LOGIN');
  if (completedLogin && status < 400) return false;
  // Idle-session renewal is a liveness check, not a new sign-in or business action.
  if (path === '/api/staff-session' && action === 'ACTIVITY') return Number(status) === 403;
  const explicitRead = /^(?:PRINT|EXPORT|DOWNLOAD)(?: |$)/.test(action);
  const routineRead = !explicitRead && (method === 'GET'
    || /^(?:LIST|GET|VIEW|READ|SEARCH|LOAD|FETCH|CHECK SESSION|SHELL|QUICK|PRESENCE QUICK|STATUS|ADMIN STATUS|STORAGE STATUS)(?: |$)/.test(action)
    || / OPTIONS$/.test(action));
  // Refreshes and expired-session polls belong in API diagnostics, not the
  // business/security action ledger. Permission violations remain auditable.
  if (routineRead) return Number(status) === 403;
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
    Action: explicitAuditAction(event.action, event.entityType, event.module, event.route),
    Module: clean(event.module || 'Platform operations').slice(0, 100),
    Outcome: clean(event.outcome || 'Success').slice(0, 30),
    HttpStatus: Math.max(0, Number(event.status || 0) || 0),
    Method: clean(event.method).slice(0, 12),
    Route: clean(event.route).slice(0, 180),
    RequestId: requestId,
    Actor: clean(event.actorDisplayName || event.actorUsername || 'Unidentified request').slice(0, 180),
    ActorUsername: clean(event.actorUsername).slice(0, 180),
    ActorRole: clean(event.actorRole || 'Unidentified').slice(0, 100),
    ActivityClass: clean(event.activityClass).slice(0, 80),
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
  payload.ActionContext = clean(event.actionContext).slice(0, 500);
  payload.Summary = auditNarrative({ ...payload, Summary: event.summary, SourceCollection: SECURITY_AUDIT_COLLECTION });
  Object.assign(payload, academicWorkspaceLoadPresentation(payload));
  Object.assign(payload, passportPhotoPresentation(payload));
  await upsertDocument(env, SECURITY_AUDIT_COLLECTION, id, payload);
  return payload;
}

export async function persistRequestSecurityAudit({ env, request, prepared, response, failure, requestId, durationMs, authoritativeActor, authoritativeAction, authoritativeActivityClass, authoritativeOutcome, authoritativeDetails, authoritativeSummary, auditHandled, auditNoChange } = {}) {
  const status = Number(response?.status || failure?.status || 500);
  if (auditHandled && status < 400 && !['failed', 'denied'].includes(lower(authoritativeOutcome))) return null;
  const effectivePrepared = { ...prepared, action: authoritativeAction || prepared.action };
  // Only the authenticated notification handlers can attest this no-op. Keep
  // failed/denied attempts and all other mutations in the security ledger.
  if (auditNoChange === true && status >= 200 && status < 300
    && ['/api/staff-notifications', '/api/parent-dashboard'].includes(lower(prepared.pathname))
    && ['ARCHIVE NOTIFICATION', 'RESTORE NOTIFICATION'].includes(titleWords(effectivePrepared.action))) return null;
  if (!shouldPersistSecurityAudit(effectivePrepared, null, status) && !['failed','denied'].includes(lower(authoritativeOutcome))) return null;
  const actor = authoritativeActor || await readStaffSession(env, request).catch(() => null);
  const outcome = status >= 400 ? securityAuditOutcome(status) : authoritativeOutcome || securityAuditOutcome(status);
  const headerBranch = clean(prepared.requestedBranchId);
  const branchId = clean(actor?.branchId || (headerBranch && lower(headerBranch) !== 'all' ? headerBranch : '') || prepared.branchId || 'main');
  return writeSecurityAudit(env, {
    timestamp: new Date().toISOString(),
    requestId,
    action: authoritativeAction || prepared.action,
    module: securityAuditModuleForRoute(prepared.pathname),
    outcome,
    activityClass: authoritativeActivityClass,
    summary: status < 400 ? authoritativeSummary : '',
    status,
    method: prepared.method,
    route: prepared.pathname,
    actorDisplayName: actor?.displayName,
    actorUsername: actor?.username,
    actorRole: actor?.assignedRole || actor?.role,
    subject: prepared.subject,
    entityType: prepared.entityType,
    entityId: prepared.entityId,
    actionContext: prepared.actionContext,
    branchId,
    sourcePlatform: actor?.sourcePlatform || prepared.sourcePlatform,
    clientAddress: prepared.clientAddress,
    country: prepared.country,
    colo: prepared.colo,
    durationMs,
    details: [authoritativeAction || prepared.action, authoritativeDetails, prepared.entityId ? `Record: ${prepared.entityId}` : '',
      !actor && prepared.actorHint ? `Unverified claimed account: ${prepared.actorHint}` : '',
      prepared.subject ? `Subject: ${prepared.subject}` : '',
      `${outcome} (HTTP ${status}); ${prepared.method} ${prepared.pathname}`
    ].filter(Boolean).join('; ')
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

export function normalizedLegacyAudit(row, source) {
  const actorUsername = clean(row.ActorUsername || row.UserUsername || row.UserName || row.User || row.Actor || row.Username);
  const actor = clean(row.Actor || row.UserName || row.User || actorUsername || 'Officer not recorded');
  const module = clean(row.Module || source.module || 'Platform operations');
  const status = Number(row.HttpStatus || 0) || 0;
  const normalized = {
    AuditId: clean(row.AuditId || row.__id),
    Timestamp: clean(row.Timestamp || row.CreatedAt || row.UpdatedAt),
    Action: explicitAuditAction(row.Action, row.EntityType || row.RecordType, module, row.Route),
    OriginalAction: clean(row.Action),
    Module: module,
    Outcome: clean(row.Outcome || (status ? securityAuditOutcome(status) : 'Success')),
    HttpStatus: status,
    Method: clean(row.Method),
    Route: clean(row.Route),
    RequestId: clean(row.RequestId),
    Actor: actor,
    ActorUsername: actorUsername,
    ActorRole: clean(row.ActorRole || row.UserRole || row.Role),
    ActivityClass: clean(row.ActivityClass),
    Subject: clean(row.Subject || row.Username || row.Reference || row.EntityId || row.RecordId),
    EntityType: clean(row.EntityType || row.RecordType),
    EntityId: clean(row.EntityId || row.RecordId || row.Reference || row.CorrespondenceId),
    BranchId: clean(row.BranchId || 'main'),
    SourcePlatform: clean(row.SourcePlatform || (source.collection === SECURITY_AUDIT_COLLECTION ? 'Web' : 'Legacy audit')),
    ClientAddress: clean(row.ClientAddress),
    Country: clean(row.Country),
    DurationMs: Math.max(0, Number(row.DurationMs || 0) || 0),
    Details: clean(row.Details || row.Query || row.DeliveryStatus),
    ActionContext: clean(row.ActionContext),
    SourceCollection: source.collection
  };
  normalized.Summary = clean(row.Summary);
  if (lower(normalized.Route) === '/api/staff-direct-transfers') {
    normalized.Module = 'Finance & accounting';
    if (titleWords(row.Action) === 'APPROVE STAFF DIRECT TRANSFERS') {
      normalized.Action = 'Process bank-transfer approval — stage not recorded';
      normalized.Details = [normalized.Details,
        'Historical approval step; this entry alone does not establish that money was credited.'].filter(Boolean).join('; ');
    }
  }
  // Display-only interpretation: do not rewrite immutable historical records or
  // claim an old request was secret-verified when that evidence was not recorded.
  if (source.collection === SECURITY_AUDIT_COLLECTION
    && lower(normalized.ActorUsername) === 'external' && lower(normalized.Actor) === 'external user') {
    const scheduler = lower(normalized.Route) === '/api/notification-scheduler';
    normalized.Actor = scheduler ? 'Notification Scheduler — historical identity not recorded' : 'Unidentified request';
    normalized.ActorUsername = '';
    normalized.ActorRole = 'Identity not recorded';
    if (scheduler) {
      normalized.Module = 'Notifications';
      normalized.Details = [normalized.Details, 'Historical scheduler request; service identity was not recorded.'].filter(Boolean).join('; ');
    }
  }
  normalized.Summary = auditNarrative(normalized);
  // Interpret old "Bootstrap" rows at read time, including the generic Summary
  // saved by earlier versions. The original database evidence is never rewritten.
  Object.assign(normalized, academicWorkspaceLoadPresentation(normalized));
  Object.assign(normalized, passportPhotoPresentation(normalized));
  if (source.collection === SECURITY_AUDIT_COLLECTION) Object.assign(normalized, routinePreviewPresentation(normalized));
  return normalized;
}

export function securityAuditRowVisible(row) {
  if (row.SourceCollection !== SECURITY_AUDIT_COLLECTION) return true;
  if (isAcademicWorkspaceLoad(row.OriginalAction || row.Action, row.Route) || row.ActivityClass === "Routine workspace load") return true;
  // Retain historical evidence for the routine-activity toggle. No database
  // cleanup is needed to remove successful preview batches from the main view.
  if (isRoutinePreview(row.OriginalAction || row.Action, row.Route, row.Method) || isPassportPhotoRead(row.Route, row.Method)) return true;
  return shouldPersistSecurityAudit({ method: row.Method, pathname: row.Route, action: row.Action }, null,
    row.HttpStatus || (lower(row.Outcome) === 'denied' ? 403 : lower(row.Outcome) === 'failed' ? 500 : 200));
}

export async function loadAggregatedSecurityAudit(env, options = {}) {
  const range = sourceDateRange(options.fromDate, options.toDate);
  const filters = [];
  if (range.from) filters.push({ field: 'Timestamp', op: '>=', value: range.from });
  if (range.to) filters.push({ field: 'Timestamp', op: '<=', value: range.to });
  const perSourceLimit = Math.min(500, Math.max(50, Number(options.perSourceLimit || 250) || 250));
  const paged = options.paged === true;
  const cursor = options.batchCursor;
  const invalidCursor = () => {
    const error = new Error('The security audit cursor is invalid or expired. Refresh the audit log.');
    error.status = 400;
    return error;
  };
  const readTime = paged ? clean(cursor?.readTime) || new Date().toISOString() : '';
  if (paged && (cursor && (typeof cursor !== 'object' || Array.isArray(cursor)
    || cursor.fromDate !== options.fromDate || cursor.toDate !== options.toDate || !cursor.readTime
    || !cursor.sources || typeof cursor.sources !== 'object' || Array.isArray(cursor.sources)
    || Object.keys(cursor.sources).length !== AUDIT_SOURCES.length)
    || !Number.isFinite(Date.parse(readTime)) || Date.parse(readTime) > Date.now()
    || Date.parse(readTime) < Date.now() - 55 * 60 * 1000)) throw invalidCursor();
  if (paged && cursor) {
    for (const source of AUDIT_SOURCES) {
      if (!Object.prototype.hasOwnProperty.call(cursor.sources, source.collection)) throw invalidCursor();
      const position = cursor.sources[source.collection];
      if (position === null) continue;
      const prefix = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${source.collection}/`;
      if (!position || typeof position !== 'object' || typeof position.name !== 'string'
        || !position.name.startsWith(prefix) || !position.name.slice(prefix.length)
        || position.name.slice(prefix.length).includes('/') || typeof position.timestamp !== 'string'
        || !Number.isFinite(Date.parse(position.timestamp))
        || range.from && position.timestamp < range.from || range.to && position.timestamp > range.to) throw invalidCursor();
    }
  }
  const groups = await Promise.all(AUDIT_SOURCES.map(async (source) => {
    const position = paged && cursor ? cursor.sources[source.collection] : undefined;
    if (paged && position === null) return { rows: [], next: null };
    try {
      const rows = await queryCollection(env, source.collection, {
        filters,
        orderBy: [{ field: 'Timestamp', direction: 'DESCENDING' }, ...(paged ? [{ field: '__name__', direction: 'DESCENDING' }] : [])],
        limit: perSourceLimit,
        ...(paged ? { readTime } : {}),
        ...(position ? { startAfterName: position.name, startAfterFieldValue: position.timestamp } : {})
      });
      const last = rows.at(-1);
      const next = paged && rows.length === perSourceLimit ? { name: last?.__name, timestamp: last?.Timestamp } : null;
      if (next && (!next.name || !next.timestamp || next.name === position?.name)) throw new Error('The audit source cursor did not advance.');
      return { rows: rows.map((row) => normalizedLegacyAudit(row, source)).filter(securityAuditRowVisible),
        next, scanned: rows.length,
        warning: !paged && rows.length === perSourceLimit ? `${source.module || source.collection} has more records to check. Reload the updated portal to load the complete period in batches.` : '' };
    } catch (error) {
      console.warn(JSON.stringify({ event: 'security_audit_source_unavailable', source: source.collection, message: clean(error?.message).slice(0, 200) }));
      return { rows: [], next: position || null, warning: `${source.module || source.collection} audit records could not be loaded. Refresh to retry; this result is incomplete.` };
    }
  }));
  return {
    rows: groups.flatMap((group) => group.rows).filter((row) => row.Timestamp).sort((a, b) => b.Timestamp.localeCompare(a.Timestamp)),
    warnings: groups.map((group) => group.warning).filter(Boolean),
    ...(paged ? {
      paged: true, readTime,
      done: groups.every((group) => group.next === null) && groups.every((group) => !group.warning),
      scanned: groups.reduce((total, group) => total + (group.scanned || 0), 0),
      nextCursor: groups.every((group) => group.next === null) ? null : {
        fromDate: options.fromDate, toDate: options.toDate, readTime,
        sources: Object.fromEntries(AUDIT_SOURCES.map((source, index) => [source.collection, groups[index].next]))
      }
    } : {})
  };
}
