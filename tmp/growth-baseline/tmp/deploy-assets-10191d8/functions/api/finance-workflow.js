import { listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';

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

function safeId(value) {
  return clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
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

async function writeAudit(env, user, action, recordType, recordId, details = '') {
  const id = requestNumber('WEB-AUDIT');
  await upsertDocument(env, 'accountingAudit', safeId(id), {
    AuditId: id,
    Timestamp: nowIso(),
    Action: action,
    RecordType: recordType,
    RecordId: recordId,
    Details: clean(details),
    User: actor(user),
    UserRole: user.role,
    Department: userDepartment(user),
    BranchId: clean(user.branchId) || 'main',
    SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary'),
    SourcePlatform: 'Web'
  });
}

async function listWorkflow(env, user) {
  const access = capabilities(user);
  const [requests, bills] = await Promise.all([
    listCollection(env, 'accountingExpenses'),
    listCollection(env, 'accountingSupplierBills')
  ]);
  const sortRecent = (rows) => [...rows].sort((a, b) => clean(b.UpdatedAt || b.CreatedAt || b.Date).localeCompare(clean(a.UpdatedAt || a.CreatedAt || a.Date)));
  return {
    ok: true,
    message: 'Department finance workflow loaded.',
    department: userDepartment(user),
    capabilities: access,
    requisitions: publicRows(sortRecent(scopedRows(requests, user, access))).slice(0, 150),
    bills: publicRows(sortRecent(scopedRows(bills, user, access))).slice(0, 150)
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
  if (!description || value <= 0) {
    const err = new Error('Description and an amount greater than zero are required.');
    err.status = 400;
    throw err;
  }
  const expenseNo = requestNumber('WEB-REQ');
  const payload = {
    ExpenseNo: expenseNo,
    Date: clean(body.date || body.Date) || dateToday(),
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
    RequestedBy: actor(user),
    RequestedAt: nowIso(),
    CreatedAt: nowIso(),
    UpdatedAt: nowIso(),
    SourcePlatform: 'Web'
    ,BranchId: clean(user.branchId) || 'main'
    ,SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary')
  };
  await upsertDocument(env, 'accountingExpenses', safeId(expenseNo), payload);
  await writeAudit(env, user, 'CREATE', 'Expense Requisition', expenseNo, `${department}: ${description}`);
  return { ok: true, message: 'Requisition submitted for approval.', requisition: payload };
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
    CreatedAt: nowIso(),
    CreatedBy: actor(user),
    UpdatedAt: nowIso(),
    SourcePlatform: 'Web'
    ,BranchId: clean(user.branchId) || 'main'
    ,SchoolSection: clean(user.schoolSectionAccess) === 'All' ? 'Secondary' : clean(user.schoolSectionAccess || 'Secondary')
  };
  await upsertDocument(env, 'accountingSupplierBills', safeId(billNo), payload);
  await writeAudit(env, user, 'CREATE', 'Supplier Bill', billNo, `${department}: ${description}`);
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

async function reviewRecord(env, user, body) {
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
  const rows = await listCollection(env, collection);
  const existing = rows.find((row) => same(row[idField], id) || same(row.__id, safeId(id)));
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
  const timestamp = nowIso();
  const payload = {
    ...existing,
    Status: decision,
    ReviewNotes: clean(body.notes),
    UpdatedAt: timestamp,
    ...(decision === 'Approved'
      ? { ApprovedAt: existing.ApprovedAt || timestamp, ApprovedBy: existing.ApprovedBy || actor(user), AdminReviewedAt: user.role === 'Super Admin' ? timestamp : '', AdminReviewedBy: user.role === 'Super Admin' ? actor(user) : '', RejectedAt: '', RejectedBy: '' }
      : { RejectedAt: timestamp, RejectedBy: actor(user), ApprovedAt: '', ApprovedBy: '' })
  };
  delete payload.__id;
  delete payload.__name;
  await upsertDocument(env, collection, safeId(id), payload);
  await writeAudit(env, user, decision.toUpperCase(), isBill ? 'Supplier Bill' : 'Expense Requisition', id, clean(body.notes));
  return { ok: true, message: `${isBill ? 'Supplier bill' : 'Requisition'} ${decision.toLowerCase()}.`, record: payload };
}

async function accountsReview(env, user, body) {
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
  const existing = (await listCollection(env, collection)).find((row) => same(row[idField], id) || same(row.__id, safeId(id)));
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
  const payload = {
    ...existing,
    AccountsReviewStatus: 'Reviewed',
    AccountsReviewedBy: actor(user),
    AccountsReviewedAt: nowIso(),
    AccountsReviewNotes: clean(body.notes),
    UpdatedAt: nowIso()
  };
  delete payload.__id;
  delete payload.__name;
  await upsertDocument(env, collection, safeId(id), payload);
  await writeAudit(env, user, 'ACCOUNTS REVIEW', isBill ? 'Supplier Bill' : 'Expense Requisition', id, clean(body.notes));
  return { ok: true, message: 'Marked as reviewed by Accounts. Post or pay it from the desktop Finance & Accounting tab.', record: payload };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await request.json().catch(() => ({}));
    const action = lower(body.action || 'list');
    let data;
    if (action === 'list') data = await listWorkflow(env, user);
    else if (action === 'submitrequisition') data = await submitRequisition(env, user, body);
    else if (action === 'submitbill') data = await submitBill(env, user, body);
    else if (action === 'review') data = await reviewRecord(env, user, body);
    else if (action === 'accountsreview') data = await accountsReview(env, user, body);
    else {
      const err = new Error('Unknown finance workflow action.');
      err.status = 400;
      throw err;
    }
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({ ok: false, message: err.message || String(err) }, {
      status: err.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
