import test from 'node:test';
import assert from 'node:assert/strict';
import { CBT, createPortalCbtService, portalCbtScope, cbtHash, encodeExamRecord, decodeExamRecord } from '../functions/lib/portal-cbt.js';
import { normalizeQuestions, normalizeAnswers, markAnswers } from '../functions/lib/portal-cbt-model.js';
import { objectToFirestoreFields, firestoreDocumentToObject, buildStructuredQuery } from '../functions/lib/firestore.js';
import { verifyAcademicCbtScoreSignature, academicCbtScoreBatchDigest } from '../functions/lib/academic-management.js';
import { onRequestPost as publicApi } from '../functions/api/portal-cbt.js';

const actor = { username: 'reviewer', role: 'ICT', edition: 'school', allowedSections: ['academics', 'applications'], schoolSectionAccess: 'All' };
const scope = { Audience: 'applicant', BranchId: 'main', SchoolSection: 'secondary' };
const source = 'schoolBranches/main/sections/secondary/applications';
const client = 'browser_tab_123456789';
const questions = [
  { Prompt: '2 + 2?', Options: ['3', '4'], AnswerKey: 'B', MaximumScore: 60 },
  { Prompt: 'Explain your answer.', QuestionType: 'extended', MaximumScore: 40 }
];

function fixture(overrides = {}) {
  let revision = 0, now = Date.parse('2026-10-24T09:00:00Z');
  const db = new Map(), events = [];
  const env = { ORGANISATION_EDITION: 'school', DYNAMAX_WORKSPACE_ID: 'school-a', STAFF_SESSION_SECRET: 'fixture-secret-never-for-production' };
  const objects = new Map();
  env.DYNAMAX_DOCUMENTS = { put: async (key, bytes) => { objects.set(key, bytes.slice()); return { etag: 'test' }; }, get: async key => objects.has(key) ? { arrayBuffer: async () => objects.get(key).buffer } : null };
  const put = (path, id, data) => {
    const row = firestoreDocumentToObject({ fields: objectToFirestoreFields(data), name: `${path}/${id}`, updateTime: `r${++revision}` });
    db.set(`${path}/${id}`, row); return row;
  };
  const get = async (_env, path, id) => structuredClone(db.get(`${path}/${id}`) || null);
  const list = path => [...db.entries()].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(([, row]) => structuredClone(row));
  const query = async (_env, path, opts) => {
    buildStructuredQuery(path, opts); // Validate production operator syntax too.
    return list(path).filter(row => opts.filters.every(filter => filter.field.split('.').reduce((value, key) => value?.[key], row) === filter.value));
  };
  let conflictNext = false;
  const commit = async (_env, writes) => {
    if (conflictNext) { conflictNext = false; throw Object.assign(new Error('Retry conflict'), { status: 409 }); }
    for (const write of writes) {
      const old = db.get(`${write.collectionPath}/${write.documentId}`);
      if ((write.exists === false && old) || (write.updateTime && write.updateTime !== old?.__updateTime)) throw Object.assign(new Error('Write conflict'), { status: 409 });
      assert.ok(write.exists === false || write.updateTime, 'Every mutation must be conditional');
    }
    writes.forEach(write => {
      const key = `${write.collectionPath}/${write.documentId}`, previous = db.get(key);
      events.push(structuredClone(write)); put(write.collectionPath, write.documentId, write.data);
      if (write.updateMask) db.set(key, { ...previous, ...db.get(key) });
    });
  };
  put('settings', 'schoolProfile', { SchoolName: 'Fixture School', EntranceExamSubjects: [{ id: 'logic', name: 'Logic', maxScore: 100 }] });
  put(source, 'app-1', { ApplicationReference: 'APP/001', ApplicantName: 'Candidate One', AcademicSession: '2026/2027', Term: 'First Term', ClassApplyingFor: 'Grade 7', BranchId: 'main', SchoolSection: 'secondary', PaymentRef: 'keep-payment', AdmissionHistory: 'keep-history' });
  put(source, 'app-2', { ApplicationReference: 'APP/002', ApplicantName: 'Candidate Two', AcademicSession: '2026/2027', Term: 'First Term', ClassApplyingFor: 'Grade 7', BranchId: 'main', SchoolSection: 'secondary' });
  const dependencies = { get, query, commit, now: () => now,
    schoolRows: async (_env, collection) => list(collection === 'applications' ? source : 'students').map(row => ({ ...row, __scopePath: collection === 'applications' ? source : 'students' })), ...overrides };
  const service = createPortalCbtService(env, actor, dependencies);
  const publicService = createPortalCbtService(env, null, dependencies);
  const create = extra => service.create({ ...scope, AcademicSession: '2026/2027', Term: 'First Term', ClassName: 'Grade 7', SubjectId: 'logic', Questions: questions,
    StartsAt: '2026-10-24T09:00:00Z', EndsAt: '2026-10-24T10:00:00Z', DurationMinutes: 30, ...extra });
  async function ready(delivery = 'online') {
    const created = await create();
    await service.enroll({ TestId: created.TestId, References: ['APP/001', 'APP/002'], Delivery: delivery });
    const cards = await service.cards(created);
    await service.schedule(created);
    return { ...created, card: cards.cards[0], cards: cards.cards };
  }
  async function login(ready, extra = {}) { return publicService.login({ TestId: ready.TestId, Reference: ready.card.Reference, Password: ready.card.Password, ClientId: client, ...extra }); }
  async function action(login, action, extra = {}) {
    const result = await publicService.candidateAction({ CandidateId: login.CandidateId, ClientId: client, action, BaseVersion: login.savedVersion || 0, ...extra }, login.session);
    login.savedVersion = result.attempt.SaveVersion;
    return result;
  }
  return { service, publicService, env, db, objects, events, put, get, create, ready, login, action, dependencies,
    conflict: () => { conflictNext = true; }, advance: milliseconds => { now += milliseconds; }, now: () => now };
}

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLCkAAAAASUVORK5CYII=';
const paperInput = () => ({ ContentMode: 'document', MaximumScore: 100, NumberOfQuestions: 2, OptionCount: 4, AnswerKey: 'B, D',
  Paper: { PreviewConfirmed: true, Source: { FileName: 'mathematics.pdf', FileBase64: btoa('%PDF-1.7 synthetic') }, Pages: [{ FileName: 'page-1.png', FileBase64: tinyPng }] } });

test('document papers stay private until an active sitting and offline receives the same verified pages', async () => {
  const f = fixture(), created = await f.create(paperInput());
  await f.service.enroll({ ...created, References: ['APP/001'], Delivery: 'online' });
  await f.service.enroll({ ...created, References: ['APP/002'], Delivery: 'offline' });
  await f.service.schedule(created);
  const cards = (await f.service.cards(created)).cards;
  const ready = { ...created, card: cards.find(row => row.Delivery === 'online') }, login = await f.login(ready);
  const request = { CandidateId: login.CandidateId, ClientId: client, PageIndex: 0 };
  await assert.rejects(f.publicService.paperPage(request, login.session), /Start the examination/);
  await f.action(login, 'start');
  assert.equal((await f.publicService.paperPage(request, login.session)).page.FileBase64, tinyPng);
  await assert.rejects(f.publicService.paperPage(request, 'wrong-cookie'));
  await assert.rejects(f.publicService.paperPage({ ...request, PageIndex: 99 }, login.session));
  const state = await f.service.state(scope), details = await f.service.details(created);
  assert.ok(!JSON.stringify([state, details]).includes('private-portal-cbt'));
  const packet = (await f.service.offlinePackage({ ...created, ServerId: 'a'.repeat(64) })).package;
  assert.equal(packet.ContentMode, 'document'); assert.equal(packet.PaperPages[0].FileBase64, tinyPng);
  await f.action(login, 'submit', { SaveVersion: 1, Answers: { Q1: 'B', Q2: 'D' } });
  await assert.rejects(f.publicService.paperPage(request, login.session), /Start the examination/);
  assert.equal((await f.service.review({ ...created, CandidateId: login.CandidateId })).candidate.RawScore, 100);
  const before = f.objects.size;
  await assert.rejects(f.create(paperInput()), /already has a register/); assert.equal(f.objects.size, before);
});

test('document validation rejects missing previews, answer keys, wrong types and damaged pages without a saved test', async () => {
  for (const change of [p => p.Paper.PreviewConfirmed = false, p => p.AnswerKey = 'B', p => p.Paper.Source.FileName = 'bad.exe',
    p => p.Paper.Pages = [], p => p.Paper.Pages[0].FileBase64 = btoa('not png'), p => p.MaximumScore = 50]) {
    const f = fixture(), input = paperInput(); change(input);
    await assert.rejects(f.create(input)); assert.equal((await f.service.state(scope)).tests.length, 0);
  }
  const f = fixture(), input = paperInput(); input.Paper.Source = { FileName: 'paper.docx', FileBase64: btoa('PK\x03\x04fixture') };
  const created = await f.create(input);
  const details = await f.service.details(created);
  assert.equal(details.test.Paper.FileName, 'paper.docx');
  const pageKey = [...f.objects.keys()].find(key => key.includes('/page-'));
  f.objects.set(pageKey, new TextEncoder().encode('damaged'));
  await assert.rejects(f.service.paperPage({ ...created, PageIndex: 0 }), /integrity/);
});

test('school-specific subjects and role, branch and section isolation are enforced', async () => {
  const f = fixture(); const state = await f.service.state(scope);
  assert.deepEqual(state.subjects.map(row => row.name), ['Logic']);
  for (const user of [{ ...actor, branchId: 'other' }, { ...actor, schoolSectionAccess: 'Primary' }, { ...actor, role: 'Accounts Officer' }, { ...actor, subscriptionActive: false }]) {
    assert.throws(() => portalCbtScope(f.env, user, scope));
  }
  await assert.rejects(f.create({ SubjectId: 'english' }), /configured entrance/);
  assert.equal(portalCbtScope(f.env, { ...actor, role: 'Admissions Officer', allowedSections: ['admissions'] }, scope).BranchId, 'main');
});

test('ready/finished status reads and fresh active leases do not cause unnecessary writes', async () => {
  const f = fixture(), ready = await f.ready(), login = await f.login(ready);
  const count = f.events.length;
  await f.action(login, 'session'); assert.equal(f.events.length, count);
  await f.action(login, 'start'); const started = f.events.length;
  await f.action(login, 'session'); assert.equal(f.events.length, started);
  f.advance(30000); await f.action(login, 'session'); assert.ok(f.events.length > started);
  await f.action(login, 'submit', { SaveVersion: 1, Answers: {} });
  const submitted = f.events.length;
  await f.action(login, 'session'); await f.action(login, 'session');
  assert.equal(f.events.length, submitted);
});

test('published tests freeze questions and candidate list; duplicate subject tests cannot replace attempts', async () => {
  const f = fixture(), ready = await f.ready();
  await assert.rejects(f.create(), /already has a register/);
  await assert.rejects(f.service.enroll({ ...ready, References: ['APP/002'], Delivery: 'online' }), /before opening/);
  assert.equal((await f.service.details(ready)).candidates.length, 2);
});

test('register is idempotent and does not change a previously assigned delivery mode', async () => {
  const f = fixture(), created = await f.create();
  await f.service.enroll({ ...created, References: ['APP/001'], Delivery: 'offline' });
  const replay = await f.service.enroll({ ...created, References: ['APP/001'], Delivery: 'offline' }); assert.equal(replay.added, 0);
  await assert.rejects(f.service.enroll({ ...created, References: ['APP/001'], Delivery: 'online' }), /already assigned/);
  await assert.rejects(f.service.enroll({ ...created, References: ['not-in-class'], Delivery: 'online' }), /uniquely verified/);
});

test('before start no questions or answer keys leak; only assigned online candidates can authenticate', async () => {
  const f = fixture(), ready = await f.ready();
  await assert.rejects(f.login(ready, { Password: 'wrong-password' }), /incorrect/);
  const login = await f.login(ready);
  assert.deepEqual(login.attempt.Questions, []);
  assert.equal(JSON.stringify(login).includes('AnswerKey'), false);
  const started = await f.action(login, 'start');
  assert.equal(started.attempt.Questions.length, 2);
  assert.equal(JSON.stringify(started).includes('AnswerKey'), false);
  const offline = fixture(), offReady = await offline.ready('offline');
  await assert.rejects(offline.login(offReady), /incorrect/);
});

test('answers preserve text, leading zeros and whitespace through the real database encoder', async () => {
  const f = fixture(), ready = await f.ready(), login = await f.login(ready);
  await f.action(login, 'start');
  await f.action(login, 'save', { SaveVersion: 1, Answers: { Q1: 'B', Q2: ' 0012\n' } });
  const resumed = await f.action(login, 'session');
  assert.equal(resumed.attempt.Answers.Q2, ' 0012\n');
  assert.equal(resumed.attempt.Questions[0].Options[0].Text, '3');
  const encoded = encodeExamRecord({ Answers: { Q1: '0012' } });
  assert.deepEqual(decodeExamRecord(encoded).Answers, { Q1: '0012' });
});

test('server timer cannot be reset by start/resume, and late answer packets are never accepted', async () => {
  const f = fixture(), ready = await f.ready(), login = await f.login(ready);
  const started = await f.action(login, 'start');
  f.advance(60000);
  const resumed = await f.action(login, 'start'); assert.equal(resumed.attempt.ExpiresAt, started.attempt.ExpiresAt);
  await f.action(login, 'save', { SaveVersion: 1, Answers: { Q1: 'B' } });
  f.advance(30 * 60000);
  const ended = await f.action(login, 'submit', { SaveVersion: 2, Answers: { Q1: 'A', Q2: 'too late' } });
  assert.equal(ended.attempt.Status, 'Submitted');
  const review = await f.service.review({ ...ready, CandidateId: login.CandidateId });
  assert.deepEqual(review.Answers, { Q1: 'B' }); assert.equal(review.candidate.RawScore, 60);
});

test('schedule opening and closing are enforced on the server', async () => {
  const f = fixture(); const ready = await f.ready(); const login = await f.login(ready);
  f.advance(-60000); await assert.rejects(f.action(login, 'start'), /not started/);
  f.advance(62 * 60000); await assert.rejects(f.action(login, 'start'), /window has closed/);
});

test('stale versions and conflicting tabs cannot replace or submit newer answers', async () => {
  const f = fixture(), ready = await f.ready(), login = await f.login(ready);
  await f.action(login, 'start');
  await f.action(login, 'save', { SaveVersion: 2, Answers: { Q1: 'B' } });
  await assert.rejects(f.action(login, 'save', { SaveVersion: 1, Answers: { Q1: 'A' } }), /Newer answers/);
  await assert.rejects(f.action(login, 'save', { SaveVersion: 2, Answers: { Q1: 'A' } }), /Newer answers/);
  await assert.rejects(f.action(login, 'save', { BaseVersion: 0, SaveVersion: 99, Answers: { Q1: 'A' } }), /Newer answers/);
  await assert.rejects(f.action(login, 'submit', { BaseVersion: 0, SaveVersion: 99, Answers: { Q1: 'A' } }), /Newer answers/);
  await f.action(login, 'save', { BaseVersion: 0, SaveVersion: 2, Answers: { Q1: 'B' } }); // Safe exact replay after a lost response.
  await assert.rejects(f.action(login, 'submit', { SaveVersion: 1, Answers: { Q1: 'A' } }), /Newer answers/);
  await assert.rejects(f.publicService.candidateAction({ CandidateId: login.CandidateId, ClientId: 'wrong-tab', action: 'session' }, login.session), /Sign in/);
  await assert.rejects(f.login(ready, { ClientId: 'different_tab_123456' }), /another browser/);
  assert.equal((await f.action(login, 'session')).attempt.Answers.Q1, 'B');
});

test('cross-candidate cookies and other-school test IDs cannot read any answers', async () => {
  const f = fixture(), ready = await f.ready(), login = await f.login(ready);
  await assert.rejects(f.action({ ...login, CandidateId: ready.cards[1].CandidateId }, 'session'), /Sign in/);
  const other = createPortalCbtService({ ...f.env, DYNAMAX_WORKSPACE_ID: 'school-b' }, null, f.dependencies);
  await assert.rejects(other.login({ ...ready, Reference: ready.card.Reference, Password: ready.card.Password, ClientId: client }), /not available/);
});

test('submission is idempotent, written answers need review, then only the application receives the score', async () => {
  const f = fixture(), ready = await f.ready(), login = await f.login(ready);
  await f.action(login, 'start');
  await f.action(login, 'submit', { SaveVersion: 1, Answers: { Q1: 'B', Q2: 'Because 2 pairs have 4 items.' }, RawScore: 10000 });
  await f.action(login, 'submit', { SaveVersion: 2, Answers: { Q1: 'A' } });
  const review = await f.service.review({ ...ready, CandidateId: login.CandidateId });
  assert.equal(review.candidate.NeedsMarking, true);
  await assert.rejects(f.service.approve({ ...ready, CandidateId: login.CandidateId, Revision: review.candidate.Revision, Marks: {} }), /Mark every/);
  await f.service.approve({ ...ready, CandidateId: login.CandidateId, Revision: review.candidate.Revision, Marks: { Q2: 30 } });
  f.db.get(`${source}/app-1`).CustomOriginalText = ' 0012\n';
  f.conflict(); const posted = await f.service.post({ ...ready, CandidateId: login.CandidateId }); assert.equal(posted.ok, true);
  const app = await f.get(null, source, 'app-1');
  assert.equal(app.EntranceSubjectScores[0].score, 90); assert.equal(app.PaymentRef, 'keep-payment'); assert.equal(app.AdmissionHistory, 'keep-history');
  assert.equal(app.CustomOriginalText, ' 0012\n');
  const applicationWrite = f.events.find(write => write.collectionPath === source);
  assert.ok(applicationWrite.updateMask.includes('EntranceSubjectScores'));
  assert.equal(Object.hasOwn(applicationWrite.data, 'PaymentRef'), false);
  assert.equal([...f.db.keys()].some(key => key.startsWith('academicStudentScores/')), false);
  const repeat = await f.service.post({ ...ready, CandidateId: login.CandidateId }); assert.match(repeat.message, /Already recorded/);
});

test('an existing entrance score including zero is always preserved', async () => {
  const f = fixture(), ready = await f.ready(), login = await f.login(ready);
  await f.action(login, 'start'); await f.action(login, 'submit', { SaveVersion: 1, Answers: { Q1: 'B' } });
  const r = await f.service.review({ ...ready, CandidateId: login.CandidateId });
  await f.service.approve({ ...ready, CandidateId: login.CandidateId, Revision: r.candidate.Revision });
  f.put(source, 'app-1', { ...await f.get(null, source, 'app-1'), EntranceSubjectScores: [{ id: 'logic', name: 'Logic', maxScore: 100, score: 0 }] });
  const result = await f.service.post({ ...ready, CandidateId: login.CandidateId }); assert.match(result.message, /preserved/);
  assert.equal((await f.get(null, source, 'app-1')).EntranceSubjectScores[0].score, 0);
});

test('offline package is reserved to one server; uploads are isolated per applicant and safe to retry', async () => {
  const f = fixture(), ready = await f.ready('offline'), server = 'a'.repeat(32);
  const packet = await f.service.offlinePackage({ ...ready, ServerId: server }); assert.equal(packet.package.Candidates.length, 2);
  assert.ok(packet.package.Candidates.every(row => row.StudentRef.startsWith('ENT-') && row.Identity.Password.PasswordHash));
  await assert.rejects(f.service.offlinePackage({ ...ready, ServerId: 'b'.repeat(32) }), /another CBT server/);
  const result = { CandidateId: ready.card.CandidateId, AttemptId: 'local-attempt', SubmittedAt: '2026-10-24T09:10:00Z', Answers: { Q1: 'B' } };
  const response = await f.service.offlineResults({ ...ready, ServerId: server, Results: [result, { ...result, CandidateId: 'wrong' }] });
  assert.equal(response.results[0].saved, true); assert.equal(response.results[1].saved, false);
  const replay = await f.service.offlineResults({ ...ready, ServerId: server, Results: [{ ...result, Answers: { Q1: 'A' } }] });
  assert.equal(replay.results[0].alreadyRecorded, true);
  assert.equal((await f.service.review({ ...ready, CandidateId: ready.card.CandidateId })).Answers.Q1, 'B');
});

test('remote student results use the verified academic commit flow and a stable signed batch', async () => {
  const calls = [];
  const academic = async () => ({ component: { Id: 'ca1', Name: 'CA1', MaximumScore: 100, SourceMode: 'built-in-cbt' }, context: {
    subject: { SubjectId: 'logic', Name: 'Logic' }, schoolClass: { Name: 'Grade 7' }, session: { Name: '2026/2027' }, term: { Name: 'First Term' }, allocation: { TeacherUsername: 'teacher' }, roster: [{ StudentRef: 'ST/001' }]
  } });
  const f = fixture({ academic, resolvePlacement: async (_env, _actor, input) => ({ scoreUploadPlacements: input.StudentRefs.map(StudentRef => ({ StudentRef, Ready: true, ArmId: 'merit' })) }), sync: async (_env, _actor, payload) => {
    calls.push(payload); assert.equal(await academicCbtScoreBatchDigest(payload), payload.BatchDigest); await verifyAcademicCbtScoreSignature(payload);
    return payload.ScoreSyncPreparation ? { ok: true, message: 'Verified online', scoreSyncReceipt: { VerifiedOnline: true, ImportedRows: 1, VerifiedRows: 1 } } : { commitRequired: true, scoreSyncPreparation: { test: true } };
  } });
  f.put('students', 'student1', { AdmissionNo: 'ST/001', StudentName: 'Student One' });
  const ready = await f.create({ Audience: 'student', SessionId: 'session', TermId: 'term', ClassId: 'class7', SubjectId: 'logic', AssessmentComponentId: 'ca1' });
  await f.service.enroll({ ...ready, References: ['ST/001'], Delivery: 'online' });
  ready.card = (await f.service.cards(ready)).cards[0]; await f.service.schedule(ready);
  const login = await f.login(ready); await f.action(login, 'start'); await f.action(login, 'submit', { SaveVersion: 1, Answers: { Q1: 'B' } });
  const review = await f.service.review({ ...ready, CandidateId: login.CandidateId });
  await f.service.approve({ ...ready, CandidateId: login.CandidateId, Revision: review.candidate.Revision });
  await f.service.post({ ...ready, CandidateId: login.CandidateId }); await f.service.post({ ...ready, CandidateId: login.CandidateId });
  assert.equal(calls.length, 4); assert.equal(calls[0].BatchDigest, calls[2].BatchDigest); assert.equal(calls[0].Scores[0].RawScore, 60);
  assert.equal(calls[0].ArmId, 'merit', 'Remote results use the verified current classroom instead of an unnecessary class-only holding sheet');
  assert.equal((await f.get(null, source, 'app-1')).EntranceSubjectScores, undefined);
});

test('validation rejects unknown questions, malformed marks and oversized answer packets', () => {
  const q = normalizeQuestions(questions), paper = { Questions: q };
  assert.throws(() => normalizeAnswers(paper, { unknown: 'B' }));
  assert.throws(() => normalizeAnswers(paper, { Q1: 'Z' }));
  assert.throws(() => normalizeAnswers(paper, { Q2: 'x'.repeat(12001) }));
  assert.throws(() => markAnswers(paper, { Q2: 'some answer' }, { Q2: 100 }));
  assert.throws(() => normalizeQuestions([{ ...questions[0], AnswerKey: 'F' }]));
});

test('public API denies cross-site requests before reading credentials or accessing the database', async () => {
  const response = await publicApi({ env: {}, request: new Request('https://school.test/api/portal-cbt', { method: 'POST', headers: { Origin: 'https://other.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'login' }) }) });
  assert.equal(response.status, 403); assert.match(response.headers.get('Cache-Control'), /no-store/);
});
