// Cloudflare Pages Function: /api/parent-dashboard
// Parent-facing dashboard for child activity and wallet restrictions.

import { getPayableFees } from './backend.js';
import { createDocumentIfAbsent, getDocument, listCollection, queryCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import {
  querySchoolCollection,
  schoolCollectionPaths,
  schoolSectionFor,
  upsertSchoolDocument
} from '../lib/school-scope.js';
import { getStoredDocument } from '../lib/document-storage.js';
import { consumeRequestAllowance, readJsonBody, secureSecretEqual } from '../lib/request-security.js';
import { getWebBranding } from '../lib/web-branding.js';
import {
  clearParentSessionCookie,
  createParentPasswordSetupToken,
  createParentSession,
  getParentCredential,
  parentSessionCookie,
  readParentPasswordSetupToken,
  readParentSession,
  saveParentPassword,
  verifyStoredParentPassword
} from '../lib/parent-auth.js';
import {
  archiveNotification,
  createNotification,
  listNotifications,
  loadNotificationSettings,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTargetsRecipient
} from '../lib/notifications.js';
import {
  listPushSubscriptions,
  publicMessagingConfig,
  removePushSubscription,
  savePushSubscription
} from '../lib/firebase-messaging.js';
import { effectiveBranchProfile } from '../lib/branch-profile-settings.js';
import { academicPolicyIssues, academicPolicyScopeChain } from '../lib/academic-policy.js';
import { loadAcademicPolicyView } from '../lib/academic-policy-store.js';
import {
  academicFeeCategoryBalances,
  academicFinancialSummary,
  evaluateAcademicResultAccess,
  publicAcademicResult
} from '../lib/academic-result-access.js';
import { academicTimetablePeriodsForDay } from '../lib/academic-timetable-attendance.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

const PARENT_ONBOARDING_TEMPORARY_PASSWORD = '12345678';

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function onboardingStatus(student = {}) {
  return lower(student.ParentOnboardingStatus || student.parentOnboardingStatus);
}

function validParentEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower(value));
}

function validIsoDate(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function requireParentOnboardingStudent(env, body, expectedStatus = 'pendingprofile') {
  const admissionNo = clean(body.admissionNo || body.AdmissionNo);
  const token = clean(body.onboardingToken || body.ParentOnboardingToken);
  const temporaryPassword = String(body.temporaryPassword || body.password || '');
  if (!admissionNo || !token || !temporaryPassword) {
    const error = new Error('Admission number, completion link and one-time password are required.');
    error.status = 400;
    throw error;
  }
  const student = await getSelectedIdentityRow(env, 'students', admissionNo);
  const suppliedHash = await sha256Hex(token);
  const tokenMatches = student && await secureSecretEqual(student.ParentOnboardingTokenHash, suppliedHash);
  const passwordMatches = await secureSecretEqual(temporaryPassword, PARENT_ONBOARDING_TEMPORARY_PASSWORD);
  if (!student || onboardingStatus(student) !== expectedStatus || !tokenMatches || !passwordMatches) {
    const error = new Error('This student completion link or one-time sign-in is invalid or has already been used.');
    error.status = 401;
    throw error;
  }
  return student;
}

function publicOnboardingStudent(student = {}) {
  return {
    admissionNo: clean(student.AdmissionNo || student.__id),
    studentName: clean(student.DisplayName || student.ApplicantName),
    gender: clean(student.Gender),
    className: clean(student.ClassName || student.ClassAdmitted),
    dateOfBirth: clean(student.DateOfBirth),
    studentType: clean(student.StudentType),
    parentName: clean(student.ParentName),
    parentEmail: lower(student.ParentEmail),
    parentPhone: clean(student.ParentPhone),
    residentialAddress: clean(student.ResidentialAddress),
    cityArea: clean(student.CityArea),
    stateOfResidence: clean(student.StateOfResidence),
    bloodGroup: clean(student.BloodGroup),
    genotype: clean(student.Genotype),
    medicalCondition: clean(student.MedicalCondition),
    emergencyContactName: clean(student.EmergencyContactName),
    emergencyContactPhone: clean(student.EmergencyContactPhone),
    previousSchool: clean(student.PreviousSchool)
  };
}

async function assertParentOnboardingAllowance(env, request) {
  const allowance = await consumeRequestAllowance(env, request, {
    scope: 'parent-student-onboarding',
    maximum: 20,
    windowSeconds: 60 * 60
  });
  if (!allowance.allowed) {
    const error = new Error('Too many parent onboarding attempts. Please wait and try again.');
    error.status = 429;
    throw error;
  }
}

async function beginParentOnboarding(env, body, request) {
  await assertParentOnboardingAllowance(env, request);
  const student = await requireParentOnboardingStudent(env, body);
  return {
    ok: true,
    student: publicOnboardingStudent(student),
    message: 'Student record confirmed. Complete the remaining information below.'
  };
}

async function completeParentOnboardingProfile(env, body, request) {
  await assertParentOnboardingAllowance(env, request);
  const student = await requireParentOnboardingStudent(env, body);
  const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
  const confirmedParentEmail = lower(profile.confirmParentEmail || profile.ConfirmParentEmail);
  const values = {
    DateOfBirth: clean(profile.dateOfBirth || profile.DateOfBirth),
    StudentType: clean(profile.studentType || profile.StudentType),
    ParentName: clean(profile.parentName || profile.ParentName),
    ParentEmail: lower(profile.parentEmail || profile.ParentEmail),
    ParentPhone: clean(profile.parentPhone || profile.ParentPhone),
    ResidentialAddress: clean(profile.residentialAddress || profile.ResidentialAddress),
    CityArea: clean(profile.cityArea || profile.CityArea),
    StateOfResidence: clean(profile.stateOfResidence || profile.StateOfResidence),
    BloodGroup: clean(profile.bloodGroup || profile.BloodGroup),
    Genotype: clean(profile.genotype || profile.Genotype),
    MedicalCondition: clean(profile.medicalCondition || profile.MedicalCondition),
    EmergencyContactName: clean(profile.emergencyContactName || profile.EmergencyContactName),
    EmergencyContactPhone: clean(profile.emergencyContactPhone || profile.EmergencyContactPhone),
    PreviousSchool: clean(profile.previousSchool || profile.PreviousSchool)
  };
  const required = [
    ['Date of birth', values.DateOfBirth],
    ['Student type', values.StudentType],
    ['Parent or guardian name', values.ParentName],
    ['Parent email', values.ParentEmail],
    ['Parent phone', values.ParentPhone],
    ['Residential address', values.ResidentialAddress],
    ['Emergency contact name', values.EmergencyContactName],
    ['Emergency contact phone', values.EmergencyContactPhone]
  ];
  const missing = required.filter(([, value]) => !value).map(([label]) => label);
  if (missing.length) {
    const error = new Error(`Complete these required fields: ${missing.join(', ')}.`);
    error.status = 400;
    throw error;
  }
  if (!validParentEmail(values.ParentEmail)) {
    const error = new Error('Enter a valid parent email address.');
    error.status = 400;
    throw error;
  }
  if (!confirmedParentEmail || confirmedParentEmail !== values.ParentEmail) {
    const error = new Error('The parent email and confirmation do not match.');
    error.status = 400;
    throw error;
  }
  if (!validIsoDate(values.DateOfBirth)) {
    const error = new Error('Enter a valid date of birth.');
    error.status = 400;
    throw error;
  }
  if (!['Day Student', 'Boarding Student'].includes(values.StudentType)) {
    const error = new Error('Select a valid student type.');
    error.status = 400;
    throw error;
  }
  const oversized = Object.entries(values).find(([field, value]) => {
    const maximum = ['ResidentialAddress', 'MedicalCondition'].includes(field) ? 2000 : 300;
    return String(value || '').length > maximum;
  });
  if (oversized) {
    const error = new Error('One or more profile fields are too long.');
    error.status = 400;
    throw error;
  }
  const existingCredential = await getParentCredential(env, values.ParentEmail);
  const now = nowIso();
  const updated = {
    ...student,
    ...values,
    ParentOnboardingTokenHash: '',
    ParentOnboardingStatus: existingCredential ? 'Complete' : 'AwaitingPassword',
    ParentOnboardingProfileCompletedAt: now,
    ProfileCompletionStatus: 'Complete',
    UpdatedAt: now,
    UpdatedBy: 'Parent onboarding'
  };
  await upsertSchoolDocument(env, 'students', safeDocumentId(student.__id || student.AdmissionNo), updated);
  return {
    ok: true,
    parentEmail: values.ParentEmail,
    requiresTemporaryLogin: !existingCredential,
    message: existingCredential
      ? 'Profile completed. Sign in with your existing parent password.'
      : 'Profile completed. Sign in again with your email address and the one-time password 12345678, then create your private password.'
  };
}

async function pendingParentPasswordStudent(env, email, secret) {
  if (!validParentEmail(email)) return null;
  if (!(await secureSecretEqual(secret, PARENT_ONBOARDING_TEMPORARY_PASSWORD))) return null;
  if (await getParentCredential(env, email)) return null;
  const rows = await querySchoolCollection(env, 'students', {
    filters: [{ field: 'ParentEmail', op: '==', value: lower(email) }]
  }).catch(() => []);
  const pending = rows.filter((row) => onboardingStatus(row) === 'awaitingpassword');
  return pending[0] || null;
}

async function requireParentPasswordChange(env, email, secret, request) {
  if (!(await secureSecretEqual(secret, PARENT_ONBOARDING_TEMPORARY_PASSWORD))) return null;
  await assertParentOnboardingAllowance(env, request);
  const student = await pendingParentPasswordStudent(env, email, secret);
  if (!student) return null;
  return {
    ok: true,
    passwordChangeRequired: true,
    parentEmail: lower(email),
    passwordSetupToken: await createParentPasswordSetupToken(env, email, student.AdmissionNo || student.__id),
    message: 'Create a private password before opening the parent dashboard.'
  };
}

async function completeParentPasswordSetup(env, body, request) {
  await assertParentOnboardingAllowance(env, request);
  const setup = await readParentPasswordSetupToken(env, body.passwordSetupToken);
  if (!setup) {
    const error = new Error('The password setup request has expired. Sign in with the one-time password again.');
    error.status = 401;
    throw error;
  }
  const newPassword = String(body.newPassword || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (newPassword !== confirmPassword) {
    const error = new Error('The new password and confirmation do not match.');
    error.status = 400;
    throw error;
  }
  if (await secureSecretEqual(newPassword, PARENT_ONBOARDING_TEMPORARY_PASSWORD)) {
    const error = new Error('Choose a private password that is different from the one-time password.');
    error.status = 400;
    throw error;
  }
  const student = await getSelectedIdentityRow(env, 'students', setup.admissionNo);
  if (!student || onboardingStatus(student) !== 'awaitingpassword' || lower(student.ParentEmail) !== setup.email) {
    const error = new Error('This password setup request is no longer valid.');
    error.status = 401;
    throw error;
  }
  await saveParentPassword(env, setup.email, newPassword);
  const now = nowIso();
  await upsertSchoolDocument(env, 'students', safeDocumentId(student.__id || student.AdmissionNo), {
    ...student,
    ParentOnboardingStatus: 'Complete',
    ParentOnboardingCompletedAt: now,
    UpdatedAt: now,
    UpdatedBy: 'Parent onboarding'
  });
  return {
    ok: true,
    parentEmail: setup.email,
    message: 'Private password saved. Your parent dashboard is now ready.'
  };
}

export function parentChildIdentity(child = {}) {
  const scopePath = clean(child.__scopePath).replace(/^\/+|\/+$/g, '').toLowerCase();
  const accountRef = lower(child.AccountRef);
  return `${scopePath}|${accountRef}`;
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

function scopedRecordBranch(row = {}) {
  const explicit = clean(row.BranchId || row.branchId);
  if (explicit) return lower(explicit);
  const match = clean(row.__scopePath).match(/schoolBranches\/([^/]+)/i);
  return lower(match?.[1] || 'main');
}

function scopedRecordSection(row = {}) {
  const explicit = clean(row.SchoolSection || row.schoolSection);
  if (explicit) return lower(explicit);
  const match = clean(row.__scopePath).match(/\/sections\/([^/]+)/i);
  return lower(match?.[1] || schoolSectionFor(row));
}

function parentNotificationRecipient(email, children = [], schoolId = '') {
  const scopes = (children || []).flatMap((child) => {
    const branchId = scopedRecordBranch(child);
    const schoolSection = scopedRecordSection(child);
    return accountKeys(child).map((accountRef) => ({
      accountRef: lower(accountRef),
      branchId,
      schoolSection
    }));
  });
  return {
    audience: 'Parent',
    schoolId: lower(schoolId),
    recipientKey: lower(email),
    email: lower(email),
    accountRefs: [...new Set((children || []).flatMap((child) => accountKeys(child)).map(lower).filter(Boolean))],
    branchIds: [...new Set((children || []).map(scopedRecordBranch).filter(Boolean))],
    schoolSections: [...new Set((children || []).map(scopedRecordSection).filter(Boolean))],
    scopes
  };
}

async function parentNotifications(env, email, children) {
  return listNotifications(env, parentNotificationRecipient(email, children, env.DYNAMAX_WORKSPACE_ID), { limit: 60 })
    .catch(() => ({ notifications: [], unreadCount: 0 }));
}

export function parentPayableNotificationIdentity(payable = {}) {
  const account = payable?.account || {};
  return {
    accountRef: clean(account.AccountRef || account.AdmissionNo || account.ApplicationReference),
    email: lower(account.Email || account.ParentEmail || account.VerificationEmail),
    branchId: scopedRecordBranch(account),
    schoolSection: scopedRecordSection(account)
  };
}

function payableNotificationPeriod(configured, current) {
  const value = clean(configured);
  return !value || ['all', '*'].includes(lower(value)) ? clean(current) : value;
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

export function parentOwnsApplication(application, email) {
  const wantedEmail = lower(email);
  if (!wantedEmail || !application) return false;
  return [
    pick(application, ['VerificationEmail', 'verificationEmail']),
    pick(application, ['ParentEmail', 'parentEmail']),
    pick(application, ['Email', 'email'])
  ].some((value) => lower(value) === wantedEmail);
}

export function findParentOwnedApplication(applications, accountRef, email, scopePath = '') {
  const suppliedScopePath = clean(scopePath);
  const requestedScopePath = identityScopePathForCollection(scopePath, 'applications');
  if (suppliedScopePath && !requestedScopePath) return null;
  const matches = (applications || []).filter((row) => {
    if (!parentOwnsApplication(row, email)) return false;
    if (requestedScopePath &&
        lower(identityScopePathForCollection(row, 'applications')) !== lower(requestedScopePath)) {
      return false;
    }
    return applicationKeys(row)
      .some((ref) => sameText(ref, accountRef) || referencesMatch(ref, accountRef));
  });
  return matches.length === 1 ? matches[0] : null;
}

function applicationScopeMatchesChild(application, child) {
  const applicationScope = identityScopePathForCollection(application, 'applications');
  const childScope = identityScopePathForCollection(child, 'applications');
  if (applicationScope || childScope) {
    return Boolean(applicationScope && childScope && sameText(applicationScope, childScope));
  }
  return sameText(scopedRecordBranch(application), scopedRecordBranch(child)) &&
    sameText(scopedRecordSection(application), scopedRecordSection(child));
}

export function applicationMatchesChild(application, child) {
  if (!application || !child || !applicationScopeMatchesChild(application, child)) return false;
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
  return appKeys.some((appKey) => childKeys.some((childKey) => sameText(appKey, childKey) || referencesMatch(appKey, childKey)));
}

export function findScopedChildApplication(applications, child) {
  return (applications || []).find((application) => applicationMatchesChild(application, child)) || null;
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

function scopedPathIdentity(scopePath = '') {
  const match = clean(scopePath)
    .replace(/^\/+|\/+$/g, '')
    .match(/^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/[^/]+$/i);
  return match ? {
    branchId: lower(match[1]),
    schoolSection: lower(match[2])
  } : null;
}

export function selectedChildActivityScope(scopePath, collection, child = {}) {
  const requestedScopePath = clean(scopePath);
  const validatedScopePath = validatedIdentityScopePath(requestedScopePath, collection);
  if (!requestedScopePath || !validatedScopePath) return null;
  const scopedIdentity = scopedPathIdentity(validatedScopePath);
  const branchId = scopedIdentity?.branchId || clean(child.BranchId || child.branchId);
  const schoolSection = scopedIdentity?.schoolSection || clean(child.SchoolSection || child.schoolSection);
  if (!branchId || !schoolSection) return null;
  return {
    scopePath: validatedScopePath,
    branchId: lower(branchId),
    schoolSection: lower(schoolSection)
  };
}

export function recordMatchesSelectedChildScope(row = {}, selectedScope = {}) {
  const pathIdentity = scopedPathIdentity(row.__scopePath);
  // Root-level records created before branch isolation did not always carry
  // BranchId or SchoolSection. Treat those records with the same legacy
  // defaults used everywhere else in school-scope.js: main branch plus the
  // section inferred from the record (secondary when no class is available).
  // A scoped collection path remains authoritative over conflicting fields.
  const branchId = pathIdentity?.branchId || scopedRecordBranch(row);
  const schoolSection = pathIdentity?.schoolSection || scopedRecordSection(row);
  if (!branchId || !schoolSection || !selectedScope.branchId || !selectedScope.schoolSection) return false;
  return lower(branchId) === lower(selectedScope.branchId) &&
    lower(schoolSection) === lower(selectedScope.schoolSection);
}

function selectedIdentityCandidateKey(row, collection) {
  const scopePath = identityScopePathForCollection(row, collection);
  const documentId = clean(row?.__id || row?.__name);
  if (documentId) return `${lower(scopePath)}|${lower(documentId.split('/').pop())}`;
  return `${lower(scopePath)}|${JSON.stringify(row || {})}`;
}

export async function getSelectedIdentityRow(env, collection, accountRef, scopePath = '', options = {}) {
  const documentId = safeDocumentId(accountRef);
  if (!documentId) return null;
  const readDocument = options.getDocument || getDocument;
  const getCollectionPaths = options.schoolCollectionPaths || schoolCollectionPaths;
  const queryIdentityRows = options.querySchoolCollection || querySchoolCollection;
  const requestedScopePath = clean(scopePath);
  const path = validatedIdentityScopePath(scopePath, collection);
  if (requestedScopePath && !path) return null;
  const paths = path ? [path] : await getCollectionPaths(env, collection).catch(() => []);
  const directMatches = (await Promise.all(paths.map(async (candidatePath) => {
    const row = await readDocument(env, candidatePath, documentId).catch(() => null);
    return row ? { ...row, __scopePath: candidatePath } : null;
  }))).filter(Boolean);
  const referenceFields = collection === 'applications'
    ? ['ApplicationReference', 'ApplicationID', 'AdmissionNo', 'AccountRef']
    : ['AdmissionNo', 'AccountRef', 'ApplicationReference', 'ApplicationID'];
  const referenceValues = [...new Set([
    clean(accountRef),
    clean(accountRef).toUpperCase(),
    clean(accountRef).toLowerCase()
  ].filter(Boolean))];
  let referenceMatches;
  try {
    const groups = await Promise.all(referenceFields.map((field) => queryIdentityRows(env, collection, {
      filters: [{
        field,
        op: referenceValues.length === 1 ? '==' : 'in',
        value: referenceValues.length === 1 ? referenceValues[0] : referenceValues
      }],
      limit: 2,
      ...(path ? { scopePath: path } : {})
    })));
    referenceMatches = groups.flat();
  } catch (_error) {
    // Without a complete uniqueness check, a direct credential must not bind
    // to whichever branch or section happens to be returned first.
    return null;
  }
  const matches = new Map();
  [...directMatches, ...referenceMatches].forEach((row) => {
    if (!row) return;
    const candidate = clean(row.__scopePath)
      ? row
      : { ...row, __scopePath: path || collection };
    matches.set(selectedIdentityCandidateKey(candidate, collection), candidate);
  });
  return matches.size === 1 ? [...matches.values()][0] : null;
}

async function querySchoolIdentity(env, collection, email, code) {
  // Load the complete family by its canonical parent email. The verification
  // code is still checked by assertParentAccess(), but it must not be used as
  // the family data filter because siblings legitimately have different
  // application codes.
  if (email) {
    const emailFields = collection === 'applications'
      ? ['VerificationEmail', 'ParentEmail', 'Email', 'FatherEmail', 'MotherEmail', 'GuardianEmail']
      : ['ParentEmail', 'VerificationEmail', 'Email', 'FatherEmail', 'MotherEmail', 'GuardianEmail'];
    const familyRows = await querySchoolCollection(env, collection, {
      filters: emailFields.map((field) => ({ field, op: '==', value: email })),
      filterJoin: 'OR'
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
    email
      ? queryCollection(env, 'formSales', {
          filters: [{ field: 'Email', op: '==', value: email }],
          limit: 20
        }).catch(() => [])
      : (code
          ? queryCollection(env, 'formSales', {
              filters: [{ field: 'VerificationCode', op: '==', value: code }],
              limit: 10
            }).catch(() => [])
          : Promise.resolve([]))
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
  return {
    accounts: (accountSummaries || []).filter(Boolean).length
      ? uniqueRows(accountSummaries.filter(Boolean))
      : [],
    sales: firestoreSales,
    applications: firestoreApplications,
    students: firestoreStudents,
    ledger: firestoreLedger,
    invoices: firestoreInvoices,
    payments: firestorePayments,
    clinic: firestoreClinic,
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

export function parentPassportPhotoSource(row = {}, fallbackReference = '') {
  const reference = pick(row, [
    'ApplicationReference', 'applicationReference',
    'ApplicationID', 'applicationId',
    'AdmissionNo', 'admissionNo',
    'AccountRef', 'accountRef', '__id'
  ], fallbackReference);
  return {
    PassportPhotoAvailable: Boolean(passportPhotoUrl(row)),
    PassportPhotoApplicationReference: clean(reference),
    PassportPhotoScopePath: clean(row.__scopePath)
  };
}

function linkedApplicationReferences(child = {}) {
  return [...new Set([
    pick(child, ['ApplicationReference', 'applicationReference']),
    pick(child, ['ApplicationID', 'applicationId']),
    pick(child, ['AdmissionNo', 'admissionNo']),
    pick(child, ['AccountRef', 'accountRef']),
    pick(child, ['__id', '__name'])
  ].map(clean).filter(Boolean))];
}

export async function enrichChildrenWithLinkedPassportPhotos(env, children = [], applications = [], options = {}) {
  const readDocument = options.getDocument || getDocument;
  await Promise.all((children || []).map(async (child) => {
    if (!child || child.PassportPhotoAvailable) return;
    const loadedApplication = findScopedChildApplication(applications, child);
    if (loadedApplication && passportPhotoUrl(loadedApplication)) {
      Object.assign(child, parentPassportPhotoSource(loadedApplication));
      return;
    }

    // Legacy/imported student records may use a normalized parent email while
    // their admission application retains the original email casing. Firestore
    // string queries are case-sensitive, so the normal family query can miss
    // that linked application. Read only the exact application documents that
    // can belong to this already-authorized child, within the child's branch
    // and school-section scope.
    const applicationScopePath = identityScopePathForCollection(child, 'applications');
    if (!applicationScopePath) return;
    for (const reference of linkedApplicationReferences(child)) {
      const row = await readDocument(env, applicationScopePath, safeDocumentId(reference)).catch(() => null);
      if (!row) continue;
      const candidate = { ...row, __scopePath: applicationScopePath };
      if (!applicationMatchesChild(candidate, child) || !passportPhotoUrl(candidate)) continue;
      Object.assign(child, parentPassportPhotoSource(candidate));
      return;
    }
  }));
  return children;
}

function normalizeStudent(row, profile = {}) {
  const displayName = formatPersonName(row, profile, pick(row, ['DisplayName', 'displayName', 'ApplicantName', 'applicantName']));
  const passportPhoto = parentPassportPhotoSource(row);
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
    BranchId: scopedRecordBranch(row),
    SchoolSection: scopedRecordSection(row),
    ParentEmail: lower(pick(row, ['ParentEmail', 'parentEmail', 'Email', 'email', 'VerificationEmail', 'FatherEmail', 'MotherEmail', 'GuardianEmail'])),
    ParentPhone: pick(row, ['ParentPhone', 'parentPhone']),
    VerificationCode: studentLoginCode(row),
    WalletCardStatus: pick(row, ['WalletCardStatus', 'walletCardStatus'], 'Active'),
    WalletDailyLimit: asMoneyNumber(pick(row, ['WalletDailyLimit', 'walletDailyLimit'])),
    WalletTxnLimit: asMoneyNumber(pick(row, ['WalletTxnLimit', 'walletTxnLimit'])),
    WalletPinThreshold: asMoneyNumber(pick(row, ['WalletPinThreshold', 'walletPinThreshold'])),
    Status: pick(row, ['Status', 'status'], 'Active'),
    StatusReason: pick(row, ['StatusReason', 'statusReason', 'WithdrawalReason', 'LeaveReason']),
    ...passportPhoto
  };
}

function normalizeApplicationChild(row, profile = {}) {
  const displayName = formatPersonName(
    row,
    profile,
    pick(row, ['ApplicantName', 'applicantName', 'DisplayName', 'displayName', 'Name', 'name'])
  );
  const applicationRef = pick(row, ['ApplicationReference', 'applicationReference', 'ApplicationID', 'applicationId', '__id']);
  const passportPhoto = parentPassportPhotoSource(row, applicationRef);
  return {
    ...row,
    AccountRef: applicationRef,
    AdmissionNo: pick(row, ['AdmissionNo', 'admissionNo']),
    ApplicationReference: applicationRef,
    DisplayName: displayName,
    ClassName: pick(row, ['ClassApplyingFor', 'classApplyingFor', 'ClassAdmitted', 'classAdmitted', 'ClassName', 'className']),
    StudentType: pick(row, ['StudentType', 'studentType'], 'Day Student'),
    Gender: pick(row, ['Gender', 'gender', 'Sex', 'sex']),
    BranchId: scopedRecordBranch(row),
    SchoolSection: scopedRecordSection(row),
    ParentEmail: lower(pick(row, ['ParentEmail', 'parentEmail', 'VerificationEmail', 'verificationEmail', 'Email', 'email'])),
    ParentPhone: pick(row, ['ParentPhone', 'parentPhone', 'Phone', 'phone']),
    WalletCardStatus: 'Not Issued',
    WalletDailyLimit: 0,
    WalletTxnLimit: 0,
    WalletPinThreshold: 0,
    Status: pick(row, ['ResultStatus', 'resultStatus', 'Status', 'status'], 'Application'),
    StatusReason: '',
    ...passportPhoto,
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
    CreatedAt: pick(row, ['CreatedAt', 'createdAt', 'Date', 'date']),
    InvoiceId: pick(row, ['InvoiceId', 'invoiceId', 'Reference', 'reference', '__id']),
    AccountRef: pick(row, ['AccountRef', 'accountRef', 'AdmissionNo', 'admissionNo']),
    FeeCode: pick(row, ['FeeCode', 'feeCode']),
    FeeName: pick(row, ['FeeName', 'feeName']),
    FeeCategory: pick(row, ['FeeCategory', 'feeCategory']),
    AcademicSession: pick(row, ['AcademicSession', 'academicSession']),
    Term: pick(row, ['Term', 'term']),
    Debit: asMoneyNumber(pick(row, ['Debit', 'debit', 'Amount', 'amount'])),
    Credit: asMoneyNumber(pick(row, ['Credit', 'credit', 'PaidAmount', 'paidAmount'])),
    Balance: asMoneyNumber(pick(row, ['Balance', 'balance', 'BalanceAmount', 'balanceAmount'])),
    Currency: pick(row, ['Currency', 'currency'], 'NGN'),
    DueDate: toDisplayDate(pick(row, ['DueDate', 'dueDate', 'PaymentDueDate', 'paymentDueDate'])),
    Status: pick(row, ['Status', 'status']),
    Reference: pick(row, ['InvoiceId', 'invoiceId', 'Reference', 'reference', '__id']),
    BranchId: scopedRecordBranch(row),
    SchoolSection: scopedRecordSection(row)
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
    Reference: pick(row, ['Reference', 'reference', 'TransactionReference', 'transactionReference', 'PaymentId', 'paymentId', '__id']),
    BranchId: scopedRecordBranch(row),
    SchoolSection: scopedRecordSection(row)
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

async function assertParentAccess(env, sources, email, secret, sessionEmail = '') {
  const wantedEmail = lower(email);
  const wantedSecret = String(secret || '').trim();
  const wantedCode = wantedSecret.toUpperCase();
  if (!wantedEmail) {
    const err = new Error('Parent email is required.');
    err.status = 400;
    throw err;
  }

  const sales = sources.sales || [];
  const applications = sources.applications || [];
  const matchingApplications = applications.filter((row) => {
    return [
      pick(row, ['VerificationEmail', 'verificationEmail']),
      pick(row, ['ParentEmail', 'parentEmail']),
      pick(row, ['Email', 'email'])
    ].some((value) => lower(value) === wantedEmail);
  });
  const matchingStudents = (sources.students || []).map(normalizeStudent)
    .filter((row) => lower(row.ParentEmail) === wantedEmail);
  const matchingSales = sales.filter((row) => lower(pick(row, ['Email', 'email'])) === wantedEmail);
  if (!matchingSales.length && !matchingApplications.length && !matchingStudents.length) {
    const err = new Error('No parent account was found for that email address.');
    err.status = 401;
    throw err;
  }

  if (lower(sessionEmail) !== wantedEmail) {
    if (!wantedSecret) {
      const err = new Error('Parent password or verification code is required.');
      err.status = 401;
      throw err;
    }
    const storedPassword = await verifyStoredParentPassword(env, wantedEmail, wantedSecret);
    const legacyMatch = !storedPassword.configured && (
      matchingSales.some((row) => clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === wantedCode)
      || matchingApplications.some((row) => clean(pick(row, ['VerificationCode', 'verificationCode'])).toUpperCase() === wantedCode)
      || matchingStudents.some((row) => studentLoginCode(row) === wantedCode)
    );
    if (!storedPassword.valid && !legacyMatch) {
      const err = new Error(storedPassword.configured
        ? 'Invalid parent email or password.'
        : 'Invalid parent email or verification code.');
      err.status = 401;
      throw err;
    }
  }

  const studentMatch = matchingStudents.length > 0;
  if (!matchingSales.length && matchingApplications.length === 0 && !studentMatch) {
    const err = new Error('This parent account has no linked student or application.');
    err.status = 401;
    throw err;
  }
  return { applications, matchingApplications, studentMatch };
}

function parentOwnsStudent(student, email, applications, matchingApplications = []) {
  const wantedEmail = lower(email);
  if (lower(student.ParentEmail) === wantedEmail) return true;
  const appRef = pick(student, ['ApplicationReference', 'applicationReference']);
  if (appRef && matchingApplications.some((app) =>
    applicationScopeMatchesChild(app, student) &&
    sameText(pick(app, ['ApplicationReference', 'applicationReference', '__id']), appRef))) {
    return true;
  }
  return applications.some((app) => {
    const sameRef = appRef &&
      applicationScopeMatchesChild(app, student) &&
      sameText(pick(app, ['ApplicationReference', 'applicationReference', '__id']), appRef);
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

export function accountSummaryForKeys(accounts, keys, ledgerEntries, invoiceEntries = []) {
  // Invoice Credit is an allocation of the same cash receipt already present
  // in the ledger. Use invoices for debit only so parent balances do not count
  // one payment twice.
  const invoiceDebits = (invoiceEntries || []).map((row) => ({ ...row, Credit: 0 }));
  const liveFinancialRows = [...invoiceDebits, ...(ledgerEntries || [])];
  if (liveFinancialRows.length) return feeAccountSummary(liveFinancialRows);
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

function academicResultId(row = {}) {
  return clean(row.ResultId || row.__id || row.__name).split('/').pop();
}

function academicResultPeriod(row = {}) {
  return {
    Session: clean(row.AcademicSession || row.SessionName || row.SessionId),
    Term: clean(row.Term || row.TermName || row.TermId)
  };
}

function academicResultBelongsToChild(row = {}, child = {}) {
  return [row.StudentRef, row.AdmissionNo, row.AccountRef]
    .map(clean)
    .filter(Boolean)
    .some((reference) => financialReferenceMatches(reference, child));
}

function academicClearanceForResult(clearances = [], result = {}) {
  const resultId = academicResultId(result);
  const period = academicResultPeriod(result);
  return (clearances || []).find((row) => {
    const scopedResultId = clean(row.ResultId);
    if (scopedResultId && lower(scopedResultId) !== lower(resultId)) return false;
    const clearanceSession = clean(row.AcademicSession || row.SessionName || row.SessionId);
    const clearanceTerm = clean(row.Term || row.TermName || row.TermId);
    return (!clearanceSession || sameText(clearanceSession, period.Session)) &&
      (!clearanceTerm || sameText(clearanceTerm, period.Term));
  }) || null;
}

function academicResultAuditId() {
  return `academic-result-access-${globalThis.crypto.randomUUID()}`;
}

async function auditParentAcademicResultAccess(env, {
  email, child, selectedScope, purpose, results
} = {}) {
  if (!(results || []).length) return;
  const auditId = academicResultAuditId();
  const now = new Date().toISOString();
  const record = {
    AuditId: auditId,
    EventType: 'Parent Academic Result Access',
    Purpose: clean(purpose || 'View'),
    ParentEmail: lower(email),
    StudentRef: clean(child.AccountRef || child.AdmissionNo),
    BranchId: clean(selectedScope.branchId),
    SchoolSection: clean(selectedScope.schoolSection),
    Results: results.map((row) => ({
      ResultId: clean(row.ResultId),
      Allowed: row.Access?.Allowed === true,
      DecisionCode: clean(row.Access?.Code),
      UsedExemption: row.Access?.UsedExemption === true
    })),
    CreatedAt: now
  };
  const created = await createDocumentIfAbsent(env, 'academicResultAccessAudits', auditId, record);
  if (!created.created) {
    const error = new Error('Result access could not be audited. Please try again.');
    error.status = 503;
    throw error;
  }
}

async function parentAcademicResults(env, {
  email,
  child,
  selectedScope,
  schoolProfile,
  resultRows = [],
  clearanceRows = [],
  accountSummary = {},
  invoices = [],
  ledger = [],
  purpose = 'View',
  requestedResultId = ''
} = {}) {
  const requestedId = clean(requestedResultId);
  const scopedClearances = (clearanceRows || []).filter((row) =>
    recordMatchesSelectedChildScope(row, selectedScope) && academicResultBelongsToChild(row, child));
  const rows = (resultRows || []).filter((row) =>
    recordMatchesSelectedChildScope(row, selectedScope) &&
    academicResultBelongsToChild(row, child) &&
    (!requestedId || lower(academicResultId(row)) === lower(requestedId))
  ).sort((left, right) => clean(right.PublishedAt || right.UpdatedAt).localeCompare(clean(left.PublishedAt || left.UpdatedAt)));
  const financialSummary = academicFinancialSummary(invoices, ledger);
  const output = [];
  for (const result of rows) {
    const period = academicResultPeriod(result);
    const chain = academicPolicyScopeChain({
      BranchId: selectedScope.branchId,
      SectionId: selectedScope.schoolSection,
      ClassId: result.ClassId
    });
    let view = null;
    try {
      view = await loadAcademicPolicyView(env, { scope: chain.at(-1), scopeChain: chain, period });
    } catch (_error) {
      view = null;
    }
    const activePolicy = view?.ActivePolicy || {};
    const hasActivePolicy = Boolean(view?.Sources?.length) &&
      academicPolicyIssues(activePolicy, { forActivation: true }).length === 0;
    const access = evaluateAcademicResultAccess({
      result,
      policy: activePolicy,
      hasActivePolicy,
      currentPeriod: {
        CurrentAcademicSession: schoolProfile.CurrentAcademicSession,
        CurrentTerm: schoolProfile.CurrentTerm,
        SessionId: schoolProfile.CurrentAcademicSessionId,
        TermId: schoolProfile.CurrentTermId
      },
      finance: {
        ...accountSummary,
        ...financialSummary,
        FeeCategoryBalances: academicFeeCategoryBalances(invoices, ledger)
      },
      clearance: academicClearanceForResult(scopedClearances, result)
    });
    output.push(publicAcademicResult(result, access, activePolicy));
  }
  await auditParentAcademicResultAccess(env, { email, child, selectedScope, purpose, results: output });
  return output;
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

async function getSchoolProfile(env, branchId = '') {
  try {
    const [profile, documentBranding, webBranding] = await Promise.all([
      getDocument(env, 'settings', 'schoolProfile'),
      getDocument(env, 'settings', 'documentBranding').catch(() => null),
      getWebBranding(env).catch(() => null)
    ]);
    if (profile) {
      return effectiveBranchProfile(env, {
        ...profile,
        ...(documentBranding || {}),
        DocumentLogoDataUrl: clean(documentBranding?.DocumentLogoDataUrl || webBranding?.WebLogoDataUrl),
        ShowResultsOnline: pick(profile, [
          'ShowResultsOnline', 'showResultsOnline', 'ResultsOnline', 'resultsOnline',
          'EntranceResultsOnline', 'entranceResultsOnline'
        ], clean(env.SHOW_RESULTS_ONLINE) || 'NO'),
        ResultDisplayMode: pick(profile, ['ResultDisplayMode', 'resultDisplayMode'], clean(env.RESULT_DISPLAY_MODE) || 'subjects')
      }, branchId);
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

async function loadStoredAdmissionDocument(env, url) {
  return getStoredDocument(env, url);
}

async function resolveParentAdmissionApplication(env, body, email, code, accountRef) {
  const sourceType = lower(body.sourceType || body.SourceType);
  const collection = sourceType === 'application' ? 'applications' : 'students';
  let familyAccessPromise = null;
  const authenticateFamily = () => {
    if (!familyAccessPromise) {
      familyAccessPromise = loadParentSources(env, 'identity', body).then(async (sources) => {
        await assertParentAccess(env, sources, email, code, body.__parentSessionEmail);
        return sources;
      });
    }
    return familyAccessPromise;
  };
  const selected = await getSelectedIdentityRow(env, collection, accountRef, body.scopePath || body.ScopePath);
  if (selected && collection === 'applications') {
    const emailMatches = parentOwnsApplication(selected, email);
    const codeMatches = clean(selected.VerificationCode).toUpperCase() === code;
    if (emailMatches && codeMatches) return selected;
    if (emailMatches) {
      await authenticateFamily();
      return selected;
    }
  }
  if (selected && collection === 'students') {
    const student = normalizeStudent(selected, await getSchoolProfile(env));
    const emailMatches = lower(student.ParentEmail || student.Email || student.VerificationEmail) === email;
    const codeMatches = [student.ParentLoginCode, student.VerificationCode, student.LoginCode]
      .map((value) => clean(value).toUpperCase()).includes(code);
    if (emailMatches) {
      if (!codeMatches) await authenticateFamily();
      const applicationRef = clean(student.ApplicationReference);
      const applicationScope = clean(selected.__scopePath).replace(/\/students$/i, '/applications');
      if (applicationRef) {
        const linked = await getSelectedIdentityRow(env, 'applications', applicationRef, applicationScope);
        if (linked) return linked;
      }
      for (const field of ['AdmissionNo', 'admissionNo', 'AdmissionNumber']) {
        const matches = await querySchoolCollection(env, 'applications', {
          filters: [{ field, op: '==', value: clean(student.AdmissionNo || student.AccountRef) }],
          scopePath: applicationScope,
          limit: 1
        }).catch(() => []);
        if (matches[0]) return matches[0];
      }
    }
  }
  const identitySources = await authenticateFamily();
  const applicationScope = identityScopePathForCollection(
    body.scopePath || body.ScopePath,
    'applications'
  );
  return findParentOwnedApplication(identitySources.applications, accountRef, email, applicationScope);
}

async function getParentAdmissionDocument(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const code = clean(body.code || body.VerificationCode).toUpperCase();
  const accountRef = clean(body.accountRef || body.AccountRef || body.ApplicationReference);
  const documentType = lower(body.documentType || body.DocumentType);
  const application = await resolveParentAdmissionApplication(env, body, email, code, accountRef);
  if (!application) { const err = new Error('That admission record is not linked to this parent.'); err.status = 404; throw err; }
  const profile = await getSchoolProfile(env, application.BranchId || application.branchId);
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
  const storedUrl = clean(application[urlField]);
  if (!storedUrl) {
    const err = new Error(`${title} has not yet been archived from the desktop app. Generate and archive the authorized customized PDF from the Applications or Bulk Email tab first.`);
    err.status = 409;
    throw err;
  }
  const storedFile = await loadStoredAdmissionDocument(env, storedUrl);
  const documentId = application.__id || safeDocumentId(pick(application, ['ApplicationReference', 'ApplicationID']));
  const updatedApplication = { ...application, [flag]: 'YES', [`${flag}At`]: now, [`${flag}OpenedByParent`]: 'YES', UpdatedAt: now };
  await upsertSchoolDocument(env, 'applications', documentId, updatedApplication);
  const applicantName = pick(application, ['ApplicantName', 'DisplayName']);
  return {
    ok: true,
    message: `${title} downloaded and marked as sent.`,
    pdfBytes: new Uint8Array(await storedFile.object.arrayBuffer()),
    fileName: clean(application[fileField] || storedFile.fileName) || `${safeDocumentId(applicantName || accountRef)}-${safeDocumentId(title)}.pdf`,
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

function paymentHistoryRows(paymentEntries = [], ledgerEntries = []) {
  const records = new Map();
  paymentEntries.filter(isPaidRecord).forEach((payment) => {
    const amount = asMoneyNumber(payment.Amount || payment.Credit);
    if (amount <= 0 || lower(payment.FeeCategory) === 'wallet') return;
    const record = {
      ...payment,
      RecordType: 'Payment',
      Description: payment.FeeName || payment.FeeCategory || 'Payment',
      Amount: amount,
      Debit: 0,
      Credit: amount
    };
    records.set(paymentGroupKey(record), record);
  });
  groupedLedgerPayments(ledgerEntries).forEach((record) => {
    const key = paymentGroupKey(record);
    if (!records.has(key)) records.set(key, record);
  });
  return [...records.values()].sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
}

function paymentHistoryFor(child, payments, ledger) {
  const paymentEntries = (payments || []).filter((entry) =>
    financialReferenceMatches(entry.AccountRef || entry.AdmissionNo || entry.ApplicationReference, child));
  const ledgerEntries = (ledger || []).filter((entry) => financialReferenceMatches(entry.AccountRef, child) && lower(entry.FeeCategory) !== 'wallet');
  const paidLedgerEntries = ledgerEntries.filter(isPaidRecord);
  return paymentHistoryRows(paymentEntries, paidLedgerEntries);
}

function recordMatchesApplication(record, applicationRef) {
  const ref = clean(applicationRef);
  if (!ref) return false;
  return sameText(record.ApplicationReference, ref) ||
    sameText(record.ApplicationID, ref) ||
    referencesMatch(record.Reference, ref);
}

export function paymentHistoryForChild(child, payments, ledger) {
  if (!childCanShowFinanceHistory(child)) return [];
  if (child && child.SourceType === 'Application') {
    const appRef = clean(child.ApplicationReference || child.AccountRef);
    const childCreatedMs = timestampMs(child.SubmittedAt || child.CreatedAt || child.UpdatedAt);
    const appPayments = (payments || []).filter((entry) => {
      if (lower(entry.FeeCategory) === 'wallet' || !isPaidRecord(entry) ||
          !(recordMatchesApplication(entry, appRef) || financialReferenceMatches(entry.AccountRef, child))) return false;
      if (!childCreatedMs) return true;
      const entryMs = timestampMs(entry.RawDate || entry.PaidAt || entry.Date || entry.CreatedAt);
      return !entryMs || entryMs >= childCreatedMs;
    });
    const appLedger = (ledger || []).filter((entry) => {
      if (lower(entry.FeeCategory) === 'wallet' || !isPaidRecord(entry) || !recordMatchesApplication(entry, appRef)) return false;
      if (!childCreatedMs) return false;
      const entryMs = timestampMs(entry.RawDate || entry.Date);
      return entryMs >= childCreatedMs;
    });
    return paymentHistoryRows(appPayments, appLedger);
  }
  return paymentHistoryFor(child, payments, ledger);
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

async function getDashboard(env, body, options = {}) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const secret = String(body.code || body.VerificationCode || '').trim();
  const code = secret.toUpperCase();
  // The initial request only establishes the family/child list. Financial,
  // clinic and store details are loaded for the selected child immediately
  // afterwards, avoiding a duplicate full-data scan on every refresh.
  const sources = await loadParentSources(env, 'identity', body);
  const schoolProfile = await getSchoolProfile(env);
  const { applications, matchingApplications } = await assertParentAccess(
    env,
    sources,
    email,
    secret,
    body.__parentSessionEmail
  );
  const allStudents = (sources.students || []).map((row) => normalizeStudent(row, schoolProfile));
  const children = allStudents.filter((student) => parentOwnsStudent(student, email, applications, matchingApplications));
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
    .filter((candidate) => candidate.AccountRef &&
      !children.some((child) => applicationMatchesChild(candidate, child)))
    .forEach((child) => {
      children.push(child);
    });
  await enrichChildrenWithLinkedPassportPhotos(env, children, parentApplications);
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
    const identity = parentChildIdentity(child);
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
    accountSummaries[identity] = accountSummary;
    walletActivity[identity] = walletEntries;
    paymentRecords[identity] = paymentHistoryForChild(child, payments, ledger);
    payableItems[identity] = [];
    dueNotifications[identity] = invoiceDueNotifications(invoices, keys, accountSummary, child);
    clinicVisits[identity] = clinic.filter((record) => {
      return financialReferenceMatches(record.AdmissionNo, child);
    }).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
    const resultSource = findScopedChildApplication(applications, child) ||
      (child.SourceType === 'Application' ? child : null);
    const result = buildEntranceResult(resultSource, schoolProfile);
    entranceResults[identity] = result ? [result] : [];
  }

  const notificationData = options.includeNotifications === false
    ? { notifications: [], unreadCount: 0 }
    : await parentNotifications(env, email, children);

  return {
    ok: true,
    message: 'Parent dashboard loaded.',
    parentEmail: email,
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
    notifications: notificationData.notifications,
    notificationUnreadCount: notificationData.unreadCount,
    unreadCount: notificationData.unreadCount,
    storeCatalog: (sources.storeItems || []).filter((row) => isYes(row.Active === undefined ? 'YES' : row.Active) && asMoneyNumber(row.Quantity) > 0),
    storeOrders: (sources.storeOrders || []).filter((row) => children.some((child) => financialReferenceMatches(row.AccountRef || row.AdmissionNo, child)))
  };
}

async function getChildActivity(env, body, options = {}) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  const code = clean(body.code || body.VerificationCode).toUpperCase();
  const accountRef = clean(body.accountRef || body.AccountRef || body.AdmissionNo);
  const sourceType = lower(body.sourceType || body.SourceType);
  const collection = sourceType === 'application' ? 'applications' : 'students';
  const requestedScopeValue = clean(body.scopePath || body.ScopePath);
  const requestedScopePath = validatedIdentityScopePath(requestedScopeValue, collection);
  if (!requestedScopeValue || !requestedScopePath) {
    const err = new Error('The selected child scope is required. Reload the parent dashboard and try again.');
    err.status = 400;
    throw err;
  }
  const selectedRow = await getSelectedIdentityRow(env, collection, accountRef, requestedScopeValue);
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
    const access = await assertParentAccess(env, identitySources, email, code, body.__parentSessionEmail);
    applications = access.applications;
    const scopedStudents = (identitySources.students || [])
      .filter((row) => !requestedScopeValue ||
        (requestedScopePath && lower(row.__scopePath) === lower(requestedScopePath)))
      .map((row) => normalizeStudent(row, schoolProfile))
      .filter((row) =>
        parentOwnsStudent(row, email, applications, access.matchingApplications) &&
        financialReferenceMatches(accountRef, row)
      );
    child = scopedStudents.length === 1 ? scopedStudents[0] : null;
    if (!child) {
      const applicationScopePath = identityScopePathForCollection(requestedScopePath, 'applications');
      const scopedApplications = applications
        .filter((row) => !requestedScopeValue ||
          (applicationScopePath && lower(row.__scopePath) === lower(applicationScopePath)))
        .map((row) => normalizeApplicationChild(row, schoolProfile))
        .filter((row) => financialReferenceMatches(accountRef, row));
      child = scopedApplications.length === 1 ? scopedApplications[0] : null;
    }
  }
  if (!child) {
    const err = new Error('The selected child was not found for this parent account.');
    err.status = 404;
    throw err;
  }
  const selectedScope = selectedChildActivityScope(requestedScopeValue, collection, child);
  if (!selectedScope ||
      lower(identityScopePathForCollection(child, collection)) !== lower(selectedScope.scopePath)) {
    const err = new Error('The selected child scope could not be verified.');
    err.status = 404;
    throw err;
  }
  child.BranchId = selectedScope.branchId;
  child.SchoolSection = selectedScope.schoolSection;
  const keys = accountKeys(child);
  const [ledgerRows, invoiceRows, paymentRows, clinicRows, summaryRows, linkedApplication, storeItems, storeOrderRows, academicResultRows, academicClearanceRows, academicMembershipRows, academicAttendanceRows, timetableVersionRows, timetableEntryRows, academicSubjectRows] = await Promise.all([
    queryRowsForReferences(env, 'ledger', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], keys),
    queryRowsForReferences(env, 'invoices', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], keys),
    queryRowsForReferences(env, 'payments', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], keys),
    queryRowsForReferences(env, 'clinicRecords', ['AdmissionNo'], keys),
    Promise.all(keys.slice(0, 3).map((key) => getDocument(env, 'accountSummaries', safeDocumentId(key)).catch(() => null))),
    child.ApplicationReference
      ? getSelectedIdentityRow(
          env,
          'applications',
          child.ApplicationReference,
          identityScopePathForCollection(child, 'applications')
        )
      : Promise.resolve(null),
    listCollection(env, 'storeItems').catch(() => []),
    queryRowsForReferences(env, 'storeOrders', ['AccountRef', 'AdmissionNo', 'ApplicationReference'], keys),
    queryRowsForReferences(env, 'academicResults', ['StudentRef', 'AdmissionNo', 'AccountRef'], keys),
    queryRowsForReferences(env, 'academicResultClearances', ['StudentRef', 'AdmissionNo', 'AccountRef'], keys),
    queryRowsForReferences(env, 'academicStudentMemberships', ['StudentRef'], keys),
    queryRowsForReferences(env, 'academicStudentAttendance', ['StudentRef'], keys),
    listCollection(env, 'academicTimetableVersions').catch(() => []),
    listCollection(env, 'academicTimetableEntries').catch(() => []),
    listCollection(env, 'academicSubjects').catch(() => [])
  ]);
  if (linkedApplication && !findScopedChildApplication(applications, child)) {
    applications.push(linkedApplication);
  }
  const scopedLedgerRows = ledgerRows.filter((row) => recordMatchesSelectedChildScope(row, selectedScope));
  const scopedInvoiceRows = invoiceRows.filter((row) => recordMatchesSelectedChildScope(row, selectedScope));
  const scopedPaymentRows = paymentRows.filter((row) => recordMatchesSelectedChildScope(row, selectedScope));
  const scopedClinicRows = clinicRows.filter((row) => recordMatchesSelectedChildScope(row, selectedScope));
  const scopedSummaryRows = summaryRows.filter((row) =>
    row && recordMatchesSelectedChildScope(row, selectedScope));
  const scopedStoreOrderRows = storeOrderRows.filter((row) =>
    recordMatchesSelectedChildScope(row, selectedScope));
  const ledger = scopedLedgerRows.map(normalizeLedger);
  const invoices = scopedInvoiceRows.map(normalizeInvoice);
  const payments = scopedPaymentRows.map(normalizePayment);
  const clinic = scopedClinicRows.map(normalizeClinicRecord);
  const walletEntries = ledger.filter((entry) => financialReferenceMatches(entry.AccountRef, child) && lower(entry.FeeCategory) === 'wallet')
    .sort((a, b) => clean(b.Date).localeCompare(clean(a.Date)));
  const childLedger = ledger.filter((entry) => financialReferenceMatches(entry.AccountRef, child));
  const accountSummary = accountSummaryForKeys(scopedSummaryRows, keys, childLedger, invoices);
  child.TotalDebit = accountSummary.TotalDebit;
  child.TotalCredit = accountSummary.TotalCredit;
  child.OutstandingBalance = accountSummary.OutstandingBalance;
  child.CreditBalance = accountSummary.CreditBalance;
  const resultSource = findScopedChildApplication(applications, child) ||
    (child.SourceType === 'Application' ? child : null);
  const result = buildEntranceResult(resultSource, schoolProfile);
  const childPayments = paymentHistoryForChild(child, payments, ledger);
  const childDueNotifications = invoiceDueNotifications(invoices, keys, accountSummary, child);
  const academicResults = await parentAcademicResults(env, {
    email,
    child,
    selectedScope,
    schoolProfile,
    resultRows: academicResultRows,
    clearanceRows: academicClearanceRows,
    accountSummary,
    invoices,
    ledger,
    purpose: options.academicResultPurpose || 'View',
    requestedResultId: options.requestedAcademicResultId
  });
  const memberships = academicMembershipRows.filter((row) => recordMatchesSelectedChildScope(row, selectedScope)
    && keys.some((key) => lower(row.StudentRef) === lower(key))
    && !['withdrawn', 'inactive', 'archived'].includes(lower(row.Status)))
    .sort((a, b) => clean(b.UpdatedAt || b.CreatedAt).localeCompare(clean(a.UpdatedAt || a.CreatedAt)));
  const currentMembership = memberships[0] || null;
  const publishedVersions = timetableVersionRows.filter((row) => recordMatchesSelectedChildScope(row, selectedScope)
    && lower(row.Status) === 'published'
    && (!currentMembership || (row.SessionId === currentMembership.SessionId && row.TermId === currentMembership.TermId)))
    .sort((a, b) => clean(b.PublishedAt).localeCompare(clean(a.PublishedAt)));
  const publishedVersion = publishedVersions[0] || null;
  const subjectNames = new Map(academicSubjectRows.filter((row) => recordMatchesSelectedChildScope(row, selectedScope))
    .map((row) => [clean(row.SubjectId || row.RecordId || row.__id), clean(row.Name || row.Code)]));
  const dayByCode = new Map((publishedVersion?.Days || []).map((row, index) => [clean(row.DayCode), {
    Name: clean(row.Name || row.DayCode), SortOrder: Number(row.SortOrder || index + 1)
  }]));
  const academicSchedule = publishedVersion && currentMembership ? timetableEntryRows.filter((row) =>
    recordMatchesSelectedChildScope(row, selectedScope)
    && row.VersionId === publishedVersion.VersionId
    && row.ClassId === currentMembership.ClassId && row.ArmId === currentMembership.ArmId)
    .map((row) => {
      const periodByCode = new Map(academicTimetablePeriodsForDay(publishedVersion, row.DayCode)
        .map((period) => [clean(period.PeriodCode), period]));
      const occupied = row.PeriodCodes || [];
      const first = periodByCode.get(clean(occupied[0])) || {};
      const last = periodByCode.get(clean(occupied[occupied.length - 1])) || first;
      return {
        EntryId: clean(row.EntryId || row.RecordId), DayCode: clean(row.DayCode),
        DayName: dayByCode.get(clean(row.DayCode))?.Name || clean(row.DayCode),
        DaySort: dayByCode.get(clean(row.DayCode))?.SortOrder || 999,
        PeriodCodes: occupied.map(clean), StartTime: clean(first.StartTime), EndTime: clean(last.EndTime),
        Subject: subjectNames.get(clean(row.SubjectId)) || clean(row.SubjectId), Room: clean(row.Room),
        LessonType: clean(row.LessonType)
      };
    }).sort((a, b) => a.DaySort - b.DaySort || a.StartTime.localeCompare(b.StartTime)) : [];
  const childAttendance = academicAttendanceRows.filter((row) => recordMatchesSelectedChildScope(row, selectedScope)
    && keys.some((key) => lower(row.StudentRef) === lower(key))
    && (!currentMembership || (row.SessionId === currentMembership.SessionId && row.TermId === currentMembership.TermId)));
  const attendanceCounts = { Present: 0, Absent: 0, Late: 0, Excused: 0, LeftEarly: 0 };
  childAttendance.forEach((row) => {
    const key = clean(row.Status).replace(/\s+/g, '');
    if (Object.hasOwn(attendanceCounts, key)) attendanceCounts[key] += 1;
  });
  const attendedCount = attendanceCounts.Present + attendanceCounts.Late + attendanceCounts.LeftEarly;
  const academicAttendanceSummary = {
    ...attendanceCounts, Total: childAttendance.length,
    AttendancePercentage: childAttendance.length ? Number(((attendedCount / childAttendance.length) * 100).toFixed(1)) : 0,
    SessionId: clean(currentMembership?.SessionId), TermId: clean(currentMembership?.TermId)
  };
  const notificationData = await parentNotifications(env, email, [child]);
  return {
    ok: true,
    accountRef: child.AccountRef,
    walletActivity: walletEntries,
    walletBalance: walletBalance(walletEntries),
    accountSummary,
    paymentRecords: childPayments,
    dueNotifications: childDueNotifications,
    notifications: notificationData.notifications,
    notificationUnreadCount: notificationData.unreadCount,
    unreadCount: notificationData.unreadCount,
    clinicVisits: clinic.filter((record) => financialReferenceMatches(record.AdmissionNo, child)).sort((a, b) => clean(b.Date).localeCompare(clean(a.Date))),
    showResultsOnline: schoolResultsAreVisible(schoolProfile),
    resultDisplayMode: lower(schoolProfile.ResultDisplayMode) === 'percentage' ? 'percentage' : 'subjects',
    academicResults,
    academicSchedule,
    academicAttendanceSummary,
    entranceResults: result ? [result] : [],
    storeCatalog: (storeItems || []).filter((row) => isYes(row.Active === undefined ? 'YES' : row.Active) && asMoneyNumber(row.Quantity) > 0),
    storeOrders: scopedStoreOrderRows.filter((row) =>
      financialReferenceMatches(row.AccountRef || row.AdmissionNo || row.ApplicationReference, child))
  };
}

async function getAcademicResultForPrint(env, body) {
  const requestedResultId = clean(body.resultId || body.ResultId);
  if (!requestedResultId) {
    const error = new Error('Choose an academic result to print.');
    error.status = 400;
    throw error;
  }
  const activity = await getChildActivity(env, body, {
    academicResultPurpose: 'Print',
    requestedAcademicResultId: requestedResultId
  });
  const result = (activity.academicResults || []).find((row) => lower(row.ResultId) === lower(requestedResultId));
  if (!result) {
    const error = new Error('That academic result is not available for the selected student.');
    error.status = 404;
    throw error;
  }
  if (result.Access?.Allowed !== true) {
    const error = new Error(result.Access?.Message || 'This academic result is not available for printing.');
    error.status = 403;
    throw error;
  }
  return { ok: true, academicResult: result };
}

async function updateWalletRestrictions(env, body) {
  const email = lower(body.email || body.ParentEmail || body.Email);
  requireFirestoreEnv(env);
  const accountRef = clean(body.accountRef || body.AccountRef || body.AdmissionNo);
  const requestedScopeValue = clean(body.scopePath || body.ScopePath);
  const requestedScopePath = validatedIdentityScopePath(requestedScopeValue, 'students');
  if (!requestedScopeValue || !requestedScopePath) {
    const err = new Error('The selected child scope is required. Reload the parent dashboard and try again.');
    err.status = 400;
    throw err;
  }
  const selectedRow = await getSelectedIdentityRow(env, 'students', accountRef, requestedScopePath);
  if (!selectedRow) {
    const err = new Error('The selected child was not found for this parent account.');
    err.status = 404;
    throw err;
  }
  const sources = await loadParentSources(env, 'identity', body);
  const { applications, matchingApplications } = await assertParentAccess(
    env,
    sources,
    email,
    body.code || body.VerificationCode,
    body.__parentSessionEmail
  );
  const student = normalizeStudent(selectedRow);
  const selectedScope = selectedChildActivityScope(requestedScopePath, 'students', student);
  const selectedStudentMatches = parentOwnsStudent(
    student,
    email,
    applications,
    matchingApplications
  ) && accountKeys(student).some((key) =>
    sameText(key, accountRef) || referencesMatch(key, accountRef));
  if (!selectedScope ||
      lower(identityScopePathForCollection(student, 'students')) !== lower(selectedScope.scopePath) ||
      !selectedStudentMatches) {
    const err = new Error('The selected child was not found for this parent account.');
    err.status = 404;
    throw err;
  }
  student.BranchId = selectedScope.branchId;
  student.SchoolSection = selectedScope.schoolSection;
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
  await upsertSchoolDocument(
    env,
    'students',
    safeDocumentId(student.__id || student.AdmissionNo || student.AccountRef),
    updates
  );
  return { ok: true, message: 'Wallet restrictions saved.' };
}

async function getChildPayable(env, body) {
  const payable = await getPayableFees(env, {
    Email: body.email || body.ParentEmail || body.Email,
    VerificationCode: body.code || body.VerificationCode,
    AccountRef: body.accountRef || body.AccountRef || body.AdmissionNo,
    SourceType: body.sourceType || body.SourceType,
    ScopePath: body.scopePath || body.ScopePath,
    AuthenticatedParentEmail: body.__parentSessionEmail || body.__parentAuthenticatedEmail
  });
  const items = buildPayableItems(payable.fees || [], payable.schoolFeeBreakdown || []);
  if (!items.some(isWalletFee) && clean(payable.account && payable.account.AdmissionNo)) {
    items.push(walletTopupItem(payable.account));
  }
  const notificationIdentity = parentPayableNotificationIdentity(payable);
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
      AcademicSession: payableNotificationPeriod(item.AcademicSession, payable.account?.AcademicSession),
      Term: payableNotificationPeriod(item.Term, payable.account?.Term),
      DueDate: item.DueDate,
      DueStatus: dueStatus(item.DueDate),
      AllowInstallment: item.AllowInstallment || '',
      MinAmount: item.MinAmount || '',
      MaxAmount: item.MaxAmount || '',
      Components: item.Components || []
    }));
  const notificationData = await parentNotifications(env, notificationIdentity.email, [{
    AccountRef: notificationIdentity.accountRef,
    BranchId: notificationIdentity.branchId,
    SchoolSection: notificationIdentity.schoolSection
  }]);
  return {
    ok: true,
    message: 'Payable items loaded.',
    accountRef: notificationIdentity.accountRef,
    payableItems: items,
    dueNotifications: itemNotices,
    notifications: notificationData.notifications,
    notificationUnreadCount: notificationData.unreadCount,
    unreadCount: notificationData.unreadCount
  };
}

async function getParentNotificationContext(env, body) {
  const dashboard = await getDashboard(env, body, { includeNotifications: false });
  const email = lower(body.email || body.ParentEmail || body.Email);
  return {
    dashboard,
    email,
    recipient: parentNotificationRecipient(email, dashboard.children || [], env.DYNAMAX_WORKSPACE_ID)
  };
}

async function parentNotificationResponse(env, body, context) {
  const options = {
    limit: Number(body.limit || 50),
    before: clean(body.before),
    category: clean(body.category),
    unread: body.unread === true,
    archived: body.archived === true
  };
  const settings = await loadNotificationSettings(env, 'Parent', context.email);
  const [data, subscriptions] = await Promise.all([
    listNotifications(env, context.recipient, { ...options, preferences: settings }),
    listPushSubscriptions(env, context.email)
  ]);
  return {
    ok: true,
    ...data,
    settings,
    subscriptions,
    messaging: publicMessagingConfig(env)
  };
}

async function getParentNotifications(env, body) {
  const context = await getParentNotificationContext(env, body);
  return parentNotificationResponse(env, body, context);
}

async function markParentNotificationRead(env, body) {
  const context = await getParentNotificationContext(env, body);
  const current = await parentNotificationResponse(env, body, context);
  const notificationId = clean(body.notificationId || body.NotificationId);
  const markAll = body.all === true || body.All === true || lower(body.action || body.Action) === 'markallnotificationsread';
  if (markAll) {
    await markAllNotificationsRead(env, current.notifications, context.email);
  } else {
    if (!notificationId || !current.notifications.some((row) => clean(row.NotificationId || row.__id) === notificationId)) {
      const error = new Error('This notification is not available to this parent account.');
      error.status = 404;
      throw error;
    }
    await markNotificationRead(env, notificationId, context.email);
  }
  const notifications = current.notifications.map((row) => {
    const id = clean(row.NotificationId || row.__id);
    return markAll || id === notificationId
      ? { ...row, Read: true, ReadAt: row.ReadAt || new Date().toISOString() }
      : row;
  });
  return {
    ...current,
    notifications,
    unreadCount: notifications.filter((row) => !row.Read).length
  };
}

async function updateParentNotificationState(env, body) {
  const context = await getParentNotificationContext(env, body);
  const notificationId = clean(body.notificationId || body.NotificationId);
  const notification = await getDocument(env, 'notifications', notificationId);
  if (!notification || !notificationTargetsRecipient(notification, context.recipient)) {
    const error = new Error('This notification is not available to this parent account.');
    error.status = 404;
    throw error;
  }
  const action = lower(body.action || body.Action);
  if (action === 'archivenotification' || action === 'unarchivenotification') {
    await archiveNotification(env, notificationId, context.email, action === 'archivenotification');
  } else {
    await markNotificationRead(env, notificationId, context.email);
  }
  return parentNotificationResponse(env, body, context);
}

async function updateParentNotificationConfiguration(env, body, request) {
  const context = await getParentNotificationContext(env, body);
  const { dashboard, email } = context;
  const action = lower(body.action || body.Action);
  if (action === 'subscribepush') {
    await savePushSubscription(env, {
      ...(body.subscription || body.Subscription || body),
      SchoolId: env.DYNAMAX_WORKSPACE_ID,
      Audience: 'Parent',
      RecipientKey: email,
      UserAgent: request.headers.get('User-Agent') || ''
    });
  } else if (action === 'unsubscribepush') {
    await removePushSubscription(env, email, clean(body.deviceId || body.DeviceId));
  } else if (action === 'testpush') {
    const deviceId = clean(body.deviceId || body.DeviceId);
    const subscriptions = await listPushSubscriptions(env, email);
    if (!deviceId || !subscriptions.some((row) => clean(row.DeviceId) === deviceId)) {
      const error = new Error('Enable push on this device before sending a test notification.');
      error.status = 409;
      throw error;
    }
    const child = dashboard.children?.[0] || {};
    const testResult = await createNotification(env, {
      EventKey: `test-push:parent:${email}:${deviceId}:${Date.now()}`,
      Type: 'Test Push', Category: 'System', Audience: 'Parent', Channels: ['Push'],
      TargetEmails: [email], Title: 'Notifications are working',
      Message: 'This device can receive Dynamax browser notifications.',
      ActionUrl: 'parent-dashboard.html', BranchId: child.BranchId || 'main',
      SchoolSection: child.SchoolSection, CreatedBy: email
    }, { ignorePreferences: true, deviceId });
    if (!testResult.pushDeliveries.some((delivery) => delivery.status === 'Delivered')) {
      const failure = testResult.pushDeliveries.find((delivery) => delivery.error);
      const error = new Error(failure?.error || 'The push service did not deliver the test notification. Reconnect this device and try again.');
      error.status = 502;
      throw error;
    }
  }
  const response = {
    ok: true,
    messaging: publicMessagingConfig(env)
  };
  if (action === 'subscribepush' || action === 'unsubscribepush') {
    response.subscriptions = await listPushSubscriptions(env, email);
  }
  return response;
}

async function changeParentPassword(env, body) {
  const email = lower(body.__parentSessionEmail);
  if (!email) {
    const error = new Error('Your parent session has expired. Sign in again before changing your password.');
    error.status = 401;
    throw error;
  }
  const currentPassword = String(body.currentPassword || '').trim();
  const newPassword = String(body.newPassword || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (!currentPassword) {
    const error = new Error('Enter your current password or verification code.');
    error.status = 400;
    throw error;
  }
  if (newPassword !== confirmPassword) {
    const error = new Error('The new password and confirmation do not match.');
    error.status = 400;
    throw error;
  }
  if (newPassword === currentPassword) {
    const error = new Error('Choose a new password that is different from your current password.');
    error.status = 400;
    throw error;
  }
  const sources = await loadParentSources(env, 'identity', { email, code: currentPassword });
  await assertParentAccess(env, sources, email, currentPassword, '');
  await saveParentPassword(env, email, newPassword);
  return {
    ok: true,
    parentEmail: email,
    message: 'Password changed. Your browser can now update the saved password.'
  };
}

function parentResponseHeaders(cookie = '') {
  const headers = new Headers({
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache'
  });
  if (cookie) headers.set('Set-Cookie', cookie);
  return headers;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await readJsonBody(request, { maxBytes: 256 * 1024 });
    const action = clean(body.action || body.Action || 'getDashboard');
    if (lower(action) === 'signout') {
      return Response.json({ ok: true, message: 'Signed out.' }, {
        headers: parentResponseHeaders(clearParentSessionCookie())
      });
    }

    if (action === 'beginParentOnboarding' || action === 'completeParentOnboardingProfile') {
      const data = action === 'beginParentOnboarding'
        ? await beginParentOnboarding(env, body, request)
        : await completeParentOnboardingProfile(env, body, request);
      return Response.json(data, { headers: parentResponseHeaders() });
    }

    if (action === 'completeParentPasswordSetup') {
      const data = await completeParentPasswordSetup(env, body, request);
      const cookie = parentSessionCookie(await createParentSession(env, data.parentEmail));
      return Response.json(data, { headers: parentResponseHeaders(cookie) });
    }

    const session = await readParentSession(env, request);
    const suppliedEmail = lower(body.email || body.ParentEmail || body.Email);
    const suppliedSecret = String(body.code || body.VerificationCode || '').trim();
    delete body.__parentSessionEmail;
    delete body.__parentAuthenticatedEmail;
    if (session && !suppliedSecret) {
      body.email = session.email;
      body.__parentSessionEmail = session.email;
    } else if (!suppliedEmail || !suppliedSecret) {
      const error = new Error('Parent email and password or verification code are required.');
      error.status = 401;
      throw error;
    }
    if (action === 'getDashboard' && !body.__parentSessionEmail) {
      const requiredPasswordChange = await requireParentPasswordChange(
        env,
        suppliedEmail,
        suppliedSecret,
        request
      );
      if (requiredPasswordChange) {
        return Response.json(requiredPasswordChange, { headers: parentResponseHeaders() });
      }
    }
    if (!body.__parentSessionEmail && !['getDashboard', 'changeParentPassword'].includes(action)) {
      const sources = await loadParentSources(env, 'identity', body);
      await assertParentAccess(env, sources, suppliedEmail, suppliedSecret, '');
      body.__parentAuthenticatedEmail = suppliedEmail;
    }

    let data;
    if (action === 'changeParentPassword') {
      data = await changeParentPassword(env, body);
    } else if (action === 'updateWalletRestrictions') {
      data = await updateWalletRestrictions(env, body);
    } else if (action === 'getNotifications') {
      data = await getParentNotifications(env, body);
    } else if (action === 'markAllNotificationsRead') {
      data = await markParentNotificationRead(env, body);
    } else if (action === 'markNotificationRead') {
      data = await updateParentNotificationState(env, body);
    } else if (action === 'archiveNotification' || action === 'unarchiveNotification') {
      data = await updateParentNotificationState(env, body);
    } else if (['subscribePush', 'unsubscribePush', 'testPush'].includes(action)) {
      data = await updateParentNotificationConfiguration(env, body, request);
    } else if (action === 'getAcademicResultForPrint') {
      data = await getAcademicResultForPrint(env, body);
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
    const shouldIssueSession = (action === 'getDashboard' || action === 'changeParentPassword') && !data.passwordChangeRequired;
    const cookie = shouldIssueSession
      ? parentSessionCookie(await createParentSession(env, data.parentEmail || body.email))
      : '';
    return Response.json(data, {
      headers: parentResponseHeaders(cookie)
    });
  } catch (err) {
    return Response.json({
      ok: false,
      message: String(err && err.message ? err.message : err)
    }, {
      status: err.status || 500,
      headers: parentResponseHeaders()
    });
  }
}
