import { batchCommitDocuments, batchCommitLiteralDocuments, batchUpsertDocuments, createDocumentIfAbsent, deleteDocument, findOneByField, getDocument, listCollection, listCollectionForReport, listCollectionPage, patchDocumentFields, queryCollection, queryCollectionPages, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { feeBranchId, feeRowsForBranch, feeMatchesBranch, feeSetupBranch, resolveFeeDocument, feeDocumentWrite } from '../lib/fee-branch-scope.js';
import { normalizeRecoveryEmail } from '../lib/staff-password-recovery.js';
import { billingComponentDiagnostics, billingDiagnostics } from '../lib/student-billing-diagnostics.js';
import { loadBranchFinanceRows, loadBranchFinancePage } from '../lib/finance-branch-reads.js';
import { financeMoney, financeDate, financeData, financeWrite, financeFailure, financeOperationId, journalFinancialSignature, assertFinanceRoleLimit } from '../lib/accounting-mutation-guards.js';
import { getAccountingChartRows, invalidateAccountingChartRows, primeAccountingChartRows } from '../lib/accounting-reference-cache.js';
import { continueRevenueSync, revenueSyncWrite, revenueSyncReader } from '../lib/accounting-revenue-sync.js';
import { mergeSchoolBranchMetadata, saveBranchSchoolSection } from '../lib/branch-school-presentation.js';
import { canonicalSchoolBranchId, deleteSchoolDocument, getSchoolDocumentById, getSchoolDocumentsById, getSchoolStructure, invalidateSchoolStructureCache, listSchoolCollection, normalizeSchoolStructure, querySchoolCollection, safeScopeId, schoolCollectionPaths, schoolSectionFor, upsertSchoolDocument } from '../lib/school-scope.js';
import { canonicalConfiguredClass, classNamesMatch } from '../lib/class-names.js';
import { explicitlyIncludesFullScholarship, isFullScholarship } from '../lib/full-scholarship.js';
import { categoryApplies, deleteStoreCategory, ensureStoreCategories, resolveStoreCategory, saveStoreCategory } from '../lib/store-categories.js';
import { assertProcurementInventoryEdit, assertProcurementInventoryMovement, assertProcurementInventoryDeletion, loadProcurementInventoryControl, procurementMovementBalance, inventoryQuantityNumber } from '../lib/procurement-inventory-guard.js';
import {
  clonePayrollTaxProfile, getPayrollTaxConfiguration, migratePayrollTaxPhase2,
  PAYROLL_TAX_COLLECTIONS, savePayrollSalaryComponent, savePayrollTaxBands,
  savePayrollTaxProfile, savePayrollTaxReliefRules, savePayrollLedgerMapping, seedTraditionalPayeConfiguration,
  validatePayrollTaxConfigurationData
} from '../lib/payroll/tax-config-service.js';
import { calculateConfigurablePayroll, calculateLegacyPayroll } from '../lib/payroll/payroll-calculation-service.js';
import { assertPayrollCanRegenerate, buildFinalizedRunSnapshot, validatePayrollForSubmission } from '../lib/payroll/payroll-run-guards.js';
import { buildPayrollJournalLines } from '../lib/payroll/payroll-ledger-service.js';
import { payrollImportRows, payrollProfileValues } from '../lib/payroll/profile-input.js';
import { withStaffEmployment, employmentPayrollProfile } from '../lib/staff-employment.js';
import { financeReportDate, financeReportWithinCutoff, financeStoredCreditAsOf, financeDepartmentJournals, financeInvoiceAsOf } from '../lib/accounting-report-scope.js';
import {
  applyDesktopDeviceBranchScope,
  applyAuthoritativeActor,
  requireConfiguredDesktopSecret,
  resolveAuthoritativeDesktopActorForEnv,
  verifyDesktopCredential,
  verifyDesktopSecret
} from '../lib/backend-security.js';
import {
  deleteStoredDocument,
  documentStorageConfigured,
  putStoredDocument
} from '../lib/document-storage.js';
import { organizationModulePreferences, organizationProfileDocument, resolveOrganizationConfig } from '../lib/organization-config.js';
import { loadOrganizationNameProfile } from '../lib/organization-name-format.js';
import { loadFinanceSchoolProfile } from '../lib/finance-school-profile.js';
import { invalidateStaffAccessCache, staffAccessFor } from '../lib/staff-auth.js';
import { beginStaffAccountChange, commitStaffAccountChanges, resolveStaffAccountTarget, staffAccountCondition, staffAccountWrite } from '../lib/staff-account-integrity.js';
import { mergedProfileText } from '../lib/profile-settings-update.js';
import { selectStudentBillingProfile, selectStudentBillingProfiles, studentProfileValue } from '../lib/student-billing-profile.js';
import { effectiveInvoiceAfterReversal } from '../lib/invoice-charge-reversal.js';
import { financialPreviewFingerprint } from '../lib/financial-preview-fingerprint.js';
// Shared audited charge-correction primitives; importing them does not post.
export { normalizeFeeItem, normalizePayment, feeMatchesAccountPeriod, journalLineSignature,
  accountingPeriodIsClosed, normalizedJournal, accountingAuditWrite, safeDocumentId, accountRefsFrom };
import { studentWalletProfile } from '../lib/student-wallet-profile.js';
import { withStudentProfileDefaults } from '../lib/student-profile-defaults.js';
import { admissionYearEnrollmentCategory } from '../lib/student-intake-classification.js';
import { assertManualPaymentDestination, assertManualPaymentRetry, assertManualPaymentScope, bindManualPaymentIdentity, manualPaymentRequestScope, scopedPaymentWriteCondition } from '../lib/manual-payment-scope.js';
import { reviewManualWalletTopup } from '../lib/manual-wallet-duplicate-review.js';
import {
  applyPublicPortalContent,
  PUBLIC_PORTAL_CONTENT_DOCUMENT
} from '../lib/public-portal-content.js';
import {
  accountingChartForEdition,
  accountingCodeAllowedForEdition,
  accountingJournalsForEdition,
  SCHOOL_ONLY_REVENUE_ACCOUNT_CODES
} from '../lib/accounting-edition-scope.js';
import {
  assertExpectedDeploymentIdentity,
  loadDeploymentIdentity,
  requiredDeploymentIdentity
} from '../lib/deployment-identity.js';
import { handleChurchMembershipAction } from '../lib/church-membership.js';
import { CHURCH_COLLECTIONS, churchCollectionPath } from '../lib/church-foundation.js';
import { handleChurchServiceAction } from '../lib/church-services.js';
import { buildHotelSelfServiceQr, handleHotelAction } from '../lib/hotel-services.js';
import {
  ensureGivingTypes,
  handleChurchFundAction,
  resolveGivingType
} from '../lib/church-funds.js';
import { handleChurchOfferingAction } from '../lib/church-offerings.js';
import {
  ACCOUNTING_BASE_CURRENCY,
  convertedDonationBaseAmount,
  normalizeCurrencyCode,
  roundMoney
} from '../lib/currency-conversion.js';
import { handleOrganizationDepartmentAction } from '../lib/organization-departments.js';
import { assertOrganizationDepartmentWorkspaceAccess } from '../lib/organization-department-gate.js';
import { handleExecutiveOfficeAction } from '../lib/executive-correspondence.js';
import { prepareTuckShopWalletCart } from '../lib/organization-commerce.js';
import { handleVendorSettlementAction, prepareVendorSale } from '../lib/vendor-settlements.js';
import { approvalSnapshot, handleApprovalSettings } from '../lib/approval-settings.js';
import { getTuckShopCatalog, recordTuckShopStaffSale, searchTuckShopCustomers } from '../lib/school-tuck-shop.js';
import { handleStudentConductAction } from '../lib/student-conduct.js';
import { handleSchoolLibraryAction } from '../lib/school-library.js';
import { handleAcademicManagementAction } from '../lib/academic-management.js';
import { saveStudentLoginPassword } from '../lib/student-login-credentials.js';
import { defaultModulesForRole } from '../lib/role-module-access.js';
import { getWebBranding, saveWebBranding } from '../lib/web-branding.js';
import { saveDocumentBranding } from '../lib/document-branding.js';
import { finishRequestMetric, startRequestMetric } from '../lib/request-metrics.js';
import { readJsonBody } from '../lib/request-security.js';
import { commitClinicVisit } from '../lib/clinic-stock-usage.js';
import { recordRequisitionEdit, requisitionEditDetails, resolvedRequisitionEditHistory, requisitionChangedFields } from '../lib/requisition-edit-history.js';
import { canEditRequisitions, assertRequisitionEditPermission, requisitionEditGrant, requisitionEditPermissionAuditWrite } from '../lib/requisition-edit-permission.js';
import { resubmitRequisition } from './finance-workflow.js';
import { postApprovedRequisition } from '../lib/requisition-posting.js';
import { explicitAuditAction, securityAuditAction } from '../lib/security-audit.js';
import { paymentAuditSummary } from '../lib/audit-language.js';
import {
  clearOrganizationRestoreCollection,
  completeOrganizationRestore,
  exportOrganizationBackupPage,
  prepareOrganizationRestore,
  writeOrganizationRestoreChunk
} from '../lib/organization-backup.js';
import {
  loadNotificationSettings,
  notifyParentPaymentReceived,
  notifyStaffRequisitionEvent
} from '../lib/notifications.js';
import {
  REQUISITION_STATUS,
  assertRequisitionTransition,
  requisitionWorkflowStatus
} from '../lib/requisition-workflow.js';
import { invoiceReminderFields } from '../lib/notification-reminders.js';
import { feeDueDate, invoiceIsDue } from '../lib/account-credit.js';
import { normalizeMinimumAdmissionAge } from '../lib/admission-age.js';
import { enforceSubscriptionUserLimit, staffAccountsForSubscription } from '../lib/subscription-user-limit.js';
import {
  accountingRequestBranch,
  accountingRowsForBranch,
  accountingWriteBranch
} from '../lib/accounting-branch-scope.js';
import {
  BRANCH_PROFILE_OVERRIDE_FIELDS,
  assertConfiguredProfileBranch,
  effectiveBranchProfile,
  resetBranchProfileOverrides,
  saveBranchProfileOverrides
} from '../lib/branch-profile-settings.js';
import { normalizePaystackSubaccountCode } from '../lib/direct-bank-transfer.js';
import { refreshOrganizationPlanPolicy } from '../lib/plan-policy-sync.js';
import {
  IMPREST_ADVANCE_ACCOUNT,
  buildImprestIssueJournal,
  buildImprestRetirementJournal,
  imprestClaimReleaseWrites,
  isOpenImprestStatus,
  validateImprestRetirement
} from '../lib/imprest.js';
import {
  normalizeTutorialLinks,
  normalizeYouTubeTutorialUrl
} from '../lib/tutorial-links.js';
import { loadPublishedTutorials } from '../lib/tutorial-catalog.js';

export { normalizeTutorialLinks, normalizeYouTubeTutorialUrl } from '../lib/tutorial-links.js';

export const SCHOOL_FEES_TOTAL_CODE = 'SCHOOL_FEES_TOTAL';

function clean(value) {
  return String(value ?? '').trim();
}

export function normalizeFeeBillingCategories(value, fallback = 'All') {
  const rawValues = Array.isArray(value)
    ? value
    : clean(value).split(/[,;\n]+/);
  const categories = [];
  const seen = new Set();
  for (const rawValue of rawValues) {
    const category = clean(rawValue);
    const normalized = category.toLowerCase();
    if (!category || seen.has(normalized)) continue;
    if (normalized === 'all' || normalized === '*') return ['All'];
    seen.add(normalized);
    categories.push(category);
  }
  return categories.length ? categories : [clean(fallback) || 'All'];
}

function feeBillingCategories(fee = {}) {
  const configured = (Array.isArray(fee.BillingCategories) && fee.BillingCategories.length)
    ? fee.BillingCategories
    : ((Array.isArray(fee.billingCategories) && fee.billingCategories.length)
      ? fee.billingCategories
      : (fee.BillingCategory || fee.billingCategory));
  return normalizeFeeBillingCategories(configured);
}

function feeBillingCategoryText(value) {
  return normalizeFeeBillingCategories(value).join(', ');
}

function feeBillingCategoryMatches(fee, app = {}) {
  const category = app.BillingCategory || 'Regular';
  const categories = feeBillingCategories(fee);
  if (isFullScholarship(category)) {
    const sameScope = (rule, actual) => !clean(rule) || ['all', '*'].includes(normalizeMatchText(rule)) ||
      normalizeMatchText(rule) === normalizeMatchText(actual);
    return explicitlyIncludesFullScholarship(categories) &&
      sameScope(fee.BranchId || fee.branchId, app.BranchId || app.branchId || 'main') &&
      sameScope(fee.SchoolSection || fee.schoolSection, app.SchoolSection || app.schoolSection || schoolSectionFor(app));
  }
  return feeFieldMatches(categories, category, true);
}

function accountingEditionForRequest(env, body = {}) {
  return resolveOrganizationConfig({
    env,
    organizationProfile: {
      Edition: clean(
        body.OrganisationEdition || body.OrganizationEdition
          || body.organisationEdition || body.organizationEdition
      )
    }
  }).Edition;
}

function expectedDeploymentIdentityFromRequest(request, body = {}) {
  const url = new URL(request.url);
  return {
    ExpectedWorkspaceId: clean(
      body.ExpectedWorkspaceId || body.expectedWorkspaceId
        || url.searchParams.get('ExpectedWorkspaceId')
        || url.searchParams.get('expectedWorkspaceId')
    ),
    ExpectedOrganisationEdition: clean(
      body.ExpectedOrganisationEdition || body.expectedOrganisationEdition
        || body.ExpectedOrganizationEdition || body.expectedOrganizationEdition
        || url.searchParams.get('ExpectedOrganisationEdition')
        || url.searchParams.get('expectedOrganisationEdition')
        || url.searchParams.get('ExpectedOrganizationEdition')
        || url.searchParams.get('expectedOrganizationEdition')
    )
  };
}

function normalizeSchoolCode(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export async function getSchoolCode(env, branchId = '') {
  let schoolProfile = null;
  let organizationProfile = null;
  let branchProfile = null;
  try {
    requireFirestoreEnv(env);
    [schoolProfile, organizationProfile, branchProfile] = await Promise.all([
      getDocument(env, 'settings', 'schoolProfile').catch(() => null),
      getDocument(env, 'settings', 'organisationProfile').catch(() => null),
      // Only explicit branch overrides may supersede the organisation code.
      // Inheriting the legacy SchoolCode here could revive a stale prefix.
      effectiveBranchProfile(env, {}, branchId)
    ]);
  } catch (_err) {
    // Deployments without a readable profile retain their configured code.
  }
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile: schoolProfile });
  return normalizeSchoolCode(branchProfile?.SchoolCode) || organization.Code;
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

async function getDocumentByIdOrField(env, collectionPath, businessId, fieldName) {
  const value = clean(businessId);
  if (!value) return null;
  const candidateIds = [...new Set([
    safeDocumentId(value),
    safeDocumentId(value.toUpperCase())
  ].filter(Boolean))];
  for (const documentId of candidateIds) {
    const direct = await getDocument(env, collectionPath, documentId);
    if (direct) return direct;
  }
  if (!fieldName) return null;
  return findOneByField(env, collectionPath, fieldName, value);
}

function nowIso() {
  return new Date().toISOString();
}

function sameText(a, b) {
  return clean(a).toLowerCase() === clean(b).toLowerCase();
}

let configuredClassCache = new Map();

function invalidateConfiguredClassCache() {
  configuredClassCache = new Map();
}

async function configuredClassNames(env, options = {}) {
  const branchId = clean(options.BranchId || options.branchId);
  const cacheKey = [
    clean(env.FIREBASE_PROJECT_ID),
    clean(env.DYNAMAX_WORKSPACE_ID),
    clean(env.ORGANISATION_EDITION || env.ORGANIZATION_EDITION),
    branchId ? safeScopeId(branchId) : 'organisation'
  ].join('|');
  const now = Date.now();
  const cached = configuredClassCache.get(cacheKey);
  if (cached?.expiresAt > now) {
    return cached.classes;
  }
  try {
    const result = await getSchoolClasses(env, options);
    const classes = result.classes || [];
    configuredClassCache.set(cacheKey, { classes, expiresAt: now + (60 * 1000) });
    return classes;
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

async function findApplication(env, id, financialScope = null) {
  const wanted = clean(id);
  if (!wanted) return null;
  const direct = financialScope
    ? (await getSchoolDocumentsById(env, 'applications', safeDocumentId(wanted), financialScope, { strictReads: true }))
      .map((row) => assertManualPaymentScope(row, financialScope, 'Linked application'))[0]
    : await getSchoolDocumentById(env, 'applications', safeDocumentId(wanted));
  if (direct) return direct;
  for (const field of ['ApplicationReference', 'ApplicationID', 'applicationReference']) {
    const rows = await querySchoolCollection(env, 'applications', {
      filters: [{ field, op: '==', value: wanted }],
      ...(financialScope ? { scope: financialScope } : {}),
      limit: 1
    });
    if (rows[0]) return assertManualPaymentScope(rows[0], financialScope, 'Linked application');
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
    const found = await findStudentByAccountRef(env, admissionNo);
    if (found) return found;
  }
  if (applicationReference) return findStudentByAccountRef(env, applicationReference);
  return null;
}

async function findStudentByWalletCard(env, cardId, requestedScope = null) {
  const wanted = clean(cardId).toUpperCase();
  if (!wanted) return null;
  let rows = await querySchoolCollection(env, 'students', {
    filters: [{ field: 'WalletCardId', op: '==', value: wanted }],
    ...(requestedScope ? { scope: requestedScope } : {}),
    limit: 1
  });
  if (!rows[0]) {
    rows = await querySchoolCollection(env, 'students', {
      filters: [{ field: 'walletCardId', op: '==', value: wanted }],
      ...(requestedScope ? { scope: requestedScope } : {}),
      limit: 1
    });
  }
  return rows[0] ? normalizeStudent(rows[0]) : null;
}

export const STUDENT_ACCOUNT_REFERENCE_FIELDS = Object.freeze([
  'AdmissionNo', 'admissionNo', 'AdmissionNumber', 'admissionNumber',
  'AccountRef', 'accountRef', 'ApplicationReference', 'applicationReference'
]);

export async function findStudentByAccountRef(env, accountRef, requestedScope = null, requestedScopePath = '') {
  const wanted = clean(accountRef);
  if (!wanted) return null;
  const scopePath = validatedIdentityScopePath(requestedScopePath, 'students');
  if (clean(requestedScopePath) && !scopePath) return null;
  const direct = scopePath
    ? await getDocument(env, scopePath, safeDocumentId(wanted)).catch(() => null)
    : selectStudentBillingProfile(await getSchoolDocumentsById(env, 'students', safeDocumentId(wanted), requestedScope,
      { strictReads: requestedScope?.strictReads === true }), requestedScope);
  if (direct) return normalizeStudent(scopePath ? { ...direct, __scopePath: scopePath } : direct);
  for (const field of STUDENT_ACCOUNT_REFERENCE_FIELDS) {
    const rows = await querySchoolCollection(env, 'students', {
      filters: [{ field, op: '==', value: wanted }],
      ...(scopePath ? { scopePath } : { scope: requestedScope }),
      limit: 3
    });
    const selected = selectStudentBillingProfile(rows, requestedScope);
    if (selected) return normalizeStudent(selected);
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

async function saveApplication(env, application, options = {}) {
  const id = pick(application, ['ApplicationReference', 'ApplicationID', 'applicationReference', '__id']);
  if (!id) {
    const err = new Error('ApplicationReference is required.');
    err.status = 400;
    throw err;
  }
  const saved = await upsertSchoolDocument(env, 'applications', safeDocumentId(id), application, options);
  return normalizeApplication(saved);
}

async function saveStudent(env, student, options = {}) {
  const id = pick(student, ['AdmissionNo', 'admissionNo', 'AccountRef', '__id']);
  if (!id) {
    const err = new Error('AdmissionNo is required.');
    err.status = 400;
    throw err;
  }
  const saved = await upsertSchoolDocument(env, 'students', safeDocumentId(id), student, options);
  return normalizeStudent(saved);
}

function requestedStudentScope(body = {}) {
  return {
    branchId: clean(body.UserBranchId || body.BranchId || body.branchId),
    schoolSectionAccess: clean(
      body.UserSchoolSectionAccess
      || body.SchoolSectionAccess
      || body.SchoolSection
      || body.schoolSection
    )
  };
}

async function updateStudentProfile(env, body) {
  const accountRef = clean(body.AccountRef || body.AdmissionNo || body.accountRef);
  const existing = await findStudentByAccountRef(env, accountRef, requestedStudentScope(body));
  if (!existing) throw applicationNotFound(accountRef);
  const editableFields = [
    'DisplayName', 'ApplicantName', 'Surname', 'FirstName', 'MiddleName', 'Gender',
    'DateOfBirth', 'ClassName', 'ClassArm', 'StudentType', 'BillingCategory',
    'EnrollmentCategory', 'AcademicProgress', 'AcademicSession', 'Term', 'ParentName',
    'ParentPhone', 'ParentEmail', 'ResidentialAddress', 'CityArea', 'StateOfResidence',
    'BloodGroup', 'Genotype', 'MedicalCondition', 'EmergencyContactName',
    'EmergencyContactPhone', 'PreviousSchool', 'VerificationCode', 'ParentLoginCode',
    'WalletCardId', 'WalletCardStatus', 'Status', 'StatusReason', 'StatusEffectiveDate',
    'ExpectedReturnDate', 'ProfileCompletionStatus'
  ];
  const updated = { ...existing };
  editableFields.forEach((field) => {
    if (body[field] !== undefined) updated[field] = clean(body[field]);
  });
  if (body.WalletCardStatus !== undefined && !clean(body.WalletCardStatus)) {
    updated.WalletCardStatus = studentWalletProfile(existing).WalletCardStatus;
  }
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
  updated.UpdatedBy = clean(body.RecordedBy || body.UpdatedBy) || 'Student Register';
  const student = await saveStudent(env, updated);
  const studentPassword = String(body.StudentLoginPassword || '');
  let loginStatus = null;
  if (studentPassword) {
    loginStatus = await saveStudentLoginPassword(
      env,
      student,
      studentPassword,
      clean(body.RecordedBy || body.UpdatedBy) || 'Student Register'
    );
  }
  return {
    ok: true,
    message: studentPassword ? 'Student profile and personal login password updated.' : 'Student profile updated.',
    student,
    loginStatus
  };
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
    EnrollmentCategory: pick(row, ['enrollmentCategory', 'EnrollmentCategory', 'IntakeCategory', 'StudentEntryType'], 'New Intake'),
    AcademicProgress: pick(row, ['academicProgress', 'AcademicProgress', 'ProgressCategory'], 'New Intake'),
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
    AdmissionNo: studentProfileValue(row, 'AdmissionNo', ['admissionNo', '__id']),
    ApplicationReference: pick(row, ['applicationReference', 'ApplicationReference']),
    ApplicantName: displayName,
    DisplayName: displayName,
    ClassAdmitted: studentProfileValue(row, 'ClassName', ['ClassAdmitted', 'className', 'classAdmitted']),
    ClassName: studentProfileValue(row, 'ClassName', ['ClassAdmitted', 'className', 'classAdmitted']),
    ClassArm: studentProfileValue(row, 'ClassArm', ['classArm', 'Arm', 'arm']),
    StudentType: studentProfileValue(row, 'StudentType', ['studentType'], 'Day Student'),
    BillingCategory: studentProfileValue(row, 'BillingCategory', ['billingCategory'], 'Regular'),
    Gender: studentProfileValue(row, 'Gender', ['gender', 'Sex', 'sex']),
    EnrollmentCategory: studentProfileValue(row, 'EnrollmentCategory', ['enrollmentCategory', 'IntakeCategory', 'StudentEntryType'], 'Returning'),
    AcademicProgress: studentProfileValue(row, 'AcademicProgress', ['academicProgress', 'ProgressCategory', 'RepeaterStatus'], 'Promoted'),
    AcademicSession: studentProfileValue(row, 'AcademicSession', ['academicSession']),
    Term: studentProfileValue(row, 'Term', ['term']),
    ParentEmail: lower(pick(row, ['parentEmail', 'ParentEmail'])),
    ParentPhone: pick(row, ['parentPhone', 'ParentPhone']),
    VerificationCode: clean(pick(row, ['verificationCode', 'VerificationCode', 'parentLoginCode', 'ParentLoginCode', 'loginCode', 'LoginCode'])).toUpperCase(),
    ParentLoginCode: clean(pick(row, ['parentLoginCode', 'ParentLoginCode', 'verificationCode', 'VerificationCode', 'loginCode', 'LoginCode'])).toUpperCase(),
    ...studentWalletProfile(row),
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
    ClassName: studentProfileValue(row, 'ClassName', ['className']),
    StudentType: studentProfileValue(row, 'StudentType', ['studentType']),
    BillingCategory: studentProfileValue(row, 'BillingCategory', ['billingCategory'], 'Regular'),
    Gender: studentProfileValue(row, 'Gender', ['gender']),
    EnrollmentCategory: studentProfileValue(row, 'EnrollmentCategory', ['enrollmentCategory'], 'Returning'),
    AcademicProgress: studentProfileValue(row, 'AcademicProgress', ['academicProgress'], 'Promoted'),
    TotalDebit: asMoneyNumber(pick(row, ['totalDebit', 'TotalDebit'])),
    TotalCredit: asMoneyNumber(pick(row, ['totalCredit', 'TotalCredit'])),
    Balance: asMoneyNumber(pick(row, ['balance', 'Balance'])),
    WalletBalance: asMoneyNumber(pick(row, ['walletBalance', 'WalletBalance'])),
    LastPaymentAt: toDisplayDate(pick(row, ['lastPaymentAt', 'LastPaymentAt'])),
    Status: pick(row, ['status', 'Status'])
  };
}

function normalizeFeeItem(row) {
  const billingCategories = feeBillingCategories(row);
  return {
    ...row,
    BranchId: feeBranchId(row),
    FeeCode: pick(row, ['feeCode', 'FeeCode', '__id']),
    FeeName: pick(row, ['feeName', 'FeeName']),
    FeeCategory: pick(row, ['feeCategory', 'FeeCategory'], 'School Fee'),
    ClassName: pick(row, ['className', 'ClassName'], 'All'),
    StudentType: pick(row, ['studentType', 'StudentType'], 'All'),
    BillingCategories: billingCategories,
    BillingCategory: feeBillingCategoryText(billingCategories),
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

export function normalizeInvoice(row) {
  row = effectiveInvoiceAfterReversal(row);
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

export function normalizeLedger(row) {
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
    Quantity: inventoryQuantityNumber(pick(row, ['quantity', 'Quantity'])),
    ReorderLevel: inventoryQuantityNumber(pick(row, ['reorderLevel', 'ReorderLevel'])),
    LastUpdated: toDisplayDate(pick(row, ['lastUpdated', 'LastUpdated'])),
    Notes: pick(row, ['notes', 'Notes'])
  };
}

export function requireBackendSecret(env, body) {
  const supplied = clean(body.Secret || body.secret);
  if (!supplied.startsWith('DXD.')) return verifyDesktopSecret(env, supplied, 'desktop backend');
  return verifyDesktopCredential(env, supplied, 'desktop backend');
}

const VERIFIED_ACTOR_ACTIONS = new Set([
  'requisitionApprovalSettings',
  'manualPaymentCorrection',
  'getFeeCollectionSummary', 'getClubMembers',
  'vendorSettlements',
  'getAccountSnapshot',
  'getSchoolLibrary', 'searchLibraryBorrowers', 'saveLibraryTitle', 'addLibraryCopy', 'restoreLibraryCopy', 'repairLibraryCopyStatus', 'checkoutLibraryCopy',
  'returnLibraryCopy', 'renewLibraryLoan', 'reserveLibraryTitle',
  'cancelLibraryReservation', 'saveLibraryPolicy',
  'saveOrganizationModulePreferences',
  'exportBackup', 'prepareRestoreBackup', 'clearRestoreCollection', 'writeRestoreCollection', 'completeRestoreBackup',
  'getAccountingOverview', 'getAccountingJournalPage', 'getAccountingFinancePage', 'getSystemHealth', 'optimizeFirestoreData', 'getPayrollTaxConfiguration',
  'seedTraditionalPayeConfiguration', 'savePayrollSalaryComponent', 'savePayrollTaxProfile',
  'clonePayrollTaxProfile', 'savePayrollTaxBands', 'savePayrollTaxReliefRules',
  'savePayrollLedgerMapping', 'validatePayrollTaxConfiguration', 'migratePayrollTaxPhase2',
  'savePayrollProfile', 'createPayrollProfilesFromStaff', 'importPayrollProfiles',
  'generatePayrollRun', 'requestPayrollTaxOverride', 'approvePayrollTaxOverride',
  'savePayrollRunStatus', 'payPayrollItem',
  'getChurchMembership', 'saveChurchMember', 'saveChurchHousehold', 'importChurchMembers',
  'getChurchServices', 'saveChurchService', 'saveChurchServiceOccurrence', 'recordChurchAttendance',
  'getHotelServices', 'saveHotelRoom', 'saveHotelReservation', 'changeHotelReservationStatus',
  'saveHotelRoomMedia', 'saveHotelKeyDevice', 'saveHotelKeySlot', 'resolveHotelKeyCommand',
  'recordHotelCharge', 'recordHotelPayment', 'setHotelHousekeepingStatus',
  'getChurchFunds', 'saveChurchFund', 'saveChurchFundMapping',
  'getChurchOfferings', 'saveChurchOffering', 'reconcileChurchOffering',
  'approveChurchOffering', 'rejectChurchOffering', 'postChurchOffering',
  // Backward compatibility for desktop builds that emitted lowercase action names.
  'approvechurchoffering', 'rejectchurchoffering', 'postchurchoffering',
  'getOrganizationDepartments', 'saveDepartment', 'importOrganizationMembers', 'importDepartments', 'deleteDepartment', 'savePosition',
  'saveDepartmentMember', 'removeDepartmentMember', 'saveDepartmentMeeting', 'recordDepartmentAttendance',
  'saveDepartmentOffering', 'markDepartmentOfferingPaid', 'saveSpecialProgram',
  'registerProgramParticipant', 'saveForeignVisitor',
  'getExecutiveOffice', 'searchExecutiveDirectory', 'listOfficialCorrespondence',
  'saveOfficialCorrespondenceDraft', 'saveOfficialCorrespondenceTemplate',
  'getOfficialCorrespondenceDocument', 'issueOfficialCorrespondence',
  'sendOfficialCorrespondence', 'saveExecutiveDashboardPreferences',
  'getStudentConductCases', 'saveStudentConductCase', 'deleteStudentConductCase',
  'getAcademicManagement', 'saveAcademicSession', 'saveAcademicTerm', 'saveAcademicClass',
  'saveAcademicArmTemplate', 'saveAcademicArm', 'saveAcademicSubject', 'saveAcademicDepartment', 'saveAcademicOffering',
  'bulkCreateAcademicClasses', 'bulkCreateAcademicArmTemplates', 'bulkApplyAcademicArmTemplates', 'bulkAssignAcademicClassroomDepartments',
  'bulkCreateAcademicSubjects', 'configureAcademicSeniorChoiceSubjects', 'bulkApplyAcademicSubjects', 'bulkAssignAcademicClassTeachers', 'bulkAssignAcademicSubjectTeacher', 'updateAcademicSubjectTeacherAllocation',
  'saveAcademicTeacherAllocation', 'saveAcademicStudentMembership', 'bulkAllocateAcademicStudents',
  'bulkImportAcademicStudentMemberships',
  'bulkAssignAcademicArmStudentSubjects', 'reviewAcademicSubjectChange',
  'moveAcademicStudentMembership', 'withdrawAcademicStudentMembership', 'reinstateAcademicStudentMembership',
  'archiveAcademicRecord', 'deleteAcademicRecord',
  'syncAcademicCbtScores', 'syncLocalCbtStudentPasswords',
  'rescheduleAcademicCbtTest', 'downloadAcademicCbtTestPackage', 'acknowledgeAcademicCbtImport',
  'previewAcademicCbtRoster', 'refreshAcademicCbtRoster',
  'previewAcademicCbtLateEntry', 'createAcademicCbtLateEntry',
  'calculateAcademicTermResults', 'calculateAcademicMidTermResults', 'previewAcademicTermResultWithdrawal',
  'changeAcademicTermResultStatus', 'saveAcademicTermResultRemarks',
  'calculateAcademicCumulativeResults', 'changeAcademicCumulativeStatus', 'saveAcademicCumulativeResultRemarks',
  'calculateAcademicPromotionDecisions', 'saveAcademicPromotionOutcome', 'saveAcademicProbationResit',
  'changeAcademicPromotionStatus', 'createAcademicTranscriptDraft', 'changeAcademicTranscriptStatus',
  'getAccountingRequisitionDocument', 'syncAccountingRevenue', 'saveChartAccount',
  'saveAccountingJournal', 'saveAccountingExpense', 'saveAccountingBudget',
  'submitAccountingImprest', 'reviewAccountingImprest', 'issueAccountingImprest',
  'submitAccountingImprestRetirement', 'verifyAccountingImprestRetirement',
  'saveAccountingBank', 'saveAccountingReconciliation', 'saveAccountingPeriod',
  'saveAccountingOpeningBalance', 'saveAccountingVendor', 'saveAccountingSupplierBill',
  'payAccountingSupplierBill', 'saveAccountingAsset', 'postAccountingDepreciation',
  'saveAccountingAdjustment', 'saveAccountingApprovalLimit', 'saveAccountingCloseChecklist',
  'importAccountingBankStatement', 'matchAccountingBankStatement',
  // Desktop school finance, billing, commercial inventory, and admission mutations.
  'updateStudentProfile', 'reissueParentOnboarding',
  'saveSchoolClasses', 'resetSchoolClasses',
  'saveAdmissionClasses', 'resetAdmissionClasses',
  'saveFeeItem', 'saveFeeItems', 'deleteFeeItem', 'seedDefaultFeeItems',
  'saveBillingCategory', 'deleteBillingCategory', 'updateStudentBillingCategory',
  'generateSchoolFeeInvoices', 'recordManualPayment', 'importHistoricalPayments',
  'saveWalletCard', 'recordWalletPurchase', 'recordCreditAction',
  'getTuckShopCatalog', 'searchTuckShopCustomers', 'recordTuckShopStaffSale',
  'saveStoreItem', 'saveStoreCategory', 'deleteStoreCategory', 'updateStoreOrderStatus',
  'getClinicRecords', 'saveClinicRecord', 'getClinicInventory', 'getKitchenInventory',
  'saveClinicInventoryItem', 'deleteClinicInventoryItem', 'recordClinicStockMovement',
  'saveKitchenInventoryItem', 'deleteKitchenInventoryItem', 'recordKitchenStockMovement',
  'updateApplicationStatus', 'updateApplicantIntelligence', 'updateApplicationDetails',
  'updateProbationResit',
  'enrollStudent', 'recordSale'
]);

// Branch credentials fail closed.  Add an action here only after its complete
// read/write path has been verified to consume the branch scope injected by
// applyDesktopDeviceBranchScope.  Organisation-wide and legacy credentials
// retain the existing action surface for backwards compatibility.
const BRANCH_BOUND_DEVICE_ACTIONS = new Set([
  'requisitionApprovalSettings',
  'manualPaymentCorrection',
  'saveFeeItem', 'saveFeeItems', 'deleteFeeItem', 'seedDefaultFeeItems',
  'getFeeCollectionSummary', 'getClubMembers',
  'vendorSettlements',
  'getSchoolLibrary', 'searchLibraryBorrowers', 'saveLibraryTitle', 'addLibraryCopy', 'restoreLibraryCopy', 'repairLibraryCopyStatus', 'checkoutLibraryCopy',
  'returnLibraryCopy', 'renewLibraryLoan', 'reserveLibraryTitle',
  'cancelLibraryReservation', 'saveLibraryPolicy',
  'ping',
  'getApplications', 'getStudents',
  'enrollStudent', 'getClinicRecords', 'saveClinicRecord',
  'getClinicInventory', 'saveClinicInventoryItem', 'deleteClinicInventoryItem', 'recordClinicStockMovement',
  'getKitchenInventory', 'saveKitchenInventoryItem', 'deleteKitchenInventoryItem', 'recordKitchenStockMovement',
  'getStudentConductCases', 'saveStudentConductCase', 'deleteStudentConductCase',
  'getAcademicManagement', 'saveAcademicSession', 'saveAcademicTerm', 'saveAcademicClass',
  'saveAcademicArmTemplate', 'saveAcademicArm', 'saveAcademicSubject', 'saveAcademicDepartment', 'saveAcademicOffering',
  'bulkCreateAcademicClasses', 'bulkCreateAcademicArmTemplates', 'bulkApplyAcademicArmTemplates', 'bulkAssignAcademicClassroomDepartments',
  'bulkCreateAcademicSubjects', 'configureAcademicSeniorChoiceSubjects', 'bulkApplyAcademicSubjects',
  'bulkAssignAcademicClassTeachers', 'bulkAssignAcademicSubjectTeacher', 'updateAcademicSubjectTeacherAllocation',
  'saveAcademicTeacherAllocation', 'saveAcademicStudentMembership', 'bulkAllocateAcademicStudents',
  'bulkImportAcademicStudentMemberships', 'bulkAssignAcademicArmStudentSubjects', 'reviewAcademicSubjectChange',
  'saveAcademicTimetableSettings', 'saveAcademicTimetableConstraint', 'deleteAcademicTimetableConstraint',
  'createAcademicTimetableVersion', 'updateAcademicTimetableVersion', 'deleteAcademicTimetableVersion',
  'copyAcademicTimetableVersion', 'previewAcademicTimetableCopy',
  'copyAcademicTimetableSelection', 'saveAcademicTimetableEntry', 'bulkSaveAcademicTimetableEntries', 'deleteAcademicTimetableEntry',
  'saveAcademicTimetableSubstitution', 'cancelAcademicTimetableSubstitution',
  'changeAcademicTimetableVersionStatus', 'saveAcademicStudentAttendance', 'decideAcademicAttendanceCorrection',
  'getAcademicScorebookContext', 'getAcademicClassScoreRegister', 'applyActiveAcademicScoreLayout', 'saveAcademicScoreDraft',
  'reactivateAcademicScoreEditing', 'changeAcademicScoreSheetStatus', 'previewAcademicScoreImport',
  'importAcademicScores', 'rollbackAcademicScoreImport', 'syncAcademicCbtScores',
  'syncLocalCbtStudentPasswords', 'rescheduleAcademicCbtTest', 'downloadAcademicCbtTestPackage',
  'previewAcademicCbtRoster', 'refreshAcademicCbtRoster',
  'previewAcademicCbtLateEntry', 'createAcademicCbtLateEntry',
  'acknowledgeAcademicCbtImport', 'prepareLocalCbtIdentityPackage',
  'calculateAcademicTermResults', 'calculateAcademicMidTermResults', 'previewAcademicTermResultWithdrawal',
  'changeAcademicTermResultStatus', 'saveAcademicTermResultRemarks',
  'calculateAcademicCumulativeResults', 'changeAcademicCumulativeStatus', 'saveAcademicCumulativeResultRemarks',
  'calculateAcademicPromotionDecisions', 'saveAcademicPromotionOutcome', 'saveAcademicProbationResit',
  'changeAcademicPromotionStatus', 'createAcademicTranscriptDraft', 'changeAcademicTranscriptStatus',
  'moveAcademicStudentMembership', 'withdrawAcademicStudentMembership', 'reinstateAcademicStudentMembership',
  'archiveAcademicRecord', 'deleteAcademicRecord',
  'getExecutiveOffice', 'searchExecutiveDirectory', 'listOfficialCorrespondence',
  'saveOfficialCorrespondenceDraft', 'saveOfficialCorrespondenceTemplate',
  'getOfficialCorrespondenceDocument', 'issueOfficialCorrespondence',
  'sendOfficialCorrespondence', 'saveExecutiveDashboardPreferences',
  'getChurchMembership', 'saveChurchMember', 'saveChurchHousehold', 'importChurchMembers',
  'getChurchServices', 'saveChurchService', 'saveChurchServiceOccurrence', 'recordChurchAttendance',
  'getChurchFunds', 'saveChurchFund', 'saveChurchFundMapping',
  'getChurchOfferings', 'saveChurchOffering', 'reconcileChurchOffering',
  'approveChurchOffering', 'rejectChurchOffering', 'postChurchOffering',
  'approvechurchoffering', 'rejectchurchoffering', 'postchurchoffering',
  'getOrganizationDepartments', 'saveDepartment', 'importOrganizationMembers', 'importDepartments',
  'deleteDepartment', 'savePosition', 'saveDepartmentMember', 'removeDepartmentMember',
  'saveDepartmentMeeting', 'recordDepartmentAttendance', 'saveDepartmentOffering',
  'markDepartmentOfferingPaid', 'saveSpecialProgram', 'registerProgramParticipant', 'saveForeignVisitor',
  'getHotelServices', 'saveHotelRoom', 'saveHotelReservation', 'changeHotelReservationStatus',
  'saveHotelRoomMedia', 'saveHotelKeyDevice', 'saveHotelKeySlot', 'resolveHotelKeyCommand',
  'recordHotelCharge', 'recordHotelPayment', 'setHotelHousekeepingStatus',
  'updateStudentProfile', 'reissueParentOnboarding',
  'getSchoolClasses', 'saveSchoolClasses', 'resetSchoolClasses',
  'getAdmissionClasses', 'saveAdmissionClasses', 'resetAdmissionClasses',
  'getAccountsOverview', 'getAccountSnapshot', 'getHistoricalPaymentTemplateAccounts', 'importHistoricalPayments', 'recordManualPayment',
  'getWalletCardAccount', 'saveWalletCard', 'recordWalletPurchase',
  'getTuckShopCatalog', 'searchTuckShopCustomers', 'recordTuckShopStaffSale',
  'getAccountingRequisitionDocument',
  'saveAccountingJournal', 'saveAccountingExpense', 'saveAccountingBudget',
  'submitAccountingImprest', 'reviewAccountingImprest', 'issueAccountingImprest',
  'submitAccountingImprestRetirement', 'verifyAccountingImprestRetirement',
  'saveAccountingBank', 'saveAccountingReconciliation',
  'saveAccountingOpeningBalance', 'saveAccountingVendor', 'saveAccountingSupplierBill',
  'payAccountingSupplierBill', 'saveAccountingAsset', 'postAccountingDepreciation',
  'saveAccountingAdjustment',
  'importAccountingBankStatement', 'matchAccountingBankStatement',
  'savePayrollProfile', 'createPayrollProfilesFromStaff', 'importPayrollProfiles',
  'generatePayrollRun', 'requestPayrollTaxOverride', 'approvePayrollTaxOverride',
  'savePayrollRunStatus', 'payPayrollItem',
  'getStaffUsers', 'saveStaffUser', 'deleteStaffUser',
  'saveBrevoSettings', 'saveSchoolProfile', 'getSchoolProfile', 'resetBranchProfileOverrides'
]);

export function enforceDesktopDeviceActionScope(authentication, action, body) {
  const branchId = clean(authentication?.branchId);
  if (authentication?.type !== 'device' || !branchId) return body;
  if (!BRANCH_BOUND_DEVICE_ACTIONS.has(action)) {
    const error = new Error('This action has not been approved for branch-scoped desktop access. Use an organisation-wide desktop device.');
    error.status = 403;
    error.code = 'DESKTOP_DEVICE_ORGANISATION_WIDE_REQUIRED';
    throw error;
  }
  if (action !== 'saveSchoolProfile') return body;
  const branchBody = { ...body, SettingsScope: 'branch', settingsScope: 'branch' };
  // Older desktop builds bundled the shared branch registry into profile saves.
  // A branch-bound device may save only its branch overrides.
  delete branchBody.SchoolBranches;
  delete branchBody.schoolBranches;
  delete branchBody.ActiveBranchId;
  delete branchBody.activeBranchId;
  return branchBody;
}

async function verifyDesktopActor(env, action, body) {
  if (!VERIFIED_ACTOR_ACTIONS.has(action)) return body;
  const actor = await resolveAuthoritativeDesktopActorForEnv(env, body).catch((error) => {
    error.status = error.status || 503;
    throw error;
  });
  return applyAuthoritativeActor(body, actor);
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

export function financialRowsByIdentity(rows) {
  const index = new Map();
  rows.forEach((row, position) => {
    const accountRef = referenceIdentityKey(row.AccountRef);
    const admissionNo = referenceIdentityKey(row.AdmissionNo);
    const application = referenceIdentityKey(row.ApplicationReference || row.ApplicationID);
    const keys = [
      accountRef && `ref:${accountRef}`,
      !accountRef && admissionNo && `admission:${admissionNo}`,
      application && `application:${application}`
    ].filter(Boolean);
    keys.forEach((key) => {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(position);
    });
  });
  return (account) => {
    const keys = [
      referenceIdentityKey(account.AccountRef) && `ref:${referenceIdentityKey(account.AccountRef)}`,
      referenceIdentityKey(account.AdmissionNo) && `admission:${referenceIdentityKey(account.AdmissionNo)}`,
      referenceIdentityKey(account.ApplicationReference || account.ApplicationID) &&
        `application:${referenceIdentityKey(account.ApplicationReference || account.ApplicationID)}`
    ].filter(Boolean);
    const positions = [...new Set(keys.flatMap((key) => index.get(key) || []))].sort((a, b) => a - b);
    return positions.map((position) => rows[position])
      .filter((row) => financialRowMatchesLinkedApplication(row, account));
  };
}

export function studentMatchesEnrollmentApplication(student = {}, application = {}) {
  const studentFirst = normalizeReferenceText(pick(student, ['FirstName', 'firstName', 'GivenName']));
  const studentSurname = normalizeReferenceText(pick(student, ['Surname', 'surname', 'LastName', 'FamilyName']));
  const applicationFirst = normalizeReferenceText(pick(application, ['FirstName', 'firstName', 'GivenName']));
  const applicationSurname = normalizeReferenceText(pick(application, ['Surname', 'surname', 'LastName', 'FamilyName']));
  if (studentFirst && studentSurname && applicationFirst && applicationSurname) {
    if (studentFirst !== applicationFirst || studentSurname !== applicationSurname) return false;
  } else {
    const studentName = normalizeReferenceText(pick(student, ['DisplayName', 'ApplicantName', 'Name']));
    const applicationName = normalizeReferenceText(displayNameFromApplication(application));
    const nameMatches = studentName && applicationName && (
      studentName === applicationName ||
      (applicationFirst && applicationSurname &&
        studentName.startsWith(applicationFirst) && studentName.endsWith(applicationSurname))
    );
    if (!nameMatches) {
      return false;
    }
  }
  const studentDob = clean(pick(student, ['DateOfBirth', 'dateOfBirth', 'DOB']));
  const applicationDob = clean(pick(application, ['DateOfBirth', 'dateOfBirth', 'DOB']));
  return !(studentDob && applicationDob && studentDob !== applicationDob);
}

function enrollmentConflict(message, code) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  return error;
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
  const rules = (Array.isArray(ruleValue) ? ruleValue : String(ruleValue ?? '').split(','))
    .map((part) => normalizeMatchText(part));
  if (!rules.some(Boolean) || rules.some((rule) => rule === 'all' || rule === '*')) return true;
  if (!normalizeMatchText(actualValue) && allowBlankActual) return true;
  if (!normalizeMatchText(actualValue)) return false;
  const actualVariants = feeMatchVariants(actualValue);
  const ruleVariants = [];
  rules.forEach((part) => {
    feeMatchVariants(part).forEach((variant) => ruleVariants.push(variant));
  });
  return ruleVariants.some((variant) => actualVariants.includes(variant));
}

function feeClassRuleMatches(ruleValue, actualValue) {
  const rule = normalizeMatchText(ruleValue);
  if (!rule || rule === 'all' || rule === '*') return true;
  return String(ruleValue).split(',').some((part) => classNamesMatch(part, actualValue));
}

export function feeMatchesApplication(fee, app) {
  if (!feeMatchesBranch(fee, app)) return false;
  const appClass = app.ClassApplyingFor || app.ClassAdmitted || app.ClassName || '';
  const appType = app.StudentType || '';
  const appSession = app.AcademicSession || '';
  const appTerm = app.Term || '';
  const appGender = app.Gender || '';
  const enrollmentCategory = resolveStudentEnrollmentCategory(app);
  const academicProgress = app.AcademicProgress || app.ProgressCategory || 'Promoted';
  if (normalizeMatchText(academicProgress) === 'repeating' && /book|uniform|school wear/.test(normalizeMatchText(`${fee.FeeCategory || ''} ${fee.FeeName || ''}`))) return false;
  return feeClassRuleMatches(fee.ClassName, appClass) &&
    feeFieldMatches(fee.StudentType, appType) &&
    feeBillingCategoryMatches(fee, app) &&
    feeFieldMatches(fee.Gender || 'All', appGender) &&
    feeFieldMatches(fee.EnrollmentCategory || 'All', enrollmentCategory, true) &&
    feeFieldMatches(fee.AcademicProgress || 'All', academicProgress, true) &&
    feeFieldMatches(fee.AcademicSession, appSession) &&
    feeFieldMatches(fee.Term, appTerm);
}

export function isNewIntakeApplication(app = {}) {
  const byAdmissionYear = admissionYearEnrollmentCategory(app);
  if (byAdmissionYear) return byAdmissionYear === 'New Intake';
  const value = normalizeMatchText(app.EnrollmentCategory || app.IntakeCategory || '');
  if (value) return ['new intake', 'new', 'newly admitted', 'new admission'].includes(value);
  const resultStatus = normalizeMatchText(app.ResultStatus || app.AdmissionDecision || '');
  const applicationStatus = normalizeMatchText(app.Status || '');
  return resultStatus === 'admitted' || ['admitted', 'accepted', 'admission letter sent'].includes(applicationStatus);
}

export function admissionIntakeClassification(record = {}) {
  return {
    EnrollmentCategory: 'New Intake',
    AcademicProgress: clean(record.AcademicProgress || record.ProgressCategory) || 'New Intake'
  };
}

export function resolveStudentEnrollmentCategory(student = {}, application = {}) {
  const byAdmissionYear = admissionYearEnrollmentCategory(student, {
    AcademicSession: student.AcademicSession || application.AcademicSession,
    Term: student.Term || application.Term
  });
  if (byAdmissionYear) return byAdmissionYear;
  const configured = clean(student.EnrollmentCategory || student.IntakeCategory);
  const studentReference = clean(student.ApplicationReference || student.applicationReference);
  const applicationReference = clean(
    application.ApplicationReference || application.ApplicationID || application.applicationReference || application.__id
  );
  const studentSession = normalizeMatchText(student.AcademicSession || '');
  const applicationSession = normalizeMatchText(application.AcademicSession || '');
  const sameAdmissionSession = !studentSession || !applicationSession || studentSession === applicationSession;
  const wasPromoted = Boolean(clean(student.PromotedAt || student.PromotionHistory || student.PreviousClass));
  const linkedAdmission = Boolean(
    studentReference && applicationReference &&
    sameReferenceIdentity(studentReference, applicationReference) &&
    sameAdmissionSession &&
    !wasPromoted &&
    (
      isNewIntakeApplication(application) ||
      yesNo(application.Enrolled) === 'YES' ||
      ['accepted', 'admission letter sent', 'enrolled'].includes(normalizeMatchText(application.Status || ''))
    )
  );
  if (linkedAdmission) return 'New Intake';
  return configured || (isNewIntakeApplication(student) ? 'New Intake' : 'Returning');
}

function termRank(value) {
  const term = normalizeMatchText(value);
  if (!term || term === 'all' || term === '*') return 0;
  if (term.includes('first') || term === '1' || term === 'term1') return 1;
  if (term.includes('second') || term === '2' || term === 'term2') return 2;
  if (term.includes('third') || term === '3' || term === 'term3') return 3;
  return 0;
}

function feeMatchesAccountPeriod(fee, app, { enrollmentCategoryOverride = '' } = {}) {
  if (!feeMatchesBranch(fee, app)) return false;
  const appClass = app.ClassApplyingFor || app.ClassAdmitted || app.ClassName || '';
  const appType = app.StudentType || '';
  const appSession = app.AcademicSession || '';
  const appTerm = app.Term || '';
  if (normalizeMatchText(app.AcademicProgress || 'Promoted') === 'repeating' && /book|uniform|school wear/.test(normalizeMatchText(`${fee.FeeCategory || ''} ${fee.FeeName || ''}`))) return false;
  if (!feeClassRuleMatches(fee.ClassName, appClass)) return false;
  if (!feeFieldMatches(fee.StudentType, appType)) return false;
  if (!feeBillingCategoryMatches(fee, app)) return false;
  if (!feeFieldMatches(fee.Gender || 'All', app.Gender || '')) return false;
  const enrollmentCategory = enrollmentCategoryOverride || resolveStudentEnrollmentCategory(app);
  if (!feeFieldMatches(fee.EnrollmentCategory || 'All', enrollmentCategory, true)) return false;
  if (!feeFieldMatches(fee.AcademicProgress || 'All', app.AcademicProgress || 'Promoted', true)) return false;
  if (!feeFieldMatches(fee.AcademicSession, appSession)) return false;
  const feeTerm = normalizeMatchText(fee.Term || 'All');
  if (!feeTerm || feeTerm === 'all' || feeTerm === '*') return true;
  return feeFieldMatches(fee.Term, appTerm);
}

function feeBillingSpecificity(fee, app) {
  const rules = feeBillingCategories(fee);
  const actual = normalizeMatchText(app.BillingCategory || 'Regular');
  if (rules.some((rule) => ['all', '*'].includes(normalizeMatchText(rule)))) return 0;
  return feeFieldMatches(rules, actual || 'Regular', true) ? 2 : 0;
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
    if (isFullScholarship(app.BillingCategory) && !feeBillingCategoryMatches(fee, app)) return;
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

export function matchingFullScholarshipFeeItems(feeRows, account = {}) {
  if (!isFullScholarship(account.BillingCategory)) return [];
  return applyBillingCategoryOverrides(feeRows.map(normalizeFeeItem).filter((fee) =>
    yesNo(fee.Active) === 'YES' && asMoneyNumber(fee.Amount) > 0 &&
    !isWalletFee(fee) && !isAcceptanceFeeLike(fee) && feeMatchesApplication(fee, account)
  ), account);
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

function isStorePurchase(row) {
  const metadata = parseMetadata(row && row.Metadata);
  const nested = metadata.metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
  const storeType = normalizeMatchText(row && row.StoreType || metadata.storeType || nested.storeType);
  const storeCart = Array.isArray(metadata.storeCart) ? metadata.storeCart :
    (Array.isArray(nested.storeCart) ? nested.storeCart : []);
  return ['store', 'uniform store', 'book store', 'bookstore'].includes(storeType) ||
    storeCart.some((item) => ['store', 'uniform store', 'book store', 'bookstore'].includes(normalizeMatchText(item && item.StoreType))) ||
    ['store', 'uniform store', 'book store', 'bookstore'].includes(normalizeMatchText(row && row.Department)) ||
    normalizeMatchText(row && row.FeeCategory) === 'store' ||
    clean(row && row.FeeCode).toUpperCase() === 'STORE_CART' ||
    normalizeMatchText(row && row.EntryType).includes('store');
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
  if (!feeMatchesBranch(fee, app)) return false;
  const appClass = app.ClassApplyingFor || app.ClassAdmitted || app.ClassName || '';
  const appType = app.StudentType || '';
  const appSession = app.AcademicSession || '';
  if (normalizeMatchText(app.AcademicProgress || 'Promoted') === 'repeating' && /book|uniform|school wear/.test(normalizeMatchText(`${fee.FeeCategory || ''} ${fee.FeeName || ''}`))) return false;
  return feeClassRuleMatches(fee.ClassName, appClass) &&
    feeFieldMatches(fee.StudentType, appType) &&
    feeBillingCategoryMatches(fee, app) &&
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

// Only unrestricted school/account receipts can settle another term's school
// invoice. An earmarked store, club or service payment must stay with its own
// purchase even when legacy records incorrectly label it as a school fee.
export function isAvailableSchoolCreditReceipt(row) {
  if (!row || isWalletLedger(row) || isStorePurchase(row) || isOptionalSubscriptionFee(row)) return false;
  const code = clean(row.FeeCode).toUpperCase();
  if (/^(CLINIC|KITCHEN|BUS|CLUB|TRANSPORT|OPTIONAL|STORE)[_-]/.test(code)) return false;
  return isSchoolInvoiceCredit(row) || code === 'TUITION';
}

export function isSchoolFeeInvoice(row) {
  if (!row || !isSchoolFeeCategory(row.FeeCategory) || isWalletLedger(row) ||
    isStorePurchase(row) || isOptionalSubscriptionFee(row)) return false;
  const code = clean(row.FeeCode).toUpperCase();
  return !/^(CLINIC|KITCHEN|BUS|CLUB|TRANSPORT|OPTIONAL|STORE)[_-]/.test(code);
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
  const studentScopePath = identityScopePathForCollection(app, 'students');
  const refs = [
    accountRefFromApplication(app),
    app.ApplicationReference,
    app.ApplicationID,
    app.AdmissionNo,
    app.AdmissionNumber
  ].map(clean).filter(Boolean);
  for (const ref of refs) {
    if (studentScopePath) {
      const direct = await getSelectedIdentityRow(env, 'students', ref, studentScopePath);
      if (direct) return normalizeStudent(direct);
      for (const field of ['AdmissionNo', 'AccountRef', 'ApplicationReference']) {
        const rows = await querySchoolCollection(env, 'students', {
          filters: [{ field, op: '==', value: ref }],
          limit: 2,
          scopePath: studentScopePath
        });
        if (rows.length === 1) return normalizeStudent(rows[0]);
      }
    } else {
      const found = await findStudent(env, ref, ref);
      if (found) return normalizeStudent(found);
    }
  }
  const appName = normalizeReferenceText(displayNameFromApplication(app));
  const appEmail = normalizeMatchText(app.VerificationEmail || app.ParentEmail || app.Email || '');
  if (!appName || !appEmail) return null;
  const candidates = await querySchoolCollection(env, 'students', {
    filters: [{ field: 'ParentEmail', op: '==', value: lower(appEmail) }],
    ...(studentScopePath ? { scopePath: studentScopePath } : {})
  });
  const found = candidates.map(normalizeStudent).find((student) => {
    const studentName = normalizeReferenceText(student.DisplayName || student.ApplicantName || '');
    const studentEmail = normalizeMatchText(student.ParentEmail || student.Email || '');
    return studentName === appName && studentEmail === appEmail;
  });
  return found || null;
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
  if (!documentStorageConfigured(env)) {
    const err = new Error('Cloudflare R2 document storage is not connected.');
    err.status = 500;
    throw err;
  }
  const application = await findApplicationForAdmissionDocument(env, body);
  if (!application) {
    const err = new Error('The matching database application was not found.');
    err.status = 404;
    throw err;
  }
  const applicationReference = pick(application, ['ApplicationReference', 'ApplicationID', '__id']);
  const existingUrl = clean(application[definition.urlField]);
  const scopeMatch = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\//i.exec(clean(application.__scopePath));
  const operationId = `generated-${await sha256Hex(`${applicationReference}|${body.DocumentType}|${fileBase64}`)}`;
  const stored = await putStoredDocument(env, {
    category: 'generated-admissions',
    branchId: scopeMatch?.[1] || application.BranchId || 'main',
    schoolSection: scopeMatch?.[2] || application.SchoolSection || 'all',
    ownerId: applicationReference,
    documentType: clean(body.DocumentType),
    fileName,
    mimeType: 'application/pdf',
    fileBase64,
    operationId,
    customMetadata: { generatedBy: clean(body.UserRole || body.UpdatedBy || 'desktop') }
  });
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
  if (existingUrl && existingUrl !== stored.documentUrl) {
    await deleteStoredDocument(env, existingUrl).catch(() => null);
  }
  return {
    ok: true,
    message: `${definition.label} customized PDF stored for parent download.`,
    applicationReference,
    documentUrl: clean(stored.documentUrl),
    application: saved
  };
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

function identityScopePathForCollection(value, collection) {
  const path = clean(value && typeof value === 'object' ? value.__scopePath : value)
    .replace(/^\/+|\/+$/g, '');
  if (!path) return '';
  if (/^(?:students|applications)$/i.test(path)) return collection;
  return validatedIdentityScopePath(
    path.replace(/\/(?:students|applications)$/i, `/${collection}`),
    collection
  );
}

function identityRecordBranch(row = {}) {
  const explicit = clean(row.BranchId || row.branchId);
  if (explicit) return safeScopeId(explicit);
  const match = clean(row.__scopePath).match(/schoolBranches\/([^/]+)/i);
  return safeScopeId(match?.[1] || 'main');
}

function identityRecordSection(row = {}) {
  const match = clean(row.__scopePath).match(/\/sections\/([^/]+)/i);
  return schoolSectionFor({
    ...row,
    SchoolSection: clean(row.SchoolSection || row.schoolSection || match?.[1])
  });
}

async function getSelectedIdentityRow(env, collection, accountRef, scopePath = '') {
  const documentId = safeDocumentId(accountRef);
  if (!documentId) return null;
  const requestedScopePath = clean(scopePath);
  const path = validatedIdentityScopePath(scopePath, collection);
  if (requestedScopePath && !path) return null;
  if (path) {
    const row = await getDocument(env, path, documentId).catch(() => null);
    if (row) return { ...row, __scopePath: path };
    return null;
  }
  return getSchoolDocumentById(env, collection, documentId).catch(() => null);
}

export function shouldResolveStudentForPayable(application = {}, requestedSourceType = '') {
  return normalizeMatchText(requestedSourceType) === 'student' ||
    yesNo(application.Enrolled) === 'YES' ||
    normalizeMatchText(application.Status) === 'enrolled';
}

function identityUsesParentEmail(identity = {}, email = '') {
  const requestedEmail = lower(email);
  return Boolean(requestedEmail && [
    identity.ParentEmail,
    identity.ParentEmailAddress,
    identity.GuardianEmail,
    identity.FatherEmail,
    identity.MotherEmail,
    identity.VerificationEmail,
    identity.Email
  ].some((value) => lower(value) === requestedEmail));
}

export async function getPayableFees(env, body = {}) {
  const email = lower(body.Email || body.email);
  const code = clean(body.VerificationCode || body.code).toUpperCase();
  const authenticatedParent = lower(body.AuthenticatedParentEmail) === email;
  const requestedAccountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const requestedSourceType = normalizeMatchText(body.SourceType || body.sourceType);
  const requestedScopePath = clean(body.ScopePath || body.scopePath || body.__scopePath);
  if (!email || (!code && !authenticatedParent)) {
    const err = new Error('Email and password or verification code are required.');
    err.status = 400;
    throw err;
  }

  const directCollection = requestedSourceType === 'application' ? 'applications' : 'students';
  const requestedDirectScopePath = requestedScopePath
    ? validatedIdentityScopePath(requestedScopePath, directCollection)
    : '';
  if (requestedScopePath && !requestedDirectScopePath) {
    const err = new Error('The selected child scope is invalid.');
    err.status = 400;
    throw err;
  }
  const requestedStudentScopePath = identityScopePathForCollection(
    requestedDirectScopePath,
    'students'
  );
  const requestedApplicationScopePath = identityScopePathForCollection(
    requestedDirectScopePath,
    'applications'
  );
  const directIdentity = requestedAccountRef
    ? await getSelectedIdentityRow(
        env,
        directCollection,
        requestedAccountRef,
        requestedDirectScopePath
      )
    : null;
  const directIdentityValid = directIdentity && directCollection === 'applications'
    ? identityUsesParentEmail(directIdentity, email) &&
      (authenticatedParent || clean(directIdentity.VerificationCode).toUpperCase() === code)
    : directIdentity &&
      identityUsesParentEmail(directIdentity, email) &&
      (authenticatedParent || studentLoginCodes(directIdentity).includes(code));
  const [firestoreApplications, firestoreStudents, firestoreSales] = directIdentityValid
    ? [
      directCollection === 'applications' ? [directIdentity] : [],
      directCollection === 'students' ? [directIdentity] : [],
      []
    ]
    : await Promise.all([
      queryParentIdentityRows(env, 'applications', email, code, ['VerificationCode']),
      queryParentIdentityRows(env, 'students', email, code, ['ParentLoginCode', 'VerificationCode', 'LoginCode']),
      queryCollection(env, 'formSales', {
        filters: [{ field: 'VerificationCode', op: '==', value: code }]
      }).catch(() => [])
    ]);
  const applications = firestoreApplications.map(normalizeApplication);
  const students = firestoreStudents.map(normalizeStudent);
  const sales = firestoreSales;
  const loginApp = applications.find((row) => identityUsesParentEmail(row, email) &&
    (authenticatedParent || clean(row.VerificationCode).toUpperCase() === code));
  const loginStudent = students.find((row) => identityUsesParentEmail(row, email) &&
    (authenticatedParent || studentLoginCodes(row).includes(code)));
  const saleMatch = sales.some((row) => {
    return lower(pick(row, ['Email', 'email'])) === email &&
      clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === code;
  });
  if (!loginApp && !loginStudent && !saleMatch) {
    const err = new Error('Application not found for that email/code.');
    err.status = 404;
    throw err;
  }

  const rowsInScope = (rows, scopePath) => {
    if (!requestedScopePath) return rows;
    if (!scopePath) return [];
    return rows.filter((row) => lower(row.__scopePath) === lower(scopePath));
  };
  const uniqueMatch = (rows, predicate) => {
    const matches = rows.filter(predicate);
    return matches.length === 1 ? matches[0] : null;
  };

  let app = requestedAccountRef ? null : loginApp;
  let accountRef = requestedAccountRef || accountRefFromApplication(loginApp || {}) || loginStudent?.AdmissionNo || loginStudent?.AccountRef || '';
  let student = requestedAccountRef
    ? uniqueMatch(
        rowsInScope(students, requestedStudentScopePath),
        (row) => Boolean(findStudentByAccountRefInRows([row], requestedAccountRef))
      )
    : (loginStudent || null);
  let selectedApplication = null;
  if (student && student.ApplicationReference && !applications.length) {
    const linked = await getSelectedIdentityRow(
      env,
      'applications',
      student.ApplicationReference,
      identityScopePathForCollection(student, 'applications')
    );
    if (linked) applications.push(normalizeApplication(linked));
  }
  if (requestedAccountRef) {
    selectedApplication = uniqueMatch(
      rowsInScope(applications, requestedApplicationScopePath),
      (row) => (
        sameText(row.ApplicationReference || row.ApplicationID || row.__id, requestedAccountRef) ||
        referencesMatch(row.ApplicationReference || row.ApplicationID || row.__id, requestedAccountRef) ||
        sameText(row.AdmissionNo || row.AdmissionNumber, requestedAccountRef) ||
        referencesMatch(row.AdmissionNo || row.AdmissionNumber, requestedAccountRef)
      )
    );
  }
  if (student) {
    const parentEmailMatches = identityUsesParentEmail(student, email);
    const studentAppRef = clean(student.ApplicationReference);
    const studentApplicationScopePath = identityScopePathForCollection(student, 'applications');
    const linkedApplication = studentAppRef
      ? uniqueMatch(
          studentApplicationScopePath
            ? applications.filter((row) =>
                lower(row.__scopePath) === lower(studentApplicationScopePath)
              )
            : applications,
          (row) => (
            sameText(row.ApplicationReference || row.ApplicationID || row.__id, studentAppRef) ||
            referencesMatch(row.ApplicationReference || row.ApplicationID || row.__id, studentAppRef)
          )
        )
      : null;
    const linkedEmailMatches = linkedApplication && identityUsesParentEmail(linkedApplication, email);
    const selectedEmailMatches = selectedApplication && identityUsesParentEmail(selectedApplication, email);
    if (!parentEmailMatches && !linkedEmailMatches && !selectedEmailMatches && !saleMatch) {
      const err = new Error('The selected student is not linked to this parent email.');
      err.status = 403;
      throw err;
    }
    app = linkedApplication || selectedApplication || null;
  } else if (selectedApplication) {
    const selectedEmailMatches = identityUsesParentEmail(selectedApplication, email);
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
    billingApp.EnrollmentCategory = resolveStudentEnrollmentCategory(student, app);
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
    loadBranchFinanceRows(env, 'feeItems', feeBranchId(billingApp)),
    queryAccountRows(env, 'payments', accountRef),
    queryAccountRows(env, 'invoices', accountRef),
    queryAccountRows(env, 'ledger', accountRef)
  ]);
  const correctedInvoices = correctedPayableInvoices(invoiceRows, ledgerRows);
  ledgerRows = payableLedgerAfterPaymentCorrections(ledgerRows);
  const allFees = feeRowsForBranch(feeRows, feeBranchId(billingApp)).map(normalizeFeeItem)
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
    return isAvailableSchoolCreditReceipt(row) ? sum + asMoneyNumber(row.Credit) : sum;
  }, 0) : 0;
  const currentPeriodSchoolFeeCredit = currentTermRank ? paidLedgerRows.reduce((sum, row) => {
    return isAvailableSchoolCreditReceipt(row) && !isAcceptanceFeeLike(row) && rowIsCurrentPeriod(row)
      ? sum + asMoneyNumber(row.Credit) : sum;
  }, 0) : 0;
  const acceptanceLedgerCredit = paidLedgerRows.reduce((sum, row) => {
    return isAcceptanceFeeLike(row) ? sum + asMoneyNumber(row.Credit) : sum;
  }, 0);
  const acceptanceCreditAppliedSeparately = currentTermRank === 1
    ? Math.min(acceptanceLedgerCredit, acceptanceCreditRemaining)
    : 0;
  const carryForwardSchoolCredit = calculateCarryForwardSchoolCredit({
    schoolFeeRelatedCredit,
    currentPeriodSchoolFeeCredit,
    priorSchoolFeeCharge,
    accountCreditDebits,
    acceptanceCreditAppliedSeparately
  });
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

  const calculatedFees = matchedFees.map((fee) => {
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
    // A corrected receipt can span several invoices. Their net allocations are
    // authoritative; counting both a settled invoice and the receipt again
    // would hide the balance reopened on the other invoice.
    const correctedPaid = correctedInvoicePaidAmount(correctedInvoices, copy);
    if (correctedPaid !== null && !optionalSubscription && !isWalletFee(fee)) paid = correctedPaid;
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
  });
  const fees = calculatedFees.filter((fee) => isWalletFee(fee) || asMoneyNumber(fee.Amount) > 0);

  if (priorSchoolFeeBalance > 0 && currentTermRank > 1) {
    const firstSchoolFee = fees.find((fee) => !isWalletFee(fee) && normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee') || matchedFees.find((fee) => normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee') || {};
    const previousBalanceFee = {
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
    };
    fees.unshift(previousBalanceFee);
    calculatedFees.unshift(previousBalanceFee);
  }

  const schoolFeeBreakdown = calculatedFees.filter((fee) =>
    !isWalletFee(fee) &&
    normalizeMatchText(fee.FeeCategory || 'School Fee') === 'school fee' &&
    asMoneyNumber(fee.OriginalAmount || fee.Amount) > 0
  );
  const schoolFeeTotal = schoolFeeBreakdown.reduce((total, fee) => total + asMoneyNumber(fee.Amount), 0);
  const identityScope = student || selectedApplication || app || billingApp;
  return {
    ok: true,
    message: 'Payable fees loaded from the database.',
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
      BranchId: identityRecordBranch(identityScope),
      SchoolSection: identityRecordSection(identityScope),
      ScopePath: clean(identityScope.__scopePath),
      BillingSource: student ? 'Students' : 'Applications'
    },
    fees,
    schoolFeeBreakdown,
    schoolFeeTotal
  };
}

export async function getAccountsOverview(env, preloaded = {}, requestedScope = null) {
  const provided = (key) => Array.isArray(preloaded?.[key]);
  const branchId = accountingRequestBranch(requestedScope || {});
  const branchRows = (rows) => accountingRowsForBranch(rows, branchId);
  const schoolScope = { branchId, schoolSectionAccess: requestedScope?.UserSchoolSectionAccess || requestedScope?.schoolSectionAccess };
  // Preloaded inputs are an already resolved snapshot (including one-account
  // calculations); live desktop reads resolve the authoritative branch here.
  const schoolProfile = preloaded?.schoolProfile || await loadFinanceSchoolProfile(env, branchId);
  const financeSession = clean(schoolProfile?.CurrentAcademicSession);
  const financeRows = (collection) => {
    if (!financeSession) {
      const error = new Error('Set the current academic session in School Profile before opening Accounts.');
      error.status = 409;
      throw error;
    }
    return loadBranchFinanceRows(env, collection, branchId, {
      filters: [{ field: 'AcademicSession', op: 'in', value: [financeSession, '', 'All'] }],
      pageSize: 500,
      maxRows: 15000
    });
  };
  const [loadedAccounts, loadedPayments, loadedInvoices, loadedFeeItems, loadedLedger, loadedApplications, loadedStudents, billingCategories, loadedAccountSummaries] = await Promise.all([
    provided('accounts') ? Promise.resolve(preloaded.accounts) : loadBranchFinanceRows(env, 'accounts', branchId),
    provided('payments') ? Promise.resolve(preloaded.payments) : financeRows('payments'),
    provided('invoices') ? Promise.resolve(preloaded.invoices) : financeRows('invoices'),
    provided('feeItems') ? Promise.resolve(preloaded.feeItems) : loadBranchFinanceRows(env, 'feeItems', branchId),
    provided('ledger') ? Promise.resolve(preloaded.ledger) : financeRows('ledger'),
    provided('applications') ? Promise.resolve(preloaded.applications) : listSchoolCollection(env, 'applications', schoolScope),
    provided('students') ? Promise.resolve(preloaded.students) : listSchoolCollection(env, 'students', schoolScope),
    provided('billingCategories') ? Promise.resolve(preloaded.billingCategories) : listCollection(env, 'billingCategories'),
    provided('accountSummaries') ? Promise.resolve(preloaded.accountSummaries)
      : provided('payments') && provided('invoices') && provided('ledger') ? Promise.resolve([])
      : loadBranchFinanceRows(env, 'accountSummaries', branchId)
  ]);
  const accounts = branchRows(loadedAccounts);
  const feeItems = feeRowsForBranch(loadedFeeItems, branchId);
  const payments = branchRows(loadedPayments);
  const invoices = branchRows(loadedInvoices);
  const storedLedger = branchRows(loadedLedger);
  const applications = provided('applications') ? branchRows(loadedApplications) : loadedApplications;
  const students = provided('students') ? branchRows(loadedStudents) : loadedStudents;
  const resolvedSchoolProfile = schoolProfile || {};
  const normalizedPayments = payments.map(normalizePayment);
  const normalizedInvoices = invoices.map(normalizeInvoice);
  const normalizedStoredLedger = storedLedger.map(normalizeLedger);
  const accountMap = new Map();
  const accountAliasMap = new Map();
  const studentWalletProfiles = new Map();
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
  const putAccount = (row, studentWallet = null) => {
    const normalized = normalizeAccount(row || {});
    const refs = accountRefsFrom(normalized);
    const accountRef = clean(normalized.AccountRef || refs[0]);
    if (!accountRef) return;
    const key = accountKeyForRefs(refs, accountRef);
    const existing = accountMap.get(key) || {};
    if (studentWallet) studentWalletProfiles.set(key, studentWallet);
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
      AcademicSession: clean(existing.AcademicSession || normalized.AcademicSession || resolvedSchoolProfile.CurrentAcademicSession),
      Term: clean(existing.Term || normalized.Term || resolvedSchoolProfile.CurrentTerm) || 'First Term',
      BranchId: clean(existing.BranchId || normalized.BranchId),
      SchoolSection: clean(existing.SchoolSection || normalized.SchoolSection),
      StudentScopePath: clean(existing.StudentScopePath || normalized.StudentScopePath),
      Status: clean(existing.Status || normalized.Status),
      ResultStatus: clean(existing.ResultStatus || normalized.ResultStatus),
      OfferSent: clean(existing.OfferSent || normalized.OfferSent),
      Enrolled: clean(existing.Enrolled || normalized.Enrolled),
      AdmissionLetterSent: clean(existing.AdmissionLetterSent || normalized.AdmissionLetterSent)
    });
    // Cards live on the student register, not legacy accounting snapshots.
    // Preserve an explicitly unassigned card too, and remove stale aliases so
    // the desktop's all-field search cannot match a replaced card.
    const walletProfile = studentWalletProfiles.get(key);
    if (walletProfile) {
      const account = accountMap.get(key);
      Object.assign(account, walletProfile);
      delete account.walletCardId;
      delete account.walletCardStatus;
    }
    registerAccountAliases(key, accountRefsFrom(accountMap.get(key)));
  };
  const applicationCreatedMap = new Map();
  const normalizedApplications = applications.map((row) => normalizeApplication(row, resolvedSchoolProfile));
  const applicationByReference = new Map();
  normalizedApplications.forEach((app) => {
    const reference = clean(app.ApplicationReference || app.ApplicationID || app.__id).toLowerCase();
    if (reference) applicationByReference.set(reference, app);
  });
  normalizedApplications.forEach((app) => {
    const refs = accountRefsFrom(app);
    const createdAt = timestampMs(app.SubmittedAt || app.CreatedAt || app.UpdatedAt);
    refs.forEach((ref) => {
      const key = safeDocumentId(ref).toLowerCase();
      if (key && createdAt) applicationCreatedMap.set(key, createdAt);
    });
  });
  selectStudentBillingProfiles(students).map((row) => normalizeStudent(row, resolvedSchoolProfile)).forEach((student) => putAccount({
    AccountRef: student.AdmissionNo || student.ApplicationReference,
    ApplicationReference: student.ApplicationReference,
    AdmissionNo: student.AdmissionNo,
    DisplayName: student.DisplayName || student.ApplicantName,
    ClassName: student.ClassName || student.ClassAdmitted,
    StudentType: student.StudentType,
    BillingCategory: student.BillingCategory,
    Gender: student.Gender,
    EnrollmentCategory: resolveStudentEnrollmentCategory(
      student,
      applicationByReference.get(clean(student.ApplicationReference).toLowerCase()) || {}
    ),
    AcademicProgress: student.AcademicProgress,
    AcademicSession: student.AcademicSession,
    Term: student.Term,
    BranchId: student.BranchId,
    SchoolSection: student.SchoolSection,
    StudentScopePath: student.__scopePath,
    Status: student.Status || 'Active',
    Enrolled: 'YES'
  }, studentWalletProfile(student)));
  // Student register identity and eligibility fields are authoritative. Legacy
  // account rows may still say New Intake after a CSV import, so merge them second.
  accounts.map(normalizeAccount).forEach((row) => putAccount(row));
  normalizedApplications.forEach((app) => putAccount({
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
    BranchId: app.BranchId,
    SchoolSection: app.SchoolSection,
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
    BranchId: row.BranchId,
    SchoolSection: row.SchoolSection,
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
  const accountSummaryByRef = new Map(loadedAccountSummaries.map((row) => [
    referenceIdentityKey(row.AccountRef || row.__id), row
  ]));
  const invoicesForAccount = financialRowsByIdentity(normalizedInvoices);
  const storedLedgerForAccount = financialRowsByIdentity(normalizedStoredLedger);
  const ledgerForAccount = financialRowsByIdentity(ledgerRows);
  const accountRows = Array.from(accountMap.values()).map((account) => {
    const refs = accountRefsFrom(account);
    const allPeriodSummary = calculateAccountFinancialSummary(
      invoicesForAccount(account),
      storedLedgerForAccount(account),
      account.AccountRef
    );
    let totalDebit = 0;
    let totalCredit = 0;
    let totalReceipts = 0;
    let accountCreditDebit = 0;
    let schoolFeeCredit = 0;
    let schoolFeeExpectedDebit = 0;
    let walletBalance = asMoneyNumber(account.WalletBalance);
    let lastPaymentAt = clean(account.LastPaymentAt);
    const countedLedgerKeys = new Set();
    ledgerForAccount(account).forEach((row) => {
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
      ExcessCredit: asMoneyNumber(accountSummaryByRef.get(referenceIdentityKey(account.AccountRef))?.CreditBalance ?? allPeriodSummary.CreditBalance),
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
    message: 'Accounts loaded from the database.',
    financeAcademicSession: financeSession,
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
  if (!['Bookstore', 'Uniform Store'].includes(storeType)) throw Object.assign(new Error('Choose a valid store.'), { status: 400 });
  await desktopSchoolOperationsActor(env, body, storeType === 'Bookstore' ? 'bookstore' : 'uniformStore');
  const scope = desktopInventoryScope(body);
  const [{ categories, items }, orders] = await Promise.all([ensureStoreCategories(env), listCollection(env, 'storeOrders')]);
  const matches = (row) => sameText(row.StoreType, storeType) && sameText(row.BranchId || 'main', scope.BranchId)
    && (!clean(row.OrganisationEdition) || sameText(row.OrganisationEdition, 'school'))
    && (sameText(scope.SchoolSection, 'All') || schoolSectionFor(row) === scope.SchoolSection.toLowerCase());
  return {
    ok: true, message: 'Store catalog and orders loaded.',
    procurementControlled: await loadProcurementInventoryControl(env, { ...scope, edition: 'school' }),
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
  await desktopSchoolOperationsActor(env, body, storeType === 'Bookstore' ? 'bookstore' : 'uniformStore', true);
  const scope = desktopInventoryScope(body);
  const category = await resolveStoreCategory(env, body, storeType);
  const items = (await listCollection(env, 'storeItems')).filter(row => sameText(row.StoreType, storeType)
    && sameText(row.BranchId || 'main', scope.BranchId)
    && (!clean(row.OrganisationEdition) || sameText(row.OrganisationEdition, 'school'))
    && (sameText(scope.SchoolSection, 'All') || schoolSectionFor(row) === scope.SchoolSection.toLowerCase()));
  const itemId = clean(body.ItemId || body.InventoryId);
  const matching = items.filter(row => itemId ? clean(row.__id) === itemId : sameText(row.ItemCode, itemCode));
  if (matching.length > 1) throw Object.assign(new Error('Several stock records have this code. Select the exact item.'), { status: 409 });
  if (itemId && !matching.length) throw Object.assign(new Error('The store item is outside your permitted workspace.'), { status: 404 });
  const existing = matching[0] || {};
  const schoolSection = clean(existing.SchoolSection) || (sameText(scope.SchoolSection, 'All') ? 'Secondary' : scope.SchoolSection);
  if (items.some(row => row.__id !== existing.__id && sameText(row.ItemCode, itemCode) && schoolSectionFor(row) === schoolSection.toLowerCase())) {
    throw Object.assign(new Error('That item code already exists in this branch and section.'), { status: 409 });
  }
  const className = canonicalConfiguredClass(clean(body.ClassName) || 'All', await configuredClassNames(env));
  const payload = {
    ...existing, StoreType: storeType, ItemCode: itemCode, ItemName: itemName,
    BranchId: scope.BranchId, SchoolSection: schoolSection, OrganisationEdition: 'school',
    CategoryId: category.CategoryId, Category: category.Name, Gender: clean(body.Gender) || 'All', ClassName: className,
    Size: clean(body.Size), Price: asMoneyNumber(body.Price), Quantity: Math.max(0, inventoryQuantityNumber(body.Quantity ?? existing.Quantity)),
    Active: yesNo(body.Active ?? 'YES') || 'YES', UpdatedAt: nowIso(), CreatedAt: existing.CreatedAt || nowIso()
  };
  delete payload.__id; delete payload.__name;
  assertProcurementInventoryEdit(existing, payload, { controlled: await loadProcurementInventoryControl(env, { ...scope, edition: 'school' }) });
  const documentId = clean(existing.__id) || safeDocumentId(`${storeType}-${itemCode}-${scope.BranchId}-${schoolSection}`);
  await batchCommitDocuments(env, [inventoryConditionalWrite('storeItems', documentId, payload, existing.__id ? existing : null)], { literalDocumentIds: true });
  return { ok: true, message: `${storeType} item saved.`, item: payload };
}

async function saveStoreCategoryAction(env, body) {
  const category = await saveStoreCategory(env, body, clean(body.RecordedBy || body.UpdatedBy));
  return { ok: true, message: clean(body.Active).toUpperCase() === 'NO' ? 'Category deactivated. Existing references were preserved.' : 'Category saved.', category };
}

async function deleteStoreCategoryAction(env, body) {
  const category = await deleteStoreCategory(env, body);
  return { ok: true, message: `Category "${category.Name}" deleted.`, category };
}

async function updateStoreOrderStatus(env, body) {
  const orderNo = clean(body.OrderNo || body.orderNo);
  const existing = await getDocumentByIdOrField(env, 'storeOrders', orderNo, 'OrderNo');
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

async function saveBrevoSettings(env, body, deploymentIdentity = null) {
  const senderName = clean(body.BrevoSenderName || body.SenderName || body.senderName);
  const senderEmail = clean(body.BrevoSenderEmail || body.SenderEmail || body.senderEmail);
  const submittedApiKey = clean(body.BrevoApiKey || body.ApiKey || body.apiKey);
  const environmentApiKeyConfigured = Boolean(clean(env.BREVO_API_KEY));
  const executiveSenderName = clean(body.ExecutiveSenderName || body.executiveSenderName);
  const executiveSenderEmail = clean(body.ExecutiveSenderEmail || body.executiveSenderEmail);
  const executiveReplyToEmail = clean(body.ExecutiveReplyToEmail || body.executiveReplyToEmail);
  const executiveReplyToName = clean(body.ExecutiveReplyToName || body.executiveReplyToName);
  const organisationScoped = ['faith', 'organization'].includes(clean(deploymentIdentity?.edition).toLowerCase());
  if (!senderEmail) {
    const err = new Error('An online email sender address is required.');
    err.status = 400;
    throw err;
  }
  const existing = await getDocument(env, 'settings', 'brevo').catch(() => null);
  const legacyDatabaseKeyConfigured = Boolean(clean(existing?.BrevoApiKey));
  const configuredEmailProvider = clean(env.EMAIL_PROVIDER).toLowerCase();
  const emailProvider = !configuredEmailProvider
    ? 'brevo'
    : ['brevo', 'gmail'].includes(configuredEmailProvider)
      ? configuredEmailProvider
      : 'unsupported';
  const gmailConnectionReady = Boolean(
    clean(env.GMAIL_OAUTH_CLIENT_ID)
    && clean(env.GMAIL_OAUTH_CLIENT_SECRET)
    && clean(env.GMAIL_REFRESH_TOKEN)
    && clean(env.GMAIL_CONNECTED_EMAIL)
  );
  const emailProviderConnectionReady = emailProvider === 'gmail'
    ? gmailConnectionReady
    : emailProvider === 'brevo'
      ? environmentApiKeyConfigured || legacyDatabaseKeyConfigured
      : false;
  const providerSettings = {
    EmailProvider: emailProvider,
    EmailProviderConnectionReady: emailProviderConnectionReady,
    GmailConnectedEmail: emailProvider === 'gmail' ? clean(env.GMAIL_CONNECTED_EMAIL) : ''
  };
  const now = nowIso();
  const senderFields = organisationScoped ? {
    OrganisationSenderName: senderName,
    OrganisationSenderEmail: senderEmail,
    OrganisationReplyToEmail: clean(body.BrevoReplyToEmail || body.ReplyToEmail),
    OrganisationReplyToName: clean(body.BrevoReplyToName || body.ReplyToName),
    OrganisationExecutiveSenderName: executiveSenderName,
    OrganisationExecutiveSenderEmail: executiveSenderEmail,
    OrganisationExecutiveReplyToEmail: executiveReplyToEmail,
    OrganisationExecutiveReplyToName: executiveReplyToName
  } : {
    BrevoSenderName: senderName,
    BrevoSenderEmail: senderEmail,
    BrevoReplyToEmail: clean(body.BrevoReplyToEmail || body.ReplyToEmail),
    BrevoReplyToName: clean(body.BrevoReplyToName || body.ReplyToName),
    ExecutiveSenderName: executiveSenderName,
    ExecutiveSenderEmail: executiveSenderEmail,
    ExecutiveReplyToEmail: executiveReplyToEmail,
    ExecutiveReplyToName: executiveReplyToName
  };
  const payload = {
    ...senderFields,
    SenderScope: organisationScoped ? 'organisation' : 'school',
    UpdatedAt: now,
    UpdatedBy: clean(body.UserRole || body.UpdatedBy || body.updatedBy) || 'Super Admin'
  };
  const branchId = clean(
    body.DeviceBranchId
    || (clean(body.SettingsScope || body.settingsScope).toLowerCase() === 'branch'
      ? body.BranchId || body.branchId
      : '')
  );
  if (branchId) {
    const defaults = (await getSchoolProfile(env)).profile;
    const saved = await saveBranchProfileOverrides(env, {
      branchId,
      defaultProfile: defaults,
      submittedProfile: senderFields,
      updatedBy: payload.UpdatedBy
    });
    const credentialSource = environmentApiKeyConfigured
      ? 'cloudflare-secret'
      : (legacyDatabaseKeyConfigured ? 'legacy-database' : 'not-configured');
    return {
      ok: true,
      message: `${saved.branch.name} email sender settings saved.`,
      settings: {
        ...senderFields,
        ...providerSettings,
        SenderScope: 'branch',
        EffectiveBranchId: saved.branch.id,
        HasBrevoApiKey: environmentApiKeyConfigured || legacyDatabaseKeyConfigured,
        CredentialSource: credentialSource,
        LegacyCredentialMigrationRequired: legacyDatabaseKeyConfigured && !environmentApiKeyConfigured,
        SubmittedCredentialIgnored: Boolean(submittedApiKey)
      }
    };
  }
  // Use a field-mask patch so a pre-existing database key is not deleted
  // automatically. New or submitted credentials are never written here.
  await patchDocumentFields(env, 'settings', 'brevo', payload);
  const credentialSource = environmentApiKeyConfigured
    ? 'cloudflare-secret'
    : (legacyDatabaseKeyConfigured ? 'legacy-database' : 'not-configured');
  return {
    ok: true,
    message: emailProvider === 'gmail'
      ? (emailProviderConnectionReady
        ? 'Email sender settings saved. Google Workspace / Gmail is active for online delivery.'
        : 'Email sender settings saved, but the Google email connection needs to be completed again.')
      : credentialSource === 'legacy-database'
      ? 'Brevo sender settings saved. Migrate the legacy database credential to the BREVO_API_KEY Cloudflare secret.'
      : (credentialSource === 'not-configured'
        ? 'Brevo sender settings saved, but online delivery still needs the BREVO_API_KEY encrypted Cloudflare secret.'
        : 'Brevo sender settings saved.'),
    settings: {
      BrevoSenderName: senderName,
      BrevoSenderEmail: senderEmail,
      BrevoReplyToEmail: clean(body.BrevoReplyToEmail || body.ReplyToEmail),
      BrevoReplyToName: clean(body.BrevoReplyToName || body.ReplyToName),
      ExecutiveSenderName: executiveSenderName,
      ExecutiveSenderEmail: executiveSenderEmail,
      ExecutiveReplyToEmail: executiveReplyToEmail,
      ExecutiveReplyToName: executiveReplyToName,
      ...providerSettings,
      SenderScope: payload.SenderScope,
      HasBrevoApiKey: environmentApiKeyConfigured || legacyDatabaseKeyConfigured,
      CredentialSource: credentialSource,
      LegacyCredentialMigrationRequired: legacyDatabaseKeyConfigured && !environmentApiKeyConfigured,
      SubmittedCredentialIgnored: Boolean(submittedApiKey)
    }
  };
}

async function saveSchoolProfile(env, body, deploymentIdentity) {
  const settingsScope = clean(body.SettingsScope || body.settingsScope).toLowerCase();
  if (settingsScope === 'branch') {
    // Desktop releases before the dedicated structure action submitted the
    // shared branch registry together with branch-profile overrides. Keep
    // those installed clients working while the new desktop uses the explicit
    // saveOrganisationStructure action.
    const structureResult = (
      Object.prototype.hasOwnProperty.call(body, 'SchoolBranches')
      || Object.prototype.hasOwnProperty.call(body, 'schoolBranches')
    ) ? await saveOrganisationStructure(env, body) : null;
    const defaults = (await getSchoolProfile(env)).profile;
    const submittedProfile = {};
    BRANCH_PROFILE_OVERRIDE_FIELDS.forEach((field) => {
      const camelField = `${field.charAt(0).toLowerCase()}${field.slice(1)}`;
      if (Object.prototype.hasOwnProperty.call(body, field)) submittedProfile[field] = body[field];
      else if (Object.prototype.hasOwnProperty.call(body, camelField)) submittedProfile[field] = body[camelField];
    });
    if (Object.prototype.hasOwnProperty.call(submittedProfile, 'PaystackSubaccountCode')) {
      submittedProfile.PaystackSubaccountCode = normalizePaystackSubaccountCode(submittedProfile.PaystackSubaccountCode);
    }
    const saved = await saveBranchProfileOverrides(env, {
      branchId: body.BranchId || body.branchId,
      defaultProfile: defaults,
      submittedProfile,
      updatedBy: body.UserRole || body.UpdatedBy || body.updatedBy || 'Super Admin'
    });
    const result = await getSchoolProfile(env, { branchId: saved.branch.id, includeTutorials: true });
    return {
      ...result,
      message: [
        structureResult?.message,
        saved.fields.length
          ? `${saved.branch.name} overrides saved; remaining settings inherit the organisation defaults.`
          : `${saved.branch.name} now inherits every organisation setting.`
      ].filter(Boolean).join(' ')
    };
  }
  const [storedProfile, savedOrganization, savedPublicContent, storedStructure] = await Promise.all([
    getDocument(env, 'settings', 'schoolProfile').catch(() => null),
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', PUBLIC_PORTAL_CONTENT_DOCUMENT).catch(() => null),
    getDocument(env, 'settings', 'schoolStructure')
  ]);
  const existingOrganization = savedOrganization
    ? await refreshOrganizationPlanPolicy(env, savedOrganization)
    : savedOrganization;
  const existingProfile = applyPublicPortalContent(storedProfile || {}, savedPublicContent);
  const authoritativeSubscription = resolveOrganizationConfig({
    env,
    organizationProfile: existingOrganization,
    legacyProfile: existingProfile
  });
  const branchValues = mergeSchoolBranchMetadata(
    Array.isArray(body.SchoolBranches) ? body.SchoolBranches
      : body.SchoolBranches || body.schoolBranches ? clean(body.SchoolBranches || body.schoolBranches).split(',') : null,
    storedStructure?.Branches || []
  );
  const sections = [];
  if (yesNo(body.EnablePrimarySection ?? body.enablePrimarySection ?? 'YES') === 'YES') sections.push('primary');
  if (yesNo(body.EnableSecondarySection ?? body.enableSecondarySection ?? 'YES') === 'YES') sections.push('secondary');
  if (!sections.length) sections.push('primary', 'secondary');
  const structure = normalizeSchoolStructure({
    Branches: branchValues,
    ActiveBranchId: body.ActiveBranchId || body.activeBranchId || storedStructure?.ActiveBranchId || 'main',
    Sections: sections
  });
  const branches = structure.Branches;
  const activeBranchId = structure.ActiveBranchId;
  const documentRequirements = {
    BirthCertificate: yesNo(body.EnableBirthCertificate ?? 'YES') === 'YES',
    PreviousSchoolReport: yesNo(body.EnablePreviousSchoolReport ?? 'YES') === 'YES',
    PassportPhotograph: yesNo(body.EnablePassportPhotograph ?? 'YES') === 'YES',
    MedicalReport: yesNo(body.EnableMedicalReport ?? 'YES') === 'YES',
    TransferCertificateDoc: yesNo(body.EnableTransferCertificateDoc ?? 'YES') === 'YES',
    AcceptanceForm: yesNo(body.EnableAcceptanceForm ?? 'YES') === 'YES'
  };
  const profile = {
    ...withoutFirestoreMetadata(existingProfile || {}),
    SchoolName: mergedProfileText(existingProfile, body, 'SchoolName', 'schoolName', 'Dynamax'),
    SchoolCode: normalizeSchoolCode(mergedProfileText(existingProfile, body, 'SchoolCode', 'schoolCode')),
    SchoolAddress: mergedProfileText(existingProfile, body, 'SchoolAddress', 'schoolAddress'),
    SchoolPhone: mergedProfileText(existingProfile, body, 'SchoolPhone', 'schoolPhone'),
    SchoolEmail: mergedProfileText(existingProfile, body, 'SchoolEmail', 'schoolEmail'),
    SchoolSignatoryName: mergedProfileText(existingProfile, body, 'SchoolSignatoryName', 'schoolSignatoryName'),
    SchoolSignatoryTitle: mergedProfileText(existingProfile, body, 'SchoolSignatoryTitle', 'schoolSignatoryTitle'),
    ResultSignatoryName: mergedProfileText(existingProfile, body, 'ResultSignatoryName', 'resultSignatoryName'),
    ResultSignatoryTitle: mergedProfileText(existingProfile, body, 'ResultSignatoryTitle', 'resultSignatoryTitle'),
    OfferSignatoryName: mergedProfileText(existingProfile, body, 'OfferSignatoryName', 'offerSignatoryName'),
    OfferSignatoryTitle: mergedProfileText(existingProfile, body, 'OfferSignatoryTitle', 'offerSignatoryTitle'),
    AdmissionSignatoryName: mergedProfileText(existingProfile, body, 'AdmissionSignatoryName', 'admissionSignatoryName'),
    AdmissionSignatoryTitle: mergedProfileText(existingProfile, body, 'AdmissionSignatoryTitle', 'admissionSignatoryTitle'),
    EmailGreetingTemplate: mergedProfileText(existingProfile, body, 'EmailGreetingTemplate', 'emailGreetingTemplate', 'Dear Parent/Guardian,'),
    BrevoSenderName: mergedProfileText(existingProfile, body, 'BrevoSenderName', 'brevoSenderName'),
    BrevoSenderEmail: mergedProfileText(existingProfile, body, 'BrevoSenderEmail', 'brevoSenderEmail'),
    BrevoReplyToEmail: mergedProfileText(existingProfile, body, 'BrevoReplyToEmail', 'brevoReplyToEmail'),
    BrevoReplyToName: mergedProfileText(existingProfile, body, 'BrevoReplyToName', 'brevoReplyToName'),
    ExecutiveSenderName: mergedProfileText(existingProfile, body, 'ExecutiveSenderName', 'executiveSenderName'),
    ExecutiveSenderEmail: mergedProfileText(existingProfile, body, 'ExecutiveSenderEmail', 'executiveSenderEmail'),
    ExecutiveReplyToEmail: mergedProfileText(existingProfile, body, 'ExecutiveReplyToEmail', 'executiveReplyToEmail'),
    ExecutiveReplyToName: mergedProfileText(existingProfile, body, 'ExecutiveReplyToName', 'executiveReplyToName'),
    OrganisationSenderName: mergedProfileText(existingProfile, body, 'OrganisationSenderName', 'organisationSenderName'),
    OrganisationSenderEmail: mergedProfileText(existingProfile, body, 'OrganisationSenderEmail', 'organisationSenderEmail'),
    OrganisationReplyToEmail: mergedProfileText(existingProfile, body, 'OrganisationReplyToEmail', 'organisationReplyToEmail'),
    OrganisationReplyToName: mergedProfileText(existingProfile, body, 'OrganisationReplyToName', 'organisationReplyToName'),
    OrganisationExecutiveSenderName: mergedProfileText(existingProfile, body, 'OrganisationExecutiveSenderName', 'organisationExecutiveSenderName'),
    OrganisationExecutiveSenderEmail: mergedProfileText(existingProfile, body, 'OrganisationExecutiveSenderEmail', 'organisationExecutiveSenderEmail'),
    OrganisationExecutiveReplyToEmail: mergedProfileText(existingProfile, body, 'OrganisationExecutiveReplyToEmail', 'organisationExecutiveReplyToEmail'),
    OrganisationExecutiveReplyToName: mergedProfileText(existingProfile, body, 'OrganisationExecutiveReplyToName', 'organisationExecutiveReplyToName'),
    NameFormat: mergedProfileText(existingProfile, body, 'NameFormat', 'nameFormat', 'Surname, first name, middle name'),
    PortalHeadline: mergedProfileText(existingProfile, body, 'PortalHeadline', 'portalHeadline', 'Admissions and parent services in one place'),
    PortalSubheading: mergedProfileText(existingProfile, body, 'PortalSubheading', 'portalSubheading', 'Buy forms, complete applications, upload documents, pay fees, and monitor student activity from a secure school portal.'),
    PortalNotice: mergedProfileText(existingProfile, body, 'PortalNotice', 'portalNotice'),
    CurrentAcademicSession: mergedProfileText(existingProfile, body, 'CurrentAcademicSession', 'currentAcademicSession'),
    CurrentTerm: mergedProfileText(existingProfile, body, 'CurrentTerm', 'currentTerm', 'First Term'),
    DeclarationStatement: mergedProfileText(existingProfile, body, 'DeclarationStatement', 'declarationStatement', 'I declare that the information supplied in this application is complete and correct.'),
    ResultDisplayMode: mergedProfileText(existingProfile, body, 'ResultDisplayMode', 'resultDisplayMode', 'subjects'),
    ShowResultsOnline: yesNo(mergedProfileText(existingProfile, body, 'ShowResultsOnline', 'showResultsOnline', 'NO')) || 'NO',
    OfferDocumentBodyTemplate: mergedProfileText(existingProfile, body, 'OfferDocumentBodyTemplate', 'offerDocumentBodyTemplate'),
    AdmissionDocumentBodyTemplate: mergedProfileText(existingProfile, body, 'AdmissionDocumentBodyTemplate', 'admissionDocumentBodyTemplate'),
    TutorialLinks: normalizeTutorialLinks(existingProfile.TutorialLinks ?? existingProfile.tutorialLinks ?? {}),
    TutorialChannelUrl: normalizeYouTubeTutorialUrl(existingProfile.TutorialChannelUrl ?? existingProfile.tutorialChannelUrl ?? ''),
    SubscriptionPlan: authoritativeSubscription.Plan,
    SubscriptionStatus: authoritativeSubscription.SubscriptionStatus,
    TrialStartedAt: authoritativeSubscription.TrialStartedAt,
    TrialEndsAt: authoritativeSubscription.TrialEndsAt,
    PaidThroughAt: authoritativeSubscription.PaidThroughAt,
    RenewalDueAt: authoritativeSubscription.RenewalDueAt,
    GracePeriodEndsAt: authoritativeSubscription.GracePeriodEndsAt,
    DataRetentionEndsAt: authoritativeSubscription.DataRetentionEndsAt,
    UserLimit: authoritativeSubscription.UserLimit,
    UpdatedAt: nowIso(),
    UpdatedBy: clean(body.UserRole || body.UpdatedBy || body.updatedBy) || 'Super Admin'
  };
  delete profile.GoogleDocumentsUrl;
  delete profile.googleDocumentsUrl;
  const organization = resolveOrganizationConfig({
    env,
    organizationProfile: {
      ...(existingOrganization || {}),
      Edition: body.OrganisationEdition || body.OrganizationEdition || body.organisationEdition || body.organizationEdition || existingOrganization?.Edition,
      Name: body.OrganisationName || body.OrganizationName || body.organisationName || body.organizationName || existingOrganization?.Name || profile.SchoolName,
      Code: body.OrganisationCode || body.OrganizationCode || body.organisationCode || body.organizationCode || existingOrganization?.Code || profile.SchoolCode,
      FeatureOverrides: body.FeatureOverrides || body.featureOverrides
        || existingOrganization?.FeatureOverrides,
      DisabledFeatureEntitlements: existingOrganization?.DisabledFeatureEntitlements
    },
    legacyProfile: profile
  });
  profile.OrganisationEdition = organization.Edition;
  profile.OrganisationName = organization.Name;
  profile.OrganisationCode = organization.Code;
  profile.FeatureOverrides = organization.FeatureOverrides;
  profile.FeatureFlags = organization.FeatureFlags;
  profile.PlanEntitlements = organization.PlanEntitlements;
  profile.PlanModuleCatalogVersion = organization.PlanModuleCatalogVersion;
  profile.SubscriptionPriceSnapshot = existingOrganization?.SubscriptionPriceSnapshot ?? null;
  if (body.WebLogoDataUrl !== undefined || body.webLogoDataUrl !== undefined) {
    const webLogo = clean(body.WebLogoDataUrl ?? body.webLogoDataUrl);
    if (webLogo && (!/^data:image\/(png|jpeg|webp);base64,/i.test(webLogo) || webLogo.length > 750000)) {
      const error = new Error('The web logo must be a resized PNG, JPG, or WebP image below the allowed size.');
      error.status = 400;
      throw error;
    }
    await saveWebBranding(env, { WebLogoDataUrl: webLogo, UpdatedAt: nowIso() });
  }
  if (body.DocumentLogoDataUrl !== undefined || body.DocumentSignatureDataUrl !== undefined || body.DocumentStampDataUrl !== undefined) {
    const documentAssets = {};
    for (const [field, label] of [['DocumentLogoDataUrl', 'document logo'], ['DocumentSignatureDataUrl', 'document signature'], ['DocumentStampDataUrl', 'document stamp']]) {
      if (body[field] === undefined) continue;
      const value = clean(body[field]);
      if (value && (!/^data:image\/(png|jpeg|webp);base64,/i.test(value) || value.length > 750000)) {
        const error = new Error(`The ${label} must be a resized PNG, JPG or WebP image below the allowed size.`);
        error.status = 400;
        throw error;
      }
      documentAssets[field] = value;
    }
    await saveDocumentBranding(env, { ...documentAssets, UpdatedAt: nowIso() });
  }
  await upsertDocument(env, 'settings', 'schoolStructure', {
    Branches: branches.length ? branches : [{ Id: 'main', Name: 'Main Branch' }], ActiveBranchId: activeBranchId,
    Sections: sections, UpdatedAt: nowIso(), UpdatedBy: profile.UpdatedBy
  }, storedStructure?.__updateTime ? { updateTime: storedStructure.__updateTime } : { exists: false });
  invalidateSchoolStructureCache();
  await upsertDocument(env, 'settings', 'admissionDocuments', {
    Enabled: documentRequirements, UpdatedAt: nowIso(), UpdatedBy: profile.UpdatedBy
  });
  await upsertDocument(env, 'settings', 'organisationProfile', organizationProfileDocument({
    ...organization,
    WorkspaceId: deploymentIdentity?.workspaceId,
    Plan: profile.SubscriptionPlan,
    PlanEntitlements: existingOrganization?.PlanEntitlements,
    PlanModuleCatalogVersion: existingOrganization?.PlanModuleCatalogVersion,
    SubscriptionPriceSnapshot: existingOrganization?.SubscriptionPriceSnapshot,
    DisabledFeatureEntitlements: existingOrganization?.DisabledFeatureEntitlements,
    PlanCatalogRevision: existingOrganization?.PlanCatalogRevision,
    UserLimit: profile.UserLimit,
    BrandName: 'Dynamax',
    BrandLogoUrl: '/images/Logo.png',
    NameFormat: profile.NameFormat
  }, {
    UpdatedAt: profile.UpdatedAt, UpdatedBy: profile.UpdatedBy
  }));
  await upsertDocument(env, 'settings', 'schoolProfile', profile);
  return { ok: true, message: 'Organisation profile saved to the database.', profile };
}

function normalizedOrganisationStructure(body = {}, existing = {}) {
  const rawBranches = Array.isArray(body.SchoolBranches)
    ? body.SchoolBranches
    : body.SchoolBranches || body.schoolBranches ? clean(body.SchoolBranches || body.schoolBranches).split(',') : null;
  const savedSections = Array.isArray(existing.Sections) && existing.Sections.length
    ? existing.Sections
    : ['primary', 'secondary'];
  return normalizeSchoolStructure({
    Branches: mergeSchoolBranchMetadata(rawBranches, existing.Branches || []),
    ActiveBranchId: body.ActiveBranchId || body.activeBranchId || existing.ActiveBranchId || 'main',
    Sections: savedSections
  });
}

async function saveOrganisationStructure(env, body, deploymentIdentity = null) {
  if (Object.hasOwn(body, 'BranchSchoolSectionUpdate')) {
    if (deploymentIdentity && deploymentIdentity.edition !== 'school') {
      throw Object.assign(new Error('School section terminology applies only to the School edition.'), { status: 400 });
    }
    const actor = await resolveAuthoritativeDesktopActorForEnv(env, body);
    if (clean(actor.Role || actor.role) !== 'Super Admin' || clean(actor.BranchId || actor.branchId || actor.assignedBranchId)) {
      throw Object.assign(new Error('Only an organisation-wide Super Administrator can change branch terminology.'), { status: 403 });
    }
    const structure = await saveBranchSchoolSection(env, body.BranchSchoolSectionUpdate, actor.Username || actor.username);
    return { ok: true, message: 'Branch school terminology saved. Records and access permissions are unchanged.', structure };
  }
  const existing = await getDocument(env, 'settings', 'schoolStructure') || {};
  const structure = normalizedOrganisationStructure(body, existing);
  const updatedBy = clean(body.UserRole || body.UpdatedBy || body.updatedBy) || 'Super Admin';
  await upsertDocument(env, 'settings', 'schoolStructure', {
    ...withoutFirestoreMetadata(existing),
    ...structure,
    UpdatedAt: nowIso(),
    UpdatedBy: updatedBy
  }, existing.__updateTime ? { updateTime: existing.__updateTime } : { exists: false });
  invalidateSchoolStructureCache();
  return {
    ok: true,
    message: `${structure.Branches.length} organisation branch${structure.Branches.length === 1 ? '' : 'es'} saved and shared with the web companion.`,
    structure
  };
}

async function getSchoolProfile(env, options = {}) {
  let [profile, branding, storedStructure, documentSettings, organizationProfile, savedPublicContent, brevoSettings] = await Promise.all([
    getDocument(env, 'settings', 'schoolProfile').catch(() => null),
    getWebBranding(env).catch(() => null),
    getDocument(env, 'settings', 'schoolStructure').catch(() => null),
    getDocument(env, 'settings', 'admissionDocuments').catch(() => null),
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', PUBLIC_PORTAL_CONTENT_DOCUMENT).catch(() => null),
    getDocument(env, 'settings', 'brevo').catch(() => null)
  ]);
  profile = applyPublicPortalContent(profile || {}, savedPublicContent);
  if (organizationProfile) organizationProfile = await refreshOrganizationPlanPolicy(env, organizationProfile);
  const structure = normalizeSchoolStructure(storedStructure || await getSchoolStructure(env));
  const enabledDocuments = documentSettings?.Enabled && typeof documentSettings.Enabled === 'object' ? documentSettings.Enabled : {};
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile: profile || {} });
  const configuredEmailProvider = clean(env.EMAIL_PROVIDER).toLowerCase();
  const emailProvider = !configuredEmailProvider
    ? 'brevo'
    : ['brevo', 'gmail'].includes(configuredEmailProvider)
      ? configuredEmailProvider
      : 'unsupported';
  const emailProviderConnectionReady = emailProvider === 'gmail'
    ? Boolean(
        clean(env.GMAIL_OAUTH_CLIENT_ID)
        && clean(env.GMAIL_OAUTH_CLIENT_SECRET)
        && clean(env.GMAIL_REFRESH_TOKEN)
        && clean(env.GMAIL_CONNECTED_EMAIL)
      )
    : emailProvider === 'brevo'
      ? Boolean(clean(env.BREVO_API_KEY) || clean(brevoSettings?.BrevoApiKey))
      : false;
  const baseProfile = { ...(profile || {
      SchoolName: 'Dynamax',
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
      NameFormat: organization.NameFormat,
      BrevoSenderName: clean(profile?.BrevoSenderName || brevoSettings?.BrevoSenderName),
      BrevoSenderEmail: clean(profile?.BrevoSenderEmail || brevoSettings?.BrevoSenderEmail),
      BrevoReplyToEmail: clean(profile?.BrevoReplyToEmail || brevoSettings?.BrevoReplyToEmail),
      BrevoReplyToName: clean(profile?.BrevoReplyToName || brevoSettings?.BrevoReplyToName),
      ExecutiveSenderName: clean(profile?.ExecutiveSenderName || brevoSettings?.ExecutiveSenderName),
      ExecutiveSenderEmail: clean(profile?.ExecutiveSenderEmail || brevoSettings?.ExecutiveSenderEmail),
      ExecutiveReplyToEmail: clean(profile?.ExecutiveReplyToEmail || brevoSettings?.ExecutiveReplyToEmail),
      ExecutiveReplyToName: clean(profile?.ExecutiveReplyToName || brevoSettings?.ExecutiveReplyToName),
      OrganisationSenderName: clean(profile?.OrganisationSenderName || brevoSettings?.OrganisationSenderName),
      OrganisationSenderEmail: clean(profile?.OrganisationSenderEmail || brevoSettings?.OrganisationSenderEmail),
      OrganisationReplyToEmail: clean(profile?.OrganisationReplyToEmail || brevoSettings?.OrganisationReplyToEmail),
      OrganisationReplyToName: clean(profile?.OrganisationReplyToName || brevoSettings?.OrganisationReplyToName),
      OrganisationExecutiveSenderName: clean(profile?.OrganisationExecutiveSenderName || brevoSettings?.OrganisationExecutiveSenderName),
      OrganisationExecutiveSenderEmail: clean(profile?.OrganisationExecutiveSenderEmail || brevoSettings?.OrganisationExecutiveSenderEmail),
      OrganisationExecutiveReplyToEmail: clean(profile?.OrganisationExecutiveReplyToEmail || brevoSettings?.OrganisationExecutiveReplyToEmail),
      OrganisationExecutiveReplyToName: clean(profile?.OrganisationExecutiveReplyToName || brevoSettings?.OrganisationExecutiveReplyToName),
      EmailProvider: emailProvider,
      EmailProviderConnectionReady: emailProviderConnectionReady,
      GmailConnectedEmail: emailProvider === 'gmail' ? clean(env.GMAIL_CONNECTED_EMAIL) : '',
      FeatureFlags: organization.FeatureFlags,
      PlanEntitlements: organization.PlanEntitlements,
      PlanModuleCatalogVersion: organization.PlanModuleCatalogVersion,
      SubscriptionPriceSnapshot: organizationProfile?.SubscriptionPriceSnapshot ?? null,
      EnabledFeatureEntitlements: organization.EnabledFeatureEntitlements,
      DisabledFeatureEntitlements: organization.DisabledFeatureEntitlements,
      ModulePreferences: organization.ModulePreferences,
      PlanCatalogRevision: clean(organizationProfile?.PlanCatalogRevision),
      DocumentStorageProvider: 'Cloudflare R2',
      DocumentStorageConfigured: documentStorageConfigured(env),
      SubscriptionPlan: clean(organizationProfile?.Plan || profile?.SubscriptionPlan) || 'Starter',
      SubscriptionStatus: organization.SubscriptionStatus,
      SubscriptionActive: organization.SubscriptionActive,
      SubscriptionState: organization.SubscriptionState,
      SubscriptionMessage: organization.SubscriptionMessage,
      TrialStartedAt: organization.TrialStartedAt,
      TrialEndsAt: organization.TrialEndsAt,
      TrialDaysRemaining: organization.TrialDaysRemaining,
      PaidThroughAt: organization.PaidThroughAt,
      RenewalDueAt: organization.RenewalDueAt,
      GracePeriodEndsAt: organization.GracePeriodEndsAt,
      DataRetentionEndsAt: organization.DataRetentionEndsAt,
      SubscriptionReadOnly: organization.SubscriptionReadOnly,
      UserLimit: Math.max(1, Number(organizationProfile?.UserLimit || profile?.UserLimit || 5) || 5),
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
      AvailableBranches: (structure.Branches || []).map((row) => ({ ...row, Id: clean(row.Id), Name: clean(row.Name || row.Id) })),
      WebLogoConfigured: Boolean(branding && clean(branding.WebLogoDataUrl)), WebLogoUrl: branding && clean(branding.WebLogoDataUrl) ? '/api/web-logo' : '' };
  const scopedProfile = await effectiveBranchProfile(env, baseProfile, options.branchId || options.BranchId);
  if (!options.includeTutorials) return { ok: true, profile: scopedProfile };
  const tutorials = await loadPublishedTutorials(env, organization.Edition, scopedProfile);
  return {
    ok: true,
    profile: {
      ...scopedProfile,
      TutorialLinks: tutorials.links,
      TutorialChannelUrl: tutorials.channelUrl
    }
  };
}

// Inspection only: classifications and configured charges are compared with
// posted invoices. No invoice generation, credit allocation or summary writes.
export async function buildStudentBillingPreview(student, data = {}) {
  const overview = await getAccountsOverview({}, {
    schoolProfile: data.schoolProfile || {}, students: [student], applications: [], accounts: [],
    payments: data.payments || [], invoices: data.invoices || [], ledger: data.ledger || [],
    feeItems: data.feeItems || [], billingCategories: [], accountSummaries: data.accountSummaries || []
  }, { BranchId: student.BranchId || 'main' });
  const account = overview.accounts[0];
  if (!account) throw new Error('No student billing profile was found.');
  const expected = applyBillingCategoryOverrides(overview.feeItems.filter((fee) =>
    yesNo(fee.Active) === 'YES' && yesNo(fee.PayableOnline || 'YES') === 'YES' &&
    !isWalletFee(fee) && !isOptionalSubscriptionFee(fee) && !isAcceptanceFeeLike(fee) &&
    feeMatchesAccountPeriod(fee, account)), account);
  const periodInvoices = overview.invoices.filter((invoice) =>
    financialRowMatchesAccount(invoice, account) && isSchoolFeeInvoice(invoice) &&
    !['void', 'voided', 'cancelled', 'canceled'].includes(lower(invoice.Status)) &&
    feeFieldMatches(invoice.AcademicSession || 'All', account.AcademicSession) &&
    feeFieldMatches(invoice.Term || 'All', account.Term));
  const components = new Map();
  for (const fee of expected) {
    const key = lower(fee.FeeCode);
    const row = components.get(key) || { code: fee.FeeCode, name: fee.FeeName, expected: 0, invoiced: 0, invoiceIds: [] };
    row.expected = asMoneyNumber(row.expected + asMoneyNumber(fee.Amount));
    components.set(key, row);
  }
  for (const invoice of periodInvoices) {
    const key = lower(invoice.FeeCode);
    const row = components.get(key) || { code: invoice.FeeCode, name: invoice.FeeName, expected: 0, invoiced: 0, invoiceIds: [] };
    row.invoiced = asMoneyNumber(row.invoiced + invoice.Debit);
    row.invoiceIds.push(invoice.InvoiceId);
    components.set(key, row);
  }
  const rows = [...components.values()].map((row) => billingComponentDiagnostics({ ...row, difference: asMoneyNumber(row.expected - row.invoiced) }));
  const expectedTotal = asMoneyNumber(expected.reduce((sum, fee) => sum + asMoneyNumber(fee.Amount), 0));
  const invoicedTotal = asMoneyNumber(periodInvoices.reduce((sum, invoice) => sum + invoice.Debit, 0));
  return {
    ok: true, readOnly: true, generatedAt: nowIso(),
    profile: Object.fromEntries(['AccountRef', 'DisplayName', 'ClassName', 'StudentType', 'Gender', 'BillingCategory',
      'EnrollmentCategory', 'AcademicProgress', 'AcademicSession', 'Term', 'BranchId', 'SchoolSection', 'StudentScopePath', 'ProfileCompletionStatus']
      .map((field) => [field, (field === 'ProfileCompletionStatus' ? student.ProfileCompletionStatus : account[field]) || ''])),
    expectedTotal, invoicedTotal, difference: asMoneyNumber(expectedTotal - invoicedTotal),
    recordedCredit: account.ExcessCredit, rows, billingReview: billingDiagnostics(rows),
    recordedCreditSource: data.accountSummaries?.some((row) => financialRowMatchesAccount(row, account))
      ? 'saved_summary' : data.ledger?.length ? 'ledger' : 'unavailable',
    message: 'Preview only. Posted invoices, payments and credit balances have not been changed. Differences need finance review; this is not a final balance.'
  };
}

export async function getStudentBillingData(env, student, options = {}) {
  const profile = normalizeStudent(student);
  const account = { ...profile, AccountRef: options.accountRef || profile.AdmissionNo || profile.AccountRef || profile.ApplicationReference };
  const references = [...new Set(accountRefsFrom(account))];
  const load = async (collection) => {
    const groups = await Promise.all(references.map((reference) => queryCollectionPages(env, collection, {
      filters: ['AccountRef', 'AdmissionNo', 'ApplicationReference', 'accountRef', 'admissionNo', 'applicationReference'].map((field) => ({ field, op: '==', value: reference })),
      filterJoin: 'OR', pageSize: 250, maxRows: 2000
    })));
    const unique = new Map();
    groups.flat().forEach((row) => unique.set(row.__name || row.__id, row));
    return [...unique.values()].filter((row) => financialRowMatchesAccount({
      ...row, AccountRef: row.AccountRef || row.accountRef, AdmissionNo: row.AdmissionNo || row.admissionNo,
      ApplicationReference: row.ApplicationReference || row.applicationReference
    }, account) || (options.includeLinkedApplication === true &&
      sameReferenceIdentity(row.AccountRef || row.accountRef, account.ApplicationReference) &&
      (!clean(row.AdmissionNo || row.admissionNo) || sameReferenceIdentity(row.AdmissionNo || row.admissionNo, account.AdmissionNo))))
      .filter((row) => canonicalSchoolBranchId(row.BranchId || 'main') === canonicalSchoolBranchId(student.BranchId || 'main'))
      .filter((row) => !options.section || !clean(row.SchoolSection || row.schoolSection) ||
        sameText(row.SchoolSection || row.schoolSection, options.section));
  };
  const [schoolProfile, feeItems, invoices, payments, ledger, accountSummaries] = await Promise.all([
    getDocument(env, 'settings', 'schoolProfile'), loadBranchFinanceRows(env, 'feeItems', feeBranchId(student)),
    load('invoices'), load('payments'), load('ledger'), load('accountSummaries')
  ]);
  return {
    schoolProfile, invoices, payments, ledger, accountSummaries,
    feeItems: feeRowsForBranch(feeItems, feeBranchId(student))
  };
}

// A read-only, bounded replacement for downloading the whole school after a
// desktop mutation. Resolve the authorized identity before reading its finances.
export async function getAccountSnapshot(env, body = {}) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const accountRef = clean(body.AccountRef);
  if (!accountRef) { const error = new Error('AccountRef is required.'); error.status = 400; throw error; }
  const scope = requestedStudentScope(body);
  // A posted section may narrow, never broaden, authoritative staff access.
  if (!['primary', 'secondary'].includes(lower(scope.schoolSectionAccess)) &&
      ['primary', 'secondary'].includes(lower(body.SchoolSection))) scope.schoolSectionAccess = body.SchoolSection;
  const student = await findStudentByAccountRef(env, accountRef, scope);
  let application = null;
  const applicationRef = student?.ApplicationReference || (!student ? accountRef : '');
  if (applicationRef) {
    for (const field of ['ApplicationReference', 'ApplicationID', 'AdmissionNo']) {
      const candidates = (await querySchoolCollection(env, 'applications', {
        scope, filters: [{ field, op: '==', value: applicationRef }], limit: 3
      })).filter((row) => (!scope.branchId || lower(scope.branchId) === 'all' ||
        identityRecordBranch(row) === canonicalSchoolBranchId(scope.branchId)) &&
        (!['primary', 'secondary'].includes(lower(scope.schoolSectionAccess)) ||
          identityRecordSection(row) === lower(scope.schoolSectionAccess)));
      // Legacy root and scoped copies of the same application are not two
      // accounts. Prefer its latest saved copy, while retaining real ambiguity.
      const unique = new Map();
      for (const candidate of candidates) {
        const key = JSON.stringify([identityRecordBranch(candidate), identityRecordSection(candidate),
          referenceIdentityKey(candidate.ApplicationReference || candidate.ApplicationID || candidate.AdmissionNo || candidate.__id)]);
        const previous = unique.get(key);
        if (!previous || timestampMs(candidate.UpdatedAt || candidate.SubmittedAt) > timestampMs(previous.UpdatedAt || previous.SubmittedAt) ||
          (timestampMs(candidate.UpdatedAt || candidate.SubmittedAt) === timestampMs(previous.UpdatedAt || previous.SubmittedAt) &&
            clean(candidate.__scopePath).startsWith('schoolBranches/'))) unique.set(key, candidate);
      }
      if (unique.size > 1) {
        const error = new Error('Select a unique branch and section before refreshing this account.'); error.status = 409; throw error;
      }
      if (unique.size) { application = [...unique.values()][0]; break; }
    }
  }
  const identity = student || application;
  if (!identity) { const error = new Error('Account not found in your authorized school scope.'); error.status = 404; throw error; }
  const branchId = identityRecordBranch(identity);
  const section = identityRecordSection(identity);
  if ((scope.branchId && lower(scope.branchId) !== 'all' && canonicalSchoolBranchId(scope.branchId) !== branchId) ||
      (['primary', 'secondary'].includes(lower(scope.schoolSectionAccess)) && lower(scope.schoolSectionAccess) !== section)) {
    const error = new Error('Account not found in your authorized school scope.'); error.status = 404; throw error;
  }
  const canonicalRef = clean(student?.AdmissionNo || student?.AccountRef || application?.AdmissionNo || application?.ApplicationReference || application?.ApplicationID);
  const scopedIdentity = { ...identity, AccountRef: canonicalRef, BranchId: branchId, SchoolSection: section };
  const data = await getStudentBillingData(env, scopedIdentity, { includeLinkedApplication: true, section, accountRef: canonicalRef });
  const legacy = await getDocument(env, 'accounts', safeDocumentId(canonicalRef));
  const overview = await getAccountsOverview(env, {
    ...data,
    accounts: legacy && identityRecordBranch(legacy) === branchId &&
      (!clean(legacy.SchoolSection) || sameText(legacy.SchoolSection, section)) ? [legacy] : [],
    students: student ? [scopedIdentity] : [], applications: application ? [application] : [],
    billingCategories: []
  }, { BranchId: branchId, UserSchoolSectionAccess: section });
  const account = overview.accounts.find((row) => sameReferenceIdentity(row.AccountRef, canonicalRef));
  if (!account) throw new Error('The account snapshot could not be confirmed.');
  // Linked application rows can create a second overview identity; expose only
  // the requested student's account and records, never that additional row.
  return { ...overview, accounts: [account], accountRef: canonicalRef,
    requestedAccountRef: accountRef, message: 'Affected account refreshed.', readOnly: true };
}

export async function getStudentBillingPreview(env, student) {
  return buildStudentBillingPreview(student, await getStudentBillingData(env, student));
}

export async function studentBillingReconciliationPlan(student, data) {
  const preview = await buildStudentBillingPreview(student, data);
  const conflicts = preview.rows.filter((row) => row.conflict);
  const missing = preview.rows.filter((row) => row.missing);
  const eligibleMissing = [], blockedMissing = [];
  for (const row of missing) {
    const fees = studentMissingChargeFees(data, preview.profile, row.code);
    const prior = (data.invoices || []).map(normalizeInvoice).some((invoice) => sameText(row.code, invoice.FeeCode) &&
      feeFieldMatches(invoice.AcademicSession || 'All', preview.profile.AcademicSession) &&
      feeFieldMatches(invoice.Term || 'All', preview.profile.Term));
    const reason = prior ? 'A cancelled or legacy invoice already uses this component; finance review is required.'
      : !clean(row.code) || fees.length !== 1 || !Number.isFinite(row.expected) || fees[0].Amount !== row.expected
        ? 'The fee configuration is ambiguous; finance review is required.' : '';
    (reason ? blockedMissing : eligibleMissing).push({ ...row, ...(reason ? { postingBlock: reason } : {}) });
  }
  eligibleMissing.sort((a, b) => lower(a.code).localeCompare(lower(b.code)));
  blockedMissing.sort((a, b) => lower(a.code).localeCompare(lower(b.code)));
  const postingTotal = asMoneyNumber(eligibleMissing.reduce((sum, row) => sum + row.expected, 0));
  let reason = '';
  if (!eligibleMissing.length) reason = blockedMissing.length ? blockedMissing.map((row) => `${row.code}: ${row.postingBlock}`).join('; ')
    : conflicts.length ? 'No valid missing charges to post. Existing invoice conflicts still need finance review.' : 'Charges already match the saved profile.';
  else if (lower(student.ProfileCompletionStatus) !== 'complete') reason = 'Parent profile is not marked complete.';
  else if (!preview.invoicedTotal) reason = 'No existing period billing; use the normal first-time billing process.';
  else if (!preview.profile.AcademicSession || !preview.profile.Term) reason = 'Academic period is not set.';
  const reviewWarning = [...conflicts.map((row) => `${row.code}: ${row.review}`),
    ...blockedMissing.map((row) => `${row.code}: ${row.postingBlock}`)].join('; ');
  const signature = JSON.stringify({ postingMode: 'missing-only-v2', profile: preview.profile, revision: student.__updateTime || '',
    eligibleMissing, blockedMissing,
    fees: eligibleMissing.flatMap((row) => studentMissingChargeFees(data, preview.profile, row.code))
      // Guard-only writes from another student's posting advance the revision
      // without changing this reviewed rule. Commit still checks fresh revisions.
      .map((fee) => [fee.__id || '', fee.FeeCode, fee.Amount, fee.Currency, fee.DueDate]),
    rows: preview.rows.map(({ code, expected, invoiced, invoiceIds }) => ({ code, expected, invoiced, invoiceIds: [...invoiceIds].sort() }))
      .sort((a, b) => a.code.localeCompare(b.code)) });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
  const previewToken = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { ...preview, ready: !reason, reason, missing, eligibleMissing, blockedMissing, postingTotal,
    conflicts, requiresReview: Boolean(reviewWarning), reviewWarning, previewToken };
}

function studentMissingChargeFees(data, profile, code) {
  return applyBillingCategoryOverrides((data.feeItems || []).map(normalizeFeeItem).filter((fee) =>
    sameText(fee.FeeCode, code) && yesNo(fee.Active) === 'YES' && yesNo(fee.PayableOnline || 'YES') === 'YES' &&
    !isWalletFee(fee) && !isOptionalSubscriptionFee(fee) && !isAcceptanceFeeLike(fee) && feeMatchesAccountPeriod(fee, profile)), profile);
}

// Only absent components are added. Posted amounts and receipts are never rewritten.
export async function reconcileStudentBilling(env, student, token, actor) {
  let data = await getStudentBillingData(env, student);
  let plan = await studentBillingReconciliationPlan(student, data);
  if (token !== plan.previewToken) { const error = new Error('Billing changed since preview. Review again before applying.'); error.status = 409; throw error; }
  if (!plan.ready) { const error = new Error(plan.reason); error.status = 409; throw error; }
  const accountRef = plan.profile.AccountRef;
  const linkedReferences = accountRefsFrom(student).filter((ref) => !sameText(ref, accountRef));
  const today = nowIso().slice(0, 10);
  if (await accountingPeriodIsClosed(env, today)) { const error = new Error('The posting date belongs to a closed accounting period.'); error.status = 409; throw error; }
  // Trace existing receipts and allocations before extending billing. This
  // established routine refuses inconsistent legacy credit instead of inventing it.
  // A charge-only posting must not repair journals or allocate credit against
  // disputed invoices. Retain the established credit preflight for clean bills.
  if (!plan.requiresReview) {
    const preflight = await syncSchoolAccountCreditJournals(env, accountRef, linkedReferences);
    if (preflight.unreconciledLegacyActions?.length || preflight.unreconciledAllocation) {
      const error = new Error('Existing payment or credit journals need finance review. No missing charges were added.'); error.status = 409; throw error;
    }
  }
  data = await getStudentBillingData(env, student);
  plan = await studentBillingReconciliationPlan(student, data);
  if (token !== plan.previewToken || !plan.ready) { const error = new Error('Invoices changed during reconciliation. Preview again.'); error.status = 409; throw error; }
  const writes = [];
  const guard = (row, collectionPath, field) => {
    if (!row.__id || !row.__updateTime || !Object.hasOwn(row, field)) {
      const error = new Error('A source record lacks its database revision. No charges were added.'); error.status = 409; throw error;
    }
    writes.push({ collectionPath, documentId: row.__id, updateTime: row.__updateTime,
      updateMask: [field], data: { [field]: row[field] } });
  };
  guard(student, student.__scopePath || 'students', Object.hasOwn(student, 'AdmissionNo') ? 'AdmissionNo' : 'admissionNo');
  for (const invoice of data.invoices) guard(invoice, 'invoices', Object.hasOwn(invoice, 'InvoiceId') ? 'InvoiceId' : 'AccountRef');
  const stamp = nowIso();
  const createdInvoices = [];
  for (const missing of plan.eligibleMissing) {
    const fees = studentMissingChargeFees(data, plan.profile, missing.code);
    const fee = fees[0];
    if (fees.length !== 1 || asMoneyNumber(fee.Amount) !== missing.expected) throw new Error('Ambiguous fee configuration; finance review is required.');
    const original = data.feeItems.find((row) => row.__id === fee.__id);
    guard(original, 'feeItems', Object.hasOwn(original, 'Amount') ? 'Amount' : 'amount');
    const idDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
      plan.profile.BranchId, plan.profile.SchoolSection, lower(accountRef), plan.profile.AcademicSession, plan.profile.Term, lower(fee.FeeCode)
    ])));
    const invoiceId = `INV-PROFILE-${[...new Uint8Array(idDigest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    const invoice = { ...plan.profile, InvoiceId: invoiceId, AdmissionNo: accountRef,
      AccountRefNormalized: normalizeReferenceText(accountRef), ApplicationReference: student.ApplicationReference || '',
      ParentEmail: clean(student.ParentEmail || student.VerificationEmail || student.Email).toLowerCase(),
      ParentEmails: [...new Set([...(student.ParentEmails || []), student.ParentEmail, student.FatherEmail, student.MotherEmail, student.GuardianEmail].map(lower).filter(Boolean))],
      FeeCode: fee.FeeCode, FeeName: fee.FeeName, FeeCategory: fee.FeeCategory, Currency: fee.Currency || 'NGN',
      Amount: missing.expected, Debit: missing.expected, Credit: 0, Balance: missing.expected,
      DueDate: feeDueDate(fee.DueDate) || fee.DueDate || '', Status: 'Unpaid', Date: stamp, CreatedAt: stamp, UpdatedAt: stamp,
      RecordedBy: actor.displayName || actor.username, Source: 'Student profile reconciliation' };
    writes.push({ collectionPath: 'invoices', documentId: invoiceId, exists: false, data: invoice });
    const journal = buildSchoolInvoiceChargeAccountingJournal(invoice);
    writes.push({ collectionPath: 'accountingJournals', documentId: safeDocumentId(journal.JournalNo), exists: false, data: journal });
    createdInvoices.push(invoice);
  }
  const audit = accountingAuditWrite('RECONCILE STUDENT PROFILE BILLING', 'Student account', accountRef, {
    UserRole: actor.role, UserUsername: actor.username, RecordedBy: actor.displayName || actor.username, BranchId: plan.profile.BranchId
  }, `${createdInvoices.length} missing components added; ${plan.postingTotal}. Existing payments and invoice amounts preserved.${plan.requiresReview ? ` Credit allocation deferred; finance review remains: ${plan.reviewWarning}` : ''}`);
  audit.data.SourcePlatform = 'Web';
  audit.data.Before = { profile: plan.profile, invoices: data.invoices, summaries: data.accountSummaries };
  audit.data.CreatedInvoiceIds = createdInvoices.map((row) => row.InvoiceId);
  audit.data.RemainingConflicts = plan.conflicts;
  audit.data.BlockedMissingComponents = plan.blockedMissing;
  writes.push(audit);
  if (writes.length > 450) throw new Error('This account requires a finance-led reconciliation; no charges were added.');
  await batchCommitDocuments(env, writes);
  let creditWarning = '';
  try {
    if (plan.requiresReview) {
      await refreshAccountFinancialSummary(env, accountRef, linkedReferences, {
        branchId: plan.profile.BranchId, schoolSectionAccess: plan.profile.SchoolSection
      });
    } else await applyDueSchoolFeeCreditsForAccount(env, accountRef, linkedReferences);
  } catch (error) { creditWarning = `Charges posted, but balance refresh or existing credit still needs review: ${error.message}`; }
  const after = await getStudentBillingPreview(env, student);
  return { ok: true, created: createdInvoices.length, added: plan.postingTotal, creditWarning, after,
    requiresReview: plan.requiresReview, reviewWarning: plan.reviewWarning, creditAllocationDeferred: plan.requiresReview,
    message: creditWarning || (plan.requiresReview
      ? 'Valid missing charges posted. Existing invoices, payments and allocations were preserved. Conflicting or blocked components still need finance review; credit allocation is deferred and the balance remains provisional.'
      : 'Missing charges reconciled and available existing credit applied. No new payment was created.') };
}

// A narrowly scoped, reviewed correction for BOW after its intake rule changes.
// It never deletes a receipt or rewrites a posted invoice's gross fields.
export async function boardingWearReversalPlan(student, data, { candidateOnly = false } = {}) {
  const preview = await buildStudentBillingPreview(student, data);
  const profile = preview.profile;
  const invoices = (data.invoices || []).map(normalizeInvoice).filter((row) =>
    sameText(row.FeeCode, 'BOW') && sameFinancialPeriod(row, profile.AcademicSession, profile.Term) &&
    !['void', 'voided', 'cancelled', 'canceled', 'reversed'].includes(lower(row.Status)));
  const invoice = invoices[0];
  const fees = (data.feeItems || []).map(normalizeFeeItem).filter((fee) => sameText(fee.FeeCode, 'BOW') &&
    // This is a counterfactual lookup of the erroneous intake-only charge, not
    // the student's actual fee eligibility (which uses the admission year).
    yesNo(fee.Active) === 'YES' && feeMatchesAccountPeriod(fee, profile, { enrollmentCategoryOverride: 'New Intake' }));
  let reason = '';
  if (!sameText(student.EnrollmentCategory || student.enrollmentCategory, 'Returning')) reason = 'Only explicitly returning students qualify.';
  else if (!clean(student.AcademicSession || student.academicSession) || !clean(student.Term || student.term)) reason = 'The student accounting period is missing.';
  else if (invoices.length !== 1) reason = invoices.length ? 'Duplicate Boarding Wear invoices require individual finance review.' : 'No active Boarding Wear invoice in this period.';
  else if (fees.length !== 1 || !sameText(fees[0].EnrollmentCategory, 'New Intake') ||
    preview.rows.find((row) => sameText(row.code, 'BOW'))?.expected !== 0) reason = 'Save one applicable New Intake-only Boarding Wear rule before reviewing a reversal.';
  else if (!isSchoolFeeInvoice(invoice) || invoice.Debit <= 0 || invoice.Debit !== fees[0].Amount || invoice.Credit < 0 || invoice.Credit > invoice.Debit) reason = 'Invoice amounts do not match the configured charge; finance review is required.';
  else if (!sameText(invoice.Currency || 'NGN', 'NGN')) reason = 'Foreign-currency invoices require finance review.';
  else if (invoice.SchoolSection && !sameText(invoice.SchoolSection, profile.SchoolSection)) reason = 'Invoice school section differs from the profile.';
  // Reversing an erroneous intake-only fee does not depend on unrelated parent
  // profile fields. Require the saved classifications used by this charge instead.
  else if (!candidateOnly && (!clean(student.ClassName || student.className) || !clean(student.StudentType || student.studentType) ||
    [['Gender', 'gender'], ['BillingCategory', 'billingCategory'], ['AcademicProgress', 'academicProgress']].some(([field, alias]) =>
      clean(fees[0][field]) && !sameText(fees[0][field], 'All') && clean(fees[0][field]) !== '*' && !clean(student[field] || student[alias])))) {
    reason = 'Save and verify the billing classifications required by this fee rule before posting.';
  }
  const amount = invoice?.Debit || 0;
  const releasedCredit = invoice?.Credit || 0;
  const sourceCharge = invoice ? buildSchoolInvoiceChargeAccountingJournal(invoice) : null;
  const journals = data.journals || [];
  const priorCharge = journals.find((row) => sameText(row.JournalNo || row.__id, sourceCharge?.JournalNo));
  const baselineJournals = [];
  if (!reason && !candidateOnly) {
    if (priorCharge && (lower(priorCharge.Status) !== 'posted' ||
      journalLineSignature(priorCharge.Lines) !== journalLineSignature(sourceCharge.Lines) ||
      !sameText(priorCharge.BranchId || 'main', profile.BranchId) || !sameText(priorCharge.Date, sourceCharge.Date))) {
      reason = 'The posted invoice journal differs from its source; finance review is required.';
    } else if (!priorCharge) baselineJournals.push(sourceCharge);
    const gap = schoolInvoiceCreditJournalGap(invoice, journals);
    if (gap.invalidPostedJournalIds?.length || gap.missing < -0.005 || (gap.missing > 0.005 && gap.baselineExists)) {
      reason = 'Payment allocations and journals do not reconcile; finance review is required.';
    } else if (gap.missing > 0.005) baselineJournals.push(buildSchoolInvoiceCreditAccountingJournal(invoice, { amount: gap.missing }));
    const ledger = (data.ledger || []).map(normalizeLedger);
    const received = ledger.filter(isAvailableSchoolCreditReceipt).reduce((sum, row) => sum + row.Credit, 0);
    const withdrawn = ledger.filter((row) => normalizeMatchText(row.FeeCategory) === 'account credit').reduce((sum, row) => sum + row.Debit, 0);
    const allocated = (data.invoices || []).map(normalizeInvoice).filter(isSchoolFeeInvoice)
      .reduce((sum, row) => sum + Math.min(row.Debit, row.Credit), 0);
    if (allocated + withdrawn > received + 0.005) reason = 'Allocated parent credit lacks matching receipt evidence; finance review is required.';
    const tracedReceipts = (data.payments || []).map(normalizePayment).filter(isAvailableSchoolCreditReceipt)
      .filter((row) => ['paid', 'success', 'successful', 'completed'].includes(lower(row.Status)))
      .reduce((sum, row) => sum + paymentCreditedAmount(row), 0);
    if (releasedCredit > 0 && tracedReceipts + 0.005 < received) reason = 'Paid charge or transferred credit requires traceable successful receipts; finance review is required.';
    for (const row of (data.payments || []).map(normalizePayment).filter(isAvailableSchoolCreditReceipt)) {
      const receiptJournal = buildPaymentAccountingJournal(row);
      if (!receiptJournal) { reason = 'A receipt cannot be traced to its accounting journal.'; break; }
      const prior = journals.find((journal) => sameText(journal.JournalNo || journal.__id, receiptJournal.JournalNo));
      if (!prior) baselineJournals.push(receiptJournal);
      else if (lower(prior.Status) !== 'posted' || journalLineSignature(prior.Lines) !== journalLineSignature(receiptJournal.Lines) ||
        !sameText(prior.BranchId || 'main', profile.BranchId) || !sameText(prior.Date, receiptJournal.Date)) {
        reason = 'A legacy receipt journal requires finance review before credit can be released.'; break;
      }
    }
  }
  const previewToken = candidateOnly ? '' : await financialPreviewFingerprint({ profile, revision: student.__updateTime, feeItems: data.feeItems,
    invoices: data.invoices, ledger: data.ledger, payments: data.payments, summaries: data.accountSummaries,
    journals: data.journals }, ['feeItems', 'invoices', 'ledger', 'payments', 'summaries', 'journals']);
  return { ok: true, readOnly: true, profile, amount, releasedCredit, outstandingRemoved: asMoneyNumber(amount - releasedCredit),
    invoiceId: invoice?.InvoiceId || '', invoiceDate: invoice?.Date || '', ready: !reason, candidateOnly, reason,
    previewToken,
    baselineJournals, message: 'Preview only. No financial changes. Original invoices and receipts are retained; released allocations become available parent credit.' };
}

export async function getBoardingWearReversalData(env, student) {
  const data = await getStudentBillingData(env, student);
  const candidates = data.invoices.filter((row) => sameText(row.FeeCode || row.feeCode, 'BOW'));
  const groups = await Promise.all(candidates.map((row) => queryCollectionPages(env, 'accountingJournals', {
    filters: [{ field: 'SourceId', op: '==', value: clean(row.InvoiceId || row.invoiceId || row.__id) }], pageSize: 250, maxRows: 2000
  })));
  const receipts = await Promise.all(data.payments.map(normalizePayment).filter(isAvailableSchoolCreditReceipt).map((row) => {
    const journal = buildPaymentAccountingJournal(row);
    return journal ? getDocument(env, 'accountingJournals', safeDocumentId(journal.JournalNo)) : null;
  }));
  data.journals = [...new Map([...groups.flat(), ...receipts.filter(Boolean)].map((row) => [row.__id, row])).values()];
  return data;
}

export async function reverseBoardingWearCharge(env, student, token, actor, approvalReason) {
  if (actor.role !== 'Super Admin' || actor.subscriptionReadOnly || !clean(approvalReason) || clean(approvalReason).length > 500) {
    const error = new Error('Writable Super Admin approval and a reason (up to 500 characters) are required.'); error.status = 403; throw error;
  }
  const data = await getBoardingWearReversalData(env, student);
  const plan = await boardingWearReversalPlan(student, data);
  if (!plan.ready || plan.previewToken !== token) { const error = new Error(plan.reason || 'Financial records changed after preview. Review again.'); error.status = 409; throw error; }
  const date = nowIso().slice(0, 10);
  if (await accountingPeriodIsClosed(env, date)) { const error = new Error('The reversal posting period is closed.'); error.status = 409; throw error; }
  for (const journal of plan.baselineJournals) {
    if (await accountingPeriodIsClosed(env, journal.Date)) { const error = new Error('A missing original journal belongs to a closed period; finance review is required.'); error.status = 409; throw error; }
  }
  const invoice = data.invoices.find((row) => sameText(row.InvoiceId || row.invoiceId || row.__id, plan.invoiceId));
  const reversalId = `BOW-REV-${safeDocumentId(plan.invoiceId)}`;
  const timestamp = nowIso();
  const fields = { FeeChargeReversed: 'YES', FeeChargeReversalId: reversalId, FeeChargeReversalAmount: plan.amount,
    FeeChargeReleasedCredit: plan.releasedCredit, FeeChargeReversedAt: timestamp, FeeChargeReversedBy: actor.username,
    FeeChargeReversalReason: clean(approvalReason) };
  const writes = [];
  const guard = (row, collectionPath) => {
    const field = ['AdmissionNo', 'AccountRef', 'Amount', 'InvoiceId', 'JournalNo', 'FeeCode', 'Credit', 'accountRef', 'amount'].find((key) => Object.hasOwn(row, key));
    if (!row.__id || !row.__updateTime || !field) { const error = new Error('A financial source lacks its revision; no reversal was posted.'); error.status = 409; throw error; }
    writes.push({ collectionPath, documentId: row.__id, updateTime: row.__updateTime, updateMask: [field], data: { [field]: row[field] } });
  };
  guard(student, student.__scopePath || 'students');
  for (const row of data.feeItems.filter((row) => sameText(row.FeeCode || row.feeCode, 'BOW'))) guard(row, 'feeItems');
  for (const row of data.invoices.filter((row) => row.__id !== invoice.__id)) guard(row, 'invoices');
  for (const row of data.ledger) guard(row, 'ledger');
  for (const row of data.payments) guard(row, 'payments');
  for (const row of data.journals) guard(row, 'accountingJournals');
  if (!invoice.__id || !invoice.__updateTime) throw new Error('The invoice lacks its database revision.');
  writes.push({ collectionPath: 'invoices', documentId: invoice.__id, updateTime: invoice.__updateTime,
    updateMask: Object.keys(fields), data: fields });
  const sourceCharge = buildSchoolInvoiceChargeAccountingJournal(invoice);
  const reverseJournal = normalizedJournal({ ...sourceCharge, JournalNo: `SYS-${reversalId}`, Date: date,
    Description: `Boarding Wear charge reversal: ${plan.profile.AccountRef}`, Source: 'Student Invoice Charge Reversal',
    SourceId: plan.invoiceId, ReversalId: reversalId, ReversesJournalNo: sourceCharge.JournalNo,
    RecordedBy: actor.displayName || actor.username, Reason: clean(approvalReason), CreatedAt: timestamp, UpdatedAt: timestamp,
    Lines: sourceCharge.Lines.map((line) => ({ ...line, Debit: line.Credit, Credit: line.Debit })) });
  const journals = [...plan.baselineJournals, reverseJournal];
  if (plan.releasedCredit > 0) journals.push(normalizedJournal({ ...reverseJournal,
    JournalNo: `SYS-${reversalId}-RELEASE`, Source: 'Student Invoice Credit Release',
    Description: `Release original parent credit allocation: ${plan.profile.AccountRef}`,
    ReversesJournalNo: '', ReversesJournalNos: [...data.journals, ...plan.baselineJournals]
      .filter((row) => sameText(row.Source, 'Student Invoice Credit') && sameText(row.SourceId, plan.invoiceId)).map((row) => row.JournalNo),
    TotalDebit: plan.releasedCredit, TotalCredit: plan.releasedCredit,
    Lines: [{ AccountCode: '1100', Debit: plan.releasedCredit, Credit: 0 },
      { AccountCode: '2310', Debit: 0, Credit: plan.releasedCredit }] }));
  for (const journal of journals) writes.push({ collectionPath: 'accountingJournals', documentId: safeDocumentId(journal.JournalNo), exists: false, data: journal });
  const accountRef = plan.profile.AccountRef;
  const summaryId = safeDocumentId(accountRef);
  const summarySnapshot = await getDocument(env, 'accountSummaries', summaryId);
  // A receipt posted since preview must not be overwritten by a stale summary.
  const previewSummary = data.accountSummaries.find((row) => row.__id === summaryId);
  if ((summarySnapshot?.__updateTime || '') !== (previewSummary?.__updateTime || '')) {
    const error = new Error('Account balance changed since preview. No reversal was posted.'); error.status = 409; throw error;
  }
  const summary = calculateAccountFinancialSummary(data.invoices.map((row) => row.__id === invoice.__id ? { ...row, ...fields } : row), data.ledger, accountRef, date);
  writes.push({ collectionPath: 'accountSummaries', documentId: summaryId,
    ...(summarySnapshot ? { updateTime: summarySnapshot.__updateTime } : { exists: false }),
    data: { ...summary, LinkedReferences: accountRefsFrom(student).filter((ref) => !sameText(ref, accountRef)) } });
  const adjustment = { AdjustmentNo: reversalId, Type: 'Student charge reversal', Status: 'Posted', Date: date,
    AccountRef: accountRef, DisplayName: plan.profile.DisplayName, BranchId: plan.profile.BranchId,
    SchoolSection: plan.profile.SchoolSection, AcademicSession: plan.profile.AcademicSession, Term: plan.profile.Term,
    Amount: plan.amount, ReleasedCredit: plan.releasedCredit, Reason: clean(approvalReason), Reference: plan.invoiceId,
    JournalNo: reverseJournal.JournalNo, PostedBy: actor.username, PostedAt: timestamp, OriginalInvoice: invoice };
  writes.push({ collectionPath: 'accountingAdjustments', documentId: reversalId, exists: false, data: adjustment });
  const audit = accountingAuditWrite('REVERSE BOARDING WEAR CHARGE', 'Student invoice', plan.invoiceId,
    { UserRole: actor.role, UserUsername: actor.username, RecordedBy: actor.displayName || actor.username, BranchId: plan.profile.BranchId }, clean(approvalReason));
  Object.assign(audit.data, { SourcePlatform: 'Web', ReversalId: reversalId, Before: invoice, After: fields,
    Amount: plan.amount, ReleasedCredit: plan.releasedCredit, AccountRef: accountRef });
  writes.push(audit);
  if (writes.length > 450) throw new Error('Too many source records; use an individual finance-led reversal. No records changed.');
  await batchCommitDocuments(env, writes);
  return { ok: true, amount: plan.amount, releasedCredit: plan.releasedCredit, summary,
    message: 'Boarding Wear charge reversed. Original invoice and receipts retained; released allocations are available parent credit. Refresh Accounts and the parent portal.' };
}

async function saveOrganizationModulePreferences(env, body) {
  requireAccountingRole(body, ['Super Admin']);
  if (!Array.isArray(body.EnabledModules || body.enabledModules)) {
    const error = new Error('Choose the plan modules this organisation should keep enabled.');
    error.status = 400;
    throw error;
  }
  let organizationProfile = await getDocument(env, 'settings', 'organisationProfile').catch(() => null);
  if (!organizationProfile) {
    const error = new Error('Complete organisation setup before changing enabled modules.');
    error.status = 409;
    throw error;
  }
  organizationProfile = await refreshOrganizationPlanPolicy(env, organizationProfile);
  const organization = resolveOrganizationConfig({ env, organizationProfile });
  if (!organization.SubscriptionActive || organization.SubscriptionReadOnly) {
    const error = new Error(organization.SubscriptionMessage || 'Renew the subscription before changing enabled modules.');
    error.status = 409;
    throw error;
  }
  const planKeys = new Set((organization.ModulePreferences || []).map((module) => module.Key));
  const enabledModules = [...new Set((body.EnabledModules || body.enabledModules).map(clean).filter(Boolean))];
  if (enabledModules.some((key) => !planKeys.has(key))) {
    const error = new Error('One or more selected modules are not included in this organisation plan.');
    error.status = 400;
    throw error;
  }
  const preferences = organizationModulePreferences(
    organization.Edition,
    organization.PlanFeatureFlags,
    [...planKeys].filter((key) => !enabledModules.includes(key))
  );
  const updatedAt = nowIso();
  await patchDocumentFields(env, 'settings', 'organisationProfile', {
    DisabledFeatureEntitlements: preferences.disabledModules,
    FeatureFlags: preferences.featureFlags,
    ModulePreferencesUpdatedAt: updatedAt,
    ModulePreferencesUpdatedBy: clean(body.RecordedBy || body.UserUsername) || 'Desktop Super Admin'
  });
  invalidateStaffAccessCache();
  const updated = resolveOrganizationConfig({
    env,
    organizationProfile: {
      ...organizationProfile,
      DisabledFeatureEntitlements: preferences.disabledModules
    }
  });
  await upsertDocument(env, 'staffSecurityAudit', safeDocumentId(`DESKTOP-MODULES-${Date.now()}-${body.UserUsername}`), {
    Timestamp: updatedAt,
    Action: 'UPDATE ORGANISATION MODULES',
    Username: clean(body.UserUsername),
    Actor: clean(body.RecordedBy || body.UserUsername) || 'Desktop Super Admin',
    SourcePlatform: 'Desktop',
    Details: `${updated.EnabledFeatureEntitlements.length} enabled; ${updated.DisabledFeatureEntitlements.length} disabled`
  });
  return {
    ok: true,
    message: 'Organisation modules updated. Billing and plan entitlements were not changed.',
    modulePreferences: updated.ModulePreferences,
    enabledModules: updated.EnabledFeatureEntitlements,
    disabledModules: updated.DisabledFeatureEntitlements
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
    ReviewedBy: clean(body.RecordedBy || body.ReviewedBy || body.reviewedBy) || 'Admissions Office',
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
  if (yesNo(updates.AcceptanceFeePaid) === 'YES') {
    if (!updates.AcceptanceFeePaidAt) updates.AcceptanceFeePaidAt = now;
    updates.AcceptanceFeeReceivedBy = clean(body.RecordedBy) || updates.ReviewedBy;
  }
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

export function buildEntranceResultUpdates(existing = {}, body = {}, timestamp = nowIso()) {
  const requestedStatus = clean(body.ResultStatus || body.resultStatus || 'Pending').toLowerCase();
  const statusLabels = {
    pending: 'Pending',
    'waiting list': 'Pending',
    probation: 'Probation',
    admitted: 'Admitted',
    passed: 'Admitted',
    'not admitted': 'Not Admitted',
    failed: 'Not Admitted',
    rejected: 'Not Admitted'
  };
  const resultStatus = statusLabels[requestedStatus];
  if (!resultStatus) {
    const error = new Error('Result status must be Pending, Probation, Admitted, or Not Admitted.');
    error.status = 400;
    throw error;
  }
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
    ResultUpdatedAt: timestamp,
    ResultReadyOnline: clean(body.ResultReadyOnline || body.resultReadyOnline || body.ResultPublished || body.ShowResultOnPortal || ''),
    ResultPublished: clean(body.ResultPublished || body.resultPublished || body.ResultReadyOnline || body.ShowResultOnPortal || ''),
    ShowResultOnPortal: clean(body.ShowResultOnPortal || body.showResultOnPortal || body.ResultReadyOnline || body.ResultPublished || ''),
    UpdatedAt: timestamp
  };
  if (resultStatus === 'Admitted') {
    updates.Status = 'Accepted';
    Object.assign(updates, admissionIntakeClassification(existing));
  }
  if (resultStatus === 'Not Admitted') updates.Status = 'Rejected';
  if (resultStatus === 'Pending') updates.Status = 'Pending';
  if (resultStatus === 'Probation') {
    const continuingProbation = clean(existing.ResultStatus).toLowerCase() === 'probation';
    updates.Status = 'Probation';
    updates.ProbationResult = continuingProbation ? (clean(existing.ProbationResult) || 'Pending') : 'Pending';
    updates.ProbationResitStatus = continuingProbation
      ? (clean(existing.ProbationResitStatus) || (clean(existing.ProbationResitDate) ? 'Scheduled' : 'Not Scheduled'))
      : 'Not Scheduled';
    if (!continuingProbation) {
      updates.ProbationResitDate = '';
      updates.ProbationResitScore = '';
      updates.ProbationResitPercentage = '';
      updates.ProbationResultNotes = '';
      updates.ProbationResultUpdatedBy = '';
      updates.ProbationResultUpdatedAt = '';
    }
  }

  const resultChanged = [
    'EnglishScore', 'MathematicsScore', 'InterviewScore', 'TotalScore',
    'ResultPercentage', 'ResultStatus', 'ResultNotes', 'ResultNextStep'
  ].some((field) => clean(existing[field]) !== clean(updates[field]));
  if (resultChanged) {
    updates.ResultSent = 'NO';
    updates.ResultSentAt = '';
    updates.EntranceResultPdfUrl = '';
    updates.EntranceResultPdfFileName = '';
  }
  if (resultStatus !== 'Admitted') {
    updates.OfferSent = 'NO';
    updates.OfferSentAt = '';
    updates.AdmissionLetterSent = 'NO';
    updates.AdmissionLetterSentAt = '';
  }
  return updates;
}

export function buildProbationResitUpdates(existing = {}, body = {}, timestamp = nowIso()) {
  if (clean(existing.ResultStatus).toLowerCase() !== 'probation') {
    const error = new Error('Only an applicant currently on Probation can receive a probation re-sit result.');
    error.status = 409;
    throw error;
  }
  const requestedOutcome = clean(body.ProbationResult || body.ProbationOutcome || body.probationResult || 'Pending').toLowerCase();
  const outcomeLabels = { pending: 'Pending', passed: 'Passed', failed: 'Failed' };
  const outcome = outcomeLabels[requestedOutcome];
  if (!outcome) {
    const error = new Error('Probation result must be Pending, Passed, or Failed.');
    error.status = 400;
    throw error;
  }
  const percentageText = clean(body.ProbationResitPercentage ?? body.ProbationPercentage ?? '');
  if (outcome !== 'Pending') {
    const percentage = Number(percentageText);
    if (!percentageText || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      const error = new Error('Enter a valid probation re-sit percentage from 0 to 100 before recording Passed or Failed.');
      error.status = 400;
      throw error;
    }
  }
  const updatedBy = clean(body.ProbationResultUpdatedBy || body.ResultUpdatedBy || body.RecordedBy) || 'Admissions Office';
  const updates = {
    ProbationResitDate: clean(body.ProbationResitDate || body.probationResitDate),
    ProbationResitScore: clean(body.ProbationResitScore ?? body.ProbationScore ?? ''),
    ProbationResitPercentage: percentageText,
    ProbationResult: outcome,
    ProbationResultNotes: clean(body.ProbationResultNotes || body.ProbationNotes),
    ProbationResultUpdatedBy: updatedBy,
    ProbationResultUpdatedAt: timestamp,
    ProbationResitStatus: outcome === 'Pending'
      ? (clean(body.ProbationResitDate || body.probationResitDate) ? 'Scheduled' : 'Pending')
      : 'Completed',
    ResultUpdatedBy: updatedBy,
    ResultUpdatedAt: timestamp,
    UpdatedAt: timestamp
  };
  if (outcome === 'Passed') {
    Object.assign(updates, admissionIntakeClassification(existing), {
      ResultStatus: 'Admitted',
      Status: 'Accepted',
      ResultNextStep: clean(body.ResultNextStep || body.NextStep) || 'Congratulations. The probation re-sit was passed. Kindly proceed to the Admissions Office for the next stage of admission processing.',
      ResultSent: 'NO',
      ResultSentAt: '',
      OfferSent: 'NO',
      OfferSentAt: '',
      AdmissionLetterSent: 'NO',
      AdmissionLetterSentAt: '',
      EntranceResultPdfUrl: '',
      EntranceResultPdfFileName: ''
    });
  } else {
    updates.ResultStatus = 'Probation';
    updates.Status = 'Probation';
  }
  return updates;
}

async function updateEntranceResult(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const staleResultUrl = clean(existing.EntranceResultPdfUrl);
  const updates = buildEntranceResultUpdates(existing, body);
  const saved = await saveApplication(env, { ...existing, ...updates });
  if (staleResultUrl && Object.hasOwn(updates, 'EntranceResultPdfUrl') && !updates.EntranceResultPdfUrl) {
    await deleteStoredDocument(env, staleResultUrl).catch(() => null);
  }
  return { ok: true, message: 'Entrance result updated.', application: saved };
}

async function updateProbationResit(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const staleResultUrl = clean(existing.EntranceResultPdfUrl);
  const updates = buildProbationResitUpdates(existing, body);
  const saved = await saveApplication(env, { ...existing, ...updates });
  if (staleResultUrl && updates.ProbationResult === 'Passed') {
    await deleteStoredDocument(env, staleResultUrl).catch(() => null);
  }
  return {
    ok: true,
    message: updates.ProbationResult === 'Passed'
      ? 'Probation re-sit passed. Admission status changed to Admitted; send the updated result before issuing an offer.'
      : `Probation re-sit ${updates.ProbationResult.toLowerCase()} result saved. The applicant remains on Probation.`,
    application: saved
  };
}

async function updateApplicantIntelligence(env, body) {
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id) : null;
  if (!existing) throw applicationNotFound(id);
  const ignored = new Set([
    'Secret', 'secret', 'Action', 'action', 'ApplicationID', 'ApplicationReference',
    'UserUsername', 'userUsername', 'UserRole', 'UserDepartment', 'UserBranchId',
    'UserSchoolSectionAccess', 'UserTabAccess', 'RecordedBy', 'UpdatedBy'
  ]);
  const updates = { UpdatedAt: nowIso(), IntelligenceUpdatedBy: clean(body.RecordedBy) || 'Admissions Office' };
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
  const ignored = new Set([
    'Secret', 'secret', 'Action', 'action', 'id', '__id',
    'UserUsername', 'userUsername', 'UserRole', 'UserDepartment', 'UserBranchId',
    'UserSchoolSectionAccess', 'UserTabAccess', 'RecordedBy', 'UpdatedBy'
  ]);
  const updates = { UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) || 'Super Admin' };
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

function nextStudentAdmissionNo(students, session = '', schoolCode = '') {
  const yearMatch = clean(session).match(/20(\d{2})/);
  const yearCode = yearMatch ? yearMatch[1] : String(new Date().getFullYear()).slice(-2);
  const prefix = normalizeSchoolCode(schoolCode) || 'ORG';
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
  const [existingStudents, classNames, schoolProfile] = await Promise.all([
    listSchoolCollection(env, 'students'),
    configuredClassNames(env),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  const importedBy = clean(body.ImportedBy || body.importedBy) || 'Admissions Office';
  let imported = 0;
  let skipped = 0;
  const failures = [];
  const savedStudents = [];
  const credentials = [];
  for (let index = 0; index < rows.length; index += 1) {
    const input = rows[index] || {};
    const rowNo = index + 1;
    const firstName = pick(input, ['FirstName', 'First Name', 'GivenName']);
    const surname = pick(input, ['Surname', 'LastName', 'Last Name', 'FamilyName']);
    const middleName = pick(input, ['MiddleName', 'Middle Name']);
    const legacyName = pick(input, ['ApplicantName', 'StudentName', 'Name']);
    const applicantName = formatPersonName({ FirstName: firstName, MiddleName: middleName, Surname: surname }, schoolProfile || {}, legacyName);
    const classAdmitted = canonicalConfiguredClass(pick(input, ['ClassAdmitted', 'ClassName', 'Class']), classNames);
    const admissionNo = pick(input, ['AdmissionNo', 'AdmissionNumber']);
    const gender = pick(input, ['Gender', 'Sex']);
    if ((!firstName || !surname) && !legacyName) {
      skipped += 1;
      failures.push(`Row ${rowNo}: missing first name or surname.`);
      continue;
    }
    if (!classAdmitted) {
      skipped += 1;
      failures.push(`Row ${rowNo}: missing class.`);
      continue;
    }
    if (!admissionNo) {
      skipped += 1;
      failures.push(`Row ${rowNo}: missing admission number.`);
      continue;
    }
    if (!gender) {
      skipped += 1;
      failures.push(`Row ${rowNo} (${admissionNo}): missing gender.`);
      continue;
    }
    const duplicate = [...existingStudents, ...savedStudents].find((row) =>
      sameReferenceIdentity(row.AdmissionNo || row.admissionNo || row.__id, admissionNo)
    );
    if (duplicate) {
      skipped += 1;
      failures.push(`Row ${rowNo} (${admissionNo}): already exists.`);
      continue;
    }
    const student = {
      EnrolledAt: nowIso(),
      ApplicationReference: '',
      AdmissionNo: admissionNo,
      ApplicantName: applicantName,
      DisplayName: applicantName,
      FirstName: firstName,
      MiddleName: middleName,
      Surname: surname,
      ClassAdmitted: classAdmitted,
      ClassName: classAdmitted,
      Gender: gender,
      ParentEmail: '',
      ParentLoginCode: '',
      VerificationCode: '',
      ParentOnboardingTokenHash: '',
      ParentOnboardingStatus: 'PendingProfile',
      ProfileCompletionStatus: 'Needs completion',
      Status: 'Active',
      ImportedAt: nowIso(),
      ImportedBy: importedBy,
      EnrolledBy: importedBy,
      UpdatedAt: nowIso()
    };
    const saved = await saveStudent(env, student);
    savedStudents.push(saved);
    credentials.push({
      AdmissionNo: admissionNo,
      DisplayName: applicantName,
      TemporaryPassword: '12345678',
      ParentOnboardingPath: '/parent-dashboard#onboarding=1',
      OnboardingStatus: 'Pending profile completion'
    });
    imported += 1;
  }
  return { ok: true, message: 'Student import completed.', imported, skipped, failures, credentials, students: (await listSchoolCollection(env, 'students')).map(normalizeStudent) };
}

async function reissueParentOnboarding(env, body) {
  const accountRef = clean(body.AccountRef || body.AdmissionNo || body.accountRef);
  const existing = await findStudentByAccountRef(env, accountRef, requestedStudentScope(body));
  if (!existing) throw applicationNotFound(accountRef);
  const now = nowIso();
  const student = await saveStudent(env, {
    ...existing,
    ParentOnboardingTokenHash: '',
    ParentOnboardingStatus: 'PendingProfile',
    ProfileCompletionStatus: 'Needs completion',
    ParentOnboardingReissuedAt: now,
    UpdatedAt: now,
    UpdatedBy: clean(body.RecordedBy || body.UpdatedBy) || 'Student Register'
  });
  return {
    ok: true,
    message: 'Parent onboarding is ready. The shared link is available to copy.',
    onboardingPath: '/parent-dashboard#onboarding=1',
    admissionNo: student.AdmissionNo,
    temporaryPassword: '12345678',
    student
  };
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

async function desktopSchoolOperationsActor(env, body, section, write = false) {
  const actor = {
    username: clean(body.UserUsername), displayName: clean(body.RecordedBy || body.UserUsername),
    role: clean(body.UserRole), assignedRole: clean(body.UserAssignedRole || body.UserRole),
    branchId: clean(body.UserBranchId), schoolSectionAccess: clean(body.UserSchoolSectionAccess || 'All'),
    tabAccess: body.UserTabAccess, department: clean(body.UserDepartment)
  };
  const access = await staffAccessFor(env, actor);
  if (!actor.username || access.edition !== 'school' || access.subscriptionActive === false
    || !access.allowedSections?.includes(section) || (write && access.subscriptionReadOnly)) {
    throw Object.assign(new Error('This school module is not available to your account or subscription.'), { status: 403 });
  }
  return { ...access, ...actor };
}

function schoolOperationsScope(body = {}) {
  const branches = [body.DeviceBranchId, body.UserBranchId, body.BranchId || body.branchId]
    .map(clean).filter(value => value && lower(value) !== 'all').map(value => canonicalSchoolBranchId(value));
  const assignedSection = lower(body.UserSchoolSectionAccess);
  const selectedSection = lower(body.SchoolSection || body.SchoolSectionAccess);
  if (new Set(branches).size > 1 || (['primary', 'secondary'].includes(assignedSection)
    && selectedSection && selectedSection !== 'all' && selectedSection !== assignedSection)) {
    throw Object.assign(new Error('Select a record in your authorised branch and school section.'), { status: 403 });
  }
  return { branchId: branches[0] || '', schoolSectionAccess: ['primary', 'secondary'].includes(assignedSection)
    ? assignedSection : ['primary', 'secondary'].includes(selectedSection) ? selectedSection : '', strictReads: true };
}

function schoolOperationsRowVisible(row, scope) {
  const path = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\//i.exec(clean(row.__scopePath));
  if (path && ((row.BranchId && canonicalSchoolBranchId(row.BranchId) !== canonicalSchoolBranchId(path[1]))
    || (row.SchoolSection && schoolSectionFor(row) !== lower(path[2])))) return false;
  return (!scope.branchId || identityRecordBranch(row) === scope.branchId)
    && (!scope.schoolSectionAccess || identityRecordSection(row) === scope.schoolSectionAccess);
}

function schoolOperationsWrite(collectionPath, documentId, data, existing = null) {
  if (existing && !existing.__updateTime) {
    throw Object.assign(new Error('The record version could not be verified. Refresh and retry.'), { status: 409 });
  }
  return { collectionPath, documentId,
    data: Object.fromEntries(Object.entries(data).filter(([key]) => !key.startsWith('__'))),
    ...(existing ? { updateTime: existing.__updateTime } : { exists: false }) };
}

async function commitStudentEnrollment(env, application, student, priorStudent = null) {
  const branch = identityRecordBranch(application);
  const section = identityRecordSection(application);
  const applicationPath = clean(application.__scopePath) || `schoolBranches/${branch}/sections/${section}/applications`;
  const studentPath = clean(student.__scopePath) || identityScopePathForCollection(applicationPath, 'students');
  const studentData = withStudentProfileDefaults({ ...student, BranchId: branch, SchoolSection: section });
  await batchCommitDocuments(env, [
    schoolOperationsWrite(studentPath, clean(priorStudent?.__id) || safeDocumentId(student.AdmissionNo), studentData, priorStudent),
    schoolOperationsWrite(applicationPath, clean(application.__id) || safeDocumentId(application.ApplicationReference),
      { ...application, BranchId: branch, SchoolSection: section }, application)
  ]);
  return { student: normalizeStudent({ ...studentData, __scopePath: studentPath }), application: normalizeApplication(application) };
}

async function enrollStudent(env, body) {
  await desktopSchoolOperationsActor(env, body, 'admissions', true);
  const scope = schoolOperationsScope(body);
  const id = applicationIdFrom(body);
  const existing = id ? await findApplication(env, id, scope) : null;
  if (!existing) throw applicationNotFound(id);
  if (!schoolOperationsRowVisible(existing, scope)) throw Object.assign(new Error('The applicant is outside your permitted workspace.'), { status: 403 });
  if (yesNo(pick(existing, ['Enrolled'])) === 'YES' || pick(existing, ['Status']) === 'Enrolled') throw new Error('Student is already enrolled.');
  if (pick(existing, ['ResultStatus']) !== 'Admitted') throw new Error('Entrance result is not marked Admitted.');
  if (yesNo(pick(existing, ['OfferSent'])) !== 'YES') throw new Error('Offer of Admission has not been sent.');
  if (yesNo(pick(existing, ['AcceptanceFeePaid'])) !== 'YES') throw new Error('Acceptance Fee has not been marked Paid.');
  if (yesNo(pick(existing, ['AdmissionLetterSent'])) !== 'YES' && pick(existing, ['Status']) !== 'Admission Letter Sent') throw new Error('Admission Letter has not been sent.');
  const admissionNo = pick(existing, ['AdmissionNo', 'AdmissionNumber']);
  if (!admissionNo) throw new Error('Admission number is missing.');
  const appRef = pick(existing, ['ApplicationReference', 'ApplicationID']);
  const enrolledBy = clean(body.RecordedBy || body.EnrolledBy || body.enrolledBy) || 'Admissions Office';
  const intakeClassification = admissionIntakeClassification(existing);
  const applicantName = pick(existing, ['ApplicantName', 'Name', 'DisplayName']);
  const studentScopePath = identityScopePathForCollection(existing, 'students')
    || `schoolBranches/${identityRecordBranch(existing)}/sections/${identityRecordSection(existing)}/students`;
  const applicantScope = { branchId: identityRecordBranch(existing), schoolSectionAccess: identityRecordSection(existing) };
  // A migration may have moved only the application or only the student.
  // Search both legacy and scoped storage, but never another branch/section.
  const assignedStudents = (await getSchoolDocumentsById(env, 'students', safeDocumentId(admissionNo), applicantScope, { strictReads: true }))
    .filter(student => schoolOperationsRowVisible(student, applicantScope));
  if (assignedStudents.length > 1) {
    throw enrollmentConflict('More than one student record uses this admission number. Resolve the duplicates before enrolling.', 'ENROLLMENT_DUPLICATE_STUDENT_RECORDS');
  }
  const assignedStudent = assignedStudents[0];
  if (assignedStudent) {
    if (!schoolOperationsRowVisible(assignedStudent, { branchId: identityRecordBranch(existing), schoolSectionAccess: identityRecordSection(existing) })) {
      throw enrollmentConflict('The existing student belongs to another branch or school section.', 'ENROLLMENT_SCOPE_CONFLICT');
    }
    if (!studentMatchesEnrollmentApplication(assignedStudent, existing)) {
      const registeredName = pick(assignedStudent, ['DisplayName', 'ApplicantName', 'Name']) || 'another student';
      throw enrollmentConflict(
        `Admission number ${admissionNo} already belongs to ${registeredName}. Assign a different admission number before enrolling ${applicantName || appRef}.`,
        'ENROLLMENT_ADMISSION_NUMBER_CONFLICT'
      );
    }
    const enrolledAt = pick(existing, ['EnrolledAt']) || nowIso();
    const repairedStudent = {
      ...assignedStudent,
      ApplicationReference: pick(assignedStudent, ['ApplicationReference']) || appRef,
      ...intakeClassification,
      UpdatedAt: nowIso()
    };
    const applicationData = {
      ...existing,
      ...intakeClassification,
      AdmissionNo: pick(assignedStudent, ['AdmissionNo', 'AdmissionNumber']) || admissionNo,
      Enrolled: 'YES',
      EnrolledAt: enrolledAt,
      EnrolledBy: enrolledBy,
      Status: 'Enrolled',
      UpdatedAt: nowIso()
    };
    const { application, student } = await commitStudentEnrollment(env, applicationData, repairedStudent, assignedStudent);
    return {
      ok: true,
      message: 'The existing student record was linked and the application was marked enrolled.',
      reconciled: true,
      application,
      student
    };
  }
  const linkedStudents = appRef ? (await querySchoolCollection(env, 'students', {
    filters: [{ field: 'ApplicationReference', op: '==', value: appRef }],
    scope: applicantScope,
    limit: 10
  })).filter(student => schoolOperationsRowVisible(student, applicantScope)) : [];
  const matchingLinkedStudents = linkedStudents.filter((student) =>
    schoolOperationsRowVisible(student, { branchId: identityRecordBranch(existing), schoolSectionAccess: identityRecordSection(existing) })
    && studentMatchesEnrollmentApplication(student, existing));
  if (matchingLinkedStudents.length === 1) {
    const linkedStudent = matchingLinkedStudents[0];
    const linkedAdmissionNo = pick(linkedStudent, ['AdmissionNo', 'AdmissionNumber']);
    const repairedStudent = {
      ...linkedStudent,
      ApplicationReference: appRef,
      ...intakeClassification,
      UpdatedAt: nowIso()
    };
    const applicationData = {
      ...existing,
      ...intakeClassification,
      AdmissionNo: linkedAdmissionNo || admissionNo,
      Enrolled: 'YES',
      EnrolledAt: pick(existing, ['EnrolledAt']) || nowIso(),
      EnrolledBy: enrolledBy,
      Status: 'Enrolled',
      UpdatedAt: nowIso()
    };
    const { application, student } = await commitStudentEnrollment(env, applicationData, repairedStudent, linkedStudent);
    return {
      ok: true,
      message: 'The existing student record was linked and the application was marked enrolled.',
      reconciled: true,
      application,
      student
    };
  }
  if (matchingLinkedStudents.length > 1) {
    throw enrollmentConflict(
      `More than one student record matches application ${appRef}. Resolve the duplicate student records before enrollment.`,
      'ENROLLMENT_DUPLICATE_STUDENT_RECORDS'
    );
  }
  if (linkedStudents.length) {
    throw enrollmentConflict(
      `Application ${appRef} is already linked to a different student record. Correct that link before enrolling ${applicantName || appRef}.`,
      'ENROLLMENT_APPLICATION_REFERENCE_CONFLICT'
    );
  }
  const admittedClass = canonicalConfiguredClass(pick(existing, ['ClassApplyingFor', 'ClassName']), await configuredClassNames(env));
  const studentData = {
    __scopePath: studentScopePath,
    BranchId: identityRecordBranch(existing),
    SchoolSection: identityRecordSection(existing),
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
    ...intakeClassification,
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
  };
  const { application, student } = await commitStudentEnrollment(env,
    { ...existing, ...intakeClassification, Enrolled: 'YES', EnrolledAt: nowIso(), EnrolledBy: enrolledBy, Status: 'Enrolled', UpdatedAt: nowIso() }, studentData);
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
    BranchId: clean(sale.BranchId || sale.branchId || 'main').toLowerCase() || 'main',
    Lines: [
      { AccountCode: cashCode, Debit: amount, Credit: 0, Description: 'Form sale net receipt' },
      { AccountCode: '4010', Debit: 0, Credit: amount, Description: 'Admission form revenue' }
    ],
    TotalDebit: amount, TotalCredit: amount, CreatedAt: sale.CreatedAt || nowIso(), UpdatedAt: nowIso()
  });
}

async function completeFormSaleProcessing(env, sale, documentId) {
  const amounts = formSaleFinancialAmounts(sale);
  const savedId = safeDocumentId(documentId || sale.__id || sale.ReceiptNo);
  await patchDocumentFields(env, 'formSales', savedId, {
    ProcessingStatus: 'Processing',
    ProcessingVersion: 2,
    ProcessingStartedAt: sale.ProcessingStartedAt || nowIso(),
    UpdatedAt: nowIso()
  });
  if (amounts.GatewayFee > 0) {
    const chargeId = safeDocumentId(`PAYSTACK-FORM-FEE-${sale.PaymentReference || sale.ReceiptNo}`);
    await upsertDocument(env, 'paymentGatewayCharges', chargeId, {
      ChargeId: chargeId, Date: sale.PaymentDate,
      Description: `Paystack admission-form transaction charge - ${sale.PaymentReference || sale.ReceiptNo}`,
      Amount: amounts.GatewayFee, GrossCollection: amounts.GrossAmount, NetSettlement: amounts.NetAmount,
      Treatment: 'DeductedBeforeRevenueRecognition', Status: 'Recorded',
      Reference: sale.PaymentReference || sale.ReceiptNo, Source: 'Paystack Admission Form',
      CreatedAt: sale.CreatedAt || nowIso(), UpdatedAt: nowIso()
    });
  }
  await writeFormSaleAccountingJournal(env, { ...sale, ...amounts });
  await patchDocumentFields(env, 'formSales', savedId, {
    ProcessingStatus: 'Completed',
    ProcessingVersion: 2,
    ProcessingCompletedAt: nowIso(),
    UpdatedAt: nowIso()
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
    await completeFormSaleProcessing(env, sameReceipt, sameReceipt.__id || receiptNo);
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
    ClassApplyingFor: canonicalConfiguredClass(
      clean(body.ClassApplyingFor),
      await configuredClassNames(env, { BranchId: body.BranchId || body.branchId })
    ),
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
    RecordedBy: clean(body.RecordedBy) || 'Admissions Office',
    RecordedByUsername: clean(body.UserUsername),
    BranchId: clean(body.BranchId || body.branchId || 'main').toLowerCase() || 'main',
    SchoolSection: clean(body.SchoolSection || body.schoolSection),
    ProcessingStatus: 'Processing',
    ProcessingVersion: 2,
    ProcessingStartedAt: nowIso(),
    CreatedAt: nowIso(),
    UpdatedAt: nowIso()
  };
  const created = await createDocumentIfAbsent(env, 'formSales', safeDocumentId(sale.ReceiptNo), sale);
  if (!created.created) {
    const existingSale = created.document || sale;
    await completeFormSaleProcessing(env, existingSale, existingSale.__id || sale.ReceiptNo);
    return {
      ok: true, duplicate: true, message: 'Sale already recorded.',
      receiptNo: sale.ReceiptNo, verificationCode: existingSale.VerificationCode || sale.VerificationCode,
      email: existingSale.Email || sale.Email, expiryDate: existingSale.ExpiryDate || sale.ExpiryDate
    };
  }
  await completeFormSaleProcessing(env, sale, sale.ReceiptNo);
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
    message: 'Form purchases loaded from the database.',
    backend: 'firestore',
    sales
  };
}

function normalizeAdmissionClass(row) {
  const minimumAge = normalizeMinimumAdmissionAge(pick(row, [
    'minimumAge', 'MinimumAge', 'minimumAdmissionAge', 'MinimumAdmissionAge'
  ]));
  return {
    ...row,
    ClassName: pick(row, ['className', 'ClassName', '__id']),
    FormAmount: asMoneyNumber(pick(row, ['formAmount', 'FormAmount'])),
    Active: yesNo(pick(row, ['active', 'Active'])),
    SortOrder: asMoneyNumber(pick(row, ['sortOrder', 'SortOrder'], 100)),
    MinimumAge: minimumAge === null ? '' : minimumAge
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

const BRANCH_SCHOOL_SETTINGS_COLLECTION = 'branchSchoolSettings';

function branchSchoolCollection(branchId, collectionName) {
  return `organisationBranches/${safeScopeId(branchId)}/${collectionName}`;
}

async function schoolSettingsContext(env, options = {}) {
  const requestedBranch = clean(options.BranchId || options.branchId);
  const assignedBranch = clean(options.UserBranchId || options.userBranchId);
  const settingsScope = clean(options.SettingsScope || options.settingsScope).toLowerCase();
  if (!requestedBranch && !assignedBranch && settingsScope !== 'branch') {
    return { scope: 'organisation', branchId: '', branchName: '', metadata: {} };
  }
  if (assignedBranch && requestedBranch && safeScopeId(assignedBranch) !== safeScopeId(requestedBranch)) {
    const error = new Error('This account may configure only its assigned branch.');
    error.status = 403;
    throw error;
  }
  const branch = await assertConfiguredProfileBranch(env, assignedBranch || requestedBranch);
  const metadata = await getDocument(env, BRANCH_SCHOOL_SETTINGS_COLLECTION, branch.id).catch(() => null) || {};
  return { scope: 'branch', branchId: branch.id, branchName: branch.name, metadata };
}

function independentBranchSetup(context, field) {
  return context.scope === 'branch' && clean(context.metadata?.[field]).toLowerCase() === 'independent';
}

async function replaceSettingsCollection(env, collectionPath, rows, normalizeRow, payloadForRow) {
  const keepIds = new Set();
  const savedRows = new Map();
  let saved = 0;
  for (const item of rows) {
    const className = clean(item.ClassName || item.className || item);
    if (!className) continue;
    const documentId = safeDocumentId(className);
    const payload = payloadForRow(item, className, saved);
    keepIds.add(documentId);
    await upsertDocument(env, collectionPath, documentId, payload);
    savedRows.set(documentId, normalizeRow({ ...payload, __id: documentId }));
    saved += 1;
  }
  for (const existing of await listCollection(env, collectionPath)) {
    const existingId = clean(existing.__id || safeDocumentId(existing.ClassName || ''));
    if (existingId && !keepIds.has(existingId)) await deleteDocument(env, collectionPath, existingId);
  }
  return { saved, rows: [...savedRows.values()] };
}

async function markIndependentBranchSetup(env, context, field, updatedBy) {
  if (context.scope !== 'branch') return;
  await upsertDocument(env, BRANCH_SCHOOL_SETTINGS_COLLECTION, context.branchId, {
    ...context.metadata,
    BranchId: context.branchId,
    BranchName: context.branchName,
    [field]: 'independent',
    UpdatedAt: nowIso(),
    UpdatedBy: updatedBy
  });
}

export async function getSchoolClasses(env, options = {}) {
  const context = await schoolSettingsContext(env, options);
  const independent = independentBranchSetup(context, 'ClassSetupMode');
  const collectionPath = independent
    ? branchSchoolCollection(context.branchId, 'schoolClasses')
    : 'settings/academics/classes';
  const classes = (await listCollection(env, collectionPath))
    .map(normalizeSchoolClass)
    .sort((a, b) => asMoneyNumber(a.SortOrder) - asMoneyNumber(b.SortOrder));
  return {
    ok: true,
    message: context.scope === 'branch'
      ? `${context.branchName} ${independent ? 'independent classes' : 'inherited organisation classes'} loaded.`
      : 'Organisation class defaults loaded from the database.',
    backend: 'firestore',
    settingsScope: context.scope,
    branchId: context.branchId,
    branchName: context.branchName,
    inherited: context.scope === 'branch' && !independent,
    setupMode: independent ? 'independent' : 'inherit',
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
  const context = await schoolSettingsContext(env, body);
  const collectionPath = context.scope === 'branch'
    ? branchSchoolCollection(context.branchId, 'schoolClasses')
    : 'settings/academics/classes';
  const result = await replaceSettingsCollection(env, collectionPath, classes, normalizeSchoolClass, (item, className, saved) => ({
      ClassName: className,
      Arms: clean(item.Arms || item.arms || item.ClassArms),
      Active: yesNo(item.Active ?? item.active ?? 'YES') || 'YES',
      SortOrder: asMoneyNumber(item.SortOrder || item.sortOrder || saved + 1),
      BranchId: context.branchId,
      UpdatedAt: updatedAt,
      UpdatedBy: updatedBy
    }));
  await markIndependentBranchSetup(env, context, 'ClassSetupMode', updatedBy);
  invalidateConfiguredClassCache();
  const normalizedClasses = result.rows
    .sort((a, b) => asMoneyNumber(a.SortOrder) - asMoneyNumber(b.SortOrder));
  return {
    ok: true,
    message: `${context.scope === 'branch' ? `${context.branchName} independent` : 'Organisation default'} classes saved (${result.saved}).`,
    saved: result.saved,
    backend: 'firestore',
    settingsScope: context.scope,
    branchId: context.branchId,
    branchName: context.branchName,
    inherited: false,
    setupMode: context.scope === 'branch' ? 'independent' : 'organisation',
    classes: normalizedClasses
  };
}

async function resetSchoolClasses(env, body) {
  const context = await schoolSettingsContext(env, { ...body, SettingsScope: 'branch' });
  for (const row of await listCollection(env, branchSchoolCollection(context.branchId, 'schoolClasses'))) {
    const id = clean(row.__id || safeDocumentId(row.ClassName || ''));
    if (id) await deleteDocument(env, branchSchoolCollection(context.branchId, 'schoolClasses'), id);
  }
  await upsertDocument(env, BRANCH_SCHOOL_SETTINGS_COLLECTION, context.branchId, {
    ...context.metadata,
    BranchId: context.branchId,
    BranchName: context.branchName,
    ClassSetupMode: 'inherit',
    UpdatedAt: nowIso(),
    UpdatedBy: clean(body.UpdatedBy || body.updatedBy || body.UserRole) || 'School Office'
  });
  invalidateConfiguredClassCache();
  return getSchoolClasses(env, { BranchId: context.branchId });
}

export async function getAdmissionClasses(env, options = {}) {
  const context = await schoolSettingsContext(env, options);
  const independent = independentBranchSetup(context, 'AdmissionSetupMode');
  const collectionPath = independent
    ? branchSchoolCollection(context.branchId, 'admissionClasses')
    : 'settings/admission/classes';
  const classes = (await listCollection(env, collectionPath))
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
    message: context.scope === 'branch'
      ? `${context.branchName} ${independent ? 'independent admission setup' : 'inherited organisation admission setup'} loaded.`
      : 'Organisation admission defaults loaded from the database.',
    backend: 'firestore',
    settingsScope: context.scope,
    branchId: context.branchId,
    branchName: context.branchName,
    inherited: context.scope === 'branch' && !independent,
    setupMode: independent ? 'independent' : 'inherit',
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
  const updatedBy = clean(body.RecordedBy || body.UpdatedBy || body.updatedBy) || 'Admissions Office';
  const context = await schoolSettingsContext(env, body);
  const schoolClassSetup = await getSchoolClasses(
    env,
    context.scope === 'branch' ? { BranchId: context.branchId } : {}
  );
  const configuredClassKeys = new Set((schoolClassSetup.classes || [])
    .map((item) => clean(item.ClassName || item.className).toLowerCase())
    .filter(Boolean));
  const unknownClasses = configuredClassKeys.size
    ? classes.map((item) => clean(item.ClassName || item.className || item))
      .filter((className) => className && !configuredClassKeys.has(className.toLowerCase()))
    : [];
  if (unknownClasses.length) {
    const error = new Error(`Admission classes must come from this ${context.scope === 'branch' ? 'branch' : 'organisation'} class setup: ${unknownClasses.join(', ')}.`);
    error.status = 400;
    throw error;
  }
  const collectionPath = context.scope === 'branch'
    ? branchSchoolCollection(context.branchId, 'admissionClasses')
    : 'settings/admission/classes';
  const result = await replaceSettingsCollection(env, collectionPath, classes, normalizeAdmissionClass, (item, className, saved) => {
    const rawMinimumAge = item.MinimumAge ?? item.minimumAge
      ?? item.MinimumAdmissionAge ?? item.minimumAdmissionAge ?? '';
    const minimumAge = normalizeMinimumAdmissionAge(rawMinimumAge);
    if (clean(rawMinimumAge) && minimumAge === null) {
      const err = new Error(`Minimum admission age for ${className} must be a whole number from 0 to 120.`);
      err.status = 400;
      throw err;
    }
    return {
      ClassName: className,
      FormAmount: asMoneyNumber(item.FormAmount || item.formAmount || formAmount),
      Active: yesNo(item.Active ?? item.active ?? 'NO') || 'NO',
      SortOrder: asMoneyNumber(item.SortOrder || item.sortOrder || saved + 1),
      MinimumAge: minimumAge === null ? '' : minimumAge,
      BranchId: context.branchId,
      UpdatedAt: updatedAt,
      UpdatedBy: updatedBy
    };
  });
  await markIndependentBranchSetup(env, context, 'AdmissionSetupMode', updatedBy);
  const loaded = await getAdmissionClasses(env, context.scope === 'branch' ? { BranchId: context.branchId } : {});
  return {
    ...loaded,
    message: `${context.scope === 'branch' ? `${context.branchName} independent` : 'Organisation default'} admission setup saved (${result.saved}).`,
    saved: result.saved
  };
}

async function resetAdmissionClasses(env, body) {
  const context = await schoolSettingsContext(env, { ...body, SettingsScope: 'branch' });
  const collectionPath = branchSchoolCollection(context.branchId, 'admissionClasses');
  for (const row of await listCollection(env, collectionPath)) {
    const id = clean(row.__id || safeDocumentId(row.ClassName || ''));
    if (id) await deleteDocument(env, collectionPath, id);
  }
  await upsertDocument(env, BRANCH_SCHOOL_SETTINGS_COLLECTION, context.branchId, {
    ...context.metadata,
    BranchId: context.branchId,
    BranchName: context.branchName,
    AdmissionSetupMode: 'inherit',
    UpdatedAt: nowIso(),
    UpdatedBy: clean(body.UpdatedBy || body.updatedBy || body.UserRole) || 'Admissions Office'
  });
  return getAdmissionClasses(env, { BranchId: context.branchId });
}

export function feeCodeRenameAllowed(originalFeeCode, feeCode) {
  return !clean(originalFeeCode) || sameText(originalFeeCode, feeCode);
}

async function saveFeeItem(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const branchId = feeSetupBranch(body);
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
  const [target, classNames] = await Promise.all([
    resolveFeeDocument(env, branchId, feeCode),
    configuredClassNames(env, { BranchId: branchId })
  ]);
  const existing = target.existing || {};
  const className = canonicalConfiguredClass(clean(body.ClassName || body.className) || 'All', classNames);
  const billingCategories = normalizeFeeBillingCategories(
    body.BillingCategories ?? body.billingCategories ?? body.BillingCategory ?? body.billingCategory
  );
  const payload = {
    ...existing,
    BranchId: branchId,
    FeeCode: feeCode,
    FeeName: clean(body.FeeName || body.feeName),
    FeeCategory: clean(body.FeeCategory || body.feeCategory) || 'School Fee',
    ClassName: className,
    StudentType: clean(body.StudentType || body.studentType) || 'All',
    BillingCategories: billingCategories,
    BillingCategory: feeBillingCategoryText(billingCategories),
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
  await batchCommitDocuments(env, [feeDocumentWrite(target, payload)]);
  return { ok: true, message: 'Fee item saved to the database.', fee: normalizeFeeItem(payload) };
}

async function saveFeeItems(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const branchId = feeSetupBranch(body);
  const items = Array.isArray(body.Items || body.items) ? (body.Items || body.items) : [];
  if (!items.length) {
    const err = new Error('At least one fee item is required.');
    err.status = 400;
    throw err;
  }
  if (items.length > 100) {
    const err = new Error('A maximum of 100 fee items can be saved at once.');
    err.status = 413;
    throw err;
  }
  const classNames = await configuredClassNames(env, { BranchId: branchId });
  const seenFeeCodes = new Set();
  const prepared = items.map((item) => {
    if (clean(item.BranchId || item.branchId) && feeBranchId(item) !== branchId) {
      const error = new Error('Every fee item must belong to the selected branch.'); error.status = 403; throw error;
    }
    const feeCode = clean(item.FeeCode || item.feeCode);
    if (!feeCode) {
      const err = new Error('Every fee item requires a FeeCode.');
      err.status = 400;
      throw err;
    }
    const originalFeeCode = clean(item.OriginalFeeCode || item.originalFeeCode);
    if (!feeCodeRenameAllowed(originalFeeCode, feeCode)) {
      const err = new Error('FeeCode is a permanent accounting identifier and cannot be renamed. Create a new fee code instead.');
      err.status = 409;
      throw err;
    }
    const normalizedCode = feeCode.toLowerCase();
    if (seenFeeCodes.has(normalizedCode)) {
      const err = new Error(`FeeCode ${feeCode} occurs more than once in this batch.`);
      err.status = 400;
      throw err;
    }
    seenFeeCodes.add(normalizedCode);
    return { item, feeCode };
  });
  const updatedAt = nowIso();
  const targets = await Promise.all(prepared.map(({ feeCode }) => resolveFeeDocument(env, branchId, feeCode)));
  const fees = prepared.map(({ item, feeCode }, index) => {
    const billingCategories = normalizeFeeBillingCategories(
      item.BillingCategories ?? item.billingCategories ?? item.BillingCategory ?? item.billingCategory
    );
    return normalizeFeeItem({
      ...(targets[index].existing || {}),
      BranchId: branchId,
      FeeCode: feeCode,
      FeeName: clean(item.FeeName || item.feeName),
      FeeCategory: clean(item.FeeCategory || item.feeCategory) || 'School Fee',
      ClassName: canonicalConfiguredClass(clean(item.ClassName || item.className) || 'All', classNames),
      StudentType: clean(item.StudentType || item.studentType) || 'All',
      BillingCategories: billingCategories,
      BillingCategory: feeBillingCategoryText(billingCategories),
      Gender: clean(item.Gender || item.gender) || 'All',
      EnrollmentCategory: clean(item.EnrollmentCategory || item.enrollmentCategory || item.IntakeCategory) || 'All',
      AcademicProgress: clean(item.AcademicProgress || item.academicProgress || item.ProgressCategory) || 'All',
      AcademicSession: clean(item.AcademicSession || item.academicSession) || 'All',
      Term: clean(item.Term || item.term) || 'All',
      Amount: asMoneyNumber(item.Amount || item.amount),
      Currency: clean(item.Currency || item.currency) || 'NGN',
      PayableOnline: yesNo(item.PayableOnline ?? item.payableOnline ?? 'YES') || 'YES',
      AllowInstallment: yesNo(item.AllowInstallment ?? item.allowInstallment ?? 'NO') || 'NO',
      PartPaymentMode: clean(item.PartPaymentMode || item.partPaymentMode) || 'Item',
      MinAmount: asMoneyNumber(item.MinAmount || item.minAmount),
      MaxAmount: asMoneyNumber(item.MaxAmount || item.maxAmount),
      DueDate: clean(item.DueDate || item.dueDate || item.PaymentDueDate || item.paymentDueDate),
      RequiredForEnrollment: yesNo(item.RequiredForEnrollment ?? item.requiredForEnrollment ?? 'NO') || 'NO',
      Active: yesNo(item.Active ?? item.active ?? 'YES') || 'YES',
      SortOrder: asMoneyNumber(item.SortOrder || item.sortOrder || 100),
      Notes: clean(item.Notes || item.notes),
      CreatedAt: targets[index].existing?.CreatedAt || updatedAt,
      UpdatedAt: updatedAt
    });
  });
  await batchCommitDocuments(env, fees.map((fee, index) => feeDocumentWrite(targets[index], fee)));
  return {
    ok: true,
    message: `${fees.length} fee item(s) saved to the database.`,
    saved: fees.length,
    fees
  };
}

async function deleteFeeItem(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const branchId = feeSetupBranch(body);
  const feeCode = clean(body.FeeCode || body.feeCode);
  if (!feeCode) {
    const err = new Error('FeeCode is required.');
    err.status = 400;
    throw err;
  }
  const target = await resolveFeeDocument(env, branchId, feeCode);
  if (!target.existing) { const error = new Error('This fee does not exist in the selected branch.'); error.status = 404; throw error; }
  await batchCommitDocuments(env, [feeDocumentWrite(target, null, 'delete')]);
  return { ok: true, message: 'Fee item deleted from the database.' };
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

async function seedDefaultFeeItems(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const branchId = feeSetupBranch(body);
  const existing = feeRowsForBranch(await loadBranchFinanceRows(env, 'feeItems', branchId), branchId).map(normalizeFeeItem);
  const existingCodes = new Set(existing.map((item) => clean(item.FeeCode).toUpperCase()));
  let added = 0;
  for (const item of DEFAULT_FEE_ITEMS) {
    if (existingCodes.has(clean(item.FeeCode).toUpperCase())) continue;
    const target = await resolveFeeDocument(env, branchId, item.FeeCode);
    if (target.existing) continue;
    await batchCommitDocuments(env, [feeDocumentWrite(target, {
      ...item,
      BranchId: branchId,
      CreatedAt: nowIso(),
      UpdatedAt: nowIso()
    })]);
    added += 1;
  }
  return { ok: true, message: added ? 'Default fee items created in the database.' : 'Default fee items already exist in the database.', added,
    feeItems: feeRowsForBranch(await loadBranchFinanceRows(env, 'feeItems', branchId), branchId).map(normalizeFeeItem) };
}

export async function queryAccountRows(env, collection, accountRef, financialScope = null, options = {}) {
  const wanted = clean(accountRef);
  if (!wanted) return [];
  const normalized = normalizeReferenceText(wanted);
  try {
    const rows = await (options.strict ? queryCollectionPages : queryCollection)(env, collection, {
      filters: [
        { field: 'AccountRefNormalized', op: '==', value: normalized },
        { field: 'AccountRef', op: '==', value: wanted },
        { field: 'AdmissionNo', op: '==', value: wanted },
        { field: 'ApplicationReference', op: '==', value: wanted }
      ],
      filterJoin: 'OR', ...(options.strict ? { pageSize: 500, maxRows: 20000 } : {})
    });
    return rows.map((row) => assertManualPaymentScope(row, financialScope, collection));
  } catch (error) {
    // Older Firestore projects may not yet have the disjunction index. Keep
    // their legacy three-query fallback while newly deployed indexes settle.
    if (!/index|failed precondition/i.test(clean(error?.message))) throw error;
  }
  const groups = await Promise.all(['AccountRef', 'AdmissionNo', 'ApplicationReference'].map((field) => {
    return (options.strict ? queryCollectionPages : queryCollection)(env, collection, {
      filters: [{ field, op: '==', value: wanted }], ...(options.strict ? { pageSize: 500, maxRows: 20000 } : {})
    }).catch((error) => { if (financialScope || options.strict) throw error; return []; });
  }));
  const unique = new Map();
  groups.flat().forEach((row) => unique.set(clean(row.__name || row.__id) || JSON.stringify(row), row));
  return [...unique.values()].map((row) => assertManualPaymentScope(row, financialScope, collection));
}

async function queryAccountRowsForReferences(env, collection, references = [], financialScope = null, options = {}) {
  const wanted = [...new Set((references || []).map(clean).filter(Boolean))];
  const groups = await Promise.all(wanted.map((reference) => queryAccountRows(env, collection, reference, financialScope, options)));
  const unique = new Map();
  groups.flat().forEach((row) => unique.set(clean(row.__name || row.__id) || JSON.stringify(row), row));
  return [...unique.values()];
}

async function findPaymentByReference(env, reference, options = {}) {
  const documentId = safeDocumentId(reference);
  const readFailure = (error) => { if (options.strictReads) throw error; return null; };
  const direct = await getDocument(env, 'payments', documentId).catch(readFailure);
  if (direct) return direct;
  if (options.canonicalOnly) return null;
  const byReference = await findOneByField(env, 'payments', 'Reference', reference).catch(readFailure);
  if (byReference) return byReference;
  return findOneByField(env, 'payments', 'GatewayReference', reference).catch(readFailure);
}

async function readScopedFinancialDocument(env, collection, id, financialScope, label = collection, options = {}) {
  const row = await getDocument(env, collection, id).catch((error) => { if (financialScope) throw error; return null; });
  return assertManualPaymentScope(row, financialScope, label, options);
}

export function buildPaymentAccountingJournal(payment = {}, hasMatchingInvoice = false, edition = 'school') {
  const sourceId = clean(payment.Reference || payment.GatewayReference || payment.PaymentId || payment.__id);
  const amount = paymentCreditedAmount(payment);
  if (!sourceId || amount <= 0) return null;
  const journalNo = `SYS-PAY-${safeDocumentId(sourceId)}`;
  const cash = accountingCashAccountFor(payment.Method, payment.Gateway);
  const destination = accountingDestinationForPayment(payment, hasMatchingInvoice, edition);
  const lines = [
    { AccountCode: cash, Debit: amount, Credit: 0, Description: clean(payment.Method || payment.Gateway || 'Payment received') },
    { AccountCode: destination, Debit: 0, Credit: amount, Description: clean(payment.AccountRef || payment.DisplayName) }
  ];
  return normalizedJournal({
    JournalNo: journalNo, Date: payment.PaidAt || payment.PaymentDate || payment.Date || nowIso(), Status: 'Posted',
    Description: `Receipt: ${sourceId}`, Reference: sourceId,
    Source: 'Fee Payment', SourceId: sourceId, RecordedBy: 'System',
    BranchId: clean(payment.BranchId || payment.branchId || 'main').toLowerCase() || 'main',
    AcademicSession: payment.AcademicSession || '', Term: payment.Term || '',
    Lines: lines, TotalDebit: amount, TotalCredit: amount,
    CreatedAt: payment.RecordedAt || nowIso(), UpdatedAt: nowIso()
  });
}

export function buildSchoolPaymentReclassificationJournal(payment = {}, postedReceipt = {}, date = nowIso()) {
  if (!isAvailableSchoolCreditReceipt(payment) || clean(postedReceipt.Status).toLowerCase() !== 'posted') return null;
  const desired = buildPaymentAccountingJournal(payment);
  if (!desired) return null;
  const priorBranch = clean(postedReceipt.BranchId || 'main').toLowerCase();
  if (priorBranch !== clean(desired.BranchId || 'main').toLowerCase() ||
    !sameText(postedReceipt.Date, desired.Date) ||
    !sameText(postedReceipt.AcademicSession, desired.AcademicSession) ||
    !sameText(postedReceipt.Term, desired.Term)) return null;
  const lines = accountingLines(postedReceipt.Lines);
  const credits = lines.filter((line) => asMoneyNumber(line.Credit) > 0);
  const debits = lines.filter((line) => asMoneyNumber(line.Debit) > 0);
  if (credits.length !== 1 || debits.length !== 1 ||
    asMoneyNumber(credits[0].Credit) !== desired.TotalCredit ||
    asMoneyNumber(debits[0].Debit) !== desired.TotalDebit ||
    clean(debits[0].AccountCode) !== clean(desired.Lines[0].AccountCode)) return null;
  const priorDestination = clean(credits[0].AccountCode);
  if (!priorDestination || priorDestination === '2310') return null;
  return normalizedJournal({
    JournalNo: `SYS-PAYRECLASS-${safeDocumentId(desired.SourceId)}`,
    Date: clean(date).slice(0, 10), Status: 'Posted',
    Description: `Reclassify parent advance: ${desired.SourceId}`,
    Reference: desired.Reference, Source: 'Student Advance Reclassification', SourceId: desired.SourceId,
    AccountRef: clean(payment.AccountRef),
    BranchId: desired.BranchId, AcademicSession: desired.AcademicSession, Term: desired.Term,
    RecordedBy: 'System',
    Lines: [
      { AccountCode: priorDestination, Debit: desired.TotalDebit, Credit: 0, Description: 'Reverse legacy receipt destination' },
      { AccountCode: '2310', Debit: 0, Credit: desired.TotalCredit, Description: clean(payment.AccountRef || payment.DisplayName) }
    ],
    TotalDebit: desired.TotalDebit, TotalCredit: desired.TotalCredit,
    CreatedAt: nowIso(), UpdatedAt: nowIso()
  });
}

async function createSchoolPaymentReclassificationIfAbsent(env, journal, financialScope = null, options = {}) {
  const documentId = safeDocumentId(journal.JournalNo);
  const prior = await readScopedFinancialDocument(env, 'accountingJournals', documentId, financialScope, 'Payment reclassification', { accountRequired: false });
  if (prior) {
    if (lower(prior.Status) !== 'posted' ||
      journalLineSignature(prior.Lines) !== journalLineSignature(journal.Lines) ||
      !sameText(prior.Reference, journal.Reference) || !sameText(prior.SourceId, journal.SourceId) ||
      !sameText(prior.BranchId, journal.BranchId) ||
      !sameText(prior.AcademicSession, journal.AcademicSession) ||
      !sameText(prior.Term, journal.Term) || !timestampMs(prior.Date)) {
      const err = new Error(`Reclassification ${journal.JournalNo} differs from its posted journal; finance review is required.`);
      err.status = 409;
      throw err;
    }
    return false;
  }
  if (await accountingPeriodIsClosed(env, journal.Date)) {
    const err = new Error(`Reclassification ${journal.JournalNo} falls in a closed accounting period; finance review is required.`);
    err.status = 409;
    throw err;
  }
  if (options.prepareWrite) {
    await options.prepareWrite(journal);
    return true;
  }
  const created = await createDocumentIfAbsent(env, 'accountingJournals', documentId, journal);
  if (!created.created) {
    const existing = created.document || await getDocument(env, 'accountingJournals', documentId);
    assertManualPaymentScope(existing, financialScope, 'Payment reclassification', { accountRequired: false });
    if (lower(existing?.Status) !== 'posted' ||
      journalLineSignature(existing?.Lines) !== journalLineSignature(journal.Lines) ||
      !sameText(existing?.Reference, journal.Reference) ||
      !sameText(existing?.SourceId, journal.SourceId) ||
      !sameText(existing?.BranchId, journal.BranchId) ||
      !sameText(existing?.AcademicSession, journal.AcademicSession) ||
      !sameText(existing?.Term, journal.Term) || !timestampMs(existing?.Date)) {
      const err = new Error(`Reclassification ${journal.JournalNo} was changed concurrently; finance review is required.`);
      err.status = 409;
      throw err;
    }
  }
  return created.created;
}

async function writePaymentAccountingJournal(env, payment, hasMatchingInvoice, financialScope = null) {
  const edition = accountingEditionForRequest(env);
  const journal = buildPaymentAccountingJournal(payment, hasMatchingInvoice, edition);
  if (!journal) return null;
  if (edition === 'school' && isAvailableSchoolCreditReceipt(payment)) await seedAccountingChart(env);
  const prior = await readScopedFinancialDocument(env, 'accountingJournals', safeDocumentId(journal.JournalNo), financialScope, 'Payment accounting journal', { accountRequired: false });
  assertManualPaymentDestination(prior, financialScope, journal.SourceId, 'Payment accounting journal', { accountRequired: false });
  if (prior?.PaymentCorrectionTotal) return prior;
  if (prior && edition === 'school' && isAvailableSchoolCreditReceipt(payment)) {
    if (lower(prior.Status) !== 'posted') {
      const err = new Error('The existing payment journal is not posted; finance review is required.');
      err.status = 409;
      throw err;
    }
    if (!sameText(prior.Date, journal.Date) || !sameText(prior.BranchId || 'main', journal.BranchId) ||
      !sameText(prior.AcademicSession, journal.AcademicSession) || !sameText(prior.Term, journal.Term) ||
      !sameText(prior.Reference, journal.Reference) || !sameText(prior.SourceId, journal.SourceId)) {
      const err = new Error('The existing payment journal has a conflicting reference or accounting period; finance review is required.');
      err.status = 409;
      throw err;
    }
    if (journalLineSignature(prior.Lines) !== journalLineSignature(journal.Lines)) {
      const reclassification = buildSchoolPaymentReclassificationJournal(payment, prior);
      if (!reclassification) {
        const err = new Error('The existing payment journal needs finance review before its parent credit can be used.');
        err.status = 409;
        throw err;
      }
      await createSchoolPaymentReclassificationIfAbsent(env, reclassification, financialScope);
    }
    return prior;
  }
  if (!prior && await accountingPeriodIsClosed(env, journal.Date)) {
    const err = new Error('The payment date belongs to a closed accounting period; finance review is required.');
    err.status = 409;
    throw err;
  }
  await upsertDocument(env, 'accountingJournals', safeDocumentId(journal.JournalNo), journal, scopedPaymentWriteCondition(prior, financialScope));
  return journal;
}

export function buildSchoolInvoiceChargeAccountingJournal(row = {}) {
  const invoice = normalizeInvoice(row);
  const sourceId = clean(invoice.InvoiceId || row.__id);
  const amount = asMoneyNumber(invoice.GrossInvoiceAmount ?? (invoice.Debit || invoice.Amount));
  if (!sourceId || amount <= 0 || !isSchoolFeeInvoice(invoice)) return null;
  const revenue = accountingAccountCodeForRevenue(invoice.FeeCategory, invoice.FeeCode);
  return normalizedJournal({
    JournalNo: `SYS-INV-${safeDocumentId(sourceId)}`,
    Date: invoice.CreatedAt || invoice.Date || nowIso(), Status: 'Posted',
    Description: `Invoice: ${clean(invoice.FeeName || invoice.Description || sourceId)}`,
    Reference: sourceId, Source: 'Student Invoice', SourceId: sourceId,
    BranchId: clean(invoice.BranchId || 'main').toLowerCase() || 'main',
    AcademicSession: invoice.AcademicSession || '', Term: invoice.Term || '', RecordedBy: 'System',
    Lines: [
      { AccountCode: '1100', Debit: amount, Credit: 0, Description: clean(invoice.AccountRef || invoice.DisplayName) },
      { AccountCode: revenue, Debit: 0, Credit: amount, Description: clean(invoice.FeeName || invoice.FeeCategory) }
    ],
    TotalDebit: amount, TotalCredit: amount,
    CreatedAt: invoice.CreatedAt || nowIso(), UpdatedAt: nowIso()
  });
}

// The receipt remains an advance until its invoice credit is applied. Keep
// this journal separate from both the receipt and the invoice charge so an
// advance paid before invoicing is recognized exactly once when applied.
export function buildSchoolInvoiceCreditAccountingJournal(row = {}, options = {}) {
  const invoice = normalizeInvoice(row);
  const sourceId = clean(invoice.InvoiceId || row.__id);
  const amount = asMoneyNumber(options.amount ?? Math.min(asMoneyNumber(invoice.Debit || invoice.Amount), asMoneyNumber(invoice.Credit)));
  if (!sourceId || amount <= 0 || !isSchoolFeeInvoice(invoice)) return null;
  return normalizedJournal({
    JournalNo: clean(options.journalNo) || `SYS-INVCREDIT-LEGACY-${safeDocumentId(sourceId)}`,
    Date: clean(options.date) || invoice.CreditAppliedAt || invoice.UpdatedAt || invoice.Date || nowIso(), Status: 'Posted',
    Description: `Parent credit applied: ${sourceId}`,
    Reference: sourceId, Source: 'Student Invoice Credit', SourceId: sourceId,
    PaymentReference: clean(options.paymentReference),
    BranchId: clean(invoice.BranchId || 'main').toLowerCase() || 'main',
    AcademicSession: invoice.AcademicSession || '', Term: invoice.Term || '', RecordedBy: 'System',
    AccountRef: clean(invoice.AccountRef),
    Lines: [
      { AccountCode: '2310', Debit: amount, Credit: 0, Description: clean(invoice.AccountRef || invoice.DisplayName) },
      { AccountCode: '1100', Debit: 0, Credit: amount, Description: clean(invoice.FeeName || invoice.FeeCategory) }
    ],
    TotalDebit: amount, TotalCredit: amount,
    CreatedAt: invoice.CreatedAt || nowIso(), UpdatedAt: nowIso()
  });
}

export function buildSchoolInvoiceCreditPaymentJournal(invoice, payment, amount) {
  const invoiceId = clean(invoice.InvoiceId || invoice.__id);
  const paymentId = clean(payment.Reference || payment.GatewayReference || payment.PaymentId || payment.__id);
  if (!invoiceId || !paymentId) return null;
  const paymentDate = clean(payment.PaidAt || payment.PaymentDate || payment.Date);
  const invoiceDate = clean(invoice.CreatedAt || invoice.Date);
  // A historical advance can be received before the invoice exists. Its
  // application cannot precede the receivable/charge it settles.
  const applicationDate = timestampMs(invoiceDate) > timestampMs(paymentDate)
    ? invoiceDate : (paymentDate || invoiceDate || nowIso());
  return buildSchoolInvoiceCreditAccountingJournal(invoice, {
    amount, journalNo: `SYS-INVCREDIT-PAY-${safeDocumentId(paymentId)}-${safeDocumentId(invoiceId)}`,
    date: applicationDate, paymentReference: paymentId
  });
}

export function buildSchoolInvoiceCreditAutomaticJournal(invoice, priorCredit, newCredit, date) {
  const invoiceId = clean(invoice.InvoiceId || invoice.__id);
  const amount = asMoneyNumber(newCredit - priorCredit);
  if (!invoiceId || amount <= 0) return null;
  const priorCents = Math.round(asMoneyNumber(priorCredit) * 100);
  const newCents = Math.round(asMoneyNumber(newCredit) * 100);
  return buildSchoolInvoiceCreditAccountingJournal(invoice, {
    amount, journalNo: `SYS-INVCREDIT-AUTO-${safeDocumentId(invoiceId)}-${priorCents}-${newCents}${invoice.PaymentCorrectionReleasedCredit ? `-PC${Math.round(asMoneyNumber(invoice.PaymentCorrectionReleasedCredit) * 100)}` : ''}`,
    date: date || nowIso()
  });
}

export function schoolInvoiceCreditJournalGap(row = {}, journals = []) {
  const invoice = normalizeInvoice(row);
  const invoiceId = clean(invoice.InvoiceId || row.__id);
  const expected = Math.min(asMoneyNumber(invoice.Debit || invoice.Amount), asMoneyNumber(invoice.Credit));
  const related = journals.filter((journal) => sameText(journal.Source, 'Student Invoice Credit') &&
    sameText(journal.SourceId, invoiceId));
  const invalidPostedJournalIds = [];
  const posted = asMoneyNumber(related.reduce((sum, journal) => {
    if (lower(journal.Status) !== 'posted') {
      invalidPostedJournalIds.push(clean(journal.JournalNo || journal.__id));
      return sum;
    }
    const lines = accountingLines(journal.Lines);
    const debit = lines.find((line) => clean(line.AccountCode) === '2310' && asMoneyNumber(line.Debit) > 0);
    const credit = lines.find((line) => clean(line.AccountCode) === '1100' && asMoneyNumber(line.Credit) > 0);
    if (lines.length !== 2 || !debit || !credit ||
      asMoneyNumber(debit.Debit) !== asMoneyNumber(credit.Credit)) {
      invalidPostedJournalIds.push(clean(journal.JournalNo || journal.__id));
      return sum;
    }
    return sum + asMoneyNumber(debit.Debit);
  }, 0));
  const baselineJournalNo = `SYS-INVCREDIT-LEGACY-${safeDocumentId(invoiceId)}`;
  const releases = journals.filter((journal) => sameText(journal.Source, 'Student Invoice Credit Release') && sameText(journal.SourceId, invoiceId));
  let released = 0;
  for (const journal of releases) {
    const lines = accountingLines(journal.Lines);
    const debit = lines.find((line) => line.AccountCode === '1100' && asMoneyNumber(line.Debit) > 0);
    const credit = lines.find((line) => line.AccountCode === '2310' && asMoneyNumber(line.Credit) > 0);
    if (lower(journal.Status) !== 'posted' || lines.length !== 2 || !debit || !credit ||
      asMoneyNumber(debit.Debit) !== asMoneyNumber(credit.Credit) ||
      !invoice.FeeChargeReversalId || journal.ReversalId !== invoice.FeeChargeReversalId) {
      invalidPostedJournalIds.push(clean(journal.JournalNo || journal.__id));
    } else released += asMoneyNumber(debit.Debit);
  }
  if (asMoneyNumber(released) !== asMoneyNumber(invoice.FeeChargeReleasedCredit || 0)) invalidPostedJournalIds.push('Credit release does not match the approved reversal.');
  let paymentReleased = 0;
  for (const journal of journals.filter(row => sameText(row.Source, 'Student Payment Correction Credit Release') && sameText(row.SourceId, invoiceId))) {
    const lines = accountingLines(journal.Lines);
    const debit = lines.find(line => line.AccountCode === '1100' && asMoneyNumber(line.Debit) > 0);
    const credit = lines.find(line => line.AccountCode === '2310' && asMoneyNumber(line.Credit) > 0);
    if (lower(journal.Status) !== 'posted' || !journal.CorrectionId || lines.length !== 2 || !debit || !credit
      || asMoneyNumber(debit.Debit) !== asMoneyNumber(credit.Credit)) invalidPostedJournalIds.push(clean(journal.JournalNo || journal.__id));
    else paymentReleased += asMoneyNumber(debit.Debit);
  }
  if (asMoneyNumber(paymentReleased) !== asMoneyNumber(invoice.PaymentCorrectionReleasedCredit || 0)) invalidPostedJournalIds.push('Payment correction releases do not match the invoice.');
  released += paymentReleased;
  const netPosted = asMoneyNumber(posted - released);
  return { invoiceId, expected, posted: netPosted, ...(released > 0 ? { released } : {}), missing: asMoneyNumber(expected - netPosted),
    baselineExists: related.some((journal) => lower(journal.Status) === 'posted' && sameText(journal.JournalNo || journal.__id, baselineJournalNo)),
    ...(invalidPostedJournalIds.length ? { invalidPostedJournalIds } : {}) };
}

async function upsertSystemJournalIfChanged(env, journal, financialScope = null) {
  if (!journal) return false;
  const documentId = safeDocumentId(journal.JournalNo);
  const prior = await readScopedFinancialDocument(env, 'accountingJournals', documentId, financialScope, 'System journal', { accountRequired: false });
  if (prior && lower(prior.Status) !== 'posted') {
    const err = new Error(`System journal ${journal.JournalNo} is not posted; finance review is required.`);
    err.status = 409;
    throw err;
  }
  if (prior && journalLineSignature(prior.Lines) === journalLineSignature(journal.Lines) &&
    sameText(prior.Reference, journal.Reference) && sameText(prior.SourceId, journal.SourceId) &&
    sameText(prior.Date, journal.Date) && sameText(prior.BranchId, journal.BranchId) &&
    sameText(prior.AcademicSession, journal.AcademicSession) && sameText(prior.Term, journal.Term)) return false;
  if (prior && lower(prior.Status) === 'posted') {
    const err = new Error(`Posted system journal ${journal.JournalNo} differs from source data; finance review is required.`);
    err.status = 409;
    throw err;
  }
  if (!prior && await accountingPeriodIsClosed(env, journal.Date)) {
    const err = new Error(`System journal ${journal.JournalNo} belongs to a closed period; finance review is required.`);
    err.status = 409;
    throw err;
  }
  await upsertDocument(env, 'accountingJournals', documentId, {
    ...journal, CreatedAt: prior?.CreatedAt || journal.CreatedAt, UpdatedAt: nowIso()
  }, scopedPaymentWriteCondition(prior, financialScope));
  return true;
}

// Repair just one parent's School subledger before a credit withdrawal or
// transfer. This also reconciles receipts/invoice credits posted before these
// journals existed, without scanning other students' financial records.
export async function syncSchoolAccountCreditJournals(env, accountRef, linkedReferences = [], financialScope = null) {
  const references = [...new Set([accountRef, ...linkedReferences].map(clean).filter(Boolean))];
  if (!references.length || accountingEditionForRequest(env) !== 'school') return { repaired: 0, unreconciledLegacyActions: [], unreconciledAllocation: null };
  // A posted sibling transfer may originate in another section of this same
  // branch. These actions/journals are inspected, not changed by reconciliation.
  const creditActionScope = financialScope ? { ...financialScope, references: null, schoolSectionAccess: '' } : null;
  const [payments, invoices, ledgerRows, sourceActions, targetActionGroups] = await Promise.all([
    queryAccountRowsForReferences(env, 'payments', references, financialScope),
    queryAccountRowsForReferences(env, 'invoices', references, financialScope),
    queryAccountRowsForReferences(env, 'ledger', references, financialScope),
    // Older credit actions have no branch metadata. Defer ownership validation
    // until their immutable posted journal has been checked, but keep strict I/O.
    queryAccountRowsForReferences(env, 'creditActions', references, financialScope ? {} : null),
    Promise.all(references.map((reference) => queryCollection(env, 'creditActions', {
      filters: [{ field: 'TargetAccountRef', op: '==', value: reference }]
    })))
  ]);
  const actions = new Map();
  [...sourceActions, ...targetActionGroups.flat()].forEach((row) => {
    const key = clean(row.ActionId || row.__id);
    if (key) actions.set(key, row);
  });
  const unreconciledLegacyActions = [];
  for (const [actionId, action] of actions) {
    const journalNo = clean(action.JournalNo) || `SYS-CREDIT-${safeDocumentId(actionId)}`;
    const journal = await readScopedFinancialDocument(env, 'accountingJournals', safeDocumentId(journalNo),
      creditActionScope, 'Credit-action journal', { accountRequired: false });
    if (!journal || lower(journal.Status) !== 'posted') {
      unreconciledLegacyActions.push(actionId);
      continue;
    }
    assertManualPaymentScope({ ...action, BranchId: action.BranchId || action.branchId || journal.BranchId || journal.branchId || 'main' },
      creditActionScope, 'Linked credit action', { accountRequired: false });
    if (financialScope && ![action.AccountRef, action.TargetAccountRef].some((value) =>
      financialScope.references.some((reference) => sameReferenceIdentity(value, reference)))) {
      const error = new Error('A linked credit action has ambiguous account ownership. Finance review is required.');
      error.status = 409;
      throw error;
    }
  }
  if (unreconciledLegacyActions.length) return { repaired: 0, unreconciledLegacyActions, unreconciledAllocation: null };
  const normalizedLedger = ledgerRows.map(normalizeLedger);
  const receivedSchoolCredit = asMoneyNumber(normalizedLedger.filter(isAvailableSchoolCreditReceipt)
    .reduce((sum, row) => sum + asMoneyNumber(row.Credit), 0));
  const withdrawnCredit = asMoneyNumber(normalizedLedger.filter((row) =>
    normalizeMatchText(row.FeeCategory) === 'account credit')
    .reduce((sum, row) => sum + asMoneyNumber(row.Debit), 0));
  const appliedToSchoolInvoices = asMoneyNumber(invoices.map(normalizeInvoice)
    .filter(isSchoolFeeInvoice)
    .reduce((sum, row) => sum + Math.min(asMoneyNumber(row.Debit || row.Amount), asMoneyNumber(row.Credit)), 0));
  if (appliedToSchoolInvoices + withdrawnCredit > receivedSchoolCredit + 0.005) {
    // A legacy allocation may have spent an earmarked store/service receipt.
    // Do not create a negative 2310 liability without tracing its provenance.
    return { repaired: 0, unreconciledLegacyActions: [], unreconciledAllocation: {
      receivedSchoolCredit, appliedToSchoolInvoices, withdrawnCredit
    } };
  }
  const baselineJournals = [];
  for (const row of invoices) {
    const invoice = normalizeInvoice(row);
    if (!isSchoolFeeInvoice(invoice)) continue;
    const creditJournals = await queryCollection(env, 'accountingJournals', {
      filters: [{ field: 'SourceId', op: '==', value: invoice.InvoiceId }]
    });
    creditJournals.forEach((journal) => assertManualPaymentScope(journal, financialScope, 'Invoice credit journal', { accountRequired: false }));
    const gap = schoolInvoiceCreditJournalGap(invoice, creditJournals);
    if (gap.invalidPostedJournalIds?.length || gap.missing < -0.005 || (gap.missing > 0.005 && gap.baselineExists)) {
      return { repaired: 0, unreconciledLegacyActions: [], unreconciledAllocation: {
        receivedSchoolCredit, appliedToSchoolInvoices, withdrawnCredit,
        invoiceId: gap.invoiceId, expectedJournalCredit: gap.expected, postedJournalCredit: gap.posted,
        invalidPostedJournalIds: gap.invalidPostedJournalIds || []
      } };
    }
    if (gap.missing > 0.005) baselineJournals.push(buildSchoolInvoiceCreditAccountingJournal(invoice, {
      amount: gap.missing, date: nowIso()
    }));
  }
  const receiptPlans = [];
  for (const row of payments) {
    const payment = normalizePayment(row);
    if (!isAvailableSchoolCreditReceipt(payment)) continue;
    const journal = buildPaymentAccountingJournal(payment);
    if (!journal) continue;
    const prior = await readScopedFinancialDocument(env, 'accountingJournals', safeDocumentId(journal.JournalNo), financialScope, 'Receipt journal', { accountRequired: false });
    if (!prior) {
      receiptPlans.push({ journal });
      continue;
    }
    if (lower(prior.Status) !== 'posted') {
      return { repaired: 0, unreconciledLegacyActions: [], unreconciledAllocation: {
        receivedSchoolCredit, appliedToSchoolInvoices, withdrawnCredit,
        receiptId: journal.SourceId, reason: 'Receipt journal is not posted.'
      } };
    }
    if (journalLineSignature(prior.Lines) === journalLineSignature(journal.Lines)) {
      if (!sameText(prior.Date, journal.Date) || !sameText(prior.BranchId, journal.BranchId) ||
        !sameText(prior.AcademicSession, journal.AcademicSession) || !sameText(prior.Term, journal.Term)) {
        return { repaired: 0, unreconciledLegacyActions: [], unreconciledAllocation: {
          receivedSchoolCredit, appliedToSchoolInvoices, withdrawnCredit,
          receiptId: journal.SourceId, reason: 'Receipt accounting period or branch requires finance review.'
        } };
      }
      continue;
    }
    const reclassification = buildSchoolPaymentReclassificationJournal(payment, prior);
    if (!reclassification) {
      return { repaired: 0, unreconciledLegacyActions: [], unreconciledAllocation: {
        receivedSchoolCredit, appliedToSchoolInvoices, withdrawnCredit,
        receiptId: journal.SourceId, reason: 'Legacy receipt amount or journal lines require finance review.'
      } };
    }
    receiptPlans.push({ reclassification });
  }
  const invoiceChargePlans = [];
  for (const row of invoices) {
    const invoice = normalizeInvoice(row);
    if (!isSchoolFeeInvoice(invoice)) continue;
    const journal = buildSchoolInvoiceChargeAccountingJournal(invoice);
    if (!journal) continue;
    const prior = await readScopedFinancialDocument(env, 'accountingJournals', safeDocumentId(journal.JournalNo), financialScope, 'Invoice charge journal', { accountRequired: false });
    if (prior && lower(prior.Status) === 'posted' &&
      (journalLineSignature(prior.Lines) !== journalLineSignature(journal.Lines) ||
        !sameText(prior.Date, journal.Date) || !sameText(prior.BranchId, journal.BranchId) ||
        !sameText(prior.AcademicSession, journal.AcademicSession) || !sameText(prior.Term, journal.Term))) {
      return { repaired: 0, unreconciledLegacyActions: [], unreconciledAllocation: {
        receivedSchoolCredit, appliedToSchoolInvoices, withdrawnCredit,
        invoiceId: invoice.InvoiceId, reason: 'Posted invoice charge differs from source data.'
      } };
    }
    invoiceChargePlans.push(journal);
  }
  for (const journal of [
    ...receiptPlans.filter((plan) => plan.journal).map((plan) => plan.journal),
    ...receiptPlans.filter((plan) => plan.reclassification).map((plan) => plan.reclassification),
    ...invoiceChargePlans,
    ...baselineJournals
  ]) {
    const prior = await readScopedFinancialDocument(env, 'accountingJournals', safeDocumentId(journal.JournalNo), financialScope, 'Reconciliation journal', { accountRequired: false });
    if (!prior && await accountingPeriodIsClosed(env, journal.Date)) {
      return { repaired: 0, unreconciledLegacyActions: [], unreconciledAllocation: {
        receivedSchoolCredit, appliedToSchoolInvoices, withdrawnCredit,
        journalNo: journal.JournalNo, reason: 'Missing journal belongs to a closed accounting period.'
      } };
    }
  }
  await seedAccountingChart(env);
  let repaired = 0;
  for (const plan of receiptPlans) {
    if (plan.journal && await upsertSystemJournalIfChanged(env, plan.journal, financialScope)) repaired += 1;
    if (plan.reclassification && await createSchoolPaymentReclassificationIfAbsent(env, plan.reclassification, financialScope)) repaired += 1;
  }
  for (const journal of invoiceChargePlans) {
    if (await upsertSystemJournalIfChanged(env, journal, financialScope)) repaired += 1;
  }
  for (const journal of baselineJournals) {
    if (await upsertSystemJournalIfChanged(env, journal, financialScope)) repaired += 1;
  }
  return { repaired, unreconciledLegacyActions, unreconciledAllocation: null };
}

// Pay-now matches receipts by fee code. Reduce the matching receipt credit for
// that view only; the persisted ledger keeps both original and compensating rows.
export function payableLedgerAfterPaymentCorrections(rows = []) {
  const corrected = new Set(rows.filter(row => !isWalletLedger(row) && asMoneyNumber(row.CorrectionTotal) > 0)
    .map(row => clean(row.Reference)));
  return rows.filter(row => !(row.Source === 'Manual Payment Correction' && !isWalletLedger(row)
    && asMoneyNumber(row.Debit) > 0 && corrected.has(clean(row.OriginalPaymentReference))))
    .map(row => !isWalletLedger(row) && asMoneyNumber(row.CorrectionTotal) > 0
      ? { ...row, Credit: Math.max(0, asMoneyNumber(row.Credit) - asMoneyNumber(row.CorrectionTotal)) } : row);
}

export function correctedPayableInvoices(invoices = [], ledger = []) {
  if (!ledger.some(row => !isWalletLedger(row) && Number(row.CorrectionTotal) > 0)) return null;
  const allocated = new Map(calculateDueSchoolFeeCreditAllocations(invoices, ledger).allocations
    .map(row => [row.invoice.InvoiceId, row.Credit]));
  return invoices.map(normalizeInvoice).filter(isSchoolFeeInvoice)
    .map(row => ({ ...row, Credit: allocated.get(row.InvoiceId) ?? row.Credit }));
}

export function correctedInvoicePaidAmount(invoices, fee) {
  if (!invoices || !isSchoolFeeInvoice(fee)) return null;
  const matching = invoices.filter(row => sameText(row.FeeCode, fee.FeeCode) && periodMatchesFee(row, fee));
  return matching.length ? asMoneyNumber(matching.reduce((sum, row) => sum + asMoneyNumber(row.Credit), 0)) : null;
}

export function calculateAccountFinancialSummary(invoiceRows = [], ledgerRows = [], accountRef = '', today = new Date().toISOString().slice(0, 10)) {
  const invoices = invoiceRows.map(normalizeInvoice);
  const debit = invoices.reduce((sum, row) => sum + asMoneyNumber(row.Debit || row.Amount), 0);
  const schoolInvoices = invoices.filter(isSchoolFeeInvoice);
  const dueDebit = schoolInvoices.filter((row) => invoiceIsDue(row, today))
    .reduce((sum, row) => sum + asMoneyNumber(row.Debit || row.Amount), 0);
  const futureAppliedCredit = schoolInvoices.filter((row) => !invoiceIsDue(row, today))
    .reduce((sum, row) => sum + Math.min(asMoneyNumber(row.Debit || row.Amount), asMoneyNumber(row.Credit)), 0);
  const normalizedLedger = ledgerRows.map(normalizeLedger);
  const nonWallet = normalizedLedger.filter((row) => !isWalletLedger(row));
  const credit = nonWallet.reduce((sum, row) => sum + asMoneyNumber(row.Credit), 0);
  const schoolCredit = nonWallet.filter(isAvailableSchoolCreditReceipt)
    .reduce((sum, row) => sum + asMoneyNumber(row.Credit), 0);
  const accountCreditDebits = nonWallet.filter((row) => normalizeMatchText(row.FeeCategory) === 'account credit')
    .reduce((sum, row) => sum + asMoneyNumber(row.Debit), 0);
  const wallet = normalizedLedger.filter(isWalletLedger)
    .reduce((sum, row) => sum + asMoneyNumber(row.Credit) - asMoneyNumber(row.Debit), 0);
  const schoolDebit = schoolInvoices.reduce((sum, row) => sum + asMoneyNumber(row.Debit || row.Amount), 0);
  const otherDebit = asMoneyNumber(debit - schoolDebit);
  const otherCredit = asMoneyNumber(credit - schoolCredit);
  const outstandingBalance = asMoneyNumber(
    Math.max(0, schoolDebit + accountCreditDebits - schoolCredit) +
    Math.max(0, otherDebit - otherCredit)
  );
  return {
    AccountRef: clean(accountRef), AccountRefNormalized: normalizeReferenceText(accountRef),
    TotalDebit: debit, TotalCredit: credit, AccountCreditDebits: accountCreditDebits,
    OutstandingBalance: outstandingBalance, CreditBalance: Math.max(0, schoolCredit - accountCreditDebits - dueDebit - futureAppliedCredit),
    WalletBalance: wallet, UpdatedAt: nowIso()
  };
}

// Invoice Credit allocates an existing ledger receipt; it is not another receipt.
// Keep allocations already made to a specific invoice, then carry only the
// remaining credit into school invoices once their due date has arrived.
export function calculateDueSchoolFeeCreditAllocations(invoiceRows = [], ledgerRows = [], today = new Date().toISOString().slice(0, 10)) {
  const invoices = invoiceRows.map(normalizeInvoice);
  const ledger = ledgerRows.map(normalizeLedger).filter((row) => !isWalletLedger(row));
  const received = ledger.filter(isAvailableSchoolCreditReceipt)
    .reduce((sum, row) => sum + asMoneyNumber(row.Credit), 0);
  const creditActions = ledger.reduce((sum, row) =>
    sum + (normalizeMatchText(row.FeeCategory) === 'account credit' ? asMoneyNumber(row.Debit) : 0), 0);
  const reserved = invoices.filter(isSchoolFeeInvoice).reduce((sum, row) => {
    const debit = asMoneyNumber(row.Debit || row.Amount);
    const applied = Math.min(debit, asMoneyNumber(row.Credit));
    return sum + applied;
  }, 0);
  let remaining = Math.max(0, asMoneyNumber(received - creditActions - reserved));
  const allocations = [];
  invoices.filter((row) => invoiceIsDue(row, today) && isSchoolFeeInvoice(row))
    .sort((a, b) => {
      const left = feeDueDate(a.DueDate) || feeDueDate(a.Date) || '';
      const right = feeDueDate(b.DueDate) || feeDueDate(b.Date) || '';
      return left.localeCompare(right) || clean(a.InvoiceId).localeCompare(clean(b.InvoiceId));
    }).forEach((invoice) => {
      const debit = asMoneyNumber(invoice.Debit || invoice.Amount);
      const existingCredit = Math.min(debit, asMoneyNumber(invoice.Credit));
      const applied = Math.min(Math.max(0, debit - existingCredit), remaining);
      if (applied <= 0) return;
      remaining = asMoneyNumber(remaining - applied);
      const credit = asMoneyNumber(existingCredit + applied);
      const balance = asMoneyNumber(Math.max(0, debit - credit));
      allocations.push({ invoice, applied, Credit: credit, Balance: balance, Status: balance <= 0 ? 'Paid' : 'Part Paid' });
    });
  return { allocations, remaining };
}

async function assertScopedAccountSummary(env, accountRef, financialScope) {
  if (!financialScope) return null;
  const prior = await getDocument(env, 'accountSummaries', safeDocumentId(accountRef));
  if (!prior) return null;
  // Legacy summaries have no branch metadata. The scoped payment preflight
  // verifies the account's identity across school paths before adopting them.
  assertManualPaymentScope({ ...prior, BranchId: prior.BranchId || financialScope.branchId }, financialScope, 'Account summary');
  for (const reference of prior.LinkedReferences || []) {
    assertManualPaymentScope({ AccountRef: reference, BranchId: financialScope.branchId }, financialScope, 'Linked account summary');
  }
  return prior;
}

async function refreshAccountFinancialSummary(env, accountRef, linkedReferences = [], financialScope = null) {
  const references = [accountRef, ...linkedReferences];
  const priorSummary = await assertScopedAccountSummary(env, accountRef, financialScope);
  const [invoices, ledger] = await Promise.all([
    queryAccountRowsForReferences(env, 'invoices', references, financialScope),
    queryAccountRowsForReferences(env, 'ledger', references, financialScope)
  ]);
  const summary = calculateAccountFinancialSummary(invoices, ledger, accountRef);
  await upsertDocument(env, 'accountSummaries', safeDocumentId(accountRef), {
    ...summary,
    ...(financialScope ? { BranchId: financialScope.branchId, SchoolSection: financialScope.schoolSectionAccess } : {}),
    LinkedReferences: [...new Set(linkedReferences.map(clean).filter(Boolean))]
  }, scopedPaymentWriteCondition(priorSummary, financialScope));
  return summary;
}

async function applyDueSchoolFeeCreditsForAccount(env, accountRef, linkedReferences = [], settings = null, today = new Date().toISOString().slice(0, 10), financialScope = null) {
  const references = [accountRef, ...linkedReferences];
  const [invoices, ledger, summarySnapshot] = await Promise.all([
    queryAccountRowsForReferences(env, 'invoices', references, financialScope),
    queryAccountRowsForReferences(env, 'ledger', references, financialScope),
    financialScope ? assertScopedAccountSummary(env, accountRef, financialScope) : getDocument(env, 'accountSummaries', safeDocumentId(accountRef))
  ]);
  const preflight = await syncSchoolAccountCreditJournals(env, accountRef, linkedReferences, financialScope);
  if (preflight.unreconciledLegacyActions?.length || preflight.unreconciledAllocation) {
    const err = new Error('This parent credit needs finance review before it can be applied to another term.');
    err.status = 409;
    throw err;
  }
  const allocation = calculateDueSchoolFeeCreditAllocations(invoices, ledger, today);
  if (allocation.allocations.length) {
    if (await accountingPeriodIsClosed(env, today)) {
      const err = new Error('The credit-allocation date belongs to a closed accounting period; finance review is required.');
      err.status = 409;
      throw err;
    }
    const notificationSettings = settings || await loadNotificationSettings(env);
    const updatedInvoices = new Map();
    const writes = allocation.allocations.map((item) => {
      const updated = {
        ...item.invoice,
        Credit: item.Credit,
        Balance: item.Balance,
        Status: item.Status,
        DueDate: feeDueDate(item.invoice.DueDate) || item.invoice.DueDate || '',
        AutomaticAccountCreditApplied: asMoneyNumber(asMoneyNumber(item.invoice.AutomaticAccountCreditApplied) + item.applied),
        UpdatedAt: nowIso()
      };
      Object.assign(updated, invoiceReminderFields(updated, notificationSettings, today));
      updatedInvoices.set(clean(updated.InvoiceId), updated);
      return {
        collectionPath: 'invoices', documentId: safeDocumentId(updated.InvoiceId), data: updated,
        ...(item.invoice.__updateTime ? { updateTime: item.invoice.__updateTime } : {})
      };
    });
    for (const item of allocation.allocations) {
      const priorCredit = Math.min(asMoneyNumber(item.invoice.Debit || item.invoice.Amount), asMoneyNumber(item.invoice.Credit));
      const journal = buildSchoolInvoiceCreditAutomaticJournal(item.invoice, priorCredit, item.Credit, today);
      if (journal) writes.push({
        collectionPath: 'accountingJournals', documentId: safeDocumentId(journal.JournalNo), exists: false, data: journal
      });
    }
    const summary = calculateAccountFinancialSummary(invoices.map((row) =>
      updatedInvoices.get(clean(row.InvoiceId || row.__id)) || row), ledger, accountRef, today);
    writes.push({
      collectionPath: 'accountSummaries', documentId: safeDocumentId(accountRef),
      ...(summarySnapshot?.__updateTime ? { updateTime: summarySnapshot.__updateTime } : { exists: false }),
      data: { ...summary, LinkedReferences: [...new Set(linkedReferences.map(clean).filter(Boolean))],
        ...(financialScope ? { BranchId: financialScope.branchId, SchoolSection: financialScope.schoolSectionAccess } : {}) }
    });
    await batchUpsertDocuments(env, writes);
  }
  if (!allocation.allocations.length) await refreshAccountFinancialSummary(env, accountRef, linkedReferences, financialScope);
  return allocation;
}

export async function processDueSchoolFeeCredits(env, options = {}) {
  const today = feeDueDate(options.today) || new Date().toISOString().slice(0, 10);
  const limit = Math.max(1, Math.min(1500, Number(options.limit || 1000)));
  const accounts = await queryCollection(env, 'accountSummaries', {
    filters: [{ field: 'CreditBalance', op: '>', value: 0 }],
    limit
  });
  let creditedInvoices = 0;
  let creditedAccounts = 0;
  const failures = [];
  const settings = await loadNotificationSettings(env);
  for (const account of accounts) {
    const accountRef = clean(account.AccountRef || account.__id);
    if (!accountRef) continue;
    try {
      const references = Array.isArray(account.LinkedReferences) ? account.LinkedReferences.map(clean).filter(Boolean) : [];
      const invoices = (await queryAccountRowsForReferences(env, 'invoices', [accountRef, ...references])).map(normalizeInvoice);
      if (!invoices.some((row) => invoiceIsDue(row, today) && isSchoolFeeInvoice(row) &&
        asMoneyNumber(row.Debit || row.Amount) > asMoneyNumber(row.Credit))) continue;
      const allocation = await applyDueSchoolFeeCreditsForAccount(env, accountRef, references, settings, today);
      if (allocation.allocations.length) {
        creditedAccounts += 1;
        creditedInvoices += allocation.allocations.length;
      }
    } catch (error) {
      failures.push({ accountRef, message: clean(error?.message || error) });
    }
  }
  return { ok: failures.length === 0 && accounts.length < limit, date: today, inspected: accounts.length,
    creditedAccounts, creditedInvoices, failed: failures.length, failures: failures.slice(0, 10), limitReached: accounts.length >= limit };
}

export function isStandaloneAcceptanceInvoiceForPayment(invoice, payment) {
  if (!isAcceptanceFeeLike(invoice)) return false;
  const invoiceReferences = accountRefsFrom(invoice);
  const paymentReferences = accountRefsFrom(payment);
  return invoiceReferences.some((left) => paymentReferences.some((right) =>
    sameReferenceIdentity(left, right)
  ));
}

async function removeStandaloneAcceptanceInvoices(env, payment, financialScope = null) {
  if (!isAcceptanceFeeLike(payment)) return 0;
  const invoices = await queryAccountRows(env, 'invoices', payment.AccountRef, financialScope);
  const standalone = invoices.filter((invoice) => isStandaloneAcceptanceInvoiceForPayment(
    normalizeInvoice(invoice),
    payment
  ));
  for (const invoice of standalone) {
    await deleteDocument(env, 'invoices', invoice.__id || safeDocumentId(invoice.InvoiceId), scopedPaymentWriteCondition(invoice, financialScope));
  }
  return standalone.length;
}

async function prepareScopedManualPayment(env, body, reviewWalletDuplicates = false) {
  const requestedScope = manualPaymentRequestScope(body);
  if (!requestedScope) return { body, financialScope: null, student: null };
  requestedScope.strictReads = true;
  // Do not treat an unreadable branch registry as an empty Main-only school.
  await getDocument(env, 'settings', 'schoolStructure');
  const accountRef = clean(body.AccountRef || body.accountRef || body.ApplicationReference);
  const student = await findStudentByAccountRef(env, accountRef, requestedScope);
  const identity = student || await findApplication(env, accountRef, requestedScope);
  if (!identity) {
    const error = new Error('The student or applicant was not found in your approved branch and school section.');
    error.status = 403;
    error.code = 'MANUAL_PAYMENT_SCOPE_MISMATCH';
    throw error;
  }
  const bound = bindManualPaymentIdentity(body, identity, requestedScope);
  const financialScope = bound.scope;
  // Financial document IDs are organisation-wide. Refuse ambiguous identities
  // instead of overwriting another branch's summary or linked receipt.
  await Promise.all(financialScope.references.flatMap((reference) => ['students', 'applications'].map(async (collection) => {
    const rows = await getSchoolDocumentsById(env, collection, safeDocumentId(reference), null, { strictReads: true });
    rows.forEach((row) => assertManualPaymentScope(row, financialScope, 'Account identity'));
  })));
  // Older imports used arbitrary document IDs. Also inspect identity fields so
  // a shared account reference in another branch cannot hide behind an old ID.
  await Promise.all(['students', 'applications'].map(async (collection) => {
    const fields = [...STUDENT_ACCOUNT_REFERENCE_FIELDS, 'ApplicationID'];
    const filters = [...new Set(financialScope.references)].flatMap((reference) =>
      fields.map((field) => ({ field, op: '==', value: reference })));
    for (let offset = 0; offset < filters.length; offset += 20) {
      const rows = await querySchoolCollection(env, collection, { filters: filters.slice(offset, offset + 20), filterJoin: 'OR' });
      rows.forEach((row) => assertManualPaymentScope(row, financialScope, 'Account identity'));
    }
  }));
  if (student?.ApplicationReference) await findApplication(env, student.ApplicationReference, financialScope);
  const historyReferences = reviewWalletDuplicates
    ? [...new Set(financialScope.references.flatMap(value => [value, value.toUpperCase(), value.toLowerCase()]))] : financialScope.references;
  const [payments, , ledger] = await Promise.all([
    ...['payments', 'invoices', 'ledger'].map((collection) => queryAccountRowsForReferences(env, collection, historyReferences, financialScope, { strict: reviewWalletDuplicates })),
    assertScopedAccountSummary(env, accountRef, financialScope)
  ]);
  return { body: bound.body, financialScope, student, payments, ledger };
}

async function assertManualPaymentDestinations(env, reference, financialScope) {
  if (!financialScope) return;
  const ledger = await getDocument(env, 'ledger', safeDocumentId(`LED-${safeDocumentId(reference)}`));
  assertManualPaymentDestination(ledger, financialScope, reference, 'Payment ledger');
  const journal = await getDocument(env, 'accountingJournals', safeDocumentId(`SYS-PAY-${safeDocumentId(reference)}`));
  assertManualPaymentDestination(journal, financialScope, reference, 'Payment accounting journal', { accountRequired: false });
  const charge = await getDocument(env, 'paymentGatewayCharges', safeDocumentId(`PAYSTACK-FEE-${reference}`));
  assertManualPaymentDestination(charge, financialScope, reference, 'Payment gateway charge', { accountRequired: false });
}

async function manualPaymentVersion(env, documentId, body, financialScope, creditedAmount) {
  const row = await readScopedFinancialDocument(env, 'payments', documentId, financialScope, 'Payment being posted');
  if (row?.LastCorrectionId) throw financeFailure('This receipt was corrected during posting. Reload it; the correction must remain intact.', 409);
  if (financialScope && !row) {
    const error = new Error('The payment changed during posting. Refresh and retry its original reference.');
    error.status = 409;
    throw error;
  }
  if (row) assertManualPaymentRetry(normalizePayment(row), body, financialScope, creditedAmount);
  return row;
}

export async function recordManualPayment(env, body, { reviewWalletDuplicates = false } = {}) {
  // Trusted gateway callers use this recorder too; desktop requests carry the
  // authoritative actor and must retain the normal finance-role restriction.
  if (body.DeviceBranchId) requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  let accountRef = clean(body.AccountRef || body.accountRef || body.ApplicationReference);
  let feeCode = clean(body.FeeCode || body.feeCode);
  let amount = asMoneyNumber(body.Amount || body.amount);
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
  const scoped = await prepareScopedManualPayment(env, body, reviewWalletDuplicates);
  body = scoped.body;
  const financialScope = scoped.financialScope;
  const paymentScope = financialScope || requestedStudentScope(body);
  const requestedGrossAmount = asMoneyNumber(body.GrossAmount || amount);
  const requestedGatewayFee = asMoneyNumber(body.GatewayFee);
  const requestedCredit = requestedGatewayFee > 0
    ? Math.min(requestedGrossAmount, Math.max(0, asMoneyNumber(body.NetAmount || requestedGrossAmount - requestedGatewayFee)))
    : amount;
  await assertManualPaymentDestinations(env, reference, financialScope);
  let existingPayment = await findPaymentByReference(env, reference, {
    canonicalOnly: body.ReferenceIsDocumentId === true,
    strictReads: Boolean(financialScope)
  });
  let payment = existingPayment ? normalizePayment(existingPayment) : null;
  if (payment) assertManualPaymentRetry(payment, body, financialScope, requestedCredit);
  // Never replay the original deposit/allocation over an audited correction.
  if (payment?.LastCorrectionId) return { ok: true, duplicate: true, payment,
    message: 'This payment already has an audited correction. Its original receipt and correction remain unchanged.' };
  let duplicate = Boolean(payment);
  let paymentDocumentId = safeDocumentId(existingPayment?.__id || reference);
  if (!payment && await accountingPeriodIsClosed(env, clean(body.PaidAt || body.paidAt) || nowIso())) {
    const err = new Error('The payment date belongs to a closed accounting period; record an approved current-period adjustment instead.');
    err.status = 409;
    throw err;
  }
  if (payment) {
    accountRef = clean(payment.AccountRef || accountRef);
    feeCode = clean(payment.FeeCode || feeCode);
    amount = paymentCreditedAmount(payment) || amount;
    if (isAvailableSchoolCreditReceipt(payment)) {
      const preflight = await syncSchoolAccountCreditJournals(env, accountRef, [payment.ApplicationReference], financialScope);
      if (preflight.unreconciledLegacyActions?.length || preflight.unreconciledAllocation) {
        const err = new Error('This parent account needs finance review before its payment can be allocated to school fees.');
        err.status = 409;
        throw err;
      }
    }
    if (!clean(payment.ProcessingStatus)) {
      payment.ProcessingStatus = 'Processing';
      payment.ProcessingVersion = 2;
      payment.ProcessingStartedAt = nowIso();
      await patchDocumentFields(env, 'payments', paymentDocumentId, {
        ProcessingStatus: 'Processing',
        ProcessingVersion: 2,
        ProcessingStartedAt: payment.ProcessingStartedAt,
        UpdatedAt: nowIso()
      }, scopedPaymentWriteCondition(existingPayment, financialScope));
    }
  }
  const isTotalPayment = isSchoolFeesTotalCode(feeCode);
  const student = scoped.student || await findStudentByAccountRef(env, accountRef, paymentScope);
  const feeBranch = feeBranchId(student || { BranchId: paymentScope?.branchId || body.BranchId });
  const directFee = isTotalPayment ? null : (await resolveFeeDocument(env, feeBranch, feeCode)).existing;
  const configuredFees = isTotalPayment
    ? feeRowsForBranch(await loadBranchFinanceRows(env, 'feeItems', feeBranch), feeBranch).map(normalizeFeeItem)
    : (directFee ? [normalizeFeeItem(directFee)] : []);
  const fee = configuredFees.find((item) => sameText(item.FeeCode, feeCode)) || normalizeFeeItem(body);
  const schoolFeeCodes = new Set(configuredFees.filter(isSchoolFeeInvoice).map((item) => normalizeReferenceText(item.FeeCode)));
  const paymentId = ledgerDocumentId('PAY');
  const grossAmount = asMoneyNumber(body.GrossAmount || amount);
  const gatewayFee = asMoneyNumber(body.GatewayFee);
  const netAmount = gatewayFee > 0
    ? Math.max(0, asMoneyNumber(body.NetAmount || grossAmount - gatewayFee))
    : amount;
  const creditedAmount = gatewayFee > 0 ? Math.min(grossAmount, netAmount) : amount;
  const academicSession = clean(body.AcademicSession || (student && student.AcademicSession) || resolvedPeriodValue(fee.AcademicSession, ''));
  const term = clean(body.Term || (student && student.Term) || resolvedPeriodValue(fee.Term, ''));
  let duplicateWalletReview = null;
  if (!payment && reviewWalletDuplicates) {
    const review = await reviewManualWalletTopup({
      body: { ...body, Reference: reference, FeeCode: feeCode, FeeCategory: clean(body.FeeCategory || fee.FeeCategory),
        Amount: creditedAmount, Currency: clean(body.Currency || fee.Currency) || 'NGN' },
      student, scope: financialScope, payments: (scoped.payments || []).map(normalizePayment), ledger: (scoped.ledger || []).map(normalizeLedger)
    });
    if (review?.required) return review.response;
    duplicateWalletReview = review?.acknowledgement || null;
  }
  if (!payment) {
    payment = {
      PaymentId: paymentId,
      AccountRef: accountRef,
      AccountRefNormalized: normalizeReferenceText(accountRef),
      ApplicationReference: clean(body.ApplicationReference || (student && student.ApplicationReference)),
      AdmissionNo: clean(body.AdmissionNo || (student && student.AdmissionNo)),
      BranchId: clean(body.BranchId || (student && student.BranchId) || 'main').toLowerCase() || 'main',
      SchoolSection: clean(body.SchoolSection || (student && student.SchoolSection) || (student && schoolSectionFor(student))),
      DisplayName: clean(body.DisplayName || (student && (student.DisplayName || student.ApplicantName))),
      ParentEmail: clean(body.ParentEmail || (student && (student.ParentEmail || student.VerificationEmail || student.Email))).toLowerCase(),
      ParentEmails: [...new Set([
        ...(Array.isArray(body.ParentEmails) ? body.ParentEmails : []),
        ...(Array.isArray(student?.ParentEmails) ? student.ParentEmails : []),
        body.ParentEmail, student?.ParentEmail, student?.VerificationEmail, student?.Email,
        student?.FatherEmail, student?.MotherEmail, student?.GuardianEmail
      ].map((value) => clean(value).toLowerCase()).filter(Boolean))],
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
      Metadata: clean(body.Metadata),
      ProcessingStatus: 'Processing',
      ProcessingVersion: 2,
      ProcessingStartedAt: nowIso()
    };
    if (duplicateWalletReview) payment.DuplicateWalletReview = duplicateWalletReview;
    if (isAvailableSchoolCreditReceipt(payment)) {
      const preflight = await syncSchoolAccountCreditJournals(env, accountRef, [payment.ApplicationReference], financialScope);
      if (preflight.unreconciledLegacyActions?.length || preflight.unreconciledAllocation) {
        const err = new Error('This parent account needs finance review before a new payment can be recorded.');
        err.status = 409;
        throw err;
      }
    }
    const paymentCreate = await createDocumentIfAbsent(env, 'payments', safeDocumentId(reference), payment);
    if (!paymentCreate.created) {
      payment = normalizePayment(paymentCreate.document || payment);
      assertManualPaymentRetry(payment, body, financialScope, requestedCredit);
      existingPayment = paymentCreate.document || payment;
      duplicate = true;
      paymentDocumentId = safeDocumentId(paymentCreate.document?.__id || reference);
      accountRef = clean(payment.AccountRef || accountRef);
      feeCode = clean(payment.FeeCode || feeCode);
      if (isAvailableSchoolCreditReceipt(payment)) {
        const preflight = await syncSchoolAccountCreditJournals(env, accountRef, [payment.ApplicationReference], financialScope);
        if (preflight.unreconciledLegacyActions?.length || preflight.unreconciledAllocation) {
          const err = new Error('The existing parent account needs finance review before its payment can be allocated.');
          err.status = 409;
          throw err;
        }
      }
    }
  }
  const paymentCredit = paymentCreditedAmount(payment);
  const paymentSession = clean(payment.AcademicSession || academicSession);
  const paymentTerm = clean(payment.Term || term);
  const ledgerNo = `LED-${safeDocumentId(reference)}`;
  const ledgerDocumentIdValue = safeDocumentId(ledgerNo);
  const existingLedger = await readScopedFinancialDocument(env, 'ledger', ledgerDocumentIdValue, financialScope, 'Payment ledger');
  if (existingLedger?.CorrectionTotal) throw financeFailure('This receipt has an audited correction. Reload its history instead of reposting it.', 409);
  assertManualPaymentDestination(existingLedger, financialScope, reference, 'Payment ledger');
  await upsertDocument(env, 'ledger', safeDocumentId(ledgerNo), {
    LedgerNo: ledgerNo,
    Date: payment.PaidAt,
    AccountRef: payment.AccountRef,
    AccountRefNormalized: normalizeReferenceText(payment.AccountRef),
    ApplicationReference: payment.ApplicationReference,
    AdmissionNo: payment.AdmissionNo,
    BranchId: payment.BranchId,
    SchoolSection: payment.SchoolSection,
    DisplayName: payment.DisplayName,
    ClassName: payment.ClassName,
    BillingCategory: payment.BillingCategory,
    EntryType: normalizeMatchText(payment.FeeCategory) === 'wallet' || clean(payment.FeeCode) === 'WALLET_TOPUP' ? 'Wallet Deposit' : 'Payment',
    FeeCode: payment.FeeCode,
    FeeName: payment.FeeName,
    FeeCategory: payment.FeeCategory,
    AcademicSession: payment.AcademicSession,
    Term: payment.Term,
    Description: payment.FeeName,
    Debit: 0,
    Credit: paymentCredit,
    Currency: payment.Currency,
    Reference: reference,
    RecordedBy: payment.RecordedBy,
    Source: payment.Gateway || payment.Method,
    Metadata: payment.Metadata
  }, scopedPaymentWriteCondition(existingLedger, financialScope));
  payment.LedgerPostingStatus = 'Completed';
  payment.ProcessingVersion = 2;
  const postingPaymentVersion = financialScope ? await manualPaymentVersion(env, paymentDocumentId, body, financialScope, requestedCredit) : null;
  await patchDocumentFields(env, 'payments', paymentDocumentId, {
    LedgerPostingStatus: 'Completed',
    ProcessingVersion: 2,
    UpdatedAt: nowIso()
  }, scopedPaymentWriteCondition(postingPaymentVersion, financialScope));
  await removeStandaloneAcceptanceInvoices(env, payment, financialScope);
  const accountInvoices = (await queryAccountRows(env, 'invoices', accountRef, financialScope)).map(normalizeInvoice);
  const matchingInvoices = accountInvoices.filter((invoice) => {
    return sameText(invoice.AccountRef, accountRef) &&
      (!isSchoolFeeInvoice(invoice) || isAvailableSchoolCreditReceipt(payment)) &&
      (isSchoolFeesTotalPayment(payment)
        ? isSchoolFeeInvoice(invoice) || schoolFeeCodes.has(normalizeReferenceText(invoice.FeeCode))
        : sameText(invoice.FeeCode, feeCode)) &&
      sameFinancialPeriod(invoice, paymentSession, paymentTerm) &&
      normalizeMatchText(invoice.Status) !== 'paid';
  }).sort((a, b) => timestampMs(a.Date || a.CreatedAt) - timestampMs(b.Date || b.CreatedAt));
  const unfinishedPayment = normalizeMatchText(payment.ProcessingStatus) === 'processing';
  const invoiceAllocationComplete = normalizeMatchText(payment.InvoiceAllocationStatus) === 'completed';
  const shouldApplyInvoiceAllocation = !duplicate || (unfinishedPayment && !invoiceAllocationComplete) ||
    (!existingLedger && !invoiceAllocationComplete);
  let notificationSettings = null;
  if (shouldApplyInvoiceAllocation) {
    notificationSettings = await loadNotificationSettings(env);
    const invoiceAllocation = calculateInvoiceCreditAllocations(matchingInvoices, paymentCredit);
    const schoolCreditJournals = isAvailableSchoolCreditReceipt(payment)
      ? invoiceAllocation.allocations.filter((allocation) => isSchoolFeeInvoice(allocation.invoice))
        .map((allocation) => buildSchoolInvoiceCreditPaymentJournal(allocation.invoice, payment, allocation.AppliedCredit))
        .filter(Boolean)
      : [];
    if (schoolCreditJournals.length && await accountingPeriodIsClosed(env, payment.PaidAt || payment.PaymentDate || payment.Date || nowIso())) {
      const err = new Error('The payment allocation belongs to a closed accounting period; finance review is required.');
      err.status = 409;
      throw err;
    }
    payment.InvoiceAllocationStatus = 'Completed';
    payment.InvoiceAllocationCompletedAt = nowIso();
    const currentPaymentVersion = await manualPaymentVersion(env, paymentDocumentId, body, financialScope, requestedCredit);
    await batchUpsertDocuments(env, [
      ...invoiceAllocation.allocations.map((allocation) => ({
        collectionPath: 'invoices',
        documentId: safeDocumentId(allocation.invoice.InvoiceId),
        ...(allocation.invoice.__updateTime ? { updateTime: allocation.invoice.__updateTime } : {}),
        data: {
          ...allocation.invoice,
          Credit: allocation.Credit,
          Balance: allocation.Balance,
          Status: allocation.Status,
          UpdatedAt: nowIso(),
          ...invoiceReminderFields({
            ...allocation.invoice,
            Balance: allocation.Balance,
            Status: allocation.Status
          }, notificationSettings)
        }
      })),
      ...schoolCreditJournals.map((journal) => ({
        collectionPath: 'accountingJournals', documentId: safeDocumentId(journal.JournalNo), exists: false, data: journal
      })),
      {
        collectionPath: 'payments',
        documentId: paymentDocumentId,
        data: { ...payment, UpdatedAt: nowIso() },
        ...(financialScope ? scopedPaymentWriteCondition(currentPaymentVersion, financialScope) : { updateTime: currentPaymentVersion?.__updateTime })
      }
    ]);
  }
  if (isAcceptanceFeeLike(payment)) {
    const appId = payment.ApplicationReference || payment.AccountRef;
    const app = await findApplication(env, appId, financialScope);
    if (app) {
      await saveApplication(env, {
        ...app,
        AcceptanceFeePaid: 'YES',
        AcceptanceFeePaidAt: payment.PaidAt,
        AcceptanceFeeAmount: paymentCredit,
        AcceptanceFeeMethod: payment.Gateway || payment.Method,
        AcceptanceFeeReceiptNo: payment.ReceiptNo || payment.Reference,
        AcceptanceFeeReceivedBy: payment.RecordedBy,
        UpdatedAt: nowIso()
      }, scopedPaymentWriteCondition(app, financialScope));
    }
  }
  if (payment.GatewayFee > 0) {
    const chargeId = safeDocumentId(`PAYSTACK-FEE-${payment.Reference || payment.GatewayReference || payment.PaymentId}`);
    const priorCharge = await readScopedFinancialDocument(env, 'paymentGatewayCharges', chargeId, financialScope, 'Payment gateway charge', { accountRequired: false });
    assertManualPaymentDestination(priorCharge, financialScope, payment.Reference, 'Payment gateway charge', { accountRequired: false });
    await upsertDocument(env, 'paymentGatewayCharges', chargeId, {
      ChargeId: chargeId, Date: payment.PaidAt,
      Description: `Paystack transaction charge - ${payment.Reference || payment.PaymentId}`,
      Amount: payment.GatewayFee, GrossCollection: payment.GrossAmount, NetSettlement: paymentCredit,
      Treatment: 'DeductedBeforeStudentCredit', Status: 'Recorded',
      Reference: payment.Reference || payment.PaymentId, Source: payment.Gateway || 'Paystack',
      ...(financialScope ? { BranchId: financialScope.branchId, SchoolSection: financialScope.schoolSectionAccess, AccountRef: payment.AccountRef } : {}),
      CreatedAt: nowIso(), UpdatedAt: nowIso()
    }, scopedPaymentWriteCondition(priorCharge, financialScope));
  }
  await writePaymentAccountingJournal(env, payment, matchingInvoices.length > 0, financialScope);
  let invoicePostingWarning = '';
  const shouldGenerateSchoolInvoices = Boolean(student) && (
    isSchoolFeesTotalPayment(payment) ||
    isSchoolFeeInvoice(payment)
  );
  if (shouldGenerateSchoolInvoices) {
    try {
      await generateSchoolFeeInvoices(env, {
        AccountRef: accountRef,
        RecordedBy: payment.RecordedBy,
        BranchId: payment.BranchId,
        SchoolSection: payment.SchoolSection,
        ResolvedStudent: student,
        ExistingInvoices: accountInvoices,
        NotificationSettings: notificationSettings
      }, financialScope);
    } catch (error) {
      if (error?.code === 'MANUAL_PAYMENT_SCOPE_MISMATCH') throw error;
      invoicePostingWarning = error && error.message ? error.message : String(error);
      await refreshAccountFinancialSummary(env, accountRef, [payment.ApplicationReference], financialScope);
    }
  } else {
    await refreshAccountFinancialSummary(env, accountRef, [payment.ApplicationReference], financialScope);
  }
  if (!shouldGenerateSchoolInvoices || invoicePostingWarning) {
    await syncSchoolAccountCreditJournals(env, accountRef, [payment.ApplicationReference], financialScope);
  }
  payment.ProcessingStatus = 'Completed';
  payment.ProcessingVersion = 2;
  payment.CompletedAt = nowIso();
  payment.InvoicePostingStatus = invoicePostingWarning ? 'Warning' : (shouldGenerateSchoolInvoices ? 'Completed' : 'Not Required');
  payment.InvoicePostingWarning = invoicePostingWarning;
  const finalPaymentVersion = financialScope ? await manualPaymentVersion(env, paymentDocumentId, body, financialScope, requestedCredit) : null;
  await upsertDocument(env, 'payments', paymentDocumentId, payment, scopedPaymentWriteCondition(finalPaymentVersion, financialScope));
  if (body.DeferNotifications !== true) {
    await notifyParentPaymentReceived(env, payment).catch(() => null);
  }
  return {
    ok: true,
    message: invoicePostingWarning
      ? `Payment recorded, but invoice posting needs attention: ${invoicePostingWarning}`
      : (duplicate ? 'Payment was already recorded; its dependent records were checked.' : 'Payment recorded in the database.'),
    duplicate,
    payment,
    invoicePostingWarning
  };
}

export function resolveSchoolFeeInvoiceAccountRefs(body = {}) {
  const values = [
    body.AccountRef,
    body.accountRef,
    ...(Array.isArray(body.AccountRefs)
      ? body.AccountRefs
      : clean(body.AccountRefs || body.accountRefs).split(','))
  ];
  const seen = new Set();
  const references = [];
  for (const value of values) {
    const reference = clean(value);
    const key = reference.toLowerCase();
    if (!reference || seen.has(key)) continue;
    seen.add(key);
    references.push(reference);
  }
  return references;
}

async function generateSchoolFeeInvoices(env, body, financialScope = null) {
  const accountRefs = resolveSchoolFeeInvoiceAccountRefs(body);
  if (!accountRefs.length) {
    const err = new Error('AccountRef or AccountRefs is required.');
    err.status = 400;
    throw err;
  }
  const results = [];
  for (const accountRef of accountRefs) {
    results.push(await generateSchoolFeeInvoicesForAccount(env, body, accountRef, financialScope));
  }
  if (results.length === 1) return results[0];
  const created = results.reduce((sum, result) => sum + result.created, 0);
  const updated = results.reduce((sum, result) => sum + result.updated, 0);
  return {
    ok: true,
    message: `${created} school fee invoice item(s) generated, ${updated} updated for ${results.length} student(s).`,
    created,
    updated,
    results
  };
}

async function generateSchoolFeeInvoicesForAccount(env, body, accountRef, financialScope = null) {
  let student = body.ResolvedStudent || await findStudentByAccountRef(env, accountRef, {
    branchId: clean(body.BranchId || body.branchId),
    schoolSectionAccess: clean(body.SchoolSection || body.schoolSection)
  });
  if (!student) throw applicationNotFound(accountRef);
  assertManualPaymentScope(student, financialScope, 'Invoice student');
  const linkedApplication = clean(student.ApplicationReference)
    ? await findApplication(env, student.ApplicationReference, financialScope).catch((error) => { if (financialScope) throw error; return null; })
    : null;
  const resolvedEnrollmentCategory = resolveStudentEnrollmentCategory(student, linkedApplication || {});
  if (resolvedEnrollmentCategory === 'New Intake' && normalizeMatchText(student.EnrollmentCategory) !== 'new intake') {
    student = await saveStudent(env, {
      ...student,
      ...admissionIntakeClassification(student),
      UpdatedAt: nowIso()
    }, scopedPaymentWriteCondition(student, financialScope));
  }
  const profileResult = student.AcademicSession && student.Term
    ? { profile: {} }
    : await getSchoolProfile(env).catch(() => ({ profile: {} }));
  const activeProfile = profileResult.profile || {};
  const billingApp = {
    ...student,
    ClassApplyingFor: student.ClassName,
    ClassAdmitted: student.ClassName,
    AcademicSession: student.AcademicSession || activeProfile.CurrentAcademicSession,
    Term: student.Term || activeProfile.CurrentTerm || 'First Term',
    BillingCategory: student.BillingCategory || 'Regular',
    EnrollmentCategory: resolvedEnrollmentCategory
  };
  const billingSession = clean(billingApp.AcademicSession);
  const billingTerm = clean(billingApp.Term);
  const fees = applyBillingCategoryOverrides((await loadBranchFinanceRows(env, 'feeItems', feeBranchId(billingApp))).map(normalizeFeeItem).filter((fee) => {
    return yesNo(fee.Active) === 'YES' &&
      isSchoolFeeInvoice(fee) &&
      !isWalletFee(fee) &&
      asMoneyNumber(fee.Amount) > 0 &&
      feeMatchesApplication(fee, billingApp);
  }), billingApp);
  if (!fees.length) {
    if (isFullScholarship(billingApp.BillingCategory)) {
      return { ok: true, message: 'Full Scholarship: no school fee components are explicitly assigned for this period.',
        created: 0, updated: 0, exempt: true };
    }
    const err = new Error('No matching school fee items found for this class/student type.');
    err.status = 400;
    throw err;
  }
  // Payment posting can update invoices after its caller took a snapshot.
  const existing = (await queryAccountRows(env, 'invoices', accountRef, financialScope)).map(normalizeInvoice);
  const linkedReferences = [student.ApplicationReference].map(clean).filter(Boolean);
  let created = 0;
  let updated = 0;
  const generatedInvoices = [];
  const invoiceWrites = [];
  const notificationSettings = body.NotificationSettings || await loadNotificationSettings(env);
  for (const fee of fees) {
    const invoiceSession = resolvedPeriodValue(fee.AcademicSession, billingSession);
    const invoiceTerm = resolvedPeriodValue(fee.Term, billingTerm);
    const debit = asMoneyNumber(fee.Amount);
    const duplicate = existing.find((invoice) => {
      return sameText(invoice.AccountRef, accountRef) &&
        sameText(invoice.FeeCode, fee.FeeCode) &&
        sameFinancialPeriod(invoice, invoiceSession, invoiceTerm);
    });
    const credit = Math.min(debit, asMoneyNumber(duplicate?.Credit));
    const balance = Math.max(0, debit - credit);
    const status = balance <= 0 ? 'Paid' : credit > 0 ? 'Part Paid' : 'Unpaid';
    const invoiceId = duplicate ? duplicate.InvoiceId : ledgerDocumentId('INV');
    const invoicePayload = {
      ...(duplicate || {}),
      InvoiceId: invoiceId,
      AccountRef: accountRef,
      AccountRefNormalized: normalizeReferenceText(accountRef),
      ApplicationReference: student.ApplicationReference || '',
      AdmissionNo: student.AdmissionNo || '',
      ParentEmail: clean(
        student.ParentEmail
        || student.VerificationEmail
        || student.Email
      ).toLowerCase(),
      ParentEmails: [...new Set([
        ...(Array.isArray(student.ParentEmails) ? student.ParentEmails : []),
        student.ParentEmail, student.VerificationEmail, student.Email,
        student.FatherEmail, student.MotherEmail, student.GuardianEmail
      ].map((value) => clean(value).toLowerCase()).filter(Boolean))],
      BranchId: clean(student.BranchId || body.BranchId || 'main').toLowerCase() || 'main',
      SchoolSection: clean(
        student.SchoolSection
        || body.SchoolSection
        || schoolSectionFor(student)
      ).toLowerCase(),
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
      DueDate: feeDueDate(fee.DueDate) || fee.DueDate || '',
      Status: status,
      Date: duplicate?.Date || nowIso(),
      CreatedAt: duplicate?.CreatedAt || nowIso(),
      UpdatedAt: nowIso(),
      RecordedBy: clean(body.RecordedBy) || duplicate?.RecordedBy || 'Accounts Office'
    };
    Object.assign(invoicePayload, invoiceReminderFields(invoicePayload, notificationSettings));
    invoiceWrites.push({
      collectionPath: 'invoices',
      documentId: safeDocumentId(invoiceId),
      ...scopedPaymentWriteCondition(duplicate, financialScope),
      data: invoicePayload
    });
    generatedInvoices.push(invoicePayload);
    if (duplicate) updated += 1;
    else created += 1;
  }
  if (invoiceWrites.length) await batchUpsertDocuments(env, invoiceWrites);
  await applyDueSchoolFeeCreditsForAccount(env, accountRef, linkedReferences, notificationSettings, undefined, financialScope);
  return { ok: true, message: `${created} school fee invoice item(s) generated, ${updated} updated.`, created, updated };
}

function ledgerDocumentId(prefix = 'LED') {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${globalThis.crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function sameDayIso(value, today = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
}

export function summarizeWalletActivity(rows, accountRef, today = new Date()) {
  return (rows || []).map(normalizeLedger).reduce((summary, row) => {
    if (!sameText(row.AccountRef, accountRef) && !referencesMatch(row.AccountRef, accountRef)) return summary;
    if (normalizeMatchText(row.FeeCategory) === 'wallet' || normalizeMatchText(row.EntryType).startsWith('wallet')) {
      summary.balance += asMoneyNumber(row.Credit) - asMoneyNumber(row.Debit);
    }
    if (['wallet purchase', 'wallet offering'].includes(normalizeMatchText(row.EntryType)) && sameDayIso(row.Date || row.createdAt, today)) {
      summary.spentToday += asMoneyNumber(row.Debit);
    }
    return summary;
  }, { balance: 0, spentToday: 0 });
}

export function calculateCarryForwardSchoolCredit({
  schoolFeeRelatedCredit = 0,
  currentPeriodSchoolFeeCredit = 0,
  priorSchoolFeeCharge = 0,
  accountCreditDebits = 0,
  acceptanceCreditAppliedSeparately = 0
} = {}) {
  return Math.max(0,
    asMoneyNumber(schoolFeeRelatedCredit) -
    asMoneyNumber(currentPeriodSchoolFeeCredit) -
    asMoneyNumber(priorSchoolFeeCharge) -
    asMoneyNumber(accountCreditDebits) -
    asMoneyNumber(acceptanceCreditAppliedSeparately)
  );
}

async function walletActivityForAccount(env, accountRef, studentScope = null) {
  let rows = await queryAccountRows(env, 'ledger', accountRef, null, { strict: true });
  if (studentScope) {
    const branchId = clean(studentScope.BranchId || studentScope.branchId || 'main').toLowerCase() || 'main';
    const schoolSection = clean(studentScope.SchoolSection || schoolSectionFor(studentScope)).toLowerCase();
    rows = rows.filter((row) => {
      const rowBranch = clean(row.BranchId || row.branchId || 'main').toLowerCase() || 'main';
      const rowSection = clean(row.SchoolSection || schoolSectionFor(row)).toLowerCase();
      return rowBranch === branchId && (!schoolSection || rowSection === schoolSection);
    });
  }
  return summarizeWalletActivity(rows, accountRef);
}

async function accountCreditBalanceForAccount(env, accountRef, linkedReferences = []) {
  // Credit actions must use live invoices and ledger, not a cached account row.
  const account = await refreshAccountFinancialSummary(env, accountRef, linkedReferences);
  return asMoneyNumber(account.CreditBalance);
}

export function studentsShareParentForCreditTransfer(source = {}, target = {}) {
  const emails = (student) => new Set([
    ...(Array.isArray(student.ParentEmails) ? student.ParentEmails : []),
    student.ParentEmail, student.VerificationEmail, student.FatherEmail,
    student.MotherEmail, student.GuardianEmail
  ].map(lower).filter(Boolean));
  const sourceEmails = emails(source);
  return [...emails(target)].some((email) => sourceEmails.has(email));
}

export async function walletAccountPayload(env, student) {
  const normalized = normalizeStudent(student || {});
  const accountRef = normalized.AdmissionNo || normalized.ApplicationReference || normalized.AccountRef || '';
  const activity = await walletActivityForAccount(env, accountRef, normalized);
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
    BranchId: clean(normalized.BranchId || 'main').toLowerCase() || 'main',
    SchoolSection: clean(normalized.SchoolSection || schoolSectionFor(normalized)),
    WalletCardId: normalized.WalletCardId || '',
    WalletCardStatus: normalized.WalletCardStatus || 'Active',
    WalletDailyLimit: normalized.WalletDailyLimit || '',
    WalletTxnLimit: normalized.WalletTxnLimit || '',
    WalletPinThreshold: normalized.WalletPinThreshold || '',
    StudentScopePath: normalized.__scopePath || '',
    WalletBalance: activity.balance,
    WalletSpentToday: activity.spentToday
  };
}

// Each row performs invoice allocation and journal reconciliation. Keep a
// request below the Worker deadline, and let the client report each batch.
const HISTORICAL_PAYMENT_IMPORT_LIMIT = 5;

export function historicalPaymentTemplateAccountRows(studentRows = []) {
  const accountsByReference = new Map();
  for (const source of studentRows || []) {
    const student = normalizeStudent(source || {});
    const accountRef = clean(student.AdmissionNo || student.AccountRef || student.ApplicationReference || student.__id);
    const referenceKey = normalizeReferenceText(accountRef);
    if (!referenceKey) continue;
    const account = {
      AccountRef: accountRef,
      AdmissionNo: clean(student.AdmissionNo || accountRef),
      ApplicationReference: clean(student.ApplicationReference),
      DisplayName: clean(student.DisplayName || student.ApplicantName),
      ClassName: clean(student.ClassName || student.ClassAdmitted),
      StudentType: clean(student.StudentType),
      BillingCategory: clean(student.BillingCategory) || 'Regular',
      AcademicSession: clean(student.AcademicSession),
      Term: clean(student.Term),
      BranchId: canonicalSchoolBranchId(student.BranchId || 'main'),
      SchoolSection: schoolSectionFor(student),
      StudentScopePath: clean(student.__scopePath),
      Status: clean(student.Status) || 'Active'
    };
    const existing = accountsByReference.get(referenceKey);
    const existingScopePath = clean(existing && existing.StudentScopePath);
    const accountScopePath = clean(account.StudentScopePath);
    const existingIsScoped = Boolean(existingScopePath && existingScopePath !== 'students');
    const accountIsScoped = Boolean(accountScopePath && accountScopePath !== 'students');
    if (!existing || (accountIsScoped && !existingIsScoped)) accountsByReference.set(referenceKey, account);
  }
  return [...accountsByReference.values()].sort((left, right) =>
    clean(left.DisplayName || left.AccountRef).localeCompare(clean(right.DisplayName || right.AccountRef)));
}

export async function getHistoricalPaymentTemplateAccounts(env, body = {}) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const branchId = accountingRequestBranch(body);
  const students = await listSchoolCollection(env, 'students', { branchId });
  const accounts = historicalPaymentTemplateAccountRows(students);
  const sectionCounts = accounts.reduce((counts, account) => {
    const section = schoolSectionFor(account);
    counts[section] = (counts[section] || 0) + 1;
    return counts;
  }, {});
  return {
    ok: true,
    message: `${accounts.length} current student account(s) loaded for the historical-payment template.`,
    accounts,
    total: accounts.length,
    branchId,
    sectionCounts,
    generatedAt: nowIso()
  };
}

function historicalPaymentImportError(message, rowNumber = 0) {
  const err = new Error(rowNumber ? `Row ${rowNumber}: ${message}` : message);
  err.status = 400;
  return err;
}

export function normalizeHistoricalPaymentImportRow(row = {}, index = 0) {
  const rowNumber = Math.max(2, Number(row.RowNumber || row.rowNumber) || Number(index) + 2);
  const accountRef = clean(row.AccountRef || row.accountRef || row.AdmissionNo || row.admissionNo || row.ApplicationReference);
  const billingCategory = clean(row.BillingCategory || row.billingCategory);
  const feeCode = clean(row.FeeCode || row.feeCode);
  const amount = asMoneyNumber(row.Amount || row.amount);
  const paidAtSource = clean(row.PaidAt || row.PaymentDate || row.Date || row.paidAt || row.paymentDate);
  const reference = clean(row.Reference || row.PaymentReference || row.reference || row.paymentReference);
  const parsedPaidAt = new Date(paidAtSource);
  if (!accountRef) throw historicalPaymentImportError('AccountRef is required.', rowNumber);
  if (!billingCategory || sameText(billingCategory, 'All')) {
    throw historicalPaymentImportError('BillingCategory must identify the student billing category.', rowNumber);
  }
  if (!feeCode) throw historicalPaymentImportError('FeeCode is required.', rowNumber);
  if (amount <= 0) throw historicalPaymentImportError('Amount must be greater than zero.', rowNumber);
  if (!paidAtSource || Number.isNaN(parsedPaidAt.getTime()) ||
      (/^\d{4}-\d{2}-\d{2}$/.test(paidAtSource) && parsedPaidAt.toISOString().slice(0, 10) !== paidAtSource)) {
    throw historicalPaymentImportError('PaidAt must be a valid date such as 2026-09-01.', rowNumber);
  }
  if (!reference) throw historicalPaymentImportError('Reference is required so duplicate payments can be prevented.', rowNumber);
  return {
    RowNumber: rowNumber,
    AccountRef: accountRef,
    BillingCategory: billingCategory,
    FeeCode: feeCode,
    FeeName: clean(row.FeeName || row.feeName),
    FeeCategory: clean(row.FeeCategory || row.feeCategory),
    Amount: amount,
    PaidAt: /^\d{4}-\d{2}-\d{2}$/.test(paidAtSource) ? `${paidAtSource}T12:00:00.000Z` : parsedPaidAt.toISOString(),
    Reference: reference,
    Method: clean(row.Method || row.method) || 'Bank Transfer',
    AcademicSession: clean(row.AcademicSession || row.academicSession),
    Term: clean(row.Term || row.term),
    ReceiptNo: clean(row.ReceiptNo || row.receiptNo),
    Currency: clean(row.Currency || row.currency) || 'NGN',
    Notes: clean(row.Notes || row.notes)
  };
}

export async function importHistoricalPayments(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const sourceRows = Array.isArray(body.Payments) ? body.Payments : [];
  if (!sourceRows.length) throw historicalPaymentImportError('Choose a historical-payment CSV containing at least one payment row.');
  if (sourceRows.length > HISTORICAL_PAYMENT_IMPORT_LIMIT) {
    throw historicalPaymentImportError(`Import no more than ${HISTORICAL_PAYMENT_IMPORT_LIMIT} payments in one request.`);
  }

  const normalizedRows = [];
  const failures = [];
  const referenceKeys = new Set();
  const categoryByAccount = new Map();
  for (let index = 0; index < sourceRows.length; index += 1) {
    try {
      const row = normalizeHistoricalPaymentImportRow(sourceRows[index], index);
      const referenceKey = normalizeReferenceText(row.Reference);
      if (referenceKeys.has(referenceKey)) {
        throw historicalPaymentImportError('Reference is duplicated in this import.', row.RowNumber);
      }
      referenceKeys.add(referenceKey);
      const accountKey = normalizeReferenceText(row.AccountRef);
      const priorCategory = categoryByAccount.get(accountKey);
      if (priorCategory && !sameText(priorCategory, row.BillingCategory)) {
        throw historicalPaymentImportError('The same student has conflicting BillingCategory values in this import.', row.RowNumber);
      }
      categoryByAccount.set(accountKey, row.BillingCategory);
      normalizedRows.push(row);
    } catch (error) {
      failures.push({ row: index + 2, message: error.message || String(error) });
    }
  }
  if (failures.length) {
    return { ok: true, message: 'No payments were imported because validation failed.', imported: 0, duplicates: 0, failures };
  }

  const scope = {
    branchId: clean(body.BranchId || body.branchId || body.UserBranchId),
    schoolSectionAccess: clean(body.SchoolSection || body.schoolSection || body.UserSchoolSectionAccess)
  };
  const prepared = [];
  const categoryByStudent = new Map();
  for (const row of normalizedRows) {
    try {
      const student = await findStudentByAccountRef(env, row.AccountRef, scope);
      if (!student) throw historicalPaymentImportError(`Student account ${row.AccountRef} was not found.`, row.RowNumber);
      const studentKey = clean(
        student.__scopePath || student.__id || student.AdmissionNo || student.AccountRef || student.ApplicationReference || row.AccountRef
      );
      const priorStudentCategory = categoryByStudent.get(studentKey);
      if (priorStudentCategory && !sameText(priorStudentCategory, row.BillingCategory)) {
        throw historicalPaymentImportError('The same student has conflicting BillingCategory values in this import.', row.RowNumber);
      }
      categoryByStudent.set(studentKey, row.BillingCategory);
      const existing = await findPaymentByReference(env, row.Reference);
      if (existing) {
        const existingPayment = normalizePayment(existing);
        const sameAccount = referencesMatch(existingPayment.AccountRef, row.AccountRef) ||
          accountRefsFrom(student).some((value) => referencesMatch(existingPayment.AccountRef, value));
        const sameFee = sameText(existingPayment.FeeCode, row.FeeCode);
        const sameAmount = Math.abs(paymentCreditedAmount(existingPayment) - row.Amount) < 0.005;
        if (!sameAccount || !sameFee || !sameAmount) {
          throw historicalPaymentImportError('Reference already belongs to a different payment.', row.RowNumber);
        }
      }
      prepared.push({ row, student });
    } catch (error) {
      failures.push({ row: row.RowNumber, message: error.message || String(error) });
    }
  }
  if (failures.length) {
    return { ok: true, message: 'No payments were imported because validation failed.', imported: 0, duplicates: 0, failures };
  }

  const results = [];
  let duplicates = 0;
  for (const { row, student } of prepared) {
    try {
      let currentStudent = student;
      if (!sameText(student.BillingCategory || 'Regular', row.BillingCategory)) {
        currentStudent = await saveStudent(env, {
          ...student,
          BillingCategory: row.BillingCategory,
          UpdatedAt: nowIso()
        });
      }
      const result = await recordManualPayment(env, {
        ...row,
        AccountRef: clean(currentStudent.AdmissionNo || currentStudent.AccountRef || row.AccountRef),
        ApplicationReference: clean(currentStudent.ApplicationReference),
        AdmissionNo: clean(currentStudent.AdmissionNo),
        BranchId: clean(currentStudent.BranchId || body.BranchId || 'main'),
        SchoolSection: clean(currentStudent.SchoolSection || schoolSectionFor(currentStudent)),
        DisplayName: clean(currentStudent.DisplayName || currentStudent.ApplicantName),
        StudentType: clean(currentStudent.StudentType),
        BillingCategory: row.BillingCategory,
        RecordedBy: clean(body.RecordedBy) || 'Accounts Office',
        Gateway: 'Manual',
        Channel: 'Historical Payment Import',
        Metadata: row.Notes ? `Historical payment import: ${row.Notes}` : 'Historical payment import',
        DeferNotifications: true
      });
      if (result.duplicate) duplicates += 1;
      results.push({ row: row.RowNumber, reference: row.Reference, accountRef: row.AccountRef, duplicate: Boolean(result.duplicate) });
    } catch (error) {
      failures.push({ row: row.RowNumber, message: error.message || String(error) });
    }
  }
  return {
    ok: true,
    message: `${results.length} historical payment(s) processed${duplicates ? `; ${duplicates} already existed` : ''}${failures.length ? `; ${failures.length} failed` : ''}.`,
    imported: results.length - duplicates,
    processed: results.length,
    duplicates,
    failures,
    results
  };
}

export async function getWalletCardAccount(env, body) {
  const cardId = clean(body.WalletCardId || body.CardId || body.cardId).toUpperCase();
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const requestedScope = {
    branchId: body.BranchId || body.UserBranchId,
    schoolSectionAccess: body.SchoolSection || body.UserSchoolSectionAccess
  };
  const student = cardId
    ? await findStudentByWalletCard(env, cardId, requestedScope)
    : await findStudentByAccountRef(env, accountRef, requestedScope, body.StudentScopePath || body.ScopePath);
  if (!student) {
    const err = new Error('Student wallet card/account not found. Enroll the student first, then assign a wallet card.');
    err.status = 404;
    throw err;
  }
  return { ok: true, message: 'Wallet account loaded.', account: await walletAccountPayload(env, student) };
}

export async function saveWalletCard(env, body) {
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
  const requestedScopePath = clean(body.StudentScopePath || body.ScopePath || body.__scopePath);
  const studentScopePath = validatedIdentityScopePath(requestedScopePath, 'students');
  if (requestedScopePath && !studentScopePath) {
    const err = new Error('The selected student record scope is invalid. Refresh Accounts and try again.');
    err.status = 400;
    throw err;
  }
  const requestedScope = {
    branchId: body.BranchId || body.UserBranchId,
    schoolSectionAccess: body.SchoolSection || body.UserSchoolSectionAccess
  };
  const student = await findStudentByAccountRef(env, accountRef, requestedScope, studentScopePath);
  if (!student) {
    const err = new Error(`Student record not found: ${accountRef}. Refresh Accounts and select the enrolled student again.`);
    err.status = 404;
    throw err;
  }
  const duplicate = await findStudentByWalletCard(env, cardId);
  const duplicateIsSelectedStudent = duplicate
    && sameText(duplicate.AdmissionNo, student.AdmissionNo)
    && sameText(duplicate.__scopePath, student.__scopePath);
  if (duplicate && !duplicateIsSelectedStudent) {
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
    WalletUpdatedBy: clean(body.WalletUpdatedBy || body.UpdatedBy || body.RecordedBy),
    WalletUpdatedAt: nowIso()
  };
  const pin = clean(body.WalletPin || body.Pin);
  if (pin) {
    updates.WalletPinHash = await sha256Hex(`${requireConfiguredDesktopSecret(env, 'wallet PIN')}:${pin}`);
    updates.WalletPinSetAt = nowIso();
  }
  const saved = await saveStudent(env, updates);
  return { ok: true, message: 'Wallet card saved.', account: await walletAccountPayload(env, saved) };
}

export async function recordWalletPurchase(env, body, options = {}) {
  const cardId = clean(body.WalletCardId || body.CardId || body.cardId).toUpperCase();
  const accountRef = clean(body.AccountRef || body.accountRef || body.AdmissionNo || body.admissionNo);
  const tuckShop = normalizeMatchText(body.Department || body.department) === 'tuck shop';
  let amount = asMoneyNumber(body.Amount || body.amount);
  if (!tuckShop && amount <= 0) {
    const err = new Error('Enter a wallet purchase amount greater than zero.');
    err.status = 400;
    throw err;
  }
  const requestedScope = requestedStudentScope(body);
  const student = cardId
    ? await findStudentByWalletCard(env, cardId, requestedScope)
    : await findStudentByAccountRef(env, accountRef, requestedScope, body.StudentScopePath || body.ScopePath);
  if (!student) {
    const err = new Error('Student wallet card/account not found.');
    err.status = 404;
    throw err;
  }
  const account = await walletAccountPayload(env, student);
  const saleNo = tuckShop
    ? safeDocumentId(body.SaleRequestId || body.saleRequestId || `TUK-SALE-${crypto.randomUUID()}`)
    : '';
  if (tuckShop) {
    const existingSale = await getDocument(env, 'organizationCommerceSales', saleNo);
    if (existingSale) {
      if (options.vendorUser) {
        const { assertVendorSaleReplay } = await import('../lib/vendor-sales-access.js');
        await assertVendorSaleReplay(env, options.vendorUser, 'tuckShop', existingSale, options.vendorCheckoutDigest);
      }
      if (clean(existingSale.CustomerRef) !== clean(account.AccountRef)
        || clean(existingSale.SaleType) !== 'tuckShop'
        || normalizeMatchText(existingSale.BranchId) !== normalizeMatchText(account.BranchId || student.BranchId || 'main')) {
        const err = new Error('This tuck-shop request reference belongs to another sale.'); err.status = 409; throw err;
      }
      return { ok: true, replayed: true, message: 'This tuck-shop sale was already recorded.',
        sale: existingSale, account, balance: account.WalletBalance };
    }
  }
  const saleScope = { ...(options.vendorUser || {}), branchId: clean(account.BranchId || student.BranchId || 'main'),
    schoolSectionAccess: clean(account.SchoolSection || student.SchoolSection || schoolSectionFor(student)), edition: 'school' };
  const pricedSale = tuckShop ? await prepareTuckShopWalletCart(env, body, saleScope, {
    SaleNo: saleNo, BranchId: saleScope.branchId, OrganisationEdition: 'school',
    SchoolSection: clean(account.SchoolSection || student.SchoolSection),
    RecordedBy: clean(body.RecordedBy || body.recordedBy) || 'Wallet POS'
  }) : null;
  if (pricedSale) {
    amount = pricedSale.total;
    if (asMoneyNumber(body.Amount || body.amount) > 0 && asMoneyNumber(body.Amount || body.amount) !== amount) {
      const err = new Error('Item prices or quantities changed. Refresh the cart and try again.'); err.status = 409; throw err;
    }
  }
  if (amount <= 0) {
    const err = new Error('Choose at least one priced tuck-shop item.'); err.status = 400; throw err;
  }
  const cardStatus = normalizeMatchText(account.WalletCardStatus || 'Active');
  if (cardStatus !== 'active') {
    const err = new Error(`This wallet card is ${cardStatus || 'not active'}.`);
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
    const suppliedHash = await sha256Hex(`${requireConfiguredDesktopSecret(env, 'wallet PIN')}:${suppliedPin}`);
    if (!suppliedPin || suppliedHash !== savedPinHash) {
      const err = new Error('Invalid wallet PIN.');
      err.status = 400;
      throw err;
    }
  }
  const ledgerNo = tuckShop ? safeDocumentId(`WALLET-${saleNo}`) : ledgerDocumentId('WALLET');
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
    BranchId: clean(account.BranchId || student.BranchId || 'main').toLowerCase() || 'main',
    SchoolSection: clean(account.SchoolSection || student.SchoolSection || schoolSectionFor(student)),
    EntryType: 'Wallet Purchase',
    FeeCategory: 'Wallet',
    Department: clean(body.Department || body.department),
    Description: pricedSale
      ? pricedSale.cart.map((item) => `${item.Quantity} × ${item.ItemName}`).join(', ').slice(0, 500)
      : clean(body.Description || body.description) || 'Wallet purchase',
    Debit: amount,
    Credit: 0,
    Currency: 'NGN',
    Reference: clean(body.Reference || body.reference) || ledgerNo,
    RecordedBy: clean(body.RecordedBy || body.recordedBy) || 'Wallet POS',
    Source: clean(body.Terminal || body.terminal) || 'Wallet POS',
    Metadata: JSON.stringify({
      walletCardId: cardId || account.WalletCardId,
      department: clean(body.Department || body.department),
      ...(pricedSale ? { storeCart: pricedSale.cart.map(({ ItemName, Quantity, UnitPrice, Amount }) =>
        ({ ItemName, Quantity, UnitPrice, Amount })), saleNo } : {})
    })
  };
  if (pricedSale) {
    if (!student.__scopePath || !student.__id || !student.__updateTime) {
      const err = new Error('Student wallet version is unavailable. Refresh the customer and try again.'); err.status = 409; throw err;
    }
    const timestamp = nowIso();
    const sale = {
      SaleNo: saleNo, SaleType: 'tuckShop', Department: 'Tuck Shop',
      BranchId: entry.BranchId, SchoolSection: entry.SchoolSection, OrganisationEdition: 'school',
      CustomerType: 'Student', CustomerRef: account.AccountRef, CustomerName: account.DisplayName,
      Items: pricedSale.cart, ItemCount: pricedSale.cart.reduce((total, item) => total + item.Quantity, 0),
      Amount: amount, GrossAmount: amount, Currency: 'NGN', PaymentMethod: 'Student Wallet',
      PaymentStatus: 'Paid', Status: 'Paid', InventoryStatus: 'Deducted', LedgerNo: ledgerNo,
      SaleDate: timestamp, PaidAt: timestamp, CreatedAt: timestamp, UpdatedAt: timestamp,
      RecordedBy: entry.RecordedBy, RecordedByUsername: clean(options.vendorUser?.username || body.UserUsername),
      ...(options.vendorCheckoutDigest ? {VendorCheckoutDigest:options.vendorCheckoutDigest} : {}),
      CheckoutSource: clean(body.Terminal || body.terminal) || 'Tuck Shop POS'
    };
    const vendorPosting = await prepareVendorSale(env, sale, buildWalletPurchaseAccountingJournal(entry));
    const journal = vendorPosting.journal;
    sale.VendorSettlements = vendorPosting.settlements;
    sale.VendorJournalLines = journal.Lines;
    entry.VendorJournalLines = journal.Lines;
    const studentData = Object.fromEntries(Object.entries(student).filter(([key]) => !key.startsWith('__')));
    try {
      await batchCommitDocuments(env, [
        ...pricedSale.writes,
        ...vendorPosting.writes,
        { collectionPath: student.__scopePath, documentId: student.__id,
          data: { ...studentData, WalletLastPurchaseAt: timestamp, WalletLastPurchaseNo: saleNo },
          updateTime: student.__updateTime },
        { collectionPath: 'ledger', documentId: safeDocumentId(ledgerNo), data: entry, exists: false },
        { collectionPath: 'accountingJournals', documentId: safeDocumentId(journal.JournalNo), data: journal, exists: false },
        { collectionPath: 'organizationCommerceSales', documentId: saleNo, data: sale, exists: false }
      ]);
    } catch (error) {
      if ([409, 412].includes(Number(error.status))) {
        const conflict = new Error('The wallet or item stock changed during checkout. Refresh and try again.');
        conflict.status = 409;
        throw conflict;
      }
      throw error;
    }
    const updatedAccount = await walletAccountPayload(env, student);
    return { ok: true, message: 'Tuck-shop sale paid from the student wallet; stock updated.',
      ledger: entry, sale, balance: updatedAccount.WalletBalance, account: updatedAccount };
  }
  // All wallet debits share the student version guard, including boarding
  // offerings and non-stock clinic/kitchen purchases. Balance checks must not
  // race another debit; the subledger and journal also succeed together.
  if (!student.__scopePath || !student.__id || !student.__updateTime) {
    const err = new Error('Student wallet version is unavailable. Refresh and try again.'); err.status = 409; throw err;
  }
  const purchaseJournal = buildWalletPurchaseAccountingJournal(entry);
  try {
    await batchCommitDocuments(env, [
      { collectionPath: student.__scopePath, documentId: student.__id,
        data: { WalletLastPurchaseAt: entry.Date, WalletLastPurchaseNo: ledgerNo },
        updateMask: ['WalletLastPurchaseAt', 'WalletLastPurchaseNo'], updateTime: student.__updateTime },
      { collectionPath: 'ledger', documentId: safeDocumentId(ledgerNo), data: entry, exists: false },
      { collectionPath: 'accountingJournals', documentId: safeDocumentId(purchaseJournal.JournalNo), data: purchaseJournal, exists: false }
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error.status))) {
      const err = new Error('The wallet changed during this purchase. Refresh and try again; nothing was partially posted.'); err.status = 409; throw err;
    }
    throw error;
  }
  const updatedAccount = await walletAccountPayload(env, student);
  return {
    ok: true,
    message: 'Wallet purchase recorded.',
    ledger: entry,
    balance: updatedAccount.WalletBalance,
    account: updatedAccount
  };
}

export function buildCreditActionAccountingJournal({
  action = '', actionId = '', amount = 0, accountRef = '', targetAccountRef = '',
  paymentAccount = '', offsetAccount = '', branchId = 'main', date = nowIso(),
  reference = '', recordedBy = '', notes = ''
} = {}) {
  const kind = clean(action).toLowerCase();
  const value = asMoneyNumber(amount);
  const source = clean(accountRef);
  const target = clean(targetAccountRef);
  if (!clean(actionId) || !source || value <= 0) throw new Error('A valid credit action, source account and amount are required.');
  let lines;
  if (kind === 'refund to parent' || kind === 'refund') {
    if (!clean(paymentAccount)) throw new Error('Select the cash or bank account used for the refund.');
    lines = [
      { AccountCode: '2310', Debit: value, Credit: 0, Description: `Parent credit refunded: ${source}` },
      { AccountCode: clean(paymentAccount), Debit: 0, Credit: value, Description: `Refund paid to parent: ${source}` }
    ];
  } else if (kind === 'transfer to wallet' || kind === 'wallet') {
    lines = [
      { AccountCode: '2310', Debit: value, Credit: 0, Description: `Parent credit transferred: ${source}` },
      { AccountCode: '2200', Debit: 0, Credit: value, Description: `Student wallet funded: ${source}` }
    ];
  } else if (kind === 'transfer to sibling' || kind === 'sibling') {
    if (!target) throw new Error('Select the sibling account receiving this credit.');
    lines = [
      { AccountCode: '2310', Debit: value, Credit: 0, Description: `Parent credit transferred out: ${source}` },
      { AccountCode: '2310', Debit: 0, Credit: value, Description: `Parent credit transferred in: ${target}` }
    ];
  } else if (['manual credit adjustment', 'manual_credit', 'credit_adjustment',
    'manual debit adjustment', 'debit_adjustment'].includes(kind)) {
    const offset = clean(offsetAccount);
    if (!offset || offset === '2310') throw new Error('Select a valid offset account for the manual credit adjustment.');
    const isDebit = kind === 'manual debit adjustment' || kind === 'debit_adjustment';
    lines = isDebit
      ? [
          { AccountCode: '2310', Debit: value, Credit: 0, Description: `Manual parent credit reduction: ${source}` },
          { AccountCode: offset, Debit: 0, Credit: value, Description: `Adjustment offset: ${source}` }
        ]
      : [
          { AccountCode: offset, Debit: value, Credit: 0, Description: `Adjustment offset: ${source}` },
          { AccountCode: '2310', Debit: 0, Credit: value, Description: `Manual parent credit increase: ${source}` }
        ];
  } else {
    throw new Error('Choose a valid credit action.');
  }
  const journalNo = `SYS-CREDIT-${safeDocumentId(actionId)}`;
  return normalizedJournal({
    JournalNo: journalNo, Date: clean(date), Status: 'Posted',
    Description: clean(notes) || `Account credit action: ${kind}`,
    Reference: clean(reference) || clean(actionId),
    Source: 'Student Account Credit Action', SourceId: clean(actionId),
    AccountRef: source, TargetAccountRef: target,
    RecordedBy: clean(recordedBy), BranchId: clean(branchId).toLowerCase() || 'main',
    Lines: lines,
    TotalDebit: value, TotalCredit: value,
    CreatedAt: nowIso(), UpdatedAt: nowIso()
  });
}

async function recordCreditAction(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  if (accountingEditionForRequest(env) !== 'school') {
    const err = new Error('Student account credit actions are available only in the School edition.');
    err.status = 403;
    throw err;
  }
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
  if (!notes) {
    const err = new Error('Record the parent instruction or accounting reason in Notes.');
    err.status = 400;
    throw err;
  }
  const student = await findStudentByAccountRef(env, accountRef);
  if (!student) throw applicationNotFound(accountRef);
  const account = await walletAccountPayload(env, student);
  accountingWriteBranch(body, account);
  const linkedReferences = [student.ApplicationReference].map(clean).filter(Boolean);
  const availableCredit = await accountCreditBalanceForAccount(env, account.AccountRef, linkedReferences);
  const isManualCredit = action === 'manual credit adjustment' || action === 'manual_credit' || action === 'credit_adjustment';
  if (!isManualCredit && amount > availableCredit) {
    const err = new Error(`Amount exceeds available account credit (${formatNairaAmount(availableCredit)}).`);
    err.status = 400;
    throw err;
  }
  const reference = clean(body.Reference || body.reference) || ledgerDocumentId('CREDIT');
  const actionId = safeDocumentId(`${account.AccountRef}-${reference}`);
  if (await getDocument(env, 'creditActions', actionId)) {
    const err = new Error('This credit action reference has already been recorded for this account.');
    err.status = 409;
    throw err;
  }
  const entries = [];
  let targetStudentForSummary = null;
  let targetAccountForSummary = null;
  const base = {
    Date: nowIso(),
    AccountRef: account.AccountRef,
    ApplicationReference: account.ApplicationReference,
    AdmissionNo: account.AdmissionNo,
    DisplayName: account.DisplayName,
    ClassName: account.ClassName,
    AcademicSession: account.AcademicSession || student.AcademicSession || '',
    Term: account.Term || student.Term || '',
    BranchId: clean(account.BranchId || student.BranchId || 'main').toLowerCase() || 'main',
    SchoolSection: clean(account.SchoolSection || student.SchoolSection || schoolSectionFor(student)),
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
    let sameParent = studentsShareParentForCreditTransfer(student, targetStudent);
    if (!sameParent && student.ApplicationReference && targetStudent.ApplicationReference) {
      const [sourceApplication, targetApplication] = await Promise.all([
        findApplication(env, student.ApplicationReference).catch(() => null),
        findApplication(env, targetStudent.ApplicationReference).catch(() => null)
      ]);
      sameParent = studentsShareParentForCreditTransfer(
        { ...student, ParentEmails: [student.ParentEmail, sourceApplication?.ParentEmail, sourceApplication?.VerificationEmail] },
        { ...targetStudent, ParentEmails: [targetStudent.ParentEmail, targetApplication?.ParentEmail, targetApplication?.VerificationEmail] }
      );
    }
    if (sameReferenceIdentity(account.AccountRef, targetRef) || !sameParent) {
      const err = new Error('The target must be another student linked to the same parent email.');
      err.status = 400;
      throw err;
    }
    targetStudentForSummary = targetStudent;
    const targetAccount = await walletAccountPayload(env, targetStudent);
    targetAccountForSummary = targetAccount;
    if (!sameText(account.BranchId || student.BranchId || 'main', targetAccount.BranchId || targetStudent.BranchId || 'main')) {
      const err = new Error('Sibling credit transfers must remain in the same branch; use an approved inter-branch accounting transfer for another branch.');
      err.status = 400;
      throw err;
    }
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
      BranchId: clean(targetAccount.BranchId || targetStudent.BranchId || 'main').toLowerCase() || 'main',
      SchoolSection: clean(targetAccount.SchoolSection || targetStudent.SchoolSection || schoolSectionFor(targetStudent)),
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

  const date = nowIso();
  if (await accountingPeriodIsClosed(env, date)) {
    const err = new Error('This accounting period is closed.');
    err.status = 409;
    throw err;
  }
  // Repair legacy school receipt and invoice journals before drawing down the
  // parent-credit liability for a new action.
  const sourceReconciliation = await syncSchoolAccountCreditJournals(env, account.AccountRef, linkedReferences);
  if (sourceReconciliation.unreconciledLegacyActions?.length || sourceReconciliation.unreconciledAllocation) {
    const err = new Error('This student account has earlier credit actions or invoice allocations needing finance reconciliation before another credit action can be posted.');
    err.status = 409;
    throw err;
  }
  const paymentAccount = clean(body.PaymentAccount || body.paymentAccount);
  const offsetAccount = clean(body.OffsetAccountCode || body.offsetAccountCode);
  if (['refund to parent', 'refund', 'manual credit adjustment', 'manual_credit', 'credit_adjustment',
    'manual debit adjustment', 'debit_adjustment'].includes(action)) {
    const chart = await getAccountingChartRows(env);
    const wanted = ['refund to parent', 'refund'].includes(action) ? paymentAccount : offsetAccount;
    const selected = chart.find((row) => sameText(row.Code || row.__id, wanted) && yesNo(row.Active || 'YES') === 'YES');
    if (!selected || (['refund to parent', 'refund'].includes(action) &&
      (!sameText(selected.Type, 'Asset') || !sameText(selected.Group, 'Cash and Bank')))) {
      const err = new Error(['refund to parent', 'refund'].includes(action)
        ? 'Select an active cash or bank ledger account for the refund.'
        : 'Select an active offset ledger account for the manual adjustment.');
      err.status = 400;
      throw err;
    }
  }
  const journal = buildCreditActionAccountingJournal({
    action, actionId, amount, accountRef: account.AccountRef,
    targetAccountRef: targetAccountForSummary?.AccountRef || '',
    paymentAccount, offsetAccount, branchId: base.BranchId,
    date, reference, recordedBy, notes
  });
  // Keep the subledger, liability/cash journal and idempotency marker atomic.
  const summarySnapshot = await getDocument(env, 'accountSummaries', safeDocumentId(account.AccountRef));
  if (!summarySnapshot?.__updateTime) {
    const err = new Error('The current account credit could not be locked. Refresh and try again.');
    err.status = 409;
    throw err;
  }
  if (!isManualCredit && amount > asMoneyNumber(summarySnapshot.CreditBalance)) {
    const err = new Error('Available credit changed while this action was prepared. Refresh and try again.');
    err.status = 409;
    throw err;
  }
  let targetSummarySnapshot = null;
  if (targetStudentForSummary && targetAccountForSummary) {
    const targetLinkedReferences = [targetStudentForSummary.ApplicationReference].map(clean).filter(Boolean);
    const targetReconciliation = await syncSchoolAccountCreditJournals(env, targetAccountForSummary.AccountRef, targetLinkedReferences);
    if (targetReconciliation.unreconciledLegacyActions?.length || targetReconciliation.unreconciledAllocation) {
      const err = new Error('The sibling account has earlier credit actions or invoice allocations needing finance reconciliation before a transfer can be posted.');
      err.status = 409;
      throw err;
    }
    await refreshAccountFinancialSummary(env, targetAccountForSummary.AccountRef, targetLinkedReferences);
    targetSummarySnapshot = await getDocument(env, 'accountSummaries', safeDocumentId(targetAccountForSummary.AccountRef));
    if (!targetSummarySnapshot?.__updateTime) {
      const err = new Error('The sibling account credit could not be locked. Refresh and try again.');
      err.status = 409;
      throw err;
    }
  }
  await batchUpsertDocuments(env, [
    ...entries.map((entry) => ({
      collectionPath: 'ledger', documentId: safeDocumentId(entry.LedgerNo), data: entry
    })),
    {
      collectionPath: 'creditActions', documentId: actionId, exists: false,
      data: {
        ActionId: actionId, AccountRef: account.AccountRef, TargetAccountRef: clean(body.TargetAccountRef || body.targetAccountRef),
        Action: action, Amount: amount, Reference: reference, Notes: notes, RecordedBy: recordedBy,
        LedgerNos: entries.map((entry) => entry.LedgerNo), JournalNo: journal.JournalNo,
        PaymentAccount: paymentAccount, OffsetAccountCode: offsetAccount, CreatedAt: date
      }
    },
    { collectionPath: 'accountingJournals', documentId: safeDocumentId(journal.JournalNo), exists: false, data: journal },
    {
      collectionPath: 'accountSummaries', documentId: safeDocumentId(account.AccountRef), updateTime: summarySnapshot.__updateTime,
      data: {
        ...summarySnapshot,
        CreditBalance: asMoneyNumber(Math.max(0, asMoneyNumber(summarySnapshot.CreditBalance) + (isManualCredit ? amount : -amount))),
        UpdatedAt: nowIso()
      }
    },
    ...(targetSummarySnapshot ? [{
      collectionPath: 'accountSummaries', documentId: safeDocumentId(targetAccountForSummary.AccountRef),
      updateTime: targetSummarySnapshot.__updateTime,
      data: {
        ...targetSummarySnapshot,
        CreditBalance: asMoneyNumber(asMoneyNumber(targetSummarySnapshot.CreditBalance) + amount),
        UpdatedAt: nowIso()
      }
    }] : [])
  ]);
  if (isManualCredit) {
    await applyDueSchoolFeeCreditsForAccount(env, account.AccountRef, linkedReferences);
  }
  const senderSummary = await refreshAccountFinancialSummary(env, account.AccountRef, linkedReferences);
  if (targetStudentForSummary) {
    const targetAccountRef = clean(targetStudentForSummary.AdmissionNo || targetStudentForSummary.AccountRef || targetStudentForSummary.ApplicationReference);
    await applyDueSchoolFeeCreditsForAccount(env, targetAccountRef, [targetStudentForSummary.ApplicationReference].map(clean).filter(Boolean));
  }
  return {
    ok: true,
    message: 'Credit action recorded.',
    entries,
    availableCreditBefore: availableCredit,
    availableCreditAfter: senderSummary.CreditBalance
  };
}

async function saveClinicRecord(env, body) {
  const actor = await desktopSchoolOperationsActor(env, body, 'clinic', true);
  const scope = schoolOperationsScope(body);
  const student = await findStudentByAccountRef(env, clean(body.AdmissionNo), scope, body.StudentScopePath);
  if (!student || !schoolOperationsRowVisible(student, scope)) {
    throw Object.assign(new Error('Choose an enrolled student in your permitted branch and school section.'), { status: 404 });
  }
  const studentName = pick(student, ['DisplayName', 'ApplicantName', 'StudentName', 'Name']);
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
  const existing = await getDocument(env, 'clinicRecords', safeDocumentId(recordId));
  if (existing && (!schoolOperationsRowVisible(existing, scope)
    || identityRecordBranch(existing) !== identityRecordBranch(student)
    || identityRecordSection(existing) !== identityRecordSection(student)
    || !sameReferenceIdentity(existing.AdmissionNo, student.AdmissionNo))) {
    throw Object.assign(new Error('A clinic record cannot be reassigned to another student or workspace.'), { status: 403 });
  }
  const payload = {
    RecordId: recordId,
    RecordNo: recordId,
    Date: clean(body.Date) || nowIso(),
    StudentName: studentName,
    AdmissionNo: clean(student.AdmissionNo),
    ClassName: clean(student.ClassName || student.ClassAdmitted),
    BranchId: identityRecordBranch(student),
    SchoolSection: identityRecordSection(student),
    OrganisationEdition: 'school',
    Complaint: complaint,
    Treatment: clean(body.Treatment),
    Disposition: clean(body.Disposition),
    RecordedBy: clean(body.RecordedBy) || 'Clinic',
    ReviewedBy: clean(body.ReviewedBy),
    Notes: clean(body.Notes),
    UpdatedAt: nowIso()
  };
  return commitClinicVisit(env, { documentId: safeDocumentId(recordId), payload, body, user: actor });
}

async function getClinicRecords(env, body) {
  await desktopSchoolOperationsActor(env, body, 'clinic');
  const scope = schoolOperationsScope(body);
  const rows = await listCollection(env, 'clinicRecords');
  return { ok: true, message: 'Clinic records loaded from the database.', records: rows
    .filter(row => (!clean(row.OrganisationEdition) || lower(row.OrganisationEdition) === 'school')
      && schoolOperationsRowVisible(row, scope)).map(normalizeClinicRecord) };
}

function desktopInventoryScope(body = {}) {
  const assigned = clean(body.UserBranchId).toLowerCase();
  const requested = clean(body.BranchId).toLowerCase();
  if (assigned && assigned !== 'all' && requested && requested !== assigned) {
    throw Object.assign(new Error('This inventory belongs to another branch.'), { status: 403 });
  }
  return { BranchId: (assigned && assigned !== 'all' ? assigned : requested) || 'main',
    SchoolSection: clean(body.UserSchoolSectionAccess || 'All') };
}

async function desktopInventoryRows(env, body, collection, write = false) {
  await desktopSchoolOperationsActor(env, body, collection === 'clinicInventory' ? 'clinic' : 'kitchen', write);
  const scope = desktopInventoryScope(body);
  return (await listCollection(env, collection)).filter(row =>
    sameText(row.BranchId || 'main', scope.BranchId)
    && (!clean(row.OrganisationEdition) || sameText(row.OrganisationEdition, 'school'))
    && (sameText(scope.SchoolSection, 'All') || schoolSectionFor(row) === scope.SchoolSection.toLowerCase()));
}

function desktopInventoryMatch(rows, body, name) {
  const id = clean(body.InventoryId || body.ItemId);
  const matches = rows.filter(row => id ? clean(row.__id) === id : sameText(row.ItemName, name));
  if (matches.length > 1) throw Object.assign(new Error('Several stock records use this name. Select the exact item.'), { status: 409 });
  if (id && !matches.length) throw Object.assign(new Error('The stock item is outside your permitted workspace.'), { status: 404 });
  return matches[0];
}

function inventoryConditionalWrite(collectionPath, documentId, data, existing) {
  if (existing && !existing.__updateTime) throw Object.assign(new Error('Stock version is unavailable. Refresh and try again.'), { status: 409 });
  const payload = { ...data };
  for (const key of ['__id', '__name', '__updateTime', '__createTime']) delete payload[key];
  return { collectionPath, documentId: existing ? documentId : encodeURIComponent(documentId), data: payload, ...(existing ? { updateTime: existing.__updateTime } : { exists: false }) };
}

async function saveInventoryItem(env, body, collection, defaults) {
  const itemName = clean(body.ItemName || body.itemName);
  const originalItemName = clean(body.OriginalItemName || body.originalItemName || itemName);
  if (!itemName) {
    const err = new Error('Item name is required.');
    err.status = 400;
    throw err;
  }
  const scope = desktopInventoryScope(body);
  const existingRows = await desktopInventoryRows(env, body, collection, true);
  const existing = desktopInventoryMatch(existingRows, body, originalItemName);
  const section = clean(existing?.SchoolSection) || (sameText(scope.SchoolSection, 'All') ? 'Secondary' : scope.SchoolSection);
  if (existingRows.some(row => row.__id !== existing?.__id && sameText(row.ItemName, itemName)
    && schoolSectionFor(row) === section.toLowerCase())) {
    throw Object.assign(new Error('That item name already exists in this workspace.'), { status: 409 });
  }
  const nextId = clean(existing?.__id) || safeDocumentId(`${scope.BranchId}-${section}-${itemName}`);
  const quantity = inventoryQuantityNumber(body.Quantity ?? body.quantity ?? existing?.Quantity);
  if (quantity < 0) throw Object.assign(new Error('Stock quantity cannot be negative.'), { status: 400 });
  const payload = {
    ...(existing || {}),
    BranchId: scope.BranchId, SchoolSection: section, OrganisationEdition: 'school',
    ItemName: itemName,
    Category: clean(body.Category || body.category) || defaults.category,
    Unit: clean(body.Unit || body.unit) || clean(existing?.Unit) || defaults.unit,
    Quantity: quantity,
    ReorderLevel: inventoryQuantityNumber(body.ReorderLevel || body.reorderLevel),
    LastUpdated: nowIso(),
    Notes: clean(body.Notes || body.notes)
  };
  assertProcurementInventoryEdit(existing || {}, payload, { controlled: await loadProcurementInventoryControl(env, { ...scope, edition: 'school' }) });
  await batchCommitDocuments(env, [inventoryConditionalWrite(collection, nextId, payload, existing)], { literalDocumentIds: true });
  return { ok: true, message: `${defaults.label} inventory item saved to the database.`, item: normalizeInventory(payload) };
}

async function deleteInventoryItem(env, body, collection, label) {
  const itemName = clean(body.ItemName || body.itemName);
  if (!itemName) {
    const err = new Error('Item name is required.');
    err.status = 400;
    throw err;
  }
  const existing = desktopInventoryMatch(await desktopInventoryRows(env, body, collection, true), body, itemName);
  if (!existing) throw Object.assign(new Error('Inventory item not found in this workspace.'), { status: 404 });
  assertProcurementInventoryDeletion(existing, { controlled: await loadProcurementInventoryControl(env, { ...desktopInventoryScope(body), edition: 'school' }) });
  const write = inventoryConditionalWrite(collection, existing.__id, {}, existing);
  await batchCommitDocuments(env, [{ ...write, operation: 'delete' }], { literalDocumentIds: true });
  return { ok: true, message: `${label} inventory item deleted from the database.` };
}

async function recordStockMovement(env, body, collection, movementCollection, defaults) {
  const itemName = clean(body.ItemName || body.itemName);
  const movementType = clean(body.MovementType || body.movementType).toUpperCase();
  const quantity = inventoryQuantityNumber(body.Quantity || body.quantity);
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
  const rows = await desktopInventoryRows(env, body, collection, true);
  const existing = desktopInventoryMatch(rows, body, itemName);
  if (!existing) {
    const err = new Error('Inventory item not found. Create the item first.');
    err.status = 404;
    throw err;
  }
  const procurementControl = { controlled: await loadProcurementInventoryControl(env, { ...desktopInventoryScope(body), edition: 'school' }) };
  assertProcurementInventoryMovement(existing, movementType, procurementControl);
  const current = inventoryQuantityNumber(existing.Quantity);
  const nextQty = procurementMovementBalance(existing, movementType, quantity, procurementControl);
  if (nextQty < 0) throw Object.assign(new Error(`Only ${current} ${clean(existing.Unit) || 'units'} are currently available.`), { status: 409 });
  const itemPayload = {
    ...existing,
    Quantity: nextQty,
    LastUpdated: nowIso()
  };
  const movementNo = ledgerDocumentId(defaults.prefix);
  const movement = {
    BranchId: clean(existing.BranchId) || 'main',
    SchoolSection: clean(existing.SchoolSection) || 'Secondary', OrganisationEdition: 'school',
    InventoryId: existing.__id,
    MovementNo: movementNo,
    Date: nowIso(),
    ItemName: existing.ItemName || itemName,
    MovementType: movementType,
    Quantity: quantity,
    Reason: clean(body.Reason),
    RecordedBy: clean(body.RecordedBy) || defaults.actor
  };
  await batchCommitDocuments(env, [
    inventoryConditionalWrite(collection, existing.__id, itemPayload, existing),
    inventoryConditionalWrite(movementCollection, safeDocumentId(movementNo), movement)
  ], { literalDocumentIds: true });
  return { ok: true, message: `${defaults.label} stock movement recorded in the database.`, movement, item: normalizeInventory(itemPayload) };
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
  ['1080', 'Staff Imprest and Cash Advances', 'Asset', 'Current Assets', 'Debit'],
  ['1100', 'Student Accounts Receivable', 'Asset', 'Receivables', 'Debit'],
  ['1110', 'Trade and Other Receivables', 'Asset', 'Receivables', 'Debit'],
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
  ['4120', 'Organisation Store Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4130', 'Restaurant and Catering Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4140', 'Offering Income', 'Revenue', 'Church Revenue', 'Credit'],
  ['4150', 'Hotel Services Revenue', 'Revenue', 'Operating Revenue', 'Credit'],
  ['4160', 'Revenue Reductions and Refunds', 'Revenue', 'Contra Revenue', 'Debit'],
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

function accountingRevenueAccountForEdition(category, feeCode = '', edition = 'school') {
  const code = accountingAccountCodeForRevenue(category, feeCode);
  if (clean(edition).toLowerCase() === 'school') return code;
  return SCHOOL_ONLY_REVENUE_ACCOUNT_CODES.includes(code) ? '4090' : code;
}

export function accountingDestinationForPayment(row = {}, hasMatchingInvoice = false, edition = 'school') {
  const schoolEdition = clean(edition).toLowerCase() === 'school';
  if (isWalletLedger(row)) return schoolEdition ? '2200' : '2000';
  const metadata = parseMetadata(row && row.Metadata);
  const nested = metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
  const department = normalizeMatchText(row && row.Department);
  const storeType = normalizeMatchText(metadata.storeType || nested.storeType);
  const storeCart = Array.isArray(metadata.storeCart) ? metadata.storeCart : (Array.isArray(nested.storeCart) ? nested.storeCart : []);
  const cartHint = storeCart.some((item) => {
    return normalizeMatchText(item && item.StoreType) === 'store' ||
      normalizeMatchText(item && item.StoreType) === 'uniform store' ||
      normalizeMatchText(item && item.StoreType) === 'bookstore' ||
      normalizeMatchText(item && item.StoreType) === 'book store' ||
      normalizeMatchText(item && item.ItemName) === 'uniform store' ||
      normalizeMatchText(item && item.ItemName) === 'book store' ||
      normalizeMatchText(item && item.ItemName) === 'bookstore';
  });
  const storeHint = [
    normalizeMatchText(row && row.FeeCategory),
    normalizeMatchText(row && row.FeeCode),
    normalizeMatchText(row && row.FeeName),
    normalizeMatchText(row && row.EntryType),
    storeType,
    normalizeMatchText(row && row.StoreType),
    normalizeMatchText((metadata.metadata && metadata.metadata.StoreType) || nested.storeType)
  ].some((value) => value === 'store' || value === 'uniform store' || value === 'book store' || value === 'bookstore');

  if (storeHint || cartHint || isStorePurchase(row) ||
    (department === 'store' || department === 'uniform store' || department === 'bookstore' || department === 'book store')) return schoolEdition ? '4040' : '4120';
  if (schoolEdition && isAvailableSchoolCreditReceipt(row)) return '2310';
  if (hasMatchingInvoice) return schoolEdition ? '1100' : '1110';
  return accountingRevenueAccountForEdition(row.FeeCategory, row.FeeCode, edition);
}

export function accountingDestinationForWalletPurchase(row = {}) {
  const metadata = parseMetadata(row && row.Metadata);
  const nested = metadata && typeof metadata.metadata === 'object' ? metadata.metadata : {};
  const department = normalizeMatchText(
    (row && row.Department) || metadata.department || metadata.Department ||
    nested.department || nested.Department
  );
  const category = normalizeMatchText(row && row.FeeCategory);
  const code = clean(row && row.FeeCode).toUpperCase();
  const name = normalizeMatchText(row && row.FeeName);
  const metadataStoreType = normalizeMatchText(metadata.storeType || metadata.store_type || nested.storeType || nested.store_type);
  const hasStoreCart = Array.isArray(metadata.storeCart) || Array.isArray(nested.storeCart);
  const storeHint = [
    department,
    category,
    normalizeMatchText(code),
    name,
    metadataStoreType,
    normalizeMatchText(row && row.EntryType),
  ].some((value) => value === 'store' || value === 'tuck shop' || value === 'uniform store' || value === 'book store' || value === 'bookstore');

  if (storeHint || hasStoreCart || isStorePurchase(row)) return '4040';
  return accountingAccountCodeForRevenue(row.FeeCategory, row.FeeCode);
}

export function buildWalletPurchaseAccountingJournal(row = {}) {
  const sourceId = clean(row.LedgerNo || row.ledgerNo || row.__id);
  const amount = asMoneyNumber(row.Debit || row.debit || row.Amount || row.amount);
  if (!sourceId || amount <= 0 || !normalizeMatchText(row.EntryType || row.entryType).includes('wallet purchase')) return null;
  const journalNo = `SYS-WALLET-${safeDocumentId(sourceId)}`;
  const destination = accountingDestinationForWalletPurchase(row);
  const description = clean(row.Description || row.description) || 'Wallet purchase';
  const department = clean(row.Department || row.department || parseMetadata(row.Metadata || row.metadata).department);
  return normalizedJournal({
    JournalNo: journalNo,
    Date: row.Date || row.date || row.CreatedAt || row.createdAt || nowIso(),
    Status: 'Posted',
    Description: `Wallet purchase: ${description}`,
    Reference: clean(row.Reference || row.reference) || sourceId,
    Source: 'Wallet Purchase',
    SourceId: sourceId,
    RecordedBy: clean(row.RecordedBy || row.recordedBy) || 'System',
    AcademicSession: clean(row.AcademicSession || row.academicSession),
    Term: clean(row.Term || row.term),
    Department: department,
    BranchId: clean(row.BranchId || row.branchId || 'main').toLowerCase() || 'main',
    Lines: Array.isArray(row.VendorJournalLines) && row.VendorJournalLines.length ? row.VendorJournalLines : [
      { AccountCode: '2200', Debit: amount, Credit: 0, Description: clean(row.DisplayName || row.AccountRef) || 'Student wallet liability', Department: department },
      { AccountCode: destination, Debit: 0, Credit: amount, Description: description, Department: department }
    ],
    TotalDebit: amount,
    TotalCredit: amount,
    CreatedAt: row.CreatedAt || row.createdAt || row.Date || row.date || nowIso(),
    UpdatedAt: nowIso()
  });
}

async function writeWalletPurchaseAccountingJournal(env, row) {
  const journal = buildWalletPurchaseAccountingJournal(row);
  if (!journal) return null;
  await upsertDocument(env, 'accountingJournals', safeDocumentId(journal.JournalNo), journal);
  return journal;
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

function accountingCashAccountFor(method, gateway = '') {
  const text = `${clean(method)} ${clean(gateway)}`.toLowerCase();
  if (text.includes('cash')) return '1010';
  if (text.includes('paystack') || text.includes('online') || text.includes('gateway')) return '1030';
  return '1020';
}

async function listChurchDonationsForAccounting(env, options = {}) {
  const [organizationProfile, legacyProfile, structure] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null),
    getSchoolStructure(env).catch(() => ({ Branches: [{ Id: 'main' }] }))
  ]);
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
  if (!['church', 'faith', 'organization'].includes(organization.Edition) || !organization.FeatureFlags.donations) {
    return [];
  }
  const branchIds = [...new Set((structure.Branches || [{ Id: 'main' }])
    .map((branch) => clean(branch.Id || branch.id || branch.Name || branch.name).toLowerCase() || 'main'))]
    .filter((branch) => !options.branchId || options.branchId === 'all' || options.branchId === branch);
  const groups = await Promise.all(branchIds.map((branchId) =>
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId),
      options.readTime ? { query: `readTime=${encodeURIComponent(options.readTime)}` } : undefined)
      .catch((error) => { if (options.readTime) throw error; return []; })
  ));
  return groups.flatMap((rows, index) => rows.map((row) => ({
    ...row,
    BranchId: clean(row.BranchId || branchIds[index]) || 'main'
  })));
}

export function buildChurchDonationAccountingJournal(donation = {}, settlement = {}, givingType = {}) {
  const status = lower(settlement.Status || donation.Status || donation.PaymentStatus);
  const sourceId = clean(
    settlement.Reference || donation.Reference || donation.GatewayReference
      || donation.DonationId || donation.ReceiptNo || donation.__id
  );
  const originalGrossAmount = asMoneyNumber(
    settlement.GrossAmount || donation.GrossAmount || donation.Amount
  );
  if (status !== 'paid' && status !== 'completed') return null;
  if (!sourceId || originalGrossAmount <= 0) return null;

  const donationCurrency = normalizeCurrencyCode(
    donation.TransactionCurrency || donation.Currency,
    ACCOUNTING_BASE_CURRENCY
  );
  const settlementCurrencyText = clean(settlement.TransactionCurrency || settlement.Currency).toUpperCase();
  const transactionCurrency = normalizeCurrencyCode(settlementCurrencyText || donationCurrency, donationCurrency);
  if (settlementCurrencyText && transactionCurrency !== donationCurrency) {
    const error = new Error('The settled donation currency does not match the currency recorded when payment was initialized.');
    error.status = 409;
    throw error;
  }
  const baseCurrency = normalizeCurrencyCode(donation.BaseCurrency, ACCOUNTING_BASE_CURRENCY);
  if (baseCurrency !== ACCOUNTING_BASE_CURRENCY) {
    const error = new Error(`Accounting journals must be posted in ${ACCOUNTING_BASE_CURRENCY}.`);
    error.status = 409;
    throw error;
  }
  const storedBaseAmount = convertedDonationBaseAmount(donation, ACCOUNTING_BASE_CURRENCY);
  const exchangeRate = transactionCurrency === baseCurrency ? 1 : Number(donation.ExchangeRate);
  if (transactionCurrency !== baseCurrency && (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || storedBaseAmount === null)) {
    const error = new Error(`Enter and freeze the ${baseCurrency} exchange rate before posting this ${transactionCurrency} donation.`);
    error.status = 409;
    throw error;
  }
  const originalDonationAmount = asMoneyNumber(donation.Amount);
  const baseGrossAmount = transactionCurrency === baseCurrency
    ? originalGrossAmount
    : (Math.abs(originalGrossAmount - originalDonationAmount) <= 0.01
        ? storedBaseAmount
        : roundMoney(originalGrossAmount * exchangeRate));

  const method = clean(settlement.PaymentMethod || donation.PaymentMethod || donation.Method);
  const gateway = clean(settlement.Gateway || donation.Gateway);
  const normalizedMethod = lower(method);
  const normalizedGateway = lower(gateway);
  const online = normalizedMethod === 'online'
    || normalizedGateway.includes('online')
    || normalizedGateway.includes('paystack')
    || normalizedGateway.includes('gateway');
  const batchConversionFee = Math.max(0, asMoneyNumber(
    settlement.BaseConversionFee ?? donation.BaseConversionFee
  ));
  const suppliedFee = online
    ? Math.max(0, asMoneyNumber(settlement.GatewayFee ?? donation.GatewayFee))
    : batchConversionFee;
  const suppliedNet = online
    ? asMoneyNumber(settlement.NetAmount ?? donation.NetAmount)
    : batchConversionFee > 0
      ? asMoneyNumber(settlement.BaseNetAmount ?? donation.BaseNetAmount)
      : originalGrossAmount;
  const originalNetAmount = Math.min(originalGrossAmount, suppliedNet > 0 ? suppliedNet : Math.max(0, originalGrossAmount - suppliedFee));
  const originalGatewayFee = Math.max(0, asMoneyNumber(originalGrossAmount - originalNetAmount));
  const baseNetAmount = batchConversionFee > 0
    ? Math.max(0, asMoneyNumber(settlement.BaseNetAmount ?? donation.BaseNetAmount ?? (baseGrossAmount - batchConversionFee)))
    : transactionCurrency === baseCurrency
    ? originalNetAmount
    : roundMoney(originalNetAmount * exchangeRate);
  const baseGatewayFee = batchConversionFee > 0
    ? batchConversionFee
    : Math.max(0, asMoneyNumber(baseGrossAmount - baseNetAmount));
  const branchId = clean(donation.BranchId || settlement.BranchId || 'main').toLowerCase() || 'main';
  const description = clean(donation.PaymentType || settlement.PaymentType || 'Donation');
  const revenueAccountCode = clean(
    givingType.RevenueAccountCode ||
    donation.RevenueAccountCode ||
    settlement.RevenueAccountCode ||
    '4080'
  );
  const journalNo = `SYS-DON-${safeDocumentId(sourceId)}`;
  const lines = [
    {
      AccountCode: online ? '1030' : accountingCashAccountFor(method, gateway),
      Debit: baseNetAmount,
      Credit: 0,
      Description: online ? 'Online donation net settlement' : `${method || 'Donation'} received`,
      Department: 'Donations',
      CostCentre: branchId
    }
  ];
  if (baseGatewayFee > 0) {
    lines.push({
      AccountCode: '6060',
      Debit: baseGatewayFee,
      Credit: 0,
      Description: batchConversionFee > 0 ? 'Foreign-currency conversion charge' : 'Donation payment processing charge',
      Department: 'Donations',
      CostCentre: branchId
    });
  }
  lines.push({
    AccountCode: revenueAccountCode,
    Debit: 0,
    Credit: baseGrossAmount,
    Description: `${description} income`,
    Department: 'Donations',
    CostCentre: branchId
  });

  return normalizedJournal({
    JournalNo: journalNo,
    Date: clean(donation.PaidAt || settlement.PaidAt || donation.Date || donation.CreatedAt || nowIso()).slice(0, 10),
    Status: 'Posted',
    Description: `Donation receipt: ${clean(donation.DonorName || 'Donor')}`,
    Reference: sourceId,
    Source: 'Church Donation',
    SourceId: sourceId,
    GivingTypeId: clean(
      givingType.GivingTypeId || donation.GivingTypeId || settlement.GivingTypeId
    ),
    GivingTypeName: clean(
      givingType.Name || donation.GivingTypeName || description
    ),
    RevenueAccountCode: revenueAccountCode,
    PaymentMethod: method || (online ? 'ONLINE' : ''),
    Gateway: gateway,
    Currency: baseCurrency,
    TransactionCurrency: transactionCurrency,
    OriginalCurrency: transactionCurrency,
    OriginalAmount: originalGrossAmount,
    OriginalGrossAmount: originalGrossAmount,
    OriginalNetAmount: originalNetAmount,
    OriginalGatewayFee: originalGatewayFee,
    BaseCurrency: baseCurrency,
    BaseAmount: baseGrossAmount,
    ExchangeRate: exchangeRate,
    ExchangeRateDate: clean(donation.ExchangeRateDate || settlement.ExchangeRateDate),
    ExchangeRateSource: clean(donation.ExchangeRateSource || settlement.ExchangeRateSource) || (transactionCurrency === baseCurrency ? 'Base currency' : ''),
    ConversionStatus: 'Converted',
    Department: 'Donations',
    CostCentre: branchId,
    RecordedBy: clean(donation.UpdatedBy || settlement.RecordedBy || 'System'),
    Lines: lines,
    TotalDebit: baseGrossAmount,
    TotalCredit: baseGrossAmount,
    CreatedAt: clean(donation.PaidAt || donation.UpdatedAt || donation.CreatedAt || nowIso()),
    UpdatedAt: nowIso(),
    System: 'YES'
  });
}

export async function postChurchDonationToAccounting(env, donation = {}, settlement = {}) {
  const branchId = clean(donation.BranchId || settlement.BranchId || 'main').toLowerCase() || 'main';
  const { givingTypes } = await ensureGivingTypes(env, branchId);
  const givingType = resolveGivingType(
    givingTypes,
    donation.GivingTypeId || settlement.GivingTypeId || donation.PaymentType || settlement.PaymentType
  );
  const journal = buildChurchDonationAccountingJournal(donation, settlement, givingType || {});
  if (!journal) return null;
  await seedAccountingChart(env);
  return saveAccountingJournal(env, journal, true);
}

async function seedAccountingChart(env) {
  const existing = await getAccountingChartRows(env);
  const codes = new Set(existing.map((row) => clean(row.Code || row.code || row.__id)));
  const additions = [];
  for (const [Code, Name, Type, Group, NormalBalance] of DEFAULT_CHART_OF_ACCOUNTS) {
    if (codes.has(Code)) continue;
    additions.push({
      Code, Name, Type, Group, NormalBalance, Active: 'YES', System: 'YES',
      CreatedAt: nowIso(), UpdatedAt: nowIso()
    });
  }
  if (additions.length) {
    await batchUpsertDocuments(env, additions.map((row) => ({
      collectionPath: 'chartOfAccounts',
      documentId: row.Code,
      data: row
    })));
    primeAccountingChartRows(env, [...existing, ...additions]);
  }
  return additions.length;
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
    Debit: financeMoney(line.Debit ?? line.debit, 'Journal debit', { defaultValue: 0 }),
    Credit: financeMoney(line.Credit ?? line.credit, 'Journal credit', { defaultValue: 0 })
  }));
  return { ...payload, Lines: lines };
}

function accountingAuditWrite(action, entityType, entityId, body, details = '', timestamp = nowIso()) {
  const auditId = ledgerDocumentId('AUD');
  return { collectionPath: 'accountingAudit', documentId: safeDocumentId(auditId), data: {
    AuditId: auditId,
    Timestamp: timestamp,
    Action: explicitAuditAction(action, entityType),
    EntityType: clean(entityType),
    EntityId: clean(entityId),
    UserRole: clean(body.UserAssignedRole || body.UserRole || body.userRole),
    ActorUsername: clean(body.UserUsername || body.userUsername),
    UserName: clean(body.RecordedBy || body.UpdatedBy || body.UserName || body.userName),
    BranchId: accountingWriteBranch(body),
    Details: clean(details),
    SourcePlatform: 'Desktop'
  } };
}

async function writeAccountingAudit(env, action, entityType, entityId, body, details = '') {
  const write = accountingAuditWrite(action, entityType, entityId, body, details);
  await upsertDocument(env, write.collectionPath, write.documentId, write.data);
}

export async function saveAccountingJournal(env, body, system = false, options = {}) {
  const reversalOf = clean(body.ReversalOf);
  if (!system && (reversalOf || lower(body.Source) === 'journal reversal')) {
    if (!reversalOf) throw financeFailure('Select the original posted journal before reversing it.');
    const original = await getDocumentByIdOrField(env, 'accountingJournals', reversalOf, 'JournalNo');
    if (!original || lower(original.Status) !== 'posted') throw financeFailure('Only a posted journal can be reversed.', 409);
    if (original.PaymentCorrectionTotal || ['Manual Payment Correction', 'Student Payment Correction Credit Release'].includes(original.Source)
      || (original.Source === 'Fee Payment' && accountingLines(original.Lines).some(line => ['2200', '2310'].includes(line.AccountCode)))) {
      throw financeFailure('Use Accounts → Correct manual payment so the receipt, wallet and invoice balances stay in sync. Do not reverse this journal on its own.', 409);
    }
    const branch = accountingWriteBranch(body, original);
    const canonicalId = await financeOperationId('REV', branch, original.JournalNo);
    // Older clients created a random journal ID with only Reference=REV-<original>.
    // Claiming a new canonical ID must not reverse that same original a second time.
    const priorReversals = await Promise.all([
      [{ field: 'ReversalOf', op: '==', value: original.JournalNo }],
      [{ field: 'Source', op: '==', value: 'Journal Reversal' }, { field: 'SourceId', op: '==', value: original.JournalNo }],
      [{ field: 'Source', op: '==', value: 'Journal Reversal' }, { field: 'Reference', op: 'in', value: [`REV-${original.JournalNo}`, original.JournalNo] }]
    ].map(filters => queryCollection(env, 'accountingJournals', { filters, limit: 21 })));
    if (priorReversals.some(rows => rows.length > 20)) throw financeFailure('This journal has ambiguous historical reversal references. Accounts must review them before posting.', 409);
    const previousReversal = accountingRowsForBranch(priorReversals.flat(), branch)
      .find(row => lower(row.Status) === 'posted' && clean(row.JournalNo || row.__id) !== canonicalId);
    if (previousReversal) throw financeFailure(`This journal was already reversed by ${clean(previousReversal.JournalNo || previousReversal.__id)}. Accounts must review the existing reversal.`, 409);
    body = { ...body, JournalNo: canonicalId,
      Source: 'Journal Reversal', SourceId: original.JournalNo, ReversalOf: original.JournalNo,
      BranchId: branch, Status: 'Posted', Reference: original.JournalNo,
      Lines: accountingLines(original.Lines).map(line => ({ ...line, Debit: line.Credit, Credit: line.Debit })) };
  }
  const existingId = clean(body.JournalNo || body.journalNo);
  const journalNo = existingId || ledgerDocumentId(system ? 'SYS' : 'JRN');
  const existing = await getDocumentByIdOrField(env, 'accountingJournals', journalNo, 'JournalNo') || {};
  const branchId = accountingWriteBranch(body, existing);
  if (clean(body.RecordVersion) && clean(body.RecordVersion) !== clean(existing.__updateTime)) throw financeFailure('This journal changed. Refresh it before saving.', 409, 'FINANCE_WRITE_CONFLICT');
  if (lower(existing.Status) === 'posted' && !system && !options.replayPosted && !reversalOf) {
    const err = new Error('Posted journals are immutable. Create a reversal journal instead.');
    err.status = 409;
    throw err;
  }
  const status = clean(body.Status || body.status || 'Draft');
  if (!['draft', 'posted'].includes(lower(status))) throw financeFailure('Choose Draft or Posted journal status.');
  const date = financeDate(clean(body.Date || body.date) || nowIso().slice(0, 10), 'Journal date', { allowTimestamp: system });
  const payload = normalizedJournal({
    ...existing,
    JournalNo: journalNo,
    Date: date,
    Description: clean(body.Description || body.description),
    Reference: clean(body.Reference || body.reference),
    Source: clean(body.Source || body.source) || (system ? 'System' : 'Manual Journal'),
    SourceId: clean(body.SourceId || body.sourceId),
    ReversalOf: clean(body.ReversalOf || existing.ReversalOf),
    GivingTypeId: clean(body.GivingTypeId || body.givingTypeId || existing.GivingTypeId),
    GivingTypeName: clean(body.GivingTypeName || body.givingTypeName || existing.GivingTypeName),
    RevenueAccountCode: clean(body.RevenueAccountCode || body.revenueAccountCode || existing.RevenueAccountCode),
    PaymentMethod: clean(body.PaymentMethod || body.paymentMethod || body.Method || body.method || existing.PaymentMethod),
    Gateway: clean(body.Gateway || body.gateway || existing.Gateway),
    Currency: clean(body.Currency || body.currency || existing.Currency).toUpperCase(),
    TransactionCurrency: clean(body.TransactionCurrency || body.transactionCurrency || existing.TransactionCurrency).toUpperCase(),
    OriginalCurrency: clean(body.OriginalCurrency || body.originalCurrency || existing.OriginalCurrency).toUpperCase(),
    OriginalAmount: asMoneyNumber(body.OriginalAmount ?? body.originalAmount ?? existing.OriginalAmount),
    OriginalGrossAmount: asMoneyNumber(body.OriginalGrossAmount ?? body.originalGrossAmount ?? existing.OriginalGrossAmount),
    OriginalNetAmount: asMoneyNumber(body.OriginalNetAmount ?? body.originalNetAmount ?? existing.OriginalNetAmount),
    OriginalGatewayFee: asMoneyNumber(body.OriginalGatewayFee ?? body.originalGatewayFee ?? existing.OriginalGatewayFee),
    BaseCurrency: clean(body.BaseCurrency || body.baseCurrency || existing.BaseCurrency).toUpperCase(),
    BaseAmount: asMoneyNumber(body.BaseAmount ?? body.baseAmount ?? existing.BaseAmount),
    ExchangeRate: Number(body.ExchangeRate ?? body.exchangeRate ?? existing.ExchangeRate) || 0,
    ExchangeRateDate: clean(body.ExchangeRateDate || body.exchangeRateDate || existing.ExchangeRateDate),
    ExchangeRateSource: clean(body.ExchangeRateSource || body.exchangeRateSource || existing.ExchangeRateSource),
    ConversionStatus: clean(body.ConversionStatus || body.conversionStatus || existing.ConversionStatus),
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
  payload.BranchId = branchId;
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
  if (lower(existing.Status) === 'posted') {
    if (lower(status) !== 'posted' || journalFinancialSignature(existing) !== journalFinancialSignature(payload)) {
      throw financeFailure('Posted journals are immutable. Review this operation or create a reversal.', 409, 'FINANCE_POSTED_CONFLICT');
    }
    return options.prepareOnly ? { payload: existing, existing } : existing;
  }
  if (lower(status) === 'posted' && await accountingPeriodIsClosed(env, date)) throw financeFailure('This accounting period is closed.', 409);
  let chartRows = await getAccountingChartRows(env);
  if (!chartRows.length) {
    await seedAccountingChart(env);
    chartRows = await getAccountingChartRows(env);
  }
  const edition = accountingEditionForRequest(env, body);
  const activeCodes = new Set(accountingChartForEdition(chartRows, edition)
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
  if (options.prepareOnly) return { payload, existing };
  await batchCommitLiteralDocuments(env, [
    financeWrite('accountingJournals', safeDocumentId(journalNo), payload, existing),
    ...(!system ? [accountingAuditWrite(existingId ? 'UPDATE' : 'CREATE', 'Journal', journalNo, body, status)] : [])
  ]);
  return payload;
}

async function syncRevenueToAccounting(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const scope = { edition: accountingEditionForRequest(env, body), branchId: accountingRequestBranch(body),
    actor: lower(body.UserUsername) };
  return continueRevenueSync(env, body, scope, {
    prepare: async () => {
      await seedAccountingChart(env);
      const targets = [
        { stage: 'invoices', collection: 'invoices' }, { stage: 'payments', collection: 'payments' },
        ...(scope.edition === 'school' ? [{ stage: 'invoiceCredits', collection: 'invoices' }] : []),
        { stage: 'ledger', collection: 'ledger' },
        { stage: 'forms', collection: 'formSales' }
      ];
      if (scope.edition !== 'school') {
        const [organizationProfile, legacyProfile, structure] = await Promise.all([
          getDocument(env, 'settings', 'organisationProfile'), getDocument(env, 'settings', 'schoolProfile'), getSchoolStructure(env)
        ]);
        const config = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
        if (config.FeatureFlags.donations && ['church', 'faith', 'organization'].includes(config.Edition)) {
          for (const branch of structure.Branches || [{ Id: 'main' }]) {
            const branchId = lower(branch.Id || branch.id || 'main');
            if (scope.branchId !== 'all' && scope.branchId !== branchId) continue;
            targets.push({ stage: 'donations', branchId, collection: churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId) });
          }
        }
      }
      return targets;
    },
    preparePage: async (target, rows) => {
      return prepareRevenueSyncPage(env, target, rows);
    },
    planRow: (target, row, currentScope, prepared) => planRevenueSyncRow(env, target, row, currentScope, prepared)
  });
}

export async function prepareRevenueSyncPage(env, target, rows, options = {}) {
  const found = new Map();
  found.reader = revenueSyncReader({ getDocument, queryCollection, listCollection, ...options });
  if (!['invoices', 'invoiceCredits', 'ledger'].includes(target.stage)) return found;
  const creditStage = target.stage === 'invoiceCredits';
  const ids = [...new Set(rows.map(row => creditStage
    ? (isSchoolFeeInvoice(row) ? clean(row.InvoiceId || row.__id) : '')
    : target.stage === 'ledger'
      ? buildWalletPurchaseAccountingJournal(row)?.JournalNo
      : `SYS-INV-${safeDocumentId(row.InvoiceId || row.InvoiceNo || row.invoiceId || row.__id)}`).filter(Boolean))];
  found.creditJournals = new Map();
  for (let start = 0; start < ids.length; start += 10) {
    const group = ids.slice(start, start + 10);
    const journals = await found.reader.db.queryCollection(env, 'accountingJournals', {
      filters: [{ field: creditStage ? 'SourceId' : 'JournalNo', op: 'in', value: group }],
      limit: creditStage ? 201 : group.length + 1
    });
    if (creditStage) {
      // A full group may hide dependencies. Fall back to the original bounded
      // per-invoice check instead of treating a truncated group as complete.
      if (journals.length >= 201) continue;
      for (const id of group) found.creditJournals.set(id, journals.filter(row => sameText(row.SourceId, id)));
    } else {
      if (journals.length > group.length) throw accountingSyncConflict('Duplicate source journals require finance review.');
      for (const journal of journals) {
        if (found.has(journal.JournalNo)) throw accountingSyncConflict('Duplicate source journals require finance review.');
        found.set(journal.JournalNo, journal);
      }
    }
  }
  return found;
}

function accountingSyncConflict(message) {
  return Object.assign(new Error(message), { status: 409 });
}

// Only indexed, source-related slices are loaded. Hitting a dependency bound
// stops this record before its atomic commit; missing rows are never assumed.
export async function accountingSyncRelated(env, collection, fields, values, query = queryCollection) {
  const wanted = [...new Set(values.map(clean).filter(Boolean))];
  if (!wanted.length) return [];
  if (wanted.length > 30) throw accountingSyncConflict('Too many financial reference aliases; finance review is required.');
  const found = new Map();
  const groups = await Promise.all(fields.map(field =>
    query(env, collection, { filters: [{ field, op: 'in', value: wanted }], limit: 201 })));
  for (const rows of groups) {
    if (rows.length >= 201) throw accountingSyncConflict(`Too many related ${collection} records for one source; finance review is required. No partial reconciliation was posted.`);
    for (const row of rows) found.set(row.__name || row.__id, row);
    if (found.size > 200) throw accountingSyncConflict(`Too many related ${collection} records for one source; finance review is required. No partial reconciliation was posted.`);
  }
  return [...found.values()];
}

export async function planRevenueSyncRow(env, target, raw, scope, prepared = new Map(), options = {}) {
  const db = { getDocument, listCollection, queryCollection, ...prepared?.reader?.db, ...options };
  const related = (collection, fields, values) => accountingSyncRelated(env, collection, fields, values, db.queryCollection);
  const stage = target.stage;
  if (stage === 'invoiceCredits' && scope.edition !== 'school') return { writes: [] };
  // These source types cannot produce a posting in their respective stages.
  // Do not perform remote point/dependency reads for every irrelevant row.
  if (stage === 'invoiceCredits' && !isSchoolFeeInvoice(raw)) return { writes: [] };
  if (stage === 'ledger' && !buildWalletPurchaseAccountingJournal(raw)) return { writes: [] };
  const branch = lower(raw.BranchId || raw.branchId || target.branchId || 'main');
  if (scope.branchId !== 'all' && scope.branchId !== branch) throw accountingSyncConflict('A source moved to another branch. Start a new synchronization pass.');
  const invoiceId = clean(raw.InvoiceId || raw.InvoiceNo || raw.invoiceId || raw.__id);
  if (stage === 'invoiceCredits' && prepared.creditJournals?.has(invoiceId)) {
    const gap = schoolInvoiceCreditJournalGap(raw, accountingRowsForBranch(prepared.creditJournals.get(invoiceId), branch));
    if (gap.invalidPostedJournalIds?.length || gap.missing < -0.005 || (gap.missing > 0.005 && gap.baselineExists)) {
      throw accountingSyncConflict(`Invoice ${invoiceId} has an unreconciled parent-credit application; finance review is required.`);
    }
    if (gap.missing <= 0.005) return { writes: [] };
    // A missing posting still uses a fresh source and dependency read below.
  }
  if (stage === 'ledger') {
    const journal = buildWalletPurchaseAccountingJournal(raw);
    const prior = prepared.get(journal.JournalNo);
    if (prior && sameText(prior.BranchId || prior.branchId || 'main', branch) &&
        lower(prior.Status) === 'posted' && journalLineSignature(prior.Lines) === journalLineSignature(journal.Lines) &&
        sameText(prior.Reference, journal.Reference) && sameText(prior.SourceId, journal.SourceId)) return { writes: [] };
  }
  const invoicePrior = stage === 'invoices' ? prepared.get(`SYS-INV-${safeDocumentId(invoiceId)}`) : null;
  if (invoicePrior) {
    if (lower(invoicePrior.Status) !== 'posted' || !sameText(invoicePrior.SourceId, invoiceId) ||
        !sameText(invoicePrior.BranchId || invoicePrior.branchId || 'main', raw.BranchId || raw.branchId || 'main') ||
        Math.abs(asMoneyNumber(invoicePrior.TotalDebit || invoicePrior.Lines?.reduce((sum, line) => sum + asMoneyNumber(line.Debit), 0)) - asMoneyNumber(raw.Amount || raw.amount)) > 0.005) {
      throw accountingSyncConflict(`Invoice ${invoiceId} has a conflicting journal; finance review is required.`);
    }
    return { writes: [] };
  }
  const row = await db.getDocument(env, target.collection, raw.__id);
  if (!row) throw accountingSyncConflict('A synchronization source was deleted. Start a new synchronization pass.');
  const branchId = lower(row.BranchId || row.branchId || target.branchId || 'main');
  if (scope.branchId !== 'all' && scope.branchId !== branchId) throw accountingSyncConflict('A source moved to another branch. Start a new synchronization pass.');
  row.BranchId = branchId;
  const writes = new Map();
  const write = async (collection, id, data, prior) => {
    const current = prior === undefined ? await db.getDocument(env, collection, id) : prior;
    if (current && lower(current.BranchId || current.branchId || 'main') !== branchId) throw accountingSyncConflict('A related financial record belongs to another branch.');
    writes.set(`${collection}/${id}`, revenueSyncWrite(collection, id, { ...data, BranchId: data.BranchId || branchId }, current));
  };
  const saveJournal = async journal => {
    const { payload, existing } = await (options.prepareJournal || saveAccountingJournal)(env, { ...journal, BranchId: branchId, OrganisationEdition: scope.edition }, true, { prepareOnly: true });
    if (lower(existing.Status) === 'posted') throw accountingSyncConflict(`Posted journal ${journal.JournalNo} differs from source data; finance review is required. Use an approved correction, not an overwrite.`);
    await write('accountingJournals', clean(existing.__id) || safeDocumentId(journal.JournalNo), payload, existing.__id ? existing : null);
  };
  const sources = { edition: scope.edition };
  const scoped = rows => accountingRowsForBranch(rows, branchId);
  const scopedCharge = charge => {
    if (charge && !scoped([charge]).length) throw accountingSyncConflict('A related gateway charge belongs to another branch.');
    return charge ? [charge] : [];
  };
  if (stage === 'invoices') sources.invoices = [row];
  else if (stage === 'invoiceCredits') {
    sources.creditInvoices = [row];
    sources.journals = scoped(await related('accountingJournals', ['SourceId'], [row.InvoiceId || row.__id]));
  } else if (stage === 'payments') {
    sources.payments = [row];
    const payment = normalizePayment(row);
    const refs = [payment.Reference, payment.GatewayReference, payment.PaymentId, row.PaymentNo, row.__id].map(clean).filter(Boolean);
    const accounts = [...new Set(accountRefsFrom(payment).flatMap(value => [value, value.toUpperCase(), value.toLowerCase(), value.replace(/[^a-z0-9]+/gi, '_'), value.replace(/[^a-z0-9]+/gi, '-'), value.replace(/[^a-z0-9]+/gi, '/')]))];
    const [invoices, journals, ledger, expenses, charge] = await Promise.all([
      related('invoices', ['AccountRef', 'AdmissionNo', 'ApplicationReference', 'ApplicationID', 'AdmissionNumber'], accounts),
      related('accountingJournals', ['Reference', 'SourceId', 'JournalNo'], [...refs, ...refs.map(ref => `SYS-PAY-${safeDocumentId(ref)}`)]),
      related('ledger', ['Reference'], refs),
      related('accountingExpenses', ['Reference'], refs),
      db.getDocument(env, 'paymentGatewayCharges', safeDocumentId(`PAYSTACK-FEE-${payment.Reference || refs[0]}`))
    ]);
    // Dependencies are checked in full; they are never invoice posting sources.
    sources.dependencyInvoices = scoped(invoices);
    sources.journals = scoped(journals);
    sources.dependencyLedgerRows = scoped(ledger);
    sources.legacyGatewayExpenses = scoped(expenses);
    sources.gatewayCharges = scopedCharge(charge);
  } else if (stage === 'ledger') {
    sources.ledgerRows = [row];
    const journal = buildWalletPurchaseAccountingJournal(row);
    sources.journals = journal ? scoped(await related('accountingJournals', ['JournalNo'], [journal.JournalNo])) : [];
  } else if (stage === 'forms') {
    sources.sales = [row];
    sources.admissionClasses = await db.listCollection(env, 'settings/admission/classes');
    const sourceId = clean(row.ReceiptNo || row.receiptNo || row.__id);
    sources.journals = scoped(await related('accountingJournals', ['JournalNo'], [`SYS-FORM-${safeDocumentId(sourceId)}`]));
    const charge = await db.getDocument(env, 'paymentGatewayCharges', safeDocumentId(`PAYSTACK-FORM-FEE-${row.PaymentReference || sourceId}`));
    sources.gatewayCharges = scopedCharge(charge);
  } else if (stage === 'donations') {
    sources.churchDonations = [row];
    sources.givingTypes = await db.listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.givingTypes, branchId));
    const journal = buildChurchDonationAccountingJournal(row, {}, resolveGivingType(sources.givingTypes, row.GivingTypeId || row.PaymentType) || {});
    sources.journals = journal ? scoped(await related('accountingJournals', ['JournalNo'], [journal.JournalNo])) : [];
  }
  const changes = await syncRevenueRows(env, sources, {
    saveJournal, write, givingTypes: sources.givingTypes,
    remove: async (collection, id, current) => {
      const planned = revenueSyncWrite(collection, id, null, current);
      delete planned.data; planned.operation = 'delete'; writes.set(`${collection}/${id}`, planned);
    },
    createReclassification: journal => (options.createReclassification || createSchoolPaymentReclassificationIfAbsent)(env, journal, null, {
      prepareWrite: planned => write('accountingJournals', safeDocumentId(planned.JournalNo), planned, null)
    })
  });
  // Fence the source version alongside its accounting writes. This metadata
  // patch does not rewrite historical amounts, receipts or student balances.
  if (writes.size && !writes.has(`${target.collection}/${row.__id}`)) {
    writes.set(`${target.collection}/${row.__id}`, { ...revenueSyncWrite(target.collection, row.__id,
      { AccountingSyncCheckedAt: nowIso() }, row), updateMask: ['AccountingSyncCheckedAt'] });
  }
  return { writes: [...writes.values()], changes, expensive: true };
}

async function syncRevenueRows(env, sources, io) {
  const { edition, invoices = [], payments = [], sales = [], journals = [], ledgerRows = [], legacyGatewayExpenses = [],
    gatewayCharges = [], admissionClasses = [], churchDonations = [], creditInvoices = [], dependencyInvoices = [], dependencyLedgerRows = [] } = sources;
  const { saveJournal, write, remove, createReclassification, givingTypes } = io;
  const existing = new Set(journals.map((row) => clean(row.JournalNo || row.__id)));
  const journalsByNo = new Map(journals.map((row) => [clean(row.JournalNo || row.__id), row]));
  const givingTypesByBranch = new Map();
  let created = 0;
  for (const donation of churchDonations) {
    const branchId = clean(donation.BranchId || 'main').toLowerCase() || 'main';
    if (!givingTypesByBranch.has(branchId)) {
      givingTypesByBranch.set(branchId, givingTypes || []);
    }
    const givingType = resolveGivingType(
      givingTypesByBranch.get(branchId),
      donation.GivingTypeId || donation.PaymentType
    );
    const journal = buildChurchDonationAccountingJournal(donation, {}, givingType || {});
    if (!journal) continue;
    const prior = journalsByNo.get(journal.JournalNo);
    if (prior && lower(prior.Status) === 'posted' && journalLineSignature(prior.Lines) === journalLineSignature(journal.Lines) &&
      sameText(prior.Reference, journal.Reference) && sameText(prior.SourceId, journal.SourceId)) continue;
    await saveJournal(journal);
    existing.add(journal.JournalNo);
    journalsByNo.set(journal.JournalNo, journal);
    created += 1;
  }
  for (const row of invoices) {
    const sourceId = clean(row.InvoiceId || row.InvoiceNo || row.invoiceId || row.__id);
    const journalNo = `SYS-INV-${safeDocumentId(sourceId)}`;
    const amount = asMoneyNumber(row.Amount || row.amount);
    if (!sourceId || amount <= 0 || existing.has(journalNo)) continue;
    const revenue = accountingRevenueAccountForEdition(row.FeeCategory || row.feeCategory, row.FeeCode || row.feeCode, edition);
    await saveJournal({
      JournalNo: journalNo, Date: row.CreatedAt || row.Date || nowIso(), Status: 'Posted',
      Description: `Invoice: ${clean(row.FeeName || row.Description || sourceId)}`,
      Reference: sourceId, Source: 'Student Invoice', SourceId: sourceId,
      BranchId: row.BranchId || 'main', AcademicSession: row.AcademicSession || '', Term: row.Term || '', RecordedBy: 'System',
      Lines: [
        { AccountCode: edition === 'school' ? '1100' : '1110', Debit: amount, Credit: 0, Description: clean(row.AccountRef || row.DisplayName) },
        { AccountCode: revenue, Debit: 0, Credit: amount, Description: clean(row.FeeName || row.FeeCategory) }
      ]
    });
    existing.add(journalNo); created += 1;
  }
  for (const row of payments) {
    const payment = normalizePayment(row);
    const sourceId = clean(payment.Reference || payment.GatewayReference || payment.PaymentId || row.PaymentNo || row.__id);
    const journalNo = `SYS-PAY-${safeDocumentId(sourceId)}`;
    const amount = paymentCreditedAmount(payment);
    if (!sourceId || amount <= 0) continue;
    const paymentReferences = [
      payment.Reference, payment.GatewayReference, payment.PaymentId,
      row.PaymentNo, row.__id
    ].map(clean).filter(Boolean);
    const legacyLedger = dependencyLedgerRows.find((entry) => asMoneyNumber(entry.Credit) > 0 && paymentReferences.some((reference) => sameText(entry.Reference, reference)));
    if (legacyLedger && (Math.abs(asMoneyNumber(legacyLedger.Credit) - amount) > 0.005 ||
      !sameText(legacyLedger.AcademicSession, payment.AcademicSession) || !sameText(legacyLedger.Term, payment.Term))) {
      const repairedLedger = { ...legacyLedger, Credit: amount, AcademicSession: payment.AcademicSession, Term: payment.Term,
        CalculationRepair: 'Net payment credit and exact financial period', CalculationRepairedAt: nowIso() };
      delete repairedLedger.__id; delete repairedLedger.__name;
      await write('ledger', legacyLedger.__id || safeDocumentId(legacyLedger.LedgerNo), repairedLedger, legacyLedger);
      created += 1;
    }
    if (payment.GatewayFee > 0) {
      const chargeId = safeDocumentId(`PAYSTACK-FEE-${payment.Reference || sourceId}`);
      const existingCharge = gatewayCharges.find((charge) => sameText(charge.ChargeId || charge.__id, chargeId));
      if (!existingCharge || Math.abs(asMoneyNumber(existingCharge.Amount) - payment.GatewayFee) > 0.005 ||
        Math.abs(asMoneyNumber(existingCharge.NetSettlement) - amount) > 0.005 || lower(existingCharge.Treatment) !== 'deductedbeforestudentcredit') {
        await write('paymentGatewayCharges', chargeId, {
          ChargeId: chargeId, Date: row.PaidAt || row.PaymentDate || row.Date || nowIso(),
          Description: `Paystack transaction charge - ${payment.Reference || sourceId}`,
          Amount: payment.GatewayFee, GrossCollection: payment.GrossAmount, NetSettlement: amount,
          Treatment: 'DeductedBeforeStudentCredit', Status: 'Recorded', Reference: payment.Reference || sourceId,
          Source: 'Paystack', CreatedAt: existingCharge?.CreatedAt || nowIso(), UpdatedAt: nowIso()
        }, existingCharge);
        created += 1;
      }
      const oldExpense = legacyGatewayExpenses.find((expense) => sameText(expense.Reference, payment.Reference) && lower(expense.Source).includes('paystack'));
      if (oldExpense && ['posted', 'paid'].includes(lower(oldExpense.Status))) {
        const reclassified = { ...oldExpense, Status: 'Reclassified', Treatment: 'DeductedBeforeStudentCredit',
          ReclassifiedAt: nowIso(), ReclassificationNote: 'Parent account is credited with the Paystack net settlement; this charge is retained for audit only.' };
        delete reclassified.__id; delete reclassified.__name;
        await write('accountingExpenses', oldExpense.__id || safeDocumentId(oldExpense.ExpenseNo), reclassified, oldExpense);
        created += 1;
      }
    }
    const receiptJournal = buildPaymentAccountingJournal({
      ...payment, Reference: sourceId, Method: row.Method || row.PaymentMethod || payment.Method,
      PaidAt: row.PaidAt || row.PaymentDate || row.Date,
      BranchId: row.BranchId || payment.BranchId
    }, paymentHasMatchingInvoice(payment, dependencyInvoices), edition);
    const lines = receiptJournal.Lines;
    const relatedJournals = journals.filter((journal) => lower(journal.Source) === 'fee payment' && (
      clean(journal.JournalNo || journal.__id) === journalNo ||
      paymentReferences.some((reference) =>
        sameText(journal.Reference, reference) || sameText(journal.SourceId, reference) ||
        clean(journal.JournalNo || journal.__id) === `SYS-PAY-${safeDocumentId(reference)}`
      )
    ));
    for (const duplicate of relatedJournals) {
      const duplicateNo = clean(duplicate.JournalNo || duplicate.__id);
      if (duplicateNo === journalNo) continue;
      if (lower(duplicate.Status) === 'posted') {
        const err = new Error(`Duplicate posted receipt ${duplicateNo} requires finance review before reconciliation.`);
        err.status = 409;
        throw err;
      }
      await remove('accountingJournals', clean(duplicate.__id) || safeDocumentId(duplicateNo), duplicate);
      existing.delete(duplicateNo);
      journalsByNo.delete(duplicateNo);
      created += 1;
    }
    const prior = relatedJournals.find((journal) => clean(journal.JournalNo || journal.__id) === journalNo) ||
      journalsByNo.get(journalNo);
    if (edition === 'school' && isAvailableSchoolCreditReceipt(payment) && prior) {
      if (lower(prior.Status) !== 'posted' || !sameText(prior.Reference, sourceId) ||
        !sameText(prior.SourceId, sourceId)) {
        const err = new Error(`Receipt ${sourceId} has a non-posted or mismatched journal; finance review is required.`);
        err.status = 409;
        throw err;
      }
      if (journalLineSignature(prior.Lines) !== journalLineSignature(lines)) {
        const reclassification = buildSchoolPaymentReclassificationJournal(payment, prior);
        if (!reclassification) {
          const err = new Error(`Receipt ${sourceId} has irregular posted lines; finance review is required.`);
          err.status = 409;
          throw err;
        }
        if (await createReclassification(reclassification)) created += 1;
      } else if (!sameText(prior.Date, receiptJournal.Date) || !sameText(prior.BranchId, receiptJournal.BranchId) ||
        !sameText(prior.AcademicSession, receiptJournal.AcademicSession) || !sameText(prior.Term, receiptJournal.Term)) {
        const err = new Error(`Receipt ${sourceId} has a conflicting branch or accounting period; finance review is required.`);
        err.status = 409;
        throw err;
      }
      continue;
    }
    if (prior && lower(prior.Status) === 'posted' && journalLineSignature(prior.Lines) === journalLineSignature(lines) &&
      sameText(prior.Reference, sourceId) && sameText(prior.SourceId, sourceId)) continue;
    await saveJournal(receiptJournal);
    existing.add(journalNo); created += 1;
  }
  // Reconcile receipts first: an incompatible legacy receipt must not leave
  // a new Dr 2310 / Cr 1100 invoice-credit journal without its liability.
  if (edition === 'school') {
    for (const row of creditInvoices) {
      if (!isSchoolFeeInvoice(row)) continue;
      const gap = schoolInvoiceCreditJournalGap(row, journals);
      if (gap.invalidPostedJournalIds?.length || gap.missing < -0.005 || (gap.missing > 0.005 && gap.baselineExists)) {
        const err = new Error(`Invoice ${gap.invoiceId} has an unreconciled parent-credit application; finance review is required.`);
        err.status = 409;
        throw err;
      }
      if (gap.missing <= 0.005) continue;
      const journal = buildSchoolInvoiceCreditAccountingJournal(row, { amount: gap.missing, date: nowIso() });
      await saveJournal(journal);
      journals.push(journal);
      existing.add(journal.JournalNo);
      journalsByNo.set(journal.JournalNo, journal);
      created += 1;
    }
  }
  for (const row of ledgerRows) {
    const journal = buildWalletPurchaseAccountingJournal(row);
    if (!journal) continue;
    const prior = journalsByNo.get(journal.JournalNo);
    if (prior && lower(prior.Status) === 'posted' && journalLineSignature(prior.Lines) === journalLineSignature(journal.Lines) &&
      sameText(prior.Reference, journal.Reference) && sameText(prior.SourceId, journal.SourceId)) continue;
    await saveJournal(journal);
    existing.add(journal.JournalNo);
    journalsByNo.set(journal.JournalNo, journal);
    created += 1;
  }
  const normalizedAdmissionClasses = admissionClasses.map(normalizeAdmissionClass);
  const defaultConfiguredFormAmount = asMoneyNumber(
    normalizedAdmissionClasses.find((item) => asMoneyNumber(item.FormAmount) > 0)?.FormAmount
  );
  for (const row of sales) {
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
      await write('formSales', clean(row.__id) || safeDocumentId(sourceId), normalizedSale, row);
      created += 1;
    }
    if (amounts.GatewayFee > 0) {
      const chargeId = safeDocumentId(`PAYSTACK-FORM-FEE-${row.PaymentReference || sourceId}`);
      const existingCharge = gatewayCharges.find((charge) => sameText(charge.ChargeId || charge.__id, chargeId));
      if (!existingCharge) {
        await write('paymentGatewayCharges', chargeId, {
          ChargeId: chargeId, Date: row.PaymentDate || row.Time || nowIso(),
          Description: `Paystack admission-form transaction charge - ${row.PaymentReference || sourceId}`,
          Amount: amounts.GatewayFee, GrossCollection: amounts.GrossAmount, NetSettlement: amounts.NetAmount,
          Treatment: 'DeductedBeforeRevenueRecognition', Status: 'Recorded',
          Reference: row.PaymentReference || sourceId, Source: 'Paystack Admission Form',
          CreatedAt: nowIso(), UpdatedAt: nowIso()
        }, existingCharge);
        created += 1;
      }
    }
    const lines = [
      { AccountCode: accountingCashAccountFor(normalizedSale.PaymentMethod, normalizedSale.Gateway), Debit: amount, Credit: 0, Description: 'Form sale net receipt' },
      { AccountCode: '4010', Debit: 0, Credit: amount, Description: 'Admission form revenue' }
    ];
    const prior = journalsByNo.get(journalNo);
    if (prior && lower(prior.Status) === 'posted' && journalLineSignature(prior.Lines) === journalLineSignature(lines)) continue;
    await saveJournal({
      JournalNo: journalNo, Date: row.PaymentDate || row.Timestamp || nowIso(), Status: 'Posted',
      Description: `Admission form sale: ${clean(row.ApplicantName || sourceId)}`, Reference: sourceId,
      Source: 'Admission Form Sale', SourceId: sourceId, RecordedBy: 'System', BranchId: row.BranchId || 'main',
      Lines: lines
    });
    existing.add(journalNo); created += 1;
  }
  return created;
}

async function saveChartAccount(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const code = clean(body.Code || body.code);
  if (!code || !clean(body.Name || body.name) || !clean(body.Type || body.type)) {
    const err = new Error('Account code, name and type are required.'); err.status = 400; throw err;
  }
  const edition = accountingEditionForRequest(env, body);
  if (!accountingCodeAllowedForEdition(code, edition)) {
    const err = new Error(`Account ${code} is reserved for the school edition and is not available in this organisation.`);
    err.status = 400;
    throw err;
  }
  const existing = await getDocumentByIdOrField(env, 'chartOfAccounts', code, 'Code') || {};
  const payload = {
    ...existing, Code: code, Name: clean(body.Name || body.name), Type: clean(body.Type || body.type),
    Group: clean(body.Group || body.group), NormalBalance: clean(body.NormalBalance || body.normalBalance) || 'Debit',
    Active: yesNo(body.Active ?? body.active ?? 'YES') || 'YES', System: clean(existing.System || 'NO'),
    CreatedAt: existing.CreatedAt || nowIso(), UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'chartOfAccounts', safeDocumentId(code), payload);
  invalidateAccountingChartRows();
  await writeAccountingAudit(env, existing.Code ? 'UPDATE' : 'CREATE', 'Chart Account', code, body, payload.Name);
  return { ok: true, message: 'Chart of account saved.', account: payload };
}

function accountingRequisitionActor(body) {
  const requestedBranch = accountingRequestBranch(body);
  return {
    username: clean(body.UserUsername), displayName: clean(body.RecordedBy),
    role: clean(body.UserRole), assignedRole: clean(body.UserAssignedRole || body.UserRole),
    department: accountingDepartment(body), branchId: requestedBranch === 'all' ? '' : requestedBranch,
    schoolSectionAccess: clean(body.UserSchoolSectionAccess) || 'All',
    approvalEnabled: body.UserApprovalEnabled === true,
    approvalMaxAmount: Number(body.UserApprovalMaxAmount || 0),
    approvalAccounts: Array.isArray(body.UserApprovalAccounts) ? body.UserApprovalAccounts : [],
    requisitionEditEnabled: body.UserRequisitionEditEnabled === true,
    sourcePlatform: 'Desktop'
  };
}

async function saveAccountingExpense(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management', ...DEPARTMENT_ACCOUNTING_ROLES]);
  const expenseNo = clean(body.ExpenseNo || body.expenseNo) || ledgerDocumentId('EXP');
  const existing = await getDocumentByIdOrField(env, 'accountingExpenses', expenseNo, 'ExpenseNo') || {};
  if (clean(body.RecordVersion) && clean(body.RecordVersion) !== clean(existing.__updateTime)) {
    const err = new Error('This requisition changed after it was loaded. Refresh it before saving your edits.');
    err.status = 409;
    err.code = 'FINANCE_WRITE_CONFLICT';
    throw err;
  }
  const branchId = accountingWriteBranch(body, existing);
  if (lower(existing.Status) === 'posted') {
    const err = new Error('Posted expenses cannot be edited. Use a reversal.'); err.status = 409; throw err;
  }
  const amount = asMoneyNumber(body.Amount || body.amount);
  const expenseDate = clean(body.Date || body.date);
  const parsedExpenseDate = new Date(`${expenseDate}T00:00:00.000Z`);
  if (amount <= 0 || !clean(body.Description || body.description)) {
    const err = new Error('Expense description and amount are required.'); err.status = 400; throw err;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || Number.isNaN(parsedExpenseDate.getTime()) || parsedExpenseDate.toISOString().slice(0, 10) !== expenseDate) {
    const err = new Error('A valid requisition date is required.'); err.status = 400; throw err;
  }
  const requestedStatus = ({
    confirmed: REQUISITION_STATUS.ACCOUNTS_CONFIRMED,
    'accounts confirmed': REQUISITION_STATUS.ACCOUNTS_CONFIRMED,
    reviewed: REQUISITION_STATUS.ADMIN_REVIEWED,
    'admin reviewed': REQUISITION_STATUS.ADMIN_REVIEWED,
    authorized: REQUISITION_STATUS.MANAGEMENT_AUTHORIZED,
    authorised: REQUISITION_STATUS.MANAGEMENT_AUTHORIZED,
    'management authorized': REQUISITION_STATUS.MANAGEMENT_AUTHORIZED,
    'management authorised': REQUISITION_STATUS.MANAGEMENT_AUTHORIZED,
    approved: REQUISITION_STATUS.APPROVED,
    rejected: REQUISITION_STATUS.REJECTED,
    posted: REQUISITION_STATUS.POSTED,
    submitted: REQUISITION_STATUS.SUBMITTED,
    draft: REQUISITION_STATUS.DRAFT
  })[lower(body.Status || body.status || 'Draft')] || clean(body.Status || body.status || 'Draft');
  const actorRole = clean(body.UserAssignedRole || body.UserRole || body.userRole);
  const actorName = clean(body.RecordedBy || body.recordedBy);
  const actorUsername = clean(body.UserUsername || body.userUsername);
  const currentWorkflowStatus = requisitionWorkflowStatus(existing);
  const editActor = accountingRequisitionActor(body);
  if (existing.ExpenseNo && currentWorkflowStatus !== REQUISITION_STATUS.DRAFT && requestedStatus === REQUISITION_STATUS.SUBMITTED) {
    // Use the same scoped, version-checked edit/resubmit transaction as the web.
    // This also clears earlier approvals and signatures before restarting Accounts review.
    return resubmitRequisition(env, editActor, {
      ...body, recordId: expenseNo, recordVersion: clean(body.RecordVersion || body.__updateTime),
      MaterialItems: body.MaterialItems ?? existing.MaterialItems
    });
  }
  if (existing.ExpenseNo && currentWorkflowStatus === REQUISITION_STATUS.DRAFT
      && lower(actorUsername) !== lower(existing.RequestedByUsername)) {
    assertRequisitionEditPermission(editActor);
  }
  let transition = null;
  if (!existing.ExpenseNo) {
    if (![REQUISITION_STATUS.DRAFT, REQUISITION_STATUS.SUBMITTED].includes(requestedStatus)) {
      const err = new Error('A new requisition must be saved as Draft or Submitted before any office can act on it.');
      err.status = 409;
      err.code = 'REQUISITION_SUBMISSION_REQUIRED';
      throw err;
    }
  } else if (currentWorkflowStatus === REQUISITION_STATUS.DRAFT && requestedStatus === REQUISITION_STATUS.SUBMITTED) {
    // Any staff member with an assigned finance department may submit a draft.
  } else if (currentWorkflowStatus === REQUISITION_STATUS.REJECTED && requestedStatus === REQUISITION_STATUS.SUBMITTED) {
    if (!['Super Admin', 'Director'].includes(actorRole) && lower(actorUsername) !== lower(existing.RequestedByUsername)) {
      const err = new Error('Only the original requester, Director or Super Admin can correct and resubmit a rejected requisition.');
      err.status = 403;
      throw err;
    }
  } else if (requestedStatus === currentWorkflowStatus && ![
    REQUISITION_STATUS.DRAFT, REQUISITION_STATUS.SUBMITTED
  ].includes(currentWorkflowStatus)) {
    const err = new Error('A reviewed requisition cannot be edited without returning it to the requester.');
    err.status = 409;
    err.code = 'REQUISITION_REVIEW_LOCKED';
    throw err;
  } else if (requestedStatus !== currentWorkflowStatus) {
    transition = assertRequisitionTransition(existing, actorRole, requestedStatus);
  }
  const forcedDepartment = enforceDepartmentSubmission(body, existing, requestedStatus);
  const timestamp = nowIso();
  const payload = {
    ...existing, ExpenseNo: expenseNo, BranchId: branchId, Date: expenseDate,
    ...((!existing.ExpenseNo || currentWorkflowStatus === 'Draft') && requestedStatus === 'Submitted'
      ? { ApprovalFlow: await approvalSnapshot(env, 'staff') } : {}),
    Vendor: clean(body.Vendor || body.vendor), Description: clean(body.Description || body.description), Amount: amount,
    ExpenseAccount: clean(body.ExpenseAccount || body.expenseAccount) || '6090',
    PaymentAccount: clean(body.PaymentAccount || body.paymentAccount) || '1020',
    Department: forcedDepartment || clean(body.Department || body.department), CostCentre: clean(body.CostCentre || body.costCentre),
    BudgetCode: clean(body.BudgetCode || body.budgetCode), PaymentMethod: clean(body.PaymentMethod || body.paymentMethod),
    Reference: clean(body.Reference || body.reference), AttachmentUrl: clean(body.AttachmentUrl || body.attachmentUrl),
    Notes: clean(body.Notes || body.notes), Status: requestedStatus,
    PostingWarningAcknowledged: clean(body.PostingWarningAcknowledged || body.postingWarningAcknowledged),
    PostingWarningDetails: clean(body.PostingWarningDetails || body.postingWarningDetails),
    RequestedBy: existing.RequestedBy || actorName,
    RequestedByUsername: existing.RequestedByUsername || actorUsername,
    RequestedAt: existing.RequestedAt || timestamp,
    UpdatedAt: timestamp,
    UpdatedBy: actorName
  };
  if (transition) {
    const businessChanges = requisitionChangedFields({
      ...existing, ExpenseAccount: clean(existing.ExpenseAccount) || '6090',
      PaymentAccount: clean(existing.PaymentAccount) || '1020'
    }, payload).filter((field) => field !== 'Notes');
    if (businessChanges.length) {
      const err = new Error('Edit and resubmit this requisition before changing its approval status. Approval actions cannot change its contents.');
      err.status = 409;
      err.code = 'REQUISITION_EDIT_REQUIRES_RESUBMISSION';
      throw err;
    }
    // Review notes belong to the decision; they are not an edit to the requester's notes.
    payload.Notes = clean(existing.Notes);
  }
  if (transition?.stage === 'accounts' && transition.event !== 'Rejected') {
    Object.assign(payload, {
      AccountsReviewStatus: 'Confirmed',
      AccountsConfirmedBy: actorName,
      AccountsConfirmedByUsername: actorUsername,
      AccountsConfirmedAt: timestamp,
      AccountsConfirmationNotes: clean(body.Notes || body.notes),
      AccountsReviewedBy: actorName,
      AccountsReviewedByUsername: actorUsername,
      AccountsReviewedAt: timestamp,
      AccountsReviewNotes: clean(body.Notes || body.notes),
      RejectedAt: '', RejectedBy: '', RejectedByUsername: '', RejectedStage: ''
    });
  } else if (transition?.stage === 'admin-review' && transition.event !== 'Rejected') {
    Object.assign(payload, {
      AdminStageReviewedBy: actorName,
      AdminStageReviewedByUsername: actorUsername,
      AdminStageReviewedAt: timestamp,
      AdminStageReviewNotes: clean(body.Notes || body.notes),
      RejectedAt: '', RejectedBy: '', RejectedByUsername: '', RejectedStage: '', RejectionNotes: ''
    });
  } else if (transition?.event === 'Authorized') {
    Object.assign(payload, {
      ManagementAuthorizedBy: actorName,
      ManagementAuthorizedByUsername: actorUsername,
      ManagementAuthorizedAt: timestamp,
      ManagementAuthorizationNotes: clean(body.Notes || body.notes),
      RejectedAt: '', RejectedBy: '', RejectedByUsername: '', RejectedStage: ''
    });
  }
  if (transition?.event === 'Approved') {
    Object.assign(payload, {
      ApprovedBy: actorName,
      ApprovedByUsername: actorUsername,
      ApprovedAt: timestamp,
      AdminReviewedBy: actorName,
      AdminReviewedByUsername: actorUsername,
      AdminReviewedAt: timestamp,
      FinalApprovedRole: actorRole,
      FinalApprovedStage: transition.stage,
      RejectedAt: '', RejectedBy: '', RejectedByUsername: '', RejectedStage: ''
    });
  } else if (transition?.event === 'Rejected') {
    Object.assign(payload, {
      RejectedAt: timestamp,
      RejectedBy: actorName,
      RejectedByUsername: actorUsername,
      RejectedByRole: actorRole,
      RejectedStage: transition.currentStatus,
      RejectionNotes: clean(body.Notes || body.notes)
    });
  }
  if (requestedStatus === REQUISITION_STATUS.SUBMITTED && currentWorkflowStatus === REQUISITION_STATUS.REJECTED) {
    Object.assign(payload, {
      AccountsReviewStatus: '', AccountsConfirmedBy: '', AccountsConfirmedByUsername: '', AccountsConfirmedAt: '',
      AccountsReviewedBy: '', AccountsReviewedByUsername: '', AccountsReviewedAt: '',
      ManagementAuthorizedBy: '', ManagementAuthorizedByUsername: '', ManagementAuthorizedAt: '',
      AdminStageReviewedBy: '', AdminStageReviewedByUsername: '', AdminStageReviewedAt: '', AdminStageReviewNotes: '',
      ApprovedBy: '', ApprovedByUsername: '', ApprovedAt: '',
      FinalApprovedRole: '', FinalApprovedStage: '',
      AdminReviewedBy: '', AdminReviewedByUsername: '', AdminReviewedAt: '',
      RejectedAt: '', RejectedBy: '', RejectedByUsername: '', RejectedByRole: '', RejectedStage: '',
      RejectionNotes: '',
      ResubmittedAt: timestamp, ResubmittedBy: actorName, ResubmittedByUsername: actorUsername
    });
  }
  if (requestedStatus === REQUISITION_STATUS.POSTED) {
    const result = await postApprovedRequisition(env, existing, editActor, {
      postingDate: payload.Date, reference: payload.Reference || expenseNo, notes: clean(body.Notes || body.notes),
      warningAcknowledged: payload.PostingWarningAcknowledged, warningDetails: payload.PostingWarningDetails,
      authorizationMethod: 'Desktop authorization'
    });
    await notifyStaffRequisitionEvent(env, result.record, 'Posted', actorName).catch(() => null);
    return { ok: true, message: result.message, expense: result.record };
  }
  const edit = existing.ExpenseNo ? recordRequisitionEdit(existing, payload, {
    displayName: actorName, username: actorUsername, role: actorRole
  }, timestamp, {
    resubmitted: requestedStatus === REQUISITION_STATUS.SUBMITTED && currentWorkflowStatus === REQUISITION_STATUS.REJECTED
  }) : null;
  const audit = accountingAuditWrite(
    edit?.Action || (transition ? `${transition.event.toUpperCase()} REQUISITION` : existing.ExpenseNo ? 'SAVE REQUISITION' : 'CREATE REQUISITION'),
    'Expense Requisition', expenseNo, body,
    edit ? requisitionEditDetails(edit) : `${currentWorkflowStatus || 'New'} → ${requestedStatus}`, timestamp
  );
  const writes = [
    { collectionPath: 'accountingExpenses', documentId: safeDocumentId(expenseNo), data: payload,
      ...(existing.__updateTime ? { updateTime: existing.__updateTime } : { exists: false }) },
    audit
  ];
  if (edit) {
    const snapshot = { ...existing };
    for (const key of ['__id', '__name', '__createTime', '__updateTime']) delete snapshot[key];
    writes.push({
      collectionPath: 'accountingExpenseRevisions',
      documentId: safeDocumentId(`${expenseNo}-REV-${String(edit.RevisionNumber - 1).padStart(3, '0')}`),
      exists: false,
      data: { ExpenseNo: expenseNo, RevisionNumber: edit.RevisionNumber - 1, ArchivedAt: timestamp,
        ArchivedBy: actorName, ArchivedByUsername: actorUsername, BranchId: branchId,
        StatusAtArchive: existing.Status, Edit: edit, Snapshot: snapshot }
    });
    if (transition) writes.push(accountingAuditWrite(
      `${transition.event.toUpperCase()} REQUISITION`, 'Expense Requisition', expenseNo, body,
      `${currentWorkflowStatus} → ${requestedStatus}`, timestamp
    ));
  }
  await batchUpsertDocuments(env, writes);
  const event = transition?.event || (
    requestedStatus === REQUISITION_STATUS.SUBMITTED && currentWorkflowStatus !== REQUISITION_STATUS.SUBMITTED
      ? 'Submitted'
      : ''
  );
  if (event) {
    await notifyStaffRequisitionEvent(env, payload, event, actorName).catch(() => null);
  }
  return { ok: true, message: `Expense saved as ${requestedStatus}.`, expense: payload };
}

function validImprestDate(value, label) {
  const date = clean(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    const err = new Error(`A valid ${label} is required.`);
    err.status = 400;
    throw err;
  }
  return date;
}

async function accountingImprestRecord(env, body) {
  const id = clean(body.ImprestNo || body.imprestNo || body.RecordId || body.recordId);
  const branch = accountingRequestBranch(body);
  const direct = await getDocumentByIdOrField(env, 'accountingImprests', id, 'ImprestNo');
  const record = accountingRowsForBranch(direct ? [direct] : [], branch)[0];
  const section = lower(body.UserSchoolSectionAccess || 'All');
  if (!record || (section !== 'all' && lower(record.SchoolSection || 'Secondary') !== section)) {
    const err = new Error('The selected imprest was not found in this branch.');
    err.status = 404;
    throw err;
  }
  return record;
}

async function accountingImprestClaimRelease(env, record) {
  const claimId = accountingImprestOpenClaimId(record);
  const claim = await getDocument(env, 'accountingImprestOpenClaims', claimId);
  return imprestClaimReleaseWrites(record, claim, clean(claim?.__id) || claimId);
}

async function prepareImprestJournal(env, journal) {
  const prepared = await saveAccountingJournal(env, journal, true, { prepareOnly: true });
  if (prepared.existing && Object.keys(prepared.existing).length) {
    throw financeFailure('This imprest already has a journal but its request is not completed. Accounts must reconcile it before retrying.', 409);
  }
  return { journal: prepared.payload,
    write: financeWrite('accountingJournals', safeDocumentId(journal.JournalNo), prepared.payload) };
}

async function commitAccountingImprest(env, record, payload, body, action, details, additionalWrites = []) {
  try {
    await batchCommitLiteralDocuments(env, [
      financeWrite('accountingImprests', safeDocumentId(record.ImprestNo), payload, record),
      ...additionalWrites,
      accountingAuditWrite(action, 'Imprest', record.ImprestNo, body, details)
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      throw financeFailure('This imprest changed during review. Refresh before retrying; no partial posting was made.', 409, 'FINANCE_WRITE_CONFLICT');
    }
    throw error;
  }
}

function accountingImprestOpenClaimId(record = {}) {
  return safeDocumentId(`${clean(record.BranchId || 'main').toLowerCase()}-${clean(record.CustodianUsername || record.RequestedByUsername).toLowerCase()}`);
}

async function requireDesktopImprestApproval(env, body, value) {
  assertFinanceRoleLimit(await listCollection(env, 'accountingApprovalLimits'), clean(body.UserRole), 'Imprest', value);
  if (clean(body.UserRole) === 'Super Admin') return;
  const user = await getDocumentByIdOrField(env, 'staffUsers', body.UserUsername, 'Username');
  if (!user || yesNo(user.ApprovalEnabled ?? 'NO') !== 'YES' ||
    asMoneyNumber(user.ApprovalMaxAmount) <= 0 || asMoneyNumber(value) > asMoneyNumber(user.ApprovalMaxAmount)) {
    const err = new Error('This user does not have administrator-granted approval rights for this imprest amount.');
    err.status = 403;
    throw err;
  }
}

async function submitAccountingImprest(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management', ...DEPARTMENT_ACCOUNTING_ROLES]);
  const department = accountingDepartment(body) || clean(body.Department);
  if (!department) {
    const err = new Error('A department must be assigned before requesting an imprest.');
    err.status = 403;
    throw err;
  }
  const requestedAmount = financeMoney(body.AmountRequested ?? body.Amount, 'Requested amount', { min: 0.01 });
  const purpose = clean(body.Purpose || body.purpose);
  const date = validImprestDate(body.Date || nowIso().slice(0, 10), 'request date');
  const dueDate = validImprestDate(body.DueDate, 'retirement due date');
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
  const branchId = accountingWriteBranch(body);
  const username = clean(body.UserUsername);
  const claimId = accountingImprestOpenClaimId({ BranchId: branchId, CustodianUsername: username });
  const openClaim = await getDocument(env, 'accountingImprestOpenClaims', claimId);
  const legacyOpenRows = openClaim ? [] : await queryCollectionPages(env, 'accountingImprests', {
    filters: [{ field: 'CustodianUsername', op: '==', value: username }],
    pageSize: 100, maxRows: 10000
  });
  const open = openClaim || legacyOpenRows.find((row) =>
    sameText(row.BranchId || 'main', branchId) && isOpenImprestStatus(row.Status));
  if (open) {
    const err = new Error(`Retire or close ${open.ImprestNo || 'the current imprest'} before requesting another imprest.`);
    err.status = 409;
    throw err;
  }
  const id = ledgerDocumentId('IMP');
  const timestamp = nowIso();
  const payload = {
    ImprestNo: id,
    ImprestType: ['Standing', 'Special'].includes(clean(body.ImprestType)) ? clean(body.ImprestType) : 'Special',
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
    PaymentAccount: clean(body.PaymentAccount) || '1020',
    Department: department,
    CostCentre: clean(body.CostCentre),
    CustodianName: clean(body.RecordedBy),
    CustodianUsername: username,
    RequestedBy: clean(body.RecordedBy),
    RequestedByUsername: username,
    RequestedAt: timestamp,
    Notes: clean(body.Notes),
    Status: 'Submitted',
    CreatedAt: timestamp,
    UpdatedAt: timestamp,
    SourcePlatform: 'Desktop',
    BranchId: branchId,
    SchoolSection: clean(body.SchoolSection || 'Secondary')
  };
  try {
    await batchUpsertDocuments(env, [
      {
        collectionPath: 'accountingImprestOpenClaims',
        documentId: accountingImprestOpenClaimId(payload),
        data: {
          ClaimId: accountingImprestOpenClaimId(payload),
          ImprestNo: id,
          BranchId: branchId,
          CustodianUsername: username,
          CreatedAt: timestamp
        },
        exists: false
      },
      { collectionPath: 'accountingImprests', documentId: safeDocumentId(id), data: payload, exists: false },
      accountingAuditWrite('SUBMIT', 'Imprest', id, body, `${payload.ImprestType}: ${purpose}; ${requestedAmount}`)
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      const conflict = new Error('You already have an open imprest in this branch. Retire or close it before requesting another one.');
      conflict.status = 409;
      conflict.code = 'OPEN_IMPREST_EXISTS';
      throw conflict;
    }
    throw error;
  }
  return { ok: true, message: 'Imprest request submitted.', imprest: payload };
}

async function reviewAccountingImprest(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const record = await accountingImprestRecord(env, body);
  if (lower(record.Status) !== 'submitted') {
    const err = new Error('Only a Submitted imprest can be approved or rejected.');
    err.status = 409;
    throw err;
  }
  const decision = clean(body.Decision || body.Status);
  if (!['Approved', 'Rejected'].includes(decision)) {
    const err = new Error('Decision must be Approved or Rejected.');
    err.status = 400;
    throw err;
  }
  const approved = decision === 'Approved'
    ? financeMoney(body.AmountApproved ?? record.AmountRequested, 'Approved amount', { min: 0.01 }) : 0;
  if (decision === 'Approved') {
    if (approved <= 0 || approved > asMoneyNumber(record.AmountRequested)) {
      const err = new Error('Approved amount must be greater than zero and cannot exceed the requested amount.');
      err.status = 400;
      throw err;
    }
    await requireDesktopImprestApproval(env, body, approved);
  }
  const timestamp = nowIso();
  const payload = {
    ...record,
    Status: decision,
    AmountApproved: decision === 'Approved' ? approved : 0,
    OutstandingAmount: decision === 'Approved' ? approved : 0,
    ReviewNotes: clean(body.Notes),
    UpdatedAt: timestamp,
    ...(decision === 'Approved'
      ? { ApprovedAt: timestamp, ApprovedBy: clean(body.RecordedBy), ApprovedByUsername: clean(body.UserUsername) }
      : { RejectedAt: timestamp, RejectedBy: clean(body.RecordedBy), RejectedByUsername: clean(body.UserUsername) })
  };
  delete payload.__id; delete payload.__name; delete payload.__updateTime; delete payload.__createTime;
  const writes = decision === 'Rejected' ? await accountingImprestClaimRelease(env, record) : [];
  await commitAccountingImprest(env, record, payload, body, decision.toUpperCase(), clean(body.Notes), writes);
  return { ok: true, message: `Imprest ${decision.toLowerCase()}.`, imprest: payload };
}

async function issueAccountingImprest(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const record = await accountingImprestRecord(env, body);
  if (lower(record.Status) !== 'approved') {
    const err = new Error('Only an Approved imprest can be issued.');
    err.status = 409;
    throw err;
  }
  const reference = clean(body.DisbursementReference || body.Reference);
  if (!reference) {
    const err = new Error('Enter the cash, bank or payment reference used for disbursement.');
    err.status = 400;
    throw err;
  }
  await seedAccountingChart(env);
  const timestamp = nowIso();
  const payload = {
    ...record,
    Status: 'Issued',
    AmountIssued: asMoneyNumber(record.AmountApproved),
    OutstandingAmount: asMoneyNumber(record.AmountApproved),
    PaymentAccount: clean(body.PaymentAccount) || '1020',
    DisbursementReference: reference,
    IssueDate: validImprestDate(body.IssueDate || nowIso().slice(0, 10), 'issue date'),
    IssuedAt: timestamp,
    IssuedBy: clean(body.RecordedBy),
    IssuedByUsername: clean(body.UserUsername),
    UpdatedAt: timestamp
  };
  delete payload.__id; delete payload.__name; delete payload.__updateTime; delete payload.__createTime;
  const { journal, write: journalWrite } = await prepareImprestJournal(env, buildImprestIssueJournal(payload, clean(body.RecordedBy)));
  payload.IssueJournalNo = journal.JournalNo;
  await commitAccountingImprest(env, record, payload, body, 'ISSUE', reference, [journalWrite]);
  return { ok: true, message: 'Imprest issued and posted to staff advances.', imprest: payload };
}

async function submitAccountingImprestRetirement(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management', ...DEPARTMENT_ACCOUNTING_ROLES]);
  const record = await accountingImprestRecord(env, body);
  if (lower(record.Status) !== 'issued') {
    const err = new Error('Only an Issued imprest can be retired.');
    err.status = 409;
    throw err;
  }
  if (!['Super Admin', 'Accounts Officer'].includes(clean(body.UserRole)) &&
    !sameText(record.CustodianUsername || record.RequestedByUsername, body.UserUsername)) {
    const err = new Error('Only the imprest custodian or Accounts can submit this retirement.');
    err.status = 403;
    throw err;
  }
  let retirement;
  try {
    retirement = validateImprestRetirement(record.AmountIssued, body.RetirementLines || body.Lines);
  } catch (error) {
    error.status = 400;
    throw error;
  }
  const returnReference = clean(body.ReturnReference);
  if (retirement.returnedAmount > 0 && !returnReference) {
    const err = new Error('Enter the cash or bank return reference for the unused balance.');
    err.status = 400;
    throw err;
  }
  const payload = {
    ...record,
    Status: 'Retirement Submitted',
    RetirementLines: retirement.lines,
    ExpenseTotal: retirement.expenseTotal,
    ReturnedAmount: retirement.returnedAmount,
    OutstandingAmount: asMoneyNumber(record.AmountIssued),
    ReturnReference: returnReference,
    RetirementNotes: clean(body.Notes),
    RetirementSubmittedAt: nowIso(),
    RetirementSubmittedBy: clean(body.RecordedBy),
    RetirementSubmittedByUsername: clean(body.UserUsername),
    UpdatedAt: nowIso()
  };
  delete payload.__id; delete payload.__name; delete payload.__updateTime; delete payload.__createTime;
  await commitAccountingImprest(env, record, payload, body, 'SUBMIT RETIREMENT', `${retirement.lines.length} receipt(s)`);
  return { ok: true, message: 'Imprest retirement submitted for verification.', imprest: payload };
}

async function verifyAccountingImprestRetirement(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const record = await accountingImprestRecord(env, body);
  if (lower(record.Status) !== 'retirement submitted') {
    const err = new Error('Only a submitted imprest retirement can be reviewed.');
    err.status = 409;
    throw err;
  }
  const decision = clean(body.Decision || 'Verified');
  if (decision === 'Returned for Correction') {
    if (!clean(body.Notes)) {
      const err = new Error('Explain what the custodian must correct.');
      err.status = 400;
      throw err;
    }
    const payload = { ...record, Status: 'Issued', RetirementReviewNotes: clean(body.Notes), RetirementReturnedAt: nowIso(), RetirementReturnedBy: clean(body.RecordedBy), UpdatedAt: nowIso() };
    delete payload.__id; delete payload.__name; delete payload.__updateTime; delete payload.__createTime;
    await commitAccountingImprest(env, record, payload, body, 'RETURN RETIREMENT', clean(body.Notes));
    return { ok: true, message: 'Retirement returned for correction.', imprest: payload };
  }
  if (decision !== 'Verified') throw financeFailure('Choose Verified or Returned for Correction.');
  await seedAccountingChart(env);
  const { journal, write: journalWrite } = await prepareImprestJournal(env, buildImprestRetirementJournal({
    ...record,
    RetirementDate: validImprestDate(body.RetirementDate || nowIso().slice(0, 10), 'retirement date')
  }, clean(body.RecordedBy)));
  const payload = {
    ...record,
    Status: 'Retired',
    OutstandingAmount: 0,
    RetirementDate: journal.Date,
    RetirementJournalNo: journal.JournalNo,
    RetirementReviewNotes: clean(body.Notes),
    RetiredAt: nowIso(),
    RetiredBy: clean(body.RecordedBy),
    RetiredByUsername: clean(body.UserUsername),
    UpdatedAt: nowIso()
  };
  delete payload.__id; delete payload.__name; delete payload.__updateTime; delete payload.__createTime;
  await commitAccountingImprest(env, record, payload, body, 'VERIFY RETIREMENT', clean(body.Notes),
    [journalWrite, ...await accountingImprestClaimRelease(env, record)]);
  return { ok: true, message: 'Imprest fully retired and posted to expense accounts.', imprest: payload };
}

async function saveAccountingBudget(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const requestedId = clean(body.BudgetId || body.budgetId);
  const existing = requestedId
    ? await getDocumentByIdOrField(env, 'accountingBudgets', requestedId, 'BudgetId') || {}
    : {};
  const branchId = accountingWriteBranch(body, existing);
  const id = requestedId || [branchId, body.FinancialYear, body.Department, body.AccountCode].map(safeDocumentId).join('-');
  const payload = {
    ...existing, BudgetId: id, BranchId: branchId, FinancialYear: clean(body.FinancialYear || body.financialYear),
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
  const requestedId = clean(body.BankId || body.bankId);
  const requestedBranch = accountingWriteBranch(body);
  const accountCode = clean(body.AccountCode || body.accountCode);
  const id = requestedId || (accountCode ? `${requestedBranch === 'main' ? '' : `${safeDocumentId(requestedBranch)}-`}${accountCode}` : ledgerDocumentId('BNK'));
  const existing = await getDocumentByIdOrField(env, 'accountingBanks', id, 'BankId') || {};
  const branchId = accountingWriteBranch(body, existing);
  const payload = {
    ...existing, BankId: id, BranchId: branchId, Name: clean(body.Name || body.name), BankName: clean(body.BankName || body.bankName),
    AccountNumber: clean(body.AccountNumber || body.accountNumber), AccountCode: accountCode || '1020',
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
  const existing = await getDocumentByIdOrField(env, 'accountingReconciliations', id, 'ReconciliationNo') || {};
  const branchId = accountingWriteBranch(body, existing);
  const statement = asMoneyNumber(body.StatementBalance || body.statementBalance);
  const book = asMoneyNumber(body.BookBalance || body.bookBalance);
  const outstandingDeposits = asMoneyNumber(body.OutstandingDeposits || body.outstandingDeposits);
  const unpresentedPayments = asMoneyNumber(body.UnpresentedPayments || body.unpresentedPayments);
  const chargesAndAdjustments = asMoneyNumber(body.ChargesAndAdjustments || body.chargesAndAdjustments);
  const payload = {
    ...existing, ReconciliationNo: id, BranchId: branchId, BankId: clean(body.BankId || body.bankId), AccountCode: clean(body.AccountCode || body.accountCode) || '1020',
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
  { Role: 'Management', TransactionType: 'Imprest', MaxAmount: 5000000 },
  { Role: 'Management', TransactionType: 'Concession', MaxAmount: 1000000 },
  { Role: 'Super Admin', TransactionType: 'Expense', MaxAmount: 999999999999 },
  { Role: 'Super Admin', TransactionType: 'Supplier Bill', MaxAmount: 999999999999 },
  { Role: 'Super Admin', TransactionType: 'Imprest', MaxAmount: 999999999999 },
  { Role: 'Super Admin', TransactionType: 'Concession', MaxAmount: 999999999999 }
];

const DEFAULT_CLOSE_CHECKLIST = [
  'Revenue subledgers synchronized', 'All expense vouchers reviewed', 'All imprests and staff advances reviewed', 'Bank accounts reconciled',
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
  assertFinanceRoleLimit(await listCollection(env, 'accountingApprovalLimits'), role, transactionType, amount);
  if (role === 'Super Admin') return;
  const username = clean(body.UserUsername || body.userUsername);
  const users = await listCollection(env, 'staffUsers');
  const user = users.find((row) => sameText(row.Username || row.__id, username));
  const enabled = user && yesNo(user.ApprovalEnabled ?? 'NO') === 'YES';
  const maximum = user ? financeMoney(user.ApprovalMaxAmount, 'Individual approval limit', { defaultValue: 0 }) : 0;
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
  if (!['Management', 'Super Admin', 'Accounts Officer'].includes(role) || !['Expense', 'Supplier Bill', 'Imprest', 'Concession'].includes(type)) throw financeFailure('Choose a valid approval role and transaction type.');
  const payload = { Role: role, TransactionType: type, PolicyVersion: 2, MaxAmount: financeMoney(body.MaxAmount ?? body.maxAmount, 'Approval limit'), Active: yesNo(body.Active ?? 'YES') || 'YES', UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) };
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
  const existing = await getDocumentByIdOrField(env, 'accountingCloseChecklist', id, 'ChecklistId');
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
  const date = financeDate(clean(body.Date || body.date) || nowIso().slice(0, 10), 'Opening date');
  const reference = clean(body.Reference || body.reference);
  if (!reference) throw financeFailure('Enter a unique reference for these opening balances.');
  const branch = accountingWriteBranch(body);
  const prior = await queryCollection(env, 'accountingJournals', { filters: [
    { field: 'Source', op: '==', value: 'Opening Balance' }, { field: 'Reference', op: '==', value: reference }
  ], limit: 21 });
  const matching = accountingRowsForBranch(prior, branch);
  if (prior.length > 20 || matching.length > 1) throw financeFailure('This opening reference has multiple historical entries. Accounts must review them before posting.', 409);
  const journalNo = matching[0]?.JournalNo || await financeOperationId('OPEN', branch, reference);
  const journal = await saveAccountingJournal(env, { ...body, JournalNo: journalNo, Date: date, Reference: reference,
    Description: clean(body.Description) || `Opening balances at ${date}`, Source: 'Opening Balance', Status: 'Posted' }, false, { replayPosted: true });
  return { ok: true, message: 'Opening balances posted.', journal };
}

async function saveAccountingVendor(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const vendorId = clean(body.VendorId || body.vendorId) || ledgerDocumentId('VND');
  const name = clean(body.Name || body.name || body.Vendor);
  if (!name) { const err = new Error('Supplier name is required.'); err.status = 400; throw err; }
  const existing = await getDocumentByIdOrField(env, 'accountingVendors', vendorId, 'VendorId') || {};
  const branchId = accountingWriteBranch(body, existing);
  const payload = { ...existing, VendorId: vendorId, BranchId: branchId, Name: name, ContactPerson: clean(body.ContactPerson), Phone: clean(body.Phone),
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
  const existing = await getDocumentByIdOrField(env, 'accountingSupplierBills', billNo, 'BillNo') || {};
  const branchId = accountingWriteBranch(body, existing);
  const amount = financeMoney(body.Amount ?? body.amount, 'Bill amount', { min: 0.01 });
  const status = clean(body.Status || body.status || 'Draft');
  if (!['draft', 'submitted', 'approved', 'posted', 'rejected'].includes(lower(status))) throw financeFailure('Choose a valid supplier bill status.');
  const forcedDepartment = enforceDepartmentSubmission(body, existing, status);
  if (amount <= 0 || !clean(body.Description)) { const err = new Error('Bill description and amount are required.'); err.status = 400; throw err; }
  const invoiceReference = clean(body.InvoiceReference || body.Reference);
  if (invoiceReference) {
    const duplicateInvoice = (await queryCollection(env, 'accountingSupplierBills', {
      filters: [
        { field: 'VendorId', op: '==', value: clean(body.VendorId) },
        { field: 'InvoiceReference', op: '==', value: invoiceReference }
      ],
      limit: 2
    })).find((row) => !sameText(row.BillNo, billNo));
    if (duplicateInvoice) {
      const err = new Error('This supplier invoice reference has already been recorded for the selected supplier.'); err.status = 409; throw err;
    }
  }
  if (['approved', 'posted', 'rejected'].includes(lower(status))) await requireAccountingApprovalLimit(env, body, 'Supplier Bill', amount);
  const payload = { ...existing, BillNo: billNo, BranchId: branchId, VendorId: clean(body.VendorId), VendorName: clean(body.VendorName || body.Vendor),
    InvoiceReference: invoiceReference, Date: financeDate(clean(body.Date) || nowIso().slice(0, 10), 'Bill date'),
    DueDate: clean(body.DueDate) ? financeDate(body.DueDate, 'Bill due date') : '', Description: clean(body.Description), Amount: amount, PaidAmount: asMoneyNumber(existing.PaidAmount), BalanceAmount: amount - asMoneyNumber(existing.PaidAmount),
    AccountCode: clean(body.AccountCode) || '6090', Department: forcedDepartment || clean(body.Department), CostCentre: clean(body.CostCentre),
    AcademicSession: clean(body.AcademicSession), Term: clean(body.Term), AttachmentUrl: clean(body.AttachmentUrl), Notes: clean(body.Notes), Status: status,
    CreatedAt: existing.CreatedAt || nowIso(), CreatedBy: existing.CreatedBy || clean(body.RecordedBy), UpdatedAt: nowIso(),
    ApprovedAt: ['approved', 'posted'].includes(lower(status)) ? nowIso() : '', ApprovedBy: ['approved', 'posted'].includes(lower(status)) ? clean(body.RecordedBy) : '' };
  if (['posted', 'part paid', 'paid'].includes(lower(existing.Status))) {
    if (lower(status) === 'posted' && ['Amount', 'Date', 'VendorId', 'AccountCode', 'Description', 'InvoiceReference'].every(key => clean(existing[key]) === clean(payload[key]))) return { ok: true, message: 'Supplier bill was already posted.', bill: existing };
    throw financeFailure('Posted supplier bills are immutable.', 409);
  }
  const writes = [];
  if (invoiceReference) {
    const claimId = await financeOperationId('BILLREF', branchId, payload.VendorId, invoiceReference);
    const claim = await getDocument(env, 'accountingSupplierInvoiceClaims', claimId);
    if (claim && !sameText(claim.BillNo, billNo)) throw financeFailure('This supplier invoice reference has already been recorded.', 409);
    if (!claim) writes.push(financeWrite('accountingSupplierInvoiceClaims', claimId, { BillNo: billNo, BranchId: branchId, VendorId: payload.VendorId, InvoiceReference: invoiceReference }));
  }
  if (lower(status) === 'posted') {
    const prepared = await saveAccountingJournal(env, { JournalNo: `SYS-BILL-${safeDocumentId(billNo)}`, Date: payload.Date, Status: 'Posted',
      Description: payload.Description, Reference: payload.InvoiceReference || billNo, Source: 'Supplier Bill', SourceId: billNo,
      BranchId: branchId, Department: payload.Department, CostCentre: payload.CostCentre, AcademicSession: payload.AcademicSession, Term: payload.Term,
      RecordedBy: clean(body.RecordedBy), Lines: [
        { AccountCode: payload.AccountCode, Debit: amount, Credit: 0, Description: payload.Description, Department: payload.Department },
        { AccountCode: '2000', Debit: 0, Credit: amount, Description: payload.VendorName || payload.VendorId }
      ] }, true, { prepareOnly: true });
    if (lower(prepared.existing.Status) === 'posted') throw financeFailure('A journal already exists for this unposted bill. Accounts must review it.', 409);
    writes.push(financeWrite('accountingJournals', safeDocumentId(prepared.payload.JournalNo), prepared.payload, prepared.existing));
    payload.JournalNo = prepared.payload.JournalNo; payload.PostedAt = nowIso(); payload.PostedBy = clean(body.RecordedBy);
  }
  writes.push(financeWrite('accountingSupplierBills', safeDocumentId(billNo), payload, existing), accountingAuditWrite(existing.BillNo ? 'UPDATE' : 'CREATE', 'Supplier Bill', billNo, body, status));
  await batchCommitLiteralDocuments(env, writes);
  return { ok: true, message: `Supplier bill saved as ${status}.`, bill: payload };
}

async function payAccountingSupplierBill(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const billNo = clean(body.BillNo || body.billNo);
  const bill = await getDocumentByIdOrField(env, 'accountingSupplierBills', billNo, 'BillNo');
  if (!bill) throw financeFailure('Select a posted supplier bill.');
  const branchId = accountingWriteBranch(body, bill);
  const amount = financeMoney(body.Amount ?? body.amount, 'Payment amount', { min: 0.01 });
  if (!clean(body.PaymentNo || body.Reference)) throw financeFailure('Enter a unique payment reference before recording this payment.');
  const paymentNo = clean(body.PaymentNo) || await financeOperationId('VPay', branchId, billNo, clean(body.Reference));
  const paymentAccount = clean(body.PaymentAccount) || '1020';
  const date = financeDate(clean(body.Date) || nowIso().slice(0, 10), 'Payment date');
  const previous = await getDocumentByIdOrField(env, 'accountingSupplierPayments', paymentNo, 'PaymentNo');
  if (previous) {
    accountingWriteBranch(body, previous);
    if (previous.BillNo !== billNo || Number(previous.Amount) !== amount || previous.PaymentAccount !== paymentAccount || previous.Date !== date || clean(previous.Reference) !== clean(body.Reference)) throw financeFailure('This payment reference was already used with different details.', 409);
    return { ok: true, message: 'Supplier payment was already posted.', bill, payment: previous };
  }
  if (!['posted', 'part paid'].includes(lower(bill.Status))) throw financeFailure('Select a posted unpaid supplier bill.');
  const outstanding = Math.max(0, asMoneyNumber(bill.Amount) - asMoneyNumber(bill.PaidAmount));
  if (amount > outstanding + 0.005) throw financeFailure(`Payment must not exceed ${outstanding.toFixed(2)}.`);
  const prepared = await saveAccountingJournal(env, { JournalNo: `SYS-VPAY-${safeDocumentId(paymentNo)}`, Date: date, Status: 'Posted',
    Description: `Payment to ${clean(bill.VendorName || bill.VendorId)}`, Reference: clean(body.Reference) || paymentNo,
    Source: 'Supplier Payment', SourceId: paymentNo, BranchId: branchId, RecordedBy: clean(body.RecordedBy), Lines: [
      { AccountCode: '2000', Debit: amount, Credit: 0, Description: billNo },
      { AccountCode: paymentAccount, Debit: 0, Credit: amount, Description: clean(body.Method) || 'Supplier payment' }
    ] }, true, { prepareOnly: true });
  if (lower(prepared.existing.Status) === 'posted') throw financeFailure('A journal already exists without this payment record. Accounts must review it.', 409);
  const paid = asMoneyNumber(bill.PaidAmount) + amount;
  const updated = { ...bill, PaidAmount: paid, BalanceAmount: Math.max(0, asMoneyNumber(bill.Amount) - paid),
    Status: paid + 0.005 >= asMoneyNumber(bill.Amount) ? 'Paid' : 'Part Paid', LastPaymentAt: date, UpdatedAt: nowIso() };
  const payment = { PaymentNo: paymentNo, BillNo: billNo, BranchId: branchId, VendorId: clean(bill.VendorId), Date: date, Amount: amount,
    PaymentAccount: paymentAccount, Method: clean(body.Method), Reference: clean(body.Reference), JournalNo: prepared.payload.JournalNo, RecordedBy: clean(body.RecordedBy), RecordedAt: nowIso() };
  await batchCommitLiteralDocuments(env, [
    financeWrite('accountingJournals', safeDocumentId(prepared.payload.JournalNo), prepared.payload, prepared.existing),
    financeWrite('accountingSupplierBills', safeDocumentId(billNo), updated, bill),
    financeWrite('accountingSupplierPayments', safeDocumentId(paymentNo), payment),
    accountingAuditWrite('PAY', 'Supplier Bill', billNo, body, `${paymentNo}: ${amount}`)
  ]);
  return { ok: true, message: 'Supplier payment posted.', bill: updated, payment };
}

async function saveAccountingAsset(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const assetId = clean(body.AssetId || body.assetId) || ledgerDocumentId('AST');
  const existing = await getDocumentByIdOrField(env, 'accountingAssets', assetId, 'AssetId') || {};
  const branchId = accountingWriteBranch(body, existing);
  const cost = financeMoney(body.Cost ?? body.cost, 'Asset cost', { min: 0.01 });
  const residual = financeMoney(body.ResidualValue ?? body.residualValue, 'Residual value', { defaultValue: 0 });
  const life = financeMoney(body.UsefulLifeMonths ?? body.usefulLifeMonths, 'Useful life in months', { min: 1, defaultValue: 60 });
  if (!Number.isInteger(life)) throw financeFailure('Useful life must be a whole number of months.');
  if (!clean(body.Name) || cost <= 0 || residual > cost) { const err = new Error('Asset name, valid cost, and residual value are required.'); err.status = 400; throw err; }
  const accumulated = financeMoney(existing.AccumulatedDepreciation ?? body.AccumulatedDepreciation, 'Accumulated depreciation', { defaultValue: 0 });
  if (accumulated > cost - residual) throw financeFailure('Accumulated depreciation cannot exceed depreciable cost.');
  const payload = { ...existing, AssetId: assetId, BranchId: branchId, Name: clean(body.Name), Category: clean(body.Category), AcquisitionDate: financeDate(clean(body.AcquisitionDate) || nowIso().slice(0, 10), 'Acquisition date'),
    Cost: cost, ResidualValue: residual, UsefulLifeMonths: life, MonthlyDepreciation: asMoneyNumber((cost - residual) / life),
    AccumulatedDepreciation: accumulated, NetBookValue: Math.max(residual, cost - accumulated), Location: clean(body.Location), Custodian: clean(body.Custodian),
    SerialNumber: clean(body.SerialNumber), AssetAccount: clean(body.AssetAccount) || '1500', AccumulatedDepreciationAccount: clean(body.AccumulatedDepreciationAccount) || '1600',
    DepreciationExpenseAccount: clean(body.DepreciationExpenseAccount) || '6070', Status: clean(body.Status) || 'Active', Notes: clean(body.Notes),
    CreatedAt: existing.CreatedAt || nowIso(), UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) };
  if ((existing.AcquisitionJournalNo || Number(existing.AccumulatedDepreciation) > 0) &&
      ['Cost', 'ResidualValue', 'UsefulLifeMonths', 'AcquisitionDate', 'AssetAccount', 'AccumulatedDepreciationAccount', 'DepreciationExpenseAccount'].some(key => clean(payload[key]) !== clean(existing[key]))) {
    throw financeFailure('This asset has posted accounting entries. Financial values require an accounting adjustment; only descriptive details can be edited here.', 409);
  }
  const writes = [];
  if (yesNo(body.PostAcquisition) === 'YES' && !existing.AcquisitionJournalNo) {
    const prepared = await saveAccountingJournal(env, { JournalNo: `SYS-AST-${safeDocumentId(assetId)}`, Date: payload.AcquisitionDate, Status: 'Posted',
      Description: `Asset acquisition: ${payload.Name}`, Reference: clean(body.Reference) || assetId, Source: 'Asset Acquisition', SourceId: assetId,
      BranchId: branchId, RecordedBy: clean(body.RecordedBy), Lines: [
        { AccountCode: payload.AssetAccount, Debit: cost, Credit: 0, Description: payload.Name },
        { AccountCode: clean(body.PaymentAccount) || '1020', Debit: 0, Credit: cost, Description: clean(body.PaymentMethod) || 'Asset acquisition' }
      ] }, true, { prepareOnly: true });
    if (lower(prepared.existing.Status) === 'posted') throw financeFailure('An acquisition journal already exists without a linked asset. Accounts must review it.', 409);
    writes.push(financeWrite('accountingJournals', safeDocumentId(prepared.payload.JournalNo), prepared.payload, prepared.existing));
    payload.AcquisitionJournalNo = prepared.payload.JournalNo;
  }
  writes.push(financeWrite('accountingAssets', safeDocumentId(assetId), payload, existing), accountingAuditWrite(existing.AssetId ? 'UPDATE' : 'CREATE', 'Fixed Asset', assetId, body, payload.Name));
  await batchCommitLiteralDocuments(env, writes);
  return { ok: true, message: 'Fixed asset saved.', asset: payload };
}

async function postAccountingDepreciation(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const assetId = clean(body.AssetId || body.assetId);
  const asset = await getDocumentByIdOrField(env, 'accountingAssets', assetId, 'AssetId');
  if (!asset || lower(asset.Status) !== 'active') { const err = new Error('Select an active fixed asset.'); err.status = 400; throw err; }
  const branchId = accountingWriteBranch(body, asset);
  const date = financeDate(clean(body.Date) || nowIso().slice(0, 10), 'Depreciation date');
  if (asset.AcquisitionDate && date < clean(asset.AcquisitionDate)) throw financeFailure('Depreciation cannot be posted before acquisition.');
  const period = date.slice(0, 7).replace('-', '');
  const journalNo = `SYS-DEP-${safeDocumentId(assetId)}-${period}`;
  const previous = await getDocumentByIdOrField(env, 'accountingJournals', journalNo, 'JournalNo');
  if (previous) {
    if (asset.DepreciationJournalNos?.[period] === journalNo && previous.Date === date &&
        (body.Amount === undefined || clean(body.Amount) === '' || financeMoney(body.Amount, 'Depreciation amount', { min: 0.01 }) === Number(previous.TotalDebit))) {
      return { ok: true, message: 'Depreciation was already posted for this asset and month.', asset, journal: previous };
    }
    throw financeFailure('Depreciation already exists for this month. Refresh the asset; Accounts must review any unlinked historical journal.', 409);
  }
  const remaining = Math.max(0, asMoneyNumber(asset.Cost) - asMoneyNumber(asset.ResidualValue) - asMoneyNumber(asset.AccumulatedDepreciation));
  const requested = financeMoney(body.Amount, 'Depreciation amount', { min: 0.01, defaultValue: asset.MonthlyDepreciation });
  if (clean(body.Amount) && requested > remaining + 0.005) throw financeFailure('Depreciation cannot exceed the remaining depreciable value.');
  const amount = Math.min(remaining, requested);
  if (amount <= 0) { const err = new Error('This asset is fully depreciated.'); err.status = 409; throw err; }
  const prepared = await saveAccountingJournal(env, { JournalNo: journalNo, Date: date, Status: 'Posted', Description: `Depreciation: ${asset.Name}`,
    Reference: assetId, Source: 'Depreciation', SourceId: assetId, BranchId: branchId, RecordedBy: clean(body.RecordedBy), Lines: [
      { AccountCode: clean(asset.DepreciationExpenseAccount) || '6070', Debit: amount, Credit: 0, Description: asset.Name },
      { AccountCode: clean(asset.AccumulatedDepreciationAccount) || '1600', Debit: 0, Credit: amount, Description: asset.Name }
    ] }, true, { prepareOnly: true });
  if (Object.keys(prepared.existing).length) throw financeFailure('Depreciation changed while it was being posted. Refresh the asset.', 409);
  const accumulated = asMoneyNumber(asset.AccumulatedDepreciation) + amount;
  const updated = { ...asset, AccumulatedDepreciation: accumulated, NetBookValue: Math.max(asMoneyNumber(asset.ResidualValue), asMoneyNumber(asset.Cost) - accumulated),
    DepreciationJournalNos: { ...(asset.DepreciationJournalNos || {}), [period]: journalNo },
    LastDepreciationDate: date, UpdatedAt: nowIso() };
  await batchCommitLiteralDocuments(env, [
    financeWrite('accountingJournals', safeDocumentId(journalNo), prepared.payload),
    financeWrite('accountingAssets', safeDocumentId(assetId), updated, asset),
    accountingAuditWrite('DEPRECIATE', 'Fixed Asset', assetId, body, `${date}: ${amount}`)
  ]);
  return { ok: true, message: 'Depreciation posted.', asset: updated, journal: prepared.payload };
}

export function buildAccountingAdjustmentJournal(adjustment, edition = 'school') {
  const school = lower(edition) === 'school';
  const amount = asMoneyNumber(adjustment.Amount);
  const isRefund = lower(adjustment.Type).includes('refund');
  const reductionAccount = school ? '4100' : '4160';
  const receivableAccount = school ? '1100' : '1110';
  return {
    JournalNo: `SYS-ADJ-${safeDocumentId(adjustment.AdjustmentNo)}`,
    Date: adjustment.Date,
    Status: 'Posted',
    Description: `${adjustment.Type}: ${adjustment.Reason}`,
    Reference: adjustment.Reference || adjustment.AdjustmentNo,
    Source: adjustment.Type,
    SourceId: adjustment.AdjustmentNo,
    BranchId: adjustment.BranchId,
    Lines: [
      { AccountCode: reductionAccount, Debit: amount, Credit: 0, Description: adjustment.Reason },
      { AccountCode: isRefund ? adjustment.PaymentAccount : receivableAccount,
        Debit: 0, Credit: amount, Description: adjustment.AccountRef }
    ]
  };
}

function accountingAdjustmentSignature(record) {
  return JSON.stringify({ Date: clean(record.Date), Type: lower(record.Type), AccountRef: clean(record.AccountRef),
    DisplayName: clean(record.DisplayName), Amount: Number(record.Amount), Reason: clean(record.Reason),
    Reference: clean(record.Reference), PaymentAccount: clean(record.PaymentAccount) || '1020' });
}

async function saveAccountingAdjustment(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const adjustmentNo = clean(body.AdjustmentNo) || ledgerDocumentId('ADJ');
  const existing = await getDocumentByIdOrField(env, 'accountingAdjustments', adjustmentNo, 'AdjustmentNo') || {};
  const branchId = accountingWriteBranch(body, existing);
  const amount = financeMoney(body.Amount, 'Adjustment amount', { min: 0.01 });
  const type = clean(body.Type || 'Discount');
  const status = clean(body.Status || 'Draft');
  if (!['draft', 'submitted', 'approved', 'posted', 'rejected'].includes(lower(status))) throw financeFailure('Choose a valid adjustment status.');
  if (!clean(body.AccountRef) || amount <= 0 || !clean(body.Reason)) { const err = new Error('Account, amount, and reason are required.'); err.status = 400; throw err; }
  const payload = { ...existing, AdjustmentNo: adjustmentNo, BranchId: branchId, Date: financeDate(clean(body.Date) || nowIso().slice(0, 10), 'Adjustment date'), Type: type, AccountRef: clean(body.AccountRef),
    DisplayName: clean(body.DisplayName), Amount: amount, Reason: clean(body.Reason), Reference: clean(body.Reference), PaymentAccount: clean(body.PaymentAccount) || '1020',
    Status: status, RequestedBy: existing.RequestedBy || clean(body.RecordedBy), RequestedAt: existing.RequestedAt || nowIso(), UpdatedAt: nowIso() };
  const signature = accountingAdjustmentSignature(payload);
  const replay = async (record) => {
    if (!record || lower(record.Status) !== 'posted') return null;
    accountingWriteBranch(body, record);
    if (lower(status) !== 'posted' || accountingAdjustmentSignature(record) !== signature) throw financeFailure('Posted adjustments are immutable.', 409);
    const journal = clean(record.JournalNo) && await getDocumentByIdOrField(env, 'accountingJournals', record.JournalNo, 'JournalNo');
    if (!journal || lower(journal.Status) !== 'posted') throw financeFailure('This posted adjustment has no matching posted journal. Accounts must reconcile it before continuing.', 409);
    return { ok: true, replayed: true, message: `${type} was already posted.`, adjustment: financeData(record) };
  };
  const prior = await replay(existing);
  if (prior) return prior;
  const current = lower(existing.Status);
  const target = lower(status);
  const allowed = { '': ['draft', 'submitted'], draft: ['draft', 'submitted'], submitted: ['submitted', 'approved', 'rejected'],
    rejected: ['draft', 'submitted', 'rejected'], approved: ['approved', 'posted', 'rejected'] };
  if (!(allowed[current] || []).includes(target)) throw financeFailure(`Adjustment cannot move from ${existing.Status || 'New'} to ${status}. Submit and approve it before posting.`, 409);
  if (current === 'approved' && accountingAdjustmentSignature(existing) !== signature) throw financeFailure('Approved adjustment details cannot change during posting. Reject and resubmit it for a new approval first.', 409);
  const adjustmentJournal = buildAccountingAdjustmentJournal(payload, accountingEditionForRequest(env, body));
  if (['approved', 'posted', 'rejected'].includes(target)) {
    await requireAccountingApprovalLimit(env, { ...body, AccountCode: adjustmentJournal.Lines[0].AccountCode }, 'Concession', amount);
  }
  const writes = [];
  if (lower(status) === 'posted') {
    await seedAccountingChart(env);
    const prepared = await saveAccountingJournal(env, {
      ...adjustmentJournal,
      RecordedBy: clean(body.RecordedBy)
    }, true, { prepareOnly: true });
    if (prepared.existing && Object.keys(prepared.existing).length) {
      const completed = await replay(await getDocumentByIdOrField(env, 'accountingAdjustments', adjustmentNo, 'AdjustmentNo'));
      if (completed) return completed;
      throw financeFailure('A journal already exists without a completed adjustment. Accounts must reconcile it before retrying.', 409);
    }
    const journal = prepared.payload;
    writes.push(financeWrite('accountingJournals', safeDocumentId(journal.JournalNo), journal));
    payload.JournalNo = journal.JournalNo; payload.PostedAt = nowIso(); payload.PostedBy = clean(body.RecordedBy);
  }
  try {
    await batchCommitLiteralDocuments(env, [...writes,
      financeWrite('accountingAdjustments', safeDocumentId(adjustmentNo), payload, existing),
      accountingAuditWrite(existing.AdjustmentNo ? 'UPDATE' : 'CREATE', 'Concession/Refund', adjustmentNo, body, status)
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      const completed = await replay(await getDocumentByIdOrField(env, 'accountingAdjustments', adjustmentNo, 'AdjustmentNo'));
      if (completed) return completed;
      throw financeFailure('This adjustment changed during processing. Refresh and retry; no partial posting was saved.', 409, 'FINANCE_WRITE_CONFLICT');
    }
    throw error;
  }
  return { ok: true, message: `${type} saved as ${status}.`, adjustment: financeData(payload) };
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
  return rows.filter(row => financeReportWithinCutoff(row, asOf)).map((row) => {
    const balance = kind === 'receivable' ? asMoneyNumber(row.Balance ?? row.BalanceAmount) : Math.max(0, asMoneyNumber(row.Amount) - asMoneyNumber(row.PaidAmount));
    const date = clean(row.DueDate || row.Date || row.CreatedAt);
    const days = date ? Math.max(0, Math.floor((asOfMs - timestampMs(date)) / 86400000)) : 0;
    return { Reference: clean(row.InvoiceId || row.BillNo || row.__id), Party: clean(row.DisplayName || row.AccountRef || row.VendorName || row.VendorId),
      Date: date, DueDate: clean(row.DueDate), Amount: asMoneyNumber(row.Debit || row.Amount), PaidAmount: asMoneyNumber(row.PaidAmount ?? row.Credit), Balance: balance,
      ...(row.AgeingWarning ? { AgeingWarning: row.AgeingWarning } : {}),
      DaysOutstanding: days, Bucket: ageBucket(days), Department: clean(row.Department), AcademicSession: clean(row.AcademicSession), Term: clean(row.Term) };
  }).filter((row) => row.Balance > 0.005);
}

function accountingAgeingScope(rows, filter = {}) {
  // Ageing includes unpaid prior-period debt and items not yet due. The source
  // date cutoff is already applied before allocation; do not filter by DueDate.
  const scope = { AcademicSession: filter.AcademicSession, Term: filter.Term, Department: filter.Department };
  return rows.filter(row => accountingRowMatches(row, scope));
}

export function buildReceivablesAgeing(invoices, payments, asOf, filter = {}) {
  const billingIdentity = (row) => referenceIdentityKey(row.ApplicationReference || row.ApplicationID || row.AccountRef);
  const branchFor = row => lower(row.BranchId || row.branchId || 'main');
  const specificKeyFor = (row) => [branchFor(row), billingIdentity(row), row.FeeCode, row.AcademicSession, row.Term].map((value) => lower(value)).join('|');
  const generalKeyFor = (row) => [branchFor(row), billingIdentity(row), row.AcademicSession, row.Term].map((value) => lower(value)).join('|');
  const eligiblePayment = row => (!lower(row.Status) || ['paid', 'success', 'successful', 'completed'].includes(lower(row.Status)))
    && !isWalletLedger(row) && !isStorePurchase(row);
  const undatedKeys = new Set(payments.filter(row => !financeReportDate(row, true) && !financeReportWithinCutoff(row, asOf, true))
    .map(normalizePayment).filter(eligiblePayment).map(generalKeyFor));
  const specificAvailable = new Map();
  const generalAvailable = new Map();
  payments.filter(row => financeReportWithinCutoff(row, asOf, true)).map(normalizePayment).forEach((row) => {
    if (!eligiblePayment(row)) return;
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
  const rows = invoices.filter(row => financeReportWithinCutoff(row, asOf))
    .map(raw => ({ ...normalizeInvoice(financeInvoiceAsOf(raw, asOf)), Date: financeReportDate(raw) }))
    .sort((a, b) => timestampMs(a.Date || a.CreatedAt) - timestampMs(b.Date || b.CreatedAt)).map((row) => {
    const amount = asMoneyNumber(row.Debit || row.Amount);
    const currentStored = Math.min(amount, asMoneyNumber(row.Credit || row.PaidAmount));
    const storedPaid = financeStoredCreditAsOf(row, asOf, currentStored);
    const specificKey = specificKeyFor(row);
    const generalKey = generalKeyFor(row);
    let representedStored = consume(specificAvailable, specificKey, storedPaid);
    representedStored += consume(generalAvailable, generalKey, storedPaid - representedStored);
    let allocated = storedPaid;
    allocated += consume(specificAvailable, specificKey, amount - allocated);
    allocated += consume(generalAvailable, generalKey, amount - allocated);
    allocated = Math.min(amount, asMoneyNumber(allocated));
    const warning = undatedKeys.has(generalKey) ? 'Historical balance excludes receipts without a payment date; review their dates before relying on this balance.'
      : currentStored > allocated && storedPaid !== currentStored
        ? 'Historical balance reconstructed from dated receipts; later or undated stored credits were excluded.' : '';
    return { ...row, Amount: amount, PaidAmount: allocated, Balance: Math.max(0, amount - allocated), AgeingWarning: warning };
  });
  return accountingAgeingScope(buildAgeing(rows, asOf, 'receivable'), filter);
}

export function buildPayablesAgeing(bills, payments, asOf, filter = {}) {
  const paid = new Map();
  payments.filter(row => financeReportWithinCutoff(row, asOf, true)).forEach(row => {
    if (['failed', 'rejected', 'void', 'cancelled', 'reversed'].includes(lower(row.Status))) return;
    const key = `${lower(row.BranchId || 'main')}|${lower(row.BillNo)}`;
    paid.set(key, asMoneyNumber((paid.get(key) || 0) + asMoneyNumber(row.Amount)));
  });
  return accountingAgeingScope(buildAgeing(bills.filter(row => !['draft', 'rejected', 'cancelled', 'void'].includes(lower(row.Status))).map(row => {
    const currentStored = asMoneyNumber(row.PaidAmount);
    const stored = financeStoredCreditAsOf(row, asOf, currentStored);
    const amountPaid = Math.max(stored, paid.get(`${lower(row.BranchId || 'main')}|${lower(row.BillNo)}`) || 0);
    return { ...row, PaidAmount: amountPaid, AgeingWarning: currentStored > amountPaid && stored !== currentStored
      ? 'Historical balance reconstructed from dated payments; later or undated stored payments were excluded.' : '' };
  }), asOf, 'payable'), filter);
}

async function importAccountingBankStatement(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const branchId = accountingWriteBranch(body);
  const bankId = clean(body.BankId || body.bankId);
  const bank = await getDocumentByIdOrField(env, 'accountingBanks', bankId, 'BankId');
  if (!bank) throw financeFailure('Choose an existing bank account.');
  accountingWriteBranch(body, bank);
  const accountCode = clean(body.AccountCode || body.accountCode || bank.AccountCode) || '1020';
  if (!sameText(bank.AccountCode, accountCode)) throw financeFailure('The statement account must match the selected bank account.');
  const sourceRows = Array.isArray(body.Rows || body.rows) ? (body.Rows || body.rows) : [];
  if (!bankId || !sourceRows.length) throw financeFailure('Bank account and statement rows are required.');
  if (sourceRows.length > 500) throw financeFailure('Import at most 500 bank statement rows at a time.', 413);
  const cursor = Number(body.Cursor ?? 0);
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= sourceRows.length) throw financeFailure('The bank statement import cursor is invalid.');
  const normalized = sourceRows.map((row, index) => {
    const date = financeDate(row?.Date ?? row?.date, `Statement row ${index + 2} date`);
    const reference = clean(row.Reference || row.reference || row.TransactionId || row.transactionId);
    const debit = financeMoney(row.Debit ?? row.debit ?? row.Withdrawal ?? row.withdrawal, `Statement row ${index + 2} debit`, { defaultValue: 0 });
    const credit = financeMoney(row.Credit ?? row.credit ?? row.Deposit ?? row.deposit, `Statement row ${index + 2} credit`, { defaultValue: 0 });
    if ((debit > 0) === (credit > 0)) throw financeFailure(`Statement row ${index + 2} needs either a positive debit or credit.`);
    const amount = asMoneyNumber(credit - debit);
    return { StatementItemId: safeDocumentId(`${bankId}-${date}-${reference || index}-${amount.toFixed(2)}`), BranchId: branchId,
      BankId: bankId, AccountCode: accountCode, Date: date, Reference: reference,
      Description: clean(row.Description || row.description || row.Narration || row.narration), Debit: debit, Credit: credit, Amount: amount };
  });
  if (new Set(normalized.map(row => row.StatementItemId)).size !== normalized.length) throw financeFailure('The file contains duplicate statement transaction references.');
  const rows = normalized.slice(cursor, cursor + 10);
  const dates = rows.map(row => row.Date).sort();
  const journalRows = await queryCollection(env, 'accountingJournals', { filters: [
    { field: 'Date', op: '>=', value: dates[0] }, { field: 'Date', op: '<=', value: dates.at(-1) }
  ], limit: 1001 });
  // A capped search may still import safely, but cannot claim a unique match.
  const journals = journalRows.length < 1001 ? accountingRowsForBranch(journalRows, branchId).filter(journal => lower(journal.Status) === 'posted') : [];
  const cashMovements = journals.map(journal => ({ journal, JournalNo: clean(journal.JournalNo), Date: clean(journal.Date), Reference: clean(journal.Reference),
    Amount: asMoneyNumber(accountingLines(journal.Lines).filter(line => sameText(line.AccountCode, accountCode)).reduce((sum, line) => sum + Number(line.Debit || 0) - Number(line.Credit || 0), 0)) }));
  const matches = row => cashMovements.filter(move => Math.abs(move.Amount - row.Amount) <= 0.005 && (row.Reference ? sameText(move.Reference, row.Reference) : move.Date === row.Date));
  let imported = 0; let matched = 0; let skipped = 0; const writes = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const id = row.StatementItemId;
    const existing = await getDocument(env, 'accountingBankStatementItems', id);
    if (existing) { accountingWriteBranch(body, existing); skipped += 1; continue; }
    const candidates = matches(row);
    let exact = candidates.length === 1 ? candidates[0] : null;
    // Consider the entire uploaded file, including later continuation pages.
    if (exact && normalized.filter(other => matches(other).some(move => move.JournalNo === exact.JournalNo)).length !== 1) exact = null;
    if (exact) {
      const claimId = await financeOperationId('BANKMATCH', branchId, accountCode, exact.JournalNo);
      const [claim, legacy] = await Promise.all([
        getDocument(env, 'accountingBankMatchClaims', claimId),
        queryCollection(env, 'accountingBankStatementItems', { filters: [{ field: 'MatchedJournalNo', op: '==', value: exact.JournalNo }], limit: 21 })
      ]);
      if (claim || legacy.length > 20 || legacy.some(item => sameText(item.AccountCode, accountCode) && lower(item.Status) === 'matched')) exact = null;
      else {
        writes.push(financeWrite('accountingBankMatchClaims', claimId, { ClaimId: claimId, BranchId: branchId, AccountCode: accountCode, JournalNo: exact.JournalNo, StatementItemId: id }));
        writes.push({ ...financeWrite('accountingJournals', safeDocumentId(exact.JournalNo), { BankMatchCheckedAt: nowIso() }, exact.journal), updateMask: ['BankMatchCheckedAt'] });
      }
    }
    const payload = { ...row, Status: exact ? 'Matched' : 'Unmatched', MatchedJournalNo: exact ? exact.JournalNo : '', ImportedAt: nowIso(), ImportedBy: clean(body.RecordedBy) };
    writes.push(financeWrite('accountingBankStatementItems', id, payload));
    imported += 1; if (exact) matched += 1;
  }
  if (writes.length) await batchCommitLiteralDocuments(env, [...writes, accountingAuditWrite('IMPORT', 'Bank Statement', bankId, body, `${imported} rows; ${matched} matched`)]);
  const nextCursor = cursor + rows.length;
  return { ok: true, message: `Imported ${imported} statement row(s); ${matched} matched automatically; ${skipped} already imported.`, imported, matched, skipped,
    progress: { cursor, nextCursor: nextCursor < normalized.length ? nextCursor : null, complete: nextCursor >= normalized.length, total: normalized.length, processed: rows.length, limit: 10 } };
}

async function matchAccountingBankStatement(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const itemId = clean(body.StatementItemId);
  const journalNo = clean(body.JournalNo);
  const item = await getDocumentByIdOrField(env, 'accountingBankStatementItems', itemId, 'StatementItemId');
  if (!item) { const err = new Error('Statement item was not found.'); err.status = 404; throw err; }
  const branchId = accountingWriteBranch(body, item);
  const journalRecord = await getDocumentByIdOrField(env, 'accountingJournals', journalNo, 'JournalNo');
  const journal = accountingRowsForBranch(journalRecord ? [journalRecord] : [], branchId)[0];
  if (!journal) { const err = new Error('Statement item or journal was not found.'); err.status = 404; throw err; }
  if (lower(journal.Status) !== 'posted') throw financeFailure('Only a posted journal can be matched to a bank statement.', 409);
  if (lower(item.Status) === 'matched') {
    if (sameText(item.MatchedJournalNo, journalNo)) return { ok: true, message: 'Statement item was already matched.', item };
    throw financeFailure('This statement item is already matched to another journal.', 409);
  }
  const cashMovement = accountingLines(journal.Lines).filter((line) => sameText(line.AccountCode, item.AccountCode))
    .reduce((sum, line) => sum + asMoneyNumber(line.Debit) - asMoneyNumber(line.Credit), 0);
  if (Math.abs(cashMovement - asMoneyNumber(item.Amount)) > 0.005) {
    const err = new Error('The selected journal cash movement does not match the statement amount.'); err.status = 409; throw err;
  }
  const claimId = await financeOperationId('BANKMATCH', branchId, item.AccountCode, journalNo);
  const [claim, legacy] = await Promise.all([
    getDocument(env, 'accountingBankMatchClaims', claimId),
    queryCollection(env, 'accountingBankStatementItems', { filters: [{ field: 'MatchedJournalNo', op: '==', value: journalNo }], limit: 21 })
  ]);
  if ((claim && !sameText(claim.StatementItemId, itemId)) || legacy.length > 20 || legacy.some(row => !sameText(row.StatementItemId, itemId) && sameText(row.AccountCode, item.AccountCode) && lower(row.Status) === 'matched')) throw financeFailure('This journal cash movement is already matched to another statement item.', 409);
  const updated = { ...item, Status: 'Matched', MatchedJournalNo: journalNo, MatchedAt: nowIso(), MatchedBy: clean(body.RecordedBy) };
  await batchCommitLiteralDocuments(env, [
    financeWrite('accountingBankStatementItems', safeDocumentId(itemId), updated, item),
    ...(!claim ? [financeWrite('accountingBankMatchClaims', claimId, { ClaimId: claimId, BranchId: branchId, AccountCode: item.AccountCode, JournalNo: journalNo, StatementItemId: itemId })] : []),
    { ...financeWrite('accountingJournals', safeDocumentId(journalNo), { BankMatchCheckedAt: nowIso() }, journal), updateMask: ['BankMatchCheckedAt'] },
    accountingAuditWrite('MATCH', 'Bank Statement Item', itemId, body, journalNo)
  ]);
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

function calculateCashPosition(trialBalance = []) {
  return trialBalance.filter((row) => sameText(row.Group, 'Cash and Bank')).reduce((sum, row) => sum + row.Debit - row.Credit, 0);
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

export function buildAccountingReport(chart, journals, expenses, budgets, filter = {}, invoices = [], payments = []) {
  journals = financeDepartmentJournals(journals, filter.Department);
  const periodJournals = journals.filter((row) => accountingRowMatches(row, filter, false));
  const asOfJournals = journals.filter((row) => accountingRowMatches(row, filter, true));
  const trialBalance = aggregateAccountingBalances(chart, periodJournals);
  const asOfTrialBalance = aggregateAccountingBalances(chart, asOfJournals);
  const revenueRows = trialBalance.filter((row) => lower(row.Type) === 'revenue');
  const otherIncomeRows = revenueRows.filter((row) => sameText(row.Group, 'Other Income'));
  const contraRevenueRows = revenueRows.filter((row) =>
    sameText(row.Group, 'Contra Revenue') || row.AccountCode === '4100'
  );
  // Custom revenue groups are common in non-school editions (for example,
  // Church Revenue). Treat every revenue account that is not explicitly
  // classified as Other Income or Contra Revenue as gross operating revenue.
  const grossRevenueRows = revenueRows.filter((row) =>
    !otherIncomeRows.includes(row) && !contraRevenueRows.includes(row)
  );
  const grossRevenue = grossRevenueRows.reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const otherIncome = otherIncomeRows.reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const concessions = contraRevenueRows.reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const netRevenue = grossRevenue - concessions;
  const totalIncome = netRevenue + otherIncome;
  const expenseRows = trialBalance.filter((row) => lower(row.Type) === 'expense');
  const directCosts = expenseRows.filter((row) => clean(row.Group) === 'Direct Cost').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const totalExpenses = expenseRows.reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const assets = asOfTrialBalance.filter((row) => lower(row.Type) === 'asset').reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const liabilities = asOfTrialBalance.filter((row) => lower(row.Type) === 'liability').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  const postedEquity = asOfTrialBalance.filter((row) => lower(row.Type) === 'equity').reduce((sum, row) => sum + row.Credit - row.Debit, 0);
  // Revenue and expense accounts remain open until a closing journal transfers
  // their net balance into a posted equity account. Present that unclosed net
  // balance as equity in the statement of financial position as of DateTo.
  const unclosedEarnings = asMoneyNumber(asOfTrialBalance.reduce((sum, row) => {
    if (lower(row.Type) === 'revenue') return sum + row.Credit - row.Debit;
    if (lower(row.Type) === 'expense') return sum - row.Debit + row.Credit;
    return sum;
  }, 0));
  const equity = asMoneyNumber(postedEquity + unclosedEarnings);
  const balanceSheetEquity = asOfTrialBalance.filter((row) => lower(row.Type) === 'equity');
  if (Math.abs(unclosedEarnings) > 0.005) {
    balanceSheetEquity.push({
      AccountCode: 'UN-CLOSED-EARNINGS', AccountName: 'Unclosed earnings (cumulative)',
      Type: 'Equity', Group: 'Current Earnings',
      Debit: Math.max(0, -unclosedEarnings), Credit: Math.max(0, unclosedEarnings),
      Balance: -unclosedEarnings
    });
  }
  const cashPosition = calculateCashPosition(asOfTrialBalance);
  const receivables = asOfTrialBalance.filter((row) => sameText(row.Group, 'Receivables'))
    .reduce((sum, row) => sum + row.Debit - row.Credit, 0);
  const outstandingInvoiceReceivables = buildReceivablesAgeing(
    Array.isArray(invoices) ? invoices : [],
    payments, filter.DateTo || nowIso().slice(0, 10), filter
  ).reduce((sum, invoice) => sum + invoice.Balance, 0);
  const resolvedReceivables = Math.max(0, receivables > 0.005 ? receivables : outstandingInvoiceReceivables);
  const filteredExpenses = expenses.filter((row) => accountingRowMatches(row, filter));
  const budgetVsActual = buildBudgetVsActual(budgets, periodJournals, filter);
  const postedExpense = filteredExpenses.filter((row) => ['posted', 'paid'].includes(lower(row.Status))).reduce((sum, row) => sum + asMoneyNumber(row.Amount), 0);
  const budgetTotal = budgetVsActual.reduce((sum, row) => sum + asMoneyNumber(row.Amount), 0);
  const budgetActual = budgetVsActual.reduce((sum, row) => sum + asMoneyNumber(row.Actual), 0);
  return {
    dashboard: { GrossRevenue: grossRevenue, OtherIncome: otherIncome, Concessions: concessions, NetRevenue: netRevenue, TotalIncome: totalIncome, DirectCosts: directCosts,
      GrossSurplus: netRevenue - directCosts, TotalExpenditure: totalExpenses, NetSurplus: totalIncome - totalExpenses,
      Assets: assets, Liabilities: liabilities, Equity: equity, UnclosedEarnings: unclosedEarnings,
      PostedExpenses: postedExpense, BudgetTotal: budgetTotal,
      CashPosition: cashPosition, Receivables: resolvedReceivables, BudgetRemaining: asMoneyNumber(budgetTotal - budgetActual) },
    filter, trialBalance, asOfTrialBalance, budgetVsActual,
    ...(filter.Department ? { scopeNotice: 'Department movements only; unallocated balancing entries and other departments are excluded. This is not a complete organisation balance sheet.' } : {}),
    incomeStatement: { revenue: revenueRows, expenses: expenseRows },
    balanceSheet: { assets: asOfTrialBalance.filter((r) => lower(r.Type) === 'asset'), liabilities: asOfTrialBalance.filter((r) => lower(r.Type) === 'liability'), equity: balanceSheetEquity }
  };
}

export function buildGatewayCollectionsReport(
  formSales = [],
  gatewayCharges = [],
  filter = {},
  payments = [],
  donations = []
) {
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
  const chargeByReference = new Map(
    charges
      .filter((row) => clean(row.Reference))
      .map((row) => [lower(row.Reference), row])
  );
  const transactionByReference = new Map();
  const addTransaction = (row, fallbackKey = '') => {
    const reference = clean(row.Reference);
    const key = lower(reference || fallbackKey || `${row.ReceiptNo}|${row.Date}|${row.GrossCollection}`);
    if (!key || transactionByReference.has(key)) return;
    transactionByReference.set(key, {
      Date: clean(row.Date).slice(0, 10),
      ReceiptNo: clean(row.ReceiptNo),
      ApplicantName: clean(row.ApplicantName),
      PaymentMethod: clean(row.PaymentMethod),
      Reference: reference,
      GrossCollection: asMoneyNumber(row.GrossCollection),
      PaystackCharge: asMoneyNumber(row.PaystackCharge),
      NetRevenue: asMoneyNumber(row.NetRevenue),
      Currency: clean(row.Currency) || 'NGN',
      Source: clean(row.Source)
    });
  };
  sales.forEach((row) => addTransaction({ ...row, Source: 'Admission Form' }));
  payments
    .filter((row) => accountingRowMatches({
      ...row,
      Date: row.PaidAt || row.PaymentDate || row.Date || row.CreatedAt
    }, filter))
    .map(normalizePayment)
    .forEach((payment) => {
      const reference = clean(payment.Reference || payment.GatewayReference || payment.PaymentId);
      const charge = chargeByReference.get(lower(reference)) || {};
      const online = Boolean(clean(charge.Reference))
        || /paystack|online|card/i.test(`${payment.Gateway} ${payment.Method}`);
      if (!online) return;
      const gross = asMoneyNumber(charge.GrossCollection || payment.GrossAmount || payment.Amount);
      const fee = asMoneyNumber(charge.PaystackCharge || payment.GatewayFee);
      const net = asMoneyNumber(charge.NetSettlement || paymentCreditedAmount(payment) || Math.max(0, gross - fee));
      addTransaction({
        Date: payment.Date || payment.PaidAt || payment.PaymentDate,
        ReceiptNo: payment.ReceiptNo || payment.PaymentId,
        ApplicantName: payment.DisplayName || payment.ApplicantName || payment.AccountRef || payment.AdmissionNo,
        PaymentMethod: payment.Gateway || payment.Method || 'Online',
        Reference: reference,
        GrossCollection: gross,
        PaystackCharge: fee,
        NetRevenue: net,
        Currency: payment.Currency,
        Source: 'Fee Payment'
      });
    });
  donations
    .filter((row) => lower(row.Status) === 'paid' && accountingRowMatches({
      ...row,
      Date: row.PaidAt || row.Date || row.UpdatedAt || row.CreatedAt
    }, filter))
    .forEach((donation) => {
      const reference = clean(donation.Reference || donation.GatewayReference || donation.DonationId || donation.__id);
      const charge = chargeByReference.get(lower(reference)) || {};
      const online = Boolean(clean(charge.Reference))
        || /paystack|online|card/i.test(`${donation.Gateway} ${donation.PaymentMethod}`);
      if (!online) return;
      const gross = asMoneyNumber(charge.GrossCollection || donation.GrossAmount || donation.Amount);
      const fee = asMoneyNumber(charge.PaystackCharge || donation.GatewayFee);
      const net = asMoneyNumber(charge.NetSettlement || donation.NetAmount || Math.max(0, gross - fee));
      addTransaction({
        Date: donation.PaidAt || donation.Date || donation.UpdatedAt || donation.CreatedAt,
        ReceiptNo: donation.ReceiptNo || donation.DonationId,
        ApplicantName: donation.DonorName || donation.DonorEmail || 'Donor',
        PaymentMethod: donation.Gateway || donation.PaymentMethod || 'Online',
        Reference: reference,
        GrossCollection: gross,
        PaystackCharge: fee,
        NetRevenue: net,
        Currency: donation.Currency,
        Source: 'Church Donation'
      });
    });
  charges.forEach((charge) => addTransaction({
    Date: charge.Date,
    ReceiptNo: charge.Reference || charge.Source,
    ApplicantName: charge.Source || 'Online payer',
    PaymentMethod: 'Paystack',
    Reference: charge.Reference,
    GrossCollection: charge.GrossCollection,
    PaystackCharge: charge.PaystackCharge,
    NetRevenue: charge.NetSettlement,
    Currency: charge.Currency || 'NGN',
    Source: charge.Source
  }, charge.Reference || charge.Description));
  const onlineTransactions = [...transactionByReference.values()]
    .sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
  const admissionFormSales = sales.sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
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
    // Keep the legacy field populated with the complete register so installed
    // desktop builds receive the fix without requiring an immediate rebuild.
    formSales: onlineTransactions,
    admissionFormSales,
    onlineTransactions,
    gatewayCharges: charges.sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)))
  };
}

async function getAccountingOverview(env, body = {}) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management', ...DEPARTMENT_ACCOUNTING_ROLES]);
  const edition = accountingEditionForRequest(env, body);
  const branchId = accountingRequestBranch(body);
  const branchRows = (rows) => accountingRowsForBranch(rows, branchId);
  if (isDepartmentAccountingUser(body)) {
    const department = accountingDepartment(body);
    if (!department) { const err = new Error('A department must be assigned to this user.'); err.status = 403; throw err; }
    await seedAccountingChart(env);
    const [chart, expenses, budgets, vendors, supplierBills, imprests] = await Promise.all([
      listCollection(env, 'chartOfAccounts'), loadBranchFinanceRows(env, 'accountingExpenses', branchId), loadBranchFinanceRows(env, 'accountingBudgets', branchId),
      loadBranchFinanceRows(env, 'accountingVendors', branchId), loadBranchFinanceRows(env, 'accountingSupplierBills', branchId), loadBranchFinanceRows(env, 'accountingImprests', branchId)
    ]);
    return {
      ok: true, message: `${department} requisitions and bills loaded.`, synchronized: 0,
      canEditRequisitions: canEditRequisitions(accountingRequisitionActor(body)),
      branchId, chart: accountingChartForEdition(chart, edition), expenses: branchRows(expenses).filter((row) => sameText(row.Department, department)),
      budgets: branchRows(budgets).filter((row) => sameText(row.Department, department)), vendors: branchRows(vendors),
      supplierBills: branchRows(supplierBills).filter((row) => sameText(row.Department, department)),
      imprests: branchRows(imprests).filter((row) => sameText(row.Department, department)),
      journals: [], banks: [], reconciliations: [], periods: [], audit: [], supplierPayments: [], assets: [], adjustments: [],
      approvalLimits: [], closeChecklist: [], bankStatementItems: [], donations: [], reports: {}
    };
  }
  // Keep the overview read-only. Revenue synchronization and accounting setup
  // can perform many Firestore reads/writes and previously ran on every refresh,
  // causing Cloudflare Workers to exceed their per-request subrequest quota.
  // Administrators can still run the explicit "Synchronize Revenue" action.
  const synchronized = 0;
  const pagedFinance = body.FinancePagination === 'paged';
  const pagedJournals = pagedFinance || body.JournalPagination === 'paged';
  // Leave a small clock-skew margin so Firestore never sees a future readTime.
  const reportReadTime = pagedJournals ? new Date(Date.now() - 2000).toISOString() : '';
  const snapshotQuery = reportReadTime ? { query: `readTime=${encodeURIComponent(reportReadTime)}` } : undefined;
  // Reference settings remain organisation-wide; operational records do not.
  const sharedCollections = new Set(['chartOfAccounts', 'accountingPeriods', 'accountingApprovalLimits',
    PAYROLL_TAX_COLLECTIONS.profiles, PAYROLL_TAX_COLLECTIONS.components, PAYROLL_TAX_COLLECTIONS.bands,
    PAYROLL_TAX_COLLECTIONS.reliefs, PAYROLL_TAX_COLLECTIONS.mappings]);
  const listSnapshot = (collection) => sharedCollections.has(collection)
    ? listCollection(env, collection, snapshotQuery)
    : loadBranchFinanceRows(env, collection, branchId, { readTime: reportReadTime });
  const reportSnapshot = collection => loadBranchFinanceRows(env, collection, branchId, { report: true, readTime: reportReadTime });
  const optionalSnapshot = (collection) => listSnapshot(collection).catch((error) => {
    if (pagedFinance) throw error; // Never silently omit a financial source in a complete snapshot.
    return [];
  });
  const [chart, journals, expenses, budgets, banks, reconciliations, periods, audit, vendors, supplierBills, supplierPayments, imprests, assets, adjustments, approvalLimits, closeChecklist, bankStatementItems, invoices, payments, formSales, gatewayCharges, payrollProfiles, payrollRuns, payrollItems, payrollPayments, payrollAudit, payrollTaxProfiles, payrollTaxOverrides, payrollSalaryComponents, payrollTaxBands, payrollTaxReliefs, payrollLedgerMappings, donations] = await Promise.all([
    listSnapshot('chartOfAccounts'), pagedJournals ? [] : reportSnapshot('accountingJournals'), listSnapshot('accountingExpenses'),
    listSnapshot('accountingBudgets'), listSnapshot('accountingBanks'), listSnapshot('accountingReconciliations'),
    listSnapshot('accountingPeriods'), listSnapshot('accountingAudit'), listSnapshot('accountingVendors'),
    listSnapshot('accountingSupplierBills'), listSnapshot('accountingSupplierPayments'), optionalSnapshot('accountingImprests'), listSnapshot('accountingAssets'),
    listSnapshot('accountingAdjustments'), listSnapshot('accountingApprovalLimits'), listSnapshot('accountingCloseChecklist'),
    listSnapshot('accountingBankStatementItems'), pagedFinance ? [] : reportSnapshot('invoices'), pagedFinance ? [] : reportSnapshot('payments'),
    optionalSnapshot('formSales'), optionalSnapshot('paymentGatewayCharges'),
    listSnapshot('payrollProfiles'), listSnapshot('payrollRuns'), listSnapshot('payrollItems'),
    listSnapshot('payrollPayments'), listSnapshot('payrollAudit'), optionalSnapshot(PAYROLL_TAX_COLLECTIONS.profiles), optionalSnapshot(PAYROLL_TAX_COLLECTIONS.overrides),
    optionalSnapshot(PAYROLL_TAX_COLLECTIONS.components), optionalSnapshot(PAYROLL_TAX_COLLECTIONS.bands),
    optionalSnapshot(PAYROLL_TAX_COLLECTIONS.reliefs), optionalSnapshot(PAYROLL_TAX_COLLECTIONS.mappings),
    listChurchDonationsForAccounting(env, { readTime: reportReadTime, branchId })
  ]);
  const scopedJournalsByBranch = branchRows(journals);
  const scopedExpenses = branchRows(expenses);
  const scopedBudgets = branchRows(budgets);
  const scopedBanks = branchRows(banks);
  const scopedReconciliations = branchRows(reconciliations);
  const scopedAudit = branchRows(audit);
  const scopedVendors = branchRows(vendors);
  const scopedSupplierBills = branchRows(supplierBills);
  const scopedSupplierPayments = branchRows(supplierPayments);
  const scopedImprests = branchRows(imprests);
  const scopedAssets = branchRows(assets);
  const scopedAdjustments = branchRows(adjustments);
  const scopedCloseChecklist = branchRows(closeChecklist);
  const scopedBankStatementItems = branchRows(bankStatementItems);
  const scopedInvoices = branchRows(invoices);
  const scopedPayments = branchRows(payments);
  const scopedFormSales = branchRows(formSales);
  const scopedGatewayCharges = branchRows(gatewayCharges);
  const scopedPayrollProfiles = (await withStaffEmployment(env, branchRows(payrollProfiles)))
    .map(row => employmentPayrollProfile(row, row));
  const scopedPayrollRuns = branchRows(payrollRuns);
  const scopedPayrollItems = branchRows(payrollItems);
  const scopedPayrollPayments = branchRows(payrollPayments);
  const scopedPayrollAudit = branchRows(payrollAudit);
  const scopedPayrollTaxOverrides = branchRows(payrollTaxOverrides);
  const scopedDonations = branchRows(donations);
  const filter = accountingFilter(body);
  const scopedChart = accountingChartForEdition(chart, edition);
  const scopedJournals = accountingJournalsForEdition(scopedJournalsByBranch, edition);
  const finalizedPayrollRunIds = new Set(scopedPayrollRuns.filter((row) => ['approved', 'posted', 'part paid', 'paid', 'finalized'].includes(lower(row.Status))).map((row) => lower(row.RunId)));
  const taxProfileUsage = {};
  scopedPayrollItems.filter((row) => finalizedPayrollRunIds.has(lower(row.RunId))).forEach((row) => { const id = clean(row.TaxProfileId || row.ConfigurationSnapshot?.TaxProfile?.ProfileId); if (id) taxProfileUsage[id] = (taxProfileUsage[id] || 0) + 1; });
  const payrollTaxProfilesWithUsage = payrollTaxProfiles.map((row) => ({ ...row, UsageCount: taxProfileUsage[clean(row.ProfileId || row.__id)] || 0 }));
  const reports = buildAccountingReport(scopedChart, scopedJournals, scopedExpenses, scopedBudgets, filter, scopedInvoices, scopedPayments);
  reports.receivablesAgeing = buildReceivablesAgeing(scopedInvoices, scopedPayments, filter.DateTo || nowIso().slice(0, 10), filter);
  reports.payablesAgeing = buildPayablesAgeing(scopedSupplierBills, scopedSupplierPayments, filter.DateTo || nowIso().slice(0, 10), filter);
  const gatewayReport = buildGatewayCollectionsReport(scopedFormSales, scopedGatewayCharges, filter, scopedPayments, scopedDonations);
  return { ok: true, message: `Finance and accounting records loaded for ${branchId === 'all' ? 'all branches' : `branch ${branchId}`}.`, synchronized, branchId, filter, ...(pagedJournals ? { journalPagination: { readTime: reportReadTime } } : {}), canEditRequisitions: canEditRequisitions(accountingRequisitionActor(body)), chart: scopedChart, journals: scopedJournals, expenses: scopedExpenses, budgets: scopedBudgets, banks: scopedBanks, reconciliations: scopedReconciliations, periods, audit: scopedAudit,
    vendors: scopedVendors, supplierBills: scopedSupplierBills, supplierPayments: scopedSupplierPayments, imprests: scopedImprests, assets: scopedAssets, adjustments: scopedAdjustments, approvalLimits, closeChecklist: scopedCloseChecklist, bankStatementItems: scopedBankStatementItems,
    payrollProfiles: scopedPayrollProfiles, payrollRuns: scopedPayrollRuns, payrollItems: scopedPayrollItems, payrollPayments: scopedPayrollPayments, payrollAudit: scopedPayrollAudit, payrollTaxProfiles: payrollTaxProfilesWithUsage, payrollTaxOverrides: scopedPayrollTaxOverrides,
    payrollSalaryComponents, payrollTaxBands, payrollTaxReliefs, payrollLedgerMappings, donations: scopedDonations,
    ...(pagedFinance ? {
      financePagination: { readTime: reportReadTime, collections: ['journals', 'invoices', 'payments'],
        asOf: filter.DateTo || reportReadTime.slice(0, 10) },
      gatewayReport: null, gatewayReportSeed: gatewayReport,
      gatewayDonationSeed: buildGatewayCollectionsReport([], scopedGatewayCharges, filter, [], scopedDonations)
    } : { gatewayReport }),
    ...(pagedJournals ? { reportSeed: reports, reports: null } : { reports }) };
}

async function getAccountingRequisitionDocument(env, body = {}) {
  requireAccountingRole(
    body,
    ['Super Admin', 'Accounts Officer', 'Management', ...DEPARTMENT_ACCOUNTING_ROLES],
    'Your role is not allowed to view this requisition document.'
  );
  const expenseNo = clean(body.ExpenseNo || body.expenseNo || body.RecordId || body.recordId);
  if (!expenseNo) {
    const err = new Error('Select a requisition first.');
    err.status = 400;
    throw err;
  }
  const record = accountingRowsForBranch(await listCollection(env, 'accountingExpenses'), accountingRequestBranch(body))
    .find((row) => sameText(row.ExpenseNo, expenseNo) || sameText(row.__id, safeDocumentId(expenseNo)));
  if (!record) {
    const err = new Error('The selected requisition was not found.');
    err.status = 404;
    throw err;
  }
  if (isDepartmentAccountingUser(body) && !sameText(record.Department, accountingDepartment(body))) {
    const err = new Error('You cannot view another department\'s requisition.');
    err.status = 403;
    throw err;
  }
  const endorsement = (stage) => getDocument(
    env,
    'financeDocumentEndorsements',
    safeDocumentId(`${expenseNo}-${stage}`)
  ).catch(() => null);
  const [approval, admin, accounts, management, adminReview, director, posting] = await Promise.all([
    endorsement('approval'),
    endorsement('admin'),
    endorsement('accounts'),
    endorsement('management'),
    endorsement('admin-review'),
    endorsement('director'),
    endorsement('posting')
  ]);
  return {
    ok: true,
    message: 'Requisition document loaded.',
    record: { ...record, EditHistory: await resolvedRequisitionEditHistory(record,
      revision => getDocument(env, 'accountingExpenseRevisions', safeDocumentId(`${record.ExpenseNo}-REV-${String(revision).padStart(3, '0')}`))) },
    endorsements: { approval, admin, accounts, management, 'admin-review': adminReview, director, posting }
  };
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

const PAYROLL_BULK_ACTION_LIMIT = 15;
const PAYROLL_GENERATION_PROFILE_LIMIT = 250;

async function commitDocumentWritesInChunks(env, writes, size = 400) {
  const items = Array.isArray(writes) ? writes : [];
  for (let index = 0; index < items.length; index += size) {
    await batchCommitDocuments(env, items.slice(index, index + size));
  }
}

async function writePayrollAudit(env, action, entityType, entityId, body, details = '') {
  const auditId = ledgerDocumentId('PAYAUD');
  await upsertDocument(env, 'payrollAudit', safeDocumentId(auditId), {
    AuditId: auditId, Timestamp: nowIso(), Action: clean(action), EntityType: clean(entityType), EntityId: clean(entityId),
    UserRole: clean(body.UserRole || body.userRole), UserName: clean(body.RecordedBy || body.UpdatedBy),
    BranchId: accountingWriteBranch(body), Details: clean(details)
  });
}

async function savePayrollProfile(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const employeeId = clean(body.EmployeeId || body.employeeId) || ledgerDocumentId('EMP');
  const profiles = await listCollection(env, 'payrollProfiles');
  const existing = profiles.find((row) => sameText(row.EmployeeId, employeeId) || sameText(row.__id, safeDocumentId(employeeId))) || {};
  const branchId = accountingWriteBranch(body, existing);
  const username = clean(body.Username || body.username);
  const displayName = clean(body.DisplayName || body.displayName || body.Name);
  const profileValues = payrollProfileValues(body, existing);
  const basicSalary = profileValues.BasicSalary;
  if (!username || !displayName || basicSalary < 0) {
    const err = new Error('Staff username, display name, and a valid basic salary are required.'); err.status = 400; throw err;
  }
  if (accountingRowsForBranch(profiles, branchId).some((row) => !sameText(row.EmployeeId, employeeId) && sameText(row.Username, username))) {
    const err = new Error('That staff username is already linked to another payroll profile.'); err.status = 409; throw err;
  }
  const payload = {
    ...existing, EmployeeId: employeeId, BranchId: branchId, Username: username, DisplayName: displayName,
    ...profileValues,
    CalculationMode: clean(body.CalculationMode || existing.CalculationMode || 'LEGACY_FLAT_RATE').toUpperCase(),
    ComponentAssignments: profileValues.ComponentAssignments,
    TaxStatus: clean(body.TaxStatus || existing.TaxStatus || 'TAXABLE').toUpperCase(), TaxJurisdiction: clean(body.TaxJurisdiction || existing.TaxJurisdiction || 'FCT'),
    TaxProfileId: clean(body.TaxProfileId ?? existing.TaxProfileId), TIN: clean(body.TIN ?? existing.TIN),
    PensionParticipating: yesNo(body.PensionParticipating ?? existing.PensionParticipating ?? (profileValues.PensionRate > 0 ? 'YES' : 'NO')),
    PensionScheme: clean(body.PensionScheme ?? existing.PensionScheme),
    NhfParticipating: yesNo(body.NhfParticipating ?? existing.NhfParticipating ?? 'NO'),
    AdditionalReliefs: profileValues.AdditionalReliefs,
    BeginningYearCumulative: profileValues.BeginningYearCumulative,
    Active: yesNo(profileValues.Active) || 'YES',
    CreatedAt: existing.CreatedAt || nowIso(), CreatedBy: existing.CreatedBy || clean(body.RecordedBy),
    UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy)
  };
  if (!['LEGACY_FLAT_RATE', 'CONFIGURABLE_PAYE'].includes(payload.CalculationMode)) { const err = new Error('Choose Legacy Flat Rate or Configurable PAYE calculation mode.'); err.status = 400; throw err; }
  if (!['TAXABLE', 'EXEMPT', 'TAX_EXEMPT'].includes(payload.TaxStatus)) { const err = new Error('Choose a valid employee tax status.'); err.status = 400; throw err; }
  if (!Object.hasOwn(profileValues, 'PensionRateOverride')) delete payload.PensionRateOverride;
  delete payload.__id; delete payload.__name;
  await upsertDocument(env, 'payrollProfiles', safeDocumentId(employeeId), payload);
  await writePayrollAudit(env, existing.EmployeeId ? 'UPDATE' : 'CREATE', 'Payroll Profile', employeeId, body, displayName);
  return { ok: true, message: 'Payroll profile saved.', profile: payload };
}

async function createPayrollProfilesFromStaff(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const branchId = accountingRequestBranch(body);
  const [allStaffUsers, allProfiles] = await Promise.all([
    listCollection(env, 'staffUsers'),
    listCollection(env, 'payrollProfiles')
  ]);
  const staffUsers = await withStaffEmployment(env, accountingRowsForBranch(allStaffUsers, branchId));
  const profiles = accountingRowsForBranch(allProfiles, branchId);
  const orderedStaffUsers = [...staffUsers].sort((left, right) =>
    lower(left.Username || left.__id).localeCompare(lower(right.Username || right.__id)));
  const cursor = Math.floor(Math.max(0, Number(body.Cursor || body.cursor || body.StaffOffset || 0) || 0));
  if (cursor >= orderedStaffUsers.length && orderedStaffUsers.length) {
    const error = new Error('The payroll profile cursor is outside the staff list. Restart from cursor 0.');
    error.status = 400;
    error.code = 'PAYROLL_CURSOR_INVALID';
    throw error;
  }
  const selectedStaff = orderedStaffUsers.slice(cursor, cursor + PAYROLL_BULK_ACTION_LIMIT);
  const existingUsernames = new Set(profiles.map((row) => lower(row.Username)).filter(Boolean));
  let created = 0; let skipped = 0; const failures = [];
  for (const staff of selectedStaff) {
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
        DisplayName: clean(staff.Employment?.DisplayName || staff.DisplayName) || username,
        Department: clean(staff.Employment?.Department || staff.Department),
        Position: clean(staff.Position),
        EmploymentType: clean(staff.Employment?.EmploymentType || staff.EmploymentType) || 'Permanent',
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
  const nextCursorValue = cursor + selectedStaff.length;
  const complete = nextCursorValue >= orderedStaffUsers.length;
  return {
    ok: true,
    message: `${created} payroll profile(s) created from active staff accounts; ${skipped} already linked or inactive${failures.length ? `; ${failures.length} failed` : ''}${complete ? '.' : `. Continue from cursor ${nextCursorValue}.`}`,
    created, skipped, failures,
    progress: {
      complete,
      partial: !complete,
      cursor,
      nextCursor: complete ? null : nextCursorValue,
      processed: selectedStaff.length,
      total: orderedStaffUsers.length,
      limit: PAYROLL_BULK_ACTION_LIMIT
    }
  };
}

async function importPayrollProfiles(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const suppliedRows = Array.isArray(body.Profiles || body.profiles) ? (body.Profiles || body.profiles) : [];
  if (suppliedRows.length > 500) { const err = new Error('Import at most 500 payroll rows at a time.'); err.status = 413; throw err; }
  const sourceRows = payrollImportRows(suppliedRows);
  if (!sourceRows.length) { const err = new Error('Choose a payroll CSV containing at least one profile row.'); err.status = 400; throw err; }
  if (sourceRows.length > 500) { const err = new Error('Import at most 500 payroll rows at a time.'); err.status = 413; throw err; }
  const cursor = Math.floor(Math.max(0, Number(body.Cursor || body.cursor || body.ProfileOffset || 0) || 0));
  if (cursor >= sourceRows.length) { const err = new Error('The payroll import cursor is outside the supplied rows. Restart from cursor 0.'); err.status = 400; err.code = 'PAYROLL_CURSOR_INVALID'; throw err; }
  const rows = sourceRows.slice(cursor, cursor + PAYROLL_BULK_ACTION_LIMIT);
  const updateExisting = yesNo(body.UpdateExisting ?? body.updateExisting ?? 'YES') === 'YES';
  const allProfiles = await listCollection(env, 'payrollProfiles');
  const profiles = accountingRowsForBranch(allProfiles, accountingRequestBranch(body));
  const byUsername = new Map(profiles.map((row) => [lower(row.Username), row]).filter(([username]) => username));
  const byEmployeeId = new Map(allProfiles.map((row) => [lower(row.EmployeeId), row]).filter(([employeeId]) => employeeId));
  const seenUsernames = new Set();
  let created = 0; let updated = 0; let skipped = 0; const failures = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const username = clean(row.Username || row.username);
    const existing = byUsername.get(lower(username));
    const requestedEmployeeId = clean(row.EmployeeId || row.employeeId);
    const employeeIdOwner = byEmployeeId.get(lower(requestedEmployeeId));
    if (seenUsernames.has(lower(username))) {
      failures.push({ row: cursor + index + 2, username, message: 'Duplicate username in this CSV.' });
      continue;
    }
    seenUsernames.add(lower(username));
    if (employeeIdOwner && !sameText(employeeIdOwner.Username, username)) {
      failures.push({ row: cursor + index + 2, username, message: `Employee ID ${requestedEmployeeId} belongs to another payroll profile.` });
      continue;
    }
    if (employeeIdOwner && !profiles.includes(employeeIdOwner)) {
      failures.push({ row: cursor + index + 2, username, message: 'Employee ID belongs to another branch.' });
      continue;
    }
    if (existing && requestedEmployeeId && !sameText(existing.EmployeeId, requestedEmployeeId)) {
      failures.push({ row: cursor + index + 2, username, message: 'Employee ID does not match the existing payroll profile.' });
      continue;
    }
    if (existing && !updateExisting) { skipped += 1; continue; }
    try {
      const result = await savePayrollProfile(env, {
        // Row keys have been whitelisted; actor and branch come only from the request.
        UserRole: body.UserRole, UserAssignedRole: body.UserAssignedRole,
        UserUsername: body.UserUsername, UserBranchId: body.UserBranchId,
        UserDepartment: body.UserDepartment, BranchId: body.BranchId,
        RecordedBy: body.RecordedBy,
        ...row,
        EmployeeId: clean(row.EmployeeId || row.employeeId || existing?.EmployeeId) || ledgerDocumentId('EMP'),
        Username: username
      });
      byUsername.set(lower(username), result.profile);
      byEmployeeId.set(lower(result.profile.EmployeeId), result.profile);
      if (existing) updated += 1; else created += 1;
    } catch (error) {
      failures.push({ row: cursor + index + 2, username, message: error.message || String(error) });
    }
  }
  await writePayrollAudit(env, 'BULK IMPORT', 'Payroll Profiles', 'CSV', body,
    `${created} created; ${updated} updated; ${skipped} skipped; ${failures.length} failed`);
  const nextCursorValue = cursor + rows.length;
  const complete = nextCursorValue >= sourceRows.length;
  return {
    ok: true,
    message: `${created} payroll profile(s) created, ${updated} updated, ${skipped} skipped${failures.length ? `; ${failures.length} failed` : ''}${complete ? '.' : `. Continue from cursor ${nextCursorValue}.`}`,
    created, updated, skipped, failures,
    progress: {
      complete,
      partial: !complete,
      cursor,
      nextCursor: complete ? null : nextCursorValue,
      processed: rows.length,
      total: sourceRows.length,
      limit: PAYROLL_BULK_ACTION_LIMIT
    }
  };
}

async function requestPayrollTaxOverride(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const branchId = accountingWriteBranch(body);
  const runId = clean(body.RunId); const employeeId = clean(body.EmployeeId); const reason = clean(body.Reason); const overridePaye = financeMoney(body.OverridePaye, 'Override PAYE');
  if (!runId || !employeeId || !reason || overridePaye < 0) { const err = new Error('Run, employee, non-negative override PAYE, and a reason are required.'); err.status = 400; throw err; }
  const [runs, items, overrides] = await Promise.all([listCollection(env, 'payrollRuns'), listCollection(env, 'payrollItems'), listCollection(env, PAYROLL_TAX_COLLECTIONS.overrides)]);
  const run = runs.find((row) => sameText(row.RunId, runId));
  if (!run || !['draft', 'rejected'].includes(lower(run.Status))) { const err = new Error('Tax overrides can only be requested for Draft or Rejected payroll.'); err.status = 409; throw err; }
  accountingWriteBranch(body, run);
  const item = items.find((row) => sameText(row.RunId, runId) && sameText(row.EmployeeId, employeeId));
  if (!item || clean(item.CalculationMode).toUpperCase() !== 'CONFIGURABLE_PAYE') { const err = new Error('Generate configurable payroll for this employee before requesting an override.'); err.status = 409; throw err; }
  const overrideId = clean(body.OverrideId) || `TAXOVR-${safeDocumentId(runId)}-${safeDocumentId(employeeId)}`;
  const existing = overrides.find((row) => sameText(row.OverrideId || row.__id, overrideId)) || {};
  if (Object.keys(existing).length) {
    accountingWriteBranch(body, existing);
    if (!sameText(existing.RunId, runId) || !sameText(existing.EmployeeId, employeeId)) throw financeFailure('This override reference belongs to another payroll item.', 409);
  }
  if (lower(existing.Status) === 'approved') { const err = new Error('An approved override is immutable. Request a supervised reversal before replacing it.'); err.status = 409; throw err; }
  const payload = { ...existing, OverrideId: overrideId, BranchId: branchId, RunId: runId, EmployeeId: employeeId, ItemId: clean(item.ItemId), CalculatedPaye: asMoneyNumber(item.CalculatedPaye ?? item.TaxAmount),
    OverridePaye: overridePaye, Difference: overridePaye - asMoneyNumber(item.CalculatedPaye ?? item.TaxAmount), Reason: reason, Status: 'Pending',
    RequestedAt: nowIso(), RequestedBy: clean(body.RecordedBy), RequestedByUsername: clean(body.UserUsername), RequestedByRole: clean(body.UserRole), UpdatedAt: nowIso() };
  await commitPayrollMutation(env, [
    financeWrite(PAYROLL_TAX_COLLECTIONS.overrides, safeDocumentId(overrideId), payload, existing),
    financeWrite('payrollRuns', safeDocumentId(run.RunId), run, run),
    payrollAuditWrite('REQUEST TAX OVERRIDE', 'Payroll Tax Override', overrideId, body, `${employeeId}: ${payload.CalculatedPaye} -> ${overridePaye}; ${reason}`)
  ]);
  return { ok: true, message: 'PAYE override submitted for independent approval.', override: payload };
}

async function approvePayrollTaxOverride(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Management']);
  const overrideId = clean(body.OverrideId); const decision = clean(body.Decision || body.Status).toLowerCase();
  if (!overrideId || !['approved', 'rejected'].includes(decision)) { const err = new Error('Override ID and an Approved or Rejected decision are required.'); err.status = 400; throw err; }
  const overrides = await listCollection(env, PAYROLL_TAX_COLLECTIONS.overrides); const existing = overrides.find((row) => sameText(row.OverrideId || row.__id, overrideId));
  if (!existing) { const err = new Error('Tax override request was not found.'); err.status = 404; throw err; }
  const branchId = accountingWriteBranch(body, existing);
  if (lower(existing.Status) !== 'pending') { const err = new Error('Only a pending tax override can be decided.'); err.status = 409; throw err; }
  if (decision === 'approved' && (clean(existing.RequestedByUsername)
    ? sameText(existing.RequestedByUsername, body.UserUsername) : sameText(existing.RequestedBy, body.RecordedBy))) { const err = new Error('The override requester cannot approve the same request.'); err.status = 403; throw err; }
  const runs = accountingRowsForBranch(await listCollection(env, 'payrollRuns'), branchId); const run = runs.find((row) => sameText(row.RunId, existing.RunId));
  if (!run || !['draft', 'rejected'].includes(lower(run.Status))) { const err = new Error('The payroll is no longer editable, so this override cannot be decided.'); err.status = 409; throw err; }
  const updated = { ...existing, Status: decision === 'approved' ? 'Approved' : 'Rejected', DecisionReason: clean(body.DecisionReason || body.Reason),
    DecidedAt: nowIso(), DecidedBy: clean(body.RecordedBy), DecidedByRole: clean(body.UserRole), UpdatedAt: nowIso() };
  const updatedRun = decision === 'approved' ? { ...run, RequiresRecalculation: 'YES', UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) } : run;
  await commitPayrollMutation(env, [
    financeWrite(PAYROLL_TAX_COLLECTIONS.overrides, safeDocumentId(overrideId), updated, existing),
    financeWrite('payrollRuns', safeDocumentId(run.RunId), updatedRun, run),
    payrollAuditWrite(`${decision.toUpperCase()} TAX OVERRIDE`, 'Payroll Tax Override', overrideId, body, clean(updated.DecisionReason || `${existing.EmployeeId}: ${existing.OverridePaye}`))
  ]);
  return { ok: true, message: decision === 'approved' ? 'PAYE override approved. Recalculate the draft payroll before submission.' : 'PAYE override rejected.', override: updated };
}

function payrollAuditWrite(action, entityType, entityId, body, details = '') {
  const auditId = ledgerDocumentId('PAYAUD');
  return financeWrite('payrollAudit', safeDocumentId(auditId), {
    AuditId: auditId, Timestamp: nowIso(), Action: clean(action), EntityType: clean(entityType), EntityId: clean(entityId),
    UserRole: clean(body.UserRole || body.userRole), UserName: clean(body.RecordedBy || body.UpdatedBy),
    BranchId: accountingWriteBranch(body), Details: clean(details)
  });
}

async function commitPayrollMutation(env, writes) {
  if (writes.length > 500) throw financeFailure('This payroll change exceeds the safe atomic batch size. Reduce the run scope or contact support to migrate this register; no payroll records were changed.', 413, 'PAYROLL_RUN_TOO_LARGE');
  try {
    await batchCommitLiteralDocuments(env, writes);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      throw financeFailure('This payroll changed during processing. Refresh the register and try again; no partial changes were saved.', 409, 'PAYROLL_WRITE_CONFLICT');
    }
    throw error;
  }
}

async function generatePayrollRun(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const month = clean(body.Month || body.month);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { const err = new Error('Payroll month must use a valid YYYY-MM format.'); err.status = 400; throw err; }
  const branchId = accountingWriteBranch(body);
  const runId = clean(body.RunId) || `PAY-${branchId === 'main' ? '' : `${safeDocumentId(branchId)}-`}${month.replace('-', '')}`;
  const runs = await listCollection(env, 'payrollRuns');
  const existing = runs.find((row) => sameText(row.RunId, runId) || sameText(row.__id, safeDocumentId(runId))) || {};
  accountingWriteBranch(body, existing);
  assertPayrollCanRegenerate(existing);
  let profiles = accountingRowsForBranch(await listCollection(env, 'payrollProfiles'), branchId).filter((row) => yesNo(row.Active ?? 'YES') === 'YES');
  if (!profiles.length) { const err = new Error('Create at least one active payroll profile first.'); err.status = 400; throw err; }
  if (profiles.length > PAYROLL_GENERATION_PROFILE_LIMIT) {
    const err = new Error(`A payroll run supports at most ${PAYROLL_GENERATION_PROFILE_LIMIT} active profiles per request. Reduce the run scope before generating.`);
    err.status = 413;
    err.code = 'PAYROLL_RUN_TOO_LARGE';
    throw err;
  }
  profiles = (await withStaffEmployment(env, profiles)).map(row => employmentPayrollProfile(row, row));
  const existingItems = accountingRowsForBranch(await listCollection(env, 'payrollItems'), branchId).filter((row) => sameText(row.RunId, runId));
  const usesConfigurablePaye = profiles.some((row) => clean(row.CalculationMode).toUpperCase() === 'CONFIGURABLE_PAYE');
  const configuration = usesConfigurablePaye ? await getPayrollTaxConfiguration(env, { strictReads: true }) : null;
  const payrollDate = financeDate(clean(body.PayDate) || `${month}-28`, 'Payroll date'); const calculatedItems = []; const errors = [];
  let totalBasic = 0; let totalAllowances = 0; let totalGross = 0; let totalTaxable = 0; let totalPension = 0; let totalNhf = 0; let totalPaye = 0; let totalDeductions = 0; let totalNet = 0;
  for (const profile of profiles) {
    try {
      const configurable = clean(profile.CalculationMode).toUpperCase() === 'CONFIGURABLE_PAYE';
      const approvedOverride = configurable ? (configuration.overrides || []).find((row) => sameText(row.RunId, runId) && sameText(row.EmployeeId, profile.EmployeeId) && lower(row.Status) === 'approved') : null;
      const calculation = configurable ? calculateConfigurablePayroll({ employee: profile, configuration, payrollDate, approvedOverride }) : calculateLegacyPayroll(profile);
      const itemId = `${runId}-${clean(profile.EmployeeId)}`;
      const item = {
        ItemId: itemId, RunId: runId, BranchId: branchId, Month: month, EmployeeId: clean(profile.EmployeeId), Username: clean(profile.Username),
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
  const itemWrites = calculatedItems.map(item => financeWrite('payrollItems', safeDocumentId(item.ItemId), item,
    existingItems.find(current => sameText(current.ItemId, item.ItemId))));
  existingItems.filter(item => !currentIds.has(lower(item.ItemId))).forEach(item => itemWrites.push({
    ...financeWrite('payrollItems', safeDocumentId(item.ItemId), {}, item), operation: 'delete'
  }));
  const versions = [...new Set(calculatedItems.map((item) => clean(item.CalculationVersion)))];
  const taxProfileIds = [...new Set(calculatedItems.map((item) => clean(item.TaxProfileId)).filter(Boolean))];
  const warnings = calculatedItems.flatMap((item) => (item.CalculationWarnings || []).map((warning) => `${item.DisplayName}: ${warning}`));
  const run = {
    ...existing, RunId: runId, BranchId: branchId, Month: month, PayDate: payrollDate, Description: clean(body.Description) || `Payroll for ${month}`,
    Status: 'Draft', EmployeeCount: profiles.length, TotalBasic: asMoneyNumber(totalBasic), TotalAllowances: asMoneyNumber(totalAllowances), TotalGross: asMoneyNumber(totalGross),
    TotalTaxableEarnings: asMoneyNumber(totalTaxable), TotalPension: asMoneyNumber(totalPension), TotalNhf: asMoneyNumber(totalNhf), TotalPaye: asMoneyNumber(totalPaye),
    TotalDeductions: asMoneyNumber(totalDeductions), TotalNet: asMoneyNumber(totalNet), PaidAmount: 0, OutstandingAmount: asMoneyNumber(totalNet),
    CalculationVersion: versions.length === 1 ? versions[0] : 'MIXED_LEGACY_AND_CONFIGURABLE_V1', TaxProfileIds: taxProfileIds,
    CalculationStatus: 'VALID', ValidationWarnings: warnings, RequiresRecalculation: 'NO', ConfigurationSnapshotVersion: 1,
    CreatedAt: existing.CreatedAt || nowIso(), CreatedBy: existing.CreatedBy || clean(body.RecordedBy), UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy)
  };
  await commitPayrollMutation(env, [...itemWrites,
    financeWrite('payrollRuns', safeDocumentId(runId), run, existing),
    payrollAuditWrite(existing.RunId ? 'REGENERATE' : 'GENERATE', 'Payroll Run', runId, body, `${profiles.length} staff; net ${totalNet}`)
  ]);
  return { ok: true, message: `Payroll calculated for ${profiles.length} staff${usesConfigurablePaye ? ' using the configured PAYE engine where enabled' : ' using the legacy-compatible engine'}.`, run, warnings };
}

async function savePayrollRunStatus(env, body) {
  const requested = clean(body.Status || body.status);
  const runId = clean(body.RunId || body.runId);
  const runs = await listCollection(env, 'payrollRuns');
  const run = runs.find((row) => sameText(row.RunId, runId) || sameText(row.__id, safeDocumentId(runId)));
  if (!run) { const err = new Error('Payroll run was not found.'); err.status = 404; throw err; }
  const branchId = accountingWriteBranch(body, run);
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
  const runItems = accountingRowsForBranch(await listCollection(env, 'payrollItems'), branchId).filter((row) => sameText(row.RunId, runId));
  if (['submitted', 'approved', 'posted'].includes(target)) validatePayrollForSubmission(run, runItems);
  const writes = [];
  const updated = { ...run, Status: requested, UpdatedAt: nowIso(), UpdatedBy: clean(body.RecordedBy) };
  if (target === 'submitted') { updated.SubmittedAt = nowIso(); updated.SubmittedBy = clean(body.RecordedBy); }
  if (target === 'approved') {
    const finalizedAt = nowIso(); updated.ApprovedAt = finalizedAt; updated.ApprovedBy = clean(body.RecordedBy); updated.FinalizedAt = finalizedAt; updated.FinalizedBy = clean(body.RecordedBy);
    updated.ConfigurationSnapshot = buildFinalizedRunSnapshot(run, runItems, clean(body.RecordedBy), finalizedAt);
    writes.push(...runItems.map(item => financeWrite('payrollItems', safeDocumentId(item.ItemId),
      { ...item, LockedAt: finalizedAt, LockedBy: clean(body.RecordedBy), FinalizedSnapshot: item.ConfigurationSnapshot || null }, item)));
  }
  if (target === 'rejected') { updated.RejectedAt = nowIso(); updated.RejectedBy = clean(body.RecordedBy); updated.RejectionReason = clean(body.Reason); }
  if (target === 'posted') {
    const date = financeDate(clean(body.Date || run.PayDate) || nowIso().slice(0, 10), 'Payroll posting date');
    const mappings = await listCollection(env, PAYROLL_TAX_COLLECTIONS.mappings);
    const ledger = buildPayrollJournalLines(runItems, mappings, date, run.Description);
    const prepared = await saveAccountingJournal(env, { JournalNo: `SYS-PR-${safeDocumentId(runId)}`, Date: date, Status: 'Posted',
      Description: run.Description, Reference: runId, Source: 'Payroll', SourceId: runId, BranchId: branchId, RecordedBy: clean(body.RecordedBy), Lines: ledger.lines }, true, { prepareOnly: true });
    if (prepared.existing && Object.keys(prepared.existing).length) throw financeFailure('A payroll journal already exists while this run is not marked Posted. Accounts must reconcile that earlier posting before retrying.', 409);
    const journal = prepared.payload;
    writes.push(financeWrite('accountingJournals', safeDocumentId(journal.JournalNo), journal));
    updated.JournalNo = journal.JournalNo; updated.PostedAt = nowIso(); updated.PostedBy = clean(body.RecordedBy); updated.LedgerMappingSnapshot = ledger.mappingSnapshot;
  }
  await commitPayrollMutation(env, [...writes,
    financeWrite('payrollRuns', safeDocumentId(runId), updated, run),
    payrollAuditWrite(target.toUpperCase(), 'Payroll Run', runId, body, clean(body.Reason || requested))
  ]);
  return { ok: true, message: `Payroll ${requested.toLowerCase()}.`, run: updated };
}

function payrollSavedMoney(value, label, options = {}) {
  // Older runs summed decimal salaries without rounding their final totals.
  // Accept only floating-point noise, not an actual fractional-cent balance.
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    if (Math.abs(value - rounded) <= 1e-7) value = rounded;
  }
  return financeMoney(value, label, options);
}

async function payPayrollItem(env, body) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
  const itemId = clean(body.ItemId || body.itemId);
  const paymentNo = clean(body.PaymentNo);
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(paymentNo)) {
    throw financeFailure('A stable payment reference is required. Update or reopen the salary payment form before submitting.');
  }
  const amount = financeMoney(body.Amount, 'Salary payment', { min: 0.01 });
  const date = financeDate(clean(body.Date) || nowIso().slice(0, 10), 'Payment date');
  const paymentAccount = clean(body.PaymentAccount) || '1020';
  const fingerprint = JSON.stringify({ ItemId: itemId, Amount: amount, Date: clean(body.Date),
    PaymentAccount: paymentAccount, Method: clean(body.Method), Reference: clean(body.Reference),
    Actor: lower(body.UserUsername) });
  const prior = await getDocumentByIdOrField(env, 'payrollPayments', paymentNo, 'PaymentNo');
  const replay = async (payment) => {
    accountingWriteBranch(body, payment);
    if (payment.RequestFingerprint !== fingerprint) {
      throw financeFailure('This salary payment reference was already used for another payment. Refresh the register.', 409);
    }
    const [item, run] = await Promise.all([
      getDocumentByIdOrField(env, 'payrollItems', payment.ItemId, 'ItemId'),
      getDocumentByIdOrField(env, 'payrollRuns', payment.RunId, 'RunId')
    ]);
    if (!item || !run) throw financeFailure('The recorded salary payment requires reconciliation.', 409);
    accountingWriteBranch(body, item); accountingWriteBranch(body, run);
    return { ok: true, replayed: true, message: 'This salary payment was already recorded.', item, run, payment };
  };
  if (prior) return replay(prior);
  const item = await getDocumentByIdOrField(env, 'payrollItems', itemId, 'ItemId');
  if (!item) { const err = new Error('Payroll item was not found.'); err.status = 404; throw err; }
  const branchId = accountingWriteBranch(body, item);
  const run = await getDocumentByIdOrField(env, 'payrollRuns', item.RunId, 'RunId');
  if (run) accountingWriteBranch({ ...body, BranchId: branchId }, run);
  if (!run || !['posted', 'part paid'].includes(lower(run.Status))) { const err = new Error('Payroll must be posted before salary payment.'); err.status = 409; throw err; }
  const net = payrollSavedMoney(item.NetPay, 'Saved net salary');
  const itemPaid = payrollSavedMoney(item.PaidAmount, 'Saved salary payments', { defaultValue: 0 });
  const runNet = payrollSavedMoney(run.TotalNet, 'Saved payroll total');
  const runPaid = payrollSavedMoney(run.PaidAmount, 'Saved payroll payments', { defaultValue: 0 });
  const outstanding = Math.max(0, asMoneyNumber(net - itemPaid));
  if (amount > outstanding || runPaid + amount > runNet + 0.005) {
    throw financeFailure(`Payment cannot exceed the unpaid salary (${outstanding.toFixed(2)}) or payroll balance.`);
  }
  let payableAccount = '2300';
  if (clean(item.CalculationMode).toUpperCase() === 'CONFIGURABLE_PAYE') {
    const codes = [...new Set((Array.isArray(run.LedgerMappingSnapshot) ? run.LedgerMappingSnapshot : [])
      .filter(row => clean(row.MappingType).toUpperCase() === 'NET_SALARY')
      .map(row => clean(row.CreditAccountId)).filter(Boolean))];
    if (codes.length !== 1) throw financeFailure('The posted payroll has no unambiguous net-salary account snapshot. Accounts must review its posting before payment.', 409);
    payableAccount = codes[0];
  }
  if (payableAccount === paymentAccount) throw financeFailure('The payment and salary payable accounts must be different.');
  const journalNo = `SYS-SALPAY-${safeDocumentId(paymentNo)}`;
  const prepared = await saveAccountingJournal(env, { JournalNo: journalNo, Date: date, Status: 'Posted',
    Description: `Salary payment: ${clean(item.DisplayName)}`, Reference: clean(body.Reference) || paymentNo,
    Source: 'Salary Payment', SourceId: paymentNo, BranchId: branchId, RecordedBy: clean(body.RecordedBy), Lines: [
      { AccountCode: payableAccount, Debit: amount, Credit: 0, Description: clean(item.DisplayName) },
      { AccountCode: paymentAccount, Debit: 0, Credit: amount, Description: clean(body.Method) || 'Salary payment' }
    ] }, true, { prepareOnly: true });
  if (prepared.existing && Object.keys(prepared.existing).length) {
    // An older partial write must be reconciled, never silently counted again.
    const completed = await getDocumentByIdOrField(env, 'payrollPayments', paymentNo, 'PaymentNo');
    if (completed) return replay(completed);
    throw financeFailure('A journal already exists for this salary payment without its payment record. Accounts must reconcile it before retrying.', 409);
  }
  const journal = prepared.payload;
  const paid = asMoneyNumber(itemPaid + amount);
  const updatedItem = financeData({ ...item, PaidAmount: paid, OutstandingAmount: Math.max(0, asMoneyNumber(net - paid)),
    PaymentStatus: paid + 0.005 >= net ? 'Paid' : 'Part Paid', LastPaidAt: date, UpdatedAt: nowIso() });
  const payment = { PaymentNo: paymentNo, BranchId: branchId, RunId: item.RunId, ItemId: item.ItemId, EmployeeId: item.EmployeeId, Username: item.Username,
    DisplayName: item.DisplayName, Date: date, Amount: amount, PaymentAccount: paymentAccount, Method: clean(body.Method),
    Reference: clean(body.Reference), JournalNo: journal.JournalNo, PayableAccount: payableAccount,
    RequestFingerprint: fingerprint, RecordedByUsername: clean(body.UserUsername), RecordedBy: clean(body.RecordedBy), RecordedAt: nowIso() };
  const totalPaid = asMoneyNumber(runPaid + amount);
  const updatedRun = financeData({ ...run, PaidAmount: totalPaid, OutstandingAmount: Math.max(0, asMoneyNumber(runNet - totalPaid)),
    Status: totalPaid + 0.005 >= runNet ? 'Paid' : 'Part Paid', UpdatedAt: nowIso() });
  try {
    await batchCommitLiteralDocuments(env, [
      financeWrite('accountingJournals', safeDocumentId(journalNo), journal),
      financeWrite('payrollPayments', safeDocumentId(paymentNo), payment),
      financeWrite('payrollItems', safeDocumentId(item.ItemId), updatedItem, item),
      financeWrite('payrollRuns', safeDocumentId(run.RunId), updatedRun, run),
      payrollAuditWrite('PAY', 'Payroll Item', item.ItemId, body, `${paymentNo}: ${amount}`)
    ]);
  } catch (error) {
    if ([409, 412].includes(Number(error?.status)) || error?.code === 'FIRESTORE_WRITE_CONFLICT') {
      const completed = await getDocumentByIdOrField(env, 'payrollPayments', paymentNo, 'PaymentNo');
      if (completed) return replay(completed);
      throw financeFailure('This payroll changed while the payment was being recorded. Refresh and retry; no partial payment was posted.', 409, 'FINANCE_WRITE_CONFLICT');
    }
    throw error;
  }
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

function validateAccountingReportPage(body = {}) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  // One Firestore page per request keeps each read bounded. The desktop only
  // presents a report after it has successfully consumed the final page.
  if (isDepartmentAccountingUser(body)) {
    const error = new Error('Department users cannot browse the accounting journal.');
    error.status = 403;
    throw error;
  }
  const readTime = clean(body.ReadTime);
  const readTimeMs = Date.parse(readTime);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(readTime)
      || !Number.isFinite(readTimeMs) || readTimeMs > Date.now() + 5000
      || Date.now() - readTimeMs > 50 * 60 * 1000) {
    const error = new Error('The finance snapshot expired. Refresh to start a new report.');
    error.status = 400;
    throw error;
  }
  const pageToken = clean(body.PageToken);
  if (pageToken.length > 8192) {
    const error = new Error('The finance page token is invalid.');
    error.status = 400;
    throw error;
  }
  return { readTime, pageToken };
}

async function getAccountingJournalPage(env, body = {}) {
  const { readTime, pageToken } = validateAccountingReportPage(body);
  const branchId = accountingRequestBranch(body);
  const page = await loadBranchFinancePage(env, 'accountingJournals', branchId, { pageSize: 500, pageToken, readTime });
  const edition = accountingEditionForRequest(env, body);
  const rows = accountingJournalsForEdition(accountingRowsForBranch(page.documents, branchId), edition);
  return { ok: true, journals: rows, nextPageToken: page.nextPageToken, readTime };
}

// Normalize financial facts on the server so every edition uses the same
// reversal, payment-credit and identity rules when rebuilding a complete report.
export function accountingFinanceReportRows(collection, rows = [], filter = {}) {
  return rows.map((raw) => {
    const row = collection === 'invoices' ? { ...normalizeInvoice(financeInvoiceAsOf(raw, filter.DateTo)), Date: financeReportDate(raw) } : normalizePayment(raw);
    const reportIdentity = referenceIdentityKey(row.ApplicationReference || row.ApplicationID || row.AccountRef);
    if (collection === 'invoices') return { ...row, ReportIdentity: reportIdentity,
      ReportStoredCreditAsOf: financeStoredCreditAsOf(row, filter.DateTo, asMoneyNumber(row.Credit || row.PaidAmount)),
      ReportTimestamp: timestampMs(row.Date || row.CreatedAt),
      ReportDueTimestamp: timestampMs(row.DueDate || row.Date || row.CreatedAt) };
    return { ...row, ReportIdentity: reportIdentity, ReportCredit: paymentCreditedAmount(row),
      ReportPaymentDate: financeReportDate(raw, true),
      ReportGeneralSchoolCredit: isSchoolFeesTotalPayment(row) || isAcceptanceFeeLike(row),
      ReportExcludedFromAgeing: isWalletLedger(row) || isStorePurchase(row),
      ReportGatewayMatch: accountingRowMatches({ ...raw,
        Date: raw.PaidAt || raw.PaymentDate || raw.Date || raw.CreatedAt }, filter) };
  });
}

export async function getAccountingFinancePage(env, body = {}) {
  requireAccountingRole(body, ['Super Admin', 'Accounts Officer', 'Management']);
  const { readTime, pageToken } = validateAccountingReportPage(body);
  const collection = clean(body.Collection);
  if (!['invoices', 'payments'].includes(collection)) {
    const error = new Error('The finance report collection is invalid.'); error.status = 400; throw error;
  }
  const branchId = accountingRequestBranch(body);
  const page = await loadBranchFinancePage(env, collection, branchId, { pageSize: 500, pageToken, readTime });
  const rows = accountingFinanceReportRows(collection,
    accountingRowsForBranch(page.documents, branchId), accountingFilter(body));
  return { ok: true, collection, rows, nextPageToken: page.nextPageToken, readTime,
    scanned: page.documents.length };
}

function assignedStaffBranchId(row = {}) {
  const assigned = clean(row.BranchId || row.branchId);
  return assigned ? canonicalSchoolBranchId(assigned) : '';
}

export function desktopStaffUserMatchesDeviceScope(row = {}, deviceBranchId = '') {
  const suppliedBranchId = clean(deviceBranchId);
  if (!suppliedBranchId) return true;
  const approvedBranchId = canonicalSchoolBranchId(suppliedBranchId);
  const assignedBranchId = assignedStaffBranchId(row);
  if (assignedBranchId) return assignedBranchId === approvedBranchId;
  // An organisation-wide Super Admin must be able to complete first login on
  // a newly paired branch computer. The device credential still forces every
  // subsequent backend request into the approved branch scope.
  return clean(row.Role || row.role) === 'Super Admin';
}

async function getStaffUsersForDesktop(env, body) {
  requireStaffUserAdmin(body);
  const deviceBranchId = clean(body.DeviceBranchId);
  const [allUsers, profile] = await Promise.all([
    listCollection(env, 'staffUsers'),
    loadOrganizationNameProfile(env)
  ]);
  const users = deviceBranchId
    ? allUsers.filter((row) => desktopStaffUserMatchesDeviceScope(row, deviceBranchId))
    : allUsers;
  return {
    ok: true,
    message: deviceBranchId
      ? `Staff users assigned to branch ${deviceBranchId}, including organisation-wide Super Admins, loaded from the database.`
      : 'Staff users loaded from the database.',
    users: (await withStaffEmployment(env, users)).map((row) => ({
      ...row,
      DisplayName: formatPersonName(row, profile || {}, row.DisplayName || row.Username || row.__id)
    }))
  };
}

async function saveStaffUserFromDesktop(env, body) {
  requireStaffUserAdmin(body);
  const incoming = body.User && typeof body.User === 'object' ? body.User : body;
  const username = clean(incoming.Username || incoming.username);
  if (!username) { const err = new Error('Username is required.'); err.status = 400; throw err; }
  const state = await beginStaffAccountChange(env);
  const users = state.rows;
  const { existing } = resolveStaffAccountTarget(users, username, body.OriginalUsername || incoming.OriginalUsername);
  const deviceBranchId = clean(body.DeviceBranchId);
  if (deviceBranchId && existing && assignedStaffBranchId(existing) !== canonicalSchoolBranchId(deviceBranchId)) {
    const err = new Error('This computer cannot update a staff account assigned to another branch.');
    err.status = 403;
    err.code = 'DESKTOP_DEVICE_BRANCH_MISMATCH';
    throw err;
  }
  const loginUsername = clean(
    incoming.LoginUsername || incoming.loginUsername || existing?.LoginUsername || username
  );
  const conflictingLogin = users.find((row) => (
    !sameText(row.Username || row.__id, username)
    && [row.LoginUsername, row.Username, row.__id].some((value) => sameText(value, loginUsername))
  ));
  if (conflictingLogin) {
    const err = new Error('That login username is already assigned to another staff account.');
    err.status = 409;
    throw err;
  }
  const role = clean(incoming.Role || incoming.role) || 'Front Desk';
  const department = clean(incoming.Department || incoming.department);
  const active = incoming.Active === undefined ? true : staffUserIsActive(incoming);
  const edition = accountingEditionForRequest(env, {
    ...body,
    OrganisationEdition: incoming.OrganisationEdition || incoming.organisationEdition
      || body.OrganisationEdition || body.organisationEdition
      || existing?.OrganisationEdition || existing?.OrganizationEdition
  });
  const subscriptionRows = staffAccountsForSubscription(users, edition, body.UserUsername);
  await enforceSubscriptionUserLimit(env, subscriptionRows, existing, active);
  if (role === 'Department User' && !department) { const err = new Error('Department is required for a Department User.'); err.status = 400; throw err; }
  if (!clean(incoming.Salt) || !clean(incoming.PasswordHash)) { const err = new Error('A password hash and salt are required.'); err.status = 400; throw err; }
  if (existing && clean(existing.Role) === 'Super Admin' && staffUserIsActive(existing) && (role !== 'Super Admin' || !active) && activeStaffSuperAdmins(users, username).length === 0) {
    const err = new Error('At least one active Super Admin must remain.'); err.status = 409; throw err;
  }
  const profile = await loadOrganizationNameProfile(env);
  const identity = { ...(existing || {}), ...incoming };
  const recoveryEmail = normalizeRecoveryEmail(incoming.RecoveryEmail ?? existing?.RecoveryEmail);
  const payload = {
    ...(existing || {}),
    Username: username,
    UsernameKey: lower(username),
    LoginUsername: loginUsername,
    LoginUsernameKey: lower(loginUsername),
    RecoveryEmail: recoveryEmail,
    RecoveryEmailChangedAt: lower(existing?.RecoveryEmail) === recoveryEmail
      ? clean(existing?.RecoveryEmailChangedAt) : new Date().toISOString(),
    DisplayName: formatPersonName(identity, profile || {}, clean(incoming.DisplayName || existing?.DisplayName) || username),
    FirstName: clean(incoming.FirstName || incoming.firstName || existing?.FirstName || existing?.firstName),
    MiddleName: clean(incoming.MiddleName || incoming.middleName || existing?.MiddleName || existing?.middleName),
    Surname: clean(incoming.Surname || incoming.surname || incoming.LastName || incoming.lastName || existing?.Surname || existing?.surname || existing?.LastName || existing?.lastName),
    Role: role,
    Department: department,
    OrganisationEdition: clean(
      incoming.OrganisationEdition || incoming.organisationEdition
        || body.OrganisationEdition || body.organisationEdition
        || existing?.OrganisationEdition || existing?.OrganizationEdition
    ) || 'school',
    BranchId: deviceBranchId || clean(incoming.BranchId || incoming.branchId || existing?.BranchId),
    Active: active,
    Salt: clean(incoming.Salt),
    PasswordHash: clean(incoming.PasswordHash),
    PasswordIterations: asMoneyNumber(incoming.PasswordIterations || 10000),
    MustChangePassword: incoming.MustChangePassword === undefined ? Boolean(existing?.MustChangePassword) : staffUserIsActive({ Active: incoming.MustChangePassword }),
    RequisitionEditEnabled: requisitionEditGrant(incoming.RequisitionEditEnabled ?? existing?.RequisitionEditEnabled, {
      Role: role, ApprovalEnabled: existing?.ApprovalEnabled
    }),
    CreatedAt: existing?.CreatedAt || clean(incoming.CreatedAt) || nowIso(),
    UpdatedAt: nowIso(),
    UpdatedBy: clean(body.RecordedBy || body.recordedBy) || 'Desktop Super Admin'
  };
  delete payload.__id;
  delete payload.__name;
  const permissionAudit = requisitionEditPermissionAuditWrite(existing || {}, payload, {
    displayName: body.RecordedBy, username: body.UserUsername, sourcePlatform: 'Desktop'
  });
  await commitStaffAccountChanges(env, state, [
    staffAccountWrite(existing, username, payload),
    ...(permissionAudit ? [permissionAudit] : [])
  ]);
  await upsertDocument(env, 'staffSecurityAudit', safeDocumentId(`DESKTOP-${Date.now()}-${username}`), {
    Timestamp: nowIso(), Action: existing ? 'UPDATE USER' : 'CREATE USER', Username: username,
    Actor: clean(body.RecordedBy) || 'Desktop Super Admin', SourcePlatform: 'Desktop'
  });
  return { ok: true, message: existing ? 'Staff user updated in the database.' : 'Staff user created in the database.', user: payload };
}

async function deleteStaffUserFromDesktop(env, body) {
  requireStaffUserAdmin(body);
  const username = clean(body.Username || body.username);
  const state = await beginStaffAccountChange(env);
  const users = state.rows;
  const existing = users.find((row) => sameText(row.Username || row.__id, username));
  if (!existing) { const err = new Error('Staff account was not found.'); err.status = 404; throw err; }
  const deviceBranchId = clean(body.DeviceBranchId);
  if (deviceBranchId && assignedStaffBranchId(existing) !== canonicalSchoolBranchId(deviceBranchId)) {
    const err = new Error('This computer cannot delete a staff account assigned to another branch.');
    err.status = 403;
    err.code = 'DESKTOP_DEVICE_BRANCH_MISMATCH';
    throw err;
  }
  if (sameText(username, body.UserUsername || body.RecordedBy)) { const err = new Error('You cannot delete the account currently signed in.'); err.status = 409; throw err; }
  if (clean(existing.Role) === 'Super Admin' && staffUserIsActive(existing) && activeStaffSuperAdmins(users, username).length === 0) {
    const err = new Error('At least one active Super Admin must remain.'); err.status = 409; throw err;
  }
  await commitStaffAccountChanges(env, state, [{ collectionPath: 'staffUsers',
    documentId: existing.__id || safeDocumentId(lower(username)), operation: 'delete', ...staffAccountCondition(existing) }]);
  await upsertDocument(env, 'staffSecurityAudit', safeDocumentId(`DESKTOP-${Date.now()}-${username}`), {
    Timestamp: nowIso(), Action: 'DELETE USER', Username: username,
    Actor: clean(body.RecordedBy) || 'Desktop Super Admin', SourcePlatform: 'Desktop'
  });
  return { ok: true, message: 'Staff user deleted from the database.' };
}

function withoutFirestoreMetadata(row = {}) {
  const copy = { ...row };
  delete copy.__id;
  delete copy.__name;
  delete copy.__createTime;
  delete copy.__updateTime;
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
    message: `${writes.length} existing records were prepared for targeted database access.`,
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
    message: 'Database and payment health checks completed.',
    checkedAt: nowIso(),
    pendingPaymentIntents: pendingIntents.length,
    processingPayments: processingPayments.length,
    recentPaymentsChecked: recentPayments.length,
    unjournaledPayments: unjournaled,
    healthy: processingPayments.length === 0 && unjournaled.length === 0
  };
}

async function routeAction(env, action, body = {}, deploymentIdentity = null, publicOrigin = '') {
  switch (action) {
    case 'getClubMembers':
    case 'getFeeCollectionSummary': {
      const branchId = accountingRequestBranch(body);
      const access = await staffAccessFor(env, {
        username: clean(body.UserUsername), role: clean(body.UserRole),
        assignedRole: clean(body.UserAssignedRole || body.UserRole), branchId,
        schoolSectionAccess: clean(body.UserSchoolSectionAccess), tabAccess: body.UserTabAccess,
        department: clean(body.UserDepartment)
      });
      const report = action === 'getClubMembers'
        ? (await import('../lib/club-members.js')).getClubMembersPage
        : (await import('../lib/fee-collection-summary.js')).getFeeCollectionSummaryPage;
      return report(env, { ...access, username: clean(body.UserUsername),
        assignedRole: clean(body.UserAssignedRole || body.UserRole), branchId,
        schoolSectionAccess: clean(body.UserSchoolSectionAccess || 'All'),
        edition: deploymentIdentity?.edition || access.edition
      }, { ...body, branchId });
    }
    case 'manualPaymentCorrection': {
      const branchId = accountingRequestBranch(body);
      const access = await staffAccessFor(env, {
        username: clean(body.UserUsername), role: clean(body.UserRole),
        assignedRole: clean(body.UserAssignedRole || body.UserRole), branchId,
        schoolSectionAccess: clean(body.UserSchoolSectionAccess), tabAccess: body.UserTabAccess,
        department: clean(body.UserDepartment)
      });
      const { handleManualPaymentCorrection } = await import('../lib/manual-payment-corrections.js');
      return handleManualPaymentCorrection(env, { ...access, username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy), assignedRole: clean(body.UserAssignedRole || body.UserRole),
        branchId, schoolSectionAccess: clean(body.UserSchoolSectionAccess || 'All'),
        edition: deploymentIdentity?.edition || access.edition, sourcePlatform: 'Desktop'
      }, { ...body, action: body.Command });
    }
    case 'requisitionApprovalSettings': {
      const access = await staffAccessFor(env, {
        username: clean(body.UserUsername), role: clean(body.UserRole), assignedRole: clean(body.UserAssignedRole || body.UserRole),
        branchId: clean(body.UserBranchId), schoolSectionAccess: clean(body.UserSchoolSectionAccess), tabAccess: body.UserTabAccess
      });
      return handleApprovalSettings(env, { ...access, ...accountingRequisitionActor(body) }, body);
    }
    case 'vendorSettlements': {
      const access = await staffAccessFor(env, {
        ...accountingRequisitionActor(body),
        username: clean(body.UserUsername), role: clean(body.UserRole),
        assignedRole: clean(body.UserAssignedRole || body.UserRole),
        branchId: clean(body.UserBranchId), schoolSectionAccess: clean(body.UserSchoolSectionAccess),
        tabAccess: body.UserTabAccess, department: clean(body.UserDepartment)
      });
      return handleVendorSettlementAction(env, { ...access,
        ...accountingRequisitionActor(body),
        username: clean(body.UserUsername), displayName: clean(body.RecordedBy || body.UserUsername),
        role: clean(body.UserRole), assignedRole: clean(body.UserAssignedRole || body.UserRole),
        branchId: clean(body.UserBranchId || body.BranchId), schoolSectionAccess: clean(body.UserSchoolSectionAccess || 'All'),
        edition: deploymentIdentity?.edition || access.edition, sourcePlatform: 'Desktop'
      }, { ...body, action: body.Command || 'bootstrap' });
    }
    case 'ping': {
      const identity = {
        workspaceKey: deploymentIdentity?.edition || '',
        workspaceId: deploymentIdentity?.workspaceId || '',
        edition: deploymentIdentity?.edition || '',
        environmentId: clean(env.FIREBASE_PROJECT_ID),
        firebaseProjectId: clean(env.FIREBASE_PROJECT_ID),
        organisationName: deploymentIdentity?.organisationName || '',
        organisationCode: deploymentIdentity?.organisationCode || ''
      };
      return {
        ok: true,
        message: 'Database backend is reachable.',
        backend: 'firestore',
        projectId: env.FIREBASE_PROJECT_ID,
        workspaceKey: identity.workspaceKey,
        workspaceId: identity.workspaceId,
        edition: identity.edition,
        organisationName: identity.organisationName,
        organisationCode: identity.organisationCode,
        identity
      };
    }
    case 'exportBackup': {
      requireAccountingRole(body, ['Super Admin']);
      return exportOrganizationBackupPage(env, {
        cursor: body.Cursor || body.cursor,
        pageToken: body.PageToken || body.pageToken,
        pageSize: 500
      });
    }
    case 'prepareRestoreBackup':
      return prepareOrganizationRestore(env, {
        username: body.UserUsername,
        displayName: body.RecordedBy,
        role: body.UserRole
      }, body.Manifest || body.manifest, body.CollectionPaths || body.collectionPaths, body.SafetyBackupCreated === true || body.safetyBackupCreated === true);
    case 'clearRestoreCollection':
      return clearOrganizationRestoreCollection(env, {
        username: body.UserUsername,
        displayName: body.RecordedBy,
        role: body.UserRole
      }, body.JobId || body.jobId, body.CollectionPath || body.collectionPath);
    case 'writeRestoreCollection':
      return writeOrganizationRestoreChunk(env, {
        username: body.UserUsername,
        displayName: body.RecordedBy,
        role: body.UserRole
      }, body.JobId || body.jobId, body.CollectionPath || body.collectionPath, body.Documents || body.documents);
    case 'completeRestoreBackup':
      return completeOrganizationRestore(env, {
        username: body.UserUsername,
        displayName: body.RecordedBy,
        role: body.UserRole
      }, body.JobId || body.jobId);
    case 'getSystemHealth':
      return getSystemHealth(env, body);
    case 'optimizeFirestoreData':
      return optimizeFirestoreData(env, body);
    case 'getApplications':
      {
        const [rows, profile] = await Promise.all([
          listSchoolCollection(env, 'applications', requestedStudentScope(body)),
          getDocument(env, 'settings', 'schoolProfile').catch(() => null)
        ]);
        return {
          ok: true,
          message: 'Applications loaded from the database.',
          applications: rows.map((row) => normalizeApplication(row, profile || {}))
        };
      }
    case 'getStudents':
      {
        const [rows, profile] = await Promise.all([
          listSchoolCollection(env, 'students', requestedStudentScope(body)),
          getDocument(env, 'settings', 'schoolProfile').catch(() => null)
        ]);
        return {
          ok: true,
          message: 'Students loaded from the database.',
          students: rows.map((row) => normalizeStudent(row, profile || {}))
        };
      }
    case 'getSchoolLibrary':
    case 'searchLibraryBorrowers':
    case 'saveLibraryTitle':
    case 'addLibraryCopy':
    case 'restoreLibraryCopy':
    case 'repairLibraryCopyStatus':
    case 'checkoutLibraryCopy':
    case 'returnLibraryCopy':
    case 'renewLibraryLoan':
    case 'reserveLibraryTitle':
    case 'cancelLibraryReservation':
    case 'saveLibraryPolicy': {
      const access = await staffAccessFor(env, {
        username: clean(body.UserUsername), role: clean(body.UserRole),
        assignedRole: clean(body.UserAssignedRole || body.UserRole),
        branchId: clean(body.UserBranchId), tabAccess: body.UserTabAccess,
        department: clean(body.UserDepartment)
      });
      return handleSchoolLibraryAction(env, {
        ...access, username: clean(body.UserUsername), displayName: clean(body.RecordedBy || body.UserUsername),
        role: clean(body.UserRole), assignedRole: clean(body.UserAssignedRole || body.UserRole),
        branchId: clean(body.UserBranchId)
      }, {
        ...body,
        action: ({ getSchoolLibrary: 'list', searchLibraryBorrowers: 'searchBorrowers', saveLibraryTitle: 'saveTitle',
          addLibraryCopy: 'addCopy', restoreLibraryCopy: 'restoreCopy', repairLibraryCopyStatus: 'repairCopyStatus', checkoutLibraryCopy: 'checkout',
          returnLibraryCopy: 'return', renewLibraryLoan: 'renew',
          reserveLibraryTitle: 'reserve', cancelLibraryReservation: 'cancelReservation',
          saveLibraryPolicy: 'savePolicy' })[action]
      });
    }
    case 'getStudentConductCases':
    case 'saveStudentConductCase':
    case 'deleteStudentConductCase': {
      const actor = await desktopSchoolOperationsActor(env, body, 'studentConduct', action !== 'getStudentConductCases');
      return handleStudentConductAction(env, actor, {
        ...body,
        action: ({
          getStudentConductCases: 'list',
          saveStudentConductCase: 'save',
          deleteStudentConductCase: 'delete'
        })[action]
      });
    }
    case 'getAcademicManagement':
    case 'saveAcademicSession':
    case 'saveAcademicTerm':
    case 'saveAcademicClass':
    case 'saveAcademicArmTemplate':
    case 'saveAcademicArm':
    case 'saveAcademicSubject':
    case 'saveAcademicDepartment':
    case 'saveAcademicOffering':
    case 'saveAcademicTeacherAllocation':
    case 'saveAcademicStudentMembership':
    case 'bulkCreateAcademicClasses':
    case 'bulkCreateAcademicArmTemplates':
    case 'bulkApplyAcademicArmTemplates':
    case 'bulkAssignAcademicClassroomDepartments':
    case 'bulkCreateAcademicSubjects':
    case 'configureAcademicSeniorChoiceSubjects':
    case 'bulkApplyAcademicSubjects':
    case 'bulkAssignAcademicClassTeachers':
    case 'bulkAssignAcademicSubjectTeacher':
    case 'updateAcademicSubjectTeacherAllocation':
    case 'bulkAllocateAcademicStudents':
    case 'bulkImportAcademicStudentMemberships':
    case 'bulkAssignAcademicArmStudentSubjects':
    case 'reviewAcademicSubjectChange':
    case 'saveAcademicTimetableSettings':
    case 'saveAcademicTimetableGenerationRules':
    case 'previewAcademicTimetableGeneration':
    case 'saveAcademicTimetableGeneration':
    case 'saveAcademicTimetableConstraint':
    case 'deleteAcademicTimetableConstraint':
    case 'createAcademicTimetableVersion':
    case 'updateAcademicTimetableVersion':
    case 'deleteAcademicTimetableVersion':
    case 'copyAcademicTimetableVersion':
    case 'previewAcademicTimetableCopy':
    case 'copyAcademicTimetableSelection':
    case 'saveAcademicTimetableEntry':
    case 'bulkSaveAcademicTimetableEntries':
    case 'deleteAcademicTimetableEntry':
    case 'saveAcademicTimetableSubstitution':
    case 'cancelAcademicTimetableSubstitution':
    case 'changeAcademicTimetableVersionStatus':
    case 'saveAcademicStudentAttendance':
    case 'decideAcademicAttendanceCorrection':
    case 'getAcademicScorebookContext':
    case 'getAcademicClassScoreRegister':
    case 'applyActiveAcademicScoreLayout':
    case 'saveAcademicScoreDraft':
    case 'reactivateAcademicScoreEditing':
    case 'changeAcademicScoreSheetStatus':
    case 'previewAcademicScoreImport':
    case 'importAcademicScores':
    case 'rollbackAcademicScoreImport':
    case 'syncAcademicCbtScores':
    case 'syncLocalCbtStudentPasswords':
    case 'rescheduleAcademicCbtTest':
    case 'previewAcademicCbtRoster':
    case 'refreshAcademicCbtRoster':
    case 'previewAcademicCbtLateEntry':
    case 'createAcademicCbtLateEntry':
    case 'downloadAcademicCbtTestPackage':
    case 'acknowledgeAcademicCbtImport':
    case 'prepareLocalCbtIdentityPackage':
    case 'calculateAcademicTermResults':
    case 'calculateAcademicMidTermResults':
    case 'previewAcademicTermResultWithdrawal':
    case 'changeAcademicTermResultStatus':
    case 'saveAcademicTermResultRemarks':
    case 'calculateAcademicCumulativeResults':
    case 'changeAcademicCumulativeStatus':
    case 'saveAcademicCumulativeResultRemarks':
    case 'calculateAcademicPromotionDecisions':
    case 'saveAcademicPromotionOutcome':
    case 'saveAcademicProbationResit':
    case 'changeAcademicPromotionStatus':
    case 'createAcademicTranscriptDraft':
    case 'changeAcademicTranscriptStatus':
    case 'moveAcademicStudentMembership':
    case 'withdrawAcademicStudentMembership':
    case 'reinstateAcademicStudentMembership':
    case 'archiveAcademicRecord':
    case 'deleteAcademicRecord': {
      const role = clean(body.UserRole);
      const configuredTabs = Array.isArray(body.UserTabAccess) ? body.UserTabAccess.map(clean).filter(Boolean) : [];
      return handleAcademicManagementAction(env, {
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role,
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId),
        schoolSectionAccess: clean(body.UserSchoolSectionAccess || 'All'),
        edition: deploymentIdentity?.edition || 'school',
        allowedSections: configuredTabs.length
          ? configuredTabs
          : defaultModulesForRole(role, {
            edition: deploymentIdentity?.edition || 'school', department: clean(body.UserDepartment)
          }),
        subscriptionActive: true,
        subscriptionReadOnly: false
      }, body);
    }
    case 'getExecutiveOffice':
    case 'searchExecutiveDirectory':
    case 'listOfficialCorrespondence':
    case 'saveOfficialCorrespondenceDraft':
    case 'saveOfficialCorrespondenceTemplate':
    case 'getOfficialCorrespondenceDocument':
    case 'issueOfficialCorrespondence':
    case 'sendOfficialCorrespondence':
    case 'saveExecutiveDashboardPreferences': {
      const mappedAction = {
        getExecutiveOffice: 'bootstrap',
        searchExecutiveDirectory: 'search',
        listOfficialCorrespondence: 'list',
        saveOfficialCorrespondenceDraft: 'saveDraft',
        saveOfficialCorrespondenceTemplate: 'saveTemplate',
        getOfficialCorrespondenceDocument: 'document',
        issueOfficialCorrespondence: 'issue',
        sendOfficialCorrespondence: 'send',
        saveExecutiveDashboardPreferences: 'savePreferences'
      }[action];
      const requiresDecisionProof = ['issueOfficialCorrespondence', 'sendOfficialCorrespondence'].includes(action);
      if (requiresDecisionProof && body.AuthorizationVerified !== true) {
        const error = new Error('Confirm this official action with the current desktop user password.');
        error.status = 403;
        throw error;
      }
      return handleExecutiveOfficeAction(env, {
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role: clean(body.UserRole),
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId),
        schoolSectionAccess: clean(body.UserSchoolSectionAccess || 'All')
      }, {
        ...body,
        action: mappedAction
      }, {
        authorization: requiresDecisionProof
          ? { method: 'Desktop password', sourcePlatform: 'Desktop Executive Office' }
          : null,
        sourcePlatform: 'Desktop Executive Office',
        publicOrigin
      });
    }
    case 'getChurchMembership':
    case 'saveChurchMember':
    case 'saveChurchHousehold':
    case 'importChurchMembers':
      return handleChurchMembershipAction(env, {
        edition: deploymentIdentity?.edition,
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role: clean(body.UserRole),
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId)
      }, body);
    case 'getOrganizationDepartments':
    case 'saveDepartment':
    case 'importOrganizationMembers':
    case 'importDepartments':
    case 'deleteDepartment':
    case 'savePosition':
    case 'saveDepartmentMember':
    case 'removeDepartmentMember':
    case 'saveDepartmentMeeting':
    case 'recordDepartmentAttendance':
    case 'saveDepartmentOffering':
    case 'markDepartmentOfferingPaid':
    case 'saveSpecialProgram':
    case 'registerProgramParticipant':
    case 'saveForeignVisitor': {
      const departmentActor = {
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role: clean(body.UserRole),
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId),
        edition: deploymentIdentity?.edition,
        allowedSections: Array.isArray(body.UserTabAccess) ? body.UserTabAccess.map(clean).filter(Boolean) : []
      };
      assertOrganizationDepartmentWorkspaceAccess(deploymentIdentity, departmentActor);
      const departmentAction = ({
        getOrganizationDepartments: 'list',
        saveDepartment: 'saveDepartment',
        importOrganizationMembers: 'importMembers',
        importDepartments: 'importDepartments',
        deleteDepartment: 'deleteDepartment',
        savePosition: 'savePosition',
        saveDepartmentMember: 'saveDepartmentMember',
        removeDepartmentMember: 'removeDepartmentMember',
        saveDepartmentMeeting: 'saveMeeting',
        recordDepartmentAttendance: 'recordAttendance',
        saveDepartmentOffering: 'saveOffering',
        markDepartmentOfferingPaid: 'markOfferingPaid',
        saveSpecialProgram: 'saveProgram',
        registerProgramParticipant: 'registerParticipant',
        saveForeignVisitor: 'saveForeignVisitor'
      })[action];
      return handleOrganizationDepartmentAction(env, departmentActor, {
        ...body,
        // The organisation handler accepts both legacy `Action` and modern
        // `action`. Normalise both so the original desktop command cannot
        // override the mapped operation.
        Action: departmentAction,
        action: departmentAction
      });
    }
    case 'getChurchServices':
    case 'saveChurchService':
    case 'saveChurchServiceOccurrence':
    case 'recordChurchAttendance':
      return handleChurchServiceAction(env, {
        edition: deploymentIdentity?.edition,
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
    case 'getHotelServices':
    case 'saveHotelRoomMedia':
    case 'saveHotelKeyDevice':
    case 'saveHotelKeySlot':
    case 'resolveHotelKeyCommand':
    case 'saveHotelRoom':
    case 'saveHotelReservation':
    case 'changeHotelReservationStatus':
    case 'recordHotelCharge':
    case 'recordHotelPayment':
    case 'setHotelHousekeepingStatus': {
      const hotelUser = {
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role: clean(body.UserRole),
        assignedRole: clean(body.UserAssignedRole || body.UserRole),
        tabAccess: body.UserTabAccess,
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId),
        edition: deploymentIdentity?.edition || clean(body.OrganisationEdition || body.OrganizationEdition)
      };
      const hotelAccess = await staffAccessFor(env, hotelUser);
      if (!hotelUser.username || !['faith', 'organization'].includes(hotelAccess.edition)
        || hotelAccess.subscriptionActive === false || !hotelAccess.allowedSections?.includes('hotel')
        || (action !== 'getHotelServices' && hotelAccess.subscriptionReadOnly)) {
        throw Object.assign(new Error('Hotel Services is not available to this account or subscription for this action.'), { status: 403 });
      }
      Object.assign(hotelUser, hotelAccess);
      const result = await handleHotelAction(env, hotelUser, body);
      if (action !== 'getHotelServices' || !result?.ok) return result;
      try {
        return {
          ...result,
          selfService: await buildHotelSelfServiceQr(env, hotelUser, body, publicOrigin)
        };
      } catch (error) {
        return { ...result, selfServiceError: error.message || String(error) };
      }
    }
    case 'getChurchOfferings':
    case 'saveChurchOffering':
    case 'reconcileChurchOffering':
    case 'approveChurchOffering':
    case 'rejectChurchOffering':
    case 'postChurchOffering':
    case 'approvechurchoffering':
    case 'rejectchurchoffering':
    case 'postchurchoffering':
      return handleChurchOfferingAction(env, {
        username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy),
        role: clean(body.UserRole),
        department: clean(body.UserDepartment),
        branchId: clean(body.UserBranchId)
      }, body);
    case 'updateStudentProfile':
      return updateStudentProfile(env, body);
    case 'reissueParentOnboarding':
      return reissueParentOnboarding(env, body);
    case 'getAdmissionClasses':
      return getAdmissionClasses(env, body);
    case 'saveAdmissionClasses':
      return saveAdmissionClasses(env, body);
    case 'resetAdmissionClasses':
      return resetAdmissionClasses(env, body);
    case 'getSchoolClasses':
      return getSchoolClasses(env, body);
    case 'saveSchoolClasses':
      return saveSchoolClasses(env, body);
    case 'resetSchoolClasses':
      return resetSchoolClasses(env, body);
    case 'saveFeeItem':
      return saveFeeItem(env, body);
    case 'saveFeeItems':
      return saveFeeItems(env, body);
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
    case 'deleteStoreCategory':
      return deleteStoreCategoryAction(env, body);
    case 'updateStoreOrderStatus':
      return updateStoreOrderStatus(env, body);
    case 'deleteFeeItem':
      return deleteFeeItem(env, body);
    case 'seedDefaultFeeItems':
      return seedDefaultFeeItems(env, body);
    case 'generateSchoolFeeInvoices':
      return generateSchoolFeeInvoices(env, body);
    case 'recordManualPayment':
      requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
      return recordManualPayment(env, body, { reviewWalletDuplicates: true });
    case 'importHistoricalPayments':
      return importHistoricalPayments(env, body);
    case 'getHistoricalPaymentTemplateAccounts':
      return getHistoricalPaymentTemplateAccounts(env, body);
    case 'getWalletCardAccount':
      return getWalletCardAccount(env, body);
    case 'saveWalletCard':
      return saveWalletCard(env, body);
    case 'getTuckShopCatalog':
    case 'searchTuckShopCustomers':
    case 'recordTuckShopStaffSale': {
      const access = await staffAccessFor(env, {
        username: clean(body.UserUsername), role: clean(body.UserRole),
        assignedRole: clean(body.UserAssignedRole || body.UserRole),
        branchId: clean(body.UserBranchId), tabAccess: body.UserTabAccess,
        department: clean(body.UserDepartment)
      });
      if (clean(deploymentIdentity?.edition || access.edition).toLowerCase() !== 'school'
        || !(access.allowedSections || []).includes('tuckShop')) {
        const err = new Error('Tuck Shop is not available for this officer.'); err.status = 403; throw err;
      }
      if (action === 'recordTuckShopStaffSale' && (access.subscriptionActive === false || access.subscriptionReadOnly === true)) {
        const err = new Error('Tuck Shop sales are read-only until the subscription is renewed.'); err.status = 403; throw err;
      }
      const actor = { ...access, username: clean(body.UserUsername),
        displayName: clean(body.RecordedBy || body.UserUsername),
        branchId: clean(body.UserBranchId), edition: 'school' };
      if (action === 'getTuckShopCatalog') return getTuckShopCatalog(env, actor);
      if (action === 'searchTuckShopCustomers') return searchTuckShopCustomers(env, actor, body);
      return recordTuckShopStaffSale(env, actor, body);
    }
    case 'recordWalletPurchase':
      if (normalizeMatchText(body.Department || body.department) === 'tuck shop') {
        const access = await staffAccessFor(env, {
          username: clean(body.UserUsername), role: clean(body.UserRole),
          assignedRole: clean(body.UserAssignedRole || body.UserRole),
          branchId: clean(body.UserBranchId), tabAccess: body.UserTabAccess,
          department: clean(body.UserDepartment)
        });
        if (clean(deploymentIdentity?.edition || access.edition).toLowerCase() !== 'school'
          || !(access.allowedSections || []).includes('tuckShop')
          || access.subscriptionActive === false || access.subscriptionReadOnly === true) {
          const err = new Error('Tuck Shop checkout is not available for this officer.'); err.status = 403; throw err;
        }
      }
      return recordWalletPurchase(env, body);
    case 'recordCreditAction':
      return recordCreditAction(env, body);
    case 'updateStudentBillingCategory':
      return updateStudentBillingCategory(env, body);
    case 'updateStudentStatus':
      return updateStudentStatus(env, body);
    case 'getAccountsOverview':
      return getAccountsOverview(env, {}, body);
    case 'getAccountSnapshot':
      return getAccountSnapshot(env, body);
    case 'getAccountingOverview':
      return getAccountingOverview(env, body);
    case 'getAccountingJournalPage':
      return getAccountingJournalPage(env, body);
    case 'getAccountingFinancePage':
      return getAccountingFinancePage(env, body);
    case 'getAccountingRequisitionDocument':
      return getAccountingRequisitionDocument(env, body);
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
      return syncRevenueToAccounting(env, body);
    case 'saveChartAccount':
      return saveChartAccount(env, body);
    case 'saveAccountingJournal':
      requireAccountingRole(body, ['Super Admin', 'Accounts Officer']);
      return { ok: true, message: 'Journal saved.', journal: await saveAccountingJournal(env, body) };
    case 'saveAccountingExpense':
      return saveAccountingExpense(env, body);
    case 'submitAccountingImprest':
      return submitAccountingImprest(env, body);
    case 'reviewAccountingImprest':
      return reviewAccountingImprest(env, body);
    case 'issueAccountingImprest':
      return issueAccountingImprest(env, body);
    case 'submitAccountingImprestRetirement':
      return submitAccountingImprestRetirement(env, body);
    case 'verifyAccountingImprestRetirement':
      return verifyAccountingImprestRetirement(env, body);
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
      return saveBrevoSettings(env, body, deploymentIdentity);
    case 'saveSchoolProfile':
      return saveSchoolProfile(env, body, deploymentIdentity);
    case 'saveOrganizationModulePreferences':
      return saveOrganizationModulePreferences(env, body);
    case 'saveOrganisationStructure':
      return saveOrganisationStructure(env, body, deploymentIdentity);
    case 'getSchoolProfile':
      return getSchoolProfile(env, { ...body, includeTutorials: true });
    case 'resetBranchProfileOverrides': {
      const reset = await resetBranchProfileOverrides(env, body.BranchId || body.branchId);
      const result = await getSchoolProfile(env, { branchId: reset.branch.id, includeTutorials: true });
      return {
        ...result,
        message: `${reset.branch.name} now inherits every organisation setting.`
      };
    }
    case 'getPayableFees':
      return getPayableFees(env, body);
    case 'getClinicRecords':
      return getClinicRecords(env, body);
    case 'saveClinicRecord':
      return saveClinicRecord(env, body);
    case 'getClinicInventory':
      return {
        ok: true,
        message: 'Clinic inventory loaded from the database.',
        inventory: (await desktopInventoryRows(env, body, 'clinicInventory')).map(normalizeInventory)
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
        message: 'Kitchen inventory loaded from the database.',
        inventory: (await desktopInventoryRows(env, body, 'kitchenInventory')).map(normalizeInventory)
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
    case 'updateProbationResit':
      return updateProbationResit(env, body);
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
      const err = new Error(`Database action is not implemented yet: ${action}`);
      err.status = 400;
      throw err;
    }
  }
}

export async function onRequestPost(context) {
  const metric = startRequestMetric(context.request, '/api/backend');
  let action = '';
  try {
    const { request, env } = context;
    let body = await readJsonBody(request, { maxBytes: 16 * 1024 * 1024 });
    const desktopAuthentication = await requireBackendSecret(env, body);
    action = clean(body.Action || body.action);
    if (!action) {
      const error = new Error('Action is required.');
      error.status = 400;
      throw error;
    }
    body = applyDesktopDeviceBranchScope(body, desktopAuthentication);
    body = enforceDesktopDeviceActionScope(desktopAuthentication, action, body);
    const expectedIdentity = expectedDeploymentIdentityFromRequest(request, body);
    const configuredIdentity = assertExpectedDeploymentIdentity(env, expectedIdentity);
    requireFirestoreEnv(env);
    const deploymentIdentity = await loadDeploymentIdentity(env, { identity: configuredIdentity });
    body = await verifyDesktopActor(env, action, body);
    if (clean(body.UserAssignedRole || body.UserRole) === 'Vendor User' && action !== 'vendorSettlements') {
      const error = new Error('Vendor accounts may access only their own sales and settlements.'); error.status = 403; throw error;
    }
    if (context.data) {
      // Shared with middleware only after authoritative authentication; never trust a posted name.
      if (VERIFIED_ACTOR_ACTIONS.has(action)) context.data.securityAuditActor = {
        username: body.UserUsername, displayName: body.RecordedBy,
        role: body.UserAssignedRole || body.UserRole, branchId: body.UserBranchId
      };
      context.data.securityAuditAction = securityAuditAction({ pathname: '/api/backend', method: 'POST', body });
    }
    // An authoritative actor lookup can replace UserBranchId. Reapplying the
    // device scope both detects a user assigned elsewhere and preserves the
    // approved computer branch for downstream reads and writes.
    body = applyDesktopDeviceBranchScope(body, desktopAuthentication);
    const data = await routeAction(env, action, body, deploymentIdentity, new URL(request.url).origin);
    if (context.data && action === 'recordManualPayment' && data.code === 'WALLET_DUPLICATE_REVIEW_REQUIRED') {
      context.data.securityAuditAction = 'Review possible duplicate manual wallet top-up';
      context.data.securityAuditSummary = `Manual wallet top-up for student ${data.duplicateReview.Student.AccountRef} was stopped for review because ${data.duplicateReview.MatchCount} same-amount credit(s) were found. No new payment or wallet credit was recorded.`;
    }
    if (context.data && action === 'recordManualPayment' && data.ok && data.payment) {
      context.data.securityAuditAction = data.duplicate ? 'Check previously recorded manual payment' : 'Record manual payment';
      context.data.securityAuditSummary = paymentAuditSummary(data.payment, { duplicate: data.duplicate });
    }
    if (context.data && action === 'manualPaymentCorrection' && body.Command === 'post' && data.ok) {
      // The atomic correction already writes a detailed accounting audit event.
      context.data.securityAuditHandled = !data.replayed;
      if (data.replayed) {
        context.data.securityAuditAction = 'Check previously posted manual payment correction';
        context.data.securityAuditSummary = 'The earlier correction was found. This retry did not change any balance again.';
      }
    }
    finishRequestMetric(metric, { status: 200, action });
    return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Firestore backend failure', err);
    finishRequestMetric(metric, { status, action: action || 'unknown', outcome: err?.code || 'error' });
    const configurationMessage = err?.code === 'BACKEND_SECRET_NOT_CONFIGURED'
      || err?.code === 'BREVO_ENV_SECRET_REQUIRED'
      || String(err?.code || '').startsWith('BREVO_')
      || String(err?.code || '').startsWith('EMAIL_')
      || String(err?.code || '').startsWith('DEPLOYMENT_')
      ? String(err.message || 'The desktop backend is not configured.')
      : '';
    const cbtSyncFailure = action === 'syncAcademicCbtScores'
      && String(err?.code || '').startsWith('ACADEMIC_CBT_SYNC_')
      ? String(err?.message || 'The online scorebook is temporarily unavailable. Dynamax kept the approved batch safely queued and will not duplicate scores when it is retried.')
      : '';
    const responseCode = err?.code || '';
    return Response.json({
      ok: false,
      message: configurationMessage || cbtSyncFailure
        || (status >= 500 ? 'The backend could not complete this operation.' : String(err && err.message ? err.message : err)),
      ...(responseCode ? { code: responseCode } : {}),
      ...(responseCode === 'ACADEMIC_CBT_SYNC_TEMPORARY' ? { retryable: true } : {})
    }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function onRequestGet(context) {
  const metric = startRequestMetric(context.request, '/api/backend');
  try {
    const { request, env } = context;
    const deploymentIdentity = requiredDeploymentIdentity(env);
    requireFirestoreEnv(env);
    requireConfiguredDesktopSecret(env, 'desktop backend');
    const url = new URL(request.url);
    const action = clean(url.searchParams.get('action') || url.searchParams.get('Action'));
    if (action && action !== 'ping') {
      finishRequestMetric(metric, { status: 405, action });
      return Response.json({ ok: false, message: 'Backend actions require POST; credentials must not be placed in a URL.' }, {
        status: 405,
        headers: { Allow: 'POST', 'Cache-Control': 'no-store' }
      });
    }
    finishRequestMetric(metric, { status: 200, action: 'readiness' });
    const identity = {
      workspaceKey: deploymentIdentity.edition,
      workspaceId: deploymentIdentity.workspaceId,
      edition: deploymentIdentity.edition,
      environmentId: clean(env.FIREBASE_PROJECT_ID),
      firebaseProjectId: clean(env.FIREBASE_PROJECT_ID)
    };
    return Response.json({
      ok: true,
      message: 'Database backend is reachable.',
      backend: 'firestore',
      projectId: clean(env.FIREBASE_PROJECT_ID),
      workspaceKey: identity.workspaceKey,
      workspaceId: identity.workspaceId,
      edition: identity.edition,
      identity
    }, { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' } });
  } catch (err) {
    console.error('Firestore backend health-check failure', err);
    const status = Number(err?.status || 500);
    finishRequestMetric(metric, { status, action: 'readiness', outcome: err?.code || 'error' });
    return Response.json({
      ok: false,
      message: err?.code === 'BACKEND_SECRET_NOT_CONFIGURED'
        || String(err?.code || '').startsWith('DEPLOYMENT_')
        ? String(err.message)
        : 'The backend health check failed.',
      ...(err?.code ? { code: err.code } : {})
    }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
