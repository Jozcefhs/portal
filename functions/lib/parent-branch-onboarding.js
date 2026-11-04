import { batchCommitLiteralDocuments, getDocument, queryCollection } from './firestore.js';
import { canonicalSchoolBranchId, schoolSectionFor } from './school-scope.js';
import { secureSecretEqual } from './request-security.js';
import { createParentBranchOnboardingToken, readParentBranchOnboardingToken } from './parent-auth.js';
import { onboardingStatus, onboardingTokenHash, parentOnboardingIdentity } from './parent-onboarding.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const INVITES = 'parentBranchInvites';
const invalid = () => Object.assign(new Error('This branch link, setup code or learner is not available for first-time setup. Check the branch and admission number, or ask the school for a personal link.'), { status: 401 });
const sections = value => Array.isArray(value) && value.length && value.every(item => ['primary', 'secondary'].includes(item))
  ? [...new Set(value)].sort() : [];
const linkedEmailFields = new Set(['parentemail', 'parentemails', 'verificationemail', 'email', 'fatheremail', 'motheremail', 'guardianemail']);

export function branchOnboardingEligible(student = {}) {
  if (onboardingStatus(student) !== 'pendingprofile') return false;
  if (Object.entries(student).some(([key, value]) => linkedEmailFields.has(lower(key)) && clean(value))) return false;
  if (clean(student.ApplicationReference || student.applicationReference || student.ApplicationID || student.applicationId)) return false;
  return !clean(student.ParentOnboardingProfileCompletedAt || student.parentOnboardingProfileCompletedAt)
    && !clean(student.ParentOnboardingCompletedAt || student.parentOnboardingCompletedAt)
    && !['complete', 'completed'].includes(lower(student.ProfileCompletionStatus || student.profileCompletionStatus));
}

export async function issueStaffBranchParentOnboarding(env, user, _body = {}, options = {}) {
  const rawBranch = clean(user.branchId);
  const section = lower(user.schoolSectionAccess || 'all');
  if (user.subscriptionReadOnly || lower(user.edition) !== 'school'
      || !(user.allowedSections || []).includes('students') || !rawBranch
      || ['all', '*'].includes(lower(rawBranch)) || !['all', 'primary', 'secondary'].includes(section)) {
    throw Object.assign(new Error('Select one school branch with permission to manage students.'), { status: 403 });
  }
  const branchId = canonicalSchoolBranchId(rawBranch);
  const schoolSections = section === 'all' ? ['primary', 'secondary'] : [section];
  const inviteId = `${branchId}__${section}`;
  const previous = await (options.getDocument || getDocument)(env, INVITES, inviteId);
  if (previous && !previous.__updateTime) throw Object.assign(new Error('Reload before replacing this branch link.'), { status: 409 });
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const generation = crypto.randomUUID();
  const setupCode = Array.from(crypto.getRandomValues(new Uint8Array(10)), byte => String(byte % 10)).join('');
  const token = await createParentBranchOnboardingToken(env, { inviteId, generation, branchId, schoolSections }, expiresAt);
  const now = new Date().toISOString();
  const branchName = clean(user.branchName) || (branchId === 'main' ? 'Main Branch' : branchId);
  const data = { BranchId: branchId, BranchName: branchName, SchoolSections: schoolSections,
    Generation: generation, SetupCodeHash: await onboardingTokenHash(`${generation}:${setupCode}`),
    ExpiresAt: expiresAt, UpdatedAt: now, UpdatedBy: clean(user.username),
    CreatedAt: previous?.CreatedAt || now };
  const auditId = crypto.randomUUID();
  await (options.commit || batchCommitLiteralDocuments)(env, [
    { collectionPath: INVITES, documentId: inviteId,
      ...(previous ? { updateTime: previous.__updateTime } : { exists: false }), data },
    { collectionPath: 'staffRecordsAudit', documentId: auditId, exists: false, data: {
      AuditId: auditId, Timestamp: now, Action: 'ISSUE BRANCH PARENT SETUP LINK', EntityType: 'Parent setup',
      EntityId: branchId, BranchId: branchId, SchoolSection: section, ActorUsername: clean(user.username),
      UserName: clean(user.displayName || user.username), UserRole: clean(user.role), SourcePlatform: 'Web',
      Details: 'Issued a branch-specific group setup link. Existing learner records and parent accounts were not changed.'
    } }
  ]);
  return { ok: true, onboardingPath: `/parent-dashboard#onboarding=1&branchAccess=${encodeURIComponent(token)}`,
    setupCode, branchId, branchName, schoolSections, expiresAt,
    message: 'Share this branch link and code in the branch parent group. Each eligible learner can complete setup once. This replaces the previous group link for this branch and school section.' };
}

async function activeInvite(env, proof, options) {
  if (!proof || !clean(proof.inviteId) || /[\/\\]/.test(proof.inviteId)
      || !clean(proof.branchId) || ['all', '*'].includes(lower(proof.branchId))
      || canonicalSchoolBranchId(proof.branchId) !== proof.branchId || !sections(proof.schoolSections).length) throw invalid();
  const invite = await (options.getDocument || getDocument)(env, INVITES, proof.inviteId);
  if (!invite || invite.Generation !== proof.generation || invite.BranchId !== proof.branchId
      || JSON.stringify(sections(invite.SchoolSections)) !== JSON.stringify(sections(proof.schoolSections))
      || !(Date.parse(invite.ExpiresAt) > Date.now())) throw invalid();
  return invite;
}

function candidateIdentity(row, scopePath, proof) {
  const scopeMatch = scopePath.match(/^schoolBranches\/([^/]+)\/sections\/(primary|secondary)\/students$/);
  // Root records have no path-based branch. Missing legacy branch belongs only
  // to Main Branch; it must never be inherited from the requested branch.
  const branch = canonicalSchoolBranchId(row.BranchId || row.branchId || scopeMatch?.[1] || 'main');
  const schoolSection = schoolSectionFor({ ...row, SchoolSection: row.SchoolSection || row.schoolSection || scopeMatch?.[2] });
  if (branch !== proof.branchId || !proof.schoolSections.includes(schoolSection)) return null;
  if (scopeMatch && (scopeMatch[1] !== branch || scopeMatch[2] !== schoolSection)) return null;
  const student = { ...row, BranchId: branch, SchoolSection: schoolSection, __scopePath: scopePath };
  return { student, identity: parentOnboardingIdentity(student) };
}

export async function beginBranchParentOnboarding(env, body, options = {}) {
  const proof = await readParentBranchOnboardingToken(env, clean(body.branchInviteToken));
  const invite = await activeInvite(env, proof, options);
  const code = clean(body.setupCode).replace(/[ -]/g, '');
  if (!/^\d{10}$/.test(code) || !await secureSecretEqual(invite.SetupCodeHash, await onboardingTokenHash(`${proof.generation}:${code}`))) throw invalid();
  const admissionNo = clean(body.admissionNo || body.AdmissionNo).toUpperCase();
  if (!admissionNo || admissionNo.length > 140) throw invalid();
  const selectedSection = lower(body.schoolSection);
  if (selectedSection && !proof.schoolSections.includes(selectedSection)) throw invalid();
  const allowedSections = selectedSection ? [selectedSection] : proof.schoolSections;
  const paths = [...allowedSections.map(section => `schoolBranches/${proof.branchId}/sections/${section}/students`), 'students'];
  const found = [];
  for (const path of paths) {
    const rows = await (options.queryCollection || queryCollection)(env, path, {
      filters: [{ field: 'AdmissionNo', op: '==', value: admissionNo }], limit: 10
    });
    // A truncated legacy query cannot establish unique identity. Never scan
    // the school, choose the first match or fall back to a different branch.
    if (rows.length >= 10) throw invalid();
    for (const row of rows) {
      const candidate = candidateIdentity(row, path, { ...proof, schoolSections: allowedSections });
      if (candidate && lower(candidate.identity.admissionNo) === lower(admissionNo)) found.push(candidate);
    }
  }
  if (found.length > 1) throw Object.assign(new Error('More than one learner matches in this branch. Select the correct school section, or ask the school for a personal learner link.'), { status: 409 });
  if (found.length !== 1 || !branchOnboardingEligible(found[0].student) || !found[0].student.__updateTime) throw invalid();
  const { student, identity } = found[0];
  const expiresAt = new Date(Math.min(Date.now() + 30 * 60 * 1000, Date.parse(invite.ExpiresAt))).toISOString();
  const branchClaimToken = await createParentBranchOnboardingToken(env, {
    ...identity, inviteId: proof.inviteId, generation: proof.generation, schoolSections: proof.schoolSections,
    revision: student.__updateTime
  }, expiresAt, true);
  return { ok: true, branchClaimToken, student: {
    admissionNo: identity.admissionNo, studentName: clean(student.DisplayName || student.ApplicantName),
    firstName: clean(student.FirstName), middleName: clean(student.MiddleName), surname: clean(student.Surname),
    className: clean(student.ClassName || student.ClassAdmitted), branchName: clean(invite.BranchName) || proof.branchId,
    schoolSection: identity.schoolSection
  }, message: 'Learner confirmed in this branch. Complete your first-time profile below.' };
}

export async function requireBranchParentOnboardingClaim(env, body, options = {}) {
  const token = clean(body.branchClaimToken);
  const proof = await readParentBranchOnboardingToken(env, token, true);
  await activeInvite(env, proof, options);
  const identity = parentOnboardingIdentity({ __scopePath: proof.scopePath, __id: proof.documentId,
    AdmissionNo: proof.admissionNo, BranchId: proof.branchId, SchoolSection: proof.schoolSection });
  if (!proof.schoolSections.includes(identity.schoolSection)
      || clean(body.admissionNo || body.AdmissionNo) && lower(body.admissionNo || body.AdmissionNo) !== lower(identity.admissionNo)) throw invalid();
  const row = await (options.getDocument || getDocument)(env, identity.scopePath, identity.documentId);
  if (!row) throw invalid();
  const candidate = candidateIdentity({ ...row, __id: identity.documentId }, identity.scopePath, proof);
  if (!candidate || Object.keys(identity).some(key => candidate.identity[key] !== identity[key])) throw invalid();
  const student = candidate.student;
  const hash = await onboardingTokenHash(token);
  // A response lost after the atomic write may resume only with the same
  // short-lived, exact learner claim. The shared invitation cannot resume it.
  const replay = ['awaitingpassword', 'complete'].includes(onboardingStatus(student))
    && await secureSecretEqual(student.ParentBranchOnboardingClaimHash, hash);
  if (!replay && (!branchOnboardingEligible(student) || student.__updateTime !== proof.revision)) throw invalid();
  return { student, replay, patch: { ParentOnboardingTokenHash: hash,
    ParentOnboardingExpiresAt: new Date(proof.exp * 1000).toISOString(), ParentBranchOnboardingClaimHash: hash } };
}
