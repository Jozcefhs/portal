import assert from 'node:assert/strict';
import { createPortalCbtService } from '../../functions/lib/portal-cbt.js';
import { objectToFirestoreFields, firestoreDocumentToObject, buildStructuredQuery } from '../../functions/lib/firestore.js';
import { hashStudentPassword, studentLoginCredentialCollection, studentLoginCredentialId } from '../../functions/lib/student-login-credentials.js';
import { academicCbtPaperDigest } from '../../functions/lib/academic-cbt-papers.js';

// Synthetic data only. Production examination rules and the Firestore codec run
// unchanged; storage and academic context are kept entirely inside this process.
export function browserFixture() {
  const db = new Map(); let revision = 0;
  const source = 'schoolBranches/main/sections/secondary/applications';
  const put = (path, id, data) => db.set(`${path}/${id}`, firestoreDocumentToObject({
    name: `${path}/${id}`, fields: objectToFirestoreFields(data), updateTime: `r${++revision}`
  }));
  const get = async (_env, path, id) => structuredClone(db.get(`${path}/${id}`) || null);
  const list = path => [...db].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(([, row]) => structuredClone(row));
  const component = { Id: 'ca1', Name: 'CA1', MaximumScore: 100, SourceMode: 'any', ScoreEntryMode: 'objective-theory', ObjectiveMaximumScore: 40, TheoryMaximumScore: 60,
    ScoreParts: [{ Id: 'objective', SourceMode: 'any' }, { Id: 'theory', SourceMode: 'any' }] };
  const allocation = { SessionId: 'session', TermId: 'term', ClassId: 'grade7', SubjectId: 'logic', TeacherUsername: 'teacher', Status: 'Active' };
  const dependencies = { get, studentQuery: async (_env, _path, opts) => list('students').filter(row => opts.filters.every(filter => row[filter.field] === filter.value)).map(row => ({ ...row, __scopePath: 'students' })), query: async (_env, path, opts) => {
    buildStructuredQuery(path, opts);
    return list(path).filter(row => opts.filters.every(filter => filter.field.split('.').reduce((value, key) => value?.[key], row) === filter.value));
  }, commit: async (_env, writes) => {
    for (const w of writes) {
      const previous = db.get(`${w.collectionPath}/${w.documentId}`);
      assert.ok(w.exists === false || w.updateTime);
      if (w.exists === false && previous || w.updateTime && previous?.__updateTime !== w.updateTime) throw Object.assign(new Error('Conflict'), { status: 409 });
    }
    for (const w of writes) {
      const key = `${w.collectionPath}/${w.documentId}`, previous = db.get(key);
      put(w.collectionPath, w.documentId, w.data);
      if (w.updateMask) db.set(key, { ...previous, ...db.get(key) });
    }
  }, schoolRows: async (_env, collection) => list(collection === 'applications' ? source : 'students').map(row => ({ ...row, __scopePath: collection === 'applications' ? source : 'students' })),
  academic: async () => ({ component, context: { scheme: { Components: [component] }, allocation, roster: [{ StudentRef: 'ST/001' }],
    subject: { SubjectId: 'logic', Name: 'Logic' }, schoolClass: { Name: 'Grade 7' }, session: { Name: '2026/2027' }, term: { Name: 'First Term' } } }),
  bootstrap: async () => ({ sessions: [{ SessionId: 'session', Name: '2026/2027' }], terms: [{ TermId: 'term', SessionId: 'session', Name: 'First Term' }],
    classes: [{ ClassId: 'grade7', Name: 'Grade 7' }], subjects: [{ SubjectId: 'logic', Name: 'Logic' }], teacherAllocations: [allocation], selection: { SessionId: 'session', TermId: 'term' } }) };
  const actor = { username: 'reviewer', role: 'ICT', edition: 'school', allowedSections: ['academics', 'applications'], schoolSectionAccess: 'All' };
  const env = { ORGANISATION_EDITION: 'school', DYNAMAX_WORKSPACE_ID: 'fixture', STAFF_SESSION_SECRET: 'synthetic-exam-fixture-secret' };
  const objects = new Map();
  env.DYNAMAX_DOCUMENTS = { delete: async key => objects.delete(key), put: async (key, bytes) => { objects.set(key, bytes.slice()); return { etag: 'test' }; }, get: async key => objects.has(key) ? { arrayBuffer: async () => objects.get(key).buffer } : null };
  put('settings', 'schoolProfile', { SchoolName: 'Example School', EntranceExamSubjects: [{ id: 'logic', name: 'Logic', maxScore: 100 }] });
  for (let i = 1; i <= 2; i++) put(source, `app-${i}`, { ApplicationReference: `APP/00${i}`, ApplicantName: `Candidate ${i}`, AcademicSession: '2026/2027', Term: 'First Term', ClassApplyingFor: 'Grade 7' });
  put('students', 'student1', { AdmissionNo: 'ST/001', StudentName: 'Example Student' });
  async function seedUploadedStudentExam(pdfBytes) {
    const scope = { BranchId: 'main', SchoolSection: 'secondary', Status: 'Active' };
    put('academicSessions', 'session', { ...scope, SessionId: 'session', Name: '2026/2027' });
    put('academicTerms', 'term', { ...scope, SessionId: 'session', TermId: 'term', Name: 'First Term' });
    put('academicClasses', 'grade7', { ...scope, ClassId: 'grade7', Name: 'Grade 7', SchoolStage: 'junior-secondary' });
    put('academicClasses', 'grade8', { ...scope, ClassId: 'grade8', Name: 'Grade 8', SchoolStage: 'junior-secondary' });
    put('academicStudentMemberships', 'student1', { ...scope, ...allocation, StudentRef: 'ST/001', SubjectIds: ['logic'] });
    put('students', 'student1', { ...scope, AdmissionNo: 'ST/001', StudentName: 'Example Student' });
    put(studentLoginCredentialCollection(scope), await studentLoginCredentialId('ST/001'), { ...scope, StudentRef: 'ST/001', Active: true, ...await hashStudentPassword('StudentPass1!') });
    let binary = ''; for (let i = 0; i < pdfBytes.length; i += 8192) binary += String.fromCharCode(...pdfBytes.subarray(i, i + 8192));
    const digest = await academicCbtPaperDigest(btoa(binary)), key = 'v1/school/fixture/academic-cbt/source.pdf'; objects.set(key, new Uint8Array(pdfBytes));
    const paper = { Url: `r2://dynamax-documents/${key}`, FileName: 'logic.pdf', MimeType: 'application/pdf', Digest: digest, ByteLength: pdfBytes.length };
    put('academicCbtTests', 'uploaded-test', { ...scope, ...allocation, CbtTestId: 'uploaded-test', Title: 'CA1 · Logic · Grade 7', SubjectName: 'Logic',
      AssessmentComponentId: 'ca1', AssessmentComponentName: 'CA1', PaperMode: 'split', MaximumScore: 100, ObjectiveMaximumScore: 40, TheoryMaximumScore: 60,
      NumberOfQuestions: 2, Options: ['A', 'B', 'C', 'D'], AnswerKey: ['B', 'D'], DurationMinutes: 30, TheoryDurationMinutes: 40, PaperFiles: [paper], TheoryPaperFiles: [paper] });
  }
  return { staff: createPortalCbtService(env, actor, dependencies), candidate: createPortalCbtService(env, null, dependencies), db, source, seedUploadedStudentExam };
}
