import { getDocument, queryCollectionPages, batchCommitDocuments } from './firestore.js';
import { listSchoolCollection } from './school-scope.js';
import { enforceActorBranch } from './branch-scope.js';
import { requiredDeploymentIdentity } from './deployment-identity.js';
import { academicManagementCapabilities, portalCbtAcademicContext, bootstrapAcademicManagement, resolveAcademicCbtScorePlacement, syncAcademicCbtScores, academicCbtScoreBatchDigest } from './academic-management.js';
import { normalizeEntranceSubjects, entranceSubjectRows, entranceScoreUpdates } from './entrance-subjects.js';
import { hashStudentPassword, verifyStudentPasswordHash } from './student-login-credentials.js';
import { secureSecretEqual } from './request-security.js';
import { clean, lower, fail, fields, condition, conflict, normalizeQuestions, normalizeSchedule, normalizeAnswers, markAnswers, publicTest, publicAttempt, startAttempt, completeAttempt } from './portal-cbt-model.js';

export const CBT = Object.freeze({ tests: 'portalCbtTests', candidates: 'portalCbtCandidates', audit: 'portalCbtAudit' });
const encoder = new TextEncoder();
const iso = now => new Date(now).toISOString();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function cbtHash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
const token = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const actorName = user => clean(user.username || user.Username);
const candidateView = row => Object.fromEntries(['CandidateId', 'Reference', 'LoginId', 'DisplayName', 'Delivery', 'Status', 'StartedAt', 'ExpiresAt', 'SubmittedAt', 'NeedsMarking', 'RawScore', 'PostedAt', 'PostMessage', 'OfflineServerId'].map(key => [key, row[key] ?? '']));

// The legacy database import encoder coerces numeric-looking strings. Keep
// examination text verbatim, including "0012", whitespace and written answers.
export function encodeExamRecord(row) {
  const result = fields(row);
  for (const key of ['Questions', 'Answers']) if (Object.hasOwn(result, key)) {
    result[`${key}Json`] = JSON.stringify(result[key]); delete result[key];
  }
  return result;
}
export function decodeExamRecord(row) {
  if (!row) return row;
  const result = { ...row };
  for (const key of ['Questions', 'Answers']) if (result[`${key}Json`]) {
    result[key] = JSON.parse(result[`${key}Json`]); delete result[`${key}Json`];
  }
  return result;
}

export function portalCbtScope(env, user, input) {
  if (requiredDeploymentIdentity(env).edition !== 'school' || user.subscriptionActive === false || user.subscriptionReadOnly === true) throw fail('An active school workspace is required.', 403);
  const section = lower(input.SchoolSection);
  if (!['primary', 'secondary'].includes(section)) throw fail('Choose Primary or Secondary.');
  const access = lower(user.schoolSectionAccess || user.UserSchoolSectionAccess || 'all');
  if (!['all', '', section].includes(access)) throw fail('This school section is not assigned to your account.', 403);
  const branch = enforceActorBranch(user, input.BranchId);
  const permissions = academicManagementCapabilities(user);
  const admission = ['Super Admin', 'Director', 'Admin', 'Admissions Officer', 'Principal', 'Head Teacher', 'Management', 'ICT', 'Examination Officer'].includes(user.role)
    && (user.allowedSections || []).some(value => ['admissions', 'applications', 'academics'].includes(value));
  if (input.Audience === 'applicant' ? !admission : !permissions.canReviewScores) throw fail('Your role cannot manage these examinations.', 403);
  return { BranchId: branch, SchoolSection: section, WorkspaceId: requiredDeploymentIdentity(env).workspaceId };
}

export function createPortalCbtService(env, user = null, dependencies = {}) {
  const rawGet = dependencies.get || getDocument;
  const get = async (...args) => decodeExamRecord(await rawGet(...args));
  const query = dependencies.query || queryCollectionPages;
  const commit = dependencies.commit || batchCommitDocuments;
  const schoolRows = dependencies.schoolRows || listSchoolCollection;
  const academic = dependencies.academic || portalCbtAcademicContext;
  const clock = dependencies.now || Date.now;
  const sync = dependencies.sync || syncAcademicCbtScores;
  const bootstrap = dependencies.bootstrap || bootstrapAcademicManagement;
  const resolvePlacement = dependencies.resolvePlacement || resolveAcademicCbtScorePlacement;
  const write = (collectionPath, documentId, data, before) => ({ collectionPath, documentId,
    data: [CBT.tests, CBT.candidates].includes(collectionPath) ? encodeExamRecord(data) : fields(data), ...condition(before) });
  const audit = (action, test, reference = '') => ({ collectionPath: CBT.audit, documentId: crypto.randomUUID(), exists: false,
    data: { ...test.Scope, TestId: test.TestId, Action: action, Reference: reference, Actor: actorName(user || {}), At: iso(clock()) } });
  async function retry(task) {
    for (let i = 0; ; i++) {
      try { return await task(); } catch (error) { if (i >= 4 || !conflict(error)) throw error; }
    }
  }
  async function rows(collection, field, value) {
    return (await query(env, collection, { filters: [{ field, op: '==', value }], pageSize: 500, maxRows: 10000 })).map(decodeExamRecord);
  }
  async function testById(id) {
    if (!/^[a-f0-9]{64}$/.test(clean(id))) throw fail('Choose a valid test.', 404);
    const test = await get(env, CBT.tests, id);
    if (!test || test.Scope?.WorkspaceId !== requiredDeploymentIdentity(env).workspaceId) throw fail('This test is not available.', 404);
    return test;
  }
  async function staffTest(id) {
    const test = await testById(id);
    const scope = portalCbtScope(env, user, { ...test.Scope, Audience: test.Audience });
    if (Object.keys(scope).some(key => scope[key] !== test.Scope[key])) throw fail('This test belongs to another workspace.', 403);
    return test;
  }
  async function passwordFor(candidate) {
    const secret = clean(env.STAFF_SESSION_SECRET || env.BACKEND_SHARED_SECRET);
    if (!secret) throw fail('Examination access is not configured.', 503);
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64(await crypto.subtle.sign('HMAC', key, encoder.encode(`portal-cbt-access-v1|${candidate.CandidateId}|${candidate.PasswordNonce}`))).slice(0, 16);
  }
  async function sources(test) {
    const collection = test.Audience === 'applicant' ? 'applications' : 'students';
    const all = await schoolRows(env, collection, { branchId: test.Scope.BranchId, section: test.Scope.SchoolSection });
    if (test.Audience === 'applicant') return all.filter(row => !row.AdmissionDetailsRemovedAt
      && clean(row.AcademicSession) === test.AcademicSession && clean(row.Term) === test.Term
      && lower(row.ClassApplyingFor || row.ClassName) === lower(test.ClassName));
    const { context } = await academic(env, user, { ...test.Scope, ...test.Academic });
    const refs = new Set(context.roster.map(row => lower(row.StudentRef)));
    return all.filter(row => refs.has(lower(row.AdmissionNo || row.StudentRef || row.AccountRef || row.__id)));
  }
  function sourceIdentity(test, row) {
    const reference = clean(test.Audience === 'applicant' ? row.ApplicationReference || row.ApplicationID || row.__id : row.AdmissionNo || row.StudentRef || row.AccountRef || row.__id);
    return { Reference: reference, SourceId: row.__id, SourcePath: row.__scopePath,
      DisplayName: clean(row.ApplicantName || row.StudentName || row.DisplayName || row.FullName || [row.Surname, row.FirstName, row.OtherNames].filter(Boolean).join(' ')) || reference };
  }
  async function state(input) {
    const scope = portalCbtScope(env, user, input);
    const [tests, profile] = await Promise.all([rows(CBT.tests, 'Scope.BranchId', scope.BranchId), get(env, 'settings', 'schoolProfile')]);
    return { ok: true, subjects: normalizeEntranceSubjects(profile?.EntranceExamSubjects), tests: tests.filter(test => test.Scope?.SchoolSection === scope.SchoolSection && test.Scope?.WorkspaceId === scope.WorkspaceId && test.Audience === input.Audience)
      .map(test => ({ ...publicTest(test), ...test.Scope, Revision: test.__updateTime, CandidateCount: test.CandidateCount || 0 })) };
  }
  async function options(input) {
    const scope = portalCbtScope(env, user, input);
    if (input.Audience === 'student') {
      const data = await bootstrap(env, user, { ...scope, ...input, View: 'cbt' });
      return { ok: true, sessions: data.sessions, terms: data.terms, classes: data.classes, subjects: data.subjects,
        allocations: data.teacherAllocations, components: data.assessmentScheme?.Components || [], selection: data.selection };
    }
    const apps = await schoolRows(env, 'applications', { branchId: scope.BranchId, section: scope.SchoolSection });
    return { ok: true, periods: [...new Map(apps.filter(row => !row.AdmissionDetailsRemovedAt).map(row => [JSON.stringify([row.AcademicSession, row.Term, row.ClassApplyingFor]), {
      AcademicSession: clean(row.AcademicSession), Term: clean(row.Term), ClassName: clean(row.ClassApplyingFor)
    }])).values()].filter(row => row.AcademicSession && row.Term && row.ClassName) };
  }
  async function assessment(input) {
    const scope = portalCbtScope(env, user, { ...input, Audience: 'student' });
    const { context } = await academic(env, user, { ...input, ...scope, AssessmentComponentId: '' });
    return { ok: true, components: context.scheme.Components };
  }
  async function create(input) {
    const audience = input.Audience;
    if (!['applicant', 'student'].includes(audience)) throw fail('Choose applicants or enrolled students.');
    const scope = portalCbtScope(env, user, input);
    const profile = await get(env, 'settings', 'schoolProfile');
    const questions = normalizeQuestions(input.Questions);
    const maximum = Number(questions.reduce((sum, q) => sum + q.MaximumScore, 0).toFixed(4));
    const schedule = normalizeSchedule(input);
    if (Date.parse(schedule.EndsAt) <= clock()) throw fail('Choose a future examination window.');
    let subject, academicFields = null, session = clean(input.AcademicSession), term = clean(input.Term), className = clean(input.ClassName);
    if (audience === 'applicant') {
      subject = normalizeEntranceSubjects(profile?.EntranceExamSubjects).find(row => row.id === input.SubjectId);
      if (!subject || Math.abs(subject.maxScore - maximum) > 0.0001) throw fail('Question marks must add up to the configured entrance-subject maximum.');
      if (!/^\d{4}\/\d{4}$/.test(session) || !['First Term', 'Second Term', 'Third Term'].includes(term) || !className || className.length > 100) throw fail('Choose the admission session, term and applying class.');
    } else {
      const { context, component } = await academic(env, user, { ...scope, ...input, View: 'cbt' });
      if (!component) throw fail('Choose the assessment test type.');
      const part = component.ScoreEntryMode === 'objective-theory' ? clean(input.AssessmentPartId) || 'objective' : '';
      if (part && !['objective', 'theory'].includes(part)) throw fail('Choose Objective or Theory.');
      const expected = Number(part ? (part === 'theory' ? component.TheoryMaximumScore : component.ObjectiveMaximumScore) : component.MaximumScore);
      if (Math.abs(expected - maximum) > 0.0001) throw fail(`Question marks must total ${expected}, the configured ${part ? part + ' ' : ''}maximum.`);
      subject = { id: context.subject.SubjectId, name: context.subject.Name, maxScore: expected };
      session = context.session.Name; term = context.term.Name; className = context.schoolClass.Name;
      academicFields = Object.fromEntries(['SessionId', 'TermId', 'ClassId', 'SubjectId', 'AssessmentComponentId', 'TeacherUsername'].map(key => [key, clean(input[key])]));
      academicFields.TeacherUsername = context.allocation.TeacherUsername;
      academicFields.AssessmentComponentName = component.Name;
      academicFields.ScoreEntryMode = component.ScoreEntryMode;
      if (part) academicFields.AssessmentPartId = part;
    }
    const id = await cbtHash(JSON.stringify([scope, audience, session, term, lower(className), subject.id, academicFields?.AssessmentComponentId || 'entrance', academicFields?.AssessmentPartId || '']));
    const previous = await get(env, CBT.tests, id);
    if (previous && (previous.Status !== 'Draft' || previous.CandidateCount)) throw fail('This examination already has a register. Open it to continue; its paper and existing attempts are preserved.', 409);
    if (previous && input.Revision !== previous.__updateTime) throw fail('Reload the existing draft before replacing its questions.', 409);
    const title = clean(input.Title) || `${className} · ${subject.name} · ${audience === 'applicant' ? 'Entrance exam' : academicFields.AssessmentComponentName}`;
    if (title.length > 180 || clean(input.Instructions).length > 8000) throw fail('The title or instructions are too long.');
    const test = { TestId: id, Scope: scope, Audience: audience, SubjectId: subject.id, SubjectName: subject.name, MaximumScore: maximum,
      Academic: academicFields, AcademicSession: session, Term: term, ClassName: className, Title: title,
      SchoolName: clean(profile?.SchoolName || profile?.Name), Instructions: clean(input.Instructions), Questions: questions,
      ...schedule, Status: 'Draft', CandidateCount: 0, CreatedBy: actorName(user), CreatedAt: iso(clock()), UpdatedAt: iso(clock()) };
    await commit(env, [write(CBT.tests, id, test, previous), audit('SAVE_DRAFT', test)]);
    return { ok: true, TestId: id, message: 'Draft saved. Register candidates and choose their delivery mode before opening the test.' };
  }
  async function details(input) {
    const test = await staffTest(input.TestId);
    const candidates = await rows(CBT.candidates, 'TestId', test.TestId);
    return { ok: true, test: { ...publicTest(test), Academic: test.Academic, Revision: test.__updateTime, Questions: test.Questions },
      candidates: candidates.map(candidateView), available: (test.Status === 'Draft' ? await sources(test) : []).map(row => sourceIdentity(test, row)).map(({ SourcePath, ...row }) => row) };
  }
  async function enroll(input) {
    const test = await staffTest(input.TestId);
    if (test.Status !== 'Draft') throw fail('Register candidates before opening the test.', 409);
    if (!['offline', 'online'].includes(input.Delivery) || (test.Audience === 'student' && input.Delivery !== 'online')) throw fail('Choose a permitted delivery mode. Enrolled students use the existing Local CBT workflow for school-network tests.');
    const refs = [...new Set((input.References || []).map(lower))];
    if (!refs.length || refs.length > 25) throw fail('Register between 1 and 25 candidates in each request.');
    const available = (await sources(test)).map(row => sourceIdentity(test, row));
    const writes = [];
    for (const ref of refs) {
      const matches = available.filter(row => lower(row.Reference) === ref);
      if (matches.length !== 1) throw fail(`The applicant/student ${ref} could not be uniquely verified in this class and period.`, 409);
      const source = matches[0];
      const id = await cbtHash(`${test.TestId}|${ref}`);
      const previous = await get(env, CBT.candidates, id);
      if (previous) {
        if (previous.Delivery !== input.Delivery) throw fail(`${source.Reference} is already assigned to ${previous.Delivery}.`, 409);
        continue;
      }
      const row = { ...source, CandidateId: id, TestId: test.TestId, Scope: test.Scope, Audience: test.Audience, Delivery: input.Delivery,
        LoginId: test.Audience === 'applicant' ? `ENT-${test.TestId.slice(0, 8)}-${source.Reference}` : source.Reference,
        PasswordNonce: token(), Status: 'Ready', CreatedAt: iso(clock()) };
      row.Password = await hashStudentPassword(await passwordFor(row));
      writes.push(write(CBT.candidates, id, row, null));
    }
    await commit(env, [...writes, write(CBT.tests, test.TestId, { ...test, CandidateCount: (test.CandidateCount || 0) + writes.length }, test), audit('REGISTER_CANDIDATES', test)]);
    return { ok: true, added: writes.length };
  }
  async function schedule(input) {
    const test = await staffTest(input.TestId);
    if (test.Status !== 'Draft' || !test.CandidateCount) throw fail('Save a draft and register at least one candidate first.', 409);
    if (Date.parse(test.EndsAt) <= clock()) throw fail('This test window has already ended.');
    await commit(env, [write(CBT.tests, test.TestId, { ...test, Status: 'Scheduled', OpenedBy: actorName(user), OpenedAt: iso(clock()) }, test), audit('OPEN_TEST', test)]);
    return { ok: true, message: 'Test scheduled. Print the access cards or pull the offline package on the CBT server.' };
  }
  async function cards(input) {
    const test = await staffTest(input.TestId);
    const candidates = await rows(CBT.candidates, 'TestId', test.TestId);
    return { ok: true, test: publicTest(test), cards: await Promise.all(candidates.map(async row => ({ ...candidateView(row), Password: await passwordFor(row) }))) };
  }
  async function login(input, oldSession = '') {
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(clean(input.ClientId))) throw fail('This browser could not create an exam session. Enable site storage and reload.');
    const test = await testById(input.TestId);
    if (test.Status !== 'Scheduled') throw fail('This test is not available. Contact the school.', 403);
    const id = await cbtHash(`${test.TestId}|${lower(input.Reference)}`);
    return retry(async () => {
      const row = await get(env, CBT.candidates, id);
      if (!row || row.Delivery !== 'online' || !(await verifyStudentPasswordHash(row.Password, clean(input.Password)))) throw fail('The test reference or examination password is incorrect.', 401);
      const same = oldSession && row.ClientId === input.ClientId && await secureSecretEqual(row.SessionHash, await cbtHash(oldSession));
      if (row.Status === 'In progress' && Date.parse(row.LeaseUntil) > clock() && !same) throw fail('This test is open in another browser. Close it and wait one minute before resuming here.', 409);
      const session = same ? oldSession : token();
      const updated = { ...row, ClientId: input.ClientId, SessionHash: await cbtHash(session), SessionExpiresAt: iso(Math.max(Date.parse(test.EndsAt), clock()) + 12 * 3600000), LeaseUntil: iso(clock() + 60000) };
      await commit(env, [write(CBT.candidates, id, updated, row)]);
      return { ok: true, session, CandidateId: id, attempt: publicAttempt(test, updated, clock()) };
    });
  }
  async function authenticated(input, session) {
    if (!/^[a-f0-9]{64}$/.test(clean(input.CandidateId)) || !session) throw fail('Sign in to the examination again.', 401);
    const row = await get(env, CBT.candidates, input.CandidateId);
    if (!row || row.Delivery !== 'online' || row.ClientId !== input.ClientId || Date.parse(row.SessionExpiresAt) <= clock() || !await secureSecretEqual(row.SessionHash, await cbtHash(session))) throw fail('Sign in to the examination again.', 401);
    return { test: await testById(row.TestId), row };
  }
  async function candidateAction(input, session) {
    return retry(async () => {
      const { test, row } = await authenticated(input, session);
      let next = row;
      if (row.Status === 'In progress' && clock() >= Date.parse(row.ExpiresAt)) next = completeAttempt(test, row, clock());
      else if (input.action === 'start') next = startAttempt(test, row, clock());
      else if (['save', 'submit'].includes(input.action) && row.Status === 'In progress') {
        const version = Number(input.SaveVersion);
        if (!Number.isSafeInteger(version) || version < 1) throw fail('The answer version is invalid.');
        const answers = normalizeAnswers(test, input.Answers);
        const base = input.BaseVersion;
        if (version < (row.SaveVersion || 0) || (version === row.SaveVersion && JSON.stringify(answers) !== JSON.stringify(row.Answers || {}))
          || (version > (row.SaveVersion || 0) && (!Number.isSafeInteger(base) || base !== (row.SaveVersion || 0)))) {
          throw fail('Newer answers were saved in another tab. Close duplicate tabs and reload this test before continuing.', 409);
        }
        if (version > (row.SaveVersion || 0)) next = { ...row, Answers: answers, SaveVersion: version, SavedAt: iso(clock()) };
        // A stale tab cannot submit another tab's newer answer packet.
        if (input.action === 'submit') {
          if (version < row.SaveVersion) throw fail('Newer answers were saved. Reload this test before submitting.', 409);
          next = completeAttempt(test, next, clock());
        }
      } else if (!['session', 'save', 'submit', 'start'].includes(input.action)) throw fail('Choose a valid examination action.');
      // Only active sittings need a browser lease. Finished/ready status reads
      // do not rewrite the candidate, and fresh leases are not written twice.
      if (next.Status === 'In progress' && Date.parse(next.LeaseUntil || '') - clock() < 35000) {
        next = { ...next, LeaseUntil: iso(clock() + 60000) };
      }
      if (next !== row) await commit(env, [write(CBT.candidates, row.CandidateId, next, row)]);
      return { ok: true, attempt: publicAttempt(test, next, clock()) };
    });
  }
  async function review(input) {
    const test = await staffTest(input.TestId);
    let row = await get(env, CBT.candidates, clean(input.CandidateId));
    if (!row || row.TestId !== test.TestId) throw fail('The candidate is not in this test.', 404);
    if (row.Status === 'In progress' && clock() >= Date.parse(row.ExpiresAt)) {
      const next = completeAttempt(test, row, clock());
      await commit(env, [write(CBT.candidates, row.CandidateId, next, row)]);
      row = await get(env, CBT.candidates, row.CandidateId);
    }
    if (!['Submitted', 'Approved'].includes(row.Status)) throw fail('This candidate has not submitted the test.', 409);
    return { ok: true, test: publicTest(test), candidate: { ...candidateView(row), Revision: row.__updateTime }, Questions: test.Questions, Answers: row.Answers || {}, QuestionMarks: row.QuestionMarks || {} };
  }
  async function approve(input) {
    const test = await staffTest(input.TestId);
    const row = await get(env, CBT.candidates, clean(input.CandidateId));
    if (!row || row.TestId !== test.TestId || !['Submitted', 'Approved'].includes(row.Status)) throw fail('Review a submitted candidate first.', 409);
    if (row.Status === 'Approved') return { ok: true, message: 'This result is already approved.' };
    if (input.Revision !== row.__updateTime) throw fail('The result changed. Open its review again.', 409);
    const marked = markAnswers(test, row.Answers || {}, input.Marks || {});
    if (marked.NeedsMarking) throw fail('Mark every written answer before approval.');
    await commit(env, [write(CBT.candidates, row.CandidateId, { ...row, ...marked, Status: 'Approved', ApprovedBy: actorName(user), ApprovedAt: iso(clock()) }, row), audit('APPROVE_RESULT', test, row.Reference)]);
    return { ok: true, message: 'Result approved. Post it to the application or scorebook.' };
  }
  async function post(input) {
    const test = await staffTest(input.TestId);
    const row = await get(env, CBT.candidates, clean(input.CandidateId));
    if (!row || row.TestId !== test.TestId || row.Status !== 'Approved') throw fail('Approve this result before posting.', 409);
    if (test.Audience === 'student') return postStudent(test, row);
    return retry(async () => {
      const current = await get(env, CBT.candidates, row.CandidateId);
      const application = await get(env, current.SourcePath, current.SourceId);
      if (!application || lower(application.ApplicationReference || application.ApplicationID || application.__id) !== lower(current.Reference)) throw fail('The original application cannot be verified. The exam result is retained.', 409);
      const profile = await get(env, 'settings', 'schoolProfile');
      const subjects = entranceSubjectRows(application, profile || {});
      const subject = subjects.find(item => item.id === test.SubjectId);
      if (!subject || Math.abs(subject.maxScore - test.MaximumScore) > 0.0001) throw fail('The application subject maximum changed. The original result is retained for review.', 409);
      const present = subject.score !== '' && subject.score != null;
      const message = present ? 'Already recorded: the existing entrance score was preserved.' : 'Entrance score saved to the application.';
      const writes = [];
      if (!present) {
        const updates = entranceScoreUpdates(application, { EntranceSubjectScores: subjects.map(item => item.id === test.SubjectId ? { ...item, score: current.RawScore } : item) }, profile || {});
        const changed = { ...updates,
          EntranceCbtResults: { ...(application.EntranceCbtResults || {}), [test.SubjectId]: { TestId: test.TestId, CandidateId: current.CandidateId, RawScore: current.RawScore, MaximumScore: test.MaximumScore, SubmittedAt: current.SubmittedAt } } };
        // Field masks leave payments, admission history and custom fields byte-for-
        // byte untouched by the legacy encoder; only entrance result fields change.
        writes.push({ ...write(current.SourcePath, current.SourceId, changed, application), updateMask: Object.keys(changed) });
      }
      writes.push(write(CBT.candidates, current.CandidateId, { ...current, PostedAt: iso(clock()), PostMessage: message }, current), audit('POST_ENTRANCE_RESULT', test, current.Reference));
      await commit(env, writes);
      return { ok: true, message };
    });
  }
  async function postStudent(test, row) {
    // Persist the signed envelope once. A retry uses exactly the same batch,
    // even after another centre or reviewer has updated the scorebook.
    let current = row;
    if (!current.ScoreBatch) {
      const placement = await resolvePlacement(env, user, { ...test.Scope, ...test.Academic, StudentRefs: [row.Reference] });
      const target = placement.scoreUploadPlacements?.find(item => lower(item.StudentRef) === lower(row.Reference));
      if (!target?.Ready) throw fail('The current class placement could not be verified. The approved exam and answers are retained for review.', 409);
      const payload = { Version: 'dynamax-cbt-score-batch-v1', BatchId: `remote-${row.CandidateId}`, ExamId: test.TestId, SourceTestId: '', SourcePackageDigest: '',
        ...test.Academic, ArmId: target.ArmId || '', MaximumScore: test.MaximumScore, SourceType: 'BuiltInCBT', MarkingRevision: 1,
        ApprovalStatus: 'Approved', ApprovedBy: row.ApprovedBy, ApprovedAt: row.ApprovedAt,
        Scores: [{ StudentRef: row.Reference, State: 'Numeric', RawScore: row.RawScore, AttemptId: row.AttemptId, AttemptStatus: 'Submitted', SubmittedAt: row.SubmittedAt }] };
      payload.BatchDigest = await academicCbtScoreBatchDigest(payload);
      const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
      const pub = await crypto.subtle.exportKey('spki', pair.publicKey);
      const raw = btoa(String.fromCharCode(...new Uint8Array(pub)));
      payload.SigningPublicKey = `-----BEGIN PUBLIC KEY-----\n${raw.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
      payload.SigningKeyId = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pub))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
      payload.SignatureAlgorithm = 'RSASSA-PKCS1-v1_5-SHA256';
      payload.Signature = b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(payload.BatchDigest)));
      await retry(async () => {
        current = await get(env, CBT.candidates, row.CandidateId);
        if (!current.ScoreBatch) await commit(env, [write(CBT.candidates, current.CandidateId, { ...current, ScoreBatch: payload }, current)]);
      });
      current = await get(env, CBT.candidates, row.CandidateId);
    }
    const payload = { ...current.ScoreBatch, ...test.Scope, SupportsPreparedScoreCommit: true };
    const result = await sync(env, user, payload);
    const completed = result.commitRequired ? await sync(env, user, { ...payload, ScoreSyncPreparation: result.scoreSyncPreparation }) : result;
    const receipt = completed.scoreSyncReceipt;
    if (!receipt || receipt.VerifiedOnline !== true || !(receipt.VerifiedRows > 0 || receipt.AlreadyRecordedCount > 0)) {
      return { ok: false, message: receipt?.RejectedScores?.[0]?.Reason || 'The scorebook has not confirmed this mark. The approved result remains saved for retry.', receipt };
    }
    await retry(async () => {
      const fresh = await get(env, CBT.candidates, row.CandidateId);
      await commit(env, [write(CBT.candidates, row.CandidateId, { ...fresh, PostedAt: iso(clock()), PostMessage: completed.message, ScoreReceipt: receipt }, fresh)]);
    });
    return { ok: true, message: completed.message, receipt };
  }
  async function offlinePackage(input) {
    const test = await staffTest(input.TestId);
    if (test.Audience !== 'applicant' || test.Status !== 'Scheduled') throw fail('Choose a scheduled entrance exam.', 409);
    const server = clean(input.ServerId);
    if (!/^[a-f0-9]{32,64}$/.test(server)) throw fail('The CBT server identity is required.');
    return retry(async () => {
      const candidates = (await rows(CBT.candidates, 'TestId', test.TestId)).filter(row => row.Delivery === 'offline');
      if (!candidates.length) throw fail('No candidates are assigned to the school network.');
      if (candidates.some(row => row.OfflineServerId && row.OfflineServerId !== server)) throw fail('This entrance exam is already assigned to another CBT server. Use that server or restore its backup.', 409);
      await commit(env, candidates.filter(row => !row.OfflineServerId).map(row => write(CBT.candidates, row.CandidateId, { ...row, OfflineServerId: server }, row)), { allowLargeAtomicBatch: true });
      return { ok: true, package: { Version: 1, TestId: test.TestId, Scope: test.Scope, Title: test.Title, SubjectId: test.SubjectId, SubjectName: test.SubjectName,
        AcademicSession: test.AcademicSession, Term: test.Term, ClassName: test.ClassName, MaximumScore: test.MaximumScore,
        StartsAt: test.StartsAt, EndsAt: test.EndsAt, DurationMinutes: test.DurationMinutes, Instructions: test.Instructions, Questions: test.Questions,
        Candidates: candidates.map(row => ({ CandidateId: row.CandidateId, StudentRef: row.LoginId, Reference: row.Reference, DisplayName: row.DisplayName,
          Identity: { StudentRef: row.LoginId, Password: row.Password } })) } };
    });
  }
  async function offlineResults(input) {
    const test = await staffTest(input.TestId);
    if (test.Audience !== 'applicant') throw fail('Use academic score synchronization for enrolled students.');
    if (!Array.isArray(input.Results) || !input.Results.length || input.Results.length > 25) throw fail('Upload 1 to 25 entrance results per request.');
    const report = [];
    for (const result of input.Results) {
      try {
        await retry(async () => {
          const row = await get(env, CBT.candidates, clean(result.CandidateId));
          if (!row || row.TestId !== test.TestId || row.Delivery !== 'offline' || row.OfflineServerId !== input.ServerId) throw fail('This result belongs to a different exam, candidate or CBT server.', 409);
          if (row.Status !== 'Ready') { report.push({ CandidateId: row.CandidateId, saved: true, alreadyRecorded: true }); return; }
          if (!result.AttemptId || !Number.isFinite(Date.parse(result.SubmittedAt))) throw fail('A completed attempt and submission time are required.');
          const answers = normalizeAnswers(test, result.Answers);
          const marked = markAnswers(test, answers, result.QuestionMarks || {});
          if (marked.NeedsMarking) throw fail('Finish reviewing written answers on the CBT server before upload.');
          await commit(env, [write(CBT.candidates, row.CandidateId, { ...row, ...marked, Answers: answers, AttemptId: result.AttemptId,
            SubmittedAt: result.SubmittedAt, Status: 'Approved', ApprovedBy: actorName(user), ApprovedAt: iso(clock()), OfflineUploadedAt: iso(clock()) }, row), audit('UPLOAD_OFFLINE_RESULT', test, row.Reference)]);
          report.push({ CandidateId: row.CandidateId, saved: true });
        });
      } catch (error) { report.push({ CandidateId: result.CandidateId, saved: false, message: error.message }); }
    }
    return { ok: true, results: report };
  }
  return { state, options, assessment, create, details, enroll, schedule, cards, login, candidateAction, review, approve, post, offlinePackage, offlineResults };
}
