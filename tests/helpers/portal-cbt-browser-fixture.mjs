import assert from 'node:assert/strict';
import { createPortalCbtService } from '../../functions/lib/portal-cbt.js';
import { objectToFirestoreFields, firestoreDocumentToObject, buildStructuredQuery } from '../../functions/lib/firestore.js';

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
  const dependencies = { get, query: async (_env, path, opts) => {
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
  env.DYNAMAX_DOCUMENTS = { put: async (key, bytes) => { objects.set(key, bytes.slice()); return { etag: 'test' }; }, get: async key => objects.has(key) ? { arrayBuffer: async () => objects.get(key).buffer } : null };
  put('settings', 'schoolProfile', { SchoolName: 'Example School', EntranceExamSubjects: [{ id: 'logic', name: 'Logic', maxScore: 100 }] });
  for (let i = 1; i <= 2; i++) put(source, `app-${i}`, { ApplicationReference: `APP/00${i}`, ApplicantName: `Candidate ${i}`, AcademicSession: '2026/2027', Term: 'First Term', ClassApplyingFor: 'Grade 7' });
  put('students', 'student1', { AdmissionNo: 'ST/001', StudentName: 'Example Student' });
  return { staff: createPortalCbtService(env, actor, dependencies), candidate: createPortalCbtService(env, null, dependencies), db, source };
}
