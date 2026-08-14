import { batchUpsertDocuments, deleteDocument, getDocument, listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import {
  clearStaffApprovalProofCookie,
  readStaffApprovalProof,
  requireStaffSession,
  verifyStaffApprovalPassword
} from '../lib/staff-auth.js';
import { loadStaffApprovalProfile, publicStaffApprovalProfile } from '../lib/staff-approval-profile.js';
import { notifyStaffRequisitionEvent, notifyStaffRequisitionSubmitted } from '../lib/notifications.js';
import {
  IMPREST_ADVANCE_ACCOUNT,
  buildImprestIssueJournal,
  buildImprestRetirementJournal,
  imprestReportSummary,
  isOpenImprestStatus,
  validateImprestRetirement
} from '../lib/imprest.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function amount(value) {
  const number = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

export function requiredRequisitionDate(value) {
  const date = clean(value);
  const validShape = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const parsed = validShape ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    const err = new Error('A valid required date is required for the requisition.');
    err.status = 400;
    err.code = 'REQUISITION_DATE_REQUIRED';
    throw err;
  }
  return date;
}

export function normalizeMaterialItems(input) {
  let rows = input;
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows);
    } catch {
      rows = [];
    }
  }
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const quantity = amount(row?.quantity ?? row?.Quantity);
    const unitPrice = amount(row?.unitPrice ?? row?.UnitPrice);
    return {
      Item: clean(row?.item ?? row?.Item),
      Specification: clean(row?.specification ?? row?.Specification),
      Quantity: quantity,
      UnitPrice: unitPrice,
      Total: amount(quantity * unitPrice)
    };
  }).filter((row) => row.Item || row.Specification || row.Quantity || row.UnitPrice)
    .map((row, index) => ({ SNo: index + 1, ...row }));
}

function safeId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
}

function documentVersion(document = {}) {
  const version = clean(document.__updateTime);
  if (version) return version;
  const error = new Error('This finance record has no concurrency version. Refresh the list and try again.');
  error.status = 409;
  error.code = 'FINANCE_RECORD_VERSION_REQUIRED';
  throw error;
}

function removeFirestoreMetadata(document = {}) {
  delete document.__id;
  delete document.__name;
  delete document.__createTime;
  delete document.__updateTime;
  return document;
}

function requisitionRevisionNumber(existing = {}) {
  const current = Number(existing.RevisionNumber || 1);
  return Number.isInteger(current) && current > 0 ? current : 1;
}

function finalFinanceStatus(status) {
  return ['paid', 'posted', 'processed', 'voided', 'cancelled', 'canceled'].includes(lower(status));
}

function assertRequisitionResubmittable(existing = {}) {
  if (clean(existing.AdminReviewedAt)) {
    const err = new Error('An administratively approved requisition cannot be edited or resubmitted.');
    err.status = 409;
    err.code = 'REQUISITION_ADMIN_APPROVAL_LOCKED';
    throw err;
  }
  if (finalFinanceStatus(existing.Status)) {
    const err = new Error(`A ${existing.Status} requisition cannot be edited and resubmitted.`);
    err.status = 409;
    throw err;
  }
}

export function buildRequisitionResubmission(existing = {}, body = {}, user = {}, timestamp = nowIso()) {
  if (!clean(existing.ExpenseNo || existing.__id)) {
    const err = new Error('The selected requisition was not found.');
    err.status = 404;
    throw err;
  }
  assertRequisitionResubmittable(existing);

  const isMaterial = lower(existing.RequisitionType) === 'material';
  const description = clean(body.description ?? body.Description);
  const requiredDate = requiredRequisitionDate(body.date ?? body.Date);
  const value = isMaterial
    ? amount(normalizeMaterialItems(body.items ?? body.MaterialItems).reduce((sum, item) => sum + item.Total, 0))
    : amount(body.amount ?? body.Amount);
  const materialItems = isMaterial ? normalizeMaterialItems(body.items ?? body.MaterialItems) : [];
  if (!description) {
    const err = new Error('A description is required for the requisition.');
    err.status = 400;
    throw err;
  }
  if (isMaterial) {
    if (!materialItems.length) {
      const err = new Error('Add at least one material item.');
      err.status = 400;
      throw err;
    }
    const invalidItem = materialItems.find((item) =>
      !item.Item || !item.Specification || item.Quantity <= 0 || item.UnitPrice <= 0);
    if (invalidItem) {
      const err = new Error(`Complete item, specification, quantity and unit price for line ${invalidItem.SNo}.`);
      err.status = 400;
      throw err;
    }
  } else if (value <= 0) {
    const err = new Error('An amount greater than zero is required.');
    err.status = 400;
    throw err;
  }

  const priorRevision = requisitionRevisionNumber(existing);
  const nextRevision = priorRevision + 1;
  const priorSnapshot = removeFirestoreMetadata({ ...existing });
  const expenseNo = clean(existing.ExpenseNo || existing.__id);
  const revisionId = safeId(`${expenseNo}-REV-${String(priorRevision).padStart(3, '0')}`);
  const revisedBy = actor(user);
  const payload = removeFirestoreMetadata({
    ...existing,
    Date: requiredDate,
    Vendor: clean(body.vendor ?? body.Vendor),
    Description: description,
    Amount: value,
    ...(isMaterial ? { MaterialItems: materialItems } : {}),
    Reference: clean(body.reference ?? body.Reference),
    AttachmentUrl: clean(body.attachmentUrl ?? body.AttachmentUrl),
    Notes: clean(body.notes ?? body.Notes),
    Status: 'Submitted',
    RevisionNumber: nextRevision,
    OriginalRequestedAt: clean(existing.OriginalRequestedAt || existing.RequestedAt || existing.CreatedAt),
    PreviousStatus: clean(existing.Status || 'Submitted'),
    LastRevisionId: revisionId,
    ResubmittedAt: timestamp,
    ResubmittedBy: revisedBy,
    ResubmittedByUsername: clean(user.username),
    UpdatedAt: timestamp,
    UpdatedBy: revisedBy,
    ReviewNotes: '',
    ApprovedAt: '',
    ApprovedBy: '',
    ApprovedByUsername: '',
    ApprovalSignatureApplied: false,
    ApprovalStampApplied: false,
    ApprovalAuthenticationMethod: '',
    RejectedAt: '',
    RejectedBy: '',
    AdminReviewedAt: '',
    AdminReviewedBy: '',
    AdminReviewedByUsername: '',
    AdminSignatureApplied: false,
    AdminStampApplied: false,
    AdminAuthenticationMethod: '',
    AccountsReviewStatus: '',
    AccountsReviewedBy: '',
    AccountsReviewedByUsername: '',
    AccountsReviewedAt: '',
    AccountsSignatureApplied: false,
    AccountsStampApplied: false,
    AccountsAuthenticationMethod: '',
    AccountsReviewNotes: ''
  });
  const revision = {
    RevisionId: revisionId,
    ExpenseNo: expenseNo,
    RevisionNumber: priorRevision,
    ArchivedAt: timestamp,
    ArchivedBy: revisedBy,
    ArchivedByUsername: clean(user.username),
    StatusAtArchive: clean(existing.Status || 'Submitted'),
    BranchId: clean(existing.BranchId || user.branchId) || 'main',
    SchoolSection: clean(existing.SchoolSection || user.schoolSectionAccess || 'Secondary'),
    Snapshot: priorSnapshot
  };
  return { payload, revision, revisionId, priorRevision, nextRevision };
}

async function commitFinanceDecision(env, writes) {
  try {
    return await batchUpsertDocuments(env, writes);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      const conflict = new Error('This finance request changed while it was being reviewed. Refresh the list before trying again.');
      conflict.status = 409;
      conflict.code = 'FINANCE_WRITE_CONFLICT';
      throw conflict;
    }
    throw error;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function dateToday() {
  return nowIso().slice(0, 10);
}

function requestNumber(prefix) {
  const date = dateToday().replace(/-/g, '');
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${prefix}-${date}-${random}`;
}

function same(left, right) {
  return lower(left) === lower(right);
}

function userDepartment(user) {
  const explicit = clean(user.department);
  if (explicit) return explicit;
  return {
    'Admissions Officer': 'Admissions',
    'Accounts Officer': 'Accounts',
    Management: 'Management',
    'Tuck Shop User': 'Tuck Shop',
    'Clinic User': 'Clinic',
    'Kitchen User': 'Kitchen',
    'Front Desk': 'Front Desk',
    'Super Admin': 'Administration'
  }[clean(user.role)] || '';
}

function capabilities(user) {
  return {
    canSubmit: Boolean(userDepartment(user)),
    canApprove: clean(user.role) === 'Super Admin' || Boolean(user.approvalEnabled),
    canAdminOverride: clean(user.role) === 'Super Admin',
    canAccountsReview: ['Super Admin', 'Accounts Officer'].includes(clean(user.role)),
    canViewAll: ['Super Admin', 'Management', 'Accounts Officer'].includes(clean(user.role))
  };
}

function actor(user) {
  return clean(user.displayName || user.username);
}

async function requireDecisionAuthorization(env, user, body, request, decisionAction) {
  if (clean(body.approvalPassword) && await verifyStaffApprovalPassword(env, user.username, body.approvalPassword)) {
    return 'Password';
  }
  if (await readStaffApprovalProof(env, request, user.username, {
    recordId: body.recordId,
    recordType: body.recordType,
    action: decisionAction
  })) return 'Biometric';
  const err = new Error('Confirm this decision with your current password or biometric verification.');
  err.status = 403;
  throw err;
}

function publicRows(rows) {
  return (rows || []).map((row) => {
    const copy = { ...row };
    delete copy.PasswordHash;
    delete copy.Salt;
    return copy;
  });
}

function scopedRows(rows, user, access) {
  const wantedSection = lower(user.schoolSectionAccess || 'All');
  const wantedBranch = lower(user.branchId || '');
  const schoolRows = rows.filter((row) => {
    const rowSection = lower(row.SchoolSection || 'Secondary');
    const rowBranch = lower(row.BranchId || 'main');
    return (wantedSection === 'all' || rowSection === wantedSection) && (!wantedBranch || rowBranch === wantedBranch);
  });
  if (access.canViewAll) return schoolRows;
  const department = userDepartment(user);
  return schoolRows.filter((row) => same(row.Department, department));
}

function auditWrite(user, action, recordType, recordId, details = '', timestamp = nowIso(), scope = {}) {
  const id = requestNumber('WEB-AUDIT');
  return {
    collectionPath: 'accountingAudit',
    documentId: safeId(id),
    data: {
      AuditId: id,
      Timestamp: timestamp,
      Action: action,
      RecordType: recordType,
      RecordId: recordId,
      Details: clean(details),
      User: actor(user),
      UserRole: user.role,
      Department: userDepartment(user),
      BranchId: clean(scope.BranchId || scope.branchId || user.branchId) || 'main',
      SchoolSection: clean(
        scope.SchoolSection
        || scope.schoolSection
        || (clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : user.schoolSectionAccess)
        || 'Secondary'
      ),
      SourcePlatform: 'Web'
    }
  };
}

async function writeAudit(env, user, action, recordType, recordId, details = '') {
  const write = auditWrite(user, action, recordType, recordId, details);
  await upsertDocument(env, write.collectionPath, write.documentId, write.data);
}

async function listWorkflow(env, user) {
  const access = capabilities(user);
  const [requests, bills, imprests, approvalProfile] = await Promise.all([
    listCollection(env, 'accountingExpenses'),
    listCollection(env, 'accountingSupplierBills'),
    listCollection(env, 'accountingImprests').catch(() => []),
    loadStaffApprovalProfile(env, user.username)
  ]);
  const approvalProfileSummary = publicStaffApprovalProfile(approvalProfile || {});
  delete approvalProfileSummary.SignatureDataUrl;
  delete approvalProfileSummary.StampDataUrl;
  const sortRecent = (rows) => [...rows].sort((a, b) => clean(b.UpdatedAt || b.CreatedAt || b.Date).localeCompare(clean(a.UpdatedAt || a.CreatedAt || a.Date)));
  const scopedImprests = publicRows(sortRecent(scopedRows(imprests, user, access))).slice(0, 250);
  return {
    ok: true,
    message: 'Department finance workflow loaded.',
    department: userDepartment(user),
    capabilities: access,
    approvalProfile: approvalProfileSummary,
    requisitions: publicRows(sortRecent(scopedRows(requests, user, access))).slice(0, 150),
    bills: publicRows(sortRecent(scopedRows(bills, user, access))).slice(0, 150),
    imprests: scopedImprests,
    imprestSummary: imprestReportSummary(scopedImprests)
  };
}

function requireSubmitter(user) {
  const department = userDepartment(user);
  if (!department) {
    const err = new Error('A department must be assigned to this staff account before submitting finance requests.');
    err.status = 403;
    throw err;
  }
  return department;
}

async function submitRequisition(env, user, body) {
  const department = requireSubmitter(user);
  const value = amount(body.amount || body.Amount);
  const description = clean(body.description || body.Description);
  const requiredDate = requiredRequisitionDate(body.date || body.Date);
  if (!description || value <= 0) {
    const err = new Error('Description and an amount greater than zero are required.');
    err.status = 400;
    throw err;
  }
  const expenseNo = requestNumber('WEB-REQ');
  const payload = {
    ExpenseNo: expenseNo,
    Date: requiredDate,
    Vendor: clean(body.vendor || body.Vendor),
    Description: description,
    Amount: value,
    ExpenseAccount: clean(body.expenseAccount || body.ExpenseAccount) || '6090',
    PaymentAccount: '1020',
    Department: department,
    CostCentre: clean(body.costCentre || body.CostCentre),
    BudgetCode: clean(body.budgetCode || body.BudgetCode),
    Reference: clean(body.reference || body.Reference),
    AttachmentUrl: clean(body.attachmentUrl || body.AttachmentUrl),
    Notes: clean(body.notes || body.Notes),
    Status: 'Submitted',
    RevisionNumber: 1,
    RequestedBy: actor(user),
    RequestedByUsername: clean(user.username),
    RequestedAt: nowIso(),
    CreatedAt: nowIso(),
    UpdatedAt: nowIso(),
    SourcePlatform: 'Web'
    ,BranchId: clean(user.branchId) || 'main'
    ,SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary')
  };
  await upsertDocument(env, 'accountingExpenses', safeId(expenseNo), payload);
  await writeAudit(env, user, 'CREATE', 'Expense Requisition', expenseNo, `${department}: ${description}`);
  await notifyStaffRequisitionSubmitted(env, payload, actor(user)).catch(() => null);
  return { ok: true, message: 'Requisition submitted for approval.', requisition: payload };
}

async function submitMaterialRequisition(env, user, body) {
  const department = requireSubmitter(user);
  const items = normalizeMaterialItems(body.items || body.MaterialItems);
  const description = clean(body.description || body.Description);
  const requiredDate = requiredRequisitionDate(body.date || body.Date);
  if (!description) {
    const err = new Error('A description is required for the material requisition.');
    err.status = 400;
    throw err;
  }
  if (!items.length) {
    const err = new Error('Add at least one material item.');
    err.status = 400;
    throw err;
  }
  const invalidItem = items.find((item) => !item.Item || !item.Specification || item.Quantity <= 0 || item.UnitPrice <= 0);
  if (invalidItem) {
    const err = new Error(`Complete item, specification, quantity and unit price for line ${invalidItem.SNo}.`);
    err.status = 400;
    throw err;
  }
  const value = amount(items.reduce((sum, item) => sum + item.Total, 0));
  const expenseNo = requestNumber('WEB-MAT');
  const payload = {
    ExpenseNo: expenseNo,
    RequisitionType: 'Material',
    Date: requiredDate,
    Vendor: clean(body.vendor || body.Vendor),
    Description: description,
    MaterialItems: items,
    Amount: value,
    ExpenseAccount: clean(body.expenseAccount || body.ExpenseAccount) || '6090',
    PaymentAccount: '1020',
    Department: department,
    CostCentre: clean(body.costCentre || body.CostCentre),
    BudgetCode: clean(body.budgetCode || body.BudgetCode),
    Reference: clean(body.reference || body.Reference),
    AttachmentUrl: clean(body.attachmentUrl || body.AttachmentUrl),
    Notes: clean(body.notes || body.Notes),
    Status: 'Submitted',
    RevisionNumber: 1,
    RequestedBy: actor(user),
    RequestedByUsername: clean(user.username),
    RequestedAt: nowIso(),
    CreatedAt: nowIso(),
    UpdatedAt: nowIso(),
    SourcePlatform: 'Web',
    BranchId: clean(user.branchId) || 'main',
    SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary')
  };
  await upsertDocument(env, 'accountingExpenses', safeId(expenseNo), payload);
  await writeAudit(env, user, 'CREATE', 'Material Requisition', expenseNo, `${department}: ${items.length} item(s), ${value}`);
  await notifyStaffRequisitionSubmitted(env, payload, actor(user)).catch(() => null);
  return { ok: true, message: 'Material requisition submitted for approval.', requisition: payload };
}

async function resubmitRequisition(env, user, body) {
  if (clean(user.role) !== 'Super Admin') {
    const err = new Error('Only Super Admin can edit and resubmit an existing requisition.');
    err.status = 403;
    throw err;
  }
  const id = clean(body.recordId || body.ExpenseNo);
  if (!id) {
    const err = new Error('Select a requisition to edit and resubmit.');
    err.status = 400;
    throw err;
  }
  const direct = await getDocument(env, 'accountingExpenses', safeId(id));
  const existing = direct || (await listCollection(env, 'accountingExpenses'))
    .find((row) => same(row.ExpenseNo, id) || same(row.__id, safeId(id)));
  if (!existing || !scopedRows([existing], user, capabilities(user)).length) {
    const err = new Error('The selected requisition was not found.');
    err.status = 404;
    throw err;
  }
  assertRequisitionResubmittable(existing);
  const clientVersion = clean(body.recordVersion);
  if (!clientVersion || clientVersion !== clean(existing.__updateTime)) {
    const err = new Error('This requisition changed after it was loaded. Refresh the list before resubmitting it.');
    err.status = 409;
    err.code = 'FINANCE_WRITE_CONFLICT';
    throw err;
  }
  const timestamp = nowIso();
  const { payload, revision, revisionId, nextRevision } =
    buildRequisitionResubmission(existing, body, user, timestamp);
  const audit = auditWrite(
    user,
    'EDIT AND RESUBMIT',
    'Expense Requisition',
    id,
    `Revision ${nextRevision}; previous status ${clean(existing.Status || 'Submitted')}; archived as ${revisionId}`,
    timestamp,
    existing
  );
  await commitFinanceDecision(env, [
    {
      collectionPath: 'accountingExpenseRevisions',
      documentId: revisionId,
      data: revision,
      exists: false
    },
    {
      collectionPath: 'accountingExpenses',
      documentId: safeId(id),
      data: payload,
      updateTime: documentVersion(existing)
    },
    {
      collectionPath: 'financeDocumentEndorsements',
      documentId: endorsementId(id, 'approval'),
      operation: 'delete'
    },
    {
      collectionPath: 'financeDocumentEndorsements',
      documentId: endorsementId(id, 'admin'),
      operation: 'delete'
    },
    {
      collectionPath: 'financeDocumentEndorsements',
      documentId: endorsementId(id, 'accounts'),
      operation: 'delete'
    },
    audit
  ]);
  await notifyStaffRequisitionSubmitted(env, payload, actor(user)).catch(() => null);
  return {
    ok: true,
    message: `Requisition edited and resubmitted as revision ${nextRevision}.`,
    requisition: payload,
    revision: {
      RevisionId: revisionId,
      RevisionNumber: revision.RevisionNumber,
      ArchivedAt: revision.ArchivedAt
    }
  };
}

async function submitBill(env, user, body) {
  const department = requireSubmitter(user);
  const value = amount(body.amount || body.Amount);
  const description = clean(body.description || body.Description);
  const vendorName = clean(body.vendorName || body.VendorName || body.vendor);
  if (!description || !vendorName || value <= 0) {
    const err = new Error('Supplier, description and an amount greater than zero are required.');
    err.status = 400;
    throw err;
  }
  const billNo = requestNumber('WEB-BILL');
  const payload = {
    BillNo: billNo,
    VendorId: '',
    VendorName: vendorName,
    InvoiceReference: clean(body.invoiceReference || body.InvoiceReference),
    Date: clean(body.date || body.Date) || dateToday(),
    DueDate: clean(body.dueDate || body.DueDate),
    Description: description,
    Amount: value,
    PaidAmount: 0,
    BalanceAmount: value,
    AccountCode: clean(body.accountCode || body.AccountCode) || '6090',
    Department: department,
    CostCentre: clean(body.costCentre || body.CostCentre),
    AcademicSession: clean(body.academicSession || body.AcademicSession),
    Term: clean(body.term || body.Term),
    AttachmentUrl: clean(body.attachmentUrl || body.AttachmentUrl),
    Notes: clean(body.notes || body.Notes),
    Status: 'Submitted',
    RequestedByUsername: clean(user.username),
    CreatedAt: nowIso(),
    CreatedBy: actor(user),
    UpdatedAt: nowIso(),
    SourcePlatform: 'Web'
    ,BranchId: clean(user.branchId) || 'main'
    ,SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary')
  };
  await upsertDocument(env, 'accountingSupplierBills', safeId(billNo), payload);
  await writeAudit(env, user, 'CREATE', 'Supplier Bill', billNo, `${department}: ${description}`);
  await notifyStaffRequisitionEvent(env, payload, 'Submitted', actor(user)).catch(() => null);
  return { ok: true, message: 'Supplier bill submitted for approval.', bill: payload };
}

async function approvalLimitAllows(env, user, transactionType, value) {
  if (user.role === 'Super Admin') return true;
  if (!user.approvalEnabled) return false;
  const maximum = amount(user.approvalMaxAmount);
  return maximum > 0 && value <= maximum;
}

function approvalAccountAllows(user, existing, isBill) {
  if (user.role === 'Super Admin') return true;
  const allowed = Array.isArray(user.approvalAccounts) ? user.approvalAccounts.map(lower).filter(Boolean) : [];
  if (!allowed.length) return false;
  const accountCode = clean(isBill ? existing.AccountCode : existing.ExpenseAccount);
  return allowed.some((value) => value === lower(accountCode));
}

async function reviewRecord(env, user, body, request) {
  const access = capabilities(user);
  if (!access.canApprove) {
    const err = new Error('Approval rights have not been enabled for this account by an administrator.');
    err.status = 403;
    throw err;
  }
  const type = lower(body.recordType);
  const decision = clean(body.decision);
  if (!['Approved', 'Rejected'].includes(decision)) {
    const err = new Error('Decision must be Approved or Rejected.');
    err.status = 400;
    throw err;
  }
  const isBill = type === 'bill';
  const collection = isBill ? 'accountingSupplierBills' : 'accountingExpenses';
  const idField = isBill ? 'BillNo' : 'ExpenseNo';
  const id = clean(body.recordId);
  const direct = await getDocument(env, collection, safeId(id));
  const existing = direct || (await listCollection(env, collection))
    .find((row) => same(row[idField], id) || same(row.__id, safeId(id)));
  if (!existing) {
    const err = new Error('The selected finance request was not found.');
    err.status = 404;
    throw err;
  }
  const currentStatus = lower(existing.Status);
  const isAdminOverride = user.role === 'Super Admin' && currentStatus === 'approved';
  if (currentStatus !== 'submitted' && !isAdminOverride) {
    const err = new Error(`Only Submitted records can be reviewed${user.role === 'Super Admin' ? ', or an Approved record can be overridden by an administrator' : ''}. This record is ${existing.Status || 'unknown'}.`);
    err.status = 409;
    throw err;
  }
  if (decision === 'Approved' && !(await approvalLimitAllows(env, user, isBill ? 'Supplier Bill' : 'Expense', amount(existing.Amount)))) {
    const err = new Error(`${user.role} approval limit is insufficient for this amount.`);
    err.status = 403;
    throw err;
  }
  if (!approvalAccountAllows(user, existing, isBill)) {
    const err = new Error('This user is not permitted to review requests from the selected account code.');
    err.status = 403;
    throw err;
  }
  const authorizationMethod = decision === 'Approved'
    ? await requireDecisionAuthorization(env, user, body, request, 'review:Approved')
    : '';
  const timestamp = nowIso();
  const isAdminOverrideApproval = decision === 'Approved' && Boolean(isAdminOverride);
  const stage = isAdminOverrideApproval ? 'admin' : 'approval';
  const endorsement = decision === 'Approved'
    ? await buildEndorsement(env, user, body, id, stage)
    : null;
  const payload = {
    ...existing,
    Status: decision,
    ReviewNotes: clean(body.notes),
    UpdatedAt: timestamp,
    ...(decision === 'Approved'
      ? {
          ApprovedAt: existing.ApprovedAt || timestamp,
          ApprovedBy: existing.ApprovedBy || actor(user),
          ApprovedByUsername: existing.ApprovedByUsername || clean(user.username),
          ApprovalSignatureApplied: isAdminOverrideApproval ? existing.ApprovalSignatureApplied : Boolean(endorsement?.SignatureDataUrl),
          ApprovalStampApplied: isAdminOverrideApproval ? existing.ApprovalStampApplied : Boolean(endorsement?.StampDataUrl),
          ApprovalAuthenticationMethod: isAdminOverrideApproval ? existing.ApprovalAuthenticationMethod : authorizationMethod,
          AdminReviewedAt: isAdminOverrideApproval ? timestamp : '',
          AdminReviewedBy: isAdminOverrideApproval ? actor(user) : '',
          AdminReviewedByUsername: isAdminOverrideApproval ? clean(user.username) : '',
          AdminSignatureApplied: isAdminOverrideApproval ? Boolean(endorsement?.SignatureDataUrl) : false,
          AdminStampApplied: isAdminOverrideApproval ? Boolean(endorsement?.StampDataUrl) : false,
          AdminAuthenticationMethod: isAdminOverrideApproval ? authorizationMethod : '',
          RejectedAt: '',
          RejectedBy: ''
        }
      : {
          RejectedAt: timestamp,
          RejectedBy: actor(user),
          ApprovedAt: '',
          ApprovedBy: '',
          ApprovedByUsername: '',
          ApprovalSignatureApplied: false,
          ApprovalStampApplied: false
        })
  };
  removeFirestoreMetadata(payload);
  const writes = [{
    collectionPath: collection,
    documentId: safeId(id),
    data: payload,
    updateTime: documentVersion(existing)
  }];
  if (endorsement) writes.push({
    collectionPath: 'financeDocumentEndorsements',
    documentId: endorsementId(id, stage),
    data: endorsement
  });
  await commitFinanceDecision(env, writes);
  if (decision === 'Rejected') {
    await deleteDocument(env, 'financeDocumentEndorsements', endorsementId(id, 'approval')).catch(() => null);
    await deleteDocument(env, 'financeDocumentEndorsements', endorsementId(id, 'admin')).catch(() => null);
  }
  await writeAudit(env, user, decision.toUpperCase(), isBill ? 'Supplier Bill' : 'Expense Requisition', id, clean(body.notes));
  await notifyStaffRequisitionEvent(env, payload, decision, actor(user)).catch(() => null);
  return { ok: true, message: `${isBill ? 'Supplier bill' : 'Requisition'} ${decision.toLowerCase()}.`, record: payload };
}

async function accountsReview(env, user, body, request) {
  const access = capabilities(user);
  if (!access.canAccountsReview) {
    const err = new Error('Only Accounts or Super Admin can review approved requests for processing.');
    err.status = 403;
    throw err;
  }
  const isBill = lower(body.recordType) === 'bill';
  const collection = isBill ? 'accountingSupplierBills' : 'accountingExpenses';
  const idField = isBill ? 'BillNo' : 'ExpenseNo';
  const id = clean(body.recordId);
  const direct = await getDocument(env, collection, safeId(id));
  const existing = direct || (await listCollection(env, collection))
    .find((row) => same(row[idField], id) || same(row.__id, safeId(id)));
  if (!existing) {
    const err = new Error('The selected finance request was not found.');
    err.status = 404;
    throw err;
  }
  if (lower(existing.Status) !== 'approved') {
    const err = new Error('Only Approved requests can be marked as reviewed by Accounts.');
    err.status = 409;
    throw err;
  }
  const authorizationMethod = await requireDecisionAuthorization(env, user, body, request, 'accountsReview');
  const endorsement = await buildEndorsement(env, user, body, id, 'accounts');
  const payload = {
    ...existing,
    AccountsReviewStatus: 'Reviewed',
    AccountsReviewedBy: actor(user),
    AccountsReviewedByUsername: clean(user.username),
    AccountsReviewedAt: nowIso(),
    AccountsSignatureApplied: Boolean(endorsement?.SignatureDataUrl),
    AccountsStampApplied: Boolean(endorsement?.StampDataUrl),
    AccountsAuthenticationMethod: authorizationMethod,
    AccountsReviewNotes: clean(body.notes),
    UpdatedAt: nowIso()
  };
  removeFirestoreMetadata(payload);
  const writes = [{
    collectionPath: collection,
    documentId: safeId(id),
    data: payload,
    updateTime: documentVersion(existing)
  }];
  if (endorsement) writes.push({
    collectionPath: 'financeDocumentEndorsements',
    documentId: endorsementId(id, 'accounts'),
    data: endorsement
  });
  await commitFinanceDecision(env, writes);
  await writeAudit(env, user, 'ACCOUNTS REVIEW', isBill ? 'Supplier Bill' : 'Expense Requisition', id, clean(body.notes));
  await notifyStaffRequisitionEvent(env, payload, 'Pushed', actor(user)).catch(() => null);
  return { ok: true, message: 'Marked as reviewed by Accounts. Post or pay it from the desktop Finance & Accounting tab.', record: payload };
}

function validIsoDate(value, label) {
  const date = clean(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    const err = new Error(`A valid ${label} is required.`);
    err.status = 400;
    throw err;
  }
  return date;
}

async function findImprest(env, user, body) {
  const id = clean(body.recordId || body.ImprestNo || body.imprestNo);
  if (!id) {
    const err = new Error('Select an imprest record.');
    err.status = 400;
    throw err;
  }
  const direct = await getDocument(env, 'accountingImprests', safeId(id));
  const existing = direct || (await listCollection(env, 'accountingImprests'))
    .find((row) => same(row.ImprestNo, id) || same(row.__id, safeId(id)));
  if (!existing || !scopedRows([existing], user, capabilities(user)).length) {
    const err = new Error('The selected imprest record was not found in this branch.');
    err.status = 404;
    throw err;
  }
  return existing;
}

function imprestOpenClaimId(record = {}) {
  return safeId(`${clean(record.BranchId || 'main').toLowerCase()}-${clean(record.CustodianUsername || record.RequestedByUsername).toLowerCase()}`);
}

async function ensureImprestAdvanceAccount(env) {
  const existing = await getDocument(env, 'chartOfAccounts', IMPREST_ADVANCE_ACCOUNT).catch(() => null);
  if (existing) return existing;
  const payload = {
    Code: IMPREST_ADVANCE_ACCOUNT,
    Name: 'Staff Imprest and Cash Advances',
    Type: 'Asset',
    Group: 'Current Assets',
    NormalBalance: 'Debit',
    Active: 'YES',
    System: 'YES',
    CreatedAt: nowIso(),
    UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'chartOfAccounts', IMPREST_ADVANCE_ACCOUNT, payload);
  return payload;
}

function postedJournalPayload(journal, user) {
  const timestamp = nowIso();
  return {
    ...journal,
    CreatedAt: timestamp,
    CreatedBy: actor(user),
    UpdatedAt: timestamp,
    UpdatedBy: actor(user),
    PostedAt: timestamp,
    PostedBy: actor(user),
    System: 'YES',
    TotalDebit: amount(journal.Lines.reduce((sum, line) => sum + amount(line.Debit), 0)),
    TotalCredit: amount(journal.Lines.reduce((sum, line) => sum + amount(line.Credit), 0))
  };
}

async function validateImprestPosting(env, journal) {
  const date = clean(journal.Date).slice(0, 10);
  const periods = await listCollection(env, 'accountingPeriods').catch(() => []);
  if (periods.some((row) => lower(row.Status) === 'closed' &&
    date >= clean(row.StartDate) && date <= clean(row.EndDate))) {
    const err = new Error('This accounting period is closed. Reopen it or use a valid open posting date.');
    err.status = 409;
    throw err;
  }
  const chart = await listCollection(env, 'chartOfAccounts');
  const activeCodes = new Set(chart.filter((row) => !['no', 'false', 'inactive'].includes(lower(row.Active || 'YES')))
    .map((row) => clean(row.Code || row.__id)));
  const invalid = journal.Lines.find((line) => !activeCodes.has(clean(line.AccountCode)));
  if (invalid) {
    const err = new Error(`Journal account ${invalid.AccountCode} does not exist or is inactive.`);
    err.status = 400;
    throw err;
  }
  const debit = amount(journal.Lines.reduce((sum, line) => sum + amount(line.Debit), 0));
  const credit = amount(journal.Lines.reduce((sum, line) => sum + amount(line.Credit), 0));
  if (Math.abs(debit - credit) > 0.005) {
    const err = new Error('The imprest journal is not balanced.');
    err.status = 500;
    throw err;
  }
}

async function submitImprest(env, user, body) {
  const department = requireSubmitter(user);
  const requestedAmount = amount(body.amount || body.AmountRequested || body.Amount);
  const purpose = clean(body.purpose || body.Purpose);
  const date = validIsoDate(body.date || body.Date || dateToday(), 'request date');
  const dueDate = validIsoDate(body.dueDate || body.DueDate, 'retirement due date');
  if (!purpose || requestedAmount <= 0) {
    const err = new Error('Purpose and an amount greater than zero are required.');
    err.status = 400;
    throw err;
  }
  if (dueDate < date) {
    const err = new Error('The retirement due date cannot be earlier than the request date.');
    err.status = 400;
    throw err;
  }
  const username = clean(user.username);
  const branchId = clean(user.branchId) || 'main';
  const existingOpen = (await listCollection(env, 'accountingImprests').catch(() => []))
    .find((row) => same(row.CustodianUsername || row.RequestedByUsername, username) &&
      same(row.BranchId || 'main', branchId) && isOpenImprestStatus(row.Status));
  if (existingOpen) {
    const err = new Error(`Retire or close ${existingOpen.ImprestNo || 'the current imprest'} before requesting another imprest.`);
    err.status = 409;
    err.code = 'OPEN_IMPREST_EXISTS';
    throw err;
  }
  const imprestNo = requestNumber('IMP');
  const timestamp = nowIso();
  const payload = {
    ImprestNo: imprestNo,
    ImprestType: ['Standing', 'Special'].includes(clean(body.imprestType || body.ImprestType))
      ? clean(body.imprestType || body.ImprestType)
      : 'Special',
    Date: date,
    DueDate: dueDate,
    Purpose: purpose,
    AmountRequested: requestedAmount,
    AmountApproved: 0,
    AmountIssued: 0,
    ExpenseTotal: 0,
    ReturnedAmount: 0,
    OutstandingAmount: requestedAmount,
    AdvanceAccount: IMPREST_ADVANCE_ACCOUNT,
    PaymentAccount: clean(body.paymentAccount || body.PaymentAccount) || '1020',
    Department: department,
    CostCentre: clean(body.costCentre || body.CostCentre),
    CustodianName: actor(user),
    CustodianUsername: username,
    RequestedBy: actor(user),
    RequestedByUsername: username,
    RequestedAt: timestamp,
    Notes: clean(body.notes || body.Notes),
    Status: 'Submitted',
    CreatedAt: timestamp,
    UpdatedAt: timestamp,
    SourcePlatform: 'Web',
    BranchId: branchId,
    SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary')
  };
  try {
    await commitFinanceDecision(env, [
      {
        collectionPath: 'accountingImprestOpenClaims',
        documentId: imprestOpenClaimId(payload),
        data: {
          ClaimId: imprestOpenClaimId(payload), ImprestNo: imprestNo, BranchId: branchId,
          CustodianUsername: username, CreatedAt: timestamp
        },
        exists: false
      },
      { collectionPath: 'accountingImprests', documentId: safeId(imprestNo), data: payload, exists: false },
      auditWrite(user, 'SUBMIT', 'Imprest', imprestNo, `${payload.ImprestType}: ${purpose}; ${requestedAmount}`, timestamp, payload)
    ]);
  } catch (error) {
    if (error?.code === 'FINANCE_WRITE_CONFLICT') {
      const conflict = new Error('You already have an open imprest in this branch. Retire or close it before requesting another one.');
      conflict.status = 409;
      conflict.code = 'OPEN_IMPREST_EXISTS';
      throw conflict;
    }
    throw error;
  }
  return { ok: true, message: 'Imprest request submitted for approval.', imprest: payload };
}

async function reviewImprest(env, user, body, request) {
  const access = capabilities(user);
  if (!access.canApprove) {
    const err = new Error('Approval rights have not been enabled for this account.');
    err.status = 403;
    throw err;
  }
  const existing = await findImprest(env, user, body);
  if (lower(existing.Status) !== 'submitted') {
    const err = new Error('Only a Submitted imprest can be approved or rejected.');
    err.status = 409;
    throw err;
  }
  const decision = clean(body.decision);
  if (!['Approved', 'Rejected'].includes(decision)) {
    const err = new Error('Decision must be Approved or Rejected.');
    err.status = 400;
    throw err;
  }
  const approvedAmount = amount(body.approvedAmount || body.AmountApproved || existing.AmountRequested);
  if (decision === 'Approved') {
    if (approvedAmount <= 0 || approvedAmount > amount(existing.AmountRequested)) {
      const err = new Error('Approved amount must be greater than zero and cannot exceed the requested amount.');
      err.status = 400;
      throw err;
    }
    if (!(await approvalLimitAllows(env, user, 'Imprest', approvedAmount))) {
      const err = new Error(`${user.role} approval limit is insufficient for this imprest.`);
      err.status = 403;
      throw err;
    }
    await requireDecisionAuthorization(env, user, body, request, 'imprest:approve');
  }
  const timestamp = nowIso();
  const payload = removeFirestoreMetadata({
    ...existing,
    Status: decision,
    AmountApproved: decision === 'Approved' ? approvedAmount : 0,
    OutstandingAmount: decision === 'Approved' ? approvedAmount : 0,
    ReviewNotes: clean(body.notes),
    UpdatedAt: timestamp,
    ...(decision === 'Approved'
      ? { ApprovedAt: timestamp, ApprovedBy: actor(user), ApprovedByUsername: clean(user.username) }
      : { RejectedAt: timestamp, RejectedBy: actor(user), RejectedByUsername: clean(user.username) })
  });
  const writes = [
    {
      collectionPath: 'accountingImprests', documentId: safeId(existing.ImprestNo), data: payload,
      updateTime: documentVersion(existing)
    },
    auditWrite(user, decision.toUpperCase(), 'Imprest', existing.ImprestNo, clean(body.notes), timestamp, existing)
  ];
  if (decision === 'Rejected') writes.push({
    collectionPath: 'accountingImprestOpenClaims', documentId: imprestOpenClaimId(existing), operation: 'delete'
  });
  await commitFinanceDecision(env, writes);
  return { ok: true, message: `Imprest ${decision.toLowerCase()}.`, imprest: payload };
}

async function issueImprest(env, user, body, request) {
  if (!capabilities(user).canAccountsReview) {
    const err = new Error('Only Accounts or Super Admin can issue an approved imprest.');
    err.status = 403;
    throw err;
  }
  const existing = await findImprest(env, user, body);
  if (lower(existing.Status) !== 'approved') {
    const err = new Error('Only an Approved imprest can be issued.');
    err.status = 409;
    throw err;
  }
  const paymentAccount = clean(body.paymentAccount || body.PaymentAccount) || '1020';
  const reference = clean(body.disbursementReference || body.DisbursementReference);
  if (!reference) {
    const err = new Error('Enter the cash, bank or payment reference used for the disbursement.');
    err.status = 400;
    throw err;
  }
  await requireDecisionAuthorization(env, user, body, request, 'imprest:issue');
  await ensureImprestAdvanceAccount(env);
  const timestamp = nowIso();
  const payload = removeFirestoreMetadata({
    ...existing,
    Status: 'Issued',
    AmountIssued: amount(existing.AmountApproved),
    OutstandingAmount: amount(existing.AmountApproved),
    PaymentAccount: paymentAccount,
    DisbursementReference: reference,
    IssueDate: validIsoDate(body.issueDate || body.IssueDate || dateToday(), 'issue date'),
    IssuedAt: timestamp,
    IssuedBy: actor(user),
    IssuedByUsername: clean(user.username),
    UpdatedAt: timestamp
  });
  const journal = postedJournalPayload(buildImprestIssueJournal(payload, actor(user)), user);
  await validateImprestPosting(env, journal);
  payload.IssueJournalNo = journal.JournalNo;
  await commitFinanceDecision(env, [
    { collectionPath: 'accountingJournals', documentId: safeId(journal.JournalNo), data: journal, exists: false },
    {
      collectionPath: 'accountingImprests', documentId: safeId(existing.ImprestNo), data: payload,
      updateTime: documentVersion(existing)
    },
    auditWrite(user, 'ISSUE', 'Imprest', existing.ImprestNo, `${paymentAccount}: ${reference}`, timestamp, existing)
  ]);
  return { ok: true, message: 'Imprest issued and posted to the staff advance account.', imprest: payload };
}

async function submitImprestRetirement(env, user, body) {
  const existing = await findImprest(env, user, body);
  const access = capabilities(user);
  if (!same(existing.CustodianUsername || existing.RequestedByUsername, user.username) && !access.canAccountsReview) {
    const err = new Error('Only the imprest custodian or Accounts can submit this retirement.');
    err.status = 403;
    throw err;
  }
  if (lower(existing.Status) !== 'issued') {
    const err = new Error('Only an Issued imprest can be retired.');
    err.status = 409;
    throw err;
  }
  let retirement;
  try {
    retirement = validateImprestRetirement(existing.AmountIssued, body.lines || body.RetirementLines);
  } catch (error) {
    error.status = 400;
    throw error;
  }
  const returnReference = clean(body.returnReference || body.ReturnReference);
  if (retirement.returnedAmount > 0 && !returnReference) {
    const err = new Error('Enter the cash or bank return reference for the unused balance.');
    err.status = 400;
    throw err;
  }
  const timestamp = nowIso();
  const payload = removeFirestoreMetadata({
    ...existing,
    Status: 'Retirement Submitted',
    RetirementLines: retirement.lines,
    ExpenseTotal: retirement.expenseTotal,
    ReturnedAmount: retirement.returnedAmount,
    OutstandingAmount: amount(existing.AmountIssued),
    ReturnReference: returnReference,
    RetirementNotes: clean(body.notes || body.RetirementNotes),
    RetirementSubmittedAt: timestamp,
    RetirementSubmittedBy: actor(user),
    RetirementSubmittedByUsername: clean(user.username),
    UpdatedAt: timestamp
  });
  await commitFinanceDecision(env, [
    {
      collectionPath: 'accountingImprests', documentId: safeId(existing.ImprestNo), data: payload,
      updateTime: documentVersion(existing)
    },
    auditWrite(user, 'SUBMIT RETIREMENT', 'Imprest', existing.ImprestNo, `${retirement.lines.length} receipt(s); expenses ${retirement.expenseTotal}; return ${retirement.returnedAmount}`, timestamp, existing)
  ]);
  return { ok: true, message: 'Imprest retirement submitted to Accounts for verification.', imprest: payload };
}

async function reviewImprestRetirement(env, user, body, request) {
  if (!capabilities(user).canAccountsReview) {
    const err = new Error('Only Accounts or Super Admin can verify an imprest retirement.');
    err.status = 403;
    throw err;
  }
  const existing = await findImprest(env, user, body);
  if (lower(existing.Status) !== 'retirement submitted') {
    const err = new Error('Only a submitted imprest retirement can be reviewed.');
    err.status = 409;
    throw err;
  }
  const decision = clean(body.decision || 'Verified');
  const timestamp = nowIso();
  if (decision === 'Returned for Correction') {
    const notes = clean(body.notes);
    if (!notes) {
      const err = new Error('Explain what the custodian must correct.');
      err.status = 400;
      throw err;
    }
    const payload = removeFirestoreMetadata({
      ...existing,
      Status: 'Issued',
      RetirementReviewNotes: notes,
      RetirementReturnedAt: timestamp,
      RetirementReturnedBy: actor(user),
      UpdatedAt: timestamp
    });
    await commitFinanceDecision(env, [
      {
        collectionPath: 'accountingImprests', documentId: safeId(existing.ImprestNo), data: payload,
        updateTime: documentVersion(existing)
      },
      auditWrite(user, 'RETURN RETIREMENT', 'Imprest', existing.ImprestNo, notes, timestamp, existing)
    ]);
    return { ok: true, message: 'Retirement returned to the custodian for correction.', imprest: payload };
  }
  await requireDecisionAuthorization(env, user, body, request, 'imprest:verify');
  await ensureImprestAdvanceAccount(env);
  const journal = postedJournalPayload(buildImprestRetirementJournal({
    ...existing,
    RetirementDate: validIsoDate(body.retirementDate || body.RetirementDate || dateToday(), 'retirement date')
  }, actor(user)), user);
  await validateImprestPosting(env, journal);
  const payload = removeFirestoreMetadata({
    ...existing,
    Status: 'Retired',
    OutstandingAmount: 0,
    RetirementDate: journal.Date,
    RetirementJournalNo: journal.JournalNo,
    RetirementReviewNotes: clean(body.notes),
    RetiredAt: timestamp,
    RetiredBy: actor(user),
    RetiredByUsername: clean(user.username),
    UpdatedAt: timestamp
  });
  await commitFinanceDecision(env, [
    { collectionPath: 'accountingJournals', documentId: safeId(journal.JournalNo), data: journal, exists: false },
    {
      collectionPath: 'accountingImprests', documentId: safeId(existing.ImprestNo), data: payload,
      updateTime: documentVersion(existing)
    },
    { collectionPath: 'accountingImprestOpenClaims', documentId: imprestOpenClaimId(existing), operation: 'delete' },
    auditWrite(user, 'VERIFY RETIREMENT', 'Imprest', existing.ImprestNo, clean(body.notes), timestamp, existing)
  ]);
  return { ok: true, message: 'Imprest fully retired and posted to the expense accounts.', imprest: payload };
}

function endorsementId(recordId, stage) {
  return safeId(`${recordId}-${stage}`);
}

async function buildEndorsement(env, user, body, recordId, stage) {
  const applySignature = body.applySignature === true;
  const applyStamp = body.applyStamp === true;
  if (!applySignature && !applyStamp) return null;
  const profile = publicStaffApprovalProfile(await loadStaffApprovalProfile(env, user.username) || {});
  if (applySignature && !profile.SignatureDataUrl) {
    const err = new Error('Save a signature in User Settings before applying it.');
    err.status = 400;
    throw err;
  }
  if (applyStamp && !profile.StampDataUrl) {
    const err = new Error('Save a stamp in User Settings before applying it.');
    err.status = 400;
    throw err;
  }
  return {
    RecordId: clean(recordId),
    Stage: stage,
    AppliedBy: actor(user),
    AppliedByUsername: clean(user.username),
    AppliedAt: nowIso(),
    SignatureDataUrl: applySignature ? profile.SignatureDataUrl : '',
    StampDataUrl: applyStamp ? profile.StampDataUrl : ''
  };
}

async function documentRecord(env, user, body) {
  const isBill = lower(body.recordType) === 'bill';
  const collection = isBill ? 'accountingSupplierBills' : 'accountingExpenses';
  const idField = isBill ? 'BillNo' : 'ExpenseNo';
  const id = clean(body.recordId);
  const direct = await getDocument(env, collection, safeId(id));
  const existing = direct || (await listCollection(env, collection))
    .find((row) => same(row[idField], id) || same(row.__id, safeId(id)));
  if (!existing || !scopedRows([existing], user, capabilities(user)).length) {
    const err = new Error('The selected finance document was not found.');
    err.status = 404;
    throw err;
  }
  const [approvalEndorsement, adminEndorsement, accountsEndorsement] = await Promise.all([
    getDocument(env, 'financeDocumentEndorsements', endorsementId(id, 'approval')),
    getDocument(env, 'financeDocumentEndorsements', endorsementId(id, 'admin')),
    getDocument(env, 'financeDocumentEndorsements', endorsementId(id, 'accounts'))
  ]);
  return {
    ok: true,
    record: publicRows([existing])[0],
    endorsements: {
      approval: approvalEndorsement || null,
      admin: adminEndorsement || null,
      accounts: accountsEndorsement || null
    }
  };
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 1024 * 1024 });
    const action = lower(body.action || 'list');
    const mutationActions = new Set([
      'submitrequisition',
      'submitmaterialrequisition',
      'resubmitrequisition',
      'submitbill',
      'review',
      'accountsreview',
      'submitimprest',
      'reviewimprest',
      'issueimprest',
      'submitimprestretirement',
      'reviewimprestretirement'
    ]);
    if (mutationActions.has(action)) {
      idempotency = await beginIdempotentRequest(env, request, body, {
        scope: `finance-${action}`,
        actor: clean(user.username),
        ttlMinutes: 30 * 24 * 60
      });
      if (idempotency.replay) {
        return Response.json(idempotency.response, {
          status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
          headers: {
            'Cache-Control': 'no-store',
            'Idempotency-Replayed': 'true'
          }
        });
      }
    }
    let data;
    if (action === 'list') data = await listWorkflow(env, user);
    else if (action === 'submitrequisition') data = await submitRequisition(env, user, body);
    else if (action === 'submitmaterialrequisition') data = await submitMaterialRequisition(env, user, body);
    else if (action === 'resubmitrequisition') data = await resubmitRequisition(env, user, body);
    else if (action === 'submitbill') data = await submitBill(env, user, body);
    else if (action === 'review') data = await reviewRecord(env, user, body, request);
    else if (action === 'accountsreview') data = await accountsReview(env, user, body, request);
    else if (action === 'submitimprest') data = await submitImprest(env, user, body);
    else if (action === 'reviewimprest') data = await reviewImprest(env, user, body, request);
    else if (action === 'issueimprest') data = await issueImprest(env, user, body, request);
    else if (action === 'submitimprestretirement') data = await submitImprestRetirement(env, user, body);
    else if (action === 'reviewimprestretirement') data = await reviewImprestRetirement(env, user, body, request);
    else if (action === 'document') data = await documentRecord(env, user, body);
    else {
      const err = new Error('Unknown finance workflow action.');
      err.status = 400;
      throw err;
    }
    const headers = { 'Cache-Control': 'no-store' };
    if (['review', 'accountsreview', 'reviewimprest', 'issueimprest', 'reviewimprestretirement'].includes(action)) {
      headers['Set-Cookie'] = clearStaffApprovalProofCookie();
    }
    if (mutationActions.has(action)) await completeIdempotentRequest(env, idempotency, data, 200);
    return Response.json(data, { headers });
  } catch (err) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, err);
    return Response.json({ ok: false, message: err.message || String(err) }, {
      status: err.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
