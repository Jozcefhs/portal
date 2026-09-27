import { batchUpsertDocuments, listCollection } from './firestore.js';
import { getAccountingChartRows } from './accounting-reference-cache.js';
import { accountingChartForEdition } from './accounting-edition-scope.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { assertRequisitionTransition } from './requisition-workflow.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const safeId = value => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/-+/g, '-').slice(0, 140);
function fail(message, status = 400, code = 'REQUISITION_POSTING_INVALID') {
  throw Object.assign(new Error(message), { status, code });
}

export function buildRequisitionPosting(existing, user, options = {}, timestamp = new Date().toISOString()) {
  assertRequisitionTransition(existing, user.assignedRole || user.role, 'Posted');
  const expenseNo = clean(existing.ExpenseNo);
  if (!expenseNo || !clean(existing.__updateTime)) fail('Refresh this requisition before posting it.', 409);
  if (clean(existing.JournalNo)) fail('This requisition already has a journal. Refresh and review it; do not post it twice.', 409);
  const branch = clean(existing.BranchId || 'main');
  if (clean(user.branchId) && lower(user.branchId) !== lower(branch)) fail('This requisition is outside your branch.', 403);
  const section = lower(user.schoolSectionAccess || 'All');
  if (section !== 'all' && section !== lower(existing.SchoolSection || 'Secondary')) fail('This requisition is outside your section.', 403);
  const value = money(existing.Amount);
  if (!Number.isFinite(value) || value <= 0) fail('The approved requisition amount must be greater than zero.');
  const date = clean(options.postingDate || existing.Date);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail('Enter a valid posting date.');
  const reference = clean(options.reference || existing.Reference || expenseNo);
  const name = clean(user.displayName || user.username);
  const journalNo = `SYS-EXP-${safeId(expenseNo)}`;
  const expenseAccount = clean(existing.ExpenseAccount) || '6090';
  const paymentAccount = clean(existing.PaymentAccount) || '1020';
  if (expenseAccount === paymentAccount) fail('Expense and payment accounts must be different.');
  // Only settlement facts may be supplied here. Approved amounts, items, branch,
  // department and account codes are always taken from the stored requisition.
  const record = {
    ...existing, Status: 'Posted', JournalNo: journalNo, PostingDate: date,
    ExpenseAccount: expenseAccount, PaymentAccount: paymentAccount,
    PaymentReference: reference, PostingNotes: clean(options.notes),
    PostingAuthenticationMethod: clean(options.authorizationMethod),
    PostingWarningAcknowledged: clean(options.warningAcknowledged), PostingWarningDetails: clean(options.warningDetails),
    PostedAt: timestamp, PostedBy: name, PostedByUsername: clean(user.username),
    UpdatedAt: timestamp, UpdatedBy: name
  };
  for (const key of ['__id', '__name', '__createTime', '__updateTime']) delete record[key];
  const journal = {
    JournalNo: journalNo, Date: date, Status: 'Posted', Source: 'Expense', SourceId: expenseNo,
    Description: clean(existing.Description), Reference: reference, BranchId: branch,
    Department: clean(existing.Department), CostCentre: clean(existing.CostCentre),
    AcademicSession: clean(existing.AcademicSession), Term: clean(existing.Term),
    TotalDebit: value, TotalCredit: value, System: 'YES',
    CreatedAt: timestamp, CreatedBy: name, UpdatedAt: timestamp, UpdatedBy: name, PostedAt: timestamp, PostedBy: name,
    Lines: [
      { LineNo: 1, AccountCode: expenseAccount, Debit: value, Credit: 0, Description: clean(existing.Description), Department: clean(existing.Department), CostCentre: clean(existing.CostCentre) },
      { LineNo: 2, AccountCode: paymentAccount, Debit: 0, Credit: value, Description: clean(existing.Vendor || existing.PaymentMethod), Department: clean(existing.Department), CostCentre: clean(existing.CostCentre) }
    ]
  };
  const auditId = safeId(`POST-EXP-${expenseNo}`);
  return { record, journal, writes: [
    { collectionPath: 'accountingJournals', documentId: safeId(journalNo), data: journal, exists: false },
    { collectionPath: 'accountingExpenses', documentId: clean(existing.__id) || safeId(expenseNo), data: record, updateTime: existing.__updateTime },
    { collectionPath: 'accountingAudit', documentId: auditId, exists: false, data: {
      AuditId: auditId, Timestamp: timestamp, Action: 'POSTED REQUISITION', EntityType: 'Expense Requisition', EntityId: expenseNo,
      RecordType: 'Expense Requisition', RecordId: expenseNo, User: name, Department: clean(existing.Department),
      SchoolSection: clean(existing.SchoolSection || 'Secondary'),
      UserRole: clean(user.assignedRole || user.role), ActorUsername: clean(user.username), UserName: name,
      BranchId: branch, SourcePlatform: clean(user.sourcePlatform) || 'Web',
      Details: `Approved → Posted; journal ${journalNo}; amount ${value.toFixed(2)}; debit ${expenseAccount}; credit ${paymentAccount}; posting date ${date}; payment reference ${reference}${clean(options.notes) ? `; notes: ${clean(options.notes)}` : ''}`
    } }
  ] };
}

export function validateRequisitionPosting(journal, chart, periods, edition) {
  const date = journal.Date;
  if (periods.some(row => lower(row.Status || row.status) === 'closed'
    && date >= clean(row.StartDate || row.startDate) && date <= clean(row.EndDate || row.endDate))) {
    fail('This accounting period is closed. Choose an open posting date.', 409, 'ACCOUNTING_PERIOD_CLOSED');
  }
  const active = new Set(accountingChartForEdition(chart, edition)
    .filter(row => !['no', 'false', 'inactive', '0'].includes(lower(row.Active ?? 'YES')))
    .map(row => clean(row.Code || row.__id)));
  for (const line of journal.Lines) {
    if (!active.has(line.AccountCode)) fail(`Journal account ${line.AccountCode} does not exist, is inactive, or is unavailable in this edition.`);
  }
}

export async function postApprovedRequisition(env, existing, user, options = {}, endorsements = []) {
  const result = buildRequisitionPosting(existing, user, options);
  const [chart, periods] = await Promise.all([
    getAccountingChartRows(env, { fresh: true }), listCollection(env, 'accountingPeriods')
  ]);
  validateRequisitionPosting(result.journal, chart, periods, resolveOrganizationConfig({ env }).Edition);
  try {
    // The deterministic journal may only be created once; the requisition must
    // still have the version that was authorized. All writes succeed or none do.
    await batchUpsertDocuments(env, [...result.writes, ...endorsements]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      fail('This requisition changed or was already posted. Refresh the list before trying again.', 409, 'FINANCE_WRITE_CONFLICT');
    }
    throw error;
  }
  return { ok: true, message: `Requisition posted to journal ${result.journal.JournalNo}. No bank transfer was initiated.`, record: result.record };
}
