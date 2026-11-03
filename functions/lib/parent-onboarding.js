import { batchCommitLiteralDocuments, getDocument } from './firestore.js';
import { canonicalSchoolBranchId, schoolSectionFor } from './school-scope.js';
import { secureSecretEqual } from './request-security.js';
import { createParentOnboardingToken, readParentOnboardingToken,
  createParentPasswordSetupToken, readParentPasswordSetupToken,
  hashParentPassword, parentCredentialId } from './parent-auth.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const invalid = () => Object.assign(new Error('This personal link is invalid, expired or already used. Ask the school to issue a new link for your child in the correct branch.'), { status: 401 });

export function onboardingStatus(student = {}) {
  const explicit = lower(student.ParentOnboardingStatus || student.parentOnboardingStatus);
  if (explicit) return explicit;
  return lower(student.ProfileCompletionStatus || student.profileCompletionStatus) === 'needs completion'
    && !clean(student.ParentOnboardingProfileCompletedAt || student.parentOnboardingProfileCompletedAt)
    && !clean(student.ParentOnboardingCompletedAt || student.parentOnboardingCompletedAt) ? 'pendingprofile' : '';
}

export function parentOnboardingIdentity(student) {
  const scopePath = clean(student?.__scopePath);
  const documentId = clean(student?.__id);
  const match = scopePath.match(/^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/students$/);
  if ((scopePath !== 'students' && !match) || !documentId || /[\/\\]/.test(documentId)
      || ['.', '..'].includes(documentId)) throw invalid();
  const branchId = canonicalSchoolBranchId(student.BranchId || match?.[1] || 'main');
  const schoolSection = schoolSectionFor(student);
  if (match && (canonicalSchoolBranchId(match[1]) !== branchId || match[2] !== schoolSection)) throw invalid();
  const admissionNo = clean(student.AdmissionNo || student.AccountRef);
  if (!admissionNo) throw invalid();
  return { scopePath, documentId, branchId, schoolSection, admissionNo };
}

export async function onboardingTokenHash(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function prepareParentOnboarding(env, student, actor) {
  const identity = parentOnboardingIdentity(student);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const token = await createParentOnboardingToken(env, identity, expiresAt);
  return {
    identity,
    patch: { ParentOnboardingTokenHash: await onboardingTokenHash(token), ParentOnboardingExpiresAt: expiresAt,
      ParentOnboardingStatus: 'PendingProfile', ProfileCompletionStatus: 'Needs completion',
      ParentOnboardingReissuedAt: now, UpdatedAt: now, UpdatedBy: clean(actor) || 'Student Register' },
    onboardingPath: `/parent-dashboard#onboarding=1&admission=${encodeURIComponent(identity.admissionNo)}&access=${encodeURIComponent(token)}`,
    admissionNo: identity.admissionNo, expiresAt,
    branchName: clean(student.BranchName) || identity.branchId,
    schoolSection: identity.schoolSection
  };
}

export async function issueParentOnboarding(env, student, actor, options = {}) {
  if (!student?.__updateTime) throw Object.assign(new Error('Refresh the learner record before issuing a personal link.'), { status: 409 });
  const prepared = await prepareParentOnboarding(env, student, actor);
  await (options.commit || batchCommitLiteralDocuments)(env, [{ collectionPath: prepared.identity.scopePath,
    documentId: prepared.identity.documentId, updateTime: student.__updateTime,
    updateMask: Object.keys(prepared.patch), data: prepared.patch }]);
  const { patch, identity, ...result } = prepared;
  return { ok: true, ...result, message: 'Personal parent link issued. It expires in 7 days and replaces any previous link for this learner.' };
}

export async function issueStaffParentOnboarding(env, user, body, options = {}) {
  if (user.subscriptionReadOnly || !(user.allowedSections || []).includes('students') || !clean(user.branchId)) {
    throw Object.assign(new Error('Select a working branch with permission to manage students.'), { status: 403 });
  }
  const path = clean(body.ScopePath);
  const id = clean(body.DocumentId);
  const match = path.match(/^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/students$/);
  if ((!match && path !== 'students') || !id || /[\/\\]/.test(id) || ['.', '..'].includes(id)) {
    throw Object.assign(new Error('Reload Students and issue the link from the intended learner row.'), { status: 400 });
  }
  const branch = canonicalSchoolBranchId(user.branchId);
  const section = lower(user.schoolSectionAccess || 'all');
  if (match && (canonicalSchoolBranchId(match[1]) !== branch || (section !== 'all' && match[2] !== section))) {
    throw Object.assign(new Error('This learner is outside your working branch or section.'), { status: 403 });
  }
  const row = await (options.getDocument || getDocument)(env, path, id);
  if (!row) throw Object.assign(new Error('Learner not found. Reload Students.'), { status: 404 });
  const student = { ...row, __id: id, __scopePath: path };
  const identity = parentOnboardingIdentity(student);
  if (identity.branchId !== branch || (section !== 'all' && identity.schoolSection !== section)
      || lower(body.AccountRef) !== lower(identity.admissionNo)) {
    throw Object.assign(new Error('The selected learner does not match your working branch and section.'), { status: 403 });
  }
  return issueParentOnboarding(env, student, user.displayName || user.username, options);
}

async function boundStudent(env, identity, accessHash, options = {}) {
  // Validate the signed path before touching Firestore. No admission-only fallback.
  const expected = parentOnboardingIdentity({ __scopePath: identity.scopePath, __id: identity.documentId,
    BranchId: identity.branchId, SchoolSection: identity.schoolSection, AdmissionNo: identity.admissionNo });
  const row = await (options.getDocument || getDocument)(env, expected.scopePath, expected.documentId);
  if (!row) throw invalid();
  const student = { ...row, __scopePath: expected.scopePath, __id: expected.documentId };
  const actual = parentOnboardingIdentity(student);
  if (Object.keys(expected).some(key => expected[key] !== actual[key])
      || !student.ParentOnboardingTokenHash || !accessHash
      || !(await secureSecretEqual(student.ParentOnboardingTokenHash, accessHash))
      || !(Date.parse(student.ParentOnboardingExpiresAt) > Date.now())) throw invalid();
  return student;
}

export async function requireParentOnboardingStudent(env, body, options = {}) {
  const token = clean(body.onboardingToken);
  const identity = await readParentOnboardingToken(env, token);
  if (!identity || (clean(body.admissionNo || body.AdmissionNo)
      && lower(body.admissionNo || body.AdmissionNo) !== lower(identity.admissionNo))) throw invalid();
  const student = await boundStudent(env, identity, await onboardingTokenHash(token), options);
  const statuses = options.statuses || ['pendingprofile'];
  if (!statuses.includes(onboardingStatus(student))) throw invalid();
  return student;
}

export async function parentOnboardingPasswordStep(env, student) {
  const identity = parentOnboardingIdentity(student);
  return { ok: true, parentEmail: lower(student.ParentEmail), passwordChangeRequired: true,
    passwordSetupToken: await createParentPasswordSetupToken(env, student.ParentEmail, identity.admissionNo,
      { ...identity, accessHash: student.ParentOnboardingTokenHash }),
    message: 'Create a private password to finish setting up your parent account.' };
}

export async function finishParentOnboardingPassword(env, body, options = {}) {
  const setup = await readParentPasswordSetupToken(env, body.passwordSetupToken);
  if (!setup) throw invalid();
  const student = await boundStudent(env, setup, setup.accessHash, options);
  if (onboardingStatus(student) !== 'awaitingpassword' || lower(student.ParentEmail) !== setup.email) throw invalid();
  const password = String(body.newPassword || '');
  if (password !== String(body.confirmPassword || '') || password !== password.trim()) {
    throw Object.assign(new Error('Passwords must match and cannot begin or end with a space.'), { status: 400 });
  }
  if (password === '12345678') throw Object.assign(new Error('Choose a private password instead of the old temporary password.'), { status: 400 });
  if (!student.__updateTime) throw Object.assign(new Error('Refresh your personal link and retry.'), { status: 409 });
  const passwordFields = await hashParentPassword(password);
  const credentialEpoch = crypto.randomUUID();
  const now = new Date().toISOString();
  const patch = { ParentOnboardingStatus: 'Complete', ParentOnboardingTokenHash: '', ParentOnboardingExpiresAt: '',
    ParentOnboardingCompletedAt: now, UpdatedAt: now, UpdatedBy: 'Parent onboarding' };
  try {
    // Both writes succeed together. An existing password is never overwritten;
    // simultaneous attempts or an old link cannot create another account.
    await (options.commit || batchCommitLiteralDocuments)(env, [
      { collectionPath: 'parentCredentials', documentId: parentCredentialId(setup.email), exists: false,
        data: { Email: setup.email, ...passwordFields, SessionEpoch: credentialEpoch,
          PasswordChangedAt: now, CreatedAt: now, UpdatedAt: now } },
      { collectionPath: setup.scopePath, documentId: setup.documentId, updateTime: student.__updateTime,
        updateMask: Object.keys(patch), data: patch }
    ]);
  } catch (error) {
    if (![409, 412].includes(Number(error?.status))) throw error;
    throw Object.assign(new Error('This setup has changed or a parent password already exists. Sign in with your private password, or reopen the personal link.'), { status: 409 });
  }
  return { ok: true, parentEmail: setup.email, credentialEpoch, message: 'Private password saved. Your parent dashboard is now ready.' };
}
