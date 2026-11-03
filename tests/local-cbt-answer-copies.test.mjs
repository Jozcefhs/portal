import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import { localCbtAnswerCopies, answerCopyDigest, ANSWER_COPIES } from '../functions/lib/local-cbt-answer-copies.js';
import { academicCbtScoreBatchDigest } from '../functions/lib/academic-management.js';
import { buildStructuredQuery, objectToFirestoreFields, firestoreDocumentToObject } from '../functions/lib/firestore.js';
import { onRequestPost } from '../functions/api/local-cbt-answers.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyId = createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32);
const actor = { username: 'ict', role: 'ICT', edition: 'school', allowedSections: ['academics'], schoolSectionAccess: 'All', branchId: 'main' };
const scope = { BranchId: 'main', SchoolSection: 'secondary' };
async function fixture() {
  const db = new Map(), reads = [], writes = [], queries = [];
  const env = { ORGANISATION_EDITION: 'school', DYNAMAX_WORKSPACE_ID: 'school', FIREBASE_PROJECT_ID: 'fixture' };
  const batch = { Version: 'dynamax-cbt-score-batch-v1', BatchId: 'batch1', SourceTestId: 'geography', SourceType: 'BuiltInCBT', ApprovalStatus: 'Approved',
    SessionId: 'session', TermId: 'term', ClassId: 'grade12', SubjectId: 'geography', AssessmentComponentId: 'ca1',
    Scores: [{ StudentRef: 'DCA/001', AttemptId: 'attempt1', State: 'Numeric', RawScore: 2 }] };
  batch.BatchDigest = await academicCbtScoreBatchDigest(batch);
  db.set('academicScoreSyncBatches/receipt1', { ...batch, ...scope, ReceiptVersion: 2, SigningKeyId: keyId, RejectedScores: [] });
  db.set('academicCbtTests/geography', { ...batch, ...scope, Title: 'Geography', Status: 'Closed' });
  const dependencies = {
    get: async (_, path, id) => { reads.push(`${path}/${id}`); return structuredClone(db.get(`${path}/${id}`) || null); },
    query: async (_, path, opts) => { buildStructuredQuery(path, opts); queries.push(opts); return [...db.entries()].filter(([key]) => key.startsWith(path + '/')).map(([, value]) => value); },
    commit: async (_, changes) => {
      for (const row of changes) { assert.equal(row.collectionPath, ANSWER_COPIES); assert.equal(row.exists, false); if (db.has(`${row.collectionPath}/${row.documentId}`)) throw Error('Exists'); }
      for (const row of changes) { writes.push(row); db.set(`${row.collectionPath}/${row.documentId}`, firestoreDocumentToObject({ fields: objectToFirestoreFields(row.data) })); }
    }
  };
  const evidence = { Version: 'dynamax-cbt-answer-copy-v1', ...scope, SyncId: 'receipt1', SourceTestId: 'geography', ScoreBatchDigest: batch.BatchDigest,
    Questions: [{ QuestionId: 'Q1', QuestionType: 'single', Ordinal: 1, Prompt: { Text: 'Choose the code' }, Options: [{ Id: '0012', Text: 'Zero zero twelve' }], AnswerKey: '0012', MaximumScore: 2 }],
    Reports: [{ StudentRef: 'DCA/001', DisplayName: 'Learner', AttemptId: 'attempt1', AttemptStatus: 'Submitted', SubmittedAt: '2026-11-03T10:00:00Z', Answers: { Q1: '0012' }, QuestionMarks: { Q1: 2 } }] };
  async function signed(copy = evidence) {
    const digest = await answerCopyDigest(copy);
    return { ...scope, Evidence: copy, ScoreBatch: batch, CopyDigest: digest, SigningKeyId: keyId,
      SigningPublicKey: publicKey.export({ type: 'spki', format: 'pem' }), SignatureAlgorithm: 'RSASSA-PKCS1-v1_5-SHA256', Signature: sign('sha256', Buffer.from(digest), privateKey).toString('base64url') };
  }
  return { db, reads, writes, queries, env, dependencies, evidence, signed, service: localCbtAnswerCopies(env, actor, dependencies) };
}

test('signed answer upload is immutable, exact and independent of closed scores; replay writes nothing', async () => {
  const f = await fixture(), before = structuredClone([...f.db]), payload = await f.signed();
  const saved = await f.service.upload(payload);
  assert.equal(f.writes.length, 1);
  const reads = f.reads.length;
  assert.equal((await f.service.upload(payload)).alreadySaved, true);
  assert.equal(f.reads.length - reads, 1);
  assert.equal(f.writes.length, 1);
  for (const [id, row] of before) assert.deepEqual(f.db.get(id), row);
  const review = await f.service.review({ ...scope, CbtTestId: 'geography', CopyId: saved.answerCopyReceipt.CopyId, AttemptId: 'attempt1' });
  assert.equal(review.Answers.Q1, '0012'); assert.equal(review.Questions[0].Options[0].Id, '0012');
  assert.equal(review.QuestionMarks.Q1, 2); assert.equal(f.writes.length, 1);
  await f.service.list({ ...scope, CbtTestId: 'geography' });
  assert.equal(f.queries[0].limit, 51); assert.ok(!f.queries[0].select.includes('EvidenceJson'));
});
test('tampered answers, mismatched marks, missing receipt and rejected students cannot be uploaded', async () => {
  for (const mode of ['tamper', 'mark', 'receipt', 'rejected']) {
    const f = await fixture(), evidence = structuredClone(f.evidence);
    if (mode === 'mark') evidence.Reports[0].QuestionMarks.Q1 = 0;
    const body = await f.signed(evidence);
    if (mode === 'tamper') body.Evidence.Reports[0].Answers.Q1 = 'wrong';
    if (mode === 'receipt') f.db.delete('academicScoreSyncBatches/receipt1');
    if (mode === 'rejected') f.db.get('academicScoreSyncBatches/receipt1').RejectedScores = [{ StudentRef: 'DCA/001' }];
    await assert.rejects(() => f.service.upload(body)); assert.equal(f.writes.length, 0);
  }
});
test('branch, school section, role and wrong-source review are enforced without returning answers', async () => {
  const f = await fixture(), body = await f.signed(), saved = await f.service.upload(body);
  const input = { ...scope, CbtTestId: 'geography', CopyId: saved.answerCopyReceipt.CopyId, AttemptId: 'attempt1' };
  await assert.rejects(() => f.service.review({ ...input, CbtTestId: 'other' }));
  await assert.rejects(() => f.service.review({ ...input, SchoolSection: 'primary' }));
  await assert.rejects(() => localCbtAnswerCopies(f.env, { ...actor, role: 'Parent' }, f.dependencies).review(input));
  await assert.rejects(() => localCbtAnswerCopies(f.env, { ...actor, branchId: 'other' }, f.dependencies).review(input));
  assert.equal(f.writes.length, 1);
});
test('concurrent retries create only one answer copy', async () => {
  const f = await fixture(), body = await f.signed();
  const results = await Promise.all([f.service.upload(body), f.service.upload(body)]);
  assert.equal(f.writes.length, 1); assert.equal(results.filter(r => r.alreadySaved).length, 1);
});
test('unauthenticated public requests cannot read local answers', async () => {
  const response = await onRequestPost({ request: new Request('https://school.example/api/local-cbt-answers', { method: 'POST', body: JSON.stringify({ action: 'list', ...scope, CbtTestId: 'geography' }) }), env: {} });
  assert.notEqual(response.status, 200); assert.equal((await response.json()).ok, false);
});
