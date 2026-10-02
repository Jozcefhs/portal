const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export const EXTERNAL_AUDITOR_ROLE = 'External Auditor';

export function externalAuditDate(value) {
  const date = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return '';
  return new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date ? date : '';
}

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function accessError(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

export function normalizeExternalAuditGrant(value = {}, today = new Date().toISOString().slice(0, 10)) {
  const from = externalAuditDate(value.AuditDateFrom || value.auditDateFrom);
  const to = externalAuditDate(value.AuditDateTo || value.auditDateTo);
  const expires = externalAuditDate(value.AuditExpiresAt || value.auditExpiresAt);
  if (!from || !to || !expires) throw inputError('Set valid audit start, end and access-expiry dates.');
  if (from > to) throw inputError('The audit start date cannot be after its end date.');
  if (expires < today) throw inputError('The auditor access expiry cannot be in the past.');
  return { AuditDateFrom: from, AuditDateTo: to, AuditExpiresAt: expires };
}

export function externalAuditAccessExpired(user = {}, today = new Date().toISOString().slice(0, 10)) {
  if (clean(user.role || user.Role) !== EXTERNAL_AUDITOR_ROLE) return false;
  const expires = externalAuditDate(user.auditExpiresAt || user.AuditExpiresAt);
  return !expires || expires < today;
}

export function externalAuditScope(user = {}, input = {}, today = new Date().toISOString().slice(0, 10)) {
  if (clean(user.role || user.Role) !== EXTERNAL_AUDITOR_ROLE) throw accessError('This account is not an external auditor.');
  if (externalAuditAccessExpired(user, today)) throw accessError('This external audit access has expired.');
  const grantFrom = externalAuditDate(user.auditDateFrom || user.AuditDateFrom);
  const grantTo = externalAuditDate(user.auditDateTo || user.AuditDateTo);
  if (!grantFrom || !grantTo || grantFrom > grantTo) throw accessError('This auditor has no valid audit period assigned.');
  const dateFrom = externalAuditDate(input.dateFrom || grantFrom);
  const dateTo = externalAuditDate(input.dateTo || grantTo);
  if (!dateFrom || !dateTo || dateFrom > dateTo) throw inputError('Choose a valid audit date range.');
  if (dateFrom < grantFrom || dateTo > grantTo) throw accessError('The requested period is outside this auditor’s assigned audit dates.');
  const currentBranch = clean(user.activeBranchId || user.branchId || user.BranchId || 'all');
  if (clean(input.branchId) && lower(input.branchId) !== lower(currentBranch)) throw accessError('Switch branch in the workspace before requesting its audit records.');
  return {
    dateFrom, dateTo,
    branchId: lower(currentBranch) === 'all' ? 'all' : currentBranch,
    auditDateFrom: grantFrom, auditDateTo: grantTo,
    auditExpiresAt: externalAuditDate(user.auditExpiresAt || user.AuditExpiresAt)
  };
}

export function externalAuditJournal(row = {}) {
  return {
    JournalNo: clean(row.JournalNo || row.__id),
    Date: clean(row.Date),
    Status: clean(row.Status),
    Description: clean(row.Description || row.Narration),
    SourceType: clean(row.SourceType || row.Source),
    SourceId: clean(row.SourceId),
    BranchId: clean(row.BranchId || 'main'),
    TotalDebit: Number(row.TotalDebit || 0) || 0,
    TotalCredit: Number(row.TotalCredit || 0) || 0,
    Lines: (Array.isArray(row.Lines) ? row.Lines : []).map((line) => ({
      AccountCode: clean(line.AccountCode),
      Debit: Number(line.Debit || 0) || 0,
      Credit: Number(line.Credit || 0) || 0,
      Description: clean(line.Description),
      Department: clean(line.Department)
    }))
  };
}

export function externalAuditNextDate(date) {
  const value = externalAuditDate(date);
  if (!value) throw inputError('Choose a valid audit end date.');
  const next = new Date(`${value}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function collectionCursor(env, cursor, collection) {
  if (!cursor) return null;
  const date = clean(cursor.date);
  const name = clean(cursor.name);
  const prefix = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/`;
  if ((collection === 'accountingJournals' && !/^\d{4}-\d{2}-\d{2}/.test(date))
    || !name.startsWith(prefix) || name.length <= prefix.length || name.slice(prefix.length).includes('/')) {
    throw inputError('The audit page cursor is invalid. Refresh the register.');
  }
  return { date, name };
}

export function externalAuditCursor(env, cursor) {
  return collectionCursor(env, cursor, 'accountingJournals');
}

export function externalAuditFindingCursor(env, cursor) {
  return collectionCursor(env, cursor, 'financialAuditFindings');
}
