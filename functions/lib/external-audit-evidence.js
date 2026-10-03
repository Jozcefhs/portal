import { getDocument, queryCollection, queryCollectionPages } from './firestore.js';
import { recordBranchId } from './branch-scope.js';
import { churchCollectionPath } from './church-foundation.js';
import { externalAuditDate, externalAuditNextDate } from './external-audit.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const words = (value) => clean(value).replace(/([a-z])([A-Z])/g, '$1 $2');
export const AUDIT_PAGE_SIZE = 100;

export function auditError(message, status = 400) {
  const error = new Error(message); error.status = status; return error;
}

// An explicit finance-only projection: credentials, personnel medical records,
// payment gateway responses and private storage URLs never leave this API.
const FIELDS = (`JournalNo Date Status Description Narration Source SourceType SourceId Reference BranchId
  Amount GrossAmount GatewayFee NetAmount FeeCode FeeName FeeCategory ClassName TotalAmount TotalDebit TotalCredit OriginalAmount OriginalCurrency TransactionCurrency BaseCurrency
  BaseAmount ExchangeRate ExchangeRateDate ExchangeRateSource Currency Department CostCentre
  AccountCode AccountName ExpenseAccount PaymentAccount Debit Credit Balance BalanceAmount PaidAmount
  InvoiceId InvoiceReference PaymentId PaymentNo ExpenseNo BillNo VendorId VendorName Vendor
  AdmissionNo StudentName AccountRef ReceiptNo PaymentReference GatewayReference Gateway Method PaymentMethod
  DueDate AcademicSession Term Code Name Type Group NormalBalance Active BankId BankName AccountNumber
  OpeningBalance ReconciliationNo StatementDate StatementBalance BookBalance OutstandingDeposits
  UnpresentedPayments ChargesAndAdjustments AdjustedStatementBalance AdjustedBookBalance Difference
  StatementItemId MatchStatus MatchedJournalNo MatchedReference StatementReference ValueDate
  ImprestNo ImprestType Purpose AmountRequested AmountApproved AmountIssued AmountRetired AmountReturned
  OutstandingAmount CustodianUsername CustodianName RequestedBy RequestedByUsername RequestedAt
  AccountsConfirmedBy AccountsConfirmedByUsername AccountsConfirmedAt AccountsConfirmationNotes
  AccountsReviewedBy AccountsReviewedAt AccountsReviewNotes AdminStageReviewedBy AdminStageReviewedAt
  ManagementAuthorizedBy ManagementAuthorizedAt ManagementAuthorizationNotes ApprovedBy ApprovedAt
  AuthorizedBy AuthorizedAt IssuedBy IssuedAt RetiredBy RetiredAt ClosedBy ClosedAt
  PostedBy PostedAt PaidBy PaidAt RejectedBy RejectedAt RejectionNotes RejectionReason
  ProcessingStatus ProcessingStartedAt CompletedAt InvoicePostingStatus InvoicePostingWarning ChargeId GrossCollection NetSettlement Treatment
  CreatedBy CreatedAt UpdatedBy UpdatedAt RecordedBy RecordedAt Notes
  RunId ItemId EmployeeId Username DisplayName PayDate Period Month Year GrossPay NetPay BasicSalary
  TotalGross TotalNet TotalDeductions TotalTax TotalPaye PAYE Tax Pension EmployeePension EmployerPension
  Deductions Allowances AllowanceTotal Overtime LoanRepayment PaymentStatus SubmittedBy SubmittedAt FinalizedBy FinalizedAt
  PensionAmount NhfAmount TaxAmount CalculatedPaye FinalPaye TaxableEarnings OtherDeductionTotal GeneratedBy GeneratedAt
  AssetId AcquisitionDate AcquisitionCost Cost ResidualValue UsefulLife DepreciationMethod AccumulatedDepreciation
  NetBookValue Location DisposalDate DisposalAmount BudgetCode StartDate EndDate BudgetAmount
  AdjustmentNo OfferingId DonationId FundId FundName GivingTypeId GivingTypeName RevenueAccountCode
  ApprovalStatus AccountingStatus Restricted Restriction PurposeName DonorName SettlementBatchId
  ItemName ItemCode StoreType Price Category Unit Quantity ReorderLevel LastUpdated MovementId MovementNo MovementType UnitCost UnitPrice Reason OrderNo
  EvidenceId Title EvidenceCategory DocumentDate PeriodFrom PeriodTo FileName MimeType UploadedBy UploadedAt
  RelatedRegister RelatedRecordId RelatedParty Relationship TaxId PaymentTermsDays`).split(/\s+/).filter(Boolean);
const LINE_FIELDS = (`AccountCode Description Department CostCentre Debit Credit Amount Quantity Unit UnitPrice
  ItemName ItemId ExpenseAccount Date Reference ReceiptNo AmountSpent Category Code Name
  ComponentCode ComponentName FeeCode FeeName FeeCategory Type Value Rate BaseAmount Taxable AmountReturned`).split(/\s+/);

function definition(label, collection, references, dates = ['Date'], extra = {}) {
  return Object.freeze({ label, collection, references, dates, ...extra });
}

export const AUDIT_REGISTERS = Object.freeze({
  journals: definition('Financial journals', 'accountingJournals', ['JournalNo']),
  expenses: definition('Requisitions & expenditure', 'accountingExpenses', ['ExpenseNo']),
  supplierBills: definition('Supplier invoices & payables', 'accountingSupplierBills', ['BillNo', 'InvoiceReference']),
  supplierPayments: definition('Supplier payments', 'accountingSupplierPayments', ['PaymentNo']),
  imprests: definition('Imprests & advances', 'accountingImprests', ['ImprestNo']),
  invoices: definition('Invoices & receivables', 'invoices', ['InvoiceId', 'Reference'], ['Date', 'InvoiceDate', 'CreatedAt']),
  payments: definition('Payments & receipts (one payment per reference)', 'payments', ['Reference', 'GatewayReference', 'PaymentId'], ['Date', 'PaidAt', 'paidAt', 'PaymentDate', 'CreatedAt']),
  formSales: definition('Admission form collections', 'formSales', ['ReceiptNo', 'PaymentReference'], ['Date', 'CreatedAt']),
  gatewayCharges: definition('Payment provider charges', 'paymentGatewayCharges', ['ChargeId', 'Reference'], ['Date', 'CreatedAt']),
  banks: definition('Bank & cash accounts', 'accountingBanks', ['BankId'], [], { snapshot: true }),
  reconciliations: definition('Bank reconciliations', 'accountingReconciliations', ['ReconciliationNo'], ['StatementDate']),
  statementItems: definition('Bank statement transactions', 'accountingBankStatementItems', ['StatementItemId'], ['Date', 'ValueDate', 'StatementDate']),
  payrollRuns: definition('Payroll runs & authorisations', 'payrollRuns', ['RunId'], ['PayDate', 'Date', 'CreatedAt']),
  payrollItems: definition('Employee payroll calculations', 'payrollItems', ['ItemId'], ['PayDate', 'Date', '__auditParentDate']),
  payrollPayments: definition('Salary payments', 'payrollPayments', ['PaymentNo']),
  assets: definition('Fixed assets & depreciation', 'accountingAssets', ['AssetId'], [], { snapshot: true }),
  budgets: definition('Budgets & allocations', 'accountingBudgets', ['BudgetCode'], [], { snapshot: true }),
  adjustments: definition('Accruals & adjustments', 'accountingAdjustments', ['AdjustmentNo']),
  vendors: definition('Suppliers & related-party review', 'accountingVendors', ['VendorId'], [], { snapshot: true }),
  chart: definition('Chart of accounts', 'chartOfAccounts', ['Code'], [], { snapshot: true, global: true }),
  periods: definition('Accounting periods', 'accountingPeriods', ['PeriodId'], [], { snapshot: true, global: true }),
  offerings: definition('Offerings & collection approvals', 'churchOfferings', ['OfferingId'], ['Date'], { church: true }),
  donations: definition('Donations & grants', 'churchDonations', ['DonationId', 'Reference'], ['Date', 'CreatedAt'], { church: true }),
  funds: definition('Restricted funds & projects', 'churchFunds', ['FundId'], [], { church: true, snapshot: true }),
  fundMappings: definition('Fund account allocations', 'churchFundMappings', ['MappingId', 'FundId'], [], { church: true, snapshot: true }),
  inventory: definition('Store inventory', 'storeItems', ['ItemId', 'ItemName'], [], { snapshot: true }),
  clinicInventory: definition('Medical supply inventory (no patient records)', 'clinicInventory', ['ItemName'], [], { snapshot: true }),
  clinicMovements: definition('Medical supply stock movements', 'clinicMovements', ['MovementNo']),
  kitchenInventory: definition('Kitchen inventory', 'kitchenInventory', ['ItemName'], [], { snapshot: true }),
  kitchenMovements: definition('Kitchen stock movements', 'kitchenMovements', ['MovementNo']),
  storeOrders: definition('Store sales & orders', 'storeOrders', ['OrderNo', 'ReceiptNo'], ['Date', 'CreatedAt']),
  evidence: definition('Supporting documents & governance', 'financialAuditEvidence', ['EvidenceId'], ['DocumentDate'])
});

export const AUDIT_DOCUMENT_CATEGORIES = Object.freeze([
  'Financial statement', 'Opening balance support', 'Bank statement', 'Payment confirmation',
  'Invoice or receipt', 'Purchase order', 'Delivery or stock count', 'Payroll authorisation',
  'Tax return or remittance', 'Asset ownership or valuation', 'Grant or donation agreement',
  'Contract', 'Governance minutes', 'Related-party declaration', 'Other financial evidence'
]);

export function auditRegister(name) {
  const value = Object.hasOwn(AUDIT_REGISTERS, clean(name)) ? AUDIT_REGISTERS[clean(name)] : null;
  if (!value) throw auditError('Choose a valid audit register.');
  return value;
}

export function auditCollection(name, scope) {
  const entry = auditRegister(name);
  if (!entry.church) return entry.collection;
  if (lower(scope.branchId) === 'all') throw auditError('Select a working branch to inspect its offerings, donations and funds.');
  return churchCollectionPath(entry.collection, scope.branchId);
}

export function auditRecordDate(row, entry) {
  for (const field of entry.dates) {
    const date = externalAuditDate(clean(row[field]).slice(0, 10));
    if (date) return date;
  }
  return '';
}

export function auditRecordVisible(row, entry, scope) {
  if (!row || (!entry.global && lower(scope.branchId) !== 'all' && recordBranchId(row) !== lower(scope.branchId))) return false;
  if (entry.snapshot) return true;
  const date = auditRecordDate(row, entry);
  return Boolean(date && date >= scope.dateFrom && date <= scope.dateTo);
}

function projectFields(row, fields) {
  return Object.fromEntries(fields.flatMap((key) => {
    const value = row?.[key] ?? row?.[key.charAt(0).toLowerCase() + key.slice(1)];
    return ['string', 'number', 'boolean'].includes(typeof value) ? [[key, value]] : [];
  }));
}

export function auditAttachments(row) {
  const result = [];
  for (const field of ['AttachmentUrl', 'DocumentUrl', 'ReceiptUrl', 'InvoiceUrl', 'StatementUrl', 'PaymentProofUrl']) {
    if (clean(row[field])) result.push({ label: words(field.replace(/Url$/, '')), reference: clean(row[field]) });
  }
  for (const [index, line] of (Array.isArray(row.RetirementLines) ? row.RetirementLines : []).entries()) {
    if (clean(line.ReceiptUrl)) result.push({ label: `Retirement receipt ${index + 1}`, reference: clean(line.ReceiptUrl) });
  }
  return result;
}

export function auditRecordProjection(row, register) {
  const entry = auditRegister(register);
  const fields = projectFields(row, FIELDS);
  for (const key of ['Lines', 'RetirementLines', 'Deductions', 'Allowances', 'FeeItems']) {
    let lines = row[key];
    if (typeof lines === 'string') { try { lines = JSON.parse(lines); } catch { lines = null; } }
    if (Array.isArray(lines)) {
      if (lines.length > 1000) throw auditError('A record exceeds 1,000 detail lines. Request a separate evidence package; no partial record was exported.', 413);
      fields[key] = lines.map((line) => projectFields(line, LINE_FIELDS));
    }
  }
  return {
    register, id: clean(row.__id), reference: clean(entry.references.map((key) => fields[key]).find(Boolean) || row.__id),
    date: auditRecordDate(row, entry), label: clean(fields.Description || fields.Purpose || fields.Title || fields.Name || fields.DisplayName || fields.StudentName || fields.ItemName),
    status: clean(fields.Status || fields.PaymentStatus || fields.Active), branchId: entry.global ? 'Organisation-wide configuration' : recordBranchId(row),
    fields, attachments: auditAttachments(row).map((item, index) => ({ index, label: item.label, available: item.reference.startsWith('r2://dynamax-documents/') })),
    snapshot: entry.snapshot === true
  };
}

async function hydrateAuditDates(env, register, rows, readTime = '') {
  if (register !== 'payrollItems') return rows;
  const dates = new Map();
  for (const row of rows) {
    const runId = clean(row.RunId);
    if (!runId) continue;
    const dateKey = `${recordBranchId(row)}/${runId}`;
    if (!dates.has(dateKey)) {
      const parents = await queryCollection(env, 'payrollRuns', { filters: [{ field: 'RunId', op: '==', value: runId }], limit: 2, ...(readTime ? { readTime } : {}) });
      dates.set(dateKey, parents.find((run) => recordBranchId(run) === recordBranchId(row))?.PayDate || '');
    }
    row.__auditParentDate = dates.get(dateKey);
  }
  return rows;
}

function safeRecordId(value) {
  const id = clean(value);
  if (!id || id.length > 180 || /[\/\\?#\[\]]/.test(id) || ['.', '..'].includes(id)) throw auditError('Choose a valid audit record.');
  return id;
}

export function auditRegisterCursor(env, cursor, collection) {
  if (!cursor) return null;
  const name = clean(cursor.name);
  const prefix = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/`;
  if (!name.startsWith(prefix) || !name.slice(prefix.length) || name.slice(prefix.length).includes('/')) throw auditError('The register cursor is invalid. Refresh the register.');
  return { name };
}

export async function listAuditRecords(env, scope, input) {
  const register = clean(input.register || 'expenses');
  const entry = auditRegister(register);
  const collection = auditCollection(register, scope);
  const cursor = auditRegisterCursor(env, input.recordCursor, collection);
  const rows = await queryCollection(env, collection, {
    orderBy: [{ field: '__name__' }], limit: AUDIT_PAGE_SIZE + 1,
    ...(cursor ? { startAfterName: cursor.name } : {})
  });
  const page = await hydrateAuditDates(env, register, rows.slice(0, AUDIT_PAGE_SIZE));
  return { ok: true, scope, register, label: entry.label,
    records: page.filter((row) => auditRecordVisible(row, entry, scope)).map((row) => auditRecordProjection(row, register)),
    nextCursor: rows.length > AUDIT_PAGE_SIZE && page.at(-1) ? { name: page.at(-1).__name } : null,
    scanned: page.length, snapshot: entry.snapshot === true,
    note: entry.snapshot ? 'Current master register. Values are not a historical snapshot of the selected period.' : 'Period records. Continue through all pages to inspect the complete register.' };
}

export async function getAuditRecord(env, scope, register, id) {
  const entry = auditRegister(register);
  const row = await getDocument(env, auditCollection(register, scope), safeRecordId(id));
  if (row) await hydrateAuditDates(env, register, [row]);
  if (!auditRecordVisible(row, entry, scope)) throw auditError('The audit record was not found within your dates and branch.', 404);
  return row;
}

export async function auditLookup(env, scope, register, field, value) {
  if (!clean(value)) return [];
  const entry = auditRegister(register);
  const rows = await queryCollection(env, auditCollection(register, scope), { filters: [{ field, op: '==', value: clean(value) }], limit: 101 });
  await hydrateAuditDates(env, register, rows);
  return rows.filter((row) => auditRecordVisible(row, entry, scope));
}

const SOURCE_REGISTERS = Object.freeze({
  'supplier bill': 'supplierBills', 'supplier payment': 'supplierPayments',
  payroll: 'payrollRuns', 'salary payment': 'payrollPayments', 'asset acquisition': 'assets', depreciation: 'assets',
  'church offering': 'offerings', 'church donation': 'donations', 'fee payment': 'payments',
  'student invoice': 'invoices', 'student invoice credit': 'invoices', 'admission form sale': 'formSales',
  'paystack admission form': 'formSales', 'expense': 'expenses', 'expense requisition': 'expenses',
  'material requisition': 'expenses', 'imprest issue': 'imprests', 'imprest retirement': 'imprests'
});

export async function auditRecordEvidence(env, scope, register, id) {
  const row = await getAuditRecord(env, scope, register, id);
  const record = auditRecordProjection(row, register);
  const related = new Map();
  const warnings = [];
  const add = async (target, field, value) => {
    if (!clean(value)) return;
    if (auditRegister(target).church && lower(scope.branchId) === 'all') { warnings.push('Select the journal’s branch to inspect its offering or donation source.'); return; }
    const matches = await auditLookup(env, scope, target, field, value);
    if (matches.length > 100) warnings.push(`${auditRegister(target).label}: more than 100 related records. Inspect the complete register.`);
    for (const match of matches.slice(0, 100)) related.set(`${target}/${match.__id}`, auditRecordProjection(match, target));
  };
  if (register === 'journals') {
    const sourceRegister = SOURCE_REGISTERS[lower(row.SourceType || row.Source)]
      || (lower(row.Source || '').includes('requisition') ? 'expenses' : lower(row.Source || '').includes('imprest') ? 'imprests' : '');
    if (sourceRegister && clean(row.SourceId || row.Reference)) {
      for (const field of auditRegister(sourceRegister).references) await add(sourceRegister, field, row.SourceId || row.Reference);
    }
    // JournalNo links cover historic records with inconsistent Source/SourceId.
    for (const target of ['expenses', 'supplierBills', 'supplierPayments', 'imprests', 'payrollRuns', 'payrollPayments', 'adjustments']) await add(target, 'JournalNo', row.JournalNo);
  } else {
    await add('journals', 'JournalNo', row.JournalNo);
  }
  for (const item of [record, ...related.values()]) {
    const source = item.fields;
    if (item.register === 'supplierBills') await add('supplierPayments', 'BillNo', source.BillNo);
    if (item.register === 'supplierPayments') await add('supplierBills', 'BillNo', source.BillNo);
    if (item.register === 'payrollRuns') {
      await add('payrollItems', 'RunId', source.RunId);
      await add('payrollPayments', 'RunId', source.RunId);
    }
    if (source.VendorId) await add('vendors', 'VendorId', source.VendorId);
    if (item.register === 'payments') {
      await add('journals', 'SourceId', source.Reference || source.GatewayReference || source.PaymentId);
      await add('invoices', 'AccountRef', source.AccountRef);
    }
    await add('evidence', 'RelatedRecordId', item.id);
    if (item.reference !== item.id) await add('evidence', 'RelatedRecordId', item.reference);
  }
  // Only financial audit entries for the selected record, and only inside scope.
  const auditTrail = [];
  for (const collection of ['accountingAudit', 'payrollAudit']) {
    for (const reference of [...new Set([record.reference, record.fields.SourceId, ...[...related.values()].map((item) => item.reference)].filter(Boolean))].slice(0, 12)) {
      const events = await queryCollection(env, collection, { filters: [{ field: 'RecordId', op: '==', value: reference }], limit: 101 });
      if (events.length > 100) warnings.push('The record history exceeds 100 events; some events are not shown.');
      for (const event of events.slice(0, 100)) {
        const date = clean(event.Timestamp).slice(0, 10);
        if (date >= scope.dateFrom && date <= scope.dateTo && (lower(scope.branchId) === 'all' || recordBranchId(event) === lower(scope.branchId))) {
          auditTrail.push(projectFields(event, ['Timestamp', 'Action', 'RecordType', 'RecordId', 'Details', 'User', 'UserRole', 'ActorUsername', 'BranchId']));
        }
      }
    }
  }
  return { ok: true, scope, record, related: [...related.values()].filter((item) => `${item.register}/${item.id}` !== `${register}/${record.id}`
      && (item.register !== 'evidence' || !item.fields.RelatedRegister || item.fields.RelatedRegister === register || [...related.values()].some((target) => target.register === item.fields.RelatedRegister && [target.id, target.reference].includes(item.fields.RelatedRecordId)))),
    auditTrail: auditTrail.sort((a, b) => clean(a.Timestamp).localeCompare(clean(b.Timestamp))), warnings,
    gaps: register === 'journals' && !related.size ? ['No linked source transaction was found. Request supporting evidence from management.'] : [] };
}

// Each request is bounded, but a complete export is not limited to an arbitrary
// number of transactions. A shared read time prevents edits between batches
// from duplicating/skipping records or changing opening balances mid-report.
function auditReadTime(input) {
  if (input.batchCursor && !input.readTime) throw auditError('The audit snapshot is missing. Restart the report.');
  if (!input.readTime) return new Date(Date.now() - 1000).toISOString();
  const value = clean(input.readTime);
  const timestamp = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value
    || timestamp > Date.now() || timestamp < Date.now() - 55 * 60 * 1000) {
    throw auditError('The audit snapshot has expired or is invalid. Restart the report.');
  }
  return value;
}

async function auditBatch(env, collection, input, options = {}, size = 500) {
  const readTime = auditReadTime(input);
  const cursor = auditRegisterCursor(env, input.batchCursor, collection);
  const orderedDate = options.filters?.some((filter) => filter.field === 'Date');
  if (cursor && orderedDate && !externalAuditDate(clean(input.batchCursor.date).slice(0, 10))) {
    throw auditError('The audit date cursor is invalid. Restart the report.');
  }
  const rows = await queryCollection(env, collection, {
    ...options, readTime, limit: size + 1,
    orderBy: orderedDate ? [{ field: 'Date' }, { field: '__name__' }] : [{ field: '__name__' }],
    ...(cursor ? { startAfterName: cursor.name, ...(orderedDate ? { startAfterFieldValue: input.batchCursor.date } : {}) } : {})
  });
  const page = rows.slice(0, size);
  const last = page.at(-1);
  const nextCursor = rows.length > size ? { name: clean(last?.__name), ...(orderedDate ? { date: last.Date } : {}) } : null;
  if (nextCursor) {
    auditRegisterCursor(env, nextCursor, collection);
    if (nextCursor.name === cursor?.name) throw auditError('The audit cursor stalled. Restart the report.', 409);
  }
  return { rows: page, readTime, scanned: page.length, nextCursor, done: !nextCursor, paged: true, complete: false };
}

export async function exportAuditRegister(env, scope, register, input = {}) {
  const entry = auditRegister(register);
  const options = register === 'journals' ? { cursorField: 'Date', filters: [
    { field: 'Date', op: '>=', value: scope.dateFrom }, { field: 'Date', op: '<', value: externalAuditNextDate(scope.dateTo) }
  ] } : {};
  if (input.paged === true) {
    const batch = await auditBatch(env, auditCollection(register, scope), input, options, register === 'payrollItems' ? 100 : 500);
    await hydrateAuditDates(env, register, batch.rows, batch.readTime);
    const { rows, ...metadata } = batch;
    return { ok: true, scope, register, ...metadata,
      records: rows.filter((row) => auditRecordVisible(row, entry, scope)).map((row) => auditRecordProjection(row, register)) };
  }
  const readTime = new Date(Date.now() - 1000).toISOString();
  const rows = await queryCollectionPages(env, auditCollection(register, scope), { ...options, pageSize: 500, maxRows: 10000, readTime });
  await hydrateAuditDates(env, register, rows, readTime);
  return { ok: true, scope, register, complete: true, records: rows.filter((row) => auditRecordVisible(row, entry, scope)).map((row) => auditRecordProjection(row, register)) };
}

function cents(value) {
  const number = Number(String(value ?? 0).replace(/,/g, ''));
  if (!Number.isFinite(number)) throw auditError('A journal contains an invalid amount. Correct it before generating a report.', 409);
  const result = Math.round(number * 100);
  if (!Number.isSafeInteger(result)) throw auditError('A journal amount exceeds the supported precision.', 409);
  return result;
}

function sumCents(...values) {
  const result = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(result)) throw auditError('The ledger totals exceed the supported precision. No report was generated.', 409);
  return result;
}

export function buildAuditPeriodReports(chart, journals, scope) {
  const accounts = new Map(chart.map((row) => [clean(row.Code || row.__id), { code: clean(row.Code || row.__id), name: clean(row.Name), type: clean(row.Type), group: clean(row.Group), opening: 0, debit: 0, credit: 0 }]));
  const warnings = new Set();
  let count = 0;
  for (const journal of journals) {
    if (lower(journal.Status) !== 'posted' || !auditRecordVisible(journal, { dates: ['Date'] }, { ...scope, dateFrom: '0001-01-01' })) continue;
    let lines = journal.Lines;
    if (typeof lines === 'string') { try { lines = JSON.parse(lines); } catch { lines = null; } }
    if (!Array.isArray(lines) || !lines.length) throw auditError('A posted journal has no valid account lines. Reports cannot be generated reliably.', 409);
    const prior = clean(journal.Date).slice(0, 10) < scope.dateFrom;
    let debit = 0; let credit = 0;
    for (const line of lines) {
      const code = clean(line.AccountCode);
      if (!code) throw auditError('A posted journal has an account line without an account code.', 409);
      if (!accounts.has(code)) { accounts.set(code, { code, name: 'Unclassified account', type: 'Unclassified', group: '', opening: 0, debit: 0, credit: 0 }); warnings.add(`Account ${code} is missing from the chart of accounts.`); }
      const account = accounts.get(code);
      const dr = cents(line.Debit); const cr = cents(line.Credit);
      debit = sumCents(debit, dr); credit = sumCents(credit, cr);
      if (prior) account.opening = sumCents(account.opening, dr, -cr);
      else { account.debit = sumCents(account.debit, dr); account.credit = sumCents(account.credit, cr); }
    }
    if (debit !== credit) warnings.add(`Journal ${clean(journal.JournalNo || journal.__id)} does not balance.`);
    if (!prior) count += 1;
  }
  const trialBalance = [...accounts.values()].map((row) => ({ ...row, closing: sumCents(row.opening, row.debit, -row.credit) / 100,
    opening: row.opening / 100, debit: row.debit / 100, credit: row.credit / 100 })).sort((a, b) => a.code.localeCompare(b.code));
  const totals = { opening: 0, debit: 0, credit: 0, closing: 0, income: 0, expenditure: 0, assets: 0, liabilities: 0, equity: 0, unclosedEarnings: 0 };
  for (const row of trialBalance) {
    for (const key of ['opening', 'debit', 'credit', 'closing']) totals[key] = sumCents(totals[key], cents(row[key]));
    if (['revenue', 'income'].includes(lower(row.type))) { totals.income += cents(row.credit) - cents(row.debit); totals.unclosedEarnings -= cents(row.closing); }
    if (lower(row.type) === 'expense') { totals.expenditure += cents(row.debit) - cents(row.credit); totals.unclosedEarnings -= cents(row.closing); }
    if (lower(row.type) === 'asset') totals.assets += cents(row.closing);
    if (lower(row.type) === 'liability') totals.liabilities -= cents(row.closing);
    if (lower(row.type) === 'equity') totals.equity -= cents(row.closing);
  }
  for (const key of Object.keys(totals)) totals[key] /= 100;
  totals.surplus = (cents(totals.income) - cents(totals.expenditure)) / 100;
  totals.balanceSheetDifference = (cents(totals.assets) - cents(totals.liabilities) - cents(totals.equity) - cents(totals.unclosedEarnings)) / 100;
  return { trialBalance, totals, postedJournals: count, warnings: [...warnings], complete: true,
    note: 'Ledger-derived reports include every posted journal through the end date. Opening balances are aggregated from earlier posted journals. Master-register balances and bank opening settings are not added again. Classification uses the current chart of accounts.' };
}

export async function loadAuditPeriodReports(env, scope, input = {}) {
  if (input.paged === true) {
    const batch = await auditBatch(env, 'accountingJournals', input, {
      filters: [{ field: 'Date', op: '<', value: externalAuditNextDate(scope.dateTo) }]
    });
    const chart = await queryCollectionPages(env, 'chartOfAccounts', { pageSize: 500, maxRows: 5000, readTime: batch.readTime });
    const { rows, ...metadata } = batch;
    return { ok: true, scope, generatedAt: new Date().toISOString(), ...buildAuditPeriodReports(chart, rows, scope), ...metadata };
  }
  const readTime = new Date(Date.now() - 1000).toISOString();
  const [chart, journals] = await Promise.all([
    queryCollectionPages(env, 'chartOfAccounts', { pageSize: 500, maxRows: 5000, readTime }),
    queryCollectionPages(env, 'accountingJournals', { pageSize: 500, maxRows: 25000, cursorField: 'Date', readTime,
      filters: [{ field: 'Date', op: '<', value: externalAuditNextDate(scope.dateTo) }] })
  ]);
  return { ok: true, scope, readTime, generatedAt: new Date().toISOString(), ...buildAuditPeriodReports(chart, journals, scope) };
}
