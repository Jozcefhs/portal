import { getStoredDocument } from './document-storage.js';
import { academicCbtPaperDigest, validateAcademicCbtPaper } from './academic-cbt-papers.js';
import { documentQuestions } from './portal-cbt-papers.js';
import { studentLoginCredentialCollection, studentLoginCredentialId, verifyStudentPasswordHash } from './student-login-credentials.js';
import { studentStatusKind } from './student-academic-status.js';
import { clean, lower, fail } from './portal-cbt-model.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { scopedCollectionPath } from './school-scope.js';

export const automaticStudentAccess = test => test.Audience === 'student' && test.AccessMode === 'eligible-students';
const active = row => ['active', 'enrolled', ''].includes(lower(row.Status));
const scoped = (row, scope) => lower(row.BranchId || 'main') === lower(scope.BranchId) && lower(row.SchoolSection) === scope.SchoolSection;
export const uploadedScopeFields = ['BranchId', 'SchoolSection', 'SessionId', 'TermId', 'ClassId'];

export function uploadedPaperFiles(source, part = '') {
  const prefix = part === 'theory' ? 'TheoryPaper' : 'Paper';
  return source[`${prefix}Files`]?.length ? source[`${prefix}Files`] : source[`${prefix}Url`] ? [{
    Url: source[`${prefix}Url`], FileName: source[`${prefix}FileName`], MimeType: source[`${prefix}MimeType`],
    Digest: source[`${prefix}Digest`], ByteLength: source[`${prefix}ByteLength`]
  }] : [];
}

export function uploadedQuestions(source, part) {
  const split = source.PaperMode === 'split';
  const maximum = Number(split ? (part === 'theory' ? source.TheoryMaximumScore : source.ObjectiveMaximumScore) : source.MaximumScore);
  if (part === 'theory') return [{ QuestionId: 'Q1', QuestionType: 'extended',
    Prompt: 'Answer the questions in the uploaded theory paper. Label each answer with its question number.', MaximumScore: maximum }];
  const labels = source.Options || [];
  const keys = (source.AnswerKey || []).map(answer => String.fromCharCode(65 + labels.findIndex(label => lower(label) === lower(answer))));
  return documentQuestions({ NumberOfQuestions: source.NumberOfQuestions, MaximumScore: maximum, OptionCount: labels.length, AnswerKey: keys })
    .map(question => ({ ...question, Options: labels }));
}

// Copy verified bytes to the remote exam's private namespace. Local-paper
// replacement/retention can then never break an already opened remote sitting.
export async function copyUploadedPaper(env, source, part, testId) {
  const files = uploadedPaperFiles(source, part);
  if (!files.length || files.length > 12 || files.reduce((sum, file) => sum + Number(file.ByteLength || 0), 0) > 32 * 1024 * 1024) throw fail('This uploaded paper is unavailable or too large for remote delivery.');
  const pages = [];
  let total = 0;
  for (const [index, file] of files.entries()) {
    const stored = await getStoredDocument(env, file.Url);
    if (stored.object.size > 8 * 1024 * 1024) throw fail('A question-paper file exceeds 8 MB.');
    const bytes = new Uint8Array(await stored.object.arrayBuffer());
    total += bytes.length;
    if (total > 32 * 1024 * 1024) throw fail('The question paper exceeds 32 MB.');
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const encoded = btoa(binary), digest = await academicCbtPaperDigest(encoded);
    if (digest !== lower(file.Digest)) throw fail('The uploaded paper changed or failed its integrity check. Reload the uploaded tests.', 409);
    const validated = validateAcademicCbtPaper({ FileName: file.FileName, FileBase64: encoded });
    if (validated.mimeType !== lower(file.MimeType)) throw fail('The uploaded paper type does not match its saved record.', 409);
    const key = `private-portal-cbt/${encodeURIComponent(requiredDeploymentIdentity(env).workspaceId)}/${testId}/uploaded-${digest}-${index + 1}`;
    if (!await env.DYNAMAX_DOCUMENTS.put(key, bytes, { httpMetadata: { contentType: validated.mimeType } })) throw fail('The remote paper copy was not confirmed. Retry safely.', 503);
    pages.push({ Key: key, FileName: file.FileName, MimeType: validated.mimeType, Digest: digest, ByteLength: bytes.length });
  }
  return { FileName: files[0].FileName, Pages: pages };
}

export async function eligibleRemoteStudent(env, test, reference, password, db) {
  const denied = () => fail('The student login is incorrect, inactive, or not eligible for this class and subject.', 403);
  const credential = await db.get(env, studentLoginCredentialCollection(test.Scope), await studentLoginCredentialId(reference));
  if (!credential || credential.Active === false || lower(credential.StudentRef) !== lower(reference)
    || !scoped(credential, test.Scope) || (password !== undefined && !await verifyStudentPasswordHash(credential, password))) throw denied();
  const canonical = clean(credential.StudentRef);
  const filters = [...uploadedScopeFields.map(field => ({ field, op: '==', value: test.Scope[field] || test.Academic[field] })),
    { field: 'StudentRef', op: '==', value: canonical }];
  const memberships = await db.query(env, 'academicStudentMemberships', { filters, pageSize: 10, maxRows: 100 });
  const schoolClass = await db.get(env, 'academicClasses', test.Academic.ClassId);
  const eligible = memberships.filter(row => scoped(row, test.Scope) && active(row)
    && ['SessionId', 'TermId', 'ClassId'].every(field => row[field] === test.Academic[field])
    && (schoolClass?.SchoolStage === 'junior-secondary' || (row.SubjectIds || []).includes(test.Academic.SubjectId)));
  if (!schoolClass || !scoped(schoolClass, test.Scope) || !active(schoolClass) || !eligible.length) throw denied();
  const profiles = await db.studentQuery(env, 'students', { branchId: test.Scope.BranchId, section: test.Scope.SchoolSection,
    filters: [{ field: 'AdmissionNo', op: '==', value: canonical }], limit: 5 });
  const matchingProfiles = profiles.filter(row => lower(row.BranchId || 'main') === lower(test.Scope.BranchId)
    && lower(row.SchoolSection || test.Scope.SchoolSection) === test.Scope.SchoolSection);
  const profile = matchingProfiles.find(row => row.__scopePath === scopedCollectionPath('students', test.Scope.BranchId, test.Scope.SchoolSection)) || matchingProfiles[0];
  if (!profile || studentStatusKind(profile.Status || profile.status) !== 'active') throw denied();
  return { Reference: canonical, SourceId: profile.__id, SourcePath: profile.__scopePath,
    DisplayName: clean(profile.StudentName || profile.ApplicantName || profile.DisplayName || profile.FullName || [profile.Surname, profile.FirstName, profile.OtherNames].filter(Boolean).join(' ')) || canonical };
}
