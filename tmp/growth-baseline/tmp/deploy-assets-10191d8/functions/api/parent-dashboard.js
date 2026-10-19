// Cloudflare Pages Function: /api/parent-dashboard
// Parent-facing dashboard for child activity and wallet restrictions.

import { getPayableFees } from './backend.js';
import { getDocument, listCollection, queryCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { getSchoolDocumentById, querySchoolCollection, upsertSchoolDocument } from '../lib/school-scope.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';
import { createAdmissionPdf } from '../lib/admission-pdf.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function asMoneyNumber(value) {
  const number = Number(String(value ?? '0').replace(/,/g, ''));
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function safeDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return fallback;
}

function parseFlexibleDate(value) {
  const text = clean(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const year = Number(iso[1]);
    let month = Number(iso[2]);
    let day = Number(iso[3]);
    if (month > 12 && day <= 12) {
      [month, day] = [day, month];
    }
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date;
  }
  const slash = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDisplayDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = parseFlexibleDate(text);
  return date ? date.toISOString().slice(0, 10) : text;
}

function timestampMs(value) {
  const text = clean(value);
  if (!text) return 0;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.getTime();
  const dateOnly = new Date(`${text}T00:00:00`);
  return Number.isNaN(dateOnly.getTime()) ? 0 : dateOnly.getTime();
}

function sameText(left, right) {
  return lower(left) === lower(right);
}

function normalizeReferenceText(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizedPersonName(value) {
  return lower(value).split(/[^a-z0-9]+/).filter(Boolean).sort().join('|');
}

function referencesMatch(left, right) {
  const a = normalizeReferenceText(left);
  const b = normalizeReferenceText(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const leftParts = clean(left).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const rightParts = clean(right).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (leftParts.length >= 3 && rightParts.length >= 3) {
    const leftTail = leftParts[leftParts.length - 1];
    const rightTail = rightParts[rightParts.length - 1];
    const samePrefix = leftParts.slice(0, -1).join('|') === rightParts.slice(0, -1).join('|');
    if (samePrefix && String(Number(leftTail)) === String(Number(rightTail))) return true;
  }
  return false;
}

function anyKeyMatches(value, keys) {
  return keys.some((key) => sameText(value, key) || referencesMatch(value, key));
}

function anyExactKeyMatches(value, keys) {
  return keys.some((key) => sameText(value, key));
}

function referenceIdentityKey(value) {
  return lower(value).split(/[^a-z0-9]+/).filter(Boolean).map((part) => /^\d+$/.test(part) ? String(Number(part)) : part).join('|');
}

function financialKeys(child) {
  const primary = [pick(child, ['AccountRef', 'accountRef']), pick(child, ['AdmissionNo', 'admissionNo'])].map(clean).filter(Boolean);
  if (primary.length) return primary;
  return [pick(child, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id'])].map(clean).filter(Boolean);
}

function financialReferenceMatches(value, child) {
  const wanted = referenceIdentityKey(value);
  return Boolean(wanted && financialKeys(child).some((key) => referenceIdentityKey(key) === wanted));
}

function nowIso() {
  return new Date().toISOString();
}

function accountKeys(student) {
  return [
    pick(student, ['AccountRef', 'accountRef', '__id']),
    pick(student, ['AdmissionNo', 'admissionNo']),
    pick(student, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId'])
  ].map(clean).filter(Boolean);
}

function applicationKeys(application) {
  return [
    pick(application, ['ApplicationReference', 'applicationReference']),
    pick(application, ['ApplicationID', 'applicationId']),
    pick(application, ['AdmissionNo', 'admissionNo']),
    pick(application, ['__id'])
  ].map(clean).filter(Boolean);
}

function applicationMatchesChild(application, child) {
  const appKeys = applicationKeys(application);
  const childKeys = accountKeys(child);
  const applicationAdmission = pick(application, ['AdmissionNo', 'admissionNo']);
  const childAdmission = pick(child, ['AdmissionNo', 'admissionNo']);
  if (applicationAdmission && childAdmission && referenceIdentityKey(applicationAdmission) === referenceIdentityKey(childAdmission)) {
    return true;
  }

  const applicationName = formatPersonName(
    application,
    {},
    pick(application, ['ApplicantName', 'applicantName', 'DisplayName', 'displayName', 'Name', 'name'])
  );
  const childName = pick(child, ['DisplayName', 'displayName', 'ApplicantName', 'applicantName', 'Name', 'name']);
  const applicationEmail = lower(pick(application, ['VerificationEmail', 'verificationEmail', 'ParentEmail', 'parentEmail', 'Email', 'email']));
  const childEmail = lower(pick(child, ['ParentEmail', 'parentEmail', 'VerificationEmail', 'verificationEmail', 'Email', 'email']));
  const identityMatches = Boolean(applicationName && childName && applicationEmail && childEmail &&
    normalizedPersonName(applicationName) === normalizedPersonName(childName) &&
    applicationEmail === childEmail);
  if (identityMatches) return true;
  return child.SourceType === 'Application' && appKeys.some((appKey) => childKeys.some((childKey) => sameText(appKey, childKey) || referencesMatch(appKey, childKey)));
}

function studentLoginCode(student) {
  return clean(pick(student, [
    'ParentLoginCode',
    'parentLoginCode',
    'VerificationCode',
    'verificationCode',
    'LoginCode',
    'loginCode'
  ])).toUpperCase();
}

async function appsScriptAction(env, action, payload = {}) {
  if (!legacyGoogleDataEnabled(env)) return null;
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return null;
  try {
    if (action === 'getApplications') {
      const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
      url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);
      url.searchParams.set('action', action);
      const response = await fetch(url.toString());
      const text = await response.text();
      return JSON.parse(text);
    }
    const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: action,
        ...payload
      })
    });
    const text = await response.text();
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function uniqueRows(rows = []) {
  const unique = new Map();
  rows.filter(Boolean).forEach((row) => unique.set(clean(row.__name || row.__id) || JSON.stringify(row), row));
  return [...unique.values()];
}

function validatedIdentityScopePath(value, collection) {
  const path = clean(value).replace(/^\/+|\/+$/g, '');
  if (path === collection) return path;
  const pattern = new RegExp(`^schoolBranches/[^/]+/sections/(?:primary|secondary)/${collection}$`, 'i');
  return pattern.test(path) ? path : '';
}

async function getSelectedIdentityRow(env, collection, accountRef, scopePath = '') {
  const documentId = safeDocumentId(accountRef);
  if (!documentId) return null;
  const path = validatedIdentityScopePath(scopePath, collection);
  if (path) {
    const row = await getDocument(env, path, documentId).catch(() => null);
    if (row) return { ...row, __scopePath: path };
  }
  return getSchoolDocumentById(env, collection, documentId).catch(() => null);
}

async function querySchoolIdentity(env, collection, email, code) {
  // Load the complete family by its canonical parent email. The verification
  // code is still checked by assertParentAccess(), but it must not be used as
  // the family data filter because siblings legitimately have different
  // application codes.
  if (email) {
    const emailField = collection === 'applications' ? 'VerificationEmail' : 'ParentEmail';
    const familyRows = await querySchoolCollection(env, collection, {
      filters: [{ field: emailField, op: '==', value: email }]
    }).catch(() => []);
    if (familyRows.length) return uniqueRows(familyRows);
  }
  if (!code) return [];
  const codeFields = collection === 'applications' ? ['VerificationCode'] : ['ParentLoginCode', 'VerificationCode'];
  const codeRows = await Promise.all(codeFields.map((field) => querySchoolCollection(env, collection, {
    filters: [{ field, op: '==', value: code }]
  }).catch(() => [])));
  return uniqueRows(codeRows.flat());
}

async function queryRowsForReferences(env, collection, fields, references) {
  const values = [...new Set((references || []).map(clean).filter(Boolean))].slice(0, 30);
  if (!values.length) return [];
  const groups = await Promise.all(fields.map((field) => queryCollection(env, collection, {
    filters: [{ field, op: 'in', value: values }]
  }).catch(() => [])));
  return uniqueRows(groups.flat());
}

async function loadParentSources(env, scope = 'full', identity = {}) {
  const full = scope !== 'identity';
  const email = lower(identity.email || identity.ParentEmail || identity.Email);
  const code = clean(identity.code || identity.VerificationCode).toUpperCase();
  const [firestoreApplications, firestoreStudents, firestoreSales] = await Promise.all([
    querySchoolIdentity(env, 'applications', email, code),
    querySchoolIdentity(env, 'students', email, code),
    queryCollection(env, 'formSales', {
      filters: [{ field: 'VerificationCode', op: '==', value: code }],
      limit: 10
    }).catch(() => [])
  ]);
  const references = uniqueRows([...firestoreApplications, ...firestoreStudents]).flatMap((row) => [
    row.AccountRef, row.AdmissionNo, row.ApplicationReference, row.ApplicationID, row.__id
  ]).map(clean).filter(Boolean);
  const summaryReferences = [...new Set(firestoreStudents.map((row) => clean(row.AccountRef || row.AdmissionNo || row.__id))
    .concat(firestoreApplications.map((row) => clean(row.AccountRef || row.AdmissionNo || row.ApplicationReference || row.__id)))
    .filter(Boolean))].slice(0, 30);
  const [firestoreLedger, firestoreInvoices, firestorePayments, firestoreClinic, firestoreStoreItems, firestoreStoreOrders, accountSummaries] = await Promise.all([
    full ? queryRowsForReferences(env, 'ledger', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], references) : Promise.resolve([]),
    full ? queryRowsForReferences(env, 'invoices', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], references) : Promise.resolve([]),
    full ? queryRowsForReferences(env, 'payments', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], references) : Promise.resolve([]),
    full ? queryRowsForReferences(env, 'clinicRecords', ['AdmissionNo'], references) : Promise.resolve([]),
    full ? listCollection(env, 'storeItems').catch(() => []) : Promise.resolve([]),
    full ? queryRowsForReferences(env, 'storeOrders', ['AccountRef', 'AdmissionNo'], references) : Promise.resolve([]),
    full ? Promise.all(summaryReferences.map((ref) => getDocument(env, 'accountSummaries', safeDocumentId(ref)).catch(() => null))) : Promise.resolve([])
  ]);
  const [sheetSales, sheetApplications, sheetStudents, sheetFinance, sheetClinic] = await Promise.all([
    appsScriptAction(env, 'getFormSales'),
    appsScriptAction(env, 'getApplications'),
    appsScriptAction(env, 'getStudents'),
    full ? appsScriptAction(env, 'getAccountsOverview') : Promise.resolve(null),
    full ? appsScriptAction(env, 'getClinicRecords') : Promise.resolve(null)
  ]);
  const preferFirestore = (firestoreRows, sheetRows) => firestoreRows.length ? firestoreRows : (sheetRows || []);
  return {
    accounts: (accountSummaries || []).filter(Boolean).length
      ? uniqueRows(accountSummaries.filter(Boolean))
      : ((sheetFinance && sheetFinance.ok && sheetFinance.accounts) || []),
    sales: preferFirestore(firestoreSales, (sheetSales && sheetSales.ok && sheetSales.sales) || []),
    applications: preferFirestore(firestoreApplications, (sheetApplications && sheetApplications.ok && sheetApplications.applications) || []),
    students: preferFirestore(firestoreStudents, (sheetStudents && sheetStudents.ok && sheetStudents.students) || []),
    ledger: preferFirestore(firestoreLedger, (sheetFinance && sheetFinance.ok && sheetFinance.ledger) || []),
    invoices: preferFirestore(firestoreInvoices, (sheetFinance && sheetFinance.ok && sheetFinance.invoices) || []),
    payments: preferFirestore(firestorePayments, (sheetFinance && sheetFinance.ok && sheetFinance.payments) || []),
    clinic: preferFirestore(firestoreClinic, (sheetClinic && sheetClinic.ok && sheetClinic.records) || []),
    storeItems: firestoreStoreItems,
    storeOrders: firestoreStoreOrders
  };
}

function nameFormatOrder(value) {
  const parts = clean(value).toLowerCase().split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : ['surname', 'first name', 'middle name'];
}

function formatPersonName(row, profile = {}, fallback = '') {
  const values = {
    'first name': pick(row, ['FirstName', 'firstName', 'GivenName', 'givenName']),
    'middle name': pick(row, ['MiddleName', 'middleName']),
    surname: pick(row, ['Surname', 'surname', 'LastName', 'lastName', 'FamilyName', 'familyName'])
  };
  const name = nameFormatOrder(profile.NameFormat || profile.nameFormat)
    .map((part) => clean(values[part]))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || clean(fallback);
}

function passportPhotoUrl(row) {
  const documents = row && row.documents && typeof row.documents === 'object' ? row.documents : {};
  const passport = documents.PassportPhotograph && typeof documents.PassportPhotograph === 'object' ? documents.PassportPhotograph : {};
  return clean(passport.url || row.DocPassportPhotographUrl || row.PassportPhotographUrl || row.PassportPhotographLink);
}

function normalizeStudent(row, profile = {}) {
  const displayName = formatPersonName(row, profile, pick(row, ['DisplayName', 'displayName', 'ApplicantName', 'applicantName']));
  return {
    ...row,
    AccountRef: pick(row, ['AccountRef', 'AdmissionNo', 'admissionNo', '__id']),
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo', '__id']),
    ApplicationReference: pick(row, ['ApplicationReference', 'applicationReference']),
    DisplayName: displayName,
    ClassName: pick(row, ['ClassName', 'className', 'ClassAdmitted', 'classAdmitted']),
    ClassArm: pick(row, ['ClassArm', 'classArm', 'Arm', 'arm']),
    StudentType: pick(row, ['StudentType', 'studentType']),
    Gender: pick(row, ['Gender', 'gender', 'Sex', 'sex']),
    BranchId: pick(row, ['BranchId', 'branchId']),
    SchoolSection: pick(row, ['SchoolSection', 'schoolSection']),
    ParentEmail: lower(pick(row, ['ParentEmail', 'parentEmail', 'Email', 'email', 'VerificationEmail', 'FatherEmail', 'MotherEmail', 'GuardianEmail'])),
    ParentPhone: pick(row, ['ParentPhone', 'parentPhone']),
    VerificationCode: studentLoginCode(row),
    WalletCardStatus: pick(row, ['WalletCardStatus', 'walletCardStatus'], 'Active'),
    WalletDailyLimit: asMoneyNumber(pick(row, ['WalletDailyLimit', 'walletDailyLimit'])),
    WalletTxnLimit: asMoneyNumber(pick(row, ['WalletTxnLimit', 'walletTxnLimit'])),
    WalletPinThreshold: asMoneyNumber(pick(row, ['WalletPinThreshold', 'walletPinThreshold'])),
    Status: pick(row, ['Status', 'status'], 'Active'),
    StatusReason: pick(row, ['StatusReason', 'statusReason', 'WithdrawalReason', 'LeaveReason']),
    PassportPhotoAvailable: Boolean(passportPhotoUrl(row)),
    PassportPhotoApplicationReference: pick(row, ['ApplicationReference', 'applicationReference'])
  };
}

function normalizeApplicationChild(row, profile = {}) {
  const displayName = formatPersonName(
    row,
    profile,
    pick(row, ['ApplicantName', 'applicantName', 'DisplayName', 'displayName', 'Name', 'name'])
  );
  const applicationRef = pick(row, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']);
  return {
    ...row,
    AccountRef: applicationRef,
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo']),
    ApplicationReference: applicationRef,
    DisplayName: displayName,
    ClassName: pick(row, ['ClassApplyingFor', 'classApplyingFor', 'ClassAdmitted', 'classAdmitted', 'ClassName', 'className']),
    StudentType: pick(row, ['StudentType', 'studentType'], 'Day Student'),
    Gender: pick(row, ['Gender', 'gender', 'Sex', 'sex']),
    BranchId: pick(row, ['BranchId', 'branchId']),
    SchoolSection: pick(row, ['SchoolSection', 'schoolSection']),
    ParentEmail: lower(pick(row, ['ParentEmail', 'parentEmail', 'VerificationEmail', 'verificationEmail', 'Email', 'email'])),
    ParentPhone: pick(row, ['ParentPhone', 'parentPhone', 'Phone', 'phone']),
    WalletCardStatus: 'Not Issued',
    WalletDailyLimit: 0,
    WalletTxnLimit: 0,
    WalletPinThreshold: 0,
    Status: pick(row, ['ResultStatus', 'resultStatus', 'Status', 'status'], 'Application'),
    StatusReason: '',
    PassportPhotoAvailable: Boolean(passportPhotoUrl(row)),
    PassportPhotoApplicationReference: applicationRef,
    EnglishScore: pick(row, ['EnglishScore', 'englishScore', 'English', 'english']),
    MathematicsScore: pick(row, ['MathematicsScore', 'mathematicsScore', 'MathScore', 'mathScore', 'Mathematics', 'mathematics']),
    InterviewScore: pick(row, ['InterviewScore', 'interviewScore', 'GeneralPaperScore', 'generalPaperScore']),
    TotalScore: pick(row, ['TotalScore', 'totalScore', 'Total', 'total']),
    ResultPercentage: pick(row, ['ResultPercentage', 'resultPercentage', 'Percentage', 'percentage']),
    ResultStatus: pick(row, ['ResultStatus', 'resultStatus', 'AdmissionDecision', 'admissionDecision']),
    ResultNotes: pick(row, ['ResultNotes', 'resultNotes', 'Notes', 'notes']),
    ResultSent: pick(row, ['ResultSent', 'resultSent', 'EntranceResultSent', 'entranceResultSent']),
    ResultReadyOnline: pick(row, ['ResultReadyOnline', 'resultReadyOnline', 'ResultPublished', 'resultPublished']),
    SubmittedAt: pick(row, ['SubmittedAt', 'submittedAt', 'CreatedAt', 'createdAt', 'ApplicationDate', 'applicationDate', 'Timestamp', 'timestamp']),
    CreatedAt: pick(row, ['CreatedAt', 'createdAt', 'SubmittedAt', 'submittedAt']),
    SourceType: 'Application'
  };
}

function normalizeLedger(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'CreatedAt', 'createdAt'])),
    RawDate: pick(row, ['Date', 'date', 'CreatedAt', 'createdAt', 'PaidAt', 'paidAt']),
    AccountRef: pick(row, ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo']),
    ApplicationReference: pick(row, ['ApplicationReference', 'applicationReference']),
    ApplicationID: pick(row, ['ApplicationID', 'applicationId']),
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo']),
    FeeCode: pick(row, ['FeeCode', 'feeCode']),
    FeeName: pick(row, ['FeeName', 'feeName']),
    EntryType: pick(row, ['EntryType', 'entryType']),
    FeeCategory: pick(row, ['FeeCategory', 'feeCategory']),
    Description: pick(row, ['Description', 'description']),
    AcademicSession: pick(row, ['AcademicSession', 'academicSession']),
    Term: pick(row, ['Term', 'term']),
    Debit: asMoneyNumber(pick(row, ['Debit', 'debit'])),
    Credit: asMoneyNumber(pick(row, ['Credit', 'credit'])),
    Balance: asMoneyNumber(pick(row, ['Balance', 'balance'])),
    Status: pick(row, ['Status', 'status']),
    RecordedBy: pick(row, ['RecordedBy', 'recordedBy']),
    Source: pick(row, ['Source', 'source']),
    Reference: pick(row, ['Reference', 'reference', 'GatewayReference', 'gatewayReference', 'LedgerNo', 'ledgerNo', '__id']),
    Metadata: pick(row, ['Metadata', 'metadata'])
  };
}

function normalizeInvoice(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'CreatedAt', 'createdAt'])),
    AccountRef: pick(row, ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo']),
    FeeCode: pick(row, ['FeeCode', 'feeCode']),
    FeeName: pick(row, ['FeeName', 'feeName']),
    FeeCategory: pick(row, ['FeeCategory', 'feeCategory']),
    AcademicSession: pick(row, ['AcademicSession', 'academicSession']),
    Term: pick(row, ['Term', 'term']),
    Debit: asMoneyNumber(pick(row, ['Debit', 'debit', 'Amount', 'amount'])),
    Credit: asMoneyNumber(pick(row, ['Credit', 'credit', 'PaidAmount', 'paidAmount'])),
    Balance: asMoneyNumber(pick(row, ['Balance', 'balance', 'BalanceAmount', 'balanceAmount'])),
    DueDate: toDisplayDate(pick(row, ['DueDate', 'dueDate', 'PaymentDueDate', 'paymentDueDate'])),
    Status: pick(row, ['Status', 'status']),
    Reference: pick(row, ['InvoiceId', 'invoiceId', 'Reference', 'reference', '__id'])
  };
}

function normalizePayment(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'PaidAt', 'paidAt', 'CreatedAt', 'createdAt'])),
    AccountRef: pick(row, ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo']),
    ApplicationReference: pick(row, ['ApplicationReference', 'applicationReference']),
    ApplicationID: pick(row, ['ApplicationID', 'applicationId']),
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo']),
    FeeCode: pick(row, ['FeeCode', 'feeCode']),
    FeeName: pick(row, ['FeeName', 'feeName']),
    FeeCategory: pick(row, ['FeeCategory', 'feeCategory']),
    AcademicSession: pick(row, ['AcademicSession', 'academicSession']),
    Term: pick(row, ['Term', 'term']),
    Amount: asMoneyNumber(pick(row, ['Amount', 'amount', 'Credit', 'credit'])),
    Currency: pick(row, ['Currency', 'currency'], 'NGN'),
    Status: pick(row, ['Status', 'status']),
    Gateway: pick(row, ['Gateway', 'gateway']),
    Method: pick(row, ['Method', 'method']),
    Reference: pick(row, ['Reference', 'reference', 'TransactionReference', 'transactionReference', 'PaymentId', 'paymentId', '__id'])
  };
}

function normalizeClinicRecord(row) {
  return {
    Date: toDisplayDate(pick(row, ['Date', 'date', 'CreatedAt', 'createdAt'])),
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo', 'AccountRef', 'accountRef']),
    StudentName: pick(row, ['StudentName', 'studentName']),
    ClassName: pick(row, ['ClassName', 'className']),
    Complaint: pick(row, ['Complaint', 'complaint']),
    Treatment: pick(row, ['Treatment', 'treatment']),
    Disposition: pick(row, ['Disposition', 'disposition']),
    RecordedBy: pick(row, ['RecordedBy', 'recordedBy'])
  };
}

async function assertParentAccess(sources, email, code) {
  const wantedEmail = lower(email);
  const wantedCode = clean(code).toUpperCase();
  if (!wantedEmail || !wantedCode) {
    const err = new Error('Parent email and verification code are required.');
    err.status = 400;
    throw err;
  }

  const sales = sources.sales || [];
  const applications = sources.applications || [];
  const saleMatch = sales.some((row) => {
    return lower(pick(row, ['Email', 'email'])) === wantedEmail &&
      clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === wantedCode;
  });
  const matchingApplications = applications.filter((row) => {
    return [
      pick(row, ['VerificationEmail', 'verificationEmail']),
      pick(row, ['ParentEmail', 'parentEmail']),
      pick(row, ['Email', 'email'])
    ].some((value) => lower(value) === wantedEmail) &&
      clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === wantedCode;
  });
  const studentMatch = (sources.students || []).map(normalizeStudent).some((row) => {
    return lower(row.ParentEmail) === wantedEmail && studentLoginCode(row) === wantedCode;
  });
  if (!saleMatch && matchingApplications.length === 0 && !studentMatch) {
    const err = new Error('Invalid parent email or verification code.');
    err.status = 401;
    throw err;
  }
  return { applications, matchingApplications, studentMatch };
}

function parentOwnsStudent(student, email, applications, matchingApplications = []) {
  const wantedEmail = lower(email);
  if (lower(student.ParentEmail) === wantedEmail) return true;
  const appRef = pick(student, ['ApplicationReference', 'applicationReference']);
  if (appRef && matchingApplications.some((app) => sameText(pick(app, ['ApplicationReference', 'applicationReference', '__id']), appRef))) {
    return true;
  }
  return applications.some((app) => {
    const sameRef = appRef && sameText(pick(app, ['ApplicationReference', 'applicationReference', '__id']), appRef);
    const emailMatch = [
      pick(app, ['VerificationEmail', 'verificationEmail']),
      pick(app, ['ParentEmail', 'parentEmail']),
      pick(app, ['Email', 'email'])
    ].some((value) => lower(value) === wantedEmail);
    return sameRef && emailMatch;
  });
}

function walletBalance(entries) {
  return entries.reduce((balance, row) => balance + asMoneyNumber(row.Credit) - asMoneyNumber(row.Debit), 0);
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function isWalletLedger(entry) {
  return clean(entry && entry.FeeCode).toUpperCase() === 'WALLET_TOPUP' ||
    lower(entry && entry.FeeCategory) === 'wallet' ||
    lower(entry && entry.EntryType).includes('wallet');
}

function isOptionalSubscriptionEntry(entry) {
  const category = lower(entry && entry.FeeCategory);
  if (['bus service', 'transport', 'club', 'optional', 'others', 'store'].includes(category)) return true;
  const feeCode = clean(entry && entry.FeeCode).toUpperCase();
  if (feeCode === 'STORE_CART') return true;
  const feeName = lower(entry && entry.FeeName);
  const description = lower(entry && entry.Description);
  const reference = clean(entry && entry.Reference).toUpperCase();
  const metadata = parseMetadata(entry && entry.Metadata);
  const nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
  const metadataCategory = lower(metadata.feeCategory || nested.feeCategory);
  const metadataCode = clean(metadata.feeCode || nested.feeCode).toUpperCase();
  if (['bus service', 'transport', 'club', 'optional', 'others'].includes(metadataCategory)) return true;
  if (/^(BUS|CLUB|TRANSPORT|OPTIONAL)[_-]/.test(feeCode) || /[-_](BUS|CLUB|TRANSPORT|OPTIONAL)[_-]/.test(reference)) return true;
  if (/^(BUS|CLUB|TRANSPORT|OPTIONAL)[_-]/.test(metadataCode)) return true;
  return feeName.includes('bus service') ||
    feeName.includes('bus route') ||
    feeName.includes('paid club') ||
    feeName.includes('club subscription') ||
    description.includes('bus service') ||
    description.includes('bus route') ||
    description.includes('paid club') ||
    description.includes('club subscription');
}

function feeAccountSummary(entries) {
  const rows = (entries || []).filter((entry) => !isWalletLedger(entry) && !isOptionalSubscriptionEntry(entry));
  const debit = rows.reduce((sum, row) => {
    if (lower(row.FeeCategory) === 'account credit') return sum;
    return sum + asMoneyNumber(row.Debit);
  }, 0);
  const creditActionDebits = rows.reduce((sum, row) => {
    return lower(row.FeeCategory) === 'account credit' ? sum + asMoneyNumber(row.Debit) : sum;
  }, 0);
  const credit = rows.reduce((sum, row) => sum + asMoneyNumber(row.Credit), 0);
  const balance = debit + creditActionDebits - credit;
  return {
    TotalDebit: debit,
    TotalCredit: credit,
    AccountCreditDebits: creditActionDebits,
    OutstandingBalance: Math.max(0, balance),
    CreditBalance: Math.max(0, -balance)
  };
}

function normalizeAccountSummary(row) {
  if (!row) return null;
  const totalDebit = asMoneyNumber(pick(row, ['TotalDebit', 'totalDebit']));
  const totalCredit = asMoneyNumber(pick(row, ['TotalCredit', 'totalCredit']));
  const balance = pick(row, ['Balance', 'balance']);
  const outstanding = pick(row, ['OutstandingBalance', 'outstandingBalance']);
  const credit = pick(row, ['ExcessCredit', 'excessCredit', 'CreditBalance', 'creditBalance']);
  const computedBalance = totalDebit - totalCredit;
  return {
    TotalDebit: totalDebit,
    TotalCredit: totalCredit,
    OutstandingBalance: outstanding !== '' ? asMoneyNumber(outstanding) : Math.max(0, asMoneyNumber(balance || computedBalance)),
    CreditBalance: credit !== '' ? asMoneyNumber(credit) : Math.max(0, -asMoneyNumber(balance || computedBalance))
  };
}

function accountSummaryForKeys(accounts, keys, ledgerEntries) {
  const account = (accounts || []).find((row) => {
    const rowKeys = [
      pick(row, ['AccountRef', 'accountRef', '__id']),
      pick(row, ['AdmissionNo', 'admissionNo']),
      pick(row, ['ApplicationReference', 'applicationReference'])
    ].map(clean).filter(Boolean);
    const wanted = new Set(keys.map(referenceIdentityKey).filter(Boolean));
    return rowKeys.slice(0, 2).some((key) => wanted.has(referenceIdentityKey(key)));
  });
  return normalizeAccountSummary(account) || feeAccountSummary(ledgerEntries);
}

function isWalletFee(fee) {
  return clean(fee.FeeCode) === 'WALLET_TOPUP' || lower(fee.FeeCategory) === 'wallet';
}

function isSchoolFee(fee) {
  return fee && !isWalletFee(fee) && lower(fee.FeeCategory || 'School Fee') === 'school fee';
}

function isYes(value) {
  return ['yes', 'y', 'true', '1'].includes(lower(value));
}

function schoolResultsAreVisible(profile = {}) {
  return isYes(profile.ShowResultsOnline || profile.showResultsOnline || profile.ResultsOnline ||
    profile.resultsOnline || profile.EntranceResultsOnline || profile.entranceResultsOnline);
}

async function getSchoolProfile(env) {
  try {
    const [profile, documentBranding, webBranding] = await Promise.all([
      getDocument(env, 'settings', 'schoolProfile'),
      getDocument(env, 'settings', 'documentBranding').catch(() => null),
      getDocument(env, 'settings', 'webBranding').catch(() => null)
    ]);
    if (profile) {
      return {
        ...profile,
        ...(documentBranding || {}),
        DocumentLogoDataUrl: clean(documentBranding?.DocumentLogoDataUrl || webBranding?.WebLogoDataUrl),
        ShowResultsOnline: pick(profile, [
          'ShowResultsOnline', 'showResultsOnline', 'ResultsOnline', 'resultsOnline',
          'EntranceResultsOnline', 'entranceResultsOnline'
        ], clean(env.SHOW_RESULTS_ONLINE) || 'NO'),
        ResultDisplayMode: pick(profile, ['ResultDisplayMode', 'resultDisplayMode'], clean(env.RESULT_DISPLAY_MODE) || 'subjects')
      };
    }
    return {
        ShowResultsOnline: clean(env.SHOW_RESULTS_ONLINE) || 'NO',
        ResultDisplayMode: clean(env.RESULT_DISPLAY_MODE) || 'subjects'
    };
  } catch (_err) {
    return {
      ShowResultsOnline: clean(env.SHOW_RESULTS_ONLINE) || 'NO',
      ResultDisplayMode: clean(env.RESULT_DISPLAY_MODE) || 'subjects'
    };
  }
}

function resultIsVisible(application, profile = {}) {
  if (!schoolResultsAreVisible(profile)) return false;
  return isYes(pick(application, [
    'ResultReadyOnline', 'resultReadyOnline',
    'ResultPublished', 'resultPublished',
    'ShowResultOnPortal', 'showResultOnPortal',
    'PublishResult', 'publishResult',
    'ResultSent', 'resultSent',
    'EntranceResultSent', 'entranceResultSent'
  ])) || Boolean(clean(pick(application, ['ResultStatus', 'resultStatus', 'TotalScore', 'totalScore', 'ResultPercentage', 'resultPercentage'])));
}

function buildEntranceResult(application, profile = {}) {
  if (!application || !resultIsVisible(application, profile)) return null;
  return {
    ApplicationReference: pick(application, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']),
    ApplicantName: pick(application, ['ApplicantName', 'applicantName', 'DisplayName', 'displayName', 'Name', 'name']),
    EnglishScore: pick(application, ['EnglishScore', 'englishScore', 'English', 'english']),
    MathematicsScore: pick(application, ['MathematicsScore', 'mathematicsScore', 'MathScore', 'mathScore', 'Mathematics', 'mathematics']),
    InterviewScore: pick(application, ['InterviewScore', 'interviewScore', 'GeneralPaperScore', 'generalPaperScore']),
    TotalScore: pick(application, ['TotalScore', 'totalScore', 'Total', 'total']),
    ResultPercentage: pick(application, ['ResultPercentage', 'resultPercentage', 'Percentage', 'percentage']),
    ResultStatus: pick(application, ['ResultStatus', 'resultStatus', 'AdmissionDecision', 'admissionDecision', 'Status', 'status']),
    ResultNotes: pick(application, ['ResultNotes', 'resultNotes', 'Notes', 'notes']),
    ResultNextStep: pick(application, ['ResultNextStep', 'resultNextStep', 'NextStep', 'nextStep']),
    ResultUpdatedAt: toDisplayDate(pick(application, ['ResultUpdatedAt', 'resultUpdatedAt', 'UpdatedAt', 'updatedAt'])),
    ResultSentAt: toDisplayDate(pick(application, ['ResultSentAt', 'resultSentAt', 'EntranceResultSentAt', 'entranceResultSentAt']))
    ,ResultSent: pick(application, ['ResultSent', 'resultSent'], 'NO')
    ,OfferSent: pick(application, ['OfferSent', 'offerSent'], 'NO')
    ,AdmissionLetterSent: pick(application, ['AdmissionLetterSent', 'admissionLetterSent'], 'NO')
    ,AcceptanceFeePaid: pick(application, ['AcceptanceFeePaid', 'acceptanceFeePaid'], 'NO')
    ,EntranceResultPdfAvailable: Boolean(clean(pick(application, ['EntranceResultPdfUrl', 'entranceResultPdfUrl'])))
    ,OfferPdfAvailable: Boolean(clean(pick(application, ['OfferPdfUrl', 'offerPdfUrl'])))
    ,AdmissionLetterPdfAvailable: Boolean(clean(pick(application, ['AdmissionLetterPdfUrl', 'admissionLetterPdfUrl'])))
  };
}

function decodeBase64Bytes(value) {
  const binary = atob(clean(value));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeBase64Bytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function loadStoredAdmissionDocument(env, url) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
    const err = new Error('Google Drive document storage is not configured.');
    err.status = 500;
    throw err;
  }
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'getStoredDocument',
      DocumentUrl: url
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok || !clean(data.fileBase64)) {
    const err = new Error(data.message || 'The customized admission document could not be loaded.');
    err.status = response.status >= 400 ? response.status : 502;
    throw err;
  }
  return data;
}

async function archiveGeneratedAdmissionDocument(env, application, title, fileName, existingUrl, pdfBytes) {
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
    const err = new Error('Document storage is not configured. Configure Google document storage in Settings.');
    err.status = 500;
    throw err;
  }
  const applicationReference = pick(application, ['ApplicationReference', 'ApplicationID', '__id']);
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'uploadParentDocument',
      StorageOnly: 'YES',
      ApplicationReference: applicationReference,
      DocumentType: 'AcceptanceForm',
      FileName: fileName,
      MimeType: 'application/pdf',
      FileBase64: encodeBase64Bytes(pdfBytes),
      ReplaceExisting: existingUrl ? 'YES' : 'NO',
      ExistingUrl: existingUrl
    })
  });
  const stored = await response.json().catch(() => ({}));
  if (!response.ok || !stored.ok || !clean(stored.documentUrl)) {
    const err = new Error(stored.message || `${title} was generated but could not be saved to document storage.`);
    err.status = response.status >= 400 ? response.status : 502;
    throw err;
  }
  return clean(stored.documentUrl);
}

async function resolveParentAdmissionApplication(env, body, email, code, accountRef) {
  const sourceType = lower(body.sourceType || body.SourceType);
  const collection = sourceType === 'application' ? 'applications' : 'students';
  const selected = await getSelectedIdentityRow(env, collection, accountRef, body.scopePath || body.ScopePath);
  if (selected && collection === 'applications') {
    const emailMatches = [selected.VerificationEmail, selected.ParentEmail, selected.Email].some((value) => lower(value) === email);
    const codeMatches = clean(selected.VerificationCode).toUpperCase() === code;
    if (emailMatches && codeMatches) return selected;
  }
  if (selected && collection === 'students') {
    const student = normalizeStudent(selected, await getSchoolProfile(env));
    const emailMatches = lower(student.ParentEmail || student.Email || student.VerificationEmail) === email;
    const codeMatches = [student.ParentLoginCode, student.VerificationCode, student.LoginCode]
      .map((value) => clean(value).toUpperCase()).includes(code);
    if (emailMatches && codeMatches) {
      const applicationRef = clean(student.ApplicationReference);
      const applicationScope = clean(selected.__scopePath).replace(/\/students$/i, '/applications');
      if (applicationRef) {
        const linked = await getSelectedIdentityRow(env, 'applications', applicationRef, applicationScope);
        if (linked) return linked;
      }
      for (const field of ['AdmissionNo', 'admissionNo', 'AdmissionNumber']) {
        const matches = await querySchoolCollection(env, 'applications', {
          filters: [{ field, op: '==', value: clean(student.AdmissionNo || student.AccountRef) }],
          limit: 1
        }).catch(() => []);
        if (matches[0]) return matches[0];
      }
    }
  }
  const identitySources = await loadParentSources(env, 'identity', body);
  const { applications, matchingApplications } = await assertParentAccess(identitySources, email, code);
  return applications.find((row) => matchingApplications.includes(row) && applicationKeys(row)
    .some((ref) => sameText(ref, accountRef) || referencesMatch(ref, accountRef))) || null;
}

async function getParentAdmissionDocument(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const code = clean(body.code || body.VerificationCode).toUpperCase();
  const accountRef = clean(body.accountRef || body.AccountRef || body.ApplicationReference);
  const documentType = lower(body.documentType || body.DocumentType);
  const profile = await getSchoolProfile(env);
  const application = await resolveParentAdmissionApplication(env, body, email, code, accountRef);
  if (!application) { const err = new Error('That admission record is not linked to this parent.'); err.status = 404; throw err; }
  const resultStatus = lower(pick(application, ['ResultStatus', 'Status']));
  const admitted = resultStatus === 'admitted' || resultStatus === 'accepted';
  const now = new Date().toISOString();
  let flag; let title; let urlField; let fileField;
  if (documentType === 'result') {
    if (!resultIsVisible(application, profile)) { const err = new Error('Entrance result is not available yet.'); err.status = 409; throw err; }
    flag = 'ResultSent'; title = 'Entrance Result'; urlField = 'EntranceResultPdfUrl'; fileField = 'EntranceResultPdfFileName';
  } else if (documentType === 'offer') {
    if (!admitted || !isYes(application.ResultSent)) { const err = new Error('Download the entrance result before the offer of admission.'); err.status = 409; throw err; }
    flag = 'OfferSent'; title = 'Offer of Admission'; urlField = 'OfferPdfUrl'; fileField = 'OfferPdfFileName';
  } else if (documentType === 'admission') {
    if (!isYes(application.OfferSent) || !isYes(application.AcceptanceFeePaid)) { const err = new Error('The offer must be downloaded and acceptance fee confirmed before the admission letter.'); err.status = 409; throw err; }
    flag = 'AdmissionLetterSent'; title = 'Admission Letter'; urlField = 'AdmissionLetterPdfUrl'; fileField = 'AdmissionLetterPdfFileName';
  } else { const err = new Error('Unknown admission document.'); err.status = 400; throw err; }
  let storedUrl = clean(application[urlField]);
  let pdfBytes;
  let fileName = clean(application[fileField]);
  if (storedUrl) {
    const storedFile = await loadStoredAdmissionDocument(env, storedUrl);
    pdfBytes = decodeBase64Bytes(storedFile.fileBase64);
    fileName = fileName || clean(storedFile.fileName);
  } else {
    const applicantName = pick(application, ['ApplicantName', 'DisplayName']);
    fileName = fileName || `${safeDocumentId(applicantName || accountRef)}-${safeDocumentId(title)}.pdf`;
    pdfBytes = await createAdmissionPdf(profile, application, documentType, now);
    storedUrl = await archiveGeneratedAdmissionDocument(env, application, title, fileName, '', pdfBytes);
  }
  const documentId = application.__id || safeDocumentId(pick(application, ['ApplicationReference', 'ApplicationID']));
  const updatedApplication = {
    ...application,
    [urlField]: storedUrl,
    [fileField]: fileName,
    [flag]: 'YES',
    [`${flag}At`]: now,
    [`${flag}OpenedByParent`]: 'YES',
    GeneratedAdmissionDocumentUpdatedAt: now,
    UpdatedAt: now
  };
  await upsertSchoolDocument(env, 'applications', documentId, updatedApplication);
  return {
    ok: true,
    message: `${title} generated, saved, downloaded, and marked as sent.`,
    pdfBytes,
    fileName,
    flag
  };
}

export function schoolFeeCreditSummary(items, total, originalTotal) {
  const sum = (field) => asMoneyNumber((items || []).reduce((amount, fee) => amount + asMoneyNumber(fee[field]), 0));
  const creditApplied = Math.max(0, asMoneyNumber(originalTotal) - asMoneyNumber(total));
  const acceptanceCreditApplied = sum('AcceptanceCreditApplied');
  const schoolFeesTotalCreditApplied = sum('SchoolFeesTotalCreditApplied');
  const generalFeeCreditApplied = sum('GeneralFeeCreditApplied');
  return {
    CreditApplied: creditApplied,
    AcceptanceCreditApplied: acceptanceCreditApplied,
    SchoolFeesTotalCreditApplied: schoolFeesTotalCreditApplied,
    GeneralFeeCreditApplied: generalFeeCreditApplied,
    PreviousFeePaymentApplied: Math.max(0, creditApplied - acceptanceCreditApplied - schoolFeesTotalCreditApplied - generalFeeCreditApplied)
  };
}

function schoolFeeTotalItem(breakdown) {
  const items = (breakdown || []).filter(isSchoolFee);
  if (!items.length) return null;
  const total = asMoneyNumber(items.reduce((sum, fee) => sum + asMoneyNumber(fee.Amount), 0));
  if (total <= 0) return null;
  const originalTotal = asMoneyNumber(items.reduce((sum, fee) => sum + asMoneyNumber(fee.OriginalAmount || fee.Amount), 0));
  const creditSummary = schoolFeeCreditSummary(items, total, originalTotal);
  const installmentItems = items.filter((fee) => isYes(fee.AllowInstallment) && ['total', 'both'].includes(lower(fee.PartPaymentMode || 'Item')));
  const installmentMinimum = installmentItems.reduce((max, fee) => Math.max(max, asMoneyNumber(fee.MinAmount)), 0);
  const minimumInstallmentPortion = installmentItems.length && installmentMinimum <= 0 ? 1 : installmentMinimum;
  const minAmount = Math.min(total, minimumInstallmentPortion);
  const allowInstallment = installmentItems.length > 0;
  return {
    FeeCode: 'SCHOOL_FEES_TOTAL',
    FeeName: 'School Fees Total',
    FeeCategory: 'School Fee',
    Amount: total,
    OriginalAmount: originalTotal || total,
    ...creditSummary,
    BalanceAmount: total,
    Currency: items[0].Currency || 'NGN',
    AllowInstallment: allowInstallment ? 'YES' : 'NO',
    MinAmount: allowInstallment ? minAmount : '',
    MaxAmount: total,
    PaymentType: 'SchoolFeesTotal',
    AcademicSession: items[0].AcademicSession || '',
    Term: items[0].Term || '',
    DueDate: items.map((item) => clean(item.DueDate)).filter(Boolean).sort()[0] || '',
    Components: items.map((fee) => ({
      FeeCode: fee.FeeCode,
      FeeName: fee.FeeName,
      FeeCategory: fee.FeeCategory || 'School Fee',
      Amount: fee.OriginalAmount || fee.Amount,
      OriginalAmount: fee.OriginalAmount || fee.Amount,
      PaidAmount: fee.PaidAmount || '',
      AcceptanceCreditApplied: fee.AcceptanceCreditApplied || '',
      SchoolFeesTotalCreditApplied: fee.SchoolFeesTotalCreditApplied || '',
      GeneralFeeCreditApplied: fee.GeneralFeeCreditApplied || '',
      BalanceAmount: fee.BalanceAmount || fee.Amount,
      Currency: fee.Currency || items[0].Currency || 'NGN',
      AcademicSession: fee.AcademicSession || '',
      Term: fee.Term || '',
      AllowInstallment: fee.AllowInstallment || '',
      PartPaymentMode: fee.PartPaymentMode || 'Item',
      MinAmount: fee.MinAmount || '',
      MaxAmount: fee.MaxAmount || '',
      DueDate: fee.DueDate || ''
    }))
  };
}

function buildPayableItems(fees, breakdown) {
  const items = [];
  const schoolTotal = schoolFeeTotalItem(breakdown);
  if (schoolTotal) items.push(schoolTotal);
  (fees || []).forEach((fee) => {
    if (!isSchoolFee(fee)) items.push(fee);
  });
  return items;
}

function walletTopupItem(account = {}) {
  return {
    FeeCode: 'WALLET_TOPUP',
    FeeName: 'Student Wallet Top-up',
    FeeCategory: 'Wallet',
    Amount: 0,
    Currency: 'NGN',
    AllowInstallment: 'YES',
    MinAmount: 500,
    MaxAmount: '',
    PaymentType: 'Wallet',
    AcademicSession: account.AcademicSession || '',
    Term: account.Term || ''
  };
}

function paymentGroupKey(entry) {
  const reference = clean(entry.Reference || entry.GatewayReference || entry.TransactionReference || entry.PaymentNo || '');
  const schoolFeesBase = reference.match(/^(.*SCHOOL_FEES_TOTAL.*-\d+)(?:-[A-Za-z0-9_]+)?$/);
  return [
    schoolFeesBase ? schoolFeesBase[1] : reference,
    clean(entry.Date || ''),
    clean(entry.AccountRef || '')
  ].join('||');
}

function isPaidRecord(entry) {
  const status = lower(entry.Status);
  if (['unpaid', 'pending', 'due', 'invoice', 'invoiced', 'failed', 'cancelled', 'canceled'].includes(status)) return false;
  const amount = asMoneyNumber(entry.Credit || entry.Amount);
  if (amount <= 0) return false;
  if (['paid', 'success', 'successful', 'completed', 'confirmed'].includes(status)) return true;
  if (lower(entry.EntryType).includes('payment')) return true;
  return Boolean(clean(entry.Reference || entry.GatewayReference || entry.TransactionReference || entry.PaymentId));
}

function childCanShowFinanceHistory(child) {
  const status = lower(child && child.Status);
  return !['new', 'submitted', 'pending', 'application'].includes(status);
}

function groupedLedgerPayments(entries) {
  const groups = {};
  (entries || []).forEach((entry) => {
    const credit = asMoneyNumber(entry.Credit);
    if (credit <= 0) return;
    if (!isPaidRecord(entry)) return;
    const key = paymentGroupKey(entry) || `${clean(entry.Date)}||${clean(entry.AccountRef)}||${clean(entry.RecordedBy)}`;
    groups[key] = groups[key] || {
      ...entry,
      RecordType: 'Payment',
      Description: lower(entry.FeeCategory) === 'school fee' ? 'School Fee' : (entry.FeeCategory || entry.Department || entry.Description || entry.FeeName || entry.FeeCode || 'Payment'),
      Amount: 0,
      Credit: 0,
      Status: entry.Status || 'Paid'
    };
    groups[key].Amount += credit;
    groups[key].Credit += credit;
  });
  return Object.values(groups);
}

function paymentHistoryFor(child, payments, ledger) {
  const ledgerEntries = (ledger || []).filter((entry) => financialReferenceMatches(entry.AccountRef, child) && lower(entry.FeeCategory) !== 'wallet');
  const paidLedgerEntries = ledgerEntries.filter(isPaidRecord);
  return groupedLedgerPayments(paidLedgerEntries).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
}

function recordMatchesApplication(record, applicationRef) {
  const ref = clean(applicationRef);
  if (!ref) return false;
  return sameText(record.ApplicationReference, ref) ||
    sameText(record.ApplicationID, ref) ||
    referencesMatch(record.Reference, ref);
}

function paymentHistoryForChild(child, payments, ledger) {
  if (!childCanShowFinanceHistory(child)) return [];
  if (child && child.SourceType === 'Application') {
    const appRef = clean(child.ApplicationReference || child.AccountRef);
    const childCreatedMs = timestampMs(child.SubmittedAt || child.CreatedAt || child.UpdatedAt);
    const appLedger = (ledger || []).filter((entry) => {
      if (lower(entry.FeeCategory) === 'wallet' || !isPaidRecord(entry) || !recordMatchesApplication(entry, appRef)) return false;
      if (!childCreatedMs) return false;
      const entryMs = timestampMs(entry.RawDate || entry.Date);
      return entryMs >= childCreatedMs;
    });
    return groupedLedgerPayments(appLedger).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
  }
  return paymentHistoryFor(child, payments, ledger);
}

async function getAppsScriptAccountsOverview(env) {
  if (!legacyGoogleDataEnabled(env)) return null;
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return null;
  try {
    const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'getAccountsOverview'
      })
    });
    const text = await response.text();
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function dueStatus(dueDate) {
  const text = clean(dueDate);
  if (!text) return '';
  const parsed = parseFlexibleDate(text);
  if (!parsed) return 'Due date set';
  const due = new Date(parsed);
  due.setUTCHours(23, 59, 59, 999);
  const today = new Date();
  const ms = due.getTime() - today.getTime();
  const days = Math.ceil(ms / 86400000);
  if (days < 0) return `Overdue by ${Math.abs(days)} day(s)`;
  if (days === 0) return 'Due today';
  if (days <= 7) return `Due in ${days} day(s)`;
  return `Due ${text}`;
}

function invoiceDueNotifications(invoices, keys, accountSummary = null, child = {}) {
  if (accountSummary && asMoneyNumber(accountSummary.OutstandingBalance) <= 0) return [];
  return (invoices || [])
    .filter((invoice) => financialReferenceMatches(invoice.AccountRef, child))
    .filter((invoice) => {
      if (isSchoolFee(invoice)) return false;
      const enrollmentCategory = lower(child.EnrollmentCategory || child.IntakeCategory || 'Returning');
      if (/\baccept(?:ance)?/.test(lower(`${invoice.FeeCode} ${invoice.FeeName}`).replace(/[_-]+/g, ' ')) && enrollmentCategory !== 'new intake') return false;
      if (clean(child.AcademicSession) && clean(invoice.AcademicSession) && !['all', '*'].includes(lower(invoice.AcademicSession)) && !sameText(child.AcademicSession, invoice.AcademicSession)) return false;
      if (clean(child.Term) && clean(invoice.Term) && !['all', '*'].includes(lower(invoice.Term)) && !sameText(child.Term, invoice.Term)) return false;
      const status = lower(invoice.Status);
      const balance = invoice.Balance !== undefined && invoice.Balance !== ''
        ? asMoneyNumber(invoice.Balance)
        : Math.max(0, asMoneyNumber(invoice.Debit) - asMoneyNumber(invoice.Credit));
      return clean(invoice.DueDate) && status !== 'paid' && balance > 0;
    })
    .map((invoice) => ({
      FeeCode: invoice.FeeCode,
      FeeName: invoice.FeeName || invoice.FeeCode || 'Payment due',
      FeeCategory: invoice.FeeCategory,
      Amount: invoice.Balance !== undefined && invoice.Balance !== '' ? invoice.Balance : Math.max(0, asMoneyNumber(invoice.Debit) - asMoneyNumber(invoice.Credit)),
      Currency: 'NGN',
      AcademicSession: invoice.AcademicSession || '',
      Term: invoice.Term || '',
      DueDate: invoice.DueDate,
      DueStatus: dueStatus(invoice.DueDate),
      Source: 'Invoice'
    }));
}

async function getDashboard(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const code = clean(body.code || body.VerificationCode).toUpperCase();
  // The initial request only establishes the family/child list. Financial,
  // clinic and store details are loaded for the selected child immediately
  // afterwards, avoiding a duplicate full-data scan on every refresh.
  const sources = await loadParentSources(env, 'identity', body);
  const schoolProfile = await getSchoolProfile(env);
  const { applications, matchingApplications } = await assertParentAccess(sources, email, code);
  const allStudents = (sources.students || []).map((row) => normalizeStudent(row, schoolProfile));
  const children = allStudents.filter((student) => parentOwnsStudent(student, email, applications, matchingApplications));
  const childRefs = new Set(children.flatMap((child) => accountKeys(child).map((key) => lower(key))));
  const parentApplications = applications.filter((app) => {
    const emailMatch = [
      pick(app, ['VerificationEmail', 'verificationEmail']),
      pick(app, ['ParentEmail', 'parentEmail']),
      pick(app, ['Email', 'email'])
    ].some((value) => lower(value) === email);
    const codeMatch = clean(pick(app, ['VerificationCode', 'verificationCode'])).toUpperCase() === code;
    return emailMatch || codeMatch;
  });
  parentApplications
    .map((row) => normalizeApplicationChild(row, schoolProfile))
    .filter((child) => child.AccountRef && !childRefs.has(lower(child.AccountRef)))
    .forEach((child) => {
      children.push(child);
      accountKeys(child).forEach((key) => childRefs.add(lower(key)));
    });
  children.forEach((child) => {
    const linkedApplication = parentApplications.find((app) => {
      const ref = pick(app, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']);
      return referencesMatch(ref, child.ApplicationReference) || sameText(ref, child.ApplicationReference) ||
        referencesMatch(ref, child.AccountRef) || sameText(ref, child.AccountRef);
    });
    if (linkedApplication && passportPhotoUrl(linkedApplication)) {
      child.PassportPhotoAvailable = true;
      child.PassportPhotoApplicationReference = pick(linkedApplication, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']);
    }
  });
  const ledger = (sources.ledger || []).map(normalizeLedger);
  const invoices = (sources.invoices || []).map(normalizeInvoice);
  const payments = (sources.payments || []).map(normalizePayment);
  const clinic = (sources.clinic || []).map(normalizeClinicRecord);
  const walletActivity = {};
  const paymentRecords = {};
  const payableItems = {};
  const payableErrors = {};
  const dueNotifications = {};
  const clinicVisits = {};
  const entranceResults = {};
  const accountSummaries = {};

  for (const child of children) {
    const keys = accountKeys(child);
    const childLedger = ledger.filter((entry) => financialReferenceMatches(entry.AccountRef, child));
    const walletEntries = ledger.filter((entry) => {
      return financialReferenceMatches(entry.AccountRef, child) &&
        lower(entry.FeeCategory) === 'wallet';
    }).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
    child.WalletBalance = walletBalance(walletEntries);
    const accountSummary = accountSummaryForKeys(sources.accounts, keys, childLedger);
    child.TotalDebit = accountSummary.TotalDebit;
    child.TotalCredit = accountSummary.TotalCredit;
    child.OutstandingBalance = accountSummary.OutstandingBalance;
    child.CreditBalance = accountSummary.CreditBalance;
    accountSummaries[child.AccountRef] = accountSummary;
    walletActivity[child.AccountRef] = walletEntries;
    paymentRecords[child.AccountRef] = paymentHistoryForChild(child, payments, ledger);
    payableItems[child.AccountRef] = [];
    dueNotifications[child.AccountRef] = invoiceDueNotifications(invoices, keys, accountSummary, child);
    clinicVisits[child.AccountRef] = clinic.filter((record) => {
      return financialReferenceMatches(record.AdmissionNo, child);
    }).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
    const resultSource = applications.find((app) => applicationMatchesChild(app, child)) ||
      (child.SourceType === 'Application' ? child : null);
    const result = buildEntranceResult(resultSource, schoolProfile);
    entranceResults[child.AccountRef] = result ? [result] : [];
  }

  return {
    ok: true,
    message: 'Parent dashboard loaded.',
    children,
    walletActivity,
    paymentRecords,
    accountSummaries,
    payableItems,
    payableErrors,
    dueNotifications,
    showResultsOnline: schoolResultsAreVisible(schoolProfile),
    resultDisplayMode: lower(schoolProfile.ResultDisplayMode) === 'percentage' ? 'percentage' : 'subjects',
    entranceResults,
    clinicVisits,
    storeCatalog: (sources.storeItems || []).filter((row) => isYes(row.Active === undefined ? 'YES' : row.Active) && asMoneyNumber(row.Quantity) > 0),
    storeOrders: (sources.storeOrders || []).filter((row) => children.some((child) => financialReferenceMatches(row.AccountRef || row.AdmissionNo, child)))
  };
}

async function getChildActivity(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const code = clean(body.code || body.VerificationCode).toUpperCase();
  const accountRef = clean(body.accountRef || body.AccountRef || body.AdmissionNo);
  const sourceType = lower(body.sourceType || body.SourceType);
  const collection = sourceType === 'application' ? 'applications' : 'students';
  const selectedRow = await getSelectedIdentityRow(env, collection, accountRef, body.scopePath || body.ScopePath);
  const schoolProfile = await getSchoolProfile(env);
  let child = null;
  let applications = [];
  if (selectedRow && collection === 'students') {
    const student = normalizeStudent(selectedRow, schoolProfile);
    const emailMatches = lower(student.ParentEmail || student.Email || student.VerificationEmail) === email;
    const codeMatches = [student.ParentLoginCode, student.VerificationCode, student.LoginCode]
      .map((value) => clean(value).toUpperCase()).includes(code);
    if (emailMatches && codeMatches) child = student;
  } else if (selectedRow) {
    const application = selectedRow;
    const emailMatches = [application.VerificationEmail, application.ParentEmail, application.Email]
      .some((value) => lower(value) === email);
    const codeMatches = clean(application.VerificationCode).toUpperCase() === code;
    if (emailMatches && codeMatches) {
      applications = [application];
      child = normalizeApplicationChild(application, schoolProfile);
    }
  }
  if (!child) {
    const identitySources = await loadParentSources(env, 'identity', body);
    const access = await assertParentAccess(identitySources, email, code);
    applications = access.applications;
    child = (identitySources.students || [])
      .map((row) => normalizeStudent(row, schoolProfile))
      .find((row) => parentOwnsStudent(row, email, applications, access.matchingApplications) && financialReferenceMatches(accountRef, row));
    if (!child) {
      child = applications.map((row) => normalizeApplicationChild(row, schoolProfile))
        .find((row) => financialReferenceMatches(accountRef, row));
    }
  }
  if (!child) {
    const err = new Error('The selected child was not found for this parent account.');
    err.status = 404;
    throw err;
  }
  const keys = accountKeys(child);
  const [ledgerRows, invoiceRows, paymentRows, clinicRows, summaryRows, linkedApplication, storeItems, storeOrderRows] = await Promise.all([
    queryRowsForReferences(env, 'ledger', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], keys),
    queryRowsForReferences(env, 'invoices', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], keys),
    queryRowsForReferences(env, 'payments', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], keys),
    queryRowsForReferences(env, 'clinicRecords', ['AdmissionNo'], keys),
    Promise.all(keys.slice(0, 3).map((key) => getDocument(env, 'accountSummaries', safeDocumentId(key)).catch(() => null))),
    child.ApplicationReference
      ? getSelectedIdentityRow(env, 'applications', child.ApplicationReference)
      : Promise.resolve(null),
    listCollection(env, 'storeItems').catch(() => []),
    queryRowsForReferences(env, 'storeOrders', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], keys)
  ]);
  if (linkedApplication && !applications.some((row) => applicationMatchesChild(row, child))) {
    applications.push(linkedApplication);
  }
  const ledger = ledgerRows.map(normalizeLedger);
  const invoices = invoiceRows.map(normalizeInvoice);
  const payments = paymentRows.map(normalizePayment);
  const clinic = clinicRows.map(normalizeClinicRecord);
  const walletEntries = ledger.filter((entry) => financialReferenceMatches(entry.AccountRef, child) && lower(entry.FeeCategory) === 'wallet')
    .sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
  const childLedger = ledger.filter((entry) => financialReferenceMatches(entry.AccountRef, child));
  const accountSummary = accountSummaryForKeys(summaryRows.filter(Boolean), keys, childLedger);
  child.TotalDebit = accountSummary.TotalDebit;
  child.TotalCredit = accountSummary.TotalCredit;
  child.OutstandingBalance = accountSummary.OutstandingBalance;
  child.CreditBalance = accountSummary.CreditBalance;
  const resultSource = applications.find((app) => applicationMatchesChild(app, child)) ||
    (child.SourceType === 'Application' ? child : null);
  const result = buildEntranceResult(resultSource, schoolProfile);
  return {
    ok: true,
    accountRef: child.AccountRef,
    walletActivity: walletEntries,
    walletBalance: walletBalance(walletEntries),
    accountSummary,
    paymentRecords: paymentHistoryForChild(child, payments, ledger),
    dueNotifications: invoiceDueNotifications(invoices, keys, accountSummary, child),
    clinicVisits: clinic.filter((record) => financialReferenceMatches(record.AdmissionNo, child)).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date))),
    showResultsOnline: schoolResultsAreVisible(schoolProfile),
    resultDisplayMode: lower(schoolProfile.ResultDisplayMode) === 'percentage' ? 'percentage' : 'subjects',
    entranceResults: result ? [result] : [],
    storeCatalog: (storeItems || []).filter((row) => isYes(row.Active === undefined ? 'YES' : row.Active) && asMoneyNumber(row.Quantity) > 0),
    storeOrders: (storeOrderRows || []).filter((row) => financialReferenceMatches(row.AccountRef || row.AdmissionNo, child))
  };
}

async function updateWalletRestrictions(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  requireFirestoreEnv(env);
  const sources = await loadParentSources(env, 'full', body);
  const { applications } = await assertParentAccess(sources, email, body.code || body.VerificationCode);
  const students = (sources.students || []).map(normalizeStudent);
  const accountRef = clean(body.accountRef || body.AccountRef || body.AdmissionNo);
  const student = students.find((row) => {
    return parentOwnsStudent(row, email, applications) &&
      accountKeys(row).some((key) => sameText(key, accountRef));
  });
  if (!student) {
    const err = new Error('The selected child was not found for this parent account.');
    err.status = 404;
    throw err;
  }
  const status = clean(body.walletCardStatus || body.WalletCardStatus || 'Active');
  const updates = {
    ...student,
    WalletCardStatus: ['active', 'blocked'].includes(lower(status)) ? status : 'Active',
    WalletTxnLimit: asMoneyNumber(body.walletTxnLimit || body.WalletTxnLimit),
    WalletDailyLimit: asMoneyNumber(body.walletDailyLimit || body.WalletDailyLimit),
    WalletPinThreshold: asMoneyNumber(body.walletPinThreshold || body.WalletPinThreshold),
    WalletRestrictionUpdatedBy: 'Parent',
    WalletRestrictionUpdatedAt: nowIso()
  };
  await upsertSchoolDocument(env, 'students', safeDocumentId(student.AdmissionNo || student.AccountRef), updates);
  return { ok: true, message: 'Wallet restrictions saved.' };
}

async function getChildPayable(env, body) {
  const payable = await getPayableFees(env, {
    Email: body.email || body.ParentEmail || body.Email,
    VerificationCode: body.code || body.VerificationCode,
    AccountRef: body.accountRef || body.AccountRef || body.AdmissionNo,
    SourceType: body.sourceType || body.SourceType,
    ScopePath: body.scopePath || body.ScopePath
  });
  const items = buildPayableItems(payable.fees || [], payable.schoolFeeBreakdown || []);
  if (!items.some(isWalletFee) && clean(payable.account && payable.account.AdmissionNo)) {
    items.push(walletTopupItem(payable.account));
  }
  const itemNotices = items
    .filter((item) => clean(item.DueDate))
    .map((item) => ({
      FeeCode: item.FeeCode,
      FeeName: item.FeeName,
      FeeCategory: item.FeeCategory,
      Amount: item.Amount,
      OriginalAmount: item.OriginalAmount || item.Amount,
      CreditApplied: item.CreditApplied || '',
      AcceptanceCreditApplied: item.AcceptanceCreditApplied || '',
      SchoolFeesTotalCreditApplied: item.SchoolFeesTotalCreditApplied || '',
      GeneralFeeCreditApplied: item.GeneralFeeCreditApplied || '',
      PreviousFeePaymentApplied: item.PreviousFeePaymentApplied || '',
      BalanceAmount: item.BalanceAmount || item.Amount,
      Currency: item.Currency || 'NGN',
      AcademicSession: item.AcademicSession || '',
      Term: item.Term || '',
      DueDate: item.DueDate,
      DueStatus: dueStatus(item.DueDate),
      AllowInstallment: item.AllowInstallment || '',
      MinAmount: item.MinAmount || '',
      MaxAmount: item.MaxAmount || '',
      Components: item.Components || []
    }));
  return {
    ok: true,
    message: 'Payable items loaded.',
    accountRef: clean(body.accountRef || body.AccountRef || body.AdmissionNo),
    payableItems: items,
    dueNotifications: itemNotices
  };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));
    const action = clean(body.action || body.Action || 'getDashboard');
    let data;
    if (action === 'updateWalletRestrictions') {
      data = await updateWalletRestrictions(env, body);
    } else if (action === 'getChildActivity') {
      data = await getChildActivity(env, body);
    } else if (action === 'getChildPayable') {
      data = await getChildPayable(env, body);
    } else if (action === 'getAdmissionDocument') {
      data = await getParentAdmissionDocument(env, body);
      return new Response(data.pdfBytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${data.fileName}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    } else {
      data = await getDashboard(env, body);
    }
    return Response.json(data, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache'
      }
    });
  } catch (err) {
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, {
      status: err.status || 500,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        Pragma: 'no-cache'
      }
    });
  }
}
