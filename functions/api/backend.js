import { batchUpsertDocuments, createDocumentIfAbsent, deleteDocument, findOneByField, getDocument, listCollection, queryCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { deleteSchoolDocument, getSchoolDocumentById, getSchoolStructure, listSchoolCollection, querySchoolCollection, safeScopeId, upsertSchoolDocument } from '../lib/school-scope.js';
import { canonicalConfiguredClass, classNamesMatch } from '../lib/class-names.js';
import { categoryApplies, ensureStoreCategories, resolveStoreCategory, saveStoreCategory } from '../lib/store-categories.js';
import {
  clonePayrollTaxProfile, getPayrollTaxConfiguration, migratePayrollTaxPhase2,
  PAYROLL_TAX_COLLECTIONS, savePayrollSalaryComponent, savePayrollTaxBands,
  savePayrollTaxProfile, savePayrollTaxReliefRules, savePayrollLedgerMapping, seedTraditionalPayeConfiguration,
  validatePayrollTaxConfigurationData
} from '../lib/payroll/tax-config-service.js';
import { calculateConfigurablePayroll, calculateLegacyPayroll } from '../lib/payroll/payroll-calculation-service.js';
import { assertPayrollCanRegenerate, buildFinalizedRunSnapshot, validatePayrollForSubmission } from '../lib/payroll/payroll-run-guards.js';
import { buildPayrollJournalLines } from '../lib/payroll/payroll-ledger-service.js';
import { applyAuthoritativeActor, resolveAuthoritativeDesktopActor, secureTextEqual } from '../lib/backend-security.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';
import { organizationProfileDocument, resolveOrganizationConfig } from '../lib/organization-config.js';
import { handleChurchMembershipAction } from '../lib/church-membership.js';
import { CHURCH_COLLECTIONS, churchCollectionPath } from '../lib/church-foundation.js';
import { handleChurchServiceAction } from '../lib/church-services.js';
import { handleChurchFundAction } from '../lib/church-funds.js';
import { handleChurchOfferingAction } from '../lib/church-offerings.js';

export const SCHOOL_FEES_TOTAL_CODE = 'SCHOOL_FEES_TOTAL';

function clean(value) {
  return String(value ?? '').trim();
}

function normalizeSchoolCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DCA';
}

export async function getSchoolCode(env) {
  try {
    requireFirestoreEnv(env);
    const rows = await listCollection(env, 'settings');
    const profile = rows.find((row) => row.__id === 'schoolProfile') || rows.find((row) => clean(row.SchoolName));
    return normalizeSchoolCode((profile && profile.SchoolCode) || env.SCHOOL_CODE);
  } catch (_err) {
    return normalizeSchoolCode(env.SCHOOL_CODE);
  }
}

function lower(value) {
  return clean(value).toLowerCase();
}

function asMoneyNumber(value) {
  const raw = String(value ?? '0').trim();
  const negative = /^\s*\(.*\)\s*$/.test(raw);
  const normalized = raw.replace(/,/g, '').replace(/[^0-9.-]/g, '');
  const number = Number(normalized || '0') * (negative ? -1 : 1);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0;
}

function formatNairaAmount(value) {
  const text = clean(value);
  const number = Number(text.replace(/[₦\s,]/g, ''));
  if (!Number.isFinite(number) || number <= 0) return text;
  return `₦${number.toLocaleString('en-NG', {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

function yesNo(value) {
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  const text = lower(value);
  return ['yes', 'y', 'true', '1', 'paid', 'active'].includes(text) ? 'YES' : (text ? 'NO' : '');
}

function toDisplayDate(value) {
  const text = clean(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toISOString().slice(0, 10);
}

function timestampMs(value) {
  const text = clean(value);
  if (!text) return 0;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.getTime();
  const dateOnly = new Date(`${text}T00:00:00`);
  return Number.isNaN(dateOnly.getTime()) ? 0 : dateOnly.getTime();
}

function pick(row, keys, fallback = '') {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') {
      return row[key];
    }
  }
  return fallback;
}

function nameFormatOrder(value) {
  const text = clean(value).toLowerCase();
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : ['surname', 'first name', 'middle name'];
}

function formatPersonName(row, profile = {}, fallback = '') {
  const values = {
    'first name': pick(row, ['FirstName', 'firstName', 'GivenName']),
    'middle name': pick(row, ['MiddleName', 'middleName']),
    surname: pick(row, ['Surname', 'surname', 'LastName', 'lastName', 'FamilyName'])
  };
  const name = nameFormatOrder(profile.NameFormat || profile.nameFormat)
    .map((key) => clean(values[key]))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return name || clean(fallback);
}

function safeDocumentId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/-+/g, '-')
    .slice(0, 140);
}

function nowIso() {
  return new Date().toISOString();
}

function sameText(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

async function configuredClassNames(env) {
  try {
    const result = await getSchoolClasses(env);
    return result.classes || [];
  } catch (_err) {
    return [];
  }
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function generateParentLoginCode(existingCodes = new Set()) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
    if (!existingCodes.has(code)) return code;
  }
  return `P${Date.now().toString(36).toUpperCase().slice(-7)}`;
}

function applicationIdFrom(data) {
  return clean(data.ApplicationID || data.ApplicationReference || data.id || data.applicationReference);
}

function studentIdFrom(data) {
  return clean(data.AdmissionNo || data.AdmissionNumber || data.admissionNo || data.AccountRef);
}

async function findApplication(env, id) {
  const wanted = clean(id);
  if (!wanted) return null;
  const direct = await getSchoolDocumentById(env, 'applications', safeDocumentId(wanted));
  if (direct) return direct;
  for (const field of ['ApplicationReference', 'ApplicationID', 'applicationReference']) {
    const rows = await querySchoolCollection(env, 'applications', {
      filters: [{ field, op: '==', value: wanted }],
      limit: 1
    });
    if (rows[0]) return rows[0];
  }
  return null;
}

async function findApplicationForAdmissionDocument(env, body = {}) {
  const reference = clean(body.ApplicationReference || body.applicationReference || body.ApplicationID);
  const admissionNo = clean(body.AdmissionNo || body.admissionNo);
  const direct = await findApplication(env, reference || admissionNo);
  if (direct) return direct;
  if (admissionNo) {
    for (const field of ['AdmissionNo', 'admissionNo', 'AdmissionNumber']) {
      const rows = await querySchoolCollection(env, 'applications', {
        filters: [{ field, op: '==', value: admissionNo }],
        limit: 1
      });
      if (rows[0]) return rows[0];
    }
  }
  return null;
}

async function findStudent(env, admissionNo, applicationReference = '') {
  if (admissionNo) {
    const direct = await getSchoolDocumentById(env, 'students', safeDocumentId(admissionNo));
    if (direct) return direct;
    for (const field of ['AdmissionNo', 'admissionNo', 'AccountRef']) {
      const rows = await querySchoolCollection(env, 'students', {
        filters: [{ field, op: '==', value: clean(admissionNo) }],
        limit: 1
      });
      if (rows[0]) return rows[0];
    }
  }
  if (applicationReference) {
    for (const field of ['ApplicationReference', 'applicationReference']) {
      const rows = await querySchoolCollection(env, 'students', {
        filters: [{ field, op: '==', value: clean(applicationReference) }],
        limit: 1
      });
      if (rows[0]) return rows[0];
    }
  }
  return null;
}

async function findStudentByWalletCard(env, cardId) {
  const wanted = clean(cardId).toUpperCase();
  if (!wanted) return null;
  const rows = await listSchoolCollection(env, 'students');
  return rows.map(normalizeStudent).find((row) => clean(row.WalletCardId).toUpperCase() === wanted) || null;
}

async function findStudentByAccountRef(env, accountRef) {
  const wanted = clean(accountRef);
  if (!wanted) return null;
  const direct = await getSchoolDocumentById(env, 'students', safeDocumentId(wanted));
  if (direct) return normalizeStudent(direct);
  for (const field of ['AdmissionNo', 'AccountRef', 'ApplicationReference']) {
    const rows = await querySchoolCollection(env, 'students', {
      filters: [{ field, op: '==', value: wanted }],
      limit: 1
    });
    if (rows[0]) return normalizeStudent(rows[0]);
  }
  return null;
}

function findStudentByAccountRefInRows(rows, accountRef) {
  const wanted = clean(accountRef);
  if (!wanted) return null;
  const normalized = (rows || []).map(normalizeStudent);
  return normalized.find((row) => [row.AdmissionNo, row.AccountRef, row.__id].some((value) => value && sameReferenceIdentity(value, wanted))) ||
    normalized.find((row) => sameReferenceIdentity(row.ApplicationReference, wanted)) || null;
}

async function saveApplication(env, application) {
  const id = pick(application, ['ApplicationReference', 'ApplicationID', 'applicationReference', '__id']);
  if (!id) {
    const err = new Error('ApplicationReference is required.');
    err.status = 400;
    throw err;
  }
  const saved = await upsertSchoolDocument(env, 'applications', safeDocumentId(id), application);
  return normalizeApplication(saved);
}

async function saveStudent(env, student) {
  const id = pick(student, ['AdmissionNo', 'admissionNo', 'AccountRef', '__id']);
  if (!id) {
    const err = new Error('AdmissionNo is required.');
    err.status = 400;
    throw err;
  }
  const saved = await upsertSchoolDocument(env, 'students', safeDocumentId(id), student);
  return normalizeStudent(saved);
}

async function updateStudentProfile(env, body) {
  const accountRef = clean(body.AccountRef || body.AdmissionNo || body.accountRef);
  const existing = await findStudentByAccountRef(env, accountRef);
  if (!existing) throw applicationNotFound(accountRef);
  const editableFields = [
    'DisplayName', 'ApplicantName', 'Surname', 'FirstName', 'MiddleName', 'Gender',
    'DateOfBirth', 'ClassName', 'ClassArm', 'StudentType', 'BillingCategory',
    'EnrollmentCategory', 'AcademicProgress', 'AcademicSession', 'Term', 'ParentName',
    'ParentPhone', 'ParentEmail', 'ResidentialAddress', 'CityArea', 'StateOfResidence',
    'BloodGroup', 'Genotype', 'MedicalCondition', 'EmergencyContactName',
    'EmergencyContactPhone', 'PreviousSchool', 'VerificationCode', 'ParentLoginCode',
    'WalletCardId', 'WalletCardStatus', 'Status', 'StatusReason', 'StatusEffectiveDate',
    'ExpectedReturnDate'
  ];
  const updated = { ...existing };
  editableFields.forEach((field) => {
    if (body[field] !== undefined) updated[field] = clean(body[field]);
  });
  if (body.ClassName !== undefined) {
    updated.ClassName = canonicalConfiguredClass(body.ClassName, await configuredClassNames(env));
    updated.ClassAdmitted = updated.ClassName;
  }
  if (body.ParentEmail !== undefined) updated.ParentEmail = lower(body.ParentEmail);
  if (body.VerificationCode !== undefined || body.ParentLoginCode !== undefined) {
    const loginCode = clean(body.ParentLoginCode ?? body.VerificationCode).toUpperCase();
    updated.ParentLoginCode = loginCode;
    updated.VerificationCode = loginCode;
  }
  if (body.DisplayName !== undefined) updated.ApplicantName = clean(body.DisplayName);
  updated.UpdatedAt = nowIso();
  updated.UpdatedBy = clean(body.UpdatedBy || body.RecordedBy) || 'Student Register';
  const student = await saveStudent(env, updated);
  return { ok: true, message: 'Student profile updated.', student };
}

function normalizeApplication(row, profile = {}) {
  const parent = row.parent && typeof row.parent === 'object' ? row.parent : {};
  const applicantName = formatPersonName(row, profile, pick(row, ['applicantName', 'ApplicantName', 'displayName', 'DisplayName']));
  return {
    ...row,
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference', '__id']),
    ApplicationID: pick(row, ['applicationReference', 'ApplicationReference', '__id']),
    ApplicantName: applicantName,
    Name: applicantName,
    Surname: pick(row, ['surname', 'Surname']),
    FirstName: pick(row, ['firstName', 'FirstName']),
    MiddleName: pick(row, ['middleName', 'MiddleName']),
    Gender: pick(row, ['gender', 'Gender']),
    DateOfBirth: toDisplayDate(pick(row, ['dateOfBirth', 'DateOfBirth'])),
    ClassApplyingFor: pick(row, ['classApplyingFor', 'ClassApplyingFor', 'className', 'ClassName']),
    StudentType: pick(row, ['studentType', 'StudentType'], 'Day Student'),
    Status: pick(row, ['status', 'Status'], 'Submitted'),
    ResultStatus: pick(row, ['resultStatus', 'ResultStatus']),
    OfferSent: yesNo(pick(row, ['offerSent', 'OfferSent'])),
    OfferSentAt: toDisplayDate(pick(row, ['offerSentAt', 'OfferSentAt'])),
    AdmissionLetterSent: yesNo(pick(row, ['admissionLetterSent', 'AdmissionLetterSent'])),
    AdmissionLetterSentAt: toDisplayDate(pick(row, ['admissionLetterSentAt', 'AdmissionLetterSentAt'])),
    AcceptanceFeePaid: yesNo(pick(row, ['acceptanceFeePaid', 'AcceptanceFeePaid'])),
    AcceptanceFeePaidAt: toDisplayDate(pick(row, ['acceptanceFeePaidAt', 'AcceptanceFeePaidAt'])),
    Enrolled: yesNo(pick(row, ['enrolled', 'Enrolled'])),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession']),
    Term: pick(row, ['term', 'Term']),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory'], 'Regular'),
    VerificationEmail: lower(pick(row, ['verificationEmail', 'VerificationEmail', 'email', 'Email'], parent.email)),
    VerificationCode: clean(pick(row, ['verificationCode', 'VerificationCode'])).toUpperCase(),
    Email: lower(pick(row, ['email', 'Email'], parent.email)),
    Phone: pick(row, ['phone', 'Phone'], parent.phone),
    ParentName: pick(row, ['parentName', 'ParentName'], parent.name),
    ParentEmail: lower(pick(row, ['parentEmail', 'ParentEmail'], parent.email)),
    ParentPhone: pick(row, ['parentPhone', 'ParentPhone'], parent.phone),
    SubmittedAt: toDisplayDate(pick(row, ['createdAt', 'submittedAt', 'SubmittedAt'])),
    UpdatedAt: toDisplayDate(pick(row, ['updatedAt', 'UpdatedAt']))
  };
}

function normalizeStudent(row, profile = {}) {
  const displayName = formatPersonName(row, profile, pick(row, ['displayName', 'DisplayName', 'applicantName', 'ApplicantName']));
  return {
    ...row,
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo', '__id']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    ApplicantName: displayName,
    DisplayName: displayName,
    ClassAdmitted: pick(row, ['className', 'ClassName', 'classAdmitted', 'ClassAdmitted']),
    ClassName: pick(row, ['className', 'ClassName', 'classAdmitted', 'ClassAdmitted']),
    ClassArm: pick(row, ['classArm', 'ClassArm', 'arm', 'Arm']),
    StudentType: pick(row, ['studentType', 'StudentType'], 'Day Student'),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory'], 'Regular'),
    Gender: pick(row, ['gender', 'Gender', 'sex', 'Sex']),
    EnrollmentCategory: pick(row, ['enrollmentCategory', 'EnrollmentCategory', 'IntakeCategory', 'StudentEntryType'], 'Returning'),
    AcademicProgress: pick(row, ['academicProgress', 'AcademicProgress', 'ProgressCategory', 'RepeaterStatus'], 'Promoted'),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession']),
    Term: pick(row, ['term', 'Term']),
    ParentEmail: lower(pick(row, ['parentEmail', 'ParentEmail'])),
    ParentPhone: pick(row, ['parentPhone', 'ParentPhone']),
    VerificationCode: clean(pick(row, ['verificationCode', 'VerificationCode', 'parentLoginCode', 'ParentLoginCode', 'loginCode', 'LoginCode'])).toUpperCase(),
    ParentLoginCode: clean(pick(row, ['parentLoginCode', 'ParentLoginCode', 'verificationCode', 'VerificationCode', 'loginCode', 'LoginCode'])).toUpperCase(),
    WalletCardId: pick(row, ['walletCardId', 'WalletCardId']),
    WalletCardStatus: pick(row, ['walletCardStatus', 'WalletCardStatus']),
    WalletPinHash: pick(row, ['walletPinHash', 'WalletPinHash']),
    WalletPinSetAt: toDisplayDate(pick(row, ['walletPinSetAt', 'WalletPinSetAt'])),
    WalletDailyLimit: asMoneyNumber(pick(row, ['walletDailyLimit', 'WalletDailyLimit'])),
    WalletTxnLimit: asMoneyNumber(pick(row, ['walletTxnLimit', 'WalletTxnLimit'])),
    WalletPinThreshold: asMoneyNumber(pick(row, ['walletPinThreshold', 'WalletPinThreshold'])),
    WalletUpdatedAt: toDisplayDate(pick(row, ['walletUpdatedAt', 'WalletUpdatedAt'])),
    Status: pick(row, ['status', 'Status'], 'Active'),
    StatusReason: pick(row, ['statusReason', 'StatusReason', 'WithdrawalReason', 'LeaveReason']),
    StatusEffectiveDate: toDisplayDate(pick(row, ['statusEffectiveDate', 'StatusEffectiveDate'])),
    ExpectedReturnDate: toDisplayDate(pick(row, ['expectedReturnDate', 'ExpectedReturnDate']))
  };
}

function studentLoginCode(row) {
  return clean(pick(row, ['ParentLoginCode', 'parentLoginCode', 'VerificationCode', 'verificationCode', 'LoginCode', 'loginCode'])).toUpperCase();
}

function studentLoginCodes(row) {
  return [...new Set([
    row && row.ParentLoginCode, row && row.parentLoginCode,
    row && row.VerificationCode, row && row.verificationCode,
    row && row.LoginCode, row && row.loginCode
  ].map((value) => clean(value).toUpperCase()).filter(Boolean))];
}

function normalizeAccount(row) {
  return {
    ...row,
    AccountRef: pick(row, ['accountRef', 'AccountRef', '__id']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    DisplayName: pick(row, ['displayName', 'DisplayName']),
    ClassName: pick(row, ['className', 'ClassName']),
    StudentType: pick(row, ['studentType', 'StudentType']),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory'], 'Regular'),
    Gender: pick(row, ['gender', 'Gender']),
    EnrollmentCategory: pick(row, ['enrollmentCategory', 'EnrollmentCategory'], 'Returning'),
    AcademicProgress: pick(row, ['academicProgress', 'AcademicProgress'], 'Promoted'),
    TotalDebit: asMoneyNumber(pick(row, ['totalDebit', 'TotalDebit'])),
    TotalCredit: asMoneyNumber(pick(row, ['totalCredit', 'TotalCredit'])),
    Balance: asMoneyNumber(pick(row, ['balance', 'Balance'])),
    WalletBalance: asMoneyNumber(pick(row, ['walletBalance', 'WalletBalance'])),
    LastPaymentAt: toDisplayDate(pick(row, ['lastPaymentAt', 'LastPaymentAt'])),
    Status: pick(row, ['status', 'Status'])
  };
}

function normalizeFeeItem(row) {
  return {
    ...row,
    FeeCode: pick(row, ['feeCode', 'FeeCode', '__id']),
    FeeName: pick(row, ['feeName', 'FeeName']),
    FeeCategory: pick(row, ['feeCategory', 'FeeCategory'], 'School Fee'),
    ClassName: pick(row, ['className', 'ClassName'], 'All'),
    StudentType: pick(row, ['studentType', 'StudentType'], 'All'),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory'], 'All'),
    Gender: pick(row, ['gender', 'Gender'], 'All'),
    EnrollmentCategory: pick(row, ['enrollmentCategory', 'EnrollmentCategory', 'IntakeCategory'], 'All'),
    AcademicProgress: pick(row, ['academicProgress', 'AcademicProgress', 'ProgressCategory'], 'All'),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession'], 'All'),
    Term: pick(row, ['term', 'Term'], 'All'),
    Amount: asMoneyNumber(pick(row, ['amount', 'Amount'])),
    Currency: pick(row, ['currency', 'Currency'], 'NGN'),
    PayableOnline: yesNo(pick(row, ['payableOnline', 'PayableOnline'])),
    AllowInstallment: yesNo(pick(row, ['allowInstallment', 'AllowInstallment'])),
    PartPaymentMode: pick(row, ['partPaymentMode', 'PartPaymentMode'], 'Item'),
    MinAmount: asMoneyNumber(pick(row, ['minAmount', 'MinAmount'])),
    MaxAmount: asMoneyNumber(pick(row, ['maxAmount', 'MaxAmount'])),
    DueDate: toDisplayDate(pick(row, ['dueDate', 'DueDate', 'PaymentDueDate', 'paymentDueDate'])),
    RequiredForEnrollment: yesNo(pick(row, ['requiredForEnrollment', 'RequiredForEnrollment'])),
    Active: yesNo(pick(row, ['active', 'Active'])),
    SortOrder: asMoneyNumber(pick(row, ['sortOrder', 'SortOrder'], 100))
  };
}

function normalizeInvoice(row) {
  return {
    ...row,
    InvoiceId: pick(row, ['invoiceId', 'InvoiceId', '__id']),
    AccountRef: pick(row, ['accountRef', 'AccountRef']),
    FeeCode: pick(row, ['feeCode', 'FeeCode']),
    FeeName: pick(row, ['feeName', 'FeeName']),
    FeeCategory: pick(row, ['feeCategory', 'FeeCategory']),
    Debit: asMoneyNumber(pick(row, ['amount', 'Amount', 'Debit'])),
    Credit: asMoneyNumber(pick(row, ['paidAmount', 'PaidAmount', 'Credit'])),
    Balance: asMoneyNumber(pick(row, ['balanceAmount', 'BalanceAmount', 'Balance'])),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession']),
    Term: pick(row, ['term', 'Term']),
    Status: pick(row, ['status', 'Status']),
    Date: toDisplayDate(pick(row, ['createdAt', 'Date']))
  };
}

function normalizePayment(row) {
  return {
    ...row,
    PaymentId: pick(row, ['paymentId', 'PaymentId', '__id']),
    AccountRef: pick(row, ['accountRef', 'AccountRef']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    DisplayName: pick(row, ['displayName', 'DisplayName']),
    ClassName: pick(row, ['className', 'ClassName']),
    StudentType: pick(row, ['studentType', 'StudentType']),
    BillingCategory: pick(row, ['billingCategory', 'BillingCategory']),
    FeeCode: pick(row, ['feeCode', 'FeeCode']),
    FeeName: pick(row, ['feeName', 'FeeName']),
    FeeCategory: pick(row, ['feeCategory', 'FeeCategory']),
    Amount: asMoneyNumber(pick(row, ['amount', 'Amount'])),
    GrossAmount: asMoneyNumber(pick(row, ['grossAmount', 'GrossAmount', 'amount', 'Amount'])),
    GatewayFee: asMoneyNumber(pick(row, ['gatewayFee', 'GatewayFee'])),
    NetAmount: asMoneyNumber(pick(row, ['netAmount', 'NetAmount', 'amount', 'Amount'])),
    Currency: pick(row, ['currency', 'Currency'], 'NGN'),
    Gateway: pick(row, ['gateway', 'Gateway']),
    Method: pick(row, ['method', 'Method']),
    Reference: pick(row, ['reference', 'Reference']),
    GatewayReference: pick(row, ['gatewayReference', 'GatewayReference']),
    AcademicSession: pick(row, ['academicSession', 'AcademicSession']),
    Term: pick(row, ['term', 'Term']),
    Status: pick(row, ['status', 'Status'], 'Paid'),
    Metadata: pick(row, ['metadata', 'Metadata']),
    Date: toDisplayDate(pick(row, ['paidAt', 'Date'])),
    RecordedBy: pick(row, ['recordedBy', 'RecordedBy'])
  };
}

function normalizeLedger(row) {
  return {
    ...row,
    LedgerNo: pick(row, ['ledgerNo', 'LedgerNo', 'LedgerId', 'LedgerID', '__id']),
    Date: toDisplayDate(pick(row, ['date', 'Date', 'createdAt', 'CreatedAt'])),
    RawDate: pick(row, ['date', 'Date', 'createdAt', 'CreatedAt', 'paidAt', 'PaidAt']),
    AccountRef: pick(row, ['accountRef', 'AccountRef']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    DisplayName: pick(row, ['displayName', 'DisplayName']),
    ClassName: pick(row, ['className', 'ClassName']),
    EntryType: pick(row, ['entryType', 'EntryType']),
    FeeCode: pick(row, ['feeCode', 'FeeCode']),
    FeeName: pick(row, ['feeName', 'FeeName']),
    FeeCategory: pick(row, ['feeCategory', 'FeeCategory']),
    Description: pick(row, ['description', 'Description']),
    Debit: asMoneyNumber(pick(row, ['debit', 'Debit'])),
    Credit: asMoneyNumber(pick(row, ['credit', 'Credit'])),
    Currency: pick(row, ['currency', 'Currency'], 'NGN'),
    Reference: pick(row, ['reference', 'Reference']),
    RecordedBy: pick(row, ['recordedBy', 'RecordedBy']),
    Source: pick(row, ['source', 'Source']),
    Metadata: pick(row, ['metadata', 'Metadata'])
  };
}

function normalizeClinicRecord(row) {
  return {
    ...row,
    RecordId: pick(row, ['recordId', 'RecordId', '__id']),
    Date: toDisplayDate(pick(row, ['createdAt', 'Date'])),
    AdmissionNo: pick(row, ['admissionNo', 'AdmissionNo']),
    StudentName: pick(row, ['studentName', 'StudentName']),
    ClassName: pick(row, ['className', 'ClassName']),
    Complaint: pick(row, ['complaint', 'Complaint']),
    Treatment: pick(row, ['treatment', 'Treatment']),
    Disposition: pick(row, ['disposition', 'Disposition']),
    RecordedBy: pick(row, ['recordedBy', 'RecordedBy']),
    ReviewedBy: pick(row, ['reviewedBy', 'ReviewedBy']),
    Notes: pick(row, ['notes', 'Notes'])
  };
}

function normalizeInventory(row) {
  return {
    ...row,
    ItemName: pick(row, ['itemName', 'ItemName', '__id']),
    Category: pick(row, ['category', 'Category']),
    Unit: pick(row, ['unit', 'Unit']),
    Quantity: asMoneyNumber(pick(row, ['quantity', 'Quantity'])),
    ReorderLevel: asMoneyNumber(pick(row, ['reorderLevel', 'ReorderLevel'])),
    LastUpdated: toDisplayDate(pick(row, ['lastUpdated', 'LastUpdated'])),
    Notes: pick(row, ['notes', 'Notes'])
  };
}

function requireBackendSecret(env, body) {
  const expected = clean(env.BACKEND_SHARED_SECRET || env.GOOGLE_APPS_SCRIPT_SECRET);
  if (!expected) return;
  const supplied = clean(body.Secret || body.secret);
  if (!secureTextEqual(supplied, expected)) {
    const err = new Error('Unauthorized.');
    err.status = 401;
    throw err;
  }
}

const VERIFIED_ACTOR_ACTIONS = new Set([
  'exportBackup', 'getAccountingOverview', 'getSystemHealth', 'optimizeFirestoreData', 'getPayrollTaxConfiguration',
  'seedTraditionalPayeConfiguration', 'savePayrollSalaryComponent', 'savePayrollTaxProfile',
  'clonePayrollTaxProfile', 'savePayrollTaxBands', 'savePayrollTaxReliefRules',
  'savePayrollLedgerMapping', 'validatePayrollTaxConfiguration', 'migratePayrollTaxPhase2',
  'savePayrollProfile', 'createPayrollProfilesFromStaff', 'importPayrollProfiles',
  'generatePayrollRun', 'requestPayrollTaxOverride', 'approvePayrollTaxOverride',
  'savePayrollRunStatus', 'payPayrollItem',
  'getChurchMembership', 'saveChurchMember', 'saveChurchHousehold', 'importChurchMembers',
  'getChurchServices', 'saveChurchService', 'saveChurchServiceOccurrence', 'recordChurchAttendance',
  'getChurchFunds', 'saveChurchFund', 'saveChurchFundMapping',
  'getChurchOfferings', 'saveChurchOffering', 'reconcileChurchOffering'
]);

async function verifyDesktopActor(env, action, body) {
  if (!VERIFIED_ACTOR_ACTIONS.has(action)) return body;
  const users = await listCollection(env, 'staffUsers').catch((error) => {
    error.status = error.status || 503;
    throw error;
  });
  return applyAuthoritativeActor(body, resolveAuthoritativeDesktopActor(body, users, env));
}

function normalizeMatchText(value) {
  return clean(value).toLowerCase();
}

function normalizeReferenceText(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
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
  const aParts = a.match(/^([a-z]+)(\d+)(\d+)$/);
  const bParts = b.match(/^([a-z]+)(\d+)(\d+)$/);
  return Boolean(aParts && bParts && aParts[1] === bParts[1] && aParts[2] === bParts[2] && String(Number(aParts[3])) === String(Number(bParts[3])));
}

function isAcceptanceFeeLike(row) {
  const parts = [
    row && row.FeeCode,
    row && row.FeeName,
    row && row.FeeCategory,
    row && row.PaymentType,
    row && row.EntryType,
    row && row.Description
  ].map((value) => normalizeMatchText(value)).join(' ');
  const compact = parts.replace(/[^a-z0-9]+/g, ' ');
  return parts.includes('acceptance_fee') ||
    parts.includes('acceptance fee') ||
    (parts.includes('acceptance') && parts.includes('admission')) ||
    (/\baccept(?:ance)?\b/.test(compact) && /\b(fee|admission|day|board)/.test(compact));
}

function accountRefsFrom(row) {
  return [
    row && row.AccountRef,
    row && row.ApplicationReference,
    row && row.ApplicationID,
    row && row.AdmissionNo,
    row && row.AdmissionNumber
  ].map(clean).filter(Boolean);
}

function referencesAny(left, refs) {
  const wanted = clean(left);
  if (!wanted) return false;
  return (refs || []).some((ref) => sameText(wanted, ref) || referencesMatch(wanted, ref));
}

function referenceIdentityKey(value) {
  return clean(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .join('|');
}

function sameReferenceIdentity(left, right) {
  const a = referenceIdentityKey(left);
  const b = referenceIdentityKey(right);
  return Boolean(a && b && a === b);
}

export function financialRowMatchesAccount(row, account) {
  // Match like-for-like identity fields. Falling back from AccountRef to
  // AdmissionNo allowed one payment to hit two students when an imported
  // admission number happened to equal another student's account reference.
  const rowAccountRef = clean(row && row.AccountRef);
  if (rowAccountRef) return sameReferenceIdentity(rowAccountRef, account && account.AccountRef);
  const rowAdmissionNo = clean(row && row.AdmissionNo);
  if (rowAdmissionNo) return sameReferenceIdentity(rowAdmissionNo, account && account.AdmissionNo);
  const rowApplication = clean(row && (row.ApplicationReference || row.ApplicationID));
  const accountApplication = clean(account && (account.ApplicationReference || account.ApplicationID));
  return Boolean(rowApplication && sameReferenceIdentity(rowApplication, accountApplication));
}

export function financialRowMatchesLinkedApplication(row, account) {
  if (financialRowMatchesAccount(row, account)) return true;
  const rowApplication = clean(row && (row.ApplicationReference || row.ApplicationID));
  const accountApplication = clean(account && (account.ApplicationReference || account.ApplicationID));
  return Boolean(rowApplication && accountApplication &&
    sameReferenceIdentity(rowApplication, accountApplication));
}

function displayNameFromApplication(app) {
  return clean(pick(app, ['ApplicantName', 'DisplayName', 'Name'])) ||
    [pick(app, ['Surname']), pick(app, ['FirstName']), pick(app, ['MiddleName'])].map(clean).filter(Boolean).join(' ');
}

function accountRefFromApplication(app) {
  return clean(pick(app, ['AdmissionNo', 'AdmissionNumber', 'ApplicationReference', 'ApplicationID', '__id']));
}

function feeMatchVariants(value) {
  const text = normalizeMatchText(value);
  const compact = text.replace(/[^a-z0-9]/g, '');
  const variants = {};
  if (text) variants[text] = true;
  if (compact) variants[compact] = true;
  const levelMatch = text.match(/\b(jss|ss|primary|nursery|grade)\s*([0-9]+)/);
  if (levelMatch) variants[levelMatch[1] + levelMatch[2]] = true;
  if (text.includes('day')) variants.day = true;
  if (text.includes('boarding') || text.includes('boarder')) variants.boarding = true;
  return Object.keys(variants);
}

function feeFieldMatches(ruleValue, actualValue, allowBlankActual = false) {
  const rule = normalizeMatchText(ruleValue);
  if (!rule || rule === 'all' || rule === '*') return true;
  if (!normalizeMatchText(actualValue) && allowBlankActual) return true;
  if (!normalizeMatchText(actualValue)) return false;
  const actualVariants = feeMatchVariants(actualValue);
  const ruleVariants = [];
  rule.split(',').forEach((part) => {
    feeMatchVariants(part).forEach((variant) => ruleVariants.push(variant));
  });
  return ruleVariants.some((variant) => actualVariants.includes(variant));
}

function feeMatchesApplication(fee, app) {
  const appClass = app.ClassApplyingFor || app.ClassAdmitted || app.ClassName || '';
  const appType = app.StudentType || '';
  const appBillingCategory = app.BillingCategory || 'Regular';
  const appSession = app.AcademicSession || '';
  const appTerm = app.Term || '';
  const appGender = app.Gender || '';
  const enrollmentCategory = app.EnrollmentCategory || app.IntakeCategory ||
    (isNewIntakeApplication(app) ? 'New Intake' : 'Returning');
  const academicProgress = app.AcademicProgress || app.ProgressCategory || 'Promoted';
  if (normalizeMatchText(academicProgress) === 'repeating' && /book|uniform|school wear/.test(normalizeMatchText(`${fee.FeeCategory || ''} ${fee.FeeName || ''}`))) return false;
  return (!clean(fee.ClassName) || ['all', '*'].includes(normalizeMatchText(fee.ClassName)) || classNamesMatch(fee.ClassName, appClass)) &&
    feeFieldMatches(fee.StudentType, appType) &&
    feeFieldMatches(fee.BillingCategory || 'All', appBillingCategory, true) &&
    feeFieldMatches(fee.Gender || 'All', appGender) &&
    feeFieldMatches(fee.EnrollmentCategory || 'All', enrollmentCategory, true) &&
    feeFieldMatches(fee.AcademicProgress || 'All', academicProgress, true) &&
    feeFieldMatches(fee.AcademicSession, appSession) &&
    feeFieldMatches(fee.Term, appTerm);
}

export function isNewIntakeApplication(app = {}) {
  const value = normalizeMatchText(app.EnrollmentCategory || app.IntakeCategory || '');
  if (value) return ['new intake', 'new', 'newly admitted', 'new admission'].includes(value);
  const resultStatus = normalizeMatchText(app.ResultStatus || app.AdmissionDecision || '');
  const applicationStatus = normalizeMatchText(app.Status || '');
  return resultStatus === 'admitted' || ['admitted', 'accepted', 'admission letter sent'].includes(applicationStatus);
}

function termRank(value) {
  const term = normalizeMatchText(value);
  if (!term || term === 'all' || term === '*') return 0;
  if (term.includes('first') || term === '1' || term === 'term1') return 1;
  if (term.includes('second') || term === '2' || term === 'term2') return 2;
  if (term.includes('third') || term === '3' || term === 'term3') return 3;
  return 0;
}

function feeMatchesAccountPeriod(fee, app) {
  const appClass = app.ClassApplyingFor || app.ClassAdmitted || app.ClassName || '';
  const appType = app.StudentType || '';
  const appBillingCategory = app.BillingCategory || 'Regular';
  const appSession = app.AcademicSession || '';
  const appTerm = app.Term || '';
  if (normalizeMatchText(app.AcademicProgress || 'Promoted') === 'repeating' && /book|uniform|school wear/.test(normalizeMatchText(`${fee.FeeCategory || ''} ${fee.FeeName || ''}`))) return false;
  if (clean(fee.ClassName) && !['all', '*'].includes(normalizeMatchText(fee.ClassName)) && !classNamesMatch(fee.ClassName, appClass)) return false;
  if (!feeFieldMatches(fee.StudentType, appType)) return false;
  if (!feeFieldMatches(fee.BillingCategory || 'All', appBillingCategory, true)) return false;
  if (!feeFieldMatches(fee.Gender || 'All', app.Gender || '')) return false;
  const enrollmentCategory = app.EnrollmentCategory || app.IntakeCategory ||
    (isNewIntakeApplication(app) ? 'New Intake' : 'Returning');
  if (!feeFieldMatches(fee.EnrollmentCategory || 'All', enrollmentCategory, true)) return false;
  if (!feeFieldMatches(fee.AcademicProgress || 'All', app.AcademicProgress || 'Promoted', true)) return false;
  if (!feeFieldMatches(fee.AcademicSession, appSession)) return false;
  const feeTerm = normalizeMatchText(fee.Term || 'All');
  if (!feeTerm || feeTerm === 'all' || feeTerm === '*') return true;
  return feeFieldMatches(fee.Term, appTerm);
}

function feeBillingSpecificity(fee, app) {
  const rule = normalizeMatchText(fee.BillingCategory || 'All');
  const actual = normalizeMatchText(app.BillingCategory || 'Regular');
  if (!rule || rule === 'all' || rule === '*') return 0;
  return feeFieldMatches(fee.BillingCategory, actual || 'Regular', true) ? 2 : 0;
}

function feeOverrideKey(fee) {
  return [
    normalizeMatchText(fee.FeeName || fee.FeeCode || ''),
    normalizeMatchText(fee.FeeCategory || ''),
    normalizeMatchText(fee.ClassName || 'All'),
    normalizeMatchText(fee.StudentType || 'All'),
    normalizeMatchText(fee.Gender || 'All'),
    normalizeMatchText(fee.EnrollmentCategory || 'All'),
    normalizeMatchText(fee.AcademicProgress || 'All'),
    normalizeMatchText(fee.AcademicSession || 'All'),
    normalizeMatchText(fee.Term || 'All')
  ].join('||');
}

export function applyBillingCategoryOverrides(fees, app) {
  const grouped = {};
  fees.forEach((fee) => {
    const key = feeOverrideKey(fee);
    grouped[key] = grouped[key] || [];
    grouped[key].push(fee);
  });
  const result = [];
  Object.values(grouped).forEach((items) => {
    const bestSpecificity = Math.max(...items.map((item) => feeBillingSpecificity(item, app)));
    items.forEach((item) => {
      if (feeBillingSpecificity(item, app) === bestSpecificity) result.push(item);
    });
  });
  return result;
}

function isWalletFee(fee) {
  return clean(fee && fee.FeeCode) === 'WALLET_TOPUP' || normalizeMatchText(fee && fee.FeeCategory) === 'wallet';
}

function isOptionalSubscriptionFee(fee) {
  const category = normalizeMatchText(fee && fee.FeeCategory);
  if (['bus service', 'transport', 'club', 'optional', 'others'].includes(category)) return true;
  const feeCode = clean(fee && fee.FeeCode).toUpperCase();
  const feeName = normalizeMatchText(fee && fee.FeeName);
  const description = normalizeMatchText(fee && fee.Description);
  const reference = clean(fee && fee.Reference).toUpperCase();
  const metadata = parseMetadata(fee && fee.Metadata);
  const nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
  const metadataCategory = normalizeMatchText(metadata.feeCategory || nested.feeCategory);
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

function isWalletLedger(row) {
  return clean(row && row.FeeCode).toUpperCase() === 'WALLET_TOPUP' ||
    normalizeMatchText(row && row.FeeCategory) === 'wallet' ||
    normalizeMatchText(row && row.EntryType).includes('wallet');
}

function isWalletPurchaseEntry(row) {
  return normalizeMatchText(row && row.EntryType) === 'wallet purchase';
}

function isStorePurchase(row) {
  return normalizeMatchText(row && row.FeeCategory) === 'store' ||
    clean(row && row.FeeCode).toUpperCase() === 'STORE_CART' ||
    normalizeMatchText(row && row.EntryType).includes('store');
}

function extractStoreMetadata(payload) {
  const metadata = parseMetadata(payload);
  const nested = metadata && typeof metadata === 'object' && metadata.metadata && typeof metadata.metadata === 'object'
    ? metadata.metadata : {};
  return {
    ...metadata,
    ...nested
  };
}

function paymentStoreDepartment(row = {}) {
  const direct = normalizeMatchText(
    row.Department || row.department || row.StoreType || row.storeType ||
    row.store || row.category || row.Category || ''
  );
  if (direct) return direct;
  const metadata = extractStoreMetadata(row.Metadata);
  const cartStoreType = Array.isArray(metadata.storeCart)
    ? metadata.storeCart.find((item) => clean(item.StoreType || item.storeType).trim())
    : null;
  if (cartStoreType) return normalizeMatchText(cartStoreType.StoreType || cartStoreType.storeType);
  const metadataDepartment = clean(metadata.department || metadata.Department || metadata.storeType || metadata.storetype || metadata.StoreType);
  return normalizeMatchText(metadataDepartment);
}

function paymentIndicatesStorePurchase(row = {}) {
  if (isStorePurchase(row)) return true;
  const storeDepartment = paymentStoreDepartment(row);
  return ['bookstore', 'uniform store', 'store', 'tuck shop'].includes(storeDepartment);
}

function periodKey(key, session, term) {
  const cleanKey = clean(key);
  if (!cleanKey) return '';
  return [cleanKey, normalizeMatchText(session || ''), normalizeMatchText(term || '')].join('||');
}

function resolvedPeriodValue(ruleValue, actualValue) {
  const rule = clean(ruleValue);
  return !rule || ['all', '*'].includes(normalizeMatchText(rule)) ? clean(actualValue) : rule;
}

export function sameFinancialPeriod(row, session, term) {
  return sameText(row && row.AcademicSession, session) && sameText(row && row.Term, term);
}

export function paymentCreditedAmount(row = {}) {
  const amount = asMoneyNumber(row.Amount || row.amount);
  const gross = asMoneyNumber(row.GrossAmount || row.grossAmount || amount);
  const fee = asMoneyNumber(row.GatewayFee || row.gatewayFee);
  const explicitNet = asMoneyNumber(row.NetAmount || row.netAmount);
  if (fee <= 0) return amount;
  return Math.max(0, Math.min(gross, explicitNet || gross - fee));
}

export function calculateInvoiceCreditAllocations(invoices = [], creditAmount = 0) {
  let remaining = asMoneyNumber(creditAmount);
  const allocations = [];
  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const debit = asMoneyNumber(invoice.Debit || invoice.Amount);
    const priorCredit = asMoneyNumber(invoice.Credit || invoice.PaidAmount);
    const applied = Math.min(Math.max(0, debit - priorCredit), remaining);
    if (applied <= 0) continue;
    const credit = asMoneyNumber(priorCredit + applied);
    allocations.push({ invoice, AppliedCredit: applied, Credit: credit, Balance: Math.max(0, debit - credit), Status: debit <= credit ? 'Paid' : 'Part Paid' });
    remaining = asMoneyNumber(remaining - applied);
  }
  return { allocations, remaining };
}

function isPeriodSpecificFee(fee) {
  const session = normalizeMatchText(fee.AcademicSession || '');
  const term = normalizeMatchText(fee.Term || '');
  return Boolean((session && session !== 'all' && session !== '*') || (term && term !== 'all' && term !== '*'));
}

function periodMatchesFee(row, fee) {
  const feeSession = normalizeMatchText(fee.AcademicSession || '');
  const feeTerm = normalizeMatchText(fee.Term || '');
  const rowSession = normalizeMatchText(row.AcademicSession || '');
  const rowTerm = normalizeMatchText(row.Term || '');
  if (feeSession && feeSession !== 'all' && feeSession !== '*' && rowSession && rowSession !== feeSession) return false;
  if (feeTerm && feeTerm !== 'all' && feeTerm !== '*' && rowTerm && rowTerm !== feeTerm) return false;
  return true;
}

function feeMatchesAccountBase(fee, app) {
  const appClass = app.ClassApplyingFor || app.ClassAdmitted || app.ClassName || '';
  const appType = app.StudentType || '';
  const appBillingCategory = app.BillingCategory || 'Regular';
  const appSession = app.AcademicSession || '';
  if (normalizeMatchText(app.AcademicProgress || 'Promoted') === 'repeating' && /book|uniform|school wear/.test(normalizeMatchText(`${fee.FeeCategory || ''} ${fee.FeeName || ''}`))) return false;
  return (!clean(fee.ClassName) || ['all', '*'].includes(normalizeMatchText(fee.ClassName)) || classNamesMatch(fee.ClassName, appClass)) &&
    feeFieldMatches(fee.StudentType, appType) &&
    feeFieldMatches(fee.BillingCategory || 'All', appBillingCategory, true) &&
    feeFieldMatches(fee.Gender || 'All', app.Gender || '') &&
    feeFieldMatches(fee.EnrollmentCategory || 'All', app.EnrollmentCategory || 'Returning', true) &&
    feeFieldMatches(fee.AcademicProgress || 'All', app.AcademicProgress || 'Promoted', true) &&
    feeFieldMatches(fee.AcademicSession, appSession, true);
}

function parseFeeItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
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

function isSchoolFeesTotalPayment(row) {
  const feeCode = clean(row && row.FeeCode).toUpperCase();
  const feeName = normalizeMatchText(row && row.FeeName);
  const description = normalizeMatchText(row && row.Description);
  if (feeCode === 'SCHOOL_FEES_TOTAL') return true;
  if (feeName === 'school fees total' || description === 'school fees total') return true;
  const metadata = parseMetadata(row && row.Metadata);
  const nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
  return normalizeMatchText(metadata.paymentType || nested.paymentType) === 'schoolfeestotal';
}

export function isSchoolFeesTotalCode(value) {
  return normalizeReferenceText(value) === normalizeReferenceText(SCHOOL_FEES_TOTAL_CODE);
}

export function isSchoolFeeCategory(value) {
  const category = normalizeReferenceText(value);
  return !category || ['schoolfee', 'schoolfees', 'tuition'].includes(category);
}

export function isSchoolInvoiceCredit(row) {
  return isAcceptanceFeeLike(row) ||
    isSchoolFeesTotalPayment(row) ||
    normalizeMatchText(row && row.FeeCategory) === 'school fee' ||
    isGeneralFeeCredit(row);
}

export function calculateSchoolFeeOutstanding(expectedDebit, appliedCredit) {
  return Math.max(0, asMoneyNumber(expectedDebit) - asMoneyNumber(appliedCredit));
}

function isGeneralFeeCredit(row) {
  if (!row || isWalletLedger(row) || isAcceptanceFeeLike(row) || isSchoolFeesTotalPayment(row)) return false;
  const feeCode = normalizeMatchText(row.FeeCode);
  const feeName = normalizeMatchText(row.FeeName);
  const description = normalizeMatchText(row.Description);
  const category = normalizeMatchText(row.FeeCategory);
  const compactCode = normalizeReferenceText(row.FeeCode);
  const compactName = normalizeReferenceText(row.FeeName);
  const compactDescription = normalizeReferenceText(row.Description);
  if (['manualpayment', 'generalpayment', 'accountcredit', 'feecredit', 'credittransferin', 'creditadjustment'].includes(compactCode)) return true;
  if (['manual_payment', 'general_payment', 'account_credit', 'fee_credit', 'credit_transfer_in', 'credit_adjustment'].includes(feeCode)) return true;
  if (!category && ['payment', 'manualpayment', 'generalpayment', 'accountcredit', 'feecredit'].includes(compactName || compactDescription)) return true;
  return false;
}

async function findStudentForApplication(env, app) {
  const refs = [
    accountRefFromApplication(app),
    app.ApplicationReference,
    app.ApplicationID,
    app.AdmissionNo,
    app.AdmissionNumber
  ].map(clean).filter(Boolean);
  for (const ref of refs) {
    const found = await findStudent(env, ref, ref);
    if (found) return normalizeStudent(found);
  }
  const appName = normalizeReferenceText(displayNameFromApplication(app));
  const appEmail = normalizeMatchText(app.VerificationEmail || app.ParentEmail || app.Email || '');
  if (!appName || !appEmail) return null;
  const candidates = await querySchoolCollection(env, 'students', {
    filters: [{ field: 'ParentEmail', op: '==', value: lower(appEmail) }]
  });
  const found = candidates.map(normalizeStudent).find((student) => {
    const studentName = normalizeReferenceText(student.DisplayName || student.ApplicantName || '');
    const studentEmail = normalizeMatchText(student.ParentEmail || student.Email || '');
    return studentName === appName && studentEmail === appEmail;
  });
  return found || null;
}

async function getAppsScriptPayableFees(env, body = {}) {
  if (!legacyGoogleDataEnabled(env)) return null;
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return null;
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'getPayableFees',
      Email: body.Email || body.email,
      VerificationCode: body.VerificationCode || body.code,
      AccountRef: body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo
    })
  });
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data && data.ok ? { ...data, backend: 'apps-script' } : data;
  } catch (_err) {
    return {
      ok: false,
      message: 'Google Sheets fee lookup did not return JSON. Confirm the Apps Script deployment is current.'
    };
  }
}

const GENERATED_ADMISSION_DOCUMENTS = {
  EntranceResult: {
    label: 'Entrance Result',
    urlField: 'EntranceResultPdfUrl',
    fileField: 'EntranceResultPdfFileName'
  },
  OfferOfAdmission: {
    label: 'Offer of Admission',
    urlField: 'OfferPdfUrl',
    fileField: 'OfferPdfFileName'
  },
  AdmissionLetter: {
    label: 'Admission Letter',
    urlField: 'AdmissionLetterPdfUrl',
    fileField: 'AdmissionLetterPdfFileName'
  }
};

async function storeGeneratedAdmissionDocument(env, body) {
  const definition = GENERATED_ADMISSION_DOCUMENTS[clean(body.DocumentType)];
  if (!definition) {
    const err = new Error('A valid generated admission document type is required.');
    err.status = 400;
    throw err;
  }
  const fileBase64 = clean(body.FileBase64);
  const fileName = clean(body.FileName) || `${definition.label}.pdf`;
  if (!fileBase64) {
    const err = new Error('The generated PDF file is required.');
    err.status = 400;
    throw err;
  }
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
    const err = new Error('Google Drive document storage is not configured.');
    err.status = 500;
    throw err;
  }
  const application = await findApplicationForAdmissionDocument(env, body);
  if (!application) {
    const err = new Error('The matching Firestore application was not found.');
    err.status = 404;
    throw err;
  }
  const applicationReference = pick(application, ['ApplicationReference', 'ApplicationID', '__id']);
  const existingUrl = clean(application[definition.urlField]);
  const storageResponse = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'uploadParentDocument',
      StorageOnly: 'YES',
      ApplicationReference: applicationReference,
      // StorageOnly uses the existing Drive uploader without changing any
      // admission-document flags. The actual generated-document type is kept
      // in Firestore below.
      DocumentType: 'AcceptanceForm',
      FileName: fileName,
      MimeType: 'application/pdf',
      FileBase64: fileBase64,
      ReplaceExisting: existingUrl ? 'YES' : 'NO',
      ExistingUrl: existingUrl
    })
  });
  const stored = await storageResponse.json().catch(() => ({}));
  if (!storageResponse.ok || !stored.ok || !clean(stored.documentUrl)) {
    const err = new Error(stored.message || 'The customized PDF could not be stored in Google Drive.');
    err.status = storageResponse.status >= 400 ? storageResponse.status : 502;
    throw err;
  }
  const now = nowIso();
  const updated = {
    ...application,
    [definition.urlField]: clean(stored.documentUrl),
    [definition.fileField]: fileName,
    GeneratedAdmissionDocumentUpdatedAt: now,
    UpdatedAt: now
  };
  delete updated.__id;
  delete updated.__name;
  const saved = await saveApplication(env, updated);
  return {
    ok: true,
    message: `${definition.label} customized PDF stored for parent download.`,
    applicationReference,
    documentUrl: clean(stored.documentUrl),
    application: saved
  };
}

async function getAppsScriptAccountsOverview(env) {
  if (!legacyGoogleDataEnabled(env)) return null;
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return null;
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'getAccountsOverview'
    })
  });
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    return data && data.ok ? data : null;
  } catch (_err) {
    return null;
  }
}

async function getAppsScriptApplications(env) {
  if (!legacyGoogleDataEnabled(env)) return [];
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return [];
  const url = new URL(env.GOOGLE_APPS_SCRIPT_URL);
  url.searchParams.set('secret', env.GOOGLE_APPS_SCRIPT_SECRET);
  url.searchParams.set('action', 'getApplications');
  try {
    const response = await fetch(url.toString());
    const text = await response.text();
    const data = JSON.parse(text);
    return data && data.ok && Array.isArray(data.applications) ? data.applications : [];
  } catch (_err) {
    return [];
  }
}

async function getAppsScriptStudents(env) {
  if (!legacyGoogleDataEnabled(env)) return [];
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return [];
  try {
    const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'getStudents'
      })
    });
    const text = await response.text();
    const data = JSON.parse(text);
    return data && data.ok && Array.isArray(data.students) ? data.students : [];
  } catch (_err) {
    return [];
  }
}

async function getAppsScriptFormSales(env) {
  if (!legacyGoogleDataEnabled(env)) return [];
  if (!env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) return [];
  try {
    const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
        Action: 'getFormSales'
      })
    });
    const text = await response.text();
    const data = JSON.parse(text);
    return data && data.ok && Array.isArray(data.sales) ? data.sales : [];
  } catch (_err) {
    return [];
  }
}

function uniqueFirestoreRows(rows = []) {
  const unique = new Map();
  rows.filter(Boolean).forEach((row) => {
    const key = clean(row.__name || row.__id) || JSON.stringify(row);
    unique.set(key, row);
  });
  return [...unique.values()];
}

export function parentIdentityLookupFilters(collection, email, code, fields = []) {
  const lookups = [];
  if (email) {
    const emailFields = collection === 'applications' ? ['VerificationEmail'] : ['ParentEmail'];
    emailFields.forEach((field) => lookups.push({ field, value: email }));
  }
  if (code) {
    fields.forEach((field) => lookups.push({ field, value: code }));
  }
  return lookups;
}

async function queryParentIdentityRows(env, collection, email, code, fields = []) {
  // A parent login authenticates the family, not only the sibling whose
  // verification code was used. Load all records owned by the parent email so
  // a requested sibling is billed from that sibling's own profile.
  const queries = parentIdentityLookupFilters(collection, email, code, fields)
    .map(({ field, value }) => querySchoolCollection(env, collection, {
      filters: [{ field, op: '==', value }]
    }).catch(() => []));
  return uniqueFirestoreRows((await Promise.all(queries)).flat());
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

export function shouldResolveStudentForPayable(application = {}, requestedSourceType = '') {
  return normalizeMatchText(requestedSourceType) === 'student' ||
    yesNo(application.Enrolled) === 'YES' ||
    normalizeMatchText(application.Status) === 'enrolled';
}

export async function getPayableFees(env, body = {}) {
  const email = lower(body.Email || body.email);
  const code = clean(body.VerificationCode || body.code).toUpperCase();
  const requestedAccountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const requestedSourceType = normalizeMatchText(body.SourceType || body.sourceType);
  const requestedScopePath = clean(body.ScopePath || body.scopePath || body.__scopePath);
  if (!email || !code) {
    const err = new Error('Email and verification code are required.');
    err.status = 400;
    throw err;
  }

  const directCollection = requestedSourceType === 'application' ? 'applications' : 'students';
  const directIdentity = requestedAccountRef
    ? await getSelectedIdentityRow(env, directCollection, requestedAccountRef, requestedScopePath)
    : null;
  const directIdentityValid = directIdentity && directCollection === 'applications'
    ? lower(directIdentity.VerificationEmail || directIdentity.ParentEmail || directIdentity.Email) === email &&
      clean(directIdentity.VerificationCode).toUpperCase() === code
    : directIdentity &&
      lower(directIdentity.ParentEmail || directIdentity.Email || directIdentity.VerificationEmail) === email &&
      studentLoginCodes(directIdentity).includes(code);
  const [firestoreApplications, sheetApplications, firestoreStudents, sheetStudents, firestoreSales, sheetSales] = directIdentityValid
    ? [
      directCollection === 'applications' ? [directIdentity] : [],
      [],
      directCollection === 'students' ? [directIdentity] : [],
      [],
      [],
      []
    ]
    : await Promise.all([
      queryParentIdentityRows(env, 'applications', email, code, ['VerificationCode']),
      getAppsScriptApplications(env),
      queryParentIdentityRows(env, 'students', email, code, ['ParentLoginCode', 'VerificationCode', 'LoginCode']),
      getAppsScriptStudents(env),
      queryCollection(env, 'formSales', {
        filters: [{ field: 'VerificationCode', op: '==', value: code }]
      }).catch(() => []),
      getAppsScriptFormSales(env)
    ]);
  const applications = [...firestoreApplications, ...sheetApplications].map(normalizeApplication);
  const students = [...firestoreStudents, ...sheetStudents].map(normalizeStudent);
  const sales = [...firestoreSales, ...sheetSales];
  const loginApp = applications.find((row) => lower(row.VerificationEmail || row.Email || row.ParentEmail) === email && clean(row.VerificationCode).toUpperCase() === code);
  const loginStudent = students.find((row) => lower(row.ParentEmail || row.Email || row.VerificationEmail) === email && studentLoginCodes(row).includes(code));
  const saleMatch = sales.some((row) => {
    return lower(pick(row, ['Email', 'email'])) === email &&
      clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === code;
  });
  if (!loginApp && !loginStudent && !saleMatch) {
    const err = new Error('Application not found for that email/code.');
    err.status = 404;
    throw err;
  }

  let app = loginApp;
  let accountRef = requestedAccountRef || accountRefFromApplication(loginApp || {}) || loginStudent?.AdmissionNo || loginStudent?.AccountRef || '';
  let student = requestedAccountRef ? findStudentByAccountRefInRows(students, requestedAccountRef) : (loginStudent || null);
  let selectedApplication = null;
  if (student && student.ApplicationReference && !applications.length) {
    const linked = await getSelectedIdentityRow(env, 'applications', student.ApplicationReference);
    if (linked) applications.push(normalizeApplication(linked));
  }
  if (requestedAccountRef) {
    selectedApplication = applications.find((row) => {
      return sameText(row.ApplicationReference || row.ApplicationID || row.__id, requestedAccountRef) ||
        referencesMatch(row.ApplicationReference || row.ApplicationID || row.__id, requestedAccountRef) ||
        sameText(row.AdmissionNo || row.AdmissionNumber, requestedAccountRef) ||
        referencesMatch(row.AdmissionNo || row.AdmissionNumber, requestedAccountRef);
    }) || null;
  }
  if (student) {
    const parentEmailMatches = lower(student.ParentEmail || student.Email) === email;
    const studentAppRef = clean(student.ApplicationReference);
    const linkedApplication = studentAppRef ? applications.find((row) => sameText(row.ApplicationReference || row.ApplicationID || row.__id, studentAppRef) || referencesMatch(row.ApplicationReference || row.ApplicationID || row.__id, studentAppRef)) : null;
    const linkedEmailMatches = linkedApplication && [linkedApplication.VerificationEmail, linkedApplication.ParentEmail, linkedApplication.Email]
      .some((value) => lower(value) === email);
    const selectedEmailMatches = selectedApplication && [selectedApplication.VerificationEmail, selectedApplication.ParentEmail, selectedApplication.Email]
      .some((value) => lower(value) === email);
    if (!parentEmailMatches && !linkedEmailMatches && !selectedEmailMatches && !saleMatch) {
      const err = new Error('The selected student is not linked to this parent email.');
      err.status = 403;
      throw err;
    }
    if (linkedApplication) {
      app = linkedApplication;
    } else if (selectedApplication) {
      app = selectedApplication;
    }
  } else if (selectedApplication) {
    const selectedEmailMatches = [selectedApplication.VerificationEmail, selectedApplication.ParentEmail, selectedApplication.Email]
      .some((value) => lower(value) === email);
    if (!selectedEmailMatches) {
      const err = new Error('The selected applicant is not linked to this parent email.');
      err.status = 403;
      throw err;
    }
    app = selectedApplication;
  }
  if (!app && student) {
    app = {
      ApplicationReference: student.ApplicationReference || student.AdmissionNo || student.AccountRef,
      ApplicationID: student.ApplicationReference || student.AdmissionNo || student.AccountRef,
      ApplicantName: student.DisplayName || student.ApplicantName,
      ClassApplyingFor: student.ClassAdmitted || student.ClassName,
      ClassAdmitted: student.ClassAdmitted || student.ClassName,
      StudentType: student.StudentType,
      BillingCategory: student.BillingCategory || 'Regular',
      AcademicSession: student.AcademicSession,
      Term: student.Term,
      AdmissionNo: student.AdmissionNo || student.AccountRef,
      Status: student.Status || 'Active',
      ResultStatus: student.Status || '',
      ParentEmail: student.ParentEmail,
      VerificationEmail: email,
      VerificationCode: code
    };
  }
  if (!app) {
    const err = new Error('Selected child is not linked to an application or student account.');
    err.status = 404;
    throw err;
  }
  if (!student && shouldResolveStudentForPayable(app, requestedSourceType)) {
    student = await findStudentForApplication(env, app);
  }
  if (student) accountRef = student.AdmissionNo || student.AccountRef || student.ApplicationReference || accountRef;
  const billingApp = { ...app };
  if (student) {
    if (student.ClassAdmitted || student.ClassName) {
      billingApp.ClassApplyingFor = student.ClassAdmitted || student.ClassName;
      billingApp.ClassAdmitted = student.ClassAdmitted || student.ClassName;
    }
    if (student.AcademicSession) billingApp.AcademicSession = student.AcademicSession;
    if (student.Term) billingApp.Term = student.Term;
    if (student.StudentType) billingApp.StudentType = student.StudentType;
    if (student.BillingCategory) billingApp.BillingCategory = student.BillingCategory;
    if (student.Gender) billingApp.Gender = student.Gender;
    if (student.EnrollmentCategory) billingApp.EnrollmentCategory = student.EnrollmentCategory;
    if (student.AcademicProgress) billingApp.AcademicProgress = student.AcademicProgress;
    if (student.AdmissionNo) billingApp.AdmissionNo = student.AdmissionNo;
    if (student.DisplayName || student.ApplicantName) billingApp.ApplicantName = student.DisplayName || student.ApplicantName;
  }
  const profileResult = await getSchoolProfile(env).catch(() => ({ profile: {} }));
  const activeProfile = profileResult.profile || {};
  if (!clean(billingApp.AcademicSession)) billingApp.AcademicSession = clean(activeProfile.CurrentAcademicSession);
  if (!clean(billingApp.Term)) billingApp.Term = clean(activeProfile.CurrentTerm) || 'First Term';

  const accountRefs = new Set([
    accountRef,
    app.ApplicationReference,
    app.ApplicationID,
    app.AdmissionNo,
    app.AdmissionNumber,
    billingApp.ApplicationReference,
    billingApp.ApplicationID,
    billingApp.AdmissionNo,
    billingApp.AdmissionNumber
  ].map(clean).filter(Boolean));
  const rowMatchesAccount = (row) => {
    const primary = clean(row.AccountRef || row.AdmissionNo);
    if (primary) return [accountRef, billingApp.AdmissionNo, app.AdmissionNo].map(clean).filter(Boolean).some((ref) => sameReferenceIdentity(primary, ref));
    const applicationRef = clean(row.ApplicationReference || row.ApplicationID);
    return Boolean(applicationRef && [app.ApplicationReference, app.ApplicationID, billingApp.ApplicationReference].map(clean).filter(Boolean).some((ref) => sameReferenceIdentity(applicationRef, ref)));
  };

  let [feeRows, paymentRows, invoiceRows, ledgerRows] = await Promise.all([
    listCollection(env, 'feeItems'),
    queryAccountRows(env, 'payments', accountRef),
    queryAccountRows(env, 'invoices', accountRef),
    queryAccountRows(env, 'ledger', accountRef)
  ]);
  if (!feeRows.length) {
    const sheetFinance = await getAppsScriptAccountsOverview(env);
    if (sheetFinance) {
      feeRows = sheetFinance.feeItems || [];
      paymentRows = [
        ...(paymentRows || []),
        ...(sheetFinance.payments || [])
      ];
      invoiceRows = [
        ...(invoiceRows || []),
        ...(sheetFinance.invoices || [])
      ];
      ledgerRows = [
        ...(ledgerRows || []),
        ...(sheetFinance.ledger || [])
      ];
    } else {
      const sheetData = await getAppsScriptPayableFees(env, body);
      if (sheetData) return sheetData;
    }
  }
  const allFees = feeRows.map(normalizeFeeItem)
    .filter((row) => yesNo(row.Active) === 'YES')
    .sort((a, b) => asMoneyNumber(a.SortOrder) - asMoneyNumber(b.SortOrder));
  const enrolledForBilling = Boolean(student) || yesNo(app.Enrolled) === 'YES' || normalizeMatchText(app.Status) === 'enrolled';
  const applicationStatus = normalizeMatchText(app.Status);
  const resultStatus = normalizeMatchText(app.ResultStatus);
  const admittedForPreEnrollment = resultStatus === 'admitted' || ['admitted', 'accepted', 'admission letter sent'].includes(applicationStatus);
  const applicationCreatedAt = timestampMs(app.SubmittedAt || app.CreatedAt || app.UpdatedAt);
  const notStaleForApplication = (row) => {
    if (!applicationCreatedAt) return true;
    const rowTime = timestampMs(row.RawDate || row.Date);
    return !rowTime || rowTime >= applicationCreatedAt;
  };
  const acceptanceAlreadyPaid = yesNo(app.AcceptanceFeePaid) === 'YES' ||
    ledgerRows.map(normalizeLedger).filter(rowMatchesAccount).filter(notStaleForApplication).some((row) => {
      if (asMoneyNumber(row.Credit) <= 0) return false;
      return isAcceptanceFeeLike(row);
    });
  const matchedFees = applyBillingCategoryOverrides(allFees.filter((fee) => {
    const amount = asMoneyNumber(fee.Amount);
    const category = normalizeMatchText(fee.FeeCategory || '');
    const requiredForEnrollment = yesNo(fee.RequiredForEnrollment) === 'YES';
    const isAcceptanceFee = isAcceptanceFeeLike(fee);
    if (!isWalletFee(fee) && amount <= 0) return false;
    if (yesNo(fee.PayableOnline || 'YES') !== 'YES') return false;
    if (!feeMatchesApplication(fee, billingApp)) return false;
    if (isAcceptanceFee) {
      if (acceptanceAlreadyPaid) return false;
      return admittedForPreEnrollment && isNewIntakeApplication(billingApp);
    }
    if (!enrolledForBilling) {
      if (!admittedForPreEnrollment || yesNo(app.OfferSent) !== 'YES') return false;
      return category === 'admission' || requiredForEnrollment;
    }
    return true;
  }), billingApp);

  const feeBalanceMap = {};
  const paymentCodeMap = {};
  const paymentNameMap = {};
  const paidLedgerRows = [];
  const addPaid = (map, key, amount) => {
    const cleanKey = clean(key);
    const paidAmount = asMoneyNumber(amount);
    if (!cleanKey || paidAmount <= 0) return;
    map[cleanKey] = (map[cleanKey] || 0) + paidAmount;
  };
  const addBalanceCredit = (key, amount, session = '', term = '') => {
    const cleanKey = clean(key);
    if (!cleanKey) return;
    feeBalanceMap[cleanKey] = feeBalanceMap[cleanKey] || { credit: 0 };
    feeBalanceMap[cleanKey].credit += asMoneyNumber(amount);
    const scopedKey = periodKey(cleanKey, session, term);
    feeBalanceMap[scopedKey] = feeBalanceMap[scopedKey] || { credit: 0 };
    feeBalanceMap[scopedKey].credit += asMoneyNumber(amount);
  };

  invoiceRows.map(normalizeInvoice).filter(rowMatchesAccount).forEach((row) => {
    if (normalizeMatchText(row.Status) === 'paid') {
      addBalanceCredit(row.FeeCode || row.FeeName, row.Debit || row.Balance, row.AcademicSession, row.Term);
    }
  });
  ledgerRows.map(normalizeLedger).filter(rowMatchesAccount).filter(notStaleForApplication).forEach((row) => {
    if (isWalletLedger(row)) return;
    const credit = asMoneyNumber(row.Credit);
    if (credit <= 0) return;
    paidLedgerRows.push(row);
    addPaid(paymentCodeMap, row.FeeCode, credit);
    addPaid(paymentNameMap, row.FeeName, credit);
    addPaid(paymentNameMap, row.Description, credit);
    addPaid(paymentCodeMap, periodKey(row.FeeCode, row.AcademicSession, row.Term), credit);
    addPaid(paymentNameMap, periodKey(row.FeeName, row.AcademicSession, row.Term), credit);
    addPaid(paymentNameMap, periodKey(row.Description, row.AcademicSession, row.Term), credit);
  });
  const currentWalletBalance = ledgerRows.map(normalizeLedger).filter(rowMatchesAccount).reduce((sum, row) => {
    if (!isWalletLedger(row)) return sum;
    return sum + asMoneyNumber(row.Credit) - asMoneyNumber(row.Debit);
  }, 0);
  const accountCreditDebits = ledgerRows.map(normalizeLedger).filter(rowMatchesAccount).filter(notStaleForApplication).reduce((sum, row) => {
    if (isWalletLedger(row)) return sum;
    if (normalizeMatchText(row.FeeCategory) !== 'account credit') return sum;
    return sum + asMoneyNumber(row.Debit);
  }, 0);

  let acceptanceCreditRemaining = enrolledForBilling && acceptanceAlreadyPaid ? asMoneyNumber(app.AcceptanceFeeAmount) : 0;
  if (acceptanceCreditRemaining <= 0 && enrolledForBilling) {
    acceptanceCreditRemaining = Math.max(asMoneyNumber(paymentCodeMap.ACCEPTANCE_FEE), asMoneyNumber(paymentNameMap['Acceptance Fee']));
  }
  const currentTermRank = termRank(billingApp.Term);
  const currentSession = normalizeMatchText(billingApp.AcademicSession || '');
  const rowSessionApplies = (row) => {
    const rowSession = normalizeMatchText(row.AcademicSession || '');
    return !currentSession || !rowSession || rowSession === currentSession || rowSession === 'all' || rowSession === '*';
  };
  const rowIsCurrentPeriod = (row) => {
    const rowTermRank = termRank(row.Term);
    if (!rowSessionApplies(row)) return false;
    if (!currentTermRank) return true;
    return rowTermRank === currentTermRank;
  };
  const priorSchoolFeeCharge = currentTermRank ? applyBillingCategoryOverrides(allFees.filter((fee) => {
    if (yesNo(fee.Active) !== 'YES') return false;
    if (isWalletFee(fee) || isAcceptanceFeeLike(fee)) return false;
    if (normalizeMatchText(fee.FeeCategory || 'School Fee') !== 'school fee') return false;
    const feeRank = termRank(fee.Term);
    return feeRank && feeRank < currentTermRank && feeMatchesAccountBase(fee, billingApp);
  }), billingApp).reduce((sum, fee) => sum + asMoneyNumber(fee.Amount), 0) : 0;
  const schoolFeeRelatedCredit = currentTermRank ? paidLedgerRows.reduce((sum, row) => {
    const schoolRelated = isAcceptanceFeeLike(row) ||
      isSchoolFeesTotalPayment(row) ||
      normalizeMatchText(row.FeeCategory) === 'school fee' ||
      isGeneralFeeCredit(row);
    return schoolRelated ? sum + asMoneyNumber(row.Credit) : sum;
  }, 0) : 0;
  const currentPeriodSchoolFeeCredit = currentTermRank ? paidLedgerRows.reduce((sum, row) => {
    const schoolRelated = isSchoolFeesTotalPayment(row) ||
      normalizeMatchText(row.FeeCategory) === 'school fee' ||
      isGeneralFeeCredit(row);
    return schoolRelated && rowIsCurrentPeriod(row) ? sum + asMoneyNumber(row.Credit) : sum;
  }, 0) : 0;
  const carryForwardSchoolCredit = Math.max(0, schoolFeeRelatedCredit - currentPeriodSchoolFeeCredit - priorSchoolFeeCharge - accountCreditDebits);
  if (currentTermRank > 1) {
    acceptanceCreditRemaining = 0;
  }
  let schoolFeesTotalCreditRemaining = paidLedgerRows.reduce((sum, row) => {
    return isSchoolFeesTotalPayment(row) && rowIsCurrentPeriod(row) ? sum + asMoneyNumber(row.Credit) : sum;
  }, carryForwardSchoolCredit);
  let generalFeeCreditRemaining = paidLedgerRows.reduce((sum, row) => {
    return isGeneralFeeCredit(row) && rowIsCurrentPeriod(row) ? sum + asMoneyNumber(row.Credit) : sum;
  }, 0);
  const priorSchoolFeeBalance = Math.max(0, priorSchoolFeeCharge + accountCreditDebits - (schoolFeeRelatedCredit - currentPeriodSchoolFeeCredit));

  const fees = matchedFees.map((fee) => {
    const copy = { ...fee };
    const originalAmount = asMoneyNumber(copy.Amount);
    const optionalSubscription = isOptionalSubscriptionFee(copy);
    const feeCode = clean(copy.FeeCode);
    const feeName = clean(copy.FeeName || feeCode);
    const codePeriodKey = periodKey(feeCode, copy.AcademicSession, copy.Term);
    const namePeriodKey = periodKey(feeName, copy.AcademicSession, copy.Term);
    const periodSpecific = isPeriodSpecificFee(copy);
    const scopedCodePaid = Math.max(asMoneyNumber(paymentCodeMap[codePeriodKey]), asMoneyNumber((feeBalanceMap[codePeriodKey] || {}).credit));
    const scopedNamePaid = Math.max(asMoneyNumber(paymentNameMap[namePeriodKey]), asMoneyNumber((feeBalanceMap[namePeriodKey] || {}).credit));
    const exactCodePaid = Math.max(scopedCodePaid, periodSpecific ? 0 : asMoneyNumber(paymentCodeMap[feeCode]), periodSpecific ? 0 : asMoneyNumber((feeBalanceMap[feeCode] || {}).credit));
    const feeNamePaid = Math.max(scopedNamePaid, periodSpecific ? 0 : asMoneyNumber(paymentNameMap[feeName]), periodSpecific ? 0 : asMoneyNumber((feeBalanceMap[feeName] || {}).credit));
    const ledgerMatchedPaid = paidLedgerRows.reduce((sum, row) => {
      if (!periodMatchesFee(row, copy)) return sum;
      const rowCode = normalizeMatchText(row.FeeCode);
      const rowName = normalizeMatchText(row.FeeName);
      const rowDescription = normalizeMatchText(row.Description);
      const rowCategory = normalizeMatchText(row.FeeCategory);
      const feeCategory = normalizeMatchText(copy.FeeCategory);
      const codeMatches = rowCode && rowCode === normalizeMatchText(feeCode);
      const nameMatches = normalizeMatchText(feeName) && [rowName, rowDescription].includes(normalizeMatchText(feeName));
      const categoryAmountMatches = feeCategory && feeCategory === rowCategory && Math.abs(asMoneyNumber(row.Credit) - originalAmount) < 0.01;
      return (codeMatches || nameMatches || categoryAmountMatches) ? sum + asMoneyNumber(row.Credit) : sum;
    }, 0);
    let paid = optionalSubscription ? 0 : Math.max(exactCodePaid, feeNamePaid, ledgerMatchedPaid);
    const acceptanceCreditApplied = (!optionalSubscription && !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' && acceptanceCreditRemaining > 0)
      ? Math.min(originalAmount - Math.min(originalAmount, paid), acceptanceCreditRemaining)
      : 0;
    if (acceptanceCreditApplied > 0) {
      paid += acceptanceCreditApplied;
      acceptanceCreditRemaining -= acceptanceCreditApplied;
    }
    const schoolFeesTotalCreditApplied = (!optionalSubscription && !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' && schoolFeesTotalCreditRemaining > 0)
      ? Math.min(originalAmount - Math.min(originalAmount, paid), schoolFeesTotalCreditRemaining)
      : 0;
    if (schoolFeesTotalCreditApplied > 0) {
      paid += schoolFeesTotalCreditApplied;
      schoolFeesTotalCreditRemaining -= schoolFeesTotalCreditApplied;
    }
    const generalFeeCreditApplied = (!optionalSubscription && !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' && generalFeeCreditRemaining > 0)
      ? Math.min(originalAmount - Math.min(originalAmount, paid), generalFeeCreditRemaining)
      : 0;
    if (generalFeeCreditApplied > 0) {
      paid += generalFeeCreditApplied;
      generalFeeCreditRemaining -= generalFeeCreditApplied;
    }
    const walletLimit = isWalletFee(fee) ? asMoneyNumber(copy.MaxAmount) : 0;
    const walletTopupRemaining = walletLimit > 0 ? Math.max(0, walletLimit - currentWalletBalance) : originalAmount;
    const balance = optionalSubscription ? originalAmount : (isWalletFee(fee) ? walletTopupRemaining : Math.max(0, originalAmount - paid));
    copy.OriginalAmount = originalAmount;
    copy.PaidAmount = paid;
    copy.AcceptanceCreditApplied = acceptanceCreditApplied;
    copy.SchoolFeesTotalCreditApplied = schoolFeesTotalCreditApplied;
    copy.GeneralFeeCreditApplied = generalFeeCreditApplied;
    copy.BalanceAmount = balance;
    if (!isWalletFee(fee)) {
      copy.Amount = balance;
    } else if (walletLimit > 0) {
      copy.Amount = balance;
      copy.MaxAmount = balance;
      copy.WalletLimit = walletLimit;
      copy.WalletBalance = currentWalletBalance;
      copy.WalletLimitReached = balance <= 0 ? 'YES' : 'NO';
    }
    if (asMoneyNumber(copy.MinAmount) > balance) copy.MinAmount = balance;
    if (asMoneyNumber(copy.MaxAmount) <= 0 || asMoneyNumber(copy.MaxAmount) > balance) copy.MaxAmount = balance;
    copy.PaymentType = isWalletFee(fee) ? 'Wallet' : 'Fee';
    copy.AppliesTo = [copy.ClassName || 'All', copy.StudentType || 'All', copy.AcademicSession || 'All', copy.Term || 'All'].join(' / ');
    return copy;
  }).filter((fee) => isWalletFee(fee) || asMoneyNumber(fee.Amount) > 0);

  if (priorSchoolFeeBalance > 0 && currentTermRank > 1) {
    const firstSchoolFee = fees.find((fee) => !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee') || matchedFees.find((fee) => normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee') || {};
    fees.unshift({
      FeeCode: 'PREVIOUS_SCHOOL_FEE_BALANCE',
      FeeName: 'Previous Balance',
      FeeCategory: 'School Fee',
      Amount: priorSchoolFeeBalance,
      OriginalAmount: priorSchoolFeeBalance,
      PaidAmount: 0,
      BalanceAmount: priorSchoolFeeBalance,
      Currency: firstSchoolFee.Currency || 'NGN',
      PayableOnline: 'YES',
      AllowInstallment: 'NO',
      MinAmount: '',
      MaxAmount: priorSchoolFeeBalance,
      AcademicSession: billingApp.AcademicSession || firstSchoolFee.AcademicSession || '',
      Term: billingApp.Term || firstSchoolFee.Term || '',
      DueDate: firstSchoolFee.DueDate || '',
      PaymentType: 'Fee',
      AppliesTo: 'Previous unpaid school fee balance'
    });
  }

  const schoolFeeBreakdown = fees.filter((fee) => !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee');
  const schoolFeeTotal = schoolFeeBreakdown.reduce((total, fee) => total + asMoneyNumber(fee.Amount), 0);
  return {
    ok: true,
    message: 'Payable fees loaded from Firestore.',
    account: {
      AccountRef: accountRef,
      ApplicationReference: billingApp.ApplicationReference || app.ApplicationReference || '',
      AdmissionNo: billingApp.AdmissionNo || billingApp.AdmissionNumber || app.AdmissionNo || app.AdmissionNumber || '',
      DisplayName: displayNameFromApplication(billingApp),
      ClassName: billingApp.ClassApplyingFor || billingApp.ClassAdmitted || '',
      StudentType: billingApp.StudentType || '',
      BillingCategory: billingApp.BillingCategory || app.BillingCategory || 'Regular',
      AcademicSession: billingApp.AcademicSession || '',
      Term: billingApp.Term || '',
      Email: app.VerificationEmail || email,
      BillingSource: student ? 'Students' : 'Applications'
    },
    fees,
    schoolFeeBreakdown,
    schoolFeeTotal
  };
}

export async function getAccountsOverview(env) {
  const [accounts, payments, invoices, feeItems, storedLedger, applications, students, settings, billingCategories] = await Promise.all([
    listCollection(env, 'accounts'),
    listCollection(env, 'payments'),
    listCollection(env, 'invoices'),
    listCollection(env, 'feeItems'),
    listCollection(env, 'ledger'),
    listSchoolCollection(env, 'applications'),
    listSchoolCollection(env, 'students'),
    listCollection(env, 'settings'),
    listCollection(env, 'billingCategories')
  ]);
  const schoolProfile = settings.find((row) => row.__id === 'schoolProfile') || settings.find((row) => clean(row.SchoolName)) || {};
  const normalizedPayments = payments.map(normalizePayment);
  const normalizedInvoices = invoices.map(normalizeInvoice);
  const normalizedStoredLedger = storedLedger.map(normalizeLedger);
  const accountMap = new Map();
  const accountAliasMap = new Map();
  const accountKeyForRefs = (refs, fallback) => {
    // Admission/account reference is the primary identity. Do not merge two
    // students merely because a bad import reused an application reference.
    const primary = clean(refs[0] || fallback);
    const alias = primary ? accountAliasMap.get(safeDocumentId(primary).toLowerCase()) : '';
    return alias || safeDocumentId(primary || fallback).toLowerCase();
  };
  const registerAccountAliases = (key, refs) => {
    refs.forEach((ref) => {
      const alias = safeDocumentId(ref).toLowerCase();
      if (alias) accountAliasMap.set(alias, key);
    });
  };
  const putAccount = (row) => {
    const normalized = normalizeAccount(row || {});
    const refs = accountRefsFrom(normalized);
    const accountRef = clean(normalized.AccountRef || refs[0]);
    if (!accountRef) return;
    const key = accountKeyForRefs(refs, accountRef);
    const existing = accountMap.get(key) || {};
    accountMap.set(key, {
      ...existing,
      ...normalized,
      AccountRef: clean(existing.AccountRef || normalized.AccountRef || accountRef),
      ApplicationReference: clean(existing.ApplicationReference || normalized.ApplicationReference),
      AdmissionNo: clean(existing.AdmissionNo || normalized.AdmissionNo),
      DisplayName: clean(existing.DisplayName || normalized.DisplayName),
      ClassName: clean(existing.ClassName || normalized.ClassName),
      StudentType: clean(existing.StudentType || normalized.StudentType),
      BillingCategory: clean(existing.BillingCategory || normalized.BillingCategory) || 'Regular',
      Gender: clean(existing.Gender || normalized.Gender),
      EnrollmentCategory: clean(existing.EnrollmentCategory || normalized.EnrollmentCategory) || 'Returning',
      AcademicProgress: clean(existing.AcademicProgress || normalized.AcademicProgress) || 'Promoted',
      AcademicSession: clean(existing.AcademicSession || normalized.AcademicSession || schoolProfile.CurrentAcademicSession),
      Term: clean(existing.Term || normalized.Term || schoolProfile.CurrentTerm) || 'First Term',
      Status: clean(existing.Status || normalized.Status),
      ResultStatus: clean(existing.ResultStatus || normalized.ResultStatus),
      OfferSent: clean(existing.OfferSent || normalized.OfferSent),
      Enrolled: clean(existing.Enrolled || normalized.Enrolled),
      AdmissionLetterSent: clean(existing.AdmissionLetterSent || normalized.AdmissionLetterSent)
    });
    registerAccountAliases(key, accountRefsFrom(accountMap.get(key)));
  };
  const applicationCreatedMap = new Map();
  applications.map((row) => normalizeApplication(row, schoolProfile)).forEach((app) => {
    const refs = accountRefsFrom(app);
    const createdAt = timestampMs(app.SubmittedAt || app.CreatedAt || app.UpdatedAt);
    refs.forEach((ref) => {
      const key = safeDocumentId(ref).toLowerCase();
      if (key && createdAt) applicationCreatedMap.set(key, createdAt);
    });
  });
  students.map((row) => normalizeStudent(row, schoolProfile)).forEach((student) => putAccount({
    AccountRef: student.AdmissionNo || student.ApplicationReference,
    ApplicationReference: student.ApplicationReference,
    AdmissionNo: student.AdmissionNo,
    DisplayName: student.DisplayName || student.ApplicantName,
    ClassName: student.ClassName || student.ClassAdmitted,
    StudentType: student.StudentType,
    BillingCategory: student.BillingCategory,
    Gender: student.Gender,
    EnrollmentCategory: student.EnrollmentCategory,
    AcademicProgress: student.AcademicProgress,
    AcademicSession: student.AcademicSession,
    Term: student.Term,
    Status: student.Status || 'Active',
    Enrolled: 'YES'
  }));
  // Student register identity and eligibility fields are authoritative. Legacy
  // account rows may still say New Intake after a CSV import, so merge them second.
  accounts.map(normalizeAccount).forEach(putAccount);
  applications.map((row) => normalizeApplication(row, schoolProfile)).forEach((app) => putAccount({
    AccountRef: app.AdmissionNo || app.AdmissionNumber || app.ApplicationReference || app.ApplicationID,
    ApplicationReference: app.ApplicationReference || app.ApplicationID,
    AdmissionNo: app.AdmissionNo || app.AdmissionNumber,
    DisplayName: displayNameFromApplication(app),
    ClassName: app.ClassApplyingFor || app.ClassAdmitted,
    StudentType: app.StudentType,
    BillingCategory: app.BillingCategory || 'Regular',
    Gender: app.Gender,
    EnrollmentCategory: app.EnrollmentCategory,
    AcademicProgress: app.AcademicProgress,
    AcademicSession: app.AcademicSession,
    Term: app.Term,
    Status: app.Status,
    ResultStatus: app.ResultStatus,
    OfferSent: app.OfferSent,
    Enrolled: app.Enrolled,
    AdmissionLetterSent: app.AdmissionLetterSent
  }));
  [...normalizedInvoices, ...normalizedStoredLedger].forEach((row) => putAccount({
    AccountRef: row.AccountRef || row.AdmissionNo || row.ApplicationReference,
    ApplicationReference: row.ApplicationReference,
    AdmissionNo: row.AdmissionNo,
    DisplayName: row.DisplayName,
    ClassName: row.ClassName,
    StudentType: row.StudentType,
    BillingCategory: row.BillingCategory,
    AcademicSession: row.AcademicSession,
    Term: row.Term,
    Status: 'Active'
  }));
  const ledger = [
    ...normalizedStoredLedger,
    ...normalizedInvoices.map((row) => ({
      AccountRef: row.AccountRef,
      Date: row.Date,
      EntryType: 'Invoice',
      FeeCode: row.FeeCode,
      FeeCategory: row.FeeCategory,
      Description: row.FeeName,
      AcademicSession: row.AcademicSession,
      Term: row.Term,
      Debit: row.Debit,
      Credit: 0,
      Reference: row.InvoiceId,
      RecordedBy: ''
    })),
  ];
  const paymentsByReference = new Map();
  normalizedPayments.forEach((payment) => {
    const creditedAmount = paymentCreditedAmount(payment);
    [payment.Reference, payment.GatewayReference, payment.PaymentId].map(clean).filter(Boolean).forEach((reference) => {
      paymentsByReference.set(reference.toLowerCase(), { ...payment, CreditedAmount: asMoneyNumber(creditedAmount) });
    });
  });
  const ledgerRows = ledger.map(normalizeLedger).map((row) => {
    if (asMoneyNumber(row.Credit) <= 0) return row;
    const payment = paymentsByReference.get(clean(row.Reference).toLowerCase());
    if (!payment) return row;
    return {
      ...row,
      Credit: payment.CreditedAmount,
      AcademicSession: payment.AcademicSession || row.AcademicSession,
      Term: payment.Term || row.Term
    };
  });
  const normalizedFeeItems = feeItems.map(normalizeFeeItem);
  const accountRows = Array.from(accountMap.values()).map((account) => {
    const refs = accountRefsFrom(account);
    let totalDebit = 0;
    let totalCredit = 0;
    let totalReceipts = 0;
    let accountCreditDebit = 0;
    let schoolFeeCredit = 0;
    let schoolFeeExpectedDebit = 0;
    let walletBalance = asMoneyNumber(account.WalletBalance);
    let lastPaymentAt = clean(account.LastPaymentAt);
    const countedLedgerKeys = new Set();
    ledgerRows.forEach((row) => {
      const matched = financialRowMatchesLinkedApplication(row, account);
      if (!matched) return;
      const ledgerKey = clean(row.LedgerNo || row.Reference || `${row.Date}|${row.AccountRef}|${row.FeeCode}|${row.Debit}|${row.Credit}`);
      if (ledgerKey && countedLedgerKeys.has(ledgerKey)) return;
      if (ledgerKey) countedLedgerKeys.add(ledgerKey);
      const accountCreatedAt = refs
        .map((ref) => applicationCreatedMap.get(safeDocumentId(ref).toLowerCase()) || 0)
        .filter(Boolean)
        .sort((a, b) => b - a)[0] || 0;
      const linkedApplicationPayment = clean(row.ApplicationReference) && clean(account.ApplicationReference) &&
        sameReferenceIdentity(row.ApplicationReference, account.ApplicationReference);
      if (accountCreatedAt && timestampMs(row.RawDate || row.Date) &&
        timestampMs(row.RawDate || row.Date) < accountCreatedAt && !linkedApplicationPayment) return;
      if (clean(row.AcademicSession) && clean(account.AcademicSession) && !feeFieldMatches(row.AcademicSession, account.AcademicSession)) return;
      if (clean(row.Term) && clean(account.Term) && !feeFieldMatches(row.Term, account.Term)) return;
      const debit = asMoneyNumber(row.Debit);
      const credit = asMoneyNumber(row.Credit);
      if (debit > 0 && isAcceptanceFeeLike(row) && !isNewIntakeApplication(account)) return;
      if (isWalletLedger(row)) {
        walletBalance += credit - debit;
        return;
      }
      if (isOptionalSubscriptionFee(row) || isStorePurchase(row)) {
        if (credit > 0) totalReceipts += credit;
        if (credit > 0 && row.Date && (!lastPaymentAt || String(row.Date) > String(lastPaymentAt))) {
          lastPaymentAt = row.Date;
        }
        return;
      }
      if (debit > 0) {
        totalDebit += debit;
        if (normalizeMatchText(row.FeeCategory) === 'account credit') {
          accountCreditDebit += debit;
        }
      }
      if (credit > 0) {
        totalCredit += credit;
        totalReceipts += credit;
        if (isSchoolFeeCategory(row.FeeCategory) || isSchoolFeesTotalPayment(row) || isGeneralFeeCredit(row) || isAcceptanceFeeLike(row)) {
          schoolFeeCredit += credit;
        }
      }
      if (credit > 0 && row.Date && (!lastPaymentAt || String(row.Date) > String(lastPaymentAt))) {
        lastPaymentAt = row.Date;
      }
    });
    const accountStatus = normalizeMatchText(account.Status || '');
    const resultStatus = normalizeMatchText(account.ResultStatus || '');
    const isEnrolled = yesNo(account.Enrolled) === 'YES' || accountStatus === 'enrolled';
    const isAdmitted = resultStatus === 'admitted' || ['admitted', 'accepted', 'admission letter sent'].includes(accountStatus);
    const newIntake = isNewIntakeApplication(account);
    if (isEnrolled || (isAdmitted && newIntake)) {
      const matchingExpectedFees = applyBillingCategoryOverrides(normalizedFeeItems
        .filter((fee) => yesNo(fee.Active) === 'YES')
        .filter((fee) => yesNo(fee.PayableOnline || 'YES') === 'YES')
        .filter((fee) => !isWalletFee(fee))
        .filter((fee) => !isOptionalSubscriptionFee(fee))
        .filter((fee) => {
          const category = normalizeMatchText(fee.FeeCategory || 'School Fee');
          const requiredForEnrollment = yesNo(fee.RequiredForEnrollment) === 'YES';
          if (isEnrolled) {
            return !isAcceptanceFeeLike(fee);
          }
          return newIntake && (category === 'admission' || requiredForEnrollment);
        })
        .filter((fee) => feeMatchesAccountPeriod(fee, account)), account);
      const expectedFeeDebit = asMoneyNumber(matchingExpectedFees.reduce((sum, fee) => sum + asMoneyNumber(fee.Amount), 0));
      schoolFeeExpectedDebit = asMoneyNumber(matchingExpectedFees.filter((fee) => isSchoolFeeCategory(fee.FeeCategory)).reduce((sum, fee) => sum + asMoneyNumber(fee.Amount), 0));
      if (expectedFeeDebit > totalDebit) {
        totalDebit = expectedFeeDebit;
      }
    }
    // Account-credit allocation rows are already included in totalDebit above.
    // Adding accountCreditDebit again doubled balances on the dashboard.
    const netBalance = asMoneyNumber(totalDebit - totalCredit);
    return {
      ...account,
      TotalDebit: totalDebit,
      TotalCredit: totalCredit,
      TotalReceipts: totalReceipts,
      AccountCreditDebits: accountCreditDebit,
      Balance: netBalance,
      OutstandingBalance: Math.max(0, netBalance),
      SchoolFeeOutstanding: calculateSchoolFeeOutstanding(schoolFeeExpectedDebit, schoolFeeCredit),
      ExcessCredit: Math.max(0, -netBalance),
      WalletBalance: asMoneyNumber(walletBalance),
      LastPaymentAt: lastPaymentAt
    };
  }).sort((a, b) => clean(a.DisplayName || a.AccountRef).localeCompare(clean(b.DisplayName || b.AccountRef)));
  const visibleInvoices = normalizedInvoices.filter((invoice) => {
    if (!isAcceptanceFeeLike(invoice)) return true;
    const owner = accountRows.find((account) => financialRowMatchesAccount(invoice, account));
    return !owner || isNewIntakeApplication(owner);
  });
  const visibleLedger = ledgerRows.filter((row) => {
    if (!isAcceptanceFeeLike(row) || asMoneyNumber(row.Debit) <= 0) return true;
    const owner = accountRows.find((account) => financialRowMatchesAccount(row, account));
    return !owner || isNewIntakeApplication(owner);
  });
  return {
    ok: true,
    message: 'Accounts loaded from Firestore.',
    accounts: accountRows,
    payments: normalizedPayments,
    invoices: visibleInvoices,
    ledger: visibleLedger,
    feeItems: feeItems.map(normalizeFeeItem),
    billingCategories: billingCategories.map((row) => clean(row.Name || row.BillingCategory || row.__id)).filter(Boolean).sort()
  };
}

async function saveBillingCategory(env, body) {
  const name = clean(body.Name || body.BillingCategory || body.name);
  const originalName = clean(body.OriginalName || body.originalName);
  if (!name || sameText(name, 'All')) { const err = new Error('Enter a billing category name other than All.'); err.status = 400; throw err; }
  const payload = { Name: name, Active: yesNo(body.Active ?? 'YES') || 'YES', UpdatedAt: nowIso() };
  await upsertDocument(env, 'billingCategories', safeDocumentId(name), payload);
  if (originalName && !sameText(originalName, name)) {
    await deleteDocument(env, 'billingCategories', safeDocumentId(originalName));
  }
  return { ok: true, message: originalName && !sameText(originalName, name) ? 'Billing category renamed.' : 'Billing category saved.', category: payload };
}

async function deleteBillingCategory(env, body) {
  const name = clean(body.Name || body.BillingCategory || body.name);
  if (!name || sameText(name, 'All')) { const err = new Error('Select a billing category to delete.'); err.status = 400; throw err; }
  await deleteDocument(env, 'billingCategories', safeDocumentId(name));
  return { ok: true, message: 'Billing category deleted.' };
}

async function getStoreOverview(env, body) {
  const storeType = clean(body.StoreType || body.storeType);
  const [{ categories, items }, orders] = await Promise.all([ensureStoreCategories(env), listCollection(env, 'storeOrders')]);
  const matches = (row) => !storeType || sameText(row.StoreType, storeType);
  return {
    ok: true, message: 'Store catalog and orders loaded.',
    categories: categories.filter((row) => !storeType || categoryApplies(row, storeType)).sort((a, b) => clean(a.Name).localeCompare(clean(b.Name))),
    items: items.filter(matches).sort((a, b) => clean(a.ItemName).localeCompare(clean(b.ItemName))),
    orders: orders.filter(matches).sort((a, b) => clean(b.PaidAt || b.CreatedAt).localeCompare(clean(a.PaidAt || a.CreatedAt)))
  };
}

async function saveStoreItem(env, body) {
  const storeType = clean(body.StoreType || body.storeType);
  const itemCode = clean(body.ItemCode || body.itemCode);
  const itemName = clean(body.ItemName || body.itemName);
  if (!['Bookstore', 'Uniform Store'].includes(storeType) || !itemCode || !itemName) {
    const err = new Error('Store type, item code and item name are required.'); err.status = 400; throw err;
  }
  const existing = (await listCollection(env, 'storeItems')).find((row) => sameText(row.StoreType, storeType) && sameText(row.ItemCode, itemCode)) || {};
  const category = await resolveStoreCategory(env, body, storeType);
  const className = canonicalConfiguredClass(clean(body.ClassName) || 'All', await configuredClassNames(env));
  const payload = {
    ...existing, StoreType: storeType, ItemCode: itemCode, ItemName: itemName,
    CategoryId: category.CategoryId, Category: category.Name, Gender: clean(body.Gender) || 'All', ClassName: className,
    Size: clean(body.Size), Price: asMoneyNumber(body.Price), Quantity: Math.max(0, asMoneyNumber(body.Quantity)),
    Active: yesNo(body.Active ?? 'YES') || 'YES', UpdatedAt: nowIso(), CreatedAt: existing.CreatedAt || nowIso()
  };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, 'storeItems', safeDocumentId(`${storeType}-${itemCode}`), payload);
  return { ok: true, message: `${storeType} item saved.`, item: payload };
}

async function saveStoreCategoryAction(env, body) {
  const category = await saveStoreCategory(env, body, clean(body.UpdatedBy || body.RecordedBy));
  return { ok: true, message: clean(body.Active).toUpperCase() === 'NO' ? 'Category deactivated. Existing references were preserved.' : 'Category saved.', category };
}

async function updateStoreOrderStatus(env, body) {
  const orderNo = clean(body.OrderNo || body.orderNo);
  const orders = await listCollection(env, 'storeOrders');
  const existing = orders.find((row) => sameText(row.OrderNo, orderNo) || sameText(row.__id, safeDocumentId(orderNo)));
  if (!existing) { const err = new Error('Store order was not found.'); err.status = 404; throw err; }
  const status = clean(body.Status || body.status) || 'Ready for Collection';
  let verifiedReference = '';
  if (sameText(status, 'Collected')) {
    verifiedReference = clean(body.CollectionReference || body.collectionReference);
    if (!verifiedReference) { const err = new Error('Scan or enter the student card ID, admission number, or parent verification code before collection.'); err.status = 400; throw err; }
    const student = await findStudentByAccountRef(env, existing.AccountRef || existing.AdmissionNo);
    const allowedReferences = [
      existing.AccountRef, existing.AdmissionNo,
      student && student.AccountRef, student && student.AdmissionNo,
      student && student.WalletCardId, student && student.VerificationCode, student && student.ParentLoginCode
    ].map(clean).filter(Boolean);
    if (!allowedReferences.some((value) => sameReferenceIdentity(value, verifiedReference) || sameText(value, verifiedReference))) {
      const err = new Error('The collection reference does not match the student on this order. Nothing was marked collected.'); err.status = 409; throw err;
    }
  }
  const payload = { ...existing, Status: status, UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) || 'Store Keeper' };
  delete payload.__id; delete payload.__name;
  if (sameText(status, 'Collected')) { payload.CollectedAt = nowIso(); payload.CollectedBy = clean(body.RecordedBy) || 'Store Keeper'; payload.CollectionReferenceVerified = verifiedReference; }
  await upsertDocument(env, 'storeOrders', safeDocumentId(orderNo), payload);
  return { ok: true, message: `Order marked ${status}.`, order: payload };
}

async function saveBrevoSettings(env, body) {
  const senderName = clean(body.BrevoSenderName || body.SenderName || body.senderName);
  const senderEmail = clean(body.BrevoSenderEmail || body.SenderEmail || body.senderEmail);
  const apiKey = clean(body.BrevoApiKey || body.ApiKey || body.apiKey);
  if (!senderEmail) {
    const err = new Error('Brevo sender email is required.');
    err.status = 400;
    throw err;
  }
  const now = nowIso();
  const payload = {
    BrevoSenderName: senderName,
    BrevoSenderEmail: senderEmail,
    BrevoReplyToEmail: clean(body.BrevoReplyToEmail || body.ReplyToEmail),
    BrevoReplyToName: clean(body.BrevoReplyToName || body.ReplyToName),
    UpdatedAt: now,
    UpdatedBy: clean(body.UserRole || body.UpdatedBy || body.updatedBy) || 'Super Admin'
  };
  if (apiKey) {
    payload.BrevoApiKey = apiKey;
    payload.ApiKeyUpdatedAt = now;
  }
  await upsertDocument(env, 'settings', 'brevo', payload);
  return {
    ok: true,
    message: 'Brevo settings saved to Firestore.',
    settings: {
      BrevoSenderName: senderName,
      BrevoSenderEmail: senderEmail,
      BrevoReplyToEmail: payload.BrevoReplyToEmail,
      BrevoReplyToName: payload.BrevoReplyToName,
      HasBrevoApiKey: Boolean(apiKey)
    }
  };
}

async function saveSchoolProfile(env, body) {
  const existingOrganization = await getDocument(env, 'settings', 'organisationProfile').catch(() => null);
  const branchValues = Array.isArray(body.SchoolBranches) ? body.SchoolBranches : clean(body.SchoolBranches || body.schoolBranches || 'Main Branch').split(',');
  const requestedActiveBranchId = safeScopeId(body.ActiveBranchId || body.activeBranchId || 'main');
  const branches = branchValues.map((value) => {
    const name = clean(typeof value === 'string' ? value : value.Name || value.name || value.Id || value.id);
    return { Id: safeScopeId(typeof value === 'string' ? name : value.Id || value.id || name), Name: name || 'Main Branch' };
  }).filter((row, index, rows) => rows.findIndex((candidate) => candidate.Id === row.Id) === index);
  if (branches.length && !branches.some((row) => row.Id === requestedActiveBranchId)) branches[0].Id = requestedActiveBranchId;
  const activeBranchId = requestedActiveBranchId || branches[0]?.Id || 'main';
  const sections = [];
  if (yesNo(body.EnablePrimarySection ?? body.enablePrimarySection ?? 'YES') === 'YES') sections.push('primary');
  if (yesNo(body.EnableSecondarySection ?? body.enableSecondarySection ?? 'YES') === 'YES') sections.push('secondary');
  if (!sections.length) sections.push('primary', 'secondary');
  const documentRequirements = {
    BirthCertificate: yesNo(body.EnableBirthCertificate ?? 'YES') === 'YES',
    PreviousSchoolReport: yesNo(body.EnablePreviousSchoolReport ?? 'YES') === 'YES',
    PassportPhotograph: yesNo(body.EnablePassportPhotograph ?? 'YES') === 'YES',
    MedicalReport: yesNo(body.EnableMedicalReport ?? 'YES') === 'YES',
    TransferCertificateDoc: yesNo(body.EnableTransferCertificateDoc ?? 'YES') === 'YES',
    AcceptanceForm: yesNo(body.EnableAcceptanceForm ?? 'YES') === 'YES'
  };
  const profile = {
    SchoolName: clean(body.SchoolName || body.schoolName) || 'Integrated School Management Suite',
    SchoolCode: normalizeSchoolCode(body.SchoolCode || body.schoolCode),
    SchoolAddress: clean(body.SchoolAddress || body.schoolAddress),
    SchoolPhone: clean(body.SchoolPhone || body.schoolPhone),
    SchoolEmail: clean(body.SchoolEmail || body.schoolEmail),
    SchoolSignatoryName: clean(body.SchoolSignatoryName || body.schoolSignatoryName),
    SchoolSignatoryTitle: clean(body.SchoolSignatoryTitle || body.schoolSignatoryTitle),
    ResultSignatoryName: clean(body.ResultSignatoryName || body.resultSignatoryName),
    ResultSignatoryTitle: clean(body.ResultSignatoryTitle || body.resultSignatoryTitle),
    OfferSignatoryName: clean(body.OfferSignatoryName || body.offerSignatoryName),
    OfferSignatoryTitle: clean(body.OfferSignatoryTitle || body.offerSignatoryTitle),
    AdmissionSignatoryName: clean(body.AdmissionSignatoryName || body.admissionSignatoryName),
    AdmissionSignatoryTitle: clean(body.AdmissionSignatoryTitle || body.admissionSignatoryTitle),
    EmailGreetingTemplate: clean(body.EmailGreetingTemplate || body.emailGreetingTemplate) || 'Dear Parent/Guardian,',
    NameFormat: clean(body.NameFormat || body.nameFormat) || 'Surname, first name, middle name',
    PortalHeadline: clean(body.PortalHeadline || body.portalHeadline) || 'Admissions and parent services in one place',
    PortalSubheading: clean(body.PortalSubheading || body.portalSubheading) || 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.',
    PortalNotice: clean(body.PortalNotice || body.portalNotice),
    CurrentAcademicSession: clean(body.CurrentAcademicSession || body.currentAcademicSession),
    CurrentTerm: clean(body.CurrentTerm || body.currentTerm) || 'First Term',
    DeclarationStatement: clean(body.DeclarationStatement || body.declarationStatement) || 'I declare that the information supplied in this application is complete and correct.',
    ResultDisplayMode: clean(body.ResultDisplayMode || body.resultDisplayMode) || 'subjects',
    ShowResultsOnline: yesNo(body.ShowResultsOnline ?? body.showResultsOnline ?? 'NO') || 'NO',
    OfferDocumentBodyTemplate: clean(body.OfferDocumentBodyTemplate || body.offerDocumentBodyTemplate),
    AdmissionDocumentBodyTemplate: clean(body.AdmissionDocumentBodyTemplate || body.admissionDocumentBodyTemplate),
    UpdatedAt: nowIso(),
    UpdatedBy: clean(body.UserRole || body.UpdatedBy || body.updatedBy) || 'Super Admin'
  };
  const organization = resolveOrganizationConfig({
    env,
    organizationProfile: {
      ...(existingOrganization || {}),
      Edition: body.OrganisationEdition || body.OrganizationEdition || body.organisationEdition || body.organizationEdition || existingOrganization?.Edition,
      Name: body.OrganisationName || body.OrganizationName || body.organisationName || body.organizationName || existingOrganization?.Name || profile.SchoolName,
      Code: body.OrganisationCode || body.OrganizationCode || body.organisationCode || body.organizationCode || existingOrganization?.Code || profile.SchoolCode,
      FeatureFlags: body.FeatureFlags || body.featureFlags || existingOrganization?.FeatureFlags
    },
    legacyProfile: profile
  });
  profile.OrganisationEdition = organization.Edition;
  profile.OrganisationName = organization.Name;
  profile.OrganisationCode = organization.Code;
  profile.FeatureFlags = organization.FeatureFlags;
  if (body.WebLogoDataUrl !== undefined || body.webLogoDataUrl !== undefined) {
    const webLogo = clean(body.WebLogoDataUrl ?? body.webLogoDataUrl);
    if (webLogo && (!/^data:image\/(png|jpeg|webp);base64,/i.test(webLogo) || webLogo.length > 750000)) {
      const error = new Error('The web logo must be a resized PNG, JPG, or WebP image below the allowed size.');
      error.status = 400;
      throw error;
    }
    await upsertDocument(env, 'settings', 'webBranding', { WebLogoDataUrl: webLogo, UpdatedAt: nowIso() });
  }
  if (body.DocumentLogoDataUrl !== undefined || body.DocumentSignatureDataUrl !== undefined) {
    const documentLogo = clean(body.DocumentLogoDataUrl);
    const documentSignature = clean(body.DocumentSignatureDataUrl);
    for (const [label, value] of [['document logo', documentLogo], ['document signature', documentSignature]]) {
      if (value && (!/^data:image\/(png|jpeg);base64,/i.test(value) || value.length > 750000)) {
        const error = new Error(`The ${label} must be a resized PNG or JPG image below the allowed size.`);
        error.status = 400;
        throw error;
      }
    }
    await upsertDocument(env, 'settings', 'documentBranding', {
      DocumentLogoDataUrl: documentLogo,
      DocumentSignatureDataUrl: documentSignature,
      UpdatedAt: nowIso()
    });
  }
  await upsertDocument(env, 'settings', 'schoolStructure', {
    Branches: branches.length ? branches : [{ Id: 'main', Name: 'Main Branch' }], ActiveBranchId: activeBranchId,
    Sections: sections, UpdatedAt: nowIso(), UpdatedBy: profile.UpdatedBy
  });
  await upsertDocument(env, 'settings', 'admissionDocuments', {
    Enabled: documentRequirements, UpdatedAt: nowIso(), UpdatedBy: profile.UpdatedBy
  });
  await upsertDocument(env, 'settings', 'organisationProfile', organizationProfileDocument(organization, {
    UpdatedAt: profile.UpdatedAt, UpdatedBy: profile.UpdatedBy
  }));
  await upsertDocument(env, 'settings', 'schoolProfile', profile);
  return { ok: true, message: 'School profile saved to Firestore.', profile };
}

async function getSchoolProfile(env) {
  const [profile, branding, storedStructure, documentSettings, organizationProfile] = await Promise.all([
    getDocument(env, 'settings', 'schoolProfile').catch(() => null),
    getDocument(env, 'settings', 'webBranding').catch(() => null),
    getDocument(env, 'settings', 'schoolStructure').catch(() => null),
    getDocument(env, 'settings', 'admissionDocuments').catch(() => null),
    getDocument(env, 'settings', 'organisationProfile').catch(() => null)
  ]);
  const structure = storedStructure || await getSchoolStructure(env);
  const enabledDocuments = documentSettings?.Enabled && typeof documentSettings.Enabled === 'object' ? documentSettings.Enabled : {};
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile: profile || {} });
  return {
    ok: true,
    profile: { ...(profile || {
      SchoolName: 'Integrated School Management Suite',
      SchoolCode: normalizeSchoolCode(env.SCHOOL_CODE),
      SchoolAddress: '',
      SchoolPhone: '',
      SchoolEmail: '',
      SchoolSignatoryName: '',
      SchoolSignatoryTitle: '',
      ResultSignatoryName: '',
      ResultSignatoryTitle: '',
      OfferSignatoryName: '',
      OfferSignatoryTitle: '',
      AdmissionSignatoryName: '',
      AdmissionSignatoryTitle: '',
      EmailGreetingTemplate: 'Dear Parent/Guardian,',
      NameFormat: 'Surname, first name, middle name',
      PortalHeadline: 'Admissions and parent services in one place',
      PortalSubheading: 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.',
      PortalNotice: '',
      CurrentAcademicSession: '',
      CurrentTerm: 'First Term',
      DeclarationStatement: 'I declare that the information supplied in this application is complete and correct.',
      ResultDisplayMode: 'subjects',
      ShowResultsOnline: 'NO'
    }),
      OrganisationEdition: organization.Edition,
      OrganisationName: organization.Name,
      OrganisationCode: organization.Code,
      FeatureFlags: organization.FeatureFlags,
      SchoolBranches: (structure.Branches || []).map((row) => clean(typeof row === 'string' ? row : row.Name || row.Id)).filter(Boolean).join(', '),
      ActiveBranchId: clean(structure.ActiveBranchId || 'main'),
      EnablePrimarySection: (structure.Sections || []).includes('primary') ? 'YES' : 'NO',
      EnableSecondarySection: (structure.Sections || []).includes('secondary') ? 'YES' : 'NO',
      EnableBirthCertificate: enabledDocuments.BirthCertificate === false ? 'NO' : 'YES',
      EnablePreviousSchoolReport: enabledDocuments.PreviousSchoolReport === false ? 'NO' : 'YES',
      EnablePassportPhotograph: enabledDocuments.PassportPhotograph === false ? 'NO' : 'YES',
      EnableMedicalReport: enabledDocuments.MedicalReport === false ? 'NO' : 'YES',
      EnableTransferCertificateDoc: enabledDocuments.TransferCertificateDoc === false ? 'NO' : 'YES',
      EnableAcceptanceForm: enabledDocuments.AcceptanceForm === false ? 'NO' : 'YES',
      WebLogoConfigured: Boolean(branding && clean(branding.WebLogoDataUrl)), WebLogoUrl: branding && clean(branding.WebLogoDataUrl) ? '/api/web-logo' : '' }
  };
}

function applicationNotFound(id) {
  const err = new Error(id ? `Application not found: ${id}` : 'ApplicationID or ApplicationReference is required.');
  err.status = id ? 404 : 400;
  return err;
}

async function updateApplicationStatus(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const now = nowIso();
  const updates = {
    Status: clean(body.Status || body.status) || pick(existing, ['Status', 'status']),
    ReviewedBy: clean(body.ReviewedBy || body.reviewedBy) || 'Admissions Office',
    ReviewDate: now,
    UpdatedAt: now
  };
  if (body.Notes !== undefined) updates.Notes = clean(body.Notes);
  if (body.AdmissionNo !== undefined) updates.AdmissionNo = clean(body.AdmissionNo);
  if (body.Term !== undefined) updates.Term = clean(body.Term);
  if (body.ClassArm !== undefined || body.Arm !== undefined) updates.ClassArm = clean(body.ClassArm || body.Arm);
  [
    'AcceptanceFeePaid',
    'AcceptanceFeePaidAt',
    'AcceptanceFeeAmount',
    'AcceptanceFeeMethod',
    'AcceptanceFeeReceiptNo',
    'AcceptanceFeeReceivedBy'
  ].forEach((key) => {
    if (body[key] !== undefined) updates[key] = body[key];
  });
  if (updates.Status === 'Paid' && !updates.AcceptanceFeePaid) updates.AcceptanceFeePaid = 'YES';
  if (updates.AcceptanceFeePaid && !updates.AcceptanceFeePaidAt) updates.AcceptanceFeePaidAt = now;
  const saved = await saveApplication(env, { ...existing, ...updates });

  const admissionNo = updates.AdmissionNo || pick(existing, ['AdmissionNo']);
  const student = await findStudent(env, admissionNo, pick(existing, ['ApplicationReference', 'ApplicationID']));
  if (student && (body.AdmissionNo !== undefined || body.Term !== undefined || body.ClassArm !== undefined || body.Arm !== undefined)) {
    const studentUpdates = { ...student, UpdatedAt: now };
    if (body.AdmissionNo !== undefined) studentUpdates.AdmissionNo = clean(body.AdmissionNo);
    if (body.Term !== undefined) studentUpdates.Term = clean(body.Term);
    if (body.ClassArm !== undefined || body.Arm !== undefined) studentUpdates.ClassArm = clean(body.ClassArm || body.Arm);
    await saveStudent(env, studentUpdates);
  }
  return { ok: true, message: 'Application status updated.', application: saved };
}

async function updateApplicantNotes(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const saved = await saveApplication(env, {
    ...existing,
    Notes: clean(body.Notes || body.notes),
    ReviewedBy: clean(body.ReviewedBy || body.reviewedBy) || 'Admissions Office',
    ReviewDate: nowIso(),
    UpdatedAt: nowIso()
  });
  return { ok: true, message: 'Applicant notes updated.', application: saved };
}

async function updateEntranceResult(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const resultStatus = clean(body.ResultStatus || body.resultStatus || 'Pending');
  const updates = {
    EnglishScore: body.EnglishScore ?? '',
    MathematicsScore: body.MathematicsScore ?? '',
    InterviewScore: body.InterviewScore ?? '',
    TotalScore: body.TotalScore ?? '',
    ResultPercentage: body.ResultPercentage ?? '',
    ResultStatus: resultStatus,
    ResultNotes: body.ResultNotes ?? '',
    ResultNextStep: body.ResultNextStep ?? body.NextStep ?? '',
    ResultUpdatedBy: clean(body.ResultUpdatedBy) || 'Admissions Office',
    ResultUpdatedAt: nowIso(),
    ResultReadyOnline: clean(body.ResultReadyOnline || body.resultReadyOnline || body.ResultPublished || body.ShowResultOnPortal || ''),
    ResultPublished: clean(body.ResultPublished || body.resultPublished || body.ResultReadyOnline || body.ShowResultOnPortal || ''),
    ShowResultOnPortal: clean(body.ShowResultOnPortal || body.showResultOnPortal || body.ResultReadyOnline || body.ResultPublished || ''),
    UpdatedAt: nowIso()
  };
  if (resultStatus === 'Admitted') updates.Status = 'Accepted';
  if (resultStatus === 'Not Admitted') updates.Status = 'Rejected';
  if (resultStatus === 'Pending') updates.Status = 'Pending';
  const saved = await saveApplication(env, { ...existing, ...updates });
  return { ok: true, message: 'Entrance result updated.', application: saved };
}

async function updateApplicantIntelligence(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const ignored = new Set(['Secret', 'secret', 'Action', 'action', 'ApplicationID', 'ApplicationReference']);
  const updates = { UpdatedAt: nowIso(), IntelligenceUpdatedBy: clean(body.UpdatedBy) || 'Admissions Office' };
  Object.entries(body || {}).forEach(([key, value]) => {
    if (!ignored.has(key)) updates[key] = value;
  });
  const saved = await saveApplication(env, { ...existing, ...updates });
  return { ok: true, message: 'Applicant intelligence updated.', application: saved };
}

async function updateApplicationDetails(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const ignored = new Set(['Secret', 'secret', 'Action', 'action', 'id', '__id']);
  const updates = { UpdatedAt: nowIso(), UpdatedBy: clean(body.UpdatedBy || body.UserRole) || 'Super Admin' };
  Object.entries(body || {}).forEach(([key, value]) => {
    if (!ignored.has(key)) updates[key] = value;
  });
  const classNames = await configuredClassNames(env);
  for (const key of ['ClassApplyingFor', 'ClassAppliedFor', 'ClassAdmitted', 'ClassName']) {
    if (updates[key] !== undefined) updates[key] = canonicalConfiguredClass(updates[key], classNames);
  }
  const saved = await saveApplication(env, { ...existing, ...updates });
  return { ok: true, message: 'Application details updated.', application: saved };
}

async function deleteApplication(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const docId = safeDocumentId(pick(existing, ['ApplicationReference', 'ApplicationID', '__id']) || id);
  await deleteSchoolDocument(env, 'applications', docId, existing);
  return { ok: true, message: 'Application deleted.', applicationReference: id };
}

function nextStudentAdmissionNo(students, session = '', schoolCode = 'DCA') {
  const yearMatch = clean(session).match(/20(\d{2})/);
  const yearCode = yearMatch ? yearMatch[1] : String(new Date().getFullYear()).slice(-2);
  const prefix = normalizeSchoolCode(schoolCode);
  let maxNo = 0;
  students.forEach((row) => {
    const admissionNo = pick(row, ['AdmissionNo', 'admissionNo', '__id']);
    const match = clean(admissionNo).match(new RegExp(`^${prefix}/${yearCode}/(\\d+)$`, 'i')) || clean(admissionNo).match(/(\d+)$/);
    if (match) maxNo = Math.max(maxNo, Number(match[1]));
  });
  return `${prefix}/${yearCode}/${String(maxNo + 1).padStart(6, '0')}`;
}

async function importStudents(env, body) {
  const rows = Array.isArray(body.Students) ? body.Students : [];
  if (!rows.length) {
    const err = new Error('No student rows were supplied.');
    err.status = 400;
    throw err;
  }
  const existingStudents = await listSchoolCollection(env, 'students');
  const schoolCode = await getSchoolCode(env);
  const classNames = await configuredClassNames(env);
  const importedBy = clean(body.ImportedBy || body.importedBy) || 'Admissions Office';
  let imported = 0;
  let skipped = 0;
  const failures = [];
  const savedStudents = [];
  const credentials = [];
  const loginCodes = new Set(existingStudents.flatMap((row) => studentLoginCodes(row)));
  for (let index = 0; index < rows.length; index += 1) {
    const input = rows[index] || {};
    const rowNo = index + 1;
    const applicantName = pick(input, ['ApplicantName', 'StudentName', 'Name']);
    const classAdmitted = canonicalConfiguredClass(pick(input, ['ClassAdmitted', 'ClassName', 'Class']), classNames);
    let admissionNo = pick(input, ['AdmissionNo', 'AdmissionNumber']);
    let appRef = pick(input, ['ApplicationReference']);
    if (!applicantName) {
      skipped += 1;
      failures.push(`Row ${rowNo}: missing student name.`);
      continue;
    }
    if (!classAdmitted) {
      skipped += 1;
      failures.push(`Row ${rowNo}: missing class.`);
      continue;
    }
    if (!admissionNo) admissionNo = nextStudentAdmissionNo([...existingStudents, ...savedStudents], input.AcademicSession || input.Session || '', schoolCode);
    const applicationReferenceOwner = appRef && [...existingStudents, ...savedStudents].find((row) =>
      sameText(row.ApplicationReference || row.applicationReference, appRef) &&
      !sameReferenceIdentity(row.AdmissionNo || row.admissionNo || row.__id, admissionNo)
    );
    if (applicationReferenceOwner) {
      failures.push(`Row ${rowNo} (${admissionNo}): duplicate application reference ${appRef} was removed; admission number remains the account identity.`);
      appRef = '';
    }
    const duplicate = [...existingStudents, ...savedStudents].find((row) =>
      sameReferenceIdentity(row.AdmissionNo || row.admissionNo || row.__id, admissionNo)
    );
    if (duplicate) {
      skipped += 1;
      failures.push(`Row ${rowNo} (${admissionNo}): already exists.`);
      continue;
    }
    let parentLoginCode = clean(input.ParentLoginCode || input.VerificationCode || input.LoginCode).toUpperCase();
    if (!parentLoginCode) parentLoginCode = generateParentLoginCode(loginCodes);
    loginCodes.add(parentLoginCode);
    const student = {
      ...input,
      EnrolledAt: input.EnrolledAt || nowIso(),
      ApplicationReference: appRef,
      AdmissionNo: admissionNo,
      ApplicantName: applicantName,
      DisplayName: applicantName,
      ClassAdmitted: classAdmitted,
      ClassName: classAdmitted,
      AcademicSession: input.AcademicSession || input.Session || '',
      Term: input.Term || '',
      StudentType: input.StudentType || 'Day Student',
      BillingCategory: input.BillingCategory || input['Billing Category'] || 'Regular',
      Gender: input.Gender || input.Sex || '',
      ParentLoginCode: parentLoginCode,
      VerificationCode: parentLoginCode,
      EnrollmentCategory: input.EnrollmentCategory || input.IntakeCategory || 'Returning',
      AcademicProgress: input.AcademicProgress || input.ProgressCategory || input.RepeaterStatus || 'Promoted',
      Status: input.Status || 'Active',
      ImportedAt: nowIso(),
      ImportedBy: importedBy,
      EnrolledBy: input.EnrolledBy || importedBy,
      UpdatedAt: nowIso()
    };
    const saved = await saveStudent(env, student);
    savedStudents.push(saved);
    credentials.push({
      AdmissionNo: admissionNo,
      DisplayName: applicantName,
      ParentEmail: lower(input.ParentEmail || input.VerificationEmail || input.Email),
      ParentLoginCode: parentLoginCode,
      LoginReady: Boolean(clean(input.ParentEmail || input.VerificationEmail || input.Email))
    });
    imported += 1;
  }
  return { ok: true, message: 'Student import completed.', imported, skipped, failures, credentials, students: (await listSchoolCollection(env, 'students')).map(normalizeStudent) };
}

async function promoteStudents(env, body) {
  const targets = Array.isArray(body.Students) ? body.Students : [];
  const newClass = canonicalConfiguredClass(clean(body.NewClass || body.newClass), await configuredClassNames(env));
  const session = clean(body.AcademicSession || body.Session);
  const term = clean(body.Term);
  const promotedBy = clean(body.PromotedBy || body.promotedBy) || 'Admissions Office';
  if (!targets.length) throw new Error('No students were selected for promotion.');
  if (!newClass) throw new Error('New class is required.');
  if (!session) throw new Error('Academic session is required.');
  let promoted = 0;
  let skipped = 0;
  const failures = [];
  const existingStudents = await listSchoolCollection(env, 'students');
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index] || {};
    const admissionNo = pick(target, ['AdmissionNo', 'AdmissionNumber']);
    const applicationReference = pick(target, ['ApplicationReference']);
    const student = existingStudents.find((row) =>
      (admissionNo && (sameText(row.AdmissionNo || row.admissionNo || row.__id, admissionNo))) ||
      (applicationReference && sameText(row.ApplicationReference || row.applicationReference, applicationReference))
    );
    if (!student) {
      skipped += 1;
      failures.push(`Selected row ${index + 1}: student not found.`);
      continue;
    }
    const currentStatus = normalizeMatchText(pick(student, ['Status'], 'Active'));
    if (['withdrawn', 'expelled', 'graduated'].includes(currentStatus)) {
      skipped += 1;
      failures.push(`Selected row ${index + 1}: ${pick(student, ['DisplayName', 'ApplicantName', 'AdmissionNo']) || 'student'} is ${pick(student, ['Status'])} and was not moved.`);
      continue;
    }
    const oldClass = pick(student, ['ClassAdmitted', 'ClassName']);
    const line = `${nowIso()} | ${oldClass || 'Unspecified'} -> ${newClass} | ${session}${term ? ` | ${term}` : ''} | ${promotedBy}`;
    await saveStudent(env, {
      ...student,
      PreviousClass: oldClass,
      ClassAdmitted: newClass,
      ClassName: newClass,
      AcademicSession: session,
      Term: term || student.Term || '',
      EnrollmentCategory: 'Returning',
      AcademicProgress: clean(body.AcademicProgress || body.ProgressCategory) || 'Promoted',
      PromotedAt: nowIso(),
      PromotedBy: promotedBy,
      PromotionHistory: student.PromotionHistory ? `${student.PromotionHistory}\n${line}` : line,
      UpdatedAt: nowIso()
    });
    promoted += 1;
  }
  return { ok: true, message: 'Student promotion completed.', promoted, skipped, failures, students: (await listSchoolCollection(env, 'students')).map(normalizeStudent) };
}

async function enrollStudent(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  if (yesNo(pick(existing, ['Enrolled'])) === 'YES' || pick(existing, ['Status']) === 'Enrolled') throw new Error('Student is already enrolled.');
  if (pick(existing, ['ResultStatus']) !== 'Admitted') throw new Error('Entrance result is not marked Admitted.');
  if (yesNo(pick(existing, ['OfferSent'])) !== 'YES') throw new Error('Offer of Admission has not been sent.');
  if (yesNo(pick(existing, ['AcceptanceFeePaid'])) !== 'YES') throw new Error('Acceptance Fee has not been marked Paid.');
  if (yesNo(pick(existing, ['AdmissionLetterSent'])) !== 'YES' && pick(existing, ['Status']) !== 'Admission Letter Sent') throw new Error('Admission Letter has not been sent.');
  const admissionNo = pick(existing, ['AdmissionNo', 'AdmissionNumber']);
  if (!admissionNo) throw new Error('Admission number is missing.');
  const appRef = pick(existing, ['ApplicationReference', 'ApplicationID']);
  if (await findStudent(env, admissionNo, appRef)) throw new Error('A student record already exists for this application or admission number.');
  const enrolledBy = clean(body.EnrolledBy || body.enrolledBy) || 'Admissions Office';
  const applicantName = pick(existing, ['ApplicantName', 'Name', 'DisplayName']);
  const admittedClass = canonicalConfiguredClass(pick(existing, ['ClassApplyingFor', 'ClassName']), await configuredClassNames(env));
  const student = await saveStudent(env, {
    EnrolledAt: nowIso(),
    ApplicationReference: appRef,
    AdmissionNo: admissionNo,
    Surname: pick(existing, ['Surname']),
    FirstName: pick(existing, ['FirstName']),
    MiddleName: pick(existing, ['MiddleName']),
    ApplicantName: applicantName,
    DisplayName: applicantName,
    Gender: pick(existing, ['Gender']),
    DateOfBirth: pick(existing, ['DateOfBirth']),
    ClassAdmitted: admittedClass,
    ClassName: admittedClass,
    AcademicSession: pick(existing, ['AcademicSession']),
    Term: pick(existing, ['Term']),
    StudentType: pick(existing, ['StudentType']),
    BillingCategory: pick(existing, ['BillingCategory'], 'Regular'),
    EnrollmentCategory: 'New Intake',
    AcademicProgress: 'New Intake',
    ParentName: pick(existing, ['FatherName', 'MotherName', 'GuardianName', 'ParentName']),
    ParentPhone: pick(existing, ['FatherPhone', 'MotherPhone', 'GuardianPhone', 'ParentPhone']),
    ParentEmail: pick(existing, ['ParentEmail', 'VerificationEmail', 'FatherEmail', 'MotherEmail']),
    ResidentialAddress: pick(existing, ['ResidentialAddress']),
    CityArea: pick(existing, ['CityArea']),
    StateOfResidence: pick(existing, ['StateOfResidence']),
    BloodGroup: pick(existing, ['BloodGroup']),
    Genotype: pick(existing, ['Genotype']),
    MedicalCondition: pick(existing, ['MedicalCondition']),
    EmergencyContactName: pick(existing, ['EmergencyContactName']),
    EmergencyContactPhone: pick(existing, ['EmergencyContactPhone']),
    PreviousSchool: pick(existing, ['PreviousSchool']),
    AcceptanceFeePaidAt: pick(existing, ['AcceptanceFeePaidAt']),
    AcceptanceFeeAmount: pick(existing, ['AcceptanceFeeAmount']),
    AcceptanceFeeMethod: pick(existing, ['AcceptanceFeeMethod']),
    AcceptanceFeeReceiptNo: pick(existing, ['AcceptanceFeeReceiptNo']),
    EnrolledBy: enrolledBy,
    Status: 'Active',
    UpdatedAt: nowIso()
  });
  const application = await saveApplication(env, { ...existing, Enrolled: 'YES', EnrolledAt: nowIso(), EnrolledBy: enrolledBy, Status: 'Enrolled', UpdatedAt: nowIso() });
  return { ok: true, message: 'Student enrolled successfully.', application, student };
}

async function markApplicationFlag(env, body, flagName, dateName, message) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const updates = { [flagName]: 'YES', [dateName]: nowIso(), UpdatedAt: nowIso() };
  if (flagName === 'AdmissionLetterSent') updates.Status = 'Admission Letter Sent';
  const saved = await saveApplication(env, { ...existing, ...updates });
  return { ok: true, message, application: saved };
}

export function formSaleFinancialAmounts(body = {}, configuredFormAmount = 0) {
  const recorded = asMoneyNumber(body.AmountPaid || body.Amount || body.amount);
  const configured = asMoneyNumber(configuredFormAmount);
  const explicitForm = asMoneyNumber(body.FormAmount || body.formAmount);
  const explicitGross = asMoneyNumber(body.GrossAmount || body.grossAmount);
  const explicitGatewayFee = asMoneyNumber(body.GatewayFee || body.gatewayFee);
  const explicitNet = asMoneyNumber(body.NetAmount || body.netAmount);
  const isLegacy = !explicitForm && !explicitGross && !explicitGatewayFee && !explicitNet;
  const gross = explicitGross || recorded || explicitForm || configured;
  const inferredLegacyFee = isLegacy && configured > 0 && gross > configured
    ? asMoneyNumber(gross - configured)
    : 0;
  const gatewayFee = explicitGatewayFee || inferredLegacyFee;
  const net = explicitNet || (gatewayFee > 0 ? Math.max(0, gross - gatewayFee) : (recorded || gross));
  const formAmount = explicitForm || configured || net || recorded || gross;
  const recognized = explicitNet || (gatewayFee > 0 ? net : formAmount);
  return {
    FormAmount: formAmount,
    GrossAmount: gross || formAmount,
    GatewayFee: gatewayFee,
    NetAmount: net || formAmount,
    RecognizedAmount: recognized || formAmount
  };
}

async function writeFormSaleAccountingJournal(env, sale) {
  const sourceId = clean(sale.ReceiptNo || sale.PaymentReference || sale.__id);
  const amount = formSaleFinancialAmounts(sale).RecognizedAmount;
  if (!sourceId || amount <= 0) return;
  const journalNo = `SYS-FORM-${safeDocumentId(sourceId)}`;
  const cashCode = accountingCashAccountFor(sale.PaymentMethod, sale.Gateway);
  await upsertDocument(env, 'accountingJournals', safeDocumentId(journalNo), {
    JournalNo: journalNo, Date: sale.PaymentDate || sale.Time || nowIso(), Status: 'Posted',
    Description: `Admission form sale: ${clean(sale.ApplicantName || sourceId)}`,
    Reference: sourceId, Source: 'Admission Form Sale', SourceId: sourceId, RecordedBy: 'System',
    Lines: [
      { AccountCode: cashCode, Debit: amount, Credit: 0, Description: 'Form sale net receipt' },
      { AccountCode: '4010', Debit: 0, Credit: amount, Description: 'Admission form revenue' }
    ],
    TotalDebit: amount, TotalCredit: amount, CreatedAt: sale.CreatedAt || nowIso(), UpdatedAt: nowIso()
  });
}

export async function recordSale(env, body) {
  const email = lower(body.Email || body.email);
  const code = clean(body.VerificationCode || body.verificationCode).toUpperCase();
  const receiptNo = clean(body.ReceiptNo || body.receiptNo);
  if (!email || !code) {
    const err = new Error('Email and VerificationCode are required.');
    err.status = 400;
    throw err;
  }
  const sameReceipt = receiptNo
    ? (await getDocument(env, 'formSales', safeDocumentId(receiptNo)).catch(() => null)) ||
      (await findOneByField(env, 'formSales', 'ReceiptNo', receiptNo).catch(() => null))
    : null;
  if (sameReceipt) {
    return {
      ok: true,
      duplicate: true,
      message: 'Sale already recorded.',
      receiptNo: pick(sameReceipt, ['ReceiptNo']) || receiptNo,
      verificationCode: pick(sameReceipt, ['VerificationCode']),
      email: pick(sameReceipt, ['Email']) || email,
      expiryDate: pick(sameReceipt, ['ExpiryDate'])
    };
  }
  const sameCode = await findOneByField(env, 'formSales', 'VerificationCode', code).catch(() => null);
  if (sameCode) {
    const err = new Error('This verification code already exists. Generate a different code.');
    err.status = 400;
    throw err;
  }
  const schoolCode = await getSchoolCode(env);
  const amounts = formSaleFinancialAmounts(body);
  const sale = {
    Time: body.Time || nowIso(),
    ReceiptNo: receiptNo || `${schoolCode}-FORM-${Date.now()}`,
    ApplicantName: clean(body.ApplicantName),
    Email: email,
    Phone: clean(body.Phone),
    ClassApplyingFor: canonicalConfiguredClass(clean(body.ClassApplyingFor), await configuredClassNames(env)),
    AmountPaid: formatNairaAmount(amounts.RecognizedAmount),
    FormAmount: amounts.FormAmount,
    GrossAmount: amounts.GrossAmount,
    GatewayFee: amounts.GatewayFee,
    NetAmount: amounts.NetAmount,
    Gateway: clean(body.Gateway) || (amounts.GatewayFee > 0 ? 'Paystack' : 'Manual'),
    PaymentMethod: clean(body.PaymentMethod || body.Method) || (amounts.GatewayFee > 0 ? 'Online' : 'Manual'),
    PaymentReference: clean(body.PaymentReference || body.Reference),
    FormLink: clean(body.FormLink),
    VerificationCode: code,
    PaymentDate: body.PaymentDate || nowIso().slice(0, 10),
    ExpiryDate: body.ExpiryDate || '',
    Status: body.Status || 'PAID',
    Used: body.Used || 'NO',
    CreatedAt: nowIso(),
    UpdatedAt: nowIso()
  };
  const created = await createDocumentIfAbsent(env, 'formSales', safeDocumentId(sale.ReceiptNo), sale);
  if (!created.created) {
    return {
      ok: true, duplicate: true, message: 'Sale already recorded.',
      receiptNo: sale.ReceiptNo, verificationCode: created.document?.VerificationCode || sale.VerificationCode,
      email: created.document?.Email || sale.Email, expiryDate: created.document?.ExpiryDate || sale.ExpiryDate
    };
  }
  if (sale.GatewayFee > 0) {
    const chargeId = safeDocumentId(`PAYSTACK-FORM-FEE-${sale.PaymentReference || sale.ReceiptNo}`);
    await upsertDocument(env, 'paymentGatewayCharges', chargeId, {
      ChargeId: chargeId, Date: sale.PaymentDate,
      Description: `Paystack admission-form transaction charge - ${sale.PaymentReference || sale.ReceiptNo}`,
      Amount: sale.GatewayFee, GrossCollection: sale.GrossAmount, NetSettlement: sale.NetAmount,
      Treatment: 'DeductedBeforeRevenueRecognition', Status: 'Recorded',
      Reference: sale.PaymentReference || sale.ReceiptNo, Source: 'Paystack Admission Form',
      CreatedAt: nowIso(), UpdatedAt: nowIso()
    });
  }
  await writeFormSaleAccountingJournal(env, sale);
  return {
    ok: true,
    message: 'Sale saved.',
    receiptNo: sale.ReceiptNo,
    verificationCode: sale.VerificationCode,
    email: sale.Email,
    expiryDate: sale.ExpiryDate
  };
}

function normalizeFormSale(row) {
  return {
    ...row,
    Time: pick(row, ['Time', 'Timestamp', 'CreatedAt']),
    ReceiptNo: pick(row, ['ReceiptNo', 'receiptNo', '__id']),
    ApplicantName: pick(row, ['ApplicantName', 'applicantName']),
    Email: lower(pick(row, ['Email', 'email'])),
    Phone: pick(row, ['Phone', 'phone']),
    ClassApplyingFor: pick(row, ['ClassApplyingFor', 'classApplyingFor', 'ClassName']),
    AmountPaid: pick(row, ['AmountPaid', 'amountPaid', 'Amount']),
    FormLink: pick(row, ['FormLink', 'formLink']),
    VerificationCode: clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase(),
    PaymentDate: toDisplayDate(pick(row, ['PaymentDate', 'paymentDate'])),
    ExpiryDate: toDisplayDate(pick(row, ['ExpiryDate', 'expiryDate'])),
    Status: pick(row, ['Status', 'status'], 'PAID'),
    Used: yesNo(pick(row, ['Used', 'used']))
  };
}

async function getFormSales(env) {
  const sales = (await listCollection(env, 'formSales'))
    .map(normalizeFormSale)
    .sort((a, b) => clean(b.Time || b.PaymentDate).localeCompare(clean(a.Time || a.PaymentDate)));
  return {
    ok: true,
    message: 'Form purchases loaded from Firestore.',
    backend: 'firestore',
    sales
  };
}

function normalizeAdmissionClass(row) {
  return {
    ...row,
    ClassName: pick(row, ['className', 'ClassName', '__id']),
    FormAmount: asMoneyNumber(pick(row, ['formAmount', 'FormAmount'])),
    Active: yesNo(pick(row, ['active', 'Active'])),
    SortOrder: asMoneyNumber(pick(row, ['sortOrder', 'SortOrder'], 100))
  };
}

function normalizeSchoolClass(row) {
  return {
    ...row,
    ClassName: pick(row, ['className', 'ClassName', '__id']),
    Arms: pick(row, ['arms', 'Arms', 'ClassArms']),
    Active: yesNo(pick(row, ['active', 'Active'])),
    SortOrder: asMoneyNumber(pick(row, ['sortOrder', 'SortOrder'], 100))
  };
}

export async function getSchoolClasses(env) {
  const classes = (await listCollection(env, 'settings/academics/classes'))
    .map(normalizeSchoolClass)
    .sort((a, b) => asMoneyNumber(a.SortOrder) - asMoneyNumber(b.SortOrder));
  return {
    ok: true,
    message: 'School classes loaded from Firestore.',
    backend: 'firestore',
    classes
  };
}

async function saveSchoolClasses(env, body) {
  const classes = Array.isArray(body.Classes || body.classes) ? (body.Classes || body.classes) : [];
  if (!classes.length) {
    const err = new Error('Classes list is required.');
    err.status = 400;
    throw err;
  }
  const updatedAt = nowIso();
  const updatedBy = clean(body.UpdatedBy || body.updatedBy) || 'School Office';
  let saved = 0;
  const keepIds = new Set();
  for (const item of classes) {
    const className = clean(item.ClassName || item.className || item);
    if (!className) continue;
    const documentId = safeDocumentId(className);
    const payload = {
      ClassName: className,
      Arms: clean(item.Arms || item.arms || item.ClassArms),
      Active: yesNo(item.Active ?? item.active ?? 'YES') || 'YES',
      SortOrder: asMoneyNumber(item.SortOrder || item.sortOrder || saved + 1),
      UpdatedAt: updatedAt,
      UpdatedBy: updatedBy
    };
    keepIds.add(documentId);
    await upsertDocument(env, 'settings/academics/classes', documentId, payload);
    saved += 1;
  }
  for (const existing of await listCollection(env, 'settings/academics/classes')) {
    const existingId = clean(existing.__id || safeDocumentId(existing.ClassName || ''));
    if (existingId && !keepIds.has(existingId)) {
      await deleteDocument(env, 'settings/academics/classes', existingId);
    }
  }
  return {
    ok: true,
    message: `School classes saved to Firestore (${saved}).`,
    saved,
    ...(await getSchoolClasses(env))
  };
}

export async function getAdmissionClasses(env) {
  const classes = (await listCollection(env, 'settings/admission/classes'))
    .map(normalizeAdmissionClass)
    .sort((a, b) => asMoneyNumber(a.SortOrder) - asMoneyNumber(b.SortOrder));
  const openClasses = classes
    .filter((item) => yesNo(item.Active) === 'YES')
    .map((item) => item.ClassName)
    .filter(Boolean);
  const pricedClass = classes.find((item) => yesNo(item.Active) === 'YES' && asMoneyNumber(item.FormAmount) > 0) ||
    classes.find((item) => asMoneyNumber(item.FormAmount) > 0) ||
    {};
  return {
    ok: true,
    message: 'Admission classes loaded from Firestore.',
    backend: 'firestore',
    openClasses,
    openClassOptions: openClasses,
    classes,
    formAmount: pricedClass.FormAmount || ''
  };
}

async function saveAdmissionClasses(env, body) {
  const classes = Array.isArray(body.Classes || body.classes) ? (body.Classes || body.classes) : [];
  const formAmount = asMoneyNumber(body.FormAmount || body.formAmount);
  if (!classes.length) {
    const err = new Error('Classes list is required.');
    err.status = 400;
    throw err;
  }
  const updatedAt = nowIso();
  const updatedBy = clean(body.UpdatedBy || body.updatedBy) || 'Admissions Office';
  let saved = 0;
  const keepIds = new Set();
  for (const item of classes) {
    const className = clean(item.ClassName || item.className || item);
    if (!className) continue;
    const documentId = safeDocumentId(className);
    const payload = {
      ClassName: className,
      FormAmount: asMoneyNumber(item.FormAmount || item.formAmount || formAmount),
      Active: yesNo(item.Active ?? item.active ?? 'NO') || 'NO',
      SortOrder: asMoneyNumber(item.SortOrder || item.sortOrder || saved + 1),
      UpdatedAt: updatedAt,
      UpdatedBy: updatedBy
    };
    keepIds.add(documentId);
    await upsertDocument(env, 'settings/admission/classes', documentId, payload);
    saved += 1;
  }
  for (const existing of await listCollection(env, 'settings/admission/classes')) {
    const existingId = clean(existing.__id || safeDocumentId(existing.ClassName || ''));
    if (existingId && !keepIds.has(existingId)) {
      await deleteDocument(env, 'settings/admission/classes', existingId);
    }
  }
  return {
    ok: true,
    message: `Admission classes saved to Firestore (${saved}).`,
    saved,
    ...(await getAdmissionClasses(env))
  };
}

export function feeCodeRenameAllowed(originalFeeCode, feeCode) {
  return !clean(originalFeeCode) || sameText(originalFeeCode, feeCode);
}

async function saveFeeItem(env, body) {
  const feeCode = clean(body.FeeCode || body.feeCode);
  if (!feeCode) {
    const err = new Error('FeeCode is required.');
    err.status = 400;
    throw err;
  }
  const originalFeeCode = clean(body.OriginalFeeCode || body.originalFeeCode);
  if (!feeCodeRenameAllowed(originalFeeCode, feeCode)) {
    const err = new Error('FeeCode is a permanent accounting identifier and cannot be renamed. Create a new fee code instead.');
    err.status = 409;
    throw err;
  }
  const existing = (await listCollection(env, 'feeItems')).find((row) => sameText(row.FeeCode, feeCode) || sameText(row.__id, safeDocumentId(feeCode))) || {};
  const className = canonicalConfiguredClass(clean(body.ClassName || body.className) || 'All', await configuredClassNames(env));
  const payload = {
    ...existing,
    FeeCode: feeCode,
    FeeName: clean(body.FeeName || body.feeName),
    FeeCategory: clean(body.FeeCategory || body.feeCategory) || 'School Fee',
    ClassName: className,
    StudentType: clean(body.StudentType || body.studentType) || 'All',
    BillingCategory: clean(body.BillingCategory || body.billingCategory) || 'All',
    Gender: clean(body.Gender || body.gender) || 'All',
    EnrollmentCategory: clean(body.EnrollmentCategory || body.enrollmentCategory || body.IntakeCategory) || 'All',
    AcademicProgress: clean(body.AcademicProgress || body.academicProgress || body.ProgressCategory) || 'All',
    AcademicSession: clean(body.AcademicSession || body.academicSession) || 'All',
    Term: clean(body.Term || body.term) || 'All',
    Amount: asMoneyNumber(body.Amount || body.amount),
    Currency: clean(body.Currency || body.currency) || 'NGN',
    PayableOnline: yesNo(body.PayableOnline ?? body.payableOnline ?? 'YES') || 'YES',
    AllowInstallment: yesNo(body.AllowInstallment ?? body.allowInstallment ?? 'NO') || 'NO',
    PartPaymentMode: clean(body.PartPaymentMode || body.partPaymentMode) || 'Item',
    MinAmount: asMoneyNumber(body.MinAmount || body.minAmount),
    MaxAmount: asMoneyNumber(body.MaxAmount || body.maxAmount),
    DueDate: clean(body.DueDate || body.dueDate || body.PaymentDueDate || body.paymentDueDate),
    RequiredForEnrollment: yesNo(body.RequiredForEnrollment ?? body.requiredForEnrollment ?? 'NO') || 'NO',
    Active: yesNo(body.Active ?? body.active ?? 'YES') || 'YES',
    SortOrder: asMoneyNumber(body.SortOrder || body.sortOrder || 100),
    Notes: clean(body.Notes || body.notes),
    CreatedAt: existing.CreatedAt || nowIso(),
    UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'feeItems', safeDocumentId(feeCode), payload);
  return { ok: true, message: 'Fee item saved to Firestore.', fee: normalizeFeeItem(payload) };
}

async function deleteFeeItem(env, body) {
  const feeCode = clean(body.FeeCode || body.feeCode);
  if (!feeCode) {
    const err = new Error('FeeCode is required.');
    err.status = 400;
    throw err;
  }
  await deleteDocument(env, 'feeItems', safeDocumentId(feeCode));
  return { ok: true, message: 'Fee item deleted from Firestore.' };
}

const DEFAULT_FEE_ITEMS = [
  { FeeCode: 'ACCEPTANCE_FEE', FeeName: 'Acceptance Fee', FeeCategory: 'Admission', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'NO', RequiredForEnrollment: 'YES', Active: 'YES', SortOrder: 1 },
  { FeeCode: 'TUITION', FeeName: 'Tuition', FeeCategory: 'School Fee', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 10 },
  { FeeCode: 'BOARDING_FEE', FeeName: 'Boarding Fee', FeeCategory: 'School Fee', ClassName: 'All', StudentType: 'Boarding', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 20 },
  { FeeCode: 'FEEDING_FEE', FeeName: 'Feeding Fee', FeeCategory: 'School Fee', ClassName: 'All', StudentType: 'Boarding', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 30 },
  { FeeCode: 'BOOKS', FeeName: 'Books', FeeCategory: 'School Fee', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'NO', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 40 },
  { FeeCode: 'TRANSPORT', FeeName: 'Transport', FeeCategory: 'Optional', ClassName: 'All', StudentType: 'Day', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'NO', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 50 },
  { FeeCode: 'CLINIC_FEE', FeeName: 'Clinic / Medical Fee', FeeCategory: 'Clinic', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'NO', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 60 },
  { FeeCode: 'KITCHEN_FEE', FeeName: 'Kitchen / Feeding Fee', FeeCategory: 'Kitchen', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 70 },
  { FeeCode: 'WALLET_TOPUP', FeeName: 'Student Wallet Top-up', FeeCategory: 'Wallet', ClassName: 'All', StudentType: 'All', AcademicSession: 'All', Term: 'All', Amount: 0, Currency: 'NGN', PayableOnline: 'YES', AllowInstallment: 'YES', MinAmount: 500, RequiredForEnrollment: 'NO', Active: 'YES', SortOrder: 900 }
];

async function seedDefaultFeeItems(env) {
  const existing = (await listCollection(env, 'feeItems')).map(normalizeFeeItem);
  const existingCodes = new Set(existing.map((item) => clean(item.FeeCode).toUpperCase()));
  let added = 0;
  for (const item of DEFAULT_FEE_ITEMS) {
    if (existingCodes.has(clean(item.FeeCode).toUpperCase())) continue;
    await upsertDocument(env, 'feeItems', safeDocumentId(item.FeeCode), {
      ...item,
      CreatedAt: nowIso(),
      UpdatedAt: nowIso()
    });
    added += 1;
  }
  return { ok: true, message: added ? 'Default fee items created in Firestore.' : 'Default fee items already exist in Firestore.', added };
}

async function queryAccountRows(env, collection, accountRef) {
  const wanted = clean(accountRef);
  if (!wanted) return [];
  const groups = await Promise.all(['AccountRef', 'AdmissionNo', 'ApplicationReference'].map((field) => {
    return queryCollection(env, collection, {
      filters: [{ field, op: '==', value: wanted }]
    }).catch(() => []);
  }));
  const unique = new Map();
  groups.flat().forEach((row) => unique.set(clean(row.__name || row.__id) || JSON.stringify(row), row));
  return [...unique.values()];
}

async function queryAccountRowsForReferences(env, collection, references = []) {
  const wanted = [...new Set((references || []).map(clean).filter(Boolean))];
  const groups = await Promise.all(wanted.map((reference) => queryAccountRows(env, collection, reference)));
  const unique = new Map();
  groups.flat().forEach((row) => unique.set(clean(row.__name || row.__id) || JSON.stringify(row), row));
  return [...unique.values()];
}

async function findPaymentByReference(env, reference) {
  const documentId = safeDocumentId(reference);
  const direct = await getDocument(env, 'payments', documentId).catch(() => null);
  if (direct) return direct;
  const byReference = await findOneByField(env, 'payments', 'Reference', reference).catch(() => null);
  if (byReference) return byReference;
  return findOneByField(env, 'payments', 'GatewayReference', reference).catch(() => null);
}

const STUDENT_OVERPAYMENT_ACCOUNT_CODE = '2310';

function matchingInvoicesForPayment(payment, invoices = [], options = {}) {
  const {
    requireOutstanding = false,
    schoolFeeCodes = null
  } = options;
  const normalizedPayment = normalizePayment(payment);
  const accountSet = schoolFeeCodes
    ? new Set([...schoolFeeCodes].map((code) => normalizeReferenceText(code)).filter(Boolean))
    : null;
  const paymentReferences = accountRefsFrom(normalizedPayment);
  return (Array.isArray(invoices) ? invoices : []).map((row) => normalizeInvoice(row)).filter((invoice) => {
    const invoiceReferences = accountRefsFrom(invoice);
    const isReferenceMatched = invoiceReferences.some((invoiceRef) =>
      paymentReferences.some((paymentRef) => sameReferenceIdentity(invoiceRef, paymentRef))
    );
    if (!isReferenceMatched) return false;
    if (!sameFinancialPeriod(invoice, normalizedPayment.AcademicSession, normalizedPayment.Term)) return false;
    if (requireOutstanding) {
      const debit = asMoneyNumber(invoice.Debit || invoice.Amount);
      const credit = asMoneyNumber(invoice.Credit || invoice.PaidAmount);
      if (normalizeMatchText(invoice.Status) === 'paid' || debit - credit <= 0.005) return false;
    }
    if (isSchoolFeesTotalPayment(normalizedPayment)) {
      return isSchoolFeeCategory(invoice.FeeCategory) || (accountSet && accountSet.has(normalizeReferenceText(invoice.FeeCode)));
    }
    return sameText(invoice.FeeCode, normalizedPayment.FeeCode);
  }).sort((a, b) => timestampMs(a.Date || a.CreatedAt) - timestampMs(b.Date || b.CreatedAt));
}

function buildPaymentReceiptJournalLines(payment, amount, matchingInvoices = []) {
  const paymentAmount = asMoneyNumber(amount);
  const normalizedPayment = normalizePayment(payment);
  if (!normalizedPayment || paymentAmount <= 0) return [];
  const lines = [
    { AccountCode: accountingCashAccountFor(normalizedPayment.Method, normalizedPayment.Gateway), Debit: paymentAmount, Credit: 0, Description: clean(normalizedPayment.Method || normalizedPayment.Gateway || 'Payment received') }
  ];
  if (!Array.isArray(matchingInvoices) || matchingInvoices.length === 0) {
    const destination = accountingDestinationForPayment(normalizedPayment, false);
    lines.push({
      AccountCode: destination,
      Debit: 0,
      Credit: paymentAmount,
      Description: clean(normalizedPayment.AccountRef || normalizedPayment.DisplayName)
    });
    return lines;
  }
  const normalizedInvoices = matchingInvoices.map((invoice) => normalizeInvoice(invoice));
  const allocation = calculateInvoiceCreditAllocations(normalizedInvoices, paymentAmount);
  const receivableCredit = asMoneyNumber(paymentAmount - allocation.remaining);
  const overpaymentCredit = asMoneyNumber(allocation.remaining);
  if (receivableCredit > 0.005) {
    lines.push({
      AccountCode: '1100',
      Debit: 0,
      Credit: receivableCredit,
      Description: clean(normalizedPayment.AccountRef || normalizedPayment.DisplayName)
    });
  }
  if (overpaymentCredit > 0.005) {
    lines.push({
      AccountCode: STUDENT_OVERPAYMENT_ACCOUNT_CODE,
      Debit: 0,
      Credit: overpaymentCredit,
      Description: `Student overpayment: ${clean(normalizedPayment.AccountRef || normalizedPayment.DisplayName || normalizedPayment.Reference || normalizedPayment.PaymentId)}`
    });
  }
  if (lines.length === 1) {
    const destination = accountingDestinationForPayment(normalizedPayment, true);
    lines.push({
      AccountCode: destination,
      Debit: 0,
      Credit: paymentAmount,
      Description: clean(normalizedPayment.AccountRef || normalizedPayment.DisplayName)
    });
  } else {
    const totalCredit = lines.slice(1).reduce((sum, line) => sum + asMoneyNumber(line.Credit), 0);
    const difference = asMoneyNumber(paymentAmount - totalCredit);
    if (Math.abs(difference) > 0.0005) {
      lines[1].Credit = asMoneyNumber((lines[1].Credit || 0) + difference);
    }
  }
  return lines;
}

async function writePaymentAccountingJournal(env, payment, matchingInvoices = []) {
  const sourceId = clean(payment.Reference || payment.GatewayReference || payment.PaymentId);
  const amount = paymentCreditedAmount(payment);
  if (!sourceId || amount <= 0) return;
  const journalNo = `SYS-PAY-${safeDocumentId(sourceId)}`;
  const lines = buildPaymentReceiptJournalLines(payment, amount, matchingInvoices);
  if (lines.length < 2) return;
  await upsertDocument(env, 'accountingJournals', safeDocumentId(journalNo), {
    JournalNo: journalNo, Date: payment.PaidAt || nowIso(), Status: 'Posted',
    Description: `Receipt: ${sourceId}`, Reference: sourceId,
    Source: 'Fee Payment', SourceId: sourceId, RecordedBy: 'System',
    AcademicSession: payment.AcademicSession || '', Term: payment.Term || '',
    Lines: lines, TotalDebit: amount, TotalCredit: amount,
    CreatedAt: payment.RecordedAt || nowIso(), UpdatedAt: nowIso()
  });
}

export function accountingDestinationForWalletPurchase(row = {}, defaultAccountCode = '4090') {
  const department = paymentStoreDepartment(row);
  if (department === 'bookstore' || department === 'uniform store' || department === 'store' || department === 'tuck shop') {
    return '4040';
  }
  const categoryText = `${clean(row.FeeCategory || '')} ${clean(row.FeeCode || '')} ${clean(row.FeeName || '')}`;
  const lowerText = normalizeMatchText(categoryText);
  if (lowerText.includes('book') || lowerText.includes('uniform') || lowerText.includes('store') || clean(row.FeeCode).toUpperCase() === 'STORE_CART') {
    return '4040';
  }
  return accountingAccountCodeForRevenue(categoryText, row.FeeCode || row.department) || defaultAccountCode;
}

async function writeWalletPurchaseAccountingJournal(env, purchase = {}, options = {}) {
  const sourceId = clean(purchase.Reference || purchase.LedgerNo || purchase.PurchaseNo);
  const amount = asMoneyNumber(purchase.Debit || purchase.Amount);
  if (!sourceId || amount <= 0) return;
  const journalNo = `SYS-WALLET-PURCHASE-${safeDocumentId(sourceId)}`;
  const revenueAccount = accountingDestinationForWalletPurchase(purchase);
  const metadataDepartment = paymentStoreDepartment({
    ...purchase,
    Department: purchase.Department || purchase.department || purchase.StoreType || purchase.storeType,
    Metadata: purchase.Metadata
  });
  const metadata = extractStoreMetadata(purchase.Metadata);
  const metadataNotes = clean(metadata.notes || metadata.Notes || metadata.description || metadata.Description);
  const lines = [
    { AccountCode: '2200', Debit: amount, Credit: 0, Description: `Wallet liability ${clean(purchase.AccountRef || purchase.DisplayName || sourceId)}` },
    { AccountCode: revenueAccount, Debit: 0, Credit: amount, Description: clean(purchase.Description || metadataNotes) || 'Wallet purchase settlement' }
  ];
  const payload = {
    JournalNo: journalNo, Date: purchase.Date || nowIso(), Status: 'Posted',
    Description: `Wallet purchase: ${clean(purchase.Description) || sourceId}`, Reference: sourceId,
    Source: 'Wallet Purchase', SourceId: sourceId, RecordedBy: clean(purchase.RecordedBy) || 'Wallet POS',
    AcademicSession: clean(purchase.AcademicSession || options.AcademicSession || ''),
    Term: clean(purchase.Term || options.Term || ''),
    Department: clean(metadataDepartment || purchase.Department || options.Department),
    CostCentre: clean(purchase.CostCentre || options.CostCentre || ''),
    Lines: lines
  };
  await saveAccountingJournal(env, payload, true);
}

export function calculateAccountFinancialSummary(invoiceRows = [], ledgerRows = [], accountRef = '') {
  const debit = invoiceRows.map(normalizeInvoice).reduce((sum, row) => sum + asMoneyNumber(row.Debit || row.Amount), 0);
  const normalizedLedger = ledgerRows.map(normalizeLedger);
  const nonWallet = normalizedLedger.filter((row) => !isWalletLedger(row));
  const credit = nonWallet.reduce((sum, row) => sum + asMoneyNumber(row.Credit), 0);
  const accountCreditDebits = nonWallet.filter((row) => normalizeMatchText(row.FeeCategory) === 'account credit')
    .reduce((sum, row) => sum + asMoneyNumber(row.Debit), 0);
  const wallet = normalizedLedger.filter(isWalletLedger)
    .reduce((sum, row) => sum + asMoneyNumber(row.Credit) - asMoneyNumber(row.Debit), 0);
  const balance = debit + accountCreditDebits - credit;
  return {
    AccountRef: clean(accountRef), AccountRefNormalized: normalizeReferenceText(accountRef),
    TotalDebit: debit, TotalCredit: credit, AccountCreditDebits: accountCreditDebits,
    OutstandingBalance: Math.max(0, balance), CreditBalance: Math.max(0, -balance),
    WalletBalance: wallet, UpdatedAt: nowIso()
  };
}

async function refreshAccountFinancialSummary(env, accountRef, linkedReferences = []) {
  const references = [accountRef, ...linkedReferences];
  const [invoices, ledger] = await Promise.all([
    queryAccountRowsForReferences(env, 'invoices', references),
    queryAccountRowsForReferences(env, 'ledger', references)
  ]);
  const summary = calculateAccountFinancialSummary(invoices, ledger, accountRef);
  await upsertDocument(env, 'accountSummaries', safeDocumentId(accountRef), {
    ...summary,
    LinkedReferences: [...new Set(linkedReferences.map(clean).filter(Boolean))]
  });
  return summary;
}

export function isStandaloneAcceptanceInvoiceForPayment(invoice, payment) {
  if (!isAcceptanceFeeLike(invoice)) return false;
  const invoiceReferences = accountRefsFrom(invoice);
  const paymentReferences = accountRefsFrom(payment);
  return invoiceReferences.some((left) => paymentReferences.some((right) =>
    sameReferenceIdentity(left, right)
  ));
}

async function removeStandaloneAcceptanceInvoices(env, payment) {
  if (!isAcceptanceFeeLike(payment)) return 0;
  const invoices = await queryAccountRows(env, 'invoices', payment.AccountRef);
  const standalone = invoices.filter((invoice) => isStandaloneAcceptanceInvoiceForPayment(
    normalizeInvoice(invoice),
    payment
  ));
  for (const invoice of standalone) {
    await deleteDocument(env, 'invoices', invoice.__id || safeDocumentId(invoice.InvoiceId));
  }
  return standalone.length;
}

export async function recordManualPayment(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.ApplicationReference);
  const feeCode = clean(body.FeeCode || body.feeCode);
  const amount = asMoneyNumber(body.Amount || body.amount);
  const reference = clean(body.Reference || body.reference || ledgerDocumentId('PAY'));
  if (!accountRef) {
    const err = new Error('AccountRef is required.');
    err.status = 400;
    throw err;
  }
  if (!feeCode) {
    const err = new Error('FeeCode is required.');
    err.status = 400;
    throw err;
  }
  if (amount <= 0) {
    const err = new Error('Amount must be greater than zero.');
    err.status = 400;
    throw err;
  }
  const isTotalPayment = isSchoolFeesTotalCode(feeCode);
  const directFee = await getDocument(env, 'feeItems', safeDocumentId(feeCode)).catch(() => null);
  const configuredFees = isTotalPayment
    ? (await listCollection(env, 'feeItems')).map(normalizeFeeItem)
    : (directFee ? [normalizeFeeItem(directFee)] : []);
  const fee = configuredFees.find((item) => sameText(item.FeeCode, feeCode)) || normalizeFeeItem(body);
  const existingPayment = await findPaymentByReference(env, reference);
  if (existingPayment) {
    const normalizedExisting = normalizePayment(existingPayment);
    if (isAcceptanceFeeLike(normalizedExisting)) {
      await removeStandaloneAcceptanceInvoices(env, normalizedExisting);
      await refreshAccountFinancialSummary(env, normalizedExisting.AccountRef, [normalizedExisting.ApplicationReference]);
    }
    return { ok: true, message: 'Payment was already recorded.', duplicate: true, payment: normalizedExisting };
  }
  const schoolFeeCodes = new Set(configuredFees.filter((item) => isSchoolFeeCategory(item.FeeCategory)).map((item) => normalizeReferenceText(item.FeeCode)));
  const student = await findStudentByAccountRef(env, accountRef);
  const paymentId = ledgerDocumentId('PAY');
  const grossAmount = asMoneyNumber(body.GrossAmount || amount);
  const gatewayFee = asMoneyNumber(body.GatewayFee);
  const netAmount = gatewayFee > 0
    ? Math.max(0, asMoneyNumber(body.NetAmount || grossAmount - gatewayFee))
    : amount;
  const creditedAmount = gatewayFee > 0 ? Math.min(grossAmount, netAmount) : amount;
  const academicSession = clean(body.AcademicSession || (student && student.AcademicSession) || resolvedPeriodValue(fee.AcademicSession, ''));
  const term = clean(body.Term || (student && student.Term) || resolvedPeriodValue(fee.Term, ''));
  const payment = {
    PaymentId: paymentId,
    AccountRef: accountRef,
    AccountRefNormalized: normalizeReferenceText(accountRef),
    ApplicationReference: clean(body.ApplicationReference || (student && student.ApplicationReference)),
    AdmissionNo: clean(body.AdmissionNo || (student && student.AdmissionNo)),
    DisplayName: clean(body.DisplayName || (student && (student.DisplayName || student.ApplicantName))),
    ClassName: clean(body.ClassName || (student && student.ClassName)),
    StudentType: clean(body.StudentType || (student && student.StudentType) || fee.StudentType),
    BillingCategory: clean(body.BillingCategory || (student && student.BillingCategory) || fee.BillingCategory) || 'Regular',
    AcademicSession: academicSession,
    Term: term,
    FeeCode: feeCode,
    FeeName: clean(body.FeeName || fee.FeeName || feeCode),
    FeeCategory: clean(body.FeeCategory || fee.FeeCategory),
    Amount: creditedAmount,
    GrossAmount: grossAmount,
    GatewayFee: gatewayFee,
    NetAmount: netAmount,
    Currency: clean(body.Currency || fee.Currency) || 'NGN',
    Method: clean(body.Method) || 'Manual',
    Gateway: clean(body.Gateway) || 'Manual',
    Reference: reference,
    GatewayReference: clean(body.GatewayReference),
    Status: 'Paid',
    PaidAt: clean(body.PaidAt) || nowIso(),
    RecordedAt: nowIso(),
    RecordedBy: clean(body.RecordedBy) || 'Accounts Office',
    Channel: clean(body.Channel),
    ReceiptNo: clean(body.ReceiptNo) || paymentId,
    Metadata: clean(body.Metadata)
  };
  const paymentCreate = await createDocumentIfAbsent(env, 'payments', safeDocumentId(reference), {
    ...payment,
    ProcessingStatus: 'Processing'
  });
  if (!paymentCreate.created) {
    return { ok: true, message: 'Payment was already recorded.', duplicate: true, payment: normalizePayment(paymentCreate.document || payment) };
  }
  const ledgerNo = `LED-${safeDocumentId(reference)}`;
  await upsertDocument(env, 'ledger', safeDocumentId(ledgerNo), {
    LedgerNo: ledgerNo,
    Date: payment.PaidAt,
    AccountRef: payment.AccountRef,
    AccountRefNormalized: normalizeReferenceText(payment.AccountRef),
    ApplicationReference: payment.ApplicationReference,
    AdmissionNo: payment.AdmissionNo,
    DisplayName: payment.DisplayName,
    ClassName: payment.ClassName,
    EntryType: normalizeMatchText(payment.FeeCategory) === 'wallet' || clean(payment.FeeCode) === 'WALLET_TOPUP' ? 'Wallet Deposit' : 'Payment',
    FeeCode: payment.FeeCode,
    FeeName: payment.FeeName,
    FeeCategory: payment.FeeCategory,
    AcademicSession: payment.AcademicSession,
    Term: payment.Term,
    Description: payment.FeeName,
    Debit: 0,
    Credit: creditedAmount,
    Currency: payment.Currency,
    Reference: reference,
    RecordedBy: payment.RecordedBy,
    Source: payment.Gateway || payment.Method,
    Metadata: payment.Metadata
  });
  await removeStandaloneAcceptanceInvoices(env, payment);
  const matchingInvoices = matchingInvoicesForPayment(payment, await queryAccountRows(env, 'invoices', accountRef), {
    schoolFeeCodes: schoolFeeCodes,
    requireOutstanding: true
  });
  const invoiceAllocation = calculateInvoiceCreditAllocations(matchingInvoices, creditedAmount);
  for (const allocation of invoiceAllocation.allocations) {
    const invoice = allocation.invoice;
    await upsertDocument(env, 'invoices', safeDocumentId(invoice.InvoiceId), {
      ...invoice,
      Credit: allocation.Credit,
      Balance: allocation.Balance,
      Status: allocation.Status,
      UpdatedAt: nowIso()
    });
  }
  if (isAcceptanceFeeLike(payment)) {
    const appId = payment.ApplicationReference || payment.AccountRef;
    const app = await findApplication(env, appId);
    if (app) {
      await saveApplication(env, {
        ...app,
        AcceptanceFeePaid: 'YES',
        AcceptanceFeePaidAt: payment.PaidAt,
        AcceptanceFeeAmount: creditedAmount,
        AcceptanceFeeMethod: payment.Gateway || payment.Method,
        AcceptanceFeeReceiptNo: payment.ReceiptNo || payment.Reference,
        AcceptanceFeeReceivedBy: payment.RecordedBy,
        UpdatedAt: nowIso()
      });
    }
  }
  if (payment.GatewayFee > 0) {
    const chargeId = safeDocumentId(`PAYSTACK-FEE-${payment.Reference || payment.GatewayReference || payment.PaymentId}`);
    await upsertDocument(env, 'paymentGatewayCharges', chargeId, {
      ChargeId: chargeId, Date: payment.PaidAt,
      Description: `Paystack transaction charge - ${payment.Reference || payment.PaymentId}`,
      Amount: payment.GatewayFee, GrossCollection: payment.GrossAmount, NetSettlement: creditedAmount,
      Treatment: 'DeductedBeforeStudentCredit', Status: 'Recorded',
      Reference: payment.Reference || payment.PaymentId, Source: payment.Gateway || 'Paystack',
      CreatedAt: nowIso(), UpdatedAt: nowIso()
    });
  }
  await writePaymentAccountingJournal(env, payment, matchingInvoices);
  let invoicePostingWarning = '';
  const shouldGenerateSchoolInvoices = Boolean(student) && (
    isSchoolFeesTotalPayment(payment) ||
    isSchoolFeeCategory(payment.FeeCategory)
  );
  if (shouldGenerateSchoolInvoices) {
    try {
      await generateSchoolFeeInvoices(env, {
        AccountRef: accountRef,
        RecordedBy: payment.RecordedBy
      });
    } catch (error) {
      invoicePostingWarning = error && error.message ? error.message : String(error);
      await refreshAccountFinancialSummary(env, accountRef, [payment.ApplicationReference]);
    }
  } else {
    await refreshAccountFinancialSummary(env, accountRef, [payment.ApplicationReference]);
  }
  payment.ProcessingStatus = 'Completed';
  payment.CompletedAt = nowIso();
  payment.InvoicePostingStatus = invoicePostingWarning ? 'Warning' : (shouldGenerateSchoolInvoices ? 'Completed' : 'Not Required');
  payment.InvoicePostingWarning = invoicePostingWarning;
  await upsertDocument(env, 'payments', safeDocumentId(reference), payment);
  return {
    ok: true,
    message: invoicePostingWarning
      ? `Payment recorded, but invoice posting needs attention: ${invoicePostingWarning}`
      : 'Payment recorded in Firestore.',
    payment,
    invoicePostingWarning
  };
}

export function resolveSchoolFeeInvoiceAccountRefs(body = {}) {
  // Supports both existing single-account payloads (AccountRef) and batched
  // generation payloads (AccountRefs[]) while preserving case-tolerant
  // deduplication.
  const refs = [];
  const seen = new Set();
  const pushRef = (value) => {
    const ref = clean(value);
    if (!ref) return;
    const key = ref.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  if (body.AccountRefs != null) {
    if (Array.isArray(body.AccountRefs)) {
      body.AccountRefs.forEach((value) => pushRef(value));
    } else if (typeof body.AccountRefs === 'string') {
      body.AccountRefs
        .split(',')
        .map((value) => value.trim())
        .forEach((value) => pushRef(value));
    }
  }
  pushRef(body.AccountRef);
  pushRef(body.accountRef);
  return refs;
}

async function generateSchoolFeeInvoices(env, body) {
  const accountRefs = resolveSchoolFeeInvoiceAccountRefs(body);
  if (!accountRefs.length) {
    const err = new Error('AccountRef is required.');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(body.AccountRefs)) {
    const result = await generateSchoolFeeInvoicesForAccount(env, body, accountRefs[0]);
    return { ok: true, ...result };
  }
  const results = [];
  const failures = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const accountRef of accountRefs) {
    try {
      const result = await generateSchoolFeeInvoicesForAccount(env, body, accountRef, { allowEmpty: true });
      created += result.created;
      updated += result.updated;
      skipped += result.skipped;
      results.push({ accountRef, ...result });
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error || 'Invoice generation failed');
      failures.push({ accountRef, message });
      results.push({ accountRef, status: 'failed', message });
    }
  }
  const failed = failures.length;
  const processed = results.length;
  const success = created + updated;
  const message = `Processed ${processed} account(s): ${success} invoice item(s) created, ${updated} updated, ${skipped} skipped${failed ? `, ${failed} failed` : ''}.`;
  if (failed) {
    const details = failures.map(({ accountRef, message: reason }) => `${accountRef}: ${reason}`);
    return {
      ok: false,
      message: `${message} Failed accounts: ${failures.length}.`,
      created,
      updated,
      skipped,
      failed,
      failures,
      results,
      details
    };
  }
  return {
    ok: true,
    message,
    created,
    updated,
    skipped,
    failed,
    results
  };
}

async function generateSchoolFeeInvoicesForAccount(env, body, accountRef, options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const profileResult = await getSchoolProfile(env).catch(() => ({ profile: {} }));
  const activeProfile = profileResult.profile || {};
  const billingApp = {
    ...student,
    ClassApplyingFor: student.ClassName,
    ClassAdmitted: student.ClassName,
    AcademicSession: student.AcademicSession || activeProfile.CurrentAcademicSession,
    Term: student.Term || activeProfile.CurrentTerm || 'First Term',
    BillingCategory: student.BillingCategory || 'Regular'
  };
  const billingSession = clean(billingApp.AcademicSession);
  const billingTerm = clean(billingApp.Term);
  const fees = applyBillingCategoryOverrides((await listCollection(env, 'feeItems')).map(normalizeFeeItem).filter((fee) => {
    return yesNo(fee.Active) === 'YES' &&
      normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' &&
      !isWalletFee(fee) &&
      asMoneyNumber(fee.Amount) > 0 &&
      feeMatchesApplication(fee, billingApp);
  }), billingApp);
  if (!fees.length) {
    if (!allowEmpty) {
      const err = new Error('No matching school fee items found for this class/student type.');
      err.status = 400;
      throw err;
    }
    return {
      created: 0,
      updated: 0,
      skipped: 1,
      status: 'skipped',
      message: `No matching school fee items for ${accountRef}.`
    };
  }
  const existing = (await queryAccountRows(env, 'invoices', accountRef)).map(normalizeInvoice);
  const linkedReferences = [student.ApplicationReference].map(clean).filter(Boolean);
  const ledgerRows = (await queryAccountRowsForReferences(env, 'ledger', [accountRef, ...linkedReferences])).map(normalizeLedger).filter((row) => {
    const rowMatchesStudent = [row.AccountRef, row.AdmissionNo, row.ApplicationReference]
      .some((value) => [accountRef, ...linkedReferences].some((reference) => sameReferenceIdentity(value, reference)));
    return rowMatchesStudent && sameFinancialPeriod(row, billingSession, billingTerm);
  });
  let availableSchoolCredit = ledgerRows.reduce((sum, row) => {
    if (isWalletLedger(row)) return sum;
    const credit = asMoneyNumber(row.Credit);
    if (credit <= 0) return sum;
    return isSchoolInvoiceCredit(row) ? sum + credit : sum;
  }, 0);
  availableSchoolCredit = Math.max(0, availableSchoolCredit - ledgerRows.reduce((sum, row) => {
    if (isWalletLedger(row)) return sum;
    return normalizeMatchText(row.FeeCategory) === 'account credit' ? sum + asMoneyNumber(row.Debit) : sum;
  }, 0));
  let created = 0;
  let updated = 0;
  for (const fee of fees) {
    const invoiceSession = resolvedPeriodValue(fee.AcademicSession, billingSession);
    const invoiceTerm = resolvedPeriodValue(fee.Term, billingTerm);
    const debit = asMoneyNumber(fee.Amount);
    const credit = Math.min(debit, availableSchoolCredit);
    availableSchoolCredit = Math.max(0, availableSchoolCredit - credit);
    const balance = Math.max(0, debit - credit);
    const status = balance <= 0 ? 'Paid' : credit > 0 ? 'Part Paid' : 'Unpaid';
    const duplicate = existing.find((invoice) => {
      return sameText(invoice.AccountRef, accountRef) &&
        sameText(invoice.FeeCode, fee.FeeCode) &&
        sameFinancialPeriod(invoice, invoiceSession, invoiceTerm);
    });
    const invoiceId = duplicate ? duplicate.InvoiceId : ledgerDocumentId('INV');
    await upsertDocument(env, 'invoices', safeDocumentId(invoiceId), {
      ...(duplicate || {}),
      InvoiceId: invoiceId,
      AccountRef: accountRef,
      AccountRefNormalized: normalizeReferenceText(accountRef),
      ApplicationReference: student.ApplicationReference || '',
      AdmissionNo: student.AdmissionNo || '',
      DisplayName: student.DisplayName || student.ApplicantName || '',
      ClassName: student.ClassName || '',
      StudentType: student.StudentType || '',
      BillingCategory: student.BillingCategory || 'Regular',
      FeeCode: fee.FeeCode,
      FeeName: fee.FeeName,
      FeeCategory: fee.FeeCategory,
      Amount: debit,
      Debit: debit,
      Credit: credit,
      Balance: balance,
      Currency: fee.Currency || 'NGN',
      AcademicSession: invoiceSession,
      Term: invoiceTerm,
      DueDate: fee.DueDate || '',
      Status: status,
      Date: duplicate?.Date || nowIso(),
      CreatedAt: duplicate?.CreatedAt || nowIso(),
      UpdatedAt: nowIso(),
      RecordedBy: clean(body.RecordedBy) || duplicate?.RecordedBy || 'Accounts Office'
    });
    if (duplicate) updated += 1;
    else created += 1;
  }
  await refreshAccountFinancialSummary(env, accountRef, linkedReferences);
  return {
    created,
    updated,
    skipped: 0,
    status: updated ? 'updated' : (created ? 'created' : 'ok'),
    message: `${created} school fee invoice item(s) generated, ${updated} updated.`
  };
}

function ledgerDocumentId(prefix = 'LED') {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sameDayIso(value, today = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
}

async function walletBalanceForAccount(env, accountRef) {
  const rows = (await queryAccountRows(env, 'ledger', accountRef)).map(normalizeLedger);
  return rows.filter((row) => {
    if (!sameText(row.AccountRef, accountRef) && !referencesMatch(row.AccountRef, accountRef)) return false;
    return normalizeMatchText(row.FeeCategory) === 'wallet' || normalizeMatchText(row.EntryType).startsWith('wallet');
  }).reduce((balance, row) => balance + asMoneyNumber(row.Credit) - asMoneyNumber(row.Debit), 0);
}

async function accountCreditBalanceForAccount(env, accountRef) {
  const account = await getDocument(env, 'accountSummaries', safeDocumentId(accountRef)).catch(() => null) ||
    await refreshAccountFinancialSummary(env, accountRef);
  return Math.max(
    asMoneyNumber(account.ExcessCredit || account.CreditBalance),
    asMoneyNumber(account.CreditBalance),
    Math.max(0, asMoneyNumber(account.TotalCredit) - asMoneyNumber(account.TotalDebit)),
    Math.max(0, -asMoneyNumber(account.Balance))
  );
}

async function walletSpentTodayForAccount(env, accountRef) {
  const rows = (await queryAccountRows(env, 'ledger', accountRef)).map(normalizeLedger);
  return rows.filter((row) => {
    if (!sameText(row.AccountRef, accountRef) && !referencesMatch(row.AccountRef, accountRef)) return false;
    return normalizeMatchText(row.EntryType) === 'wallet purchase' && sameDayIso(row.Date || row.createdAt);
  }).reduce((total, row) => total + asMoneyNumber(row.Debit), 0);
}

async function walletAccountPayload(env, student) {
  const normalized = normalizeStudent(student || {});
  const accountRef = normalized.AdmissionNo || normalized.ApplicationReference || normalized.AccountRef || '';
  return {
    AccountRef: accountRef,
    ApplicationReference: normalized.ApplicationReference || '',
    AdmissionNo: normalized.AdmissionNo || '',
    DisplayName: normalized.DisplayName || normalized.ApplicantName || '',
    ClassName: normalized.ClassName || normalized.ClassAdmitted || '',
    StudentType: normalized.StudentType || '',
    BillingCategory: normalized.BillingCategory || 'Regular',
    AcademicSession: normalized.AcademicSession || '',
    Term: normalized.Term || '',
    WalletCardId: normalized.WalletCardId || '',
    WalletCardStatus: normalized.WalletCardStatus || 'Active',
    WalletDailyLimit: normalized.WalletDailyLimit || '',
    WalletTxnLimit: normalized.WalletTxnLimit || '',
    WalletPinThreshold: normalized.WalletPinThreshold || '',
    WalletBalance: await walletBalanceForAccount(env, accountRef),
    WalletSpentToday: await walletSpentTodayForAccount(env, accountRef)
  };
}

async function getWalletCardAccount(env, body) {
  const cardId = clean(body.WalletCardId || body.CardId || body.cardId).toUpperCase();
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const student = cardId ? await findStudentByWalletCard(env, cardId) : await findStudentByAccountRef(env, accountRef);
  if (!student) {
    const err = new Error('Student wallet card/account not found. Enroll the student first, then assign a wallet card.');
    err.status = 404;
    throw err;
  }
  return { ok: true, message: 'Wallet account loaded.', account: await walletAccountPayload(env, student) };
}

async function saveWalletCard(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const cardId = clean(body.WalletCardId || body.CardId || body.cardId).toUpperCase();
  if (!accountRef) {
    const err = new Error('Account/admission number is required.');
    err.status = 400;
    throw err;
  }
  if (!cardId) {
    const err = new Error('Wallet card ID is required.');
    err.status = 400;
    throw err;
  }
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const duplicate = await findStudentByWalletCard(env, cardId);
  if (duplicate && !sameText(duplicate.AdmissionNo, student.AdmissionNo)) {
    const err = new Error('This wallet card is already assigned to another student.');
    err.status = 400;
    throw err;
  }
  const updates = {
    ...student,
    WalletCardId: cardId,
    WalletCardStatus: clean(body.WalletCardStatus || body.CardStatus || 'Active') || 'Active',
    WalletDailyLimit: body.WalletDailyLimit ?? student.WalletDailyLimit ?? '',
    WalletTxnLimit: body.WalletTxnLimit ?? student.WalletTxnLimit ?? '',
    WalletPinThreshold: body.WalletPinThreshold ?? student.WalletPinThreshold ?? '',
    WalletUpdatedAt: nowIso()
  };
  const pin = clean(body.WalletPin || body.Pin);
  if (pin) {
    updates.WalletPinHash = await sha256Hex(`${clean(env.BACKEND_SHARED_SECRET || env.GOOGLE_APPS_SCRIPT_SECRET)}:${pin}`);
    updates.WalletPinSetAt = nowIso();
  }
  const saved = await saveStudent(env, updates);
  return { ok: true, message: 'Wallet card saved.', account: await walletAccountPayload(env, saved) };
}

async function recordWalletPurchase(env, body) {
  const cardId = clean(body.WalletCardId || body.CardId || body.cardId).toUpperCase();
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const amount = asMoneyNumber(body.Amount || body.amount);
  if (amount <= 0) {
    const err = new Error('Enter a wallet purchase amount greater than zero.');
    err.status = 400;
    throw err;
  }
  const student = cardId ? await findStudentByWalletCard(env, cardId) : await findStudentByAccountRef(env, accountRef);
  if (!student) {
    const err = new Error('Student wallet card/account not found.');
    err.status = 404;
    throw err;
  }
  const account = await walletAccountPayload(env, student);
  if (['blocked', 'inactive'].includes(normalizeMatchText(account.WalletCardStatus || 'Active'))) {
    const err = new Error('This wallet card is blocked.');
    err.status = 400;
    throw err;
  }
  if (amount > asMoneyNumber(account.WalletBalance)) {
    const err = new Error('Insufficient wallet balance.');
    err.status = 400;
    throw err;
  }
  const txnLimit = asMoneyNumber(account.WalletTxnLimit);
  if (txnLimit > 0 && amount > txnLimit) {
    const err = new Error('This purchase exceeds the wallet transaction limit.');
    err.status = 400;
    throw err;
  }
  const dailyLimit = asMoneyNumber(account.WalletDailyLimit);
  if (dailyLimit > 0 && asMoneyNumber(account.WalletSpentToday) + amount > dailyLimit) {
    const err = new Error('This purchase would exceed the daily wallet limit.');
    err.status = 400;
    throw err;
  }
  const pinThreshold = asMoneyNumber(account.WalletPinThreshold);
  const savedPinHash = clean(student.WalletPinHash);
  if (savedPinHash && pinThreshold > 0 && amount >= pinThreshold) {
    const suppliedPin = clean(body.WalletPin || body.Pin);
    const suppliedHash = await sha256Hex(`${clean(env.BACKEND_SHARED_SECRET || env.GOOGLE_APPS_SCRIPT_SECRET)}:${suppliedPin}`);
    if (!suppliedPin || suppliedHash !== savedPinHash) {
      const err = new Error('Invalid wallet PIN.');
      err.status = 400;
      throw err;
    }
  }
  const ledgerNo = ledgerDocumentId('WALLET');
  const entry = {
    LedgerNo: ledgerNo,
    Date: nowIso(),
    AccountRef: account.AccountRef,
    ApplicationReference: account.ApplicationReference,
    AdmissionNo: account.AdmissionNo,
    DisplayName: account.DisplayName,
    ClassName: account.ClassName,
    AcademicSession: account.AcademicSession || student.AcademicSession || '',
    Term: account.Term || student.Term || '',
    EntryType: 'Wallet Purchase',
    FeeCategory: 'Wallet',
    Description: clean(body.Description || body.description) || 'Wallet purchase',
    Department: clean(body.Department || body.department),
    Debit: amount,
    Credit: 0,
    Currency: 'NGN',
    Reference: clean(body.Reference || body.reference) || ledgerNo,
    RecordedBy: clean(body.RecordedBy || body.recordedBy) || 'Wallet POS',
    Source: clean(body.Terminal || body.terminal) || 'Wallet POS',
    Metadata: JSON.stringify({
      walletCardId: cardId || account.WalletCardId,
      department: clean(body.Department || body.department)
    })
  };
  await upsertDocument(env, 'ledger', safeDocumentId(ledgerNo), entry);
  let accountingWarning = '';
  try {
    await writeWalletPurchaseAccountingJournal(env, entry);
  } catch (error) {
    accountingWarning = error && error.message ? error.message : 'Unable to post the wallet purchase to accounting journals.';
  }
  return {
    ok: true,
    message: accountingWarning
      ? `Wallet purchase recorded, but accounting sync needs attention: ${accountingWarning}`
      : 'Wallet purchase recorded.',
    ledger: entry,
    balance: await walletBalanceForAccount(env, account.AccountRef),
    accountingWarning,
    account: await walletAccountPayload(env, student)
  };
}

async function recordCreditAction(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const action = clean(body.CreditAction || body.ActionType || body.actionType || body.Type).toLowerCase();
  const amount = asMoneyNumber(body.Amount || body.amount);
  const recordedBy = clean(body.RecordedBy || body.recordedBy) || 'Accounts Office';
  const notes = clean(body.Notes || body.notes);
  if (!accountRef) {
    const err = new Error('AccountRef is required.');
    err.status = 400;
    throw err;
  }
  if (amount <= 0) {
    const err = new Error('Amount must be greater than zero.');
    err.status = 400;
    throw err;
  }
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const account = await walletAccountPayload(env, student);
  const availableCredit = await accountCreditBalanceForAccount(env, account.AccountRef);
  const isManualCredit = action === 'manual credit adjustment' || action === 'manual_credit' || action === 'credit_adjustment';
  if (!isManualCredit && amount > availableCredit) {
    const err = new Error(`Amount exceeds available account credit (${formatNairaAmount(availableCredit)}).`);
    err.status = 400;
    throw err;
  }
  const reference = clean(body.Reference || body.reference) || ledgerDocumentId('CREDIT');
  const entries = [];
  const base = {
    Date: nowIso(),
    AccountRef: account.AccountRef,
    ApplicationReference: account.ApplicationReference,
    AdmissionNo: account.AdmissionNo,
    DisplayName: account.DisplayName,
    ClassName: account.ClassName,
    AcademicSession: account.AcademicSession || student.AcademicSession || '',
    Term: account.Term || student.Term || '',
    FeeCategory: 'Account Credit',
    Currency: 'NGN',
    Reference: reference,
    RecordedBy: recordedBy,
    Source: 'Accounts Credit Action'
  };
  const addLedger = async (entry, prefix = 'CREDIT') => {
    const ledgerNo = ledgerDocumentId(prefix);
    const payload = {
      LedgerNo: ledgerNo,
      ...entry,
      Metadata: JSON.stringify({
        creditAction: action,
        notes,
        targetAccountRef: clean(body.TargetAccountRef || body.targetAccountRef),
        availableCreditBefore: availableCredit
      })
    };
    await upsertDocument(env, 'ledger', safeDocumentId(ledgerNo), payload);
    entries.push(payload);
  };

  if (action === 'refund to parent' || action === 'refund') {
    await addLedger({
      ...base,
      EntryType: 'Credit Refund',
      FeeCode: 'CREDIT_REFUND',
      FeeName: 'Credit Refund',
      Description: notes || 'Refund of account credit to parent',
      Debit: amount,
      Credit: 0
    });
  } else if (action === 'transfer to wallet' || action === 'wallet') {
    await addLedger({
      ...base,
      EntryType: 'Credit Transfer',
      FeeCode: 'CREDIT_TO_WALLET',
      FeeName: 'Credit Transfer to Wallet',
      Description: notes || 'Account credit transferred to student wallet',
      Debit: amount,
      Credit: 0
    });
    await addLedger({
      ...base,
      EntryType: 'Wallet Deposit',
      FeeCode: 'WALLET_TOPUP',
      FeeName: 'Student Wallet Top-up',
      FeeCategory: 'Wallet',
      Description: notes || 'Account credit transferred to wallet',
      Debit: 0,
      Credit: amount
    }, 'WALLET');
  } else if (action === 'transfer to sibling' || action === 'sibling') {
    const targetRef = clean(body.TargetAccountRef || body.targetAccountRef);
    if (!targetRef) {
      const err = new Error('Target sibling/account is required.');
      err.status = 400;
      throw err;
    }
    const targetStudent = await findStudentByAccountRef(env, targetRef);
    if (!targetStudent) {
      const err = new Error('Target sibling/account was not found.');
      err.status = 404;
      throw err;
    }
    const targetAccount = await walletAccountPayload(env, targetStudent);
    await addLedger({
      ...base,
      EntryType: 'Credit Transfer',
      FeeCode: 'CREDIT_TRANSFER_OUT',
      FeeName: 'Credit Transfer Out',
      Description: notes || `Account credit transferred to ${targetAccount.DisplayName || targetAccount.AccountRef}`,
      Debit: amount,
      Credit: 0
    });
    await addLedger({
      Date: nowIso(),
      AccountRef: targetAccount.AccountRef,
      ApplicationReference: targetAccount.ApplicationReference,
      AdmissionNo: targetAccount.AdmissionNo,
      DisplayName: targetAccount.DisplayName,
      ClassName: targetAccount.ClassName,
      AcademicSession: targetAccount.AcademicSession || targetStudent.AcademicSession || '',
      Term: targetAccount.Term || targetStudent.Term || '',
      EntryType: 'Credit Transfer',
      FeeCode: 'CREDIT_TRANSFER_IN',
      FeeName: 'Credit Transfer In',
      FeeCategory: 'Account Credit',
      Description: notes || `Account credit transferred from ${account.DisplayName || account.AccountRef}`,
      Debit: 0,
      Credit: amount,
      Currency: 'NGN',
      Reference: reference,
      RecordedBy: recordedBy,
      Source: 'Accounts Credit Action'
    });
  } else if (action === 'manual credit adjustment' || action === 'manual debit adjustment' || isManualCredit || action === 'debit_adjustment') {
    const isDebit = action === 'manual debit adjustment' || action === 'debit_adjustment';
    if (isDebit && amount > availableCredit) {
      const err = new Error(`Amount exceeds available account credit (${formatNairaAmount(availableCredit)}).`);
      err.status = 400;
      throw err;
    }
    await addLedger({
      ...base,
      EntryType: isDebit ? 'Credit Adjustment Debit' : 'Credit Adjustment',
      FeeCode: isDebit ? 'CREDIT_ADJUSTMENT_DEBIT' : 'CREDIT_ADJUSTMENT',
      FeeName: isDebit ? 'Credit Adjustment Debit' : 'Credit Adjustment',
      Description: notes || (isDebit ? 'Manual debit adjustment to account credit' : 'Manual credit adjustment'),
      Debit: isDebit ? amount : 0,
      Credit: isDebit ? 0 : amount
    });
  } else {
    const err = new Error('Choose a valid credit action.');
    err.status = 400;
    throw err;
  }

  return {
    ok: true,
    message: 'Credit action recorded.',
    entries,
    availableCreditBefore: availableCredit,
    availableCreditAfter: await accountCreditBalanceForAccount(env, account.AccountRef)
  };
}

async function saveClinicRecord(env, body) {
  const studentName = clean(body.StudentName || body.studentName);
  const complaint = clean(body.Complaint || body.complaint);
  if (!studentName) {
    const err = new Error('Student name is required.');
    err.status = 400;
    throw err;
  }
  if (!complaint) {
    const err = new Error('Complaint is required.');
    err.status = 400;
    throw err;
  }
  const recordId = clean(body.RecordId || body.RecordNo) || ledgerDocumentId('CLN');
  const payload = {
    RecordId: recordId,
    RecordNo: recordId,
    Date: clean(body.Date) || nowIso(),
    StudentName: studentName,
    AdmissionNo: clean(body.AdmissionNo),
    ClassName: clean(body.ClassName),
    Complaint: complaint,
    Treatment: clean(body.Treatment),
    Disposition: clean(body.Disposition),
    RecordedBy: clean(body.RecordedBy) || 'Clinic',
    ReviewedBy: clean(body.ReviewedBy),
    Notes: clean(body.Notes),
    UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'clinicRecords', safeDocumentId(recordId), payload);
  return { ok: true, message: 'Clinic record saved to Firestore.', record: payload };
}

async function saveInventoryItem(env, body, collection, defaults) {
  const itemName = clean(body.ItemName || body.itemName);
  const originalItemName = clean(body.OriginalItemName || body.originalItemName || itemName);
  if (!itemName) {
    const err = new Error('Item name is required.');
    err.status = 400;
    throw err;
  }
  const existingRows = await listCollection(env, collection);
  const existing = existingRows.find((row) => sameText(row.ItemName, originalItemName) || sameText(row.__id, safeDocumentId(originalItemName)) || sameText(row.ItemName, itemName)) || {};
  const originalId = safeDocumentId(originalItemName);
  const nextId = safeDocumentId(itemName);
  const payload = {
    ...existing,
    ItemName: itemName,
    Category: clean(body.Category || body.category) || defaults.category,
    Unit: clean(body.Unit || body.unit) || defaults.unit,
    Quantity: asMoneyNumber(body.Quantity || body.quantity),
    ReorderLevel: asMoneyNumber(body.ReorderLevel || body.reorderLevel),
    LastUpdated: nowIso(),
    Notes: clean(body.Notes || body.notes)
  };
  if (originalId && originalId !== nextId) {
    await deleteDocument(env, collection, originalId);
  }
  await upsertDocument(env, collection, nextId, payload);
  return { ok: true, message: `${defaults.label} inventory item saved to Firestore.`, item: normalizeInventory(payload) };
}

async function deleteInventoryItem(env, body, collection, label) {
  const itemName = clean(body.ItemName || body.itemName);
  if (!itemName) {
    const err = new Error('Item name is required.');
    err.status = 400;
    throw err;
  }
  await deleteDocument(env, collection, safeDocumentId(itemName));
  return { ok: true, message: `${label} inventory item deleted from Firestore.` };
}

async function recordStockMovement(env, body, collection, movementCollection, defaults) {
  const itemName = clean(body.ItemName || body.itemName);
  const movementType = clean(body.MovementType || body.movementType).toUpperCase();
  const quantity = asMoneyNumber(body.Quantity || body.quantity);
  if (!itemName) {
    const err = new Error('Item name is required.');
    err.status = 400;
    throw err;
  }
  if (!['IN', 'OUT'].includes(movementType)) {
    const err = new Error('MovementType must be IN or OUT.');
    err.status = 400;
    throw err;
  }
  if (quantity <= 0) {
    const err = new Error('Quantity must be greater than zero.');
    err.status = 400;
    throw err;
  }
  const rows = await listCollection(env, collection);
  const existing = rows.find((row) => sameText(row.ItemName, itemName) || sameText(row.__id, safeDocumentId(itemName)));
  if (!existing) {
    const err = new Error('Inventory item not found. Create the item first.');
    err.status = 404;
    throw err;
  }
  const current = asMoneyNumber(existing.Quantity);
  const nextQty = movementType === 'IN' ? current + quantity : current - quantity;
  const itemPayload = {
    ...existing,
    Quantity: nextQty,
    LastUpdated: nowIso()
  };
  await upsertDocument(env, collection, safeDocumentId(existing.ItemName || itemName), itemPayload);
  const movementNo = ledgerDocumentId(defaults.prefix);
  const movement = {
    MovementNo: movementNo,
    Date: nowIso(),
    ItemName: existing.ItemName || itemName,
    MovementType: movementType,
    Quantity: quantity,
    Reason: clean(body.Reason),
    RecordedBy: clean(body.RecordedBy) || defaults.actor
  };
  await upsertDocument(env, movementCollection, safeDocumentId(movementNo), movement);
  return { ok: true, message: `${defaults.label} stock movement recorded in Firestore.`, movement, item: normalizeInventory(itemPayload) };
}

async function updateStudentBillingCategory(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const category = clean(body.BillingCategory || body.billingCategory) || 'Regular';
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const saved = await saveStudent(env, { ...student, BillingCategory: category, UpdatedAt: nowIso() });
  return { ok: true, message: 'Billing category updated.', student: saved };
}

async function updateStudentStatus(env, body) {
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const status = clean(body.Status || body.status);
  const allowed = ['Active', 'On Leave', 'Suspended', 'Withdrawn', 'Expelled', 'Graduated'];
  if (!accountRef) {
    const err = new Error('Account/admission number is required.');
    err.status = 400;
    throw err;
  }
  const normalizedStatus = allowed.find((item) => item.toLowerCase() === status.toLowerCase());
  if (!normalizedStatus) {
    const err = new Error('Select a valid student status.');
    err.status = 400;
    throw err;
  }
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const saved = await saveStudent(env, {
    ...student,
    Status: normalizedStatus,
    StatusReason: clean(body.StatusReason || body.statusReason || body.Reason || body.reason),
    StatusEffectiveDate: clean(body.StatusEffectiveDate || body.statusEffectiveDate) || nowIso().slice(0, 10),
    ExpectedReturnDate: clean(body.ExpectedReturnDate || body.expectedReturnDate),
    StatusUpdatedBy: clean(body.UpdatedBy || body.updatedBy) || 'School Office',
    StatusUpdatedAt: nowIso(),
    UpdatedAt: nowIso()
  });
  return { ok: true, message: 'Student status updated.', student: saved };
}

const DEFAULT_CHART_OF_ACCOUNTS = [
  ['1010', 'Cash on Hand', 'Asset', 'Cash and Bank', 'Debit'],
  ['1020', 'Main Bank Account', 'Asset', 'Cash and Bank', 'Debit'],
  ['1030', 'Online Payment Clearing', 'Asset', 'Cash and Bank', 'Debit'],
  ['1100', 'Student Accounts Receivable', 'Asset', 'Receivables', 'Debit'],
  ['1200', 'Inventory', 'Asset', 'Current Assets', 'Debit'],
  ['1500', 'Property and Equipment', 'Asset', 'Fixed Assets', 'Debit'],
  ['1600', 'Accumulated Depreciation', 'Asset', 'Fixed Assets', 'Credit'],
  ['2000', 'Accounts Payable', 'Liability', 'Payables', 'Credit'],
  ['2100', 'Taxes and Statutory Deductions', 'Liability', 'Statutory', 'Credit'],
  ['2200', 'Student Wallet Liability', 'Liability', 'Student Wallets', 'Credit'],
  ['2300', 'Salaries Payable', 'Liability', 'Payroll', 'Credit'],
  ['2310', 'Student Overpayment Liability', 'Liability', 'Student Overpayments', 'Credit'],
  ['3000', 'Accumulated School Fund', 'Equity', 'School Fund', 'Credit'],
  ['4000', 'Tuition and School Fee Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4010', 'Admission Form Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4020', 'Boarding Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4030', 'Transport Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4040', 'Books and Uniform Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4050', 'Clinic Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4060', 'Kitchen and Feeding Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4070', 'Club and Activity Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4080', 'Grants and Donations', 'Revenue', 'Other Income', 'Credit'],
  ['4090', 'Other Income', 'Revenue', 'Other Income', 'Credit'],
  ['4100', 'Discounts, Scholarships and Refunds', 'Revenue', 'Contra Revenue', 'Debit'],
  ['4110', 'Acceptance Fee Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['5000', 'Academic Direct Costs', 'Expense', 'Direct Cost', 'Debit'],
  ['5010', 'Boarding Direct Costs', 'Expense', 'Direct Cost', 'Debit'],
  ['5020', 'Transport Direct Costs', 'Expense', 'Direct Cost', 'Debit'],
  ['5030', 'Kitchen and Feeding Direct Costs', 'Expense', 'Direct Cost', 'Debit'],
  ['6000', 'Salaries and Staff Costs', 'Expense', 'Operating Expense', 'Debit'],
  ['6010', 'Utilities', 'Expense', 'Operating Expense', 'Debit'],
  ['6020', 'Repairs and Maintenance', 'Expense', 'Operating Expense', 'Debit'],
  ['6030', 'Administrative Expenses', 'Expense', 'Operating Expense', 'Debit'],
  ['6040', 'Marketing and Admissions', 'Expense', 'Operating Expense', 'Debit'],
  ['6050', 'Professional Fees', 'Expense', 'Operating Expense', 'Debit'],
  ['6060', 'Bank and Payment Charges', 'Expense', 'Finance Cost', 'Debit'],
  ['6070', 'Depreciation Expense', 'Expense', 'Non-cash Expense', 'Debit'],
  ['6090', 'Other Expenses', 'Expense', 'Operating Expense', 'Debit']
];

function accountingRoleAllowed(body, allowed) {
  const role = clean(body.UserRole || body.userRole || '');
  return allowed.includes(role);
}

function requireAccountingRole(body, allowed, message = 'Your role is not allowed to perform this accounting action.') {
  if (accountingRoleAllowed(body, allowed)) return;
  const err = new Error(message);
  err.status = 403;
  throw err;
}

const DEPARTMENT_ACCOUNTING_ROLES = ['Department User', 'Tuck Shop User', 'Clinic User', 'Kitchen User'];

function accountingDepartment(body) {
  const explicit = clean(body.UserDepartment || body.userDepartment);
  if (explicit) return explicit;
  return {
    'Tuck Shop User': 'Tuck Shop',
    'Clinic User': 'Clinic',
    'Kitchen User': 'Kitchen'
  }[clean(body.UserRole || body.userRole)] || '';
}

function isDepartmentAccountingUser(body) {
  return DEPARTMENT_ACCOUNTING_ROLES.includes(clean(body.UserRole || body.userRole));
}

function enforceDepartmentSubmission(body, existing, requestedStatus) {
  if (!isDepartmentAccountingUser(body)) return '';
  const department = accountingDepartment(body);
  if (!department) {
    const err = new Error('A department must be assigned to this user before submitting finance records.'); err.status = 403; throw err;
  }
  if (!['draft', 'submitted'].includes(lower(requestedStatus))) {
    const err = new Error('Department users can save drafts and submit records; Accounts or Management must approve and post them.'); err.status = 403; throw err;
  }
  if (existing && existing.Department && !sameText(existing.Department, department)) {
    const err = new Error('You cannot change another department\'s finance record.'); err.status = 403; throw err;
  }
  if (existing && !['', 'draft'].includes(lower(existing.Status))) {
    const err = new Error('A submitted department record can only be changed by Accounts or Management.'); err.status = 409; throw err;
  }
  return department;
}

function accountingLines(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }
  return [];
}

function accountingAccountCodeForRevenue(category, feeCode = '') {
  const text = `${clean(category)} ${clean(feeCode)}`.toLowerCase();
  if (text.includes('form')) return '4010';
  if (text.includes('acceptance') || text.includes('admission')) return '4110';
  if (text.includes('board')) return '4020';
  if (text.includes('transport') || text.includes('bus')) return '4030';
  if (text.includes('book') || text.includes('uniform')) return '4040';
  if (text.includes('clinic') || text.includes('medical')) return '4050';
  if (text.includes('kitchen') || text.includes('feeding')) return '4060';
  if (text.includes('club') || text.includes('activity')) return '4070';
  if (text.includes('grant') || text.includes('donation')) return '4080';
  if (text.includes('school') || text.includes('tuition')) return '4000';
  return '4090';
}

export function accountingDestinationForPayment(row = {}, hasMatchingInvoice = false) {
  const department = paymentStoreDepartment(row);
  if (department === 'bookstore' || department === 'uniform store' || department === 'store' || department === 'tuck shop') return '4040';
  if (isWalletLedger(row)) return '2200';
  if (paymentIndicatesStorePurchase(row)) return '4040';
  if (hasMatchingInvoice) return '1100';
  return accountingAccountCodeForRevenue(row.FeeCategory, row.FeeCode);
}

function paymentHasMatchingInvoice(payment, invoices) {
  if (isWalletLedger(payment) || isStorePurchase(payment)) return false;
  return (invoices || []).map(normalizeInvoice).some((invoice) => {
    const invoiceReferences = accountRefsFrom(invoice);
    const paymentReferences = accountRefsFrom(payment);
    if (!invoiceReferences.some((left) => paymentReferences.some((right) => sameReferenceIdentity(left, right)))) return false;
    if (!sameFinancialPeriod(invoice, payment.AcademicSession, payment.Term)) return false;
    if (isSchoolFeesTotalPayment(payment)) return normalizeMatchText(invoice.FeeCategory || 'school fee') === 'school fee';
    if (isAcceptanceFeeLike(payment)) return normalizeMatchText(invoice.FeeCategory || 'school fee') === 'school fee';
    return sameText(invoice.FeeCode, payment.FeeCode);
  });
}

function journalLineSignature(lines) {
  return accountingLines(lines).map((line) => [
    clean(line.AccountCode), asMoneyNumber(line.Debit), asMoneyNumber(line.Credit)
  ].join(':')).join('|');
}

function referenceEquivalent(left, right) {
  if (!clean(left) || !clean(right)) return false;
  const leftText = clean(left).trim();
  const rightText = clean(right).trim();
  if (sameText(leftText, rightText)) return true;
  if (sameReferenceIdentity(leftText, rightText)) return true;
  if (referencesMatch(leftText, rightText)) return true;
  return false;
}

function journalMatchesReference(journal, reference) {
  if (!clean(reference)) return false;
  return referenceEquivalent(journal.Reference, reference) ||
    referenceEquivalent(journal.SourceId, reference) ||
    referenceEquivalent(journal.__id, reference) ||
    referenceEquivalent(journal.JournalNo, reference);
}

function syncJournalNo(prefix, sourceRef) {
  return `${prefix}${safeDocumentId(sourceRef)}`;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on', 'y', 'rebuild'].includes(normalizeMatchText(value));
}

function accountingCashAccountFor(method, gateway = '') {
  const text = `${clean(method)} ${clean(gateway)}`.toLowerCase();
  if (text.includes('cash')) return '1010';
  if (text.includes('paystack') || text.includes('online') || text.includes('gateway')) return '1030';
  return '1020';
}

async function seedAccountingChart(env) {
  const existing = await listCollection(env, 'chartOfAccounts');
  const codes = new Set(existing.map((row) => clean(row.Code || row.code || row.__id)));
  let added = 0;
  for (const [Code, Name, Type, Group, NormalBalance] of DEFAULT_CHART_OF_ACCOUNTS) {
    if (codes.has(Code)) continue;
    await upsertDocument(env, 'chartOfAccounts', Code, {
      Code, Name, Type, Group, NormalBalance, Active: 'YES', System: 'YES',
      CreatedAt: nowIso(), UpdatedAt: nowIso()
    });
    added += 1;
  }
  return added;
}

async function accountingPeriodIsClosed(env, dateText) {
  const date = clean(dateText).slice(0, 10);
  if (!date) return false;
  const periods = await listCollection(env, 'accountingPeriods');
  return periods.some((row) => {
    const status = lower(row.Status || row.status);
    return status === 'closed' && date >= clean(row.StartDate || row.startDate) && date <= clean(row.EndDate || row.endDate);
  });
}

function normalizedJournal(payload) {
  const lines = accountingLines(payload.Lines || payload.lines).map((line, index) => ({
    LineNo: index + 1,
    AccountCode: clean(line.AccountCode || line.accountCode),
    AccountName: clean(line.AccountName || line.accountName),
    Description: clean(line.Description || line.description || payload.Description),
    Department: clean(line.Department || line.department || payload.Department),
    CostCentre: clean(line.CostCentre || line.costCentre || payload.CostCentre),
    Debit: asMoneyNumber(line.Debit || line.debit),
    Credit: asMoneyNumber(line.Credit || line.credit)
  }));
  return { ...payload, Lines: lines };
}

async function writeAccountingAudit(env, action, entityType, entityId, body, details = '') {
  const auditId = ledgerDocumentId('AUD');
  await upsertDocument(env, 'accountingAudit', safeDocumentId(auditId), {
    AuditId: auditId,
    Timestamp: nowIso(),
    Action: clean(action),
    EntityType: clean(entityType),
    EntityId: clean(entityId),
    UserRole: clean(body.UserRole || body.userRole),
    UserName: clean(body.RecordedBy || body.UpdatedBy || body.UserName || body.userName),
    Details: clean(details)
  });
}

export async function saveAccountingJournal(env, body, system = false) {
  const existingId = clean(body.JournalNo || body.journalNo);
  const journalNo = existingId || ledgerDocumentId(system ? 'SYS' : 'JRN');
  const existingRows = await listCollection(env, 'accountingJournals');
  const existing = existingRows.find((row) => sameText(row.JournalNo, journalNo) || sameText(row.__id, safeDocumentId(journalNo))) || {};
  if (lower(existing.Status) === 'posted' && !system) {
    const err = new Error('Posted journals are immutable. Create a reversal journal instead.');
    err.status = 409;
    throw err;
  }
  const status = clean(body.Status || body.status || 'Draft');
  const date = clean(body.Date || body.date) || nowIso().slice(0, 10);
  if (lower(status) === 'posted' && await accountingPeriodIsClosed(env, date)) {
    const err = new Error('This accounting period is closed.');
    err.status = 409;
    throw err;
  }
  const payload = normalizedJournal({
    ...existing,
    JournalNo: journalNo,
    Date: date,
    Description: clean(body.Description || body.description),
    Reference: clean(body.Reference || body.reference),
    Source: clean(body.Source || body.source) || (system ? 'System' : 'Manual Journal'),
    SourceId: clean(body.SourceId || body.sourceId),
    Department: clean(body.Department || body.department),
    CostCentre: clean(body.CostCentre || body.costCentre),
    AcademicSession: clean(body.AcademicSession || body.academicSession),
    Term: clean(body.Term || body.term),
    Status: status,
    Lines: body.Lines || body.lines || existing.Lines || [],
    CreatedAt: existing.CreatedAt || nowIso(),
    CreatedBy: existing.CreatedBy || clean(body.RecordedBy || body.recordedBy),
    UpdatedAt: nowIso(),
    UpdatedBy: clean(body.RecordedBy || body.recordedBy),
    PostedAt: lower(status) === 'posted' ? (existing.PostedAt || nowIso()) : '',
    PostedBy: lower(status) === 'posted' ? clean(body.RecordedBy || body.recordedBy) : '',
    System: system ? 'YES' : clean(existing.System || 'NO')
  });
  const debit = asMoneyNumber(payload.Lines.reduce((sum, line) => sum + line.Debit, 0));
  const credit = asMoneyNumber(payload.Lines.reduce((sum, line) => sum + line.Credit, 0));
  if (!payload.Lines.length || payload.Lines.some((line) => !line.AccountCode || (line.Debit <= 0 && line.Credit <= 0))) {
    const err = new Error('Every journal requires valid debit and credit lines.');
    err.status = 400;
    throw err;
  }
  if (payload.Lines.some((line) => line.Debit < 0 || line.Credit < 0 || (line.Debit > 0 && line.Credit > 0))) {
    const err = new Error('Journal lines cannot contain negative values or both a debit and a credit.');
    err.status = 400;
    throw err;
  }
  let chartRows = await listCollection(env, 'chartOfAccounts');
  if (!chartRows.length) {
    await seedAccountingChart(env);
    chartRows = await listCollection(env, 'chartOfAccounts');
  }
  const activeCodes = new Set(chartRows
    .filter((row) => yesNo(row.Active || 'YES') === 'YES')
    .map((row) => clean(row.Code || row.__id)));
  const invalidCode = payload.Lines.find((line) => !activeCodes.has(clean(line.AccountCode)));
  if (invalidCode) {
    const err = new Error(`Journal account ${invalidCode.AccountCode} does not exist or is inactive.`);
    err.status = 400;
    throw err;
  }
  if (Math.abs(debit - credit) > 0.005) {
    const err = new Error(`Journal is not balanced. Debit ${debit.toFixed(2)}; credit ${credit.toFixed(2)}.`);
    err.status = 400;
    throw err;
  }
  payload.TotalDebit = debit;
  payload.TotalCredit = credit;
  await upsertDocument(env, 'accountingJournals', safeDocumentId(journalNo), payload);
  if (!system) await writeAccountingAudit(env, existingId ? 'UPDATE' : 'CREATE', 'Journal', journalNo, body, status);
  return payload;
}

async function syncRevenueToAccounting(env, options = {}) {
  const force = parseBoolean(options.Force || options.force || options.Rebuild || options.rebuild || options.Resync || options.resync);
  await seedAccountingChart(env);
  let created = 0;
  const warnings = [];
  const [invoices, payments, sales, journals, ledgerRows, legacyGatewayExpenses, gatewayCharges, admissionClasses] = await Promise.all([
    listCollection(env, 'invoices'),
    listCollection(env, 'payments'),
    listCollection(env, 'formSales').catch(() => []),
    listCollection(env, 'accountingJournals'),
    listCollection(env, 'ledger'),
    listCollection(env, 'accountingExpenses').catch(() => []),
    listCollection(env, 'paymentGatewayCharges').catch(() => []),
    listCollection(env, 'settings/admission/classes').catch(() => [])
  ]);
  let journalRows = journals.map((row) => ({ ...row }));
  if (force) {
    const removable = journalRows.filter((journal) => {
      const journalNo = clean(journal.JournalNo || journal.__id);
      return /^SYS-(INV|PAY|WALLET-PURCHASE|FORM)-/.test(journalNo);
    });
    for (const journal of removable) {
      const journalNo = clean(journal.JournalNo || journal.__id);
      const documentId = clean(journal.__id) || safeDocumentId(journalNo);
      if (!documentId) {
        warnings.push(`Unable to remove existing generated journal ${journalNo || 'UNIDENTIFIED'}: missing id.`);
        continue;
      }
      try {
        await deleteDocument(env, 'accountingJournals', documentId);
      } catch (error) {
        warnings.push(`Unable to remove existing generated journal ${journalNo || documentId}: ${error && error.message ? error.message : 'unknown delete error.'}`);
      }
      created += 1;
    }
    journalRows = journalRows.filter((journal) => !/^SYS-(INV|PAY|WALLET-PURCHASE|FORM)-/.test(clean(journal.JournalNo || journal.__id)));
  }
  const existing = new Set(journalRows.map((row) => clean(row.JournalNo || row.__id)));
  const journalsByNo = new Map(journalRows.map((row) => [clean(row.JournalNo || row.__id), row]));
  const removeJournalFromIndex = (journal) => {
    const rowId = clean(journal.__id || journal.__name || '');
    const journalNo = clean(journal.JournalNo || rowId);
    if (!journalNo && !rowId) return;
    journalRows = journalRows.filter((row) => {
      const candidateId = clean(row.__id || row.__name || '');
      const candidateNo = clean(row.JournalNo || row.__id || row.__name);
      return candidateId !== rowId && !(journalNo && candidateNo === journalNo);
    });
    if (journalNo) {
      existing.delete(journalNo);
      journalsByNo.delete(journalNo);
    }
  };
  const trackJournal = (journal) => {
    const journalNo = clean(journal.JournalNo || journal.__id);
    if (journalNo) {
      existing.add(journalNo);
      journalsByNo.set(journalNo, journal);
    }
    if (journal) {
      const journalId = clean(journal.__id || journal.__name || '');
      const normalizedNo = clean(journal.JournalNo || journal.__id);
      journalRows = journalRows.filter((row) => {
        const candidateId = clean(row.__id || row.__name || '');
        const candidateNo = clean(row.JournalNo || row.__id || row.__name);
        return candidateId !== journalId && (!normalizedNo || candidateNo !== normalizedNo);
      });
      if (normalizedNo) journalRows.push(journal);
    }
  };
  const findRelatedJournals = (sourceType, canonicalNo, sourcePrefix, sourceId, references = []) => {
    const normalizedReferences = [...references, sourceId, canonicalNo]
      .map(clean).filter(Boolean);
    return journalRows.filter((journal) => {
      if (lower(journal.Source) !== sourceType) return false;
      const journalNo = clean(journal.JournalNo || journal.__id);
      return sameText(journalNo, canonicalNo) ||
        normalizedReferences.some((reference) =>
          journalMatchesReference(journal, reference) ||
          sameText(journalNo, syncJournalNo(sourcePrefix, reference))
        );
    });
  };
  const removeDuplicateJournals = async (sourceType, sourcePrefix, sourceId, references = [], canonicalNo = '') => {
    const relatedJournals = findRelatedJournals(sourceType, canonicalNo, sourcePrefix, sourceId, references);
    for (const duplicate of relatedJournals) {
      const duplicateNo = clean(duplicate.JournalNo || duplicate.__id);
      if (duplicateNo === clean(canonicalNo)) continue;
      const duplicateId = clean(duplicate.__id || duplicate.__name);
      if (!duplicateId && !duplicateNo) {
        warnings.push(`Unable to remove duplicate ${sourceType} journal for ${sourceId}: missing id.`);
        continue;
      }
      try {
        await deleteDocument(env, 'accountingJournals', duplicateId || safeDocumentId(duplicateNo));
        removeJournalFromIndex(duplicate);
        created += 1;
      } catch (error) {
        warnings.push(`Unable to remove duplicate ${sourceType} journal ${duplicateId || duplicateNo}: ${error && error.message ? error.message : 'unknown delete error.'}`);
      }
    }
  };
  for (const row of invoices) {
    try {
      const sourceId = clean(row.InvoiceId || row.InvoiceNo || row.invoiceId || row.__id);
      const journalNo = `SYS-INV-${safeDocumentId(sourceId)}`;
      const amount = asMoneyNumber(row.Amount || row.amount);
      if (!sourceId || amount <= 0) continue;
      if (!force) {
        await removeDuplicateJournals('student invoice', 'SYS-INV-', sourceId, [row.InvoiceId, row.InvoiceNo, row.__id], journalNo);
        if (journalsByNo.get(journalNo)) continue;
      }
      const revenue = accountingAccountCodeForRevenue(row.FeeCategory || row.feeCategory, row.FeeCode || row.feeCode);
      const savedJournal = await saveAccountingJournal(env, {
        JournalNo: journalNo, Date: row.CreatedAt || row.Date || nowIso(), Status: 'Posted',
        Description: `Invoice: ${clean(row.FeeName || row.Description || sourceId)}`,
        Reference: sourceId, Source: 'Student Invoice', SourceId: sourceId,
        AcademicSession: row.AcademicSession || '', Term: row.Term || '', RecordedBy: 'System',
        Lines: [
          { AccountCode: '1100', Debit: amount, Credit: 0, Description: clean(row.AccountRef || row.DisplayName) },
          { AccountCode: revenue, Debit: 0, Credit: amount, Description: clean(row.FeeName || row.FeeCategory) }
        ]
      }, true);
      trackJournal(savedJournal); existing.add(journalNo); created += 1;
    } catch (error) {
      const rowId = clean(row.InvoiceId || row.InvoiceNo || row.invoiceId || row.__id || 'unknown invoice');
      warnings.push(`Unable to sync invoice ${rowId}: ${error && error.message ? error.message : 'unknown sync error.'}`);
    }
  }
  for (const row of payments) {
    try {
      const payment = normalizePayment(row);
      const sourceId = clean(payment.Reference || payment.GatewayReference || payment.PaymentId || row.PaymentNo || row.__id);
      const journalNo = `SYS-PAY-${safeDocumentId(sourceId)}`;
      const amount = paymentCreditedAmount(payment);
      if (!sourceId || amount <= 0) continue;
      const paymentReferences = [
        payment.Reference, payment.GatewayReference, payment.PaymentId,
        row.PaymentNo, row.__id
      ].map(clean).filter(Boolean);
      const canonicalNo = journalNo;
      const legacyLedger = ledgerRows.find((entry) => asMoneyNumber(entry.Credit) > 0 && paymentReferences.some((reference) => referencesMatch(entry.Reference, reference)));
      if (legacyLedger && (Math.abs(asMoneyNumber(legacyLedger.Credit) - amount) > 0.005 ||
        !sameText(legacyLedger.AcademicSession, payment.AcademicSession) || !sameText(legacyLedger.Term, payment.Term))) {
        const repairedLedger = { ...legacyLedger, Credit: amount, AcademicSession: payment.AcademicSession, Term: payment.Term,
          CalculationRepair: 'Net payment credit and exact financial period', CalculationRepairedAt: nowIso() };
        delete repairedLedger.__id; delete repairedLedger.__name;
        await upsertDocument(env, 'ledger', legacyLedger.__id || safeDocumentId(legacyLedger.LedgerNo), repairedLedger);
        created += 1;
      }
      if (payment.GatewayFee > 0) {
        const chargeId = safeDocumentId(`PAYSTACK-FEE-${payment.Reference || sourceId}`);
        const existingCharge = gatewayCharges.find((charge) => sameText(charge.ChargeId || charge.__id, chargeId));
        if (!existingCharge || Math.abs(asMoneyNumber(existingCharge.Amount) - payment.GatewayFee) > 0.005 ||
          Math.abs(asMoneyNumber(existingCharge.NetSettlement) - amount) > 0.005 || lower(existingCharge.Treatment) !== 'deductedbeforestudentcredit') {
          await upsertDocument(env, 'paymentGatewayCharges', chargeId, {
            ChargeId: chargeId, Date: row.PaidAt || row.PaymentDate || row.Date || nowIso(),
            Description: `Paystack transaction charge - ${payment.Reference || sourceId}`,
            Amount: payment.GatewayFee, GrossCollection: payment.GrossAmount, NetSettlement: amount,
            Treatment: 'DeductedBeforeStudentCredit', Status: 'Recorded', Reference: payment.Reference || sourceId,
            Source: 'Paystack', CreatedAt: existingCharge?.CreatedAt || nowIso(), UpdatedAt: nowIso()
          });
          created += 1;
        }
        const oldExpense = legacyGatewayExpenses.find((expense) => sameText(expense.Reference, payment.Reference) && lower(expense.Source).includes('paystack'));
        if (oldExpense && ['posted', 'paid'].includes(lower(oldExpense.Status))) {
          const reclassified = { ...oldExpense, Status: 'Reclassified', Treatment: 'DeductedBeforeStudentCredit',
            ReclassifiedAt: nowIso(), ReclassificationNote: 'Parent account is credited with the Paystack net settlement; this charge is retained for audit only.' };
          delete reclassified.__id; delete reclassified.__name;
          await upsertDocument(env, 'accountingExpenses', oldExpense.__id || safeDocumentId(oldExpense.ExpenseNo), reclassified);
          created += 1;
        }
      }
      const matchingInvoices = matchingInvoicesForPayment(payment, invoices, { requireOutstanding: true });
      const lines = buildPaymentReceiptJournalLines(payment, amount, matchingInvoices);
      if (lines.length < 2) continue;
      await removeDuplicateJournals('fee payment', 'SYS-PAY-', sourceId, paymentReferences, canonicalNo);
      const prior = journalsByNo.get(journalNo);
      if (!force && prior && journalLineSignature(prior.Lines) === journalLineSignature(lines) &&
        sameText(prior.Reference, sourceId) && sameText(prior.SourceId, sourceId)) continue;
      const savedJournal = await saveAccountingJournal(env, {
        JournalNo: journalNo, Date: row.PaidAt || row.PaymentDate || row.Date || nowIso(), Status: 'Posted',
        Description: `Receipt: ${clean(row.Reference || sourceId)}`, Reference: clean(row.Reference || sourceId),
        Source: 'Fee Payment', SourceId: sourceId, RecordedBy: 'System',
        Lines: lines
      }, true);
      trackJournal(savedJournal);
      existing.add(journalNo); created += 1;
    } catch (error) {
      const paymentId = clean(row.Reference || row.GatewayReference || row.PaymentId || row.PaymentNo || row.__id || 'unknown payment');
      warnings.push(`Unable to sync payment ${paymentId}: ${error && error.message ? error.message : 'unknown sync error.'}`);
    }
  }
  const walletPurchases = ledgerRows.map(normalizeLedger).filter((row) => isWalletPurchaseEntry(row) && asMoneyNumber(row.Debit) > 0);
  for (const row of walletPurchases) {
    try {
      const sourceId = clean(row.Reference || row.LedgerNo || row.__id);
      const journalNo = `SYS-WALLET-PURCHASE-${safeDocumentId(sourceId)}`;
      const amount = asMoneyNumber(row.Debit);
      if (!sourceId || amount <= 0) continue;
      const destination = accountingDestinationForWalletPurchase(row);
      const rowMetadata = parseMetadata(row.Metadata);
      const lines = [
        { AccountCode: '2200', Debit: amount, Credit: 0, Description: clean(row.AccountRef || row.DisplayName || 'Wallet purchase') },
        { AccountCode: destination, Debit: 0, Credit: amount, Description: clean(row.Description) || clean(row.Notes) || 'Wallet purchase settlement' }
      ];
      await removeDuplicateJournals('wallet purchase', 'SYS-WALLET-PURCHASE-', sourceId, [sourceId], journalNo);
      const prior = journalsByNo.get(journalNo);
      if (!force && prior && journalLineSignature(prior.Lines) === journalLineSignature(lines) &&
        sameText(prior.Reference, sourceId) && sameText(prior.SourceId, sourceId)) {
        continue;
      }
      const savedJournal = await saveAccountingJournal(env, {
        JournalNo: journalNo, Date: row.Date || nowIso(), Status: 'Posted',
        Description: `Wallet purchase: ${clean(row.Description) || sourceId}`,
        Reference: sourceId, Source: 'Wallet Purchase', SourceId: sourceId, RecordedBy: clean(row.RecordedBy) || 'System',
        Department: clean(row.Department) || clean(rowMetadata.Department || rowMetadata.department || rowMetadata.StoreType || rowMetadata.storeType),
        AcademicSession: row.AcademicSession || '', Term: row.Term || '', Lines: lines
      }, true);
      trackJournal(savedJournal);
      existing.add(journalNo); created += 1;
    } catch (error) {
      const ledgerId = clean(row.Reference || row.LedgerNo || row.__id || 'unknown wallet ledger row');
      warnings.push(`Unable to sync wallet purchase ${ledgerId}: ${error && error.message ? error.message : 'unknown sync error.'}`);
    }
  }
  const normalizedAdmissionClasses = admissionClasses.map(normalizeAdmissionClass);
  const defaultConfiguredFormAmount = asMoneyNumber(
    normalizedAdmissionClasses.find((item) => asMoneyNumber(item.FormAmount) > 0)?.FormAmount
  );
  for (const row of sales) {
    try {
      const sourceId = clean(row.ReceiptNo || row.receiptNo || row.__id);
      const journalNo = `SYS-FORM-${safeDocumentId(sourceId)}`;
      const classConfiguration = normalizedAdmissionClasses.find((item) =>
        classNamesMatch(item.ClassName, row.ClassApplyingFor || row.ClassName)
      );
      const configuredFormAmount = asMoneyNumber(classConfiguration?.FormAmount) || defaultConfiguredFormAmount;
      const amounts = formSaleFinancialAmounts(row, configuredFormAmount);
      const amount = amounts.RecognizedAmount;
      if (!sourceId || amount <= 0) continue;
      const normalizedSale = {
        ...row,
        AmountPaid: formatNairaAmount(amount),
        FormAmount: amounts.FormAmount,
        GrossAmount: amounts.GrossAmount,
        GatewayFee: amounts.GatewayFee,
        NetAmount: amounts.NetAmount,
        Gateway: clean(row.Gateway) || (amounts.GatewayFee > 0 ? 'Paystack' : 'Manual'),
        PaymentMethod: clean(row.PaymentMethod || row.Method) || (amounts.GatewayFee > 0 ? 'Online' : 'Manual'),
        UpdatedAt: nowIso()
      };
      delete normalizedSale.__id; delete normalizedSale.__name;
      if (journalLineSignature([{
        AccountCode: 'FORM',
        Debit: asMoneyNumber(row.GrossAmount),
        Credit: asMoneyNumber(row.GatewayFee)
      }]) !== journalLineSignature([{
        AccountCode: 'FORM',
        Debit: amounts.GrossAmount,
        Credit: amounts.GatewayFee
      }]) || !asMoneyNumber(row.FormAmount) || !asMoneyNumber(row.NetAmount)) {
        await upsertDocument(env, 'formSales', clean(row.__id) || safeDocumentId(sourceId), normalizedSale);
        created += 1;
      }
      if (amounts.GatewayFee > 0) {
        const chargeId = safeDocumentId(`PAYSTACK-FORM-FEE-${row.PaymentReference || sourceId}`);
        const existingCharge = gatewayCharges.find((charge) => sameText(charge.ChargeId || charge.__id, chargeId));
        if (!existingCharge) {
          await upsertDocument(env, 'paymentGatewayCharges', chargeId, {
            ChargeId: chargeId, Date: row.PaymentDate || row.Time || nowIso(),
            Description: `Paystack admission-form transaction charge - ${row.PaymentReference || sourceId}`,
            Amount: amounts.GatewayFee, GrossCollection: amounts.GrossAmount, NetSettlement: amounts.NetAmount,
            Treatment: 'DeductedBeforeRevenueRecognition', Status: 'Recorded',
            Reference: row.PaymentReference || sourceId, Source: 'Paystack Admission Form',
            CreatedAt: nowIso(), UpdatedAt: nowIso()
          });
          created += 1;
        }
      }
      if (!force) await removeDuplicateJournals('admission form sale', 'SYS-FORM-', sourceId,
        [row.PaymentReference, row.TransactionId, row.__id, row.ReceiptNo, row.receiptNo], journalNo);
      const lines = [
        { AccountCode: accountingCashAccountFor(normalizedSale.PaymentMethod, normalizedSale.Gateway), Debit: amount, Credit: 0, Description: 'Form sale net receipt' },
        { AccountCode: '4010', Debit: 0, Credit: amount, Description: 'Admission form revenue' }
      ];
      const prior = journalsByNo.get(journalNo);
      if (!force && prior && journalLineSignature(prior.Lines) === journalLineSignature(lines)) continue;
      const savedJournal = await saveAccountingJournal(env, {
        JournalNo: journalNo, Date: row.PaymentDate || row.Timestamp || nowIso(), Status: 'Posted',
        Description: `Admission form sale: ${clean(row.ApplicantName || sourceId)}`, Reference: sourceId,
        Source: 'Admission Form Sale', SourceId: sourceId, RecordedBy: 'System',
        Lines: lines
      }, true);
      trackJournal(savedJournal);
      existing.add(journalNo); created += 1;
    } catch (error) {
      const receiptId = clean(row.ReceiptNo || row.receiptNo || row.__id || 'unknown form sale');
      warnings.push(`Unable to sync admission form sale ${receiptId}: ${error && error.message ? error.message : 'unknown sync error.'}`);
    }
  }
  return {
    created,
    warnings,
    hadWarnings: warnings.length > 0,
    warningCount: warnings.length
  };
}

async function saveChartAccount(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const code = clean(body.Code || body.code);
  if (!code || !clean(body.Name || body.name) || !clean(body.Type || body.type)) {
    const err = new Error('Account code, name and type are required.'); err.status = 400; throw err;
  }
  const existing = (await listCollection(env, 'chartOfAccounts')).find((row) => sameText(row.Code, code) || sameText(row.__id, code)) || {};
  const payload = {
    ...existing, Code: code, Name: clean(body.Name || body.name), Type: clean(body.Type || body.type),
    Group: clean(body.Group || body.group), NormalBalance: clean(body.NormalBalance || body.normalBalance) || 'Debit',
    Active: yesNo(body.Active ?? body.active ?? 'YES') || 'YES', System: clean(existing.System || 'NO'),
    CreatedAt: existing.CreatedAt || nowIso(), UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'chartOfAccounts', safeDocumentId(code), payload);
  await writeAccountingAudit(env, existing.Code ? 'UPDATE' : 'CREATE', 'Chart Account', code, body, payload.Name);
  return { ok: true, message: 'Chart of account saved.', account: payload };
}

async function saveAccountingExpense(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management', ...DEPARTMENT_ACCOUNTING_ROLES]);
  const expenseNo = clean(body.ExpenseNo || body.expenseNo) || ledgerDocumentId('EXP');
  const existing = (await listCollection(env, 'accountingExpenses')).find((row) => sameText(row.ExpenseNo, expenseNo) || sameText(row.__id, safeDocumentId(expenseNo))) || {};
  if (lower(existing.Status) === 'posted') {
    const err = new Error('Posted expenses cannot be edited. Use a reversal.'); err.status = 409; throw err;
  }
  const amount = asMoneyNumber(body.Amount || body.amount);
  if (amount <= 0 || !clean(body.Description || body.description)) {
    const err = new Error('Expense description and amount are required.'); err.status = 400; throw err;
  }
  const requestedStatus = clean(body.Status || body.status || 'Draft');
  const forcedDepartment = enforceDepartmentSubmission(body, existing, requestedStatus);
  if (['approved', 'rejected'].includes(lower(requestedStatus)) || (lower(requestedStatus) === 'posted' && lower(existing.Status) !== 'approved')) {
    await requireAccountingApprovalLimit(env, body, 'Expense', amount);
  }
  const payload = {
    ...existing, ExpenseNo: expenseNo, Date: clean(body.Date || body.date) || nowIso().slice(0, 10),
    Vendor: clean(body.Vendor || body.vendor), Description: clean(body.Description || body.description), Amount: amount,
    ExpenseAccount: clean(body.ExpenseAccount || body.expenseAccount) || '6090',
    PaymentAccount: clean(body.PaymentAccount || body.paymentAccount) || '1020',
    Department: forcedDepartment || clean(body.Department || body.department), CostCentre: clean(body.CostCentre || body.costCentre),
    BudgetCode: clean(body.BudgetCode || body.budgetCode), PaymentMethod: clean(body.PaymentMethod || body.paymentMethod),
    Reference: clean(body.Reference || body.reference), AttachmentUrl: clean(body.AttachmentUrl || body.attachmentUrl),
    Notes: clean(body.Notes || body.notes), Status: requestedStatus,
    RequestedBy: existing.RequestedBy || clean(body.RecordedBy || body.recordedBy), RequestedAt: existing.RequestedAt || nowIso(),
    ApprovedBy: lower(requestedStatus) === 'approved' ? clean(body.RecordedBy || body.recordedBy) : (existing.ApprovedBy || ''),
    ApprovedAt: lower(requestedStatus) === 'approved' ? nowIso() : (existing.ApprovedAt || ''), UpdatedAt: nowIso()
  };
  if (lower(requestedStatus) === 'posted') {
    const journal = await saveAccountingJournal(env, {
      JournalNo: `SYS-EXP-${safeDocumentId(expenseNo)}`, Date: payload.Date, Status: 'Posted',
      Description: payload.Description, Reference: payload.Reference || expenseNo, Source: 'Expense', SourceId: expenseNo,
      Department: payload.Department, CostCentre: payload.CostCentre, RecordedBy: clean(body.RecordedBy || body.recordedBy),
      Lines: [
        { AccountCode: payload.ExpenseAccount, Debit: amount, Credit: 0, Description: payload.Description, Department: payload.Department },
        { AccountCode: payload.PaymentAccount, Debit: 0, Credit: amount, Description: payload.Vendor || payload.PaymentMethod }
      ]
    }, true);
    payload.JournalNo = journal.JournalNo;
    payload.PostedAt = nowIso(); payload.PostedBy = clean(body.RecordedBy || body.recordedBy);
  }
  await upsertDocument(env, 'accountingExpenses', safeDocumentId(expenseNo), payload);
  await writeAccountingAudit(env, existing.ExpenseNo ? 'UPDATE' : 'CREATE', 'Expense', expenseNo, body, requestedStatus);
  return { ok: true, message: `Expense saved as ${requestedStatus}.`, expense: payload };
}

async function saveAccountingBudget(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const id = clean(body.BudgetId || body.budgetId) || [body.FinancialYear, body.Department, body.AccountCode].map(safeDocumentId).join('-');
  const payload = {
    BudgetId: id, FinancialYear: clean(body.FinancialYear || body.financialYear),
    AcademicSession: clean(body.AcademicSession || body.academicSession), Term: clean(body.Term || body.term),
    Department: clean(body.Department || body.department), AccountCode: clean(body.AccountCode || body.accountCode),
    Amount: asMoneyNumber(body.Amount || body.amount), Notes: clean(body.Notes || body.notes),
    Status: clean(body.Status || body.status || 'Approved'), UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy || body.recordedBy)
  };
  if (!payload.FinancialYear || !payload.AccountCode || payload.Amount < 0) {
    const err = new Error('Financial year, account code and a valid amount are required.'); err.status = 400; throw err;
  }
  await upsertDocument(env, 'accountingBudgets', safeDocumentId(id), payload);
  await writeAccountingAudit(env, 'SAVE', 'Budget', id, body, `${payload.AccountCode}: ${payload.Amount}`);
  return { ok: true, message: 'Budget saved.', budget: payload };
}

async function saveAccountingBank(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const id = clean(body.BankId || body.bankId || body.AccountCode || body.accountCode) || ledgerDocumentId('BNK');
  const payload = {
    BankId: id, Name: clean(body.Name || body.name), BankName: clean(body.BankName || body.bankName),
    AccountNumber: clean(body.AccountNumber || body.accountNumber), AccountCode: clean(body.AccountCode || body.accountCode) || '1020',
    OpeningBalance: asMoneyNumber(body.OpeningBalance || body.openingBalance), Active: yesNo(body.Active ?? 'YES') || 'YES',
    UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy || body.recordedBy)
  };
  if (!payload.Name) { const err = new Error('Bank/cash account name is required.'); err.status = 400; throw err; }
  await upsertDocument(env, 'accountingBanks', safeDocumentId(id), payload);
  await writeAccountingAudit(env, 'SAVE', 'Bank Account', id, body, payload.Name);
  return { ok: true, message: 'Bank/cash account saved.', bank: payload };
}

async function saveAccountingReconciliation(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const id = clean(body.ReconciliationNo || body.reconciliationNo) || ledgerDocumentId('REC');
  const statement = asMoneyNumber(body.StatementBalance || body.statementBalance);
  const book = asMoneyNumber(body.BookBalance || body.bookBalance);
  const outstandingDeposits = asMoneyNumber(body.OutstandingDeposits || body.outstandingDeposits);
  const unpresentedPayments = asMoneyNumber(body.UnpresentedPayments || body.unpresentedPayments);
  const chargesAndAdjustments = asMoneyNumber(body.ChargesAndAdjustments || body.chargesAndAdjustments);
  const payload = {
    ReconciliationNo: id, BankId: clean(body.BankId || body.bankId), AccountCode: clean(body.AccountCode || body.accountCode) || '1020',
    StatementDate: clean(body.StatementDate || body.statementDate) || nowIso().slice(0, 10),
    StatementBalance: statement, BookBalance: book,
    OutstandingDeposits: outstandingDeposits,
    UnpresentedPayments: unpresentedPayments,
    ChargesAndAdjustments: chargesAndAdjustments,
    AdjustedStatementBalance: asMoneyNumber(statement + outstandingDeposits - unpresentedPayments),
    AdjustedBookBalance: asMoneyNumber(book - chargesAndAdjustments),
    Difference: reconciliationDifference(statement, book, outstandingDeposits, unpresentedPayments, chargesAndAdjustments),
    Status: clean(body.Status || body.status || 'Draft'),
    Notes: clean(body.Notes || body.notes), PreparedBy: clean(body.RecordedBy || body.recordedBy), UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'accountingReconciliations', safeDocumentId(id), payload);
  await writeAccountingAudit(env, 'SAVE', 'Reconciliation', id, body, payload.Status);
  return { ok: true, message: 'Bank reconciliation saved.', reconciliation: payload };
}

export function reconciliationDifference(statement, book, outstandingDeposits = 0, unpresentedPayments = 0, chargesAndAdjustments = 0) {
  const adjustedStatement = asMoneyNumber(statement) + asMoneyNumber(outstandingDeposits) - asMoneyNumber(unpresentedPayments);
  const adjustedBook = asMoneyNumber(book) - asMoneyNumber(chargesAndAdjustments);
  return asMoneyNumber(adjustedStatement - adjustedBook);
}

async function saveAccountingPeriod(env, body) {
  requireAccountingRole(body, ['Super Admin']);
  const id = clean(body.PeriodId || body.periodId) || `${safeDocumentId(body.StartDate)}-${safeDocumentId(body.EndDate)}`;
  const payload = {
    PeriodId: id, Name: clean(body.Name || body.name), StartDate: clean(body.StartDate || body.startDate),
    EndDate: clean(body.EndDate || body.endDate), Status: clean(body.Status || body.status || 'Open'),
    ClosedAt: lower(body.Status) === 'closed' ? nowIso() : '', ClosedBy: lower(body.Status) === 'closed' ? clean(body.RecordedBy) : '',
    UpdatedAt: nowIso()
  };
  if (!payload.StartDate || !payload.EndDate || payload.StartDate > payload.EndDate) {
    const err = new Error('A valid period start and end date are required.'); err.status = 400; throw err;
  }
  if (lower(payload.Status) === 'closed') {
    const checklist = (await listCollection(env, 'accountingCloseChecklist')).filter((row) => sameText(row.PeriodId, id));
    const incomplete = checklist.filter((row) => yesNo(row.Required ?? 'YES') === 'YES' && lower(row.Status) !== 'completed');
    if (!checklist.length || incomplete.length) {
      const err = new Error(`Complete the month-end checklist before closing this period (${incomplete.length || 'all'} item(s) remaining).`);
      err.status = 409; throw err;
    }
    const banks = await listCollection(env, 'accountingBanks');
    const reconciliations = (await listCollection(env, 'accountingReconciliations')).filter((row) => clean(row.StatementDate) >= payload.StartDate && clean(row.StatementDate) <= payload.EndDate);
    const activeBanks = banks.filter((row) => yesNo(row.Active ?? 'YES') === 'YES');
    const allBanksReconciled = activeBanks.every((bank) => reconciliations.some((row) => sameText(row.BankId, bank.BankId) && lower(row.Status) === 'completed' && Math.abs(asMoneyNumber(row.Difference)) <= 0.005));
    if (activeBanks.length && !allBanksReconciled) {
      const err = new Error('All bank accounts must have completed zero-difference reconciliations before period close.');
      err.status = 409; throw err;
    }
  }
  await upsertDocument(env, 'accountingPeriods', safeDocumentId(id), payload);
  await seedAccountingCloseChecklist(env, id);
  await writeAccountingAudit(env, 'SAVE', 'Accounting Period', id, body, payload.Status);
  return { ok: true, message: `Accounting period saved as ${payload.Status}.`, period: payload };
}

const DEFAULT_ACCOUNTING_APPROVAL_LIMITS = [
  { Role: 'Management', TransactionType: 'Expense', MaxAmount: 5000000 },
  { Role: 'Management', TransactionType: 'Supplier Bill', MaxAmount: 5000000 },
  { Role: 'Management', TransactionType: 'Concession', MaxAmount: 1000000 },
  { Role: 'Super Admin', TransactionType: 'Expense', MaxAmount: 999999999999 },
  { Role: 'Super Admin', TransactionType: 'Supplier Bill', MaxAmount: 999999999999 },
  { Role: 'Super Admin', TransactionType: 'Concession', MaxAmount: 999999999999 }
];

const DEFAULT_CLOSE_CHECKLIST = [
  'Revenue subledgers synchronized', 'All expense vouchers reviewed', 'Bank accounts reconciled',
  'Student receivables reviewed', 'Supplier payables reviewed', 'Depreciation posted',
  'Trial balance reviewed', 'Financial statements approved', 'Accounting backup/export completed'
];

async function seedAccountingApprovalLimits(env) {
  const rows = await listCollection(env, 'accountingApprovalLimits');
  const existing = new Set(rows.map((row) => `${clean(row.Role)}|${clean(row.TransactionType)}`.toLowerCase()));
  for (const item of DEFAULT_ACCOUNTING_APPROVAL_LIMITS) {
    const key = `${item.Role}|${item.TransactionType}`.toLowerCase();
    if (existing.has(key)) continue;
    await upsertDocument(env, 'accountingApprovalLimits', safeDocumentId(key), { ...item, Active: 'YES', UpdatedAt: nowIso(), UpdatedBy: 'System' });
  }
}

async function requireAccountingApprovalLimit(env, body, transactionType, amount) {
  const role = clean(body.UserRole || body.userRole);
  if (role === 'Super Admin') return;
  const username = clean(body.UserUsername || body.userUsername);
  const users = await listCollection(env, 'staffUsers');
  const user = users.find((row) => sameText(row.Username || row.__id, username));
  const enabled = user && yesNo(user.ApprovalEnabled ?? 'NO') === 'YES';
  const maximum = user ? asMoneyNumber(user.ApprovalMaxAmount) : 0;
  const allowedAccounts = Array.isArray(user?.ApprovalAccounts) ? user.ApprovalAccounts.map(clean) : clean(user?.ApprovalAccounts).split(',').map(clean).filter(Boolean);
  const accountCode = clean(transactionType === 'Expense' ? (body.ExpenseAccount || body.expenseAccount) : (body.AccountCode || body.accountCode || body.ExpenseAccount));
  if (!enabled || maximum <= 0 || asMoneyNumber(amount) > maximum || !allowedAccounts.some((code) => sameText(code, accountCode))) {
    const err = new Error('This user does not have administrator-granted approval rights for this account and amount.'); err.status = 403; throw err;
  }
}

async function saveAccountingApprovalLimit(env, body) {
  requireAccountingRole(body, ['Super Admin']);
  const role = clean(body.Role || body.role);
  const type = clean(body.TransactionType || body.transactionType);
  if (!role || !type) { const err = new Error('Role and transaction type are required.'); err.status = 400; throw err; }
  const id = safeDocumentId(`${role}-${type}`);
  const payload = { Role: role, TransactionType: type, MaxAmount: asMoneyNumber(body.MaxAmount || body.maxAmount), Active: yesNo(body.Active ?? 'YES') || 'YES', UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) };
  await upsertDocument(env, 'accountingApprovalLimits', id, payload);
  await writeAccountingAudit(env, 'SAVE', 'Approval Limit', id, body, `${role}: ${payload.MaxAmount}`);
  return { ok: true, message: 'Approval limit saved.', limit: payload };
}

async function seedAccountingCloseChecklist(env, periodId) {
  if (!periodId) return;
  const existing = await listCollection(env, 'accountingCloseChecklist');
  for (let index = 0; index < DEFAULT_CLOSE_CHECKLIST.length; index += 1) {
    const id = safeDocumentId(`${periodId}-${index + 1}`);
    if (existing.some((row) => sameText(row.__id, id) || sameText(row.ChecklistId, id))) continue;
    await upsertDocument(env, 'accountingCloseChecklist', id, { ChecklistId: id, PeriodId: periodId, SortOrder: index + 1,
      Item: DEFAULT_CLOSE_CHECKLIST[index], Required: 'YES', Status: 'Pending', CompletedAt: '', CompletedBy: '', Notes: '' });
  }
}

async function saveAccountingCloseChecklist(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const id = clean(body.ChecklistId || body.checklistId);
  if (!id) { const err = new Error('Checklist item is required.'); err.status = 400; throw err; }
  const existing = (await listCollection(env, 'accountingCloseChecklist')).find((row) => sameText(row.ChecklistId, id) || sameText(row.__id, safeDocumentId(id)));
  if (!existing) { const err = new Error('Checklist item was not found.'); err.status = 404; throw err; }
  const status = clean(body.Status || body.status || 'Pending');
  const payload = { ...existing, Status: status, Notes: clean(body.Notes || body.notes),
    CompletedAt: lower(status) === 'completed' ? nowIso() : '', CompletedBy: lower(status) === 'completed' ? clean(body.RecordedBy) : '' };
  await upsertDocument(env, 'accountingCloseChecklist', safeDocumentId(id), payload);
  await writeAccountingAudit(env, 'UPDATE', 'Close Checklist', id, body, status);
  return { ok: true, message: 'Month-end checklist updated.', item: payload };
}

async function saveAccountingOpeningBalance(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const date = clean(body.Date || body.date) || nowIso().slice(0, 10);
  const reference = clean(body.Reference || body.reference) || `OPEN-${date}`;
  const journal = await saveAccountingJournal(env, { ...body, Date: date, Reference: reference,
    Description: clean(body.Description) || `Opening balances at ${date}`, Source: 'Opening Balance', Status: 'Posted' });
  await writeAccountingAudit(env, 'POST', 'Opening Balance', journal.JournalNo, body, reference);
  return { ok: true, message: 'Opening balances posted.', journal };
}

async function saveAccountingVendor(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const vendorId = clean(body.VendorId || body.vendorId) || ledgerDocumentId('VND');
  const name = clean(body.Name || body.name || body.Vendor);
  if (!name) { const err = new Error('Supplier name is required.'); err.status = 400; throw err; }
  const existing = (await listCollection(env, 'accountingVendors')).find((row) => sameText(row.VendorId, vendorId) || sameText(row.__id, safeDocumentId(vendorId))) || {};
  const payload = { ...existing, VendorId: vendorId, Name: name, ContactPerson: clean(body.ContactPerson), Phone: clean(body.Phone),
    Email: clean(body.Email), Address: clean(body.Address), BankName: clean(body.BankName), AccountNumber: clean(body.AccountNumber),
    TaxId: clean(body.TaxId), PaymentTermsDays: asMoneyNumber(body.PaymentTermsDays || 30), Active: yesNo(body.Active ?? 'YES') || 'YES',
    CreatedAt: existing.CreatedAt || nowIso(), UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) };
  await upsertDocument(env, 'accountingVendors', safeDocumentId(vendorId), payload);
  await writeAccountingAudit(env, existing.VendorId ? 'UPDATE' : 'CREATE', 'Supplier', vendorId, body, name);
  return { ok: true, message: 'Supplier saved.', vendor: payload };
}

async function saveAccountingSupplierBill(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management', ...DEPARTMENT_ACCOUNTING_ROLES]);
  const billNo = clean(body.BillNo || body.billNo) || ledgerDocumentId('BILL');
  const billRows = await listCollection(env, 'accountingSupplierBills');
  const existing = billRows.find((row) => sameText(row.BillNo, billNo) || sameText(row.__id, safeDocumentId(billNo))) || {};
  if (['posted', 'part paid', 'paid'].includes(lower(existing.Status))) { const err = new Error('Posted supplier bills are immutable.'); err.status = 409; throw err; }
  const amount = asMoneyNumber(body.Amount || body.amount);
  const status = clean(body.Status || body.status || 'Draft');
  const forcedDepartment = enforceDepartmentSubmission(body, existing, status);
  if (amount <= 0 || !clean(body.Description)) { const err = new Error('Bill description and amount are required.'); err.status = 400; throw err; }
  const invoiceReference = clean(body.InvoiceReference || body.Reference);
  if (invoiceReference && billRows.some((row) => !sameText(row.BillNo, billNo) && sameText(row.VendorId, body.VendorId) && sameText(row.InvoiceReference, invoiceReference))) {
    const err = new Error('This supplier invoice reference has already been recorded for the selected supplier.'); err.status = 409; throw err;
  }
  if (['approved', 'posted', 'rejected'].includes(lower(status))) await requireAccountingApprovalLimit(env, body, 'Supplier Bill', amount);
  const payload = { ...existing, BillNo: billNo, VendorId: clean(body.VendorId), VendorName: clean(body.VendorName || body.Vendor),
    InvoiceReference: invoiceReference, Date: clean(body.Date) || nowIso().slice(0, 10),
    DueDate: clean(body.DueDate), Description: clean(body.Description), Amount: amount, PaidAmount: asMoneyNumber(existing.PaidAmount), BalanceAmount: amount - asMoneyNumber(existing.PaidAmount),
    AccountCode: clean(body.AccountCode) || '6090', Department: forcedDepartment || clean(body.Department), CostCentre: clean(body.CostCentre),
    AcademicSession: clean(body.AcademicSession), Term: clean(body.Term), AttachmentUrl: clean(body.AttachmentUrl), Notes: clean(body.Notes), Status: status,
    CreatedAt: existing.CreatedAt || nowIso(), CreatedBy: existing.CreatedBy || clean(body.RecordedBy), UpdatedAt: nowIso(),
    ApprovedAt: ['approved', 'posted'].includes(lower(status)) ? nowIso() : '', ApprovedBy: ['approved', 'posted'].includes(lower(status)) ? clean(body.RecordedBy) : '' };
  if (lower(status) === 'posted') {
    const journal = await saveAccountingJournal(env, { JournalNo: `SYS-BILL-${safeDocumentId(billNo)}`, Date: payload.Date, Status: 'Posted',
      Description: payload.Description, Reference: payload.InvoiceReference || billNo, Source: 'Supplier Bill', SourceId: billNo,
      Department: payload.Department, CostCentre: payload.CostCentre, AcademicSession: payload.AcademicSession, Term: payload.Term,
      RecordedBy: clean(body.RecordedBy), Lines: [
        { AccountCode: payload.AccountCode, Debit: amount, Credit: 0, Description: payload.Description, Department: payload.Department },
        { AccountCode: '2000', Debit: 0, Credit: amount, Description: payload.VendorName || payload.VendorId }
      ] }, true);
    payload.JournalNo = journal.JournalNo; payload.PostedAt = nowIso(); payload.PostedBy = clean(body.RecordedBy);
  }
  await upsertDocument(env, 'accountingSupplierBills', safeDocumentId(billNo), payload);
  await writeAccountingAudit(env, existing.BillNo ? 'UPDATE' : 'CREATE', 'Supplier Bill', billNo, body, status);
  return { ok: true, message: `Supplier bill saved as ${status}.`, bill: payload };
}

async function payAccountingSupplierBill(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const billNo = clean(body.BillNo || body.billNo);
  const bill = (await listCollection(env, 'accountingSupplierBills')).find((row) => sameText(row.BillNo, billNo) || sameText(row.__id, safeDocumentId(billNo)));
  if (!bill || !['posted', 'part paid'].includes(lower(bill.Status))) { const err = new Error('Select a posted unpaid supplier bill.'); err.status = 400; throw err; }
  const outstanding = Math.max(0, asMoneyNumber(bill.Amount) - asMoneyNumber(bill.PaidAmount));
  const amount = asMoneyNumber(body.Amount || body.amount);
  if (amount <= 0 || amount > outstanding + 0.005) { const err = new Error(`Payment must be between 0 and ${outstanding.toFixed(2)}.`); err.status = 400; throw err; }
  const paymentNo = clean(body.PaymentNo) || ledgerDocumentId('VPay');
  const paymentAccount = clean(body.PaymentAccount) || '1020';
  const date = clean(body.Date) || nowIso().slice(0, 10);
  const journal = await saveAccountingJournal(env, { JournalNo: `SYS-VPAY-${safeDocumentId(paymentNo)}`, Date: date, Status: 'Posted',
    Description: `Payment to ${clean(bill.VendorName || bill.VendorId)}`, Reference: clean(body.Reference) || paymentNo,
    Source: 'Supplier Payment', SourceId: paymentNo, RecordedBy: clean(body.RecordedBy), Lines: [
      { AccountCode: '2000', Debit: amount, Credit: 0, Description: billNo },
      { AccountCode: paymentAccount, Debit: 0, Credit: amount, Description: clean(body.Method) || 'Supplier payment' }
    ] }, true);
  const paid = asMoneyNumber(bill.PaidAmount) + amount;
  const updated = { ...bill, PaidAmount: paid, BalanceAmount: Math.max(0, asMoneyNumber(bill.Amount) - paid),
    Status: paid + 0.005 >= asMoneyNumber(bill.Amount) ? 'Paid' : 'Part Paid', LastPaymentAt: date, UpdatedAt: nowIso() };
  await upsertDocument(env, 'accountingSupplierBills', safeDocumentId(billNo), updated);
  const payment = { PaymentNo: paymentNo, BillNo: billNo, VendorId: clean(bill.VendorId), Date: date, Amount: amount,
    PaymentAccount: paymentAccount, Method: clean(body.Method), Reference: clean(body.Reference), JournalNo: journal.JournalNo, RecordedBy: clean(body.RecordedBy), RecordedAt: nowIso() };
  await upsertDocument(env, 'accountingSupplierPayments', safeDocumentId(paymentNo), payment);
  await writeAccountingAudit(env, 'PAY', 'Supplier Bill', billNo, body, `${paymentNo}: ${amount}`);
  return { ok: true, message: 'Supplier payment posted.', bill: updated, payment };
}

async function saveAccountingAsset(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const assetId = clean(body.AssetId || body.assetId) || ledgerDocumentId('AST');
  const existing = (await listCollection(env, 'accountingAssets')).find((row) => sameText(row.AssetId, assetId) || sameText(row.__id, safeDocumentId(assetId))) || {};
  const cost = asMoneyNumber(body.Cost || body.cost);
  const residual = asMoneyNumber(body.ResidualValue || body.residualValue);
  const life = Math.max(1, Math.round(asMoneyNumber(body.UsefulLifeMonths || body.usefulLifeMonths || 60)));
  if (!clean(body.Name) || cost <= 0 || residual > cost) { const err = new Error('Asset name, valid cost, and residual value are required.'); err.status = 400; throw err; }
  const accumulated = asMoneyNumber(existing.AccumulatedDepreciation || body.AccumulatedDepreciation);
  const payload = { ...existing, AssetId: assetId, Name: clean(body.Name), Category: clean(body.Category), AcquisitionDate: clean(body.AcquisitionDate) || nowIso().slice(0, 10),
    Cost: cost, ResidualValue: residual, UsefulLifeMonths: life, MonthlyDepreciation: asMoneyNumber((cost - residual) / life),
    AccumulatedDepreciation: accumulated, NetBookValue: Math.max(residual, cost - accumulated), Location: clean(body.Location), Custodian: clean(body.Custodian),
    SerialNumber: clean(body.SerialNumber), AssetAccount: clean(body.AssetAccount) || '1500', AccumulatedDepreciationAccount: clean(body.AccumulatedDepreciationAccount) || '1600',
    DepreciationExpenseAccount: clean(body.DepreciationExpenseAccount) || '6070', Status: clean(body.Status) || 'Active', Notes: clean(body.Notes),
    CreatedAt: existing.CreatedAt || nowIso(), UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) };
  if (yesNo(body.PostAcquisition) === 'YES' && !existing.AcquisitionJournalNo) {
    const journal = await saveAccountingJournal(env, { JournalNo: `SYS-AST-${safeDocumentId(assetId)}`, Date: payload.AcquisitionDate, Status: 'Posted',
      Description: `Asset acquisition: ${payload.Name}`, Reference: clean(body.Reference) || assetId, Source: 'Asset Acquisition', SourceId: assetId,
      RecordedBy: clean(body.RecordedBy), Lines: [
        { AccountCode: payload.AssetAccount, Debit: cost, Credit: 0, Description: payload.Name },
        { AccountCode: clean(body.PaymentAccount) || '1020', Debit: 0, Credit: cost, Description: clean(body.PaymentMethod) || 'Asset acquisition' }
      ] }, true);
    payload.AcquisitionJournalNo = journal.JournalNo;
  }
  await upsertDocument(env, 'accountingAssets', safeDocumentId(assetId), payload);
  await writeAccountingAudit(env, existing.AssetId ? 'UPDATE' : 'CREATE', 'Fixed Asset', assetId, body, payload.Name);
  return { ok: true, message: 'Fixed asset saved.', asset: payload };
}

async function postAccountingDepreciation(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const assetId = clean(body.AssetId || body.assetId);
  const asset = (await listCollection(env, 'accountingAssets')).find((row) => sameText(row.AssetId, assetId) || sameText(row.__id, safeDocumentId(assetId)));
  if (!asset || lower(asset.Status) !== 'active') { const err = new Error('Select an active fixed asset.'); err.status = 400; throw err; }
  const date = clean(body.Date) || nowIso().slice(0, 10);
  const period = date.slice(0, 7).replace('-', '');
  const remaining = Math.max(0, asMoneyNumber(asset.Cost) - asMoneyNumber(asset.ResidualValue) - asMoneyNumber(asset.AccumulatedDepreciation));
  const amount = Math.min(remaining, asMoneyNumber(body.Amount) || asMoneyNumber(asset.MonthlyDepreciation));
  if (amount <= 0) { const err = new Error('This asset is fully depreciated.'); err.status = 409; throw err; }
  const journalNo = `SYS-DEP-${safeDocumentId(assetId)}-${period}`;
  if ((await listCollection(env, 'accountingJournals')).some((row) => sameText(row.JournalNo, journalNo))) { const err = new Error('Depreciation was already posted for this asset and month.'); err.status = 409; throw err; }
  const journal = await saveAccountingJournal(env, { JournalNo: journalNo, Date: date, Status: 'Posted', Description: `Depreciation: ${asset.Name}`,
    Reference: assetId, Source: 'Depreciation', SourceId: assetId, RecordedBy: clean(body.RecordedBy), Lines: [
      { AccountCode: clean(asset.DepreciationExpenseAccount) || '6070', Debit: amount, Credit: 0, Description: asset.Name },
      { AccountCode: clean(asset.AccumulatedDepreciationAccount) || '1600', Debit: 0, Credit: amount, Description: asset.Name }
    ] }, true);
  const accumulated = asMoneyNumber(asset.AccumulatedDepreciation) + amount;
  const updated = { ...asset, AccumulatedDepreciation: accumulated, NetBookValue: Math.max(asMoneyNumber(asset.ResidualValue), asMoneyNumber(asset.Cost) - accumulated),
    LastDepreciationDate: date, UpdatedAt: nowIso() };
  await upsertDocument(env, 'accountingAssets', safeDocumentId(assetId), updated);
  await writeAccountingAudit(env, 'DEPRECIATE', 'Fixed Asset', assetId, body, `${date}: ${amount}`);
  return { ok: true, message: 'Depreciation posted.', asset: updated, journal };
}

async function saveAccountingAdjustment(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const adjustmentNo = clean(body.AdjustmentNo) || ledgerDocumentId('ADJ');
  const existing = (await listCollection(env, 'accountingAdjustments')).find((row) => sameText(row.AdjustmentNo, adjustmentNo) || sameText(row.__id, safeDocumentId(adjustmentNo))) || {};
  if (lower(existing.Status) === 'posted') { const err = new Error('Posted adjustments are immutable.'); err.status = 409; throw err; }
  const amount = asMoneyNumber(body.Amount);
  const type = clean(body.Type || 'Discount');
  const status = clean(body.Status || 'Draft');
  if (!clean(body.AccountRef) || amount <= 0 || !clean(body.Reason)) { const err = new Error('Account, amount, and reason are required.'); err.status = 400; throw err; }
  if (['approved', 'posted', 'rejected'].includes(lower(status))) await requireAccountingApprovalLimit(env, body, 'Concession', amount);
  const payload = { ...existing, AdjustmentNo: adjustmentNo, Date: clean(body.Date) || nowIso().slice(0, 10), Type: type, AccountRef: clean(body.AccountRef),
    DisplayName: clean(body.DisplayName), Amount: amount, Reason: clean(body.Reason), Reference: clean(body.Reference), PaymentAccount: clean(body.PaymentAccount) || '1020',
    Status: status, RequestedBy: existing.RequestedBy || clean(body.RecordedBy), RequestedAt: existing.RequestedAt || nowIso(), UpdatedAt: nowIso() };
  if (lower(status) === 'posted') {
    const isRefund = lower(type).includes('refund');
    const journal = await saveAccountingJournal(env, { JournalNo: `SYS-ADJ-${safeDocumentId(adjustmentNo)}`, Date: payload.Date, Status: 'Posted',
      Description: `${type}: ${payload.Reason}`, Reference: payload.Reference || adjustmentNo, Source: type, SourceId: adjustmentNo, RecordedBy: clean(body.RecordedBy), Lines: [
        { AccountCode: '4100', Debit: amount, Credit: 0, Description: payload.Reason },
        { AccountCode: isRefund ? payload.PaymentAccount : '1100', Debit: 0, Credit: amount, Description: payload.AccountRef }
      ] }, true);
    payload.JournalNo = journal.JournalNo; payload.PostedAt = nowIso(); payload.PostedBy = clean(body.RecordedBy);
  }
  await upsertDocument(env, 'accountingAdjustments', safeDocumentId(adjustmentNo), payload);
  await writeAccountingAudit(env, existing.AdjustmentNo ? 'UPDATE' : 'CREATE', 'Concession/Refund', adjustmentNo, body, status);
  return { ok: true, message: `${type} saved as ${status}.`, adjustment: payload };
}

function ageBucket(days) {
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

function buildAgeing(rows, asOf, kind) {
  const asOfMs = timestampMs(asOf || nowIso());
  return rows.map((row) => {
    const balance = kind === 'receivable' ? asMoneyNumber(row.Balance ?? row.BalanceAmount) : Math.max(0, asMoneyNumber(row.Amount) - asMoneyNumber(row.PaidAmount));
    const date = clean(row.DueDate || row.Date || row.CreatedAt);
    const days = date ? Math.max(0, Math.floor((asOfMs - timestampMs(date)) / 86400000)) : 0;
    return { Reference: clean(row.InvoiceId || row.BillNo || row.__id), Party: clean(row.DisplayName || row.AccountRef || row.VendorName || row.VendorId),
      Date: date, DueDate: clean(row.DueDate), Amount: asMoneyNumber(row.Debit || row.Amount), PaidAmount: asMoneyNumber(row.Credit || row.PaidAmount), Balance: balance,
      DaysOutstanding: days, Bucket: ageBucket(days), AcademicSession: clean(row.AcademicSession), Term: clean(row.Term) };
  }).filter((row) => row.Balance > 0.005);
}

export function buildReceivablesAgeing(invoices, payments, asOf) {
  const billingIdentity = (row) => referenceIdentityKey(row.ApplicationReference || row.ApplicationID || row.AccountRef);
  const specificKeyFor = (row) => [billingIdentity(row), row.FeeCode, row.AcademicSession, row.Term].map((value) => lower(value)).join('|');
  const generalKeyFor = (row) => [billingIdentity(row), row.AcademicSession, row.Term].map((value) => lower(value)).join('|');
  const specificAvailable = new Map();
  const generalAvailable = new Map();
  payments.map(normalizePayment).forEach((row) => {
    if (lower(row.Status) && !['paid', 'success', 'successful', 'completed'].includes(lower(row.Status))) return;
    if (isWalletLedger(row) || isStorePurchase(row)) return;
    const amount = paymentCreditedAmount(row);
    const isGeneralSchoolCredit = isSchoolFeesTotalPayment(row) || isAcceptanceFeeLike(row);
    const pool = isGeneralSchoolCredit ? generalAvailable : specificAvailable;
    const key = isGeneralSchoolCredit ? generalKeyFor(row) : specificKeyFor(row);
    pool.set(key, asMoneyNumber((pool.get(key) || 0) + amount));
  });
  const consume = (pool, key, wanted) => {
    const available = pool.get(key) || 0;
    const used = Math.min(Math.max(0, wanted), available);
    pool.set(key, asMoneyNumber(available - used));
    return used;
  };
  const rows = invoices.map(normalizeInvoice).sort((a, b) => timestampMs(a.Date || a.CreatedAt) - timestampMs(b.Date || b.CreatedAt)).map((row) => {
    const amount = asMoneyNumber(row.Debit || row.Amount);
    const storedPaid = Math.min(amount, asMoneyNumber(row.Credit || row.PaidAmount));
    const specificKey = specificKeyFor(row);
    const generalKey = generalKeyFor(row);
    let representedStored = consume(specificAvailable, specificKey, storedPaid);
    representedStored += consume(generalAvailable, generalKey, storedPaid - representedStored);
    let allocated = storedPaid;
    allocated += consume(specificAvailable, specificKey, amount - allocated);
    allocated += consume(generalAvailable, generalKey, amount - allocated);
    allocated = Math.min(amount, asMoneyNumber(allocated));
    return { ...row, Amount: amount, PaidAmount: allocated, Balance: Math.max(0, amount - allocated) };
  });
  return buildAgeing(rows, asOf, 'receivable');
}

async function importAccountingBankStatement(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const bankId = clean(body.BankId || body.bankId);
  const accountCode = clean(body.AccountCode || body.accountCode) || '1020';
  const rows = Array.isArray(body.Rows || body.rows) ? (body.Rows || body.rows) : [];
  if (!bankId || !rows.length) { const err = new Error('Bank account and statement rows are required.'); err.status = 400; throw err; }
  const journals = await listCollection(env, 'accountingJournals');
  const cashMovements = [];
  journals.filter((j) => lower(j.Status) === 'posted').forEach((journal) => accountingLines(journal.Lines).filter((line) => clean(line.AccountCode) === accountCode).forEach((line) => {
    cashMovements.push({ JournalNo: clean(journal.JournalNo), Date: clean(journal.Date).slice(0, 10), Reference: clean(journal.Reference),
      Amount: asMoneyNumber(line.Debit) - asMoneyNumber(line.Credit), Description: clean(journal.Description) });
  }));
  let imported = 0; let matched = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const date = clean(row.Date || row.date).slice(0, 10);
    const reference = clean(row.Reference || row.reference || row.TransactionId || row.transactionId);
    const debit = asMoneyNumber(row.Debit || row.debit || row.Withdrawal || row.withdrawal);
    const credit = asMoneyNumber(row.Credit || row.credit || row.Deposit || row.deposit);
    const amount = credit - debit;
    if (!date || Math.abs(amount) <= 0.005) continue;
    const id = safeDocumentId(`${bankId}-${date}-${reference || index}-${amount.toFixed(2)}`);
    const exact = cashMovements.find((move) => Math.abs(move.Amount - amount) <= 0.005 && ((reference && sameText(move.Reference, reference)) || (!reference && move.Date === date)));
    const payload = { StatementItemId: id, BankId: bankId, AccountCode: accountCode, Date: date, Reference: reference,
      Description: clean(row.Description || row.description || row.Narration || row.narration), Debit: debit, Credit: credit, Amount: amount,
      Status: exact ? 'Matched' : 'Unmatched', MatchedJournalNo: exact ? exact.JournalNo : '', ImportedAt: nowIso(), ImportedBy: clean(body.RecordedBy) };
    await upsertDocument(env, 'accountingBankStatementItems', id, payload);
    imported += 1; if (exact) matched += 1;
  }
  await writeAccountingAudit(env, 'IMPORT', 'Bank Statement', bankId, body, `${imported} rows; ${matched} matched`);
  return { ok: true, message: `Imported ${imported} statement row(s); ${matched} matched automatically.`, imported, matched };
}

async function matchAccountingBankStatement(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const itemId = clean(body.StatementItemId);
  const journalNo = clean(body.JournalNo);
  const item = (await listCollection(env, 'accountingBankStatementItems')).find((row) => sameText(row.StatementItemId, itemId) || sameText(row.__id, safeDocumentId(itemId)));
  const journal = (await listCollection(env, 'accountingJournals')).find((row) => sameText(row.JournalNo, journalNo));
  if (!item || !journal) { const err = new Error('Statement item or journal was not found.'); err.status = 404; throw err; }
  const cashMovement = accountingLines(journal.Lines).filter((line) => sameText(line.AccountCode, item.AccountCode))
    .reduce((sum, line) => sum + asMoneyNumber(line.Debit) - asMoneyNumber(line.Credit), 0);
  if (Math.abs(cashMovement - asMoneyNumber(item.Amount)) > 0.005) {
    const err = new Error('The selected journal cash movement does not match the statement amount.'); err.status = 409; throw err;
  }
  const updated = { ...item, Status: 'Matched', MatchedJournalNo: journalNo, MatchedAt: nowIso(), MatchedBy: clean(body.RecordedBy) };
  await upsertDocument(env, 'accountingBankStatementItems', safeDocumentId(itemId), updated);
  await writeAccountingAudit(env, 'MATCH', 'Bank Statement Item', itemId, body, journalNo);
  return { ok: true, message: 'Statement item matched.', item: updated };
}

function accountingFilter(body = {}) {
  const financialYear = clean(body.FinancialYear || body.financialYear);
  return {
    DateFrom: clean(body.DateFrom || body.dateFrom) || (financialYear ? `${financialYear}-01-01` : ''),
    DateTo: clean(body.DateTo || body.dateTo) || (financialYear ? `${financialYear}-12-31` : ''),
    FinancialYear: financialYear,
    AcademicSession: clean(body.AcademicSession || body.academicSession),
    Term: clean(body.Term || body.term),
    Department: clean(body.Department || body.department)
  };
}

function accountingRowMatches(row, filter, includeBeforeStart = false) {
  const date = clean(row.Date || row.date || row.CreatedAt).slice(0, 10);
  if (!includeBeforeStart && filter.DateFrom && date && date < filter.DateFrom) return false;
  if (filter.DateTo && date && date > filter.DateTo) return false;
  if (!includeBeforeStart && filter.FinancialYear && date && !date.startsWith(filter.FinancialYear)) return false;
  if (filter.AcademicSession && clean(row.AcademicSession) && !sameText(row.AcademicSession, filter.AcademicSession)) return false;
  if (filter.Term && clean(row.Term) && !sameText(row.Term, filter.Term)) return false;
  if (filter.Department && !sameText(row.Department, filter.Department) && !accountingLines(row.Lines).some((line) => sameText(line.Department, filter.Department))) return false;
  return true;
}

function aggregateAccountingBalances(chart, journals) {
  const accounts = new Map(chart.map((row) => [clean(row.Code || row.code || row.__id), row]));
  const balances = new Map();
  journals.filter((row) => lower(row.Status || row.status) === 'posted').forEach((journal) => accountingLines(journal.Lines || journal.lines).forEach((line) => {
    const code = clean(line.AccountCode || line.accountCode);
    const item = balances.get(code) || { AccountCode: code, Debit: 0, Credit: 0, Balance: 0 };
    item.Debit += asMoneyNumber(line.Debit || line.debit);
    item.Credit += asMoneyNumber(line.Credit || line.credit);
    item.Balance = item.Debit - item.Credit;
    balances.set(code, item);
  }));
  return Array.from(balances.values()).map((item) => ({
    ...item, AccountName: clean((accounts.get(item.AccountCode) || {}).Name),
    Type: clean((accounts.get(item.AccountCode) || {}).Type), Group: clean((accounts.get(item.AccountCode) || {}).Group)
  })).sort((a, b) => a.AccountCode.localeCompare(b.AccountCode));
}

function isCashAndBankAccount(row) {
  if (!row) return false;
  const code = clean(row.AccountCode);
  const type = lower(row.Type);
  const group = lower(clean(row.Group));
  const name = clean(row.AccountName).toLowerCase();
  if (['1010', '1020', '1030'].includes(code)) return true;
  if (group === 'cash and bank') return true;
  return type === 'asset' && (name.includes('cash') || name.includes('bank'));
}

function calculateCashPosition(rows) {
  return (rows || []).filter(isCashAndBankAccount).reduce((sum, row) => sum + row.Debit - row.Credit, 0);
}

export function buildBudgetVsActual(budgets, journals, filter = {}) {
  const availableYears = (budgets || []).map((row) => clean(row.FinancialYear)).filter(Boolean).sort();
  const effectiveYear = clean(filter.FinancialYear) || availableYears[availableYears.length - 1] || '';
  const selectedBudgets = (budgets || []).filter((row) =>
    (!effectiveYear || sameText(row.FinancialYear, effectiveYear)) &&
    (!filter.AcademicSession || sameText(row.AcademicSession, filter.AcademicSession)) &&
    (!filter.Term || sameText(row.Term, filter.Term)) &&
    (!filter.Department || sameText(row.Department, filter.Department))
  );
  const actualByDepartment = new Map();
  const actualByAccount = new Map();
  (journals || []).filter((journal) => {
    if (lower(journal.Status) !== 'posted') return false;
    const date = clean(journal.Date).slice(0, 10);
    if (effectiveYear && date && !date.startsWith(effectiveYear)) return false;
    return accountingRowMatches(journal, { ...filter, FinancialYear: effectiveYear }, false);
  }).forEach((journal) => accountingLines(journal.Lines).forEach((line) => {
    const accountCode = clean(line.AccountCode);
    const department = clean(line.Department || journal.Department);
    const amount = asMoneyNumber(line.Debit) - asMoneyNumber(line.Credit);
    const departmentKey = `${lower(department)}|${lower(accountCode)}`;
    actualByDepartment.set(departmentKey, asMoneyNumber((actualByDepartment.get(departmentKey) || 0) + amount));
    actualByAccount.set(lower(accountCode), asMoneyNumber((actualByAccount.get(lower(accountCode)) || 0) + amount));
  }));
  const grouped = new Map();
  selectedBudgets.forEach((budget) => {
    const key = [budget.FinancialYear, budget.Department, budget.AccountCode].map(lower).join('|');
    const item = grouped.get(key) || { ...budget, Amount: 0 };
    item.Amount = asMoneyNumber(item.Amount + asMoneyNumber(budget.Amount));
    grouped.set(key, item);
  });
  return Array.from(grouped.values()).map((budget) => {
    const department = clean(budget.Department);
    const accountCode = clean(budget.AccountCode);
    const actual = department
      ? (actualByDepartment.get(`${lower(department)}|${lower(accountCode)}`) || 0)
      : (actualByAccount.get(lower(accountCode)) || 0);
    return { ...budget, Actual: asMoneyNumber(actual), Variance: asMoneyNumber(asMoneyNumber(budget.Amount) - actual) };
  });
}

export function buildAccountingReport(chart, journals, expenses, budgets, filter = {}, invoices = []) {
  const periodJournals = journals.filter((row) => accountingRowMatches(row, filter, false));
  const asOfJournals = journals.filter((row) => accountingRowMatches(row, filter, true));
  const trialBalance = aggregateAccountingBalances(chart, periodJournals);
  const asOfTrialBalance = aggregateAccountingBalances(chart, asOfJournals);
  const revenueRows = trialBalance.filter((row) => lower(row.Type) === 'revenue');
  const grossRevenue = revenueRows.filter((row) => clean(row.Group) === 'Operating Revenue').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const otherIncome = revenueRows.filter((row) => clean(row.Group) === 'Other Income').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const concessions = revenueRows.filter((row) => row.AccountCode === '4100').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const netRevenue = grossRevenue - concessions;
  const totalIncome = netRevenue + otherIncome;
  const expenseRows = trialBalance.filter((row) => lower(row.Type) === 'expense');
  const directCosts = expenseRows.filter((row) => clean(row.Group) === 'Direct Cost').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const totalExpenses = expenseRows.reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const assets = asOfTrialBalance.filter((row) => lower(row.Type) === 'asset').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const liabilities = asOfTrialBalance.filter((row) => lower(row.Type) === 'liability').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const equity = asOfTrialBalance.filter((row) => lower(row.Type) === 'equity').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const cashPosition = calculateCashPosition(asOfTrialBalance);
  const receivables = asOfTrialBalance.filter((row) => row.AccountCode === '1100').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const outstandingInvoiceReceivables = (Array.isArray(invoices) ? invoices : []).map(normalizeInvoice).filter((invoice) => {
    if (!accountingRowMatches(invoice, filter, true)) return false;
    const outstanding = Math.max(0, asMoneyNumber(invoice.Balance) || Math.max(0, asMoneyNumber(invoice.Debit) - asMoneyNumber(invoice.Credit)));
    return outstanding > 0.005;
  }).reduce((sum, invoice) => sum + Math.max(0, asMoneyNumber(invoice.Balance) || Math.max(0, asMoneyNumber(invoice.Debit) - asMoneyNumber(invoice.Credit)), 0), 0);
  const resolvedReceivables = Math.max(0, receivables > 0.005 ? receivables : outstandingInvoiceReceivables);
  const filteredExpenses = expenses.filter((row) => accountingRowMatches(row, filter));
  const budgetVsActual = buildBudgetVsActual(budgets, periodJournals, filter);
  const postedExpense = filteredExpenses.filter((row) => ['posted', 'paid'].includes(lower(row.Status))).reduce((sum, row) => sum + asMoneyNumber(row.Amount), 0);
  const budgetTotal = budgetVsActual.reduce((sum, row) => sum + asMoneyNumber(row.Amount), 0);
  const budgetActual = budgetVsActual.reduce((sum, row) => sum + asMoneyNumber(row.Actual), 0);
  return {
    dashboard: { GrossRevenue: grossRevenue, OtherIncome: otherIncome, Concessions: concessions, NetRevenue: netRevenue, TotalIncome: totalIncome, DirectCosts: directCosts,
      GrossSurplus: netRevenue - directCosts, TotalExpenditure: totalExpenses, NetSurplus: totalIncome - totalExpenses,
      Assets: assets, Liabilities: liabilities, Equity: equity, PostedExpenses: postedExpense, BudgetTotal: budgetTotal,
      CashPosition: cashPosition, Receivables: resolvedReceivables, BudgetRemaining: asMoneyNumber(budgetTotal - budgetActual) },
    filter, trialBalance, asOfTrialBalance, budgetVsActual,
    incomeStatement: { revenue: revenueRows, expenses: expenseRows },
    balanceSheet: { assets: asOfTrialBalance.filter((r) => lower(r.Type) === 'asset'), liabilities: asOfTrialBalance.filter((r) => lower(r.Type) === 'liability'), equity: asOfTrialBalance.filter((r) => lower(r.Type) === 'equity') }
  };
}

export function buildGatewayCollectionsReport(formSales = [], gatewayCharges = [], filter = {}) {
  const charges = gatewayCharges.filter((row) => accountingRowMatches(row, filter)).map((row) => ({
    Date: clean(row.Date || row.CreatedAt).slice(0, 10),
    Reference: clean(row.Reference || row.ChargeId || row.__id),
    Source: clean(row.Source) || 'Paystack',
    Description: clean(row.Description),
    GrossCollection: asMoneyNumber(row.GrossCollection),
    PaystackCharge: asMoneyNumber(row.Amount),
    NetSettlement: asMoneyNumber(row.NetSettlement),
    Treatment: clean(row.Treatment),
    Status: clean(row.Status)
  }));
  const sales = formSales.filter((row) => accountingRowMatches({
    ...row,
    Date: row.PaymentDate || row.Date || row.Time || row.CreatedAt
  }, filter)).map((row) => {
    const amounts = formSaleFinancialAmounts(row);
    return {
      Date: clean(row.PaymentDate || row.Date || row.Time || row.CreatedAt).slice(0, 10),
      ReceiptNo: clean(row.ReceiptNo || row.ReceiptNumber || row.__id),
      ApplicantName: clean(row.ApplicantName || row.DisplayName),
      PaymentMethod: clean(row.PaymentMethod || row.Method || row.Gateway),
      Reference: clean(row.PaymentReference || row.Reference),
      GrossCollection: amounts.GrossAmount,
      PaystackCharge: amounts.GatewayFee,
      NetRevenue: amounts.RecognizedAmount,
      Currency: clean(row.Currency) || 'NGN'
    };
  });
  const total = (rows, key) => asMoneyNumber(rows.reduce((sum, row) => sum + asMoneyNumber(row[key]), 0));
  const formCharges = charges.filter((row) => lower(row.Source).includes('form'));
  const feeCharges = charges.filter((row) => !lower(row.Source).includes('form'));
  return {
    summary: {
      GrossCollections: total(charges, 'GrossCollection'),
      PaystackCharges: total(charges, 'PaystackCharge'),
      NetSettlements: total(charges, 'NetSettlement'),
      FormSalesGross: total(sales, 'GrossCollection'),
      FormSalesCharges: total(sales, 'PaystackCharge'),
      FormSalesNet: total(sales, 'NetRevenue'),
      FeePaymentCharges: total(feeCharges, 'PaystackCharge'),
      FormPaymentCharges: total(formCharges, 'PaystackCharge')
    },
    formSales: sales.sort((a, b) => clean(b.Date).localeCompare(clean(a.Date))),
    gatewayCharges: charges.sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)))
  };
}

async function getAccountingOverview(env, body = {}) {
  if (isDepartmentAccountingUser(body)) {
    const department = accountingDepartment(body);
    if (!department) { const err = new Error('A department must be assigned to this user.'); err.status = 403; throw err; }
    await seedAccountingChart(env);
    const [chart, expenses, budgets, vendors, supplierBills] = await Promise.all([
      listCollection(env, 'chartOfAccounts'), listCollection(env, 'accountingExpenses'), listCollection(env, 'accountingBudgets'),
      listCollection(env, 'accountingVendors'), listCollection(env, 'accountingSupplierBills')
    ]);
    return {
      ok: true, message: `${department} requisitions and bills loaded.`, synchronized: 0,
      chart, expenses: expenses.filter((row) => sameText(row.Department, department)),
      budgets: budgets.filter((row) => sameText(row.Department, department)), vendors,
      supplierBills: supplierBills.filter((row) => sameText(row.Department, department)),
      journals: [], banks: [], reconciliations: [], periods: [], audit: [], supplierPayments: [], assets: [], adjustments: [],
      approvalLimits: [], closeChecklist: [], bankStatementItems: [], reports: {}
    };
  }
  // Keep the overview read-only. Revenue synchronization and accounting setup
  // can perform many Firestore reads/writes and previously ran on every refresh,
  // causing Cloudflare Workers to exceed their per-request subrequest quota.
  // Administrators can still run the explicit "Synchronize Revenue" action.
  const synchronized = 0;
  const [chart, journals, expenses, budgets, banks, reconciliations, periods, audit, vendors, supplierBills, supplierPayments, assets, adjustments, approvalLimits, closeChecklist, bankStatementItems, invoices, payments, formSales, gatewayCharges, payrollProfiles, payrollRuns, payrollItems, payrollPayments, payrollAudit, payrollTaxProfiles, payrollTaxOverrides, payrollSalaryComponents, payrollTaxBands, payrollTaxReliefs, payrollLedgerMappings] = await Promise.all([
    listCollection(env, 'chartOfAccounts'), listCollection(env, 'accountingJournals'), listCollection(env, 'accountingExpenses'),
    listCollection(env, 'accountingBudgets'), listCollection(env, 'accountingBanks'), listCollection(env, 'accountingReconciliations'),
    listCollection(env, 'accountingPeriods'), listCollection(env, 'accountingAudit'), listCollection(env, 'accountingVendors'),
    listCollection(env, 'accountingSupplierBills'), listCollection(env, 'accountingSupplierPayments'), listCollection(env, 'accountingAssets'),
    listCollection(env, 'accountingAdjustments'), listCollection(env, 'accountingApprovalLimits'), listCollection(env, 'accountingCloseChecklist'),
    listCollection(env, 'accountingBankStatementItems'), listCollection(env, 'invoices'), listCollection(env, 'payments'),
    listCollection(env, 'formSales').catch(() => []), listCollection(env, 'paymentGatewayCharges').catch(() => []),
    listCollection(env, 'payrollProfiles'), listCollection(env, 'payrollRuns'), listCollection(env, 'payrollItems'),
    listCollection(env, 'payrollPayments'), listCollection(env, 'payrollAudit'), listCollection(env, PAYROLL_TAX_COLLECTIONS.profiles).catch(() => []), listCollection(env, PAYROLL_TAX_COLLECTIONS.overrides).catch(() => []),
    listCollection(env, PAYROLL_TAX_COLLECTIONS.components).catch(() => []), listCollection(env, PAYROLL_TAX_COLLECTIONS.bands).catch(() => []),
    listCollection(env, PAYROLL_TAX_COLLECTIONS.reliefs).catch(() => []), listCollection(env, PAYROLL_TAX_COLLECTIONS.mappings).catch(() => [])
  ]);
  const filter = accountingFilter(body);
  const finalizedPayrollRunIds = new Set(payrollRuns.filter((row) => ['approved', 'posted', 'part paid', 'paid', 'finalized'].includes(lower(row.Status))).map((row) => lower(row.RunId)));
  const taxProfileUsage = {};
  payrollItems.filter((row) => finalizedPayrollRunIds.has(lower(row.RunId))).forEach((row) => { const id = clean(row.TaxProfileId || row.ConfigurationSnapshot?.TaxProfile?.ProfileId); if (id) taxProfileUsage[id] = (taxProfileUsage[id] || 0) + 1; });
  const payrollTaxProfilesWithUsage = payrollTaxProfiles.map((row) => ({ ...row, UsageCount: taxProfileUsage[clean(row.ProfileId || row.__id)] || 0 }));
  const reports = buildAccountingReport(chart, journals, expenses, budgets, filter, invoices);
  reports.receivablesAgeing = buildReceivablesAgeing(invoices, payments, filter.DateTo || nowIso().slice(0, 10));
  reports.payablesAgeing = buildAgeing(supplierBills, filter.DateTo || nowIso().slice(0, 10), 'payable');
  const gatewayReport = buildGatewayCollectionsReport(formSales, gatewayCharges, filter);
  return { ok: true, message: 'Finance and accounting records loaded.', synchronized, filter, chart, journals, expenses, budgets, banks, reconciliations, periods, audit,
    vendors, supplierBills, supplierPayments, assets, adjustments, approvalLimits, closeChecklist, bankStatementItems,
    payrollProfiles, payrollRuns, payrollItems, payrollPayments, payrollAudit, payrollTaxProfiles: payrollTaxProfilesWithUsage, payrollTaxOverrides,
    payrollSalaryComponents, payrollTaxBands, payrollTaxReliefs, payrollLedgerMappings, gatewayReport, reports };
}

function payrollComponents(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (_err) {
      // CSV imports use the friendlier "Housing=5000; Transport=2000" format.
    }
    return value.replace(/\r?\n/g, ';').split(';').map((part) => {
      const text = clean(part);
      if (!text) return null;
      const separator = text.includes('=') ? '=' : ':';
      const pieces = text.split(separator);
      if (pieces.length < 2) return null;
      return { Name: clean(pieces.shift()), Amount: asMoneyNumber(pieces.join(separator)) };
    }).filter(Boolean);
  }
  return [];
}

function normalizedPayrollComponents(value) {
  return payrollComponents(value).map((row) => ({
    Name: clean(row.Name || row.name || row.Label || row.label),
    Amount: asMoneyNumber(row.Amount || row.amount)
  })).filter((row) => row.Name && row.Amount > 0);
}

function normalizedComponentAssignments(value) {
  let source = value;
  if (typeof source === 'string' && clean(source)) {
    try { source = JSON.parse(source); } catch (_err) { source = []; }
  }
  return (Array.isArray(source) ? source : []).map((row) => ({
    ComponentId: clean(row.ComponentId || row.componentId), Code: clean(row.Code || row.code).toUpperCase(),
    Amount: asMoneyNumber(row.Amount ?? row.amount), CalculationType: clean(row.CalculationType || row.calculationType),
    PercentageRate: asMoneyNumber(row.PercentageRate ?? row.percentageRate), PercentageBase: clean(row.PercentageBase || row.percentageBase),
    Formula: clean(row.Formula || row.formula)
  })).filter((row) => row.ComponentId || row.Code);
}

function payrollTotal(value) {
  return normalizedPayrollComponents(value).reduce((sum, row) => sum + row.Amount, 0);
}

async function writePayrollAudit(env, action, entityType, entityId, body, details = '') {
  const auditId = ledgerDocumentId('PAYAUD');
  await upsertDocument(env, 'payrollAudit', safeDocumentId(auditId), {
    AuditId: auditId, Timestamp: nowIso(), Action: clean(action), EntityType: clean(entityType), EntityId: clean(entityId),
    UserRole: clean(body.UserRole || body.userRole), UserName: clean(body.RecordedBy || body.UpdatedBy), Details: clean(details)
  });
}

async function savePayrollProfile(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const employeeId = clean(body.EmployeeId || body.employeeId) || ledgerDocumentId('EMP');
  const profiles = await listCollection(env, 'payrollProfiles');
  const existing = profiles.find((row) => sameText(row.EmployeeId, employeeId) || sameText(row.__id, safeDocumentId(employeeId))) || {};
  const username = clean(body.Username || body.username);
  const displayName = clean(body.DisplayName || body.displayName || body.Name);
  const basicSalary = asMoneyNumber(body.BasicSalary || body.basicSalary);
  if (!username || !displayName || basicSalary < 0) {
    const err = new Error('Staff username, display name, and a valid basic salary are required.'); err.status = 400; throw err;
  }
  if (profiles.some((row) => !sameText(row.EmployeeId, employeeId) && sameText(row.Username, username))) {
    const err = new Error('That staff username is already linked to another payroll profile.'); err.status = 409; throw err;
  }
  const payload = {
    ...existing, EmployeeId: employeeId, Username: username, DisplayName: displayName,
    Department: clean(body.Department), Position: clean(body.Position), EmploymentType: clean(body.EmploymentType) || 'Permanent',
    BasicSalary: basicSalary, Allowances: normalizedPayrollComponents(body.Allowances), Deductions: normalizedPayrollComponents(body.Deductions),
    PensionRate: Math.min(100, Math.max(0, asMoneyNumber(body.PensionRate))), TaxRate: Math.min(100, Math.max(0, asMoneyNumber(body.TaxRate))),
    CalculationMode: clean(body.CalculationMode || existing.CalculationMode || 'LEGACY_FLAT_RATE').toUpperCase(),
    ComponentAssignments: body.ComponentAssignments === undefined ? (existing.ComponentAssignments || []) : normalizedComponentAssignments(body.ComponentAssignments),
    TaxStatus: clean(body.TaxStatus || existing.TaxStatus || 'TAXABLE').toUpperCase(), TaxJurisdiction: clean(body.TaxJurisdiction || existing.TaxJurisdiction || 'FCT'),
    TaxProfileId: clean(body.TaxProfileId ?? existing.TaxProfileId), TIN: clean(body.TIN ?? existing.TIN),
    PensionParticipating: yesNo(body.PensionParticipating ?? existing.PensionParticipating ?? (asMoneyNumber(body.PensionRate) > 0 ? 'YES' : 'NO')),
    PensionRateOverride: Math.min(100, Math.max(0, asMoneyNumber(body.PensionRateOverride ?? existing.PensionRateOverride))), PensionScheme: clean(body.PensionScheme ?? existing.PensionScheme),
    NhfParticipating: yesNo(body.NhfParticipating ?? existing.NhfParticipating ?? 'NO'), NhfRate: Math.min(100, Math.max(0, asMoneyNumber(body.NhfRate ?? existing.NhfRate))),
    AdditionalReliefs: Array.isArray(body.AdditionalReliefs) ? body.AdditionalReliefs : (existing.AdditionalReliefs || []),
    BeginningYearCumulative: body.BeginningYearCumulative && typeof body.BeginningYearCumulative === 'object' ? body.BeginningYearCumulative : (existing.BeginningYearCumulative || {}),
    BankName: clean(body.BankName), AccountName: clean(body.AccountName), AccountNumber: clean(body.AccountNumber),
    SalaryExpenseAccount: clean(body.SalaryExpenseAccount) || '6000', Active: yesNo(body.Active ?? 'YES') || 'YES',
    Notes: clean(body.Notes), CreatedAt: existing.CreatedAt || nowIso(), CreatedBy: existing.CreatedBy || clean(body.RecordedBy),
    UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy)
  };
  if (!['LEGACY_FLAT_RATE', 'CONFIGURABLE_PAYE'].includes(payload.CalculationMode)) { const err = new Error('Choose Legacy Flat Rate or Configurable PAYE calculation mode.'); err.status = 400; throw err; }
  if (!['TAXABLE', 'EXEMPT', 'TAX_EXEMPT'].includes(payload.TaxStatus)) { const err = new Error('Choose a valid employee tax status.'); err.status = 400; throw err; }
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, 'payrollProfiles', safeDocumentId(employeeId), payload);
  await writePayrollAudit(env, existing.EmployeeId ? 'UPDATE' : 'CREATE', 'Payroll Profile', employeeId, body, displayName);
  return { ok: true, message: 'Payroll profile saved.', profile: payload };
}

async function createPayrollProfilesFromStaff(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const [staffUsers, profiles] = await Promise.all([
    listCollection(env, 'staffUsers'),
    listCollection(env, 'payrollProfiles')
  ]);
  const existingUsernames = new Set(profiles.map((row) => lower(row.Username)).filter(Boolean));
  let created = 0; let skipped = 0; const failures = [];
  for (const staff of staffUsers) {
    const username = clean(staff.Username || staff.__id);
    if (!username || yesNo(staff.Active ?? 'YES') !== 'YES' || existingUsernames.has(lower(username))) {
      skipped += 1;
      continue;
    }
    try {
      await savePayrollProfile(env, {
        ...body,
        EmployeeId: ledgerDocumentId('EMP'),
        Username: username,
        DisplayName: clean(staff.DisplayName) || username,
        Department: clean(staff.Department),
        Position: clean(staff.Position),
        EmploymentType: clean(staff.EmploymentType) || 'Permanent',
        BasicSalary: 0,
        Active: 'YES',
        Notes: 'Created from staff account; complete salary and bank details before payroll generation.'
      });
      existingUsernames.add(lower(username));
      created += 1;
    } catch (error) {
      failures.push({ username, message: error.message || String(error) });
    }
  }
  await writePayrollAudit(env, 'BULK CREATE FROM STAFF', 'Payroll Profiles', 'staffUsers', body,
    `${created} created; ${skipped} skipped; ${failures.length} failed`);
  return {
    ok: true,
    message: `${created} payroll profile(s) created from active staff accounts; ${skipped} already linked or inactive${failures.length ? `; ${failures.length} failed` : ''}.`,
    created, skipped, failures
  };
}

async function importPayrollProfiles(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const rows = Array.isArray(body.Profiles || body.profiles) ? (body.Profiles || body.profiles).slice(0, 500) : [];
  if (!rows.length) { const err = new Error('Choose a payroll CSV containing at least one profile row.'); err.status = 400; throw err; }
  const updateExisting = yesNo(body.UpdateExisting ?? body.updateExisting ?? 'YES') === 'YES';
  const profiles = await listCollection(env, 'payrollProfiles');
  const byUsername = new Map(profiles.map((row) => [lower(row.Username), row]).filter(([username]) => username));
  const byEmployeeId = new Map(profiles.map((row) => [lower(row.EmployeeId), row]).filter(([employeeId]) => employeeId));
  const seenUsernames = new Set();
  let created = 0; let updated = 0; let skipped = 0; const failures = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const username = clean(row.Username || row.username);
    const existing = byUsername.get(lower(username));
    const requestedEmployeeId = clean(row.EmployeeId || row.employeeId);
    const employeeIdOwner = byEmployeeId.get(lower(requestedEmployeeId));
    if (seenUsernames.has(lower(username))) {
      failures.push({ row: index + 2, username, message: 'Duplicate username in this CSV.' });
      continue;
    }
    seenUsernames.add(lower(username));
    if (employeeIdOwner && !sameText(employeeIdOwner.Username, username)) {
      failures.push({ row: index + 2, username, message: `Employee ID ${requestedEmployeeId} belongs to another payroll profile.` });
      continue;
    }
    if (existing && !updateExisting) { skipped += 1; continue; }
    try {
      const result = await savePayrollProfile(env, {
        ...body,
        ...row,
        EmployeeId: clean(row.EmployeeId || row.employeeId || existing?.EmployeeId) || ledgerDocumentId('EMP'),
        Username: username
      });
      byUsername.set(lower(username), result.profile);
      byEmployeeId.set(lower(result.profile.EmployeeId), result.profile);
      if (existing) updated += 1; else created += 1;
    } catch (error) {
      failures.push({ row: index + 2, username, message: error.message || String(error) });
    }
  }
  await writePayrollAudit(env, 'BULK IMPORT', 'Payroll Profiles', 'CSV', body,
    `${created} created; ${updated} updated; ${skipped} skipped; ${failures.length} failed`);
  return {
    ok: true,
    message: `${created} payroll profile(s) created, ${updated} updated, ${skipped} skipped${failures.length ? `; ${failures.length} failed` : ''}.`,
    created, updated, skipped, failures
  };
}

async function requestPayrollTaxOverride(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const runId = clean(body.RunId); const employeeId = clean(body.EmployeeId); const reason = clean(body.Reason); const overridePaye = asMoneyNumber(body.OverridePaye);
  if (!runId || !employeeId || !reason || overridePaye < 0) { const err = new Error('Run, employee, non-negative override PAYE, and a reason are required.'); err.status = 400; throw err; }
  const [runs, items, overrides] = await Promise.all([listCollection(env, 'payrollRuns'), listCollection(env, 'payrollItems'), listCollection(env, PAYROLL_TAX_COLLECTIONS.overrides).catch(() => [])]);
  const run = runs.find((row) => sameText(row.RunId, runId));
  if (!run || !['draft', 'rejected'].includes(lower(run.Status))) { const err = new Error('Tax overrides can only be requested for Draft or Rejected payroll.'); err.status = 409; throw err; }
  const item = items.find((row) => sameText(row.RunId, runId) && sameText(row.EmployeeId, employeeId));
  if (!item || clean(item.CalculationMode).toUpperCase() !== 'CONFIGURABLE_PAYE') { const err = new Error('Generate configurable payroll for this employee before requesting an override.'); err.status = 409; throw err; }
  const overrideId = clean(body.OverrideId) || `TAXOVR-${safeDocumentId(runId)}-${safeDocumentId(employeeId)}`;
  const existing = overrides.find((row) => sameText(row.OverrideId || row.__id, overrideId)) || {};
  if (lower(existing.Status) === 'approved') { const err = new Error('An approved override is immutable. Request a supervised reversal before replacing it.'); err.status = 409; throw err; }
  const payload = { ...existing, OverrideId: overrideId, RunId: runId, EmployeeId: employeeId, ItemId: clean(item.ItemId), CalculatedPaye: asMoneyNumber(item.CalculatedPaye ?? item.TaxAmount),
    OverridePaye: overridePaye, Difference: overridePaye - asMoneyNumber(item.CalculatedPaye ?? item.TaxAmount), Reason: reason, Status: 'Pending',
    RequestedAt: nowIso(), RequestedBy: clean(body.RecordedBy), RequestedByRole: clean(body.UserRole), UpdatedAt: nowIso() };
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, PAYROLL_TAX_COLLECTIONS.overrides, safeDocumentId(overrideId), payload);
  await writePayrollAudit(env, 'REQUEST TAX OVERRIDE', 'Payroll Tax Override', overrideId, body, `${employeeId}: ${payload.CalculatedPaye} -> ${overridePaye}; ${reason}`);
  return { ok: true, message: 'PAYE override submitted for independent approval.', override: payload };
}

async function approvePayrollTaxOverride(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Management']);
  const overrideId = clean(body.OverrideId); const decision = clean(body.Decision || body.Status).toLowerCase();
  if (!overrideId || !['approved', 'rejected'].includes(decision)) { const err = new Error('Override ID and an Approved or Rejected decision are required.'); err.status = 400; throw err; }
  const overrides = await listCollection(env, PAYROLL_TAX_COLLECTIONS.overrides); const existing = overrides.find((row) => sameText(row.OverrideId || row.__id, overrideId));
  if (!existing) { const err = new Error('Tax override request was not found.'); err.status = 404; throw err; }
  if (lower(existing.Status) !== 'pending') { const err = new Error('Only a pending tax override can be decided.'); err.status = 409; throw err; }
  if (decision === 'approved' && sameText(existing.RequestedBy, body.RecordedBy)) { const err = new Error('The override requester cannot approve the same request.'); err.status = 403; throw err; }
  const runs = await listCollection(env, 'payrollRuns'); const run = runs.find((row) => sameText(row.RunId, existing.RunId));
  if (!run || !['draft', 'rejected'].includes(lower(run.Status))) { const err = new Error('The payroll is no longer editable, so this override cannot be decided.'); err.status = 409; throw err; }
  const updated = { ...existing, Status: decision === 'approved' ? 'Approved' : 'Rejected', DecisionReason: clean(body.DecisionReason || body.Reason),
    DecidedAt: nowIso(), DecidedBy: clean(body.RecordedBy), DecidedByRole: clean(body.UserRole), UpdatedAt: nowIso() };
  delete updated.__id; delete updated.__name;
  await upsertDocument(env, PAYROLL_TAX_COLLECTIONS.overrides, safeDocumentId(overrideId), updated);
  if (decision === 'approved') await upsertDocument(env, 'payrollRuns', run.__id || safeDocumentId(run.RunId), { ...run, RequiresRecalculation: 'YES', UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) });
  await writePayrollAudit(env, `${decision.toUpperCase()} TAX OVERRIDE`, 'Payroll Tax Override', overrideId, body, clean(updated.DecisionReason || `${existing.EmployeeId}: ${existing.OverridePaye}`));
  return { ok: true, message: decision === 'approved' ? 'PAYE override approved. Recalculate the draft payroll before submission.' : 'PAYE override rejected.', override: updated };
}

async function generatePayrollRun(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const month = clean(body.Month || body.month);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { const err = new Error('Payroll month must use a valid YYYY-MM format.'); err.status = 400; throw err; }
  const runId = clean(body.RunId) || `PAY-${month.replace('-', '')}`;
  const runs = await listCollection(env, 'payrollRuns');
  const existing = runs.find((row) => sameText(row.RunId, runId) || sameText(row.__id, safeDocumentId(runId))) || {};
  assertPayrollCanRegenerate(existing);
  const profiles = (await listCollection(env, 'payrollProfiles')).filter((row) => yesNo(row.Active ?? 'YES') === 'YES');
  if (!profiles.length) { const err = new Error('Create at least one active payroll profile first.'); err.status = 400; throw err; }
  const existingItems = (await listCollection(env, 'payrollItems')).filter((row) => sameText(row.RunId, runId));
  const usesConfigurablePaye = profiles.some((row) => clean(row.CalculationMode).toUpperCase() === 'CONFIGURABLE_PAYE');
  const configuration = usesConfigurablePaye ? await getPayrollTaxConfiguration(env) : null;
  const payrollDate = clean(body.PayDate) || `${month}-28`; const calculatedItems = []; const errors = [];
  let totalBasic = 0; let totalAllowances = 0; let totalGross = 0; let totalTaxable = 0; let totalPension = 0; let totalNhf = 0; let totalPaye = 0; let totalDeductions = 0; let totalNet = 0;
  for (const profile of profiles) {
    try {
      const configurable = clean(profile.CalculationMode).toUpperCase() === 'CONFIGURABLE_PAYE';
      const approvedOverride = configurable ? (configuration.overrides || []).find((row) => sameText(row.RunId, runId) && sameText(row.EmployeeId, profile.EmployeeId) && lower(row.Status) === 'approved') : null;
      const calculation = configurable ? calculateConfigurablePayroll({ employee: profile, configuration, payrollDate, approvedOverride }) : calculateLegacyPayroll(profile);
      const itemId = `${runId}-${clean(profile.EmployeeId)}`;
      const item = {
        ItemId: itemId, RunId: runId, Month: month, EmployeeId: clean(profile.EmployeeId), Username: clean(profile.Username),
        DisplayName: clean(profile.DisplayName), Department: clean(profile.Department), Position: clean(profile.Position), ...calculation,
        PaidAmount: 0, OutstandingAmount: calculation.NetPay, PaymentStatus: 'Unpaid', BankName: clean(profile.BankName),
        AccountName: clean(profile.AccountName), AccountNumber: clean(profile.AccountNumber), SalaryExpenseAccount: clean(profile.SalaryExpenseAccount) || '6000',
        GeneratedAt: nowIso(), GeneratedBy: clean(body.RecordedBy), RecalculatedFromDraft: existing.RunId ? 'YES' : 'NO'
      };
      calculatedItems.push(item); totalBasic += asMoneyNumber(item.BasicSalary); totalAllowances += asMoneyNumber(item.AllowanceTotal);
      totalGross += asMoneyNumber(item.GrossPay); totalTaxable += asMoneyNumber(item.TaxableEarnings ?? item.GrossPay); totalPension += asMoneyNumber(item.PensionAmount);
      totalNhf += asMoneyNumber(item.NhfAmount); totalPaye += asMoneyNumber(item.FinalPaye ?? item.TaxAmount); totalDeductions += asMoneyNumber(item.TotalDeductions); totalNet += asMoneyNumber(item.NetPay);
    } catch (error) { errors.push(`${clean(profile.DisplayName || profile.EmployeeId)}: ${error.message || error}`); }
  }
  if (errors.length) { const err = new Error(`Payroll calculation stopped. ${errors.join(' | ')}`); err.status = 400; err.code = 'PAYROLL_VALIDATION_FAILED'; throw err; }
  const currentIds = new Set(calculatedItems.map((item) => lower(item.ItemId)));
  for (const item of calculatedItems) await upsertDocument(env, 'payrollItems', safeDocumentId(item.ItemId), item);
  for (const item of existingItems) if (!currentIds.has(lower(item.ItemId))) await deleteDocument(env, 'payrollItems', item.__id || safeDocumentId(item.ItemId));
  const versions = [...new Set(calculatedItems.map((item) => clean(item.CalculationVersion)))];
  const taxProfileIds = [...new Set(calculatedItems.map((item) => clean(item.TaxProfileId)).filter(Boolean))];
  const warnings = calculatedItems.flatMap((item) => (item.CalculationWarnings || []).map((warning) => `${item.DisplayName}: ${warning}`));
  const run = {
    ...existing, RunId: runId, Month: month, PayDate: payrollDate, Description: clean(body.Description) || `Payroll for ${month}`,
    Status: 'Draft', EmployeeCount: profiles.length, TotalBasic: totalBasic, TotalAllowances: totalAllowances, TotalGross: totalGross,
    TotalTaxableEarnings: totalTaxable, TotalPension: totalPension, TotalNhf: totalNhf, TotalPaye: totalPaye,
    TotalDeductions: totalDeductions, TotalNet: totalNet, PaidAmount: 0, OutstandingAmount: totalNet,
    CalculationVersion: versions.length === 1 ? versions[0] : 'MIXED_LEGACY_AND_CONFIGURABLE_V1', TaxProfileIds: taxProfileIds,
    CalculationStatus: 'VALID', ValidationWarnings: warnings, RequiresRecalculation: 'NO', ConfigurationSnapshotVersion: 1,
    CreatedAt: existing.CreatedAt || nowIso(), CreatedBy: existing.CreatedBy || clean(body.RecordedBy), UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy)
  };
  await upsertDocument(env, 'payrollRuns', safeDocumentId(runId), run);
  await writePayrollAudit(env, existing.RunId ? 'REGENERATE' : 'GENERATE', 'Payroll Run', runId, body, `${profiles.length} staff; net ${totalNet}`);
  return { ok: true, message: `Payroll calculated for ${profiles.length} staff${usesConfigurablePaye ? ' using the configured PAYE engine where enabled' : ' using the legacy-compatible engine'}.`, run, warnings };
}

async function savePayrollRunStatus(env, body) {
  const requested = clean(body.Status || body.status);
  const runId = clean(body.RunId || body.runId);
  const runs = await listCollection(env, 'payrollRuns');
  const run = runs.find((row) => sameText(row.RunId, runId) || sameText(row.__id, safeDocumentId(runId)));
  if (!run) { const err = new Error('Payroll run was not found.'); err.status = 404; throw err; }
  const current = lower(run.Status);
  const target = lower(requested);
  const allowed = {
    draft: { submitted: ['Super Admin', 'Accounts Officer'] },
    rejected: { submitted: ['Super Admin', 'Accounts Officer'] },
    submitted: { approved: ['Super Admin', 'Management'], rejected: ['Super Admin', 'Management'] },
    approved: { posted: ['Super Admin', 'Accounts Officer'] }
  };
  const roles = allowed[current] && allowed[current][target];
  if (!roles) { const err = new Error(`Payroll cannot move from ${run.Status} to ${requested}.`); err.status = 409; throw err; }
  requireAccountingRole(body, roles);
  const runItems = (await listCollection(env, 'payrollItems')).filter((row) => sameText(row.RunId, runId));
  if (target === 'submitted') validatePayrollForSubmission(run, runItems);
  const updated = { ...run, Status: requested, UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) };
  if (target === 'submitted') { updated.SubmittedAt = nowIso(); updated.SubmittedBy = clean(body.RecordedBy); }
  if (target === 'approved') {
    const finalizedAt = nowIso(); updated.ApprovedAt = finalizedAt; updated.ApprovedBy = clean(body.RecordedBy); updated.FinalizedAt = finalizedAt; updated.FinalizedBy = clean(body.RecordedBy);
    updated.ConfigurationSnapshot = buildFinalizedRunSnapshot(run, runItems, clean(body.RecordedBy), finalizedAt);
    for (const item of runItems) await upsertDocument(env, 'payrollItems', item.__id || safeDocumentId(item.ItemId), { ...item, LockedAt: nowIso(), LockedBy: clean(body.RecordedBy), FinalizedSnapshot: item.ConfigurationSnapshot || null });
  }
  if (target === 'rejected') { updated.RejectedAt = nowIso(); updated.RejectedBy = clean(body.RecordedBy); updated.RejectionReason = clean(body.Reason); }
  if (target === 'posted') {
    const date = clean(body.Date || run.PayDate) || nowIso().slice(0, 10);
    const mappings = await listCollection(env, PAYROLL_TAX_COLLECTIONS.mappings).catch(() => []);
    const ledger = buildPayrollJournalLines(runItems, mappings, date, run.Description);
    const journal = await saveAccountingJournal(env, { JournalNo: `SYS-PR-${safeDocumentId(runId)}`, Date: date, Status: 'Posted',
      Description: run.Description, Reference: runId, Source: 'Payroll', SourceId: runId, RecordedBy: clean(body.RecordedBy), Lines: ledger.lines }, true);
    updated.JournalNo = journal.JournalNo; updated.PostedAt = nowIso(); updated.PostedBy = clean(body.RecordedBy); updated.LedgerMappingSnapshot = ledger.mappingSnapshot;
  }
  await upsertDocument(env, 'payrollRuns', safeDocumentId(runId), updated);
  await writePayrollAudit(env, target.toUpperCase(), 'Payroll Run', runId, body, clean(body.Reason || requested));
  return { ok: true, message: `Payroll ${requested.toLowerCase()}.`, run: updated };
}

async function payPayrollItem(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const itemId = clean(body.ItemId || body.itemId);
  const items = await listCollection(env, 'payrollItems');
  const item = items.find((row) => sameText(row.ItemId, itemId) || sameText(row.__id, safeDocumentId(itemId)));
  if (!item) { const err = new Error('Payroll item was not found.'); err.status = 404; throw err; }
  const run = (await listCollection(env, 'payrollRuns')).find((row) => sameText(row.RunId, item.RunId));
  if (!run || !['posted', 'part paid'].includes(lower(run.Status))) { const err = new Error('Payroll must be posted before salary payment.'); err.status = 409; throw err; }
  const outstanding = Math.max(0, asMoneyNumber(item.NetPay) - asMoneyNumber(item.PaidAmount));
  const amount = asMoneyNumber(body.Amount || outstanding);
  if (amount <= 0 || amount > outstanding + 0.005) { const err = new Error(`Payment must be between 0 and ${outstanding.toFixed(2)}.`); err.status = 400; throw err; }
  const paymentNo = clean(body.PaymentNo) || ledgerDocumentId('SALPAY');
  const date = clean(body.Date) || nowIso().slice(0, 10);
  const paymentAccount = clean(body.PaymentAccount) || '1020';
  const journal = await saveAccountingJournal(env, { JournalNo: `SYS-SALPAY-${safeDocumentId(paymentNo)}`, Date: date, Status: 'Posted',
    Description: `Salary payment: ${clean(item.DisplayName)}`, Reference: clean(body.Reference) || paymentNo,
    Source: 'Salary Payment', SourceId: paymentNo, RecordedBy: clean(body.RecordedBy), Lines: [
      { AccountCode: '2300', Debit: amount, Credit: 0, Description: clean(item.DisplayName) },
      { AccountCode: paymentAccount, Debit: 0, Credit: amount, Description: clean(body.Method) || 'Salary payment' }
    ] }, true);
  const paid = asMoneyNumber(item.PaidAmount) + amount;
  const updatedItem = { ...item, PaidAmount: paid, OutstandingAmount: Math.max(0, asMoneyNumber(item.NetPay) - paid),
    PaymentStatus: paid + 0.005 >= asMoneyNumber(item.NetPay) ? 'Paid' : 'Part Paid', LastPaidAt: date, UpdatedAt: nowIso() };
  await upsertDocument(env, 'payrollItems', safeDocumentId(itemId), updatedItem);
  const payment = { PaymentNo: paymentNo, RunId: item.RunId, ItemId: itemId, EmployeeId: item.EmployeeId, Username: item.Username,
    DisplayName: item.DisplayName, Date: date, Amount: amount, PaymentAccount: paymentAccount, Method: clean(body.Method),
    Reference: clean(body.Reference), JournalNo: journal.JournalNo, RecordedBy: clean(body.RecordedBy), RecordedAt: nowIso() };
  await upsertDocument(env, 'payrollPayments', safeDocumentId(paymentNo), payment);
  const runItems = items.filter((row) => sameText(row.RunId, item.RunId)).map((row) => sameText(row.ItemId, itemId) ? updatedItem : row);
  const runPaid = runItems.reduce((sum, row) => sum + asMoneyNumber(row.PaidAmount), 0);
  const updatedRun = { ...run, PaidAmount: runPaid, OutstandingAmount: Math.max(0, asMoneyNumber(run.TotalNet) - runPaid),
    Status: runPaid + 0.005 >= asMoneyNumber(run.TotalNet) ? 'Paid' : 'Part Paid', UpdatedAt: nowIso() };
  await upsertDocument(env, 'payrollRuns', safeDocumentId(run.RunId), updatedRun);
  await writePayrollAudit(env, 'PAY', 'Payroll Item', itemId, body, `${paymentNo}: ${amount}`);
  return { ok: true, message: 'Salary payment posted.', item: updatedItem, run: updatedRun, payment };
}

function requireStaffUserAdmin(body) {
  if (clean(body.UserRole || body.userRole) === 'Super Admin') return;
  const err = new Error('Only Super Admin can manage staff accounts.');
  err.status = 403;
  throw err;
}

function staffUserIsActive(row) {
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(row.Active === undefined ? 'YES' : row.Active));
}

function activeStaffSuperAdmins(rows, excluding = '') {
  return rows.filter((row) => !sameText(row.Username || row.__id, excluding) && clean(row.Role) === 'Super Admin' && staffUserIsActive(row));
}

async function getStaffUsersForDesktop(env, body) {
  requireStaffUserAdmin(body);
  const users = await listCollection(env, 'staffUsers');
  return { ok: true, message: 'Staff users loaded from Firestore.', users };
}

async function saveStaffUserFromDesktop(env, body) {
  requireStaffUserAdmin(body);
  const incoming = body.User && typeof body.User === 'object' ? body.User : body;
  const username = clean(incoming.Username || incoming.username);
  if (!username) { const err = new Error('Username is required.'); err.status = 400; throw err; }
  const users = await listCollection(env, 'staffUsers');
  const existing = users.find((row) => sameText(row.Username || row.__id, username));
  const role = clean(incoming.Role || incoming.role) || 'Front Desk';
  const department = clean(incoming.Department || incoming.department);
  const active = incoming.Active === undefined ? true : staffUserIsActive(incoming);
  if (role === 'Department User' && !department) { const err = new Error('Department is required for a Department User.'); err.status = 400; throw err; }
  if (!clean(incoming.Salt) || !clean(incoming.PasswordHash)) { const err = new Error('A password hash and salt are required.'); err.status = 400; throw err; }
  if (existing && clean(existing.Role) === 'Super Admin' && staffUserIsActive(existing) && (role !== 'Super Admin' || !active) && activeStaffSuperAdmins(users, username).length === 0) {
    const err = new Error('At least one active Super Admin must remain.'); err.status = 409; throw err;
  }
  const payload = {
    ...(existing || {}),
    Username: username,
    DisplayName: clean(incoming.DisplayName) || username,
    Role: role,
    Department: department,
    BranchId: clean(incoming.BranchId || incoming.branchId || existing?.BranchId),
    Active: active,
    Salt: clean(incoming.Salt),
    PasswordHash: clean(incoming.PasswordHash),
    PasswordIterations: asMoneyNumber(incoming.PasswordIterations || 10000),
    MustChangePassword: incoming.MustChangePassword === undefined ? Boolean(existing?.MustChangePassword) : staffUserIsActive({ Active: incoming.MustChangePassword }),
    CreatedAt: existing?.CreatedAt || clean(incoming.CreatedAt) || nowIso(),
    UpdatedAt: nowIso(),
    UpdatedBy: clean(body.RecordedBy || body.recordedBy) || 'Desktop Super Admin'
  };
  delete payload.__id;
  delete payload.__name;
  await upsertDocument(env, 'staffUsers', safeDocumentId(lower(username)), payload);
  await upsertDocument(env, 'staffSecurityAudit', safeDocumentId(`DESKTOP-${Date.now()}-${username}`), {
    Timestamp: nowIso(), Action: existing ? 'UPDATE USER' : 'CREATE USER', Username: username,
    Actor: clean(body.RecordedBy) || 'Desktop Super Admin', SourcePlatform: 'Desktop'
  });
  return { ok: true, message: existing ? 'Staff user updated in Firestore.' : 'Staff user created in Firestore.', user: payload };
}

async function deleteStaffUserFromDesktop(env, body) {
  requireStaffUserAdmin(body);
  const username = clean(body.Username || body.username);
  const users = await listCollection(env, 'staffUsers');
  const existing = users.find((row) => sameText(row.Username || row.__id, username));
  if (!existing) { const err = new Error('Staff account was not found.'); err.status = 404; throw err; }
  if (sameText(username, body.RecordedBy)) { const err = new Error('You cannot delete the account currently signed in.'); err.status = 409; throw err; }
  if (clean(existing.Role) === 'Super Admin' && staffUserIsActive(existing) && activeStaffSuperAdmins(users, username).length === 0) {
    const err = new Error('At least one active Super Admin must remain.'); err.status = 409; throw err;
  }
  await deleteDocument(env, 'staffUsers', existing.__id || safeDocumentId(lower(username)));
  await upsertDocument(env, 'staffSecurityAudit', safeDocumentId(`DESKTOP-${Date.now()}-${username}`), {
    Timestamp: nowIso(), Action: 'DELETE USER', Username: username,
    Actor: clean(body.RecordedBy) || 'Desktop Super Admin', SourcePlatform: 'Desktop'
  });
  return { ok: true, message: 'Staff user deleted from Firestore.' };
}

function withoutFirestoreMetadata(row = {}) {
  const copy = { ...row };
  delete copy.__id;
  delete copy.__name;
  delete copy.__scopePath;
  return copy;
}

async function optimizeFirestoreData(env, body) {
  requireAccountingRole(body, ['Super Admin']);
  const rootCollections = ['payments', 'ledger', 'invoices', 'storeOrders', 'clinicRecords', 'formSales'];
  const [rootGroups, applications, students] = await Promise.all([
    Promise.all(rootCollections.map((collection) => listCollection(env, collection).catch(() => []))),
    listSchoolCollection(env, 'applications').catch(() => []),
    listSchoolCollection(env, 'students').catch(() => [])
  ]);
  const writes = [];
  rootCollections.forEach((collectionPath, index) => {
    rootGroups[index].forEach((row) => {
      const accountRef = clean(row.AccountRef || row.AdmissionNo || row.ApplicationReference);
      const reference = clean(row.Reference || row.GatewayReference || row.PaymentReference || row.ReceiptNo);
      const data = {
        ...withoutFirestoreMetadata(row),
        ...(accountRef ? { AccountRefNormalized: normalizeReferenceText(accountRef) } : {}),
        ...(reference ? { ReferenceNormalized: normalizeReferenceText(reference) } : {}),
        OptimizationVersion: 1,
        OptimizedAt: nowIso()
      };
      writes.push({ collectionPath, documentId: row.__id, data });
    });
  });
  for (const [collection, rows] of [['applications', applications], ['students', students]]) {
    rows.forEach((row) => {
      const email = lower(row.ParentEmail || row.VerificationEmail || row.Email);
      const data = {
        ...withoutFirestoreMetadata(row),
        ...(email ? { ParentEmailNormalized: email } : {}),
        OptimizationVersion: 1,
        OptimizedAt: nowIso()
      };
      writes.push({ collectionPath: row.__scopePath || collection, documentId: row.__id, data });
    });
  }
  for (let index = 0; index < writes.length; index += 450) {
    await batchUpsertDocuments(env, writes.slice(index, index + 450));
  }
  return {
    ok: true,
    message: `${writes.length} existing records were prepared for targeted Firestore access.`,
    optimized: writes.length,
    version: 1
  };
}

async function getSystemHealth(env, body) {
  requireAccountingRole(body, ['Super Admin']);
  const [pendingIntents, processingPayments, recentPayments] = await Promise.all([
    queryCollection(env, 'paymentIntents', {
      filters: [{ field: 'Status', op: '==', value: 'Pending' }],
      limit: 50
    }).catch(() => []),
    queryCollection(env, 'payments', {
      filters: [{ field: 'ProcessingStatus', op: '==', value: 'Processing' }],
      limit: 50
    }).catch(() => []),
    queryCollection(env, 'payments', {
      orderBy: [{ field: 'PaidAt', direction: 'DESCENDING' }],
      limit: 20
    }).catch(() => [])
  ]);
  const journalChecks = await Promise.all(recentPayments.map(async (payment) => {
    const sourceId = clean(payment.Reference || payment.GatewayReference || payment.PaymentId);
    if (!sourceId) return { payment, journal: null };
    const journal = await getDocument(env, 'accountingJournals', safeDocumentId(`SYS-PAY-${safeDocumentId(sourceId)}`)).catch(() => null);
    return { payment, journal };
  }));
  const unjournaled = journalChecks.filter((row) => !row.journal).map((row) => ({
    Reference: clean(row.payment.Reference || row.payment.GatewayReference || row.payment.PaymentId),
    AccountRef: clean(row.payment.AccountRef),
    Amount: paymentCreditedAmount(row.payment),
    PaidAt: clean(row.payment.PaidAt)
  }));
  return {
    ok: true,
    message: 'Firestore and payment health checks completed.',
    checkedAt: nowIso(),
    pendingPaymentIntents: pendingIntents.length,
    processingPayments: processingPayments.length,
    recentPaymentsChecked: recentPayments.length,
    unjournaledPayments: unjournaled,
    healthy: processingPayments.length === 0 && unjournaled.length === 0
  };
}

async function routeAction(env, action, body = {}) {
  switch (action) {
    case 'ping':
      return {
        ok: true,
        message: 'Firestore backend is reachable.',
        backend: 'firestore',
        projectId: env.FIREBASE_PROJECT_ID
      };
    case 'exportBackup': {
      requireAccountingRole(body, ['Super Admin']);
      const rootCollections = [
        'accounts', 'payments', 'paymentGatewayCharges', 'invoices', 'ledger', 'feeItems', 'billingCategories',
        'settings', 'formSales', 'staffUsers', 'staffSecurityAudit',
        'accountingExpenses', 'accountingSupplierBills', 'accountingApprovalLimits',
        'accountingAudit', 'accountingJournals', 'accountingBudgets', 'accountingBanks', 'chartOfAccounts',
        'accountingPayrollProfiles', 'accountingPayrollRuns',
        'payrollProfiles', 'payrollRuns', 'payrollItems', 'payrollPayments', 'payrollAudit',
        PAYROLL_TAX_COLLECTIONS.components, PAYROLL_TAX_COLLECTIONS.profiles, PAYROLL_TAX_COLLECTIONS.bands,
        PAYROLL_TAX_COLLECTIONS.reliefs, PAYROLL_TAX_COLLECTIONS.mappings, PAYROLL_TAX_COLLECTIONS.overrides, PAYROLL_TAX_COLLECTIONS.migrations,
        'clinicRecords',
        'clinicInventory', 'clinicMovements', 'kitchenInventory', 'kitchenMovements',
        'tuckShopPurchases', 'storeItems', 'storeOrders', 'storeCategories'
      ];
      const schoolCollections = ['applications', 'students'];
      const [organizationProfile, legacyProfile] = await Promise.all([
        getDocument(env, 'settings', 'organisationProfile').catch(() => null),
        getDocument(env, 'settings', 'schoolProfile').catch(() => null)
      ]);
      const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
      const structure = await getSchoolStructure(env);
      const churchPaths = organization.Edition === 'church'
        ? (structure.Branches || [{ Id: 'main' }]).flatMap((branch) =>
          Object.values(CHURCH_COLLECTIONS).map((collection) => churchCollectionPath(collection, branch.Id || branch.id || 'main')))
        : [];
      const [rootGroups, schoolGroups, churchGroups] = await Promise.all([
        Promise.all(rootCollections.map((name) => listCollection(env, name).catch(() => []))),
        Promise.all(schoolCollections.map((name) => listSchoolCollection(env, name).catch(() => []))),
        Promise.all(churchPaths.map((path) => listCollection(env, path).catch(() => [])))
      ]);
      const collections = {};
      rootCollections.forEach((name, index) => { collections[name] = rootGroups[index]; });
      schoolCollections.forEach((name, index) => { collections[name] = schoolGroups[index]; });
      churchPaths.forEach((path, index) => { collections[path] = churchGroups[index]; });
      return { ok: true, message: 'Complete Firestore backup prepared.', exportedAt: nowIso(), collections };
    }
    case 'getSystemHealth':
      return getSystemHealth(env, body);
    case 'optimizeFirestoreData':
      return optimizeFirestoreData(env, body);
    case 'getApplications':
      return {
        ok: true,
        message: 'Applications loaded from Firestore.',
        applications: (await listSchoolCollection(env, 'applications')).map(normalizeApplication)
      };
    case 'getStudents':
      return {
        ok: true,
        message: 'Students loaded from Firestore.',
        students: (await listSchoolCollection(env, 'students')).map(normalizeStudent)
      };
    case 'getChurchMembership':
    case 'saveChurchMember':
    case 'saveChurchHousehold':
    case 'importChurchMembers':
      return handleChurchMembershipAction(env, {
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role: clean(body.UserRole),
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId)
      }, body);
    case 'getChurchServices':
    case 'saveChurchService':
    case 'saveChurchServiceOccurrence':
    case 'recordChurchAttendance':
      return handleChurchServiceAction(env, {
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role: clean(body.UserRole),
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId)
      }, body);
    case 'getChurchFunds':
    case 'saveChurchFund':
    case 'saveChurchFundMapping':
      return handleChurchFundAction(env, {
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role: clean(body.UserRole),
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId)
      }, body);
    case 'getChurchOfferings':
    case 'saveChurchOffering':
    case 'reconcileChurchOffering':
      return handleChurchOfferingAction(env, {
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role: clean(body.UserRole),
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId)
      }, body);
    case 'updateStudentProfile':
      return updateStudentProfile(env, body);
    case 'getAdmissionClasses':
      return getAdmissionClasses(env);
    case 'saveAdmissionClasses':
      return saveAdmissionClasses(env, body);
    case 'getSchoolClasses':
      return getSchoolClasses(env);
    case 'saveSchoolClasses':
      return saveSchoolClasses(env, body);
    case 'saveFeeItem':
      return saveFeeItem(env, body);
    case 'saveBillingCategory':
      return saveBillingCategory(env, body);
    case 'deleteBillingCategory':
      return deleteBillingCategory(env, body);
    case 'getStoreOverview':
      return getStoreOverview(env, body);
    case 'saveStoreItem':
      return saveStoreItem(env, body);
    case 'saveStoreCategory':
      return saveStoreCategoryAction(env, body);
    case 'updateStoreOrderStatus':
      return updateStoreOrderStatus(env, body);
    case 'deleteFeeItem':
      return deleteFeeItem(env, body);
    case 'seedDefaultFeeItems':
      return seedDefaultFeeItems(env);
    case 'generateSchoolFeeInvoices':
      return generateSchoolFeeInvoices(env, body);
    case 'recordManualPayment':
      return recordManualPayment(env, body);
    case 'getWalletCardAccount':
      return getWalletCardAccount(env, body);
    case 'saveWalletCard':
      return saveWalletCard(env, body);
    case 'recordWalletPurchase':
      return recordWalletPurchase(env, body);
    case 'recordCreditAction':
      return recordCreditAction(env, body);
    case 'updateStudentBillingCategory':
      return updateStudentBillingCategory(env, body);
    case 'updateStudentStatus':
      return updateStudentStatus(env, body);
    case 'getAccountsOverview':
      return getAccountsOverview(env);
    case 'getAccountingOverview':
      return getAccountingOverview(env, body);
    case 'getPayrollTaxConfiguration': {
      requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
      const configuration = await getPayrollTaxConfiguration(env);
      return { ok: true, message: 'Payroll tax configuration loaded.', ...configuration, validation: validatePayrollTaxConfigurationData(configuration) };
    }
    case 'seedTraditionalPayeConfiguration': {
      requireAccountingRole(body, ['Super Admin']);
      const result = await seedTraditionalPayeConfiguration(env, body);
      await writePayrollAudit(env, 'SEED TAX CONFIG', 'Payroll Tax Profile', clean(result.profile?.ProfileId), body, result.message);
      return { ok: true, ...result };
    }
    case 'savePayrollSalaryComponent': {
      requireAccountingRole(body, ['Super Admin']);
      const component = await savePayrollSalaryComponent(env, body, clean(body.RecordedBy));
      await writePayrollAudit(env, 'SAVE COMPONENT', 'Payroll Salary Component', component.ComponentId, body, component.Name);
      return { ok: true, message: 'Payroll salary component saved.', component };
    }
    case 'savePayrollTaxProfile': {
      requireAccountingRole(body, ['Super Admin']);
      const profile = await savePayrollTaxProfile(env, body, clean(body.RecordedBy));
      await writePayrollAudit(env, 'SAVE TAX PROFILE', 'Payroll Tax Profile', profile.ProfileId, body, `Version ${profile.Version}`);
      return { ok: true, message: 'Payroll tax profile saved.', profile };
    }
    case 'clonePayrollTaxProfile': {
      requireAccountingRole(body, ['Super Admin']);
      const result = await clonePayrollTaxProfile(env, body, clean(body.RecordedBy));
      await writePayrollAudit(env, 'CLONE TAX PROFILE', 'Payroll Tax Profile', result.profile.ProfileId, body, `Cloned from ${clean(body.SourceProfileId || body.ProfileId)}`);
      return { ok: true, message: 'A new draft tax-profile version was created.', ...result };
    }
    case 'savePayrollTaxBands': {
      requireAccountingRole(body, ['Super Admin']);
      const bands = await savePayrollTaxBands(env, body, clean(body.RecordedBy));
      await writePayrollAudit(env, 'SAVE TAX BANDS', 'Payroll Tax Profile', clean(body.TaxProfileId || body.ProfileId), body, `${bands.length} band(s)`);
      return { ok: true, message: 'Payroll tax bands validated and saved.', bands };
    }
    case 'savePayrollTaxReliefRules': {
      requireAccountingRole(body, ['Super Admin']);
      const reliefs = await savePayrollTaxReliefRules(env, body, clean(body.RecordedBy));
      await writePayrollAudit(env, 'SAVE RELIEF RULES', 'Payroll Tax Profile', clean(body.TaxProfileId || body.ProfileId), body, `${reliefs.length} rule(s)`);
      return { ok: true, message: 'Payroll tax relief rules saved.', reliefs };
    }
    case 'savePayrollLedgerMapping': {
      requireAccountingRole(body, ['Super Admin']);
      const mapping = await savePayrollLedgerMapping(env, body, clean(body.RecordedBy));
      await writePayrollAudit(env, 'SAVE LEDGER MAPPING', 'Payroll Ledger Mapping', mapping.MappingId, body, `${mapping.MappingType}: ${mapping.DebitAccountId || '-'} / ${mapping.CreditAccountId || '-'}`);
      return { ok: true, message: 'Payroll ledger mapping saved.', mapping };
    }
    case 'validatePayrollTaxConfiguration': {
      requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
      const configuration = await getPayrollTaxConfiguration(env);
      return { ok: true, message: 'Payroll tax configuration validation completed.', validation: validatePayrollTaxConfigurationData(configuration) };
    }
    case 'migratePayrollTaxPhase2': {
      requireAccountingRole(body, ['Super Admin']);
      const result = await migratePayrollTaxPhase2(env, body);
      await writePayrollAudit(env, result.report?.Apply ? 'APPLY PAYE MIGRATION' : 'PREVIEW PAYE MIGRATION', 'Payroll Migration', clean(result.report?.MigrationId), body, result.message);
      return result;
    }
    case 'savePayrollProfile':
      return savePayrollProfile(env, body);
    case 'createPayrollProfilesFromStaff':
      return createPayrollProfilesFromStaff(env, body);
    case 'importPayrollProfiles':
      return importPayrollProfiles(env, body);
    case 'generatePayrollRun':
      return generatePayrollRun(env, body);
    case 'requestPayrollTaxOverride':
      return requestPayrollTaxOverride(env, body);
    case 'approvePayrollTaxOverride':
      return approvePayrollTaxOverride(env, body);
    case 'savePayrollRunStatus':
      return savePayrollRunStatus(env, body);
    case 'payPayrollItem':
      return payPayrollItem(env, body);
    case 'getStaffUsers':
      return getStaffUsersForDesktop(env, body);
    case 'saveStaffUser':
      return saveStaffUserFromDesktop(env, body);
    case 'deleteStaffUser':
      return deleteStaffUserFromDesktop(env, body);
    case 'syncAccountingRevenue':
      requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
      const syncResult = await syncRevenueToAccounting(env, body);
      const syncCreated = syncResult?.created ?? syncResult;
      const syncWarnings = syncResult?.warnings || [];
      return {
        ok: true,
        message: 'Revenue subledgers synchronized.',
        created: syncCreated,
        ...(syncWarnings.length > 0 ? { warnings: syncWarnings, warningCount: syncWarnings.length } : {})
      };
    case 'saveChartAccount':
      return saveChartAccount(env, body);
    case 'saveAccountingJournal':
      requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
      return { ok: true, message: 'Journal saved.', journal: await saveAccountingJournal(env, body) };
    case 'saveAccountingExpense':
      return saveAccountingExpense(env, body);
    case 'saveAccountingBudget':
      return saveAccountingBudget(env, body);
    case 'saveAccountingBank':
      return saveAccountingBank(env, body);
    case 'saveAccountingReconciliation':
      return saveAccountingReconciliation(env, body);
    case 'saveAccountingPeriod':
      return saveAccountingPeriod(env, body);
    case 'saveAccountingOpeningBalance':
      return saveAccountingOpeningBalance(env, body);
    case 'saveAccountingVendor':
      return saveAccountingVendor(env, body);
    case 'saveAccountingSupplierBill':
      return saveAccountingSupplierBill(env, body);
    case 'payAccountingSupplierBill':
      return payAccountingSupplierBill(env, body);
    case 'saveAccountingAsset':
      return saveAccountingAsset(env, body);
    case 'postAccountingDepreciation':
      return postAccountingDepreciation(env, body);
    case 'saveAccountingAdjustment':
      return saveAccountingAdjustment(env, body);
    case 'saveAccountingApprovalLimit':
      return saveAccountingApprovalLimit(env, body);
    case 'saveAccountingCloseChecklist':
      return saveAccountingCloseChecklist(env, body);
    case 'importAccountingBankStatement':
      return importAccountingBankStatement(env, body);
    case 'matchAccountingBankStatement':
      return matchAccountingBankStatement(env, body);
    case 'saveBrevoSettings':
      return saveBrevoSettings(env, body);
    case 'saveSchoolProfile':
      return saveSchoolProfile(env, body);
    case 'getSchoolProfile':
      return getSchoolProfile(env);
    case 'getPayableFees':
      return getPayableFees(env, body);
    case 'getClinicRecords':
      return {
        ok: true,
        message: 'Clinic records loaded from Firestore.',
        records: (await listCollection(env, 'clinicRecords')).map(normalizeClinicRecord)
      };
    case 'saveClinicRecord':
      return saveClinicRecord(env, body);
    case 'getClinicInventory':
      return {
        ok: true,
        message: 'Clinic inventory loaded from Firestore.',
        inventory: (await listCollection(env, 'clinicInventory')).map(normalizeInventory)
      };
    case 'saveClinicInventoryItem':
      return saveInventoryItem(env, body, 'clinicInventory', { label: 'Clinic', category: 'Medical Supply', unit: 'pcs' });
    case 'deleteClinicInventoryItem':
      return deleteInventoryItem(env, body, 'clinicInventory', 'Clinic');
    case 'recordClinicStockMovement':
      return recordStockMovement(env, body, 'clinicInventory', 'clinicMovements', { label: 'Clinic', prefix: 'MED', actor: 'Clinic' });
    case 'getKitchenInventory':
      return {
        ok: true,
        message: 'Kitchen inventory loaded from Firestore.',
        inventory: (await listCollection(env, 'kitchenInventory')).map(normalizeInventory)
      };
    case 'saveKitchenInventoryItem':
      return saveInventoryItem(env, body, 'kitchenInventory', { label: 'Kitchen', category: 'Foodstuff', unit: 'kg' });
    case 'deleteKitchenInventoryItem':
      return deleteInventoryItem(env, body, 'kitchenInventory', 'Kitchen');
    case 'recordKitchenStockMovement':
      return recordStockMovement(env, body, 'kitchenInventory', 'kitchenMovements', { label: 'Kitchen', prefix: 'KIT', actor: 'Kitchen' });
    case 'updateApplicationStatus':
      return updateApplicationStatus(env, body);
    case 'updateApplicantNotes':
      return updateApplicantNotes(env, body);
    case 'updateEntranceResult':
      return updateEntranceResult(env, body);
    case 'updateApplicantIntelligence':
      return updateApplicantIntelligence(env, body);
    case 'updateApplicationDetails':
      return updateApplicationDetails(env, body);
    case 'deleteApplication':
      return deleteApplication(env, body);
    case 'importStudents':
      return importStudents(env, body);
    case 'promoteStudents':
      return promoteStudents(env, body);
    case 'enrollStudent':
      return enrollStudent(env, body);
    case 'markResultSent':
      return markApplicationFlag(env, body, 'ResultSent', 'ResultSentAt', 'Entrance result marked as sent.');
    case 'markOfferSent':
      return markApplicationFlag(env, body, 'OfferSent', 'OfferSentAt', 'Offer marked as sent.');
    case 'markAdmissionLetterSent':
      return markApplicationFlag(env, body, 'AdmissionLetterSent', 'AdmissionLetterSentAt', 'Admission letter marked as sent.');
    case 'storeGeneratedAdmissionDocument':
      return storeGeneratedAdmissionDocument(env, body);
    case 'recordSale':
      return recordSale(env, body);
    case 'getFormSales':
      return getFormSales(env);
    default: {
      const err = new Error(`Firestore backend action is not implemented yet: ${action}`);
      err.status = 400;
      throw err;
    }
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    let body = await request.json().catch(() => ({}));
    requireBackendSecret(env, body);
    const action = clean(body.Action || body.action);
    if (!action) {
      return Response.json({ ok: false, message: 'Action is required.' }, { status: 400 });
    }
    body = await verifyDesktopActor(env, action, body);
    const data = await routeAction(env, action, body);
    return Response.json(data);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Firestore backend failure', err);
    return Response.json({
      ok: false,
      message: status >= 500 ? 'The backend could not complete this operation.' : String(err && err.message ? err.message : err),
      ...(err && err.code && status < 500 ? { code: err.code } : {})
    }, { status });
  }
}

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const url = new URL(request.url);
    const action = clean(url.searchParams.get('action') || url.searchParams.get('Action'));
    if (action && action !== 'ping') return Response.json({ ok: false, message: 'Backend actions require POST; credentials must not be placed in a URL.' }, { status: 405, headers: { Allow: 'POST' } });
    return Response.json({
      ok: true,
      message: 'Firestore backend is reachable.',
      backend: 'firestore',
      projectId: env.FIREBASE_PROJECT_ID
    });
  } catch (err) {
    console.error('Firestore backend health-check failure', err);
    return Response.json({
      ok: false,
      message: 'The backend health check failed.'
    }, { status: 500 });
  }
}
