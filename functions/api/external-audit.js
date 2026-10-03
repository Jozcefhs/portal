import { getDocument, queryCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { recordBranchId } from '../lib/branch-scope.js';
import {
  EXTERNAL_AUDITOR_ROLE,
  externalAuditCursor,
  externalAuditDate,
  externalAuditFindingCursor,
  externalAuditJournal,
  externalAuditNextDate,
  externalAuditScope
} from '../lib/external-audit.js';
import { AUDIT_REGISTERS, AUDIT_DOCUMENT_CATEGORIES, listAuditRecords, auditRecordEvidence, loadAuditPeriodReports, exportAuditRegister, getAuditRecord } from '../lib/external-audit-evidence.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const PAGE_SIZE = 100;
const FINDING_ID = /^FIN-AUD-[0-9a-f-]{36}$/i;

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function internalScope(user, body) {
  const today = new Date().toISOString().slice(0, 10);
  const previous = new Date(`${today}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 30);
  const dateFrom = externalAuditDate(body.dateFrom || previous.toISOString().slice(0, 10));
  const dateTo = externalAuditDate(body.dateTo || today);
  if (!dateFrom || !dateTo || dateFrom > dateTo) {
    fail('Choose a valid audit date range.');
  }
  const branchId = clean(user.activeBranchId || user.branchId || 'all');
  if (clean(body.branchId) && lower(body.branchId) !== lower(branchId)) fail('Switch branch in the workspace before requesting its audit records.', 403);
  return {
    dateFrom, dateTo,
    branchId,
    auditDateFrom: '', auditDateTo: '', auditExpiresAt: ''
  };
}

export function authorizedScope(user, body) {
  if (!(user.allowedSections || []).includes('externalAudit')) fail('External Audit is not assigned to this account.', 403);
  if (user.role === EXTERNAL_AUDITOR_ROLE) return externalAuditScope(user, body);
  if (user.role === 'Super Admin') return internalScope(user, body);
  fail('This role cannot open the financial audit workspace.', 403);
}

export async function logAccess(env, user, action, branchId, details = '') {
  const timestamp = new Date().toISOString();
  const id = `FIN-AUD-ACCESS-${crypto.randomUUID()}`;
  await upsertDocument(env, 'staffSecurityAudit', id, {
    AuditId: id,
    Timestamp: timestamp,
    Action: action,
    Username: clean(user.username),
    Actor: clean(user.displayName || user.username),
    ActorUsername: clean(user.username),
    Role: clean(user.role),
    BranchId: branchId === 'all' ? '' : branchId,
    Details: clean(details).slice(0, 500),
    SourcePlatform: 'Web External Audit'
  });
}

function visibleInBranch(row, branchId) {
  return branchId === 'all' || recordBranchId(row) === lower(branchId);
}

function publicFinding(row) {
  return {
    FindingId: clean(row.FindingId || row.__id),
    Title: clean(row.Title),
    Description: clean(row.Description),
    JournalNo: clean(row.JournalNo),
    RecordType: clean(row.RecordType),
    RecordId: clean(row.RecordId),
    Category: clean(row.Category || 'Audit finding'),
    BranchId: clean(row.BranchId),
    AuditDateFrom: clean(row.AuditDateFrom),
    AuditDateTo: clean(row.AuditDateTo),
    AuditorUsername: clean(row.AuditorUsername),
    Status: clean(row.Status),
    ManagementResponse: clean(row.ManagementResponse),
    RespondedAt: clean(row.RespondedAt),
    RespondedBy: clean(row.RespondedBy),
    CreatedAt: clean(row.CreatedAt)
  };
}

async function listJournals(env, user, body, scope) {
  const cursor = externalAuditCursor(env, body.cursor);
  const rows = await queryCollection(env, 'accountingJournals', {
    filters: [
      { field: 'Date', op: '>=', value: scope.dateFrom },
      { field: 'Date', op: '<', value: externalAuditNextDate(scope.dateTo) }
    ],
    orderBy: [{ field: 'Date' }, { field: '__name__' }],
    ...(cursor ? { startAfterFieldValue: cursor.date, startAfterName: cursor.name } : {}),
    limit: PAGE_SIZE + 1
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  await logAccess(env, user, 'FINANCIAL AUDIT VIEW', scope.branchId, `${scope.dateFrom}–${scope.dateTo}; ${page.length} journal rows`);
  return {
    ok: true,
    scope,
    journals: page.filter((row) => visibleInBranch(row, scope.branchId)).map(externalAuditJournal),
    nextCursor: rows.length > PAGE_SIZE && last ? { date: clean(last.Date), name: clean(last.__name) } : null,
    pageSize: page.length,
    message: 'Financial journal page loaded. Figures shown are records on this page, not period totals.'
  };
}

async function listFindings(env, user, body, scope) {
  const external = user.role === EXTERNAL_AUDITOR_ROLE;
  const cursor = externalAuditFindingCursor(env, body.findingsCursor);
  const rows = await queryCollection(env, 'financialAuditFindings', {
    ...(external ? { filters: [{ field: 'AuditorUsernameKey', op: '==', value: lower(user.username) }] } : {}),
    orderBy: [{ field: '__name__' }],
    ...(cursor ? { startAfterName: cursor.name } : {}),
    limit: PAGE_SIZE + 1
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  await logAccess(env, user, 'FINANCIAL AUDIT FINDINGS VIEW', scope.branchId);
  return {
    ok: true,
    scope,
    findings: page.filter((row) => visibleInBranch(row, scope.branchId)
      && (!external || (clean(row.AuditDateFrom) >= scope.auditDateFrom && clean(row.AuditDateTo) <= scope.auditDateTo)))
      .map(publicFinding).sort((a, b) => b.CreatedAt.localeCompare(a.CreatedAt)),
    nextCursor: rows.length > PAGE_SIZE && last ? { name: clean(last.__name) } : null,
    pageSize: page.length
  };
}

async function createFinding(env, user, body, scope) {
  if (user.role !== EXTERNAL_AUDITOR_ROLE) fail('Only the assigned external auditor can raise a finding.', 403);
  const title = clean(body.title).slice(0, 160);
  const description = clean(body.description).slice(0, 3000);
  const journalNo = clean(body.journalNo).slice(0, 120);
  const recordType = clean(body.register);
  const recordId = clean(body.recordId);
  if (recordType || recordId) await getAuditRecord(env, scope, recordType, recordId);
  if (journalNo) {
    const matching = await queryCollection(env, 'accountingJournals', { filters: [{ field: 'JournalNo', op: '==', value: journalNo }], limit: 2 });
    if (!matching.some((row) => visibleInBranch(row, scope.branchId) && clean(row.Date).slice(0, 10) >= scope.dateFrom && clean(row.Date).slice(0, 10) <= scope.dateTo)) fail('The referenced journal is outside your audit scope.', 404);
  }
  if (!title || !description) fail('Enter a title and a description for the finding.');
  const id = `FIN-AUD-${crypto.randomUUID()}`;
  const finding = {
    FindingId: id,
    Title: title,
    Description: description,
    JournalNo: journalNo,
    RecordType: recordType,
    RecordId: recordId,
    Category: body.category === 'Evidence request' ? 'Evidence request' : 'Audit finding',
    BranchId: scope.branchId,
    AuditDateFrom: scope.dateFrom,
    AuditDateTo: scope.dateTo,
    AuditorUsername: clean(user.username),
    AuditorUsernameKey: lower(user.username),
    Status: 'Open',
    CreatedAt: new Date().toISOString()
  };
  await upsertDocument(env, 'financialAuditFindings', id, finding);
  await logAccess(env, user, 'FINANCIAL AUDIT FINDING CREATED', scope.branchId, id);
  return { ok: true, message: 'Finding submitted to management.', finding: publicFinding(finding) };
}

async function respondFinding(env, user, body, scope) {
  if (user.role !== 'Super Admin') fail('Only a Super Administrator can respond to audit findings.', 403);
  const id = clean(body.findingId);
  if (!FINDING_ID.test(id)) fail('Choose a valid audit finding.');
  const response = clean(body.response).slice(0, 3000);
  if (!response) fail('Enter a response for the finding.');
  const existing = await getDocument(env, 'financialAuditFindings', id);
  if (!existing || !visibleInBranch(existing, scope.branchId)) fail('The finding was not found in this branch.', 404);
  if (clean(existing.Status) === 'Answered') fail('This finding already has a management response.', 409);
  const updated = {
    ...existing,
    ManagementResponse: response,
    RespondedAt: new Date().toISOString(),
    RespondedBy: clean(user.username),
    Status: 'Answered'
  };
  delete updated.__id;
  delete updated.__name;
  await upsertDocument(env, 'financialAuditFindings', id, updated);
  await logAccess(env, user, 'FINANCIAL AUDIT FINDING ANSWERED', scope.branchId, id);
  return { ok: true, message: 'Management response saved.', finding: publicFinding(updated) };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 16 * 1024 });
    const scope = authorizedScope(user, body);
    const action = lower(body.action || 'list');
    const result = action === 'list' ? await listJournals(env, user, body, scope)
      : action === 'findings' ? await listFindings(env, user, body, scope)
      : action === 'createfinding' ? await createFinding(env, user, body, scope)
      : action === 'respondfinding' ? await respondFinding(env, user, body, scope)
      : action === 'catalog' ? { ok: true, scope, registers: Object.entries(AUDIT_REGISTERS).map(([key, entry]) => ({ key, label: entry.label, snapshot: !!entry.snapshot, branchRequired: !!entry.church })), documentCategories: AUDIT_DOCUMENT_CATEGORIES }
      : action === 'records' ? await listAuditRecords(env, scope, body)
      : action === 'detail' ? await auditRecordEvidence(env, scope, clean(body.register), clean(body.recordId))
      : action === 'reports' ? await loadAuditPeriodReports(env, scope, body)
      : action === 'exportregister' ? await exportAuditRegister(env, scope, clean(body.register || 'journals'), body)
      : action === 'recordexport' ? (await logAccess(env, user, 'FINANCIAL AUDIT EXPORT', scope.branchId, `${scope.dateFrom}–${scope.dateTo}; ${clean(body.report || 'current page').slice(0, 80)}`), { ok: true })
      : fail('Unknown external audit action.');
    if (['detail', 'reports', 'exportregister'].includes(action)
      && (action === 'detail' || body.paged !== true || !body.batchCursor)) await logAccess(env, user,
      action === 'exportregister' ? 'FINANCIAL AUDIT FULL REGISTER EXPORT' : action === 'reports' ? 'FINANCIAL AUDIT PERIOD REPORT' : 'FINANCIAL AUDIT EVIDENCE VIEW',
      scope.branchId, `${scope.dateFrom}–${scope.dateTo}; ${clean(body.register)} ${clean(body.recordId)}`);
    // Sensitive reads/exports and findings have their explicit authoritative
    // audit entry; catalog and record pagination are routine reads.
    if (context.data) context.data.securityAuditHandled = true;
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = Number(error?.status || 500);
    if (error?.code === 'FIRESTORE_QUERY_REPORT_LIMIT') error.message = 'Reload the portal to use the updated, batched audit preview and reports. No partial totals were shown.';
    if (status >= 500) console.error(JSON.stringify({ message: 'Financial audit request failed', error: String(error?.message || error) }));
    return Response.json({ ok: false, message: status >= 500 ? 'The financial audit request could not be completed.' : String(error?.message || error) }, {
      status, headers: { 'Cache-Control': 'no-store' }
    });
  }
}
