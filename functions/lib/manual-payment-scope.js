import { canonicalSchoolBranchId, schoolSectionFor } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();
const referenceKey = (value) => clean(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join('|');
const references = (row = {}) => [row.AccountRef, row.accountRef, row.AdmissionNo, row.admissionNo,
  row.AdmissionNumber, row.admissionNumber, row.ApplicationReference, row.applicationReference,
  row.ApplicationID].map(clean).filter(Boolean);

function denied(message) {
  const error = new Error(message);
  error.status = 403;
  error.code = 'MANUAL_PAYMENT_SCOPE_MISMATCH';
  throw error;
}

export function manualPaymentRequestScope(body = {}) {
  const branches = [body.DeviceBranchId, body.UserBranchId, body.BranchId || body.branchId]
    .map(clean).filter((value) => value && value.toLowerCase() !== 'all').map((value) => canonicalSchoolBranchId(value));
  if (new Set(branches).size > 1) denied('The payment must remain within your approved branch.');
  const access = clean(body.UserSchoolSectionAccess || body.SchoolSectionAccess).toLowerCase();
  const selected = clean(body.SchoolSection || body.schoolSection).toLowerCase();
  const section = ['primary', 'secondary'].includes(access) ? access
    : (['primary', 'secondary'].includes(selected) ? selected : '');
  if (['primary', 'secondary'].includes(access) && selected && selected !== 'all' && selected !== access) {
    denied('The payment must remain within your authorised school section.');
  }
  return branches.length || section ? { branchId: branches[0] || '', schoolSectionAccess: section } : null;
}

// A financial row without a branch is a legacy Main Branch row, never a row
// belonging to whichever laptop submitted the request. Missing section metadata
// may inherit a verified account's section, but conflicting metadata may not.
export function assertManualPaymentScope(row, scope, label = 'Financial record', { accountRequired = true } = {}) {
  if (!row || !scope) return row;
  const path = /^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\//i.exec(clean(row.__scopePath));
  const explicitBranch = clean(row.BranchId || row.branchId);
  const branch = canonicalSchoolBranchId(path?.[1] || explicitBranch || 'main');
  if ((scope.branchId && branch !== scope.branchId)
    || (path && explicitBranch && canonicalSchoolBranchId(explicitBranch) !== branch)) {
    denied(`${label} is outside your approved branch. No cross-branch payment changes are permitted.`);
  }
  const explicitSection = clean(row.SchoolSection || row.schoolSection);
  const section = path?.[2]?.toLowerCase() || (explicitSection || row.ClassName || row.ClassApplyingFor
    ? schoolSectionFor(row) : '');
  if (scope.schoolSectionAccess && section && section !== scope.schoolSectionAccess) {
    denied(`${label} is outside your authorised school section.`);
  }
  if (path && explicitSection && schoolSectionFor(row) !== section) denied(`${label} has conflicting school-section ownership.`);
  if (scope.references) {
    const rowReferences = references(row);
    if ((accountRequired && !rowReferences.length)
      || rowReferences.some((value) => !scope.references.some((allowed) => referenceKey(value) === referenceKey(allowed)))) {
      denied(`${label} does not belong to the selected account. Finance must review its ownership.`);
    }
  }
  return row;
}

export function bindManualPaymentIdentity(body, identity, requestedScope) {
  assertManualPaymentScope(identity, requestedScope, 'Selected student or applicant');
  const allowedReferences = [...new Set(references(identity))];
  const scope = {
    branchId: requestedScope.branchId || canonicalSchoolBranchId(identity.BranchId || identity.branchId),
    schoolSectionAccess: schoolSectionFor(identity),
    references: allowedReferences
  };
  assertManualPaymentScope({
    AccountRef: body.AccountRef || body.accountRef || body.ApplicationReference,
    AdmissionNo: body.AdmissionNo,
    ApplicationReference: body.ApplicationReference,
    BranchId: scope.branchId,
    SchoolSection: scope.schoolSectionAccess
  }, scope, 'Payment identity');
  return {
    scope,
    body: {
      ...body,
      BranchId: scope.branchId, SchoolSection: scope.schoolSectionAccess,
      AdmissionNo: clean(identity.AdmissionNo || identity.AdmissionNumber),
      ApplicationReference: clean(identity.ApplicationReference || identity.ApplicationID),
      DisplayName: clean(identity.DisplayName || identity.ApplicantName || identity.Name),
      ClassName: clean(identity.ClassName || identity.ClassApplyingFor),
      ParentEmail: clean(identity.ParentEmail || identity.VerificationEmail || identity.Email),
      ParentEmails: [...new Set([...(Array.isArray(identity.ParentEmails) ? identity.ParentEmails : []), identity.ParentEmail,
        identity.VerificationEmail, identity.Email, identity.FatherEmail, identity.MotherEmail,
        identity.GuardianEmail].map(clean).filter(Boolean))],
      StudentType: clean(identity.StudentType), BillingCategory: clean(identity.BillingCategory) || 'Regular'
    }
  };
}

export function assertManualPaymentRetry(payment, body, scope, creditedAmount) {
  if (!scope) return;
  assertManualPaymentScope(payment, scope, 'Existing payment reference');
  if (clean(payment.FeeCode).toLowerCase() !== clean(body.FeeCode || body.feeCode).toLowerCase()
    || Math.abs(Number(payment.Amount) - creditedAmount) > 0.005
    || clean(payment.Currency || 'NGN').toUpperCase() !== clean(body.Currency || 'NGN').toUpperCase()) {
    const error = new Error('This reference already belongs to a different payment. Use its original account, fee and amount, or a new reference.');
    error.status = 409;
    error.code = 'MANUAL_PAYMENT_REFERENCE_CONFLICT';
    throw error;
  }
}

export function assertManualPaymentDestination(row, scope, reference, label, options = {}) {
  if (!row || !scope) return row;
  assertManualPaymentScope(row, scope, label, options);
  const paymentReferences = [row.Reference, row.SourceId].map(clean).filter(Boolean);
  if ((!paymentReferences.length && options.accountRequired === false)
    || paymentReferences.some((value) => value !== clean(reference))) {
    const error = new Error(`${label} belongs to a different payment reference. Finance review is required.`);
    error.status = 409;
    error.code = 'MANUAL_PAYMENT_REFERENCE_CONFLICT';
    throw error;
  }
  return row;
}

export function scopedPaymentWriteCondition(prior, scope) {
  if (!scope) return {};
  if (!prior) return { exists: false };
  if (prior.__updateTime) return { updateTime: prior.__updateTime };
  const error = new Error('The financial record version could not be verified. Refresh and retry.');
  error.status = 409;
  throw error;
}
