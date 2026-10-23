import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeSubmissionRules, applicableSubmissionRule, submissionSettings, commitAcademicSubmission,
  initializeSubmissionPayment, verifySubmissionPayment, submissionPaymentAction, SUBMISSION_COLLECTIONS as C } from '../functions/lib/academic-submissions.js';
import { deadlineButtonLabel } from '../js/academic-submissions.js';
import { buildStructuredQuery } from '../functions/lib/firestore.js';
globalThis.crypto ||= webcrypto;
const context = { scope: { branchId: 'main', section: 'secondary' }, session: { SessionId: '2026' }, term: { TermId: 'first' }, permissions: { canReviewScores: true } };
const user = { username: 'teacher' };
const rule = { RecordType: 'scorebook', Enabled: true, Deadline: '2026-10-01T09:00:00+01:00', AmountKobo: 250000 };
function fixture() {
  const docs = new Map(), commits = [], calls = [];
  docs.set('academicSessions/2026', { SessionId: '2026', Status: 'Active' });
  docs.set('academicTerms/first', { TermId: 'first', SessionId: '2026', Status: 'Active' });
  let revision = 0, payment = { status: 'pending' }, account = { Email: 'teacher@example.test', Active: true };
  const env = { PAYSTACK_SECRET_KEY: 'sk_test_fixture' };
  const io = {
    getDocument: async (_env, col, id) => structuredClone(docs.get(`${col}/${id}`) || null),
    queryCollection: async (_env, col, options) => {
      buildStructuredQuery(col, options);
      return [...docs.entries()].filter(([key]) => key.startsWith(`${col}/`)).map(([, row]) => structuredClone(row));
    },
    findStaffUserRecord: async () => account,
    staffAccessFor: async () => ({ allowedSections: ['academics'], subscriptionActive: true }),
    batchCommitDocuments: async (_env, writes) => {
      for (const write of writes) {
        const previous = docs.get(`${write.collectionPath}/${write.documentId}`);
        if ((write.exists === false && previous) || (write.updateTime && previous?.__updateTime !== write.updateTime)) throw Object.assign(new Error('conflict'), { status: 409 });
      }
      commits.push(structuredClone(writes));
      writes.forEach(write => docs.set(`${write.collectionPath}/${write.documentId}`, { ...structuredClone(write.data), __updateTime: `r${++revision}` }));
      return { writeResults: writes.map(() => ({ updateTime: `r${revision}` })) };
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ status: true, data: url.endsWith('initialize') ? { authorization_url: 'https://checkout.paystack.com/test' } : payment });
    }
  };
  const reserve = async (type = 'scorebook', writes = [{ collectionPath: 'academicScoreSheets', documentId: 'sheet', exists: false, data: { Status: 'Submitted', Score: 75 } }]) => {
    try { await commitAcademicSubmission(env, context, user, {}, type, writes, io); assert.fail('Expected payment required'); }
    catch (error) { assert.equal(error.code, 'ACADEMIC_SURCHARGE_REQUIRED'); return io.getDocument(env, C.pending, error.submission.Reference); }
  };
  return { env, io, docs, commits, calls, reserve, setAccount: value => { account = value; },
    setPaid: (pending, extra = {}) => { payment = { status: 'success', reference: pending.Reference, amount: pending.AmountKobo, currency: 'NGN', domain: 'test', id: 123, paid_at: '2026-10-22T03:00:00Z', ...extra }; },
    enable: (Rules = [rule]) => submissionSettings(env, context, user, { Enabled: true, Rules }, true, io) };
}

test('deadline settings require management, preserve history, and reject stale saves', async () => {
  const f = fixture();
  assert.equal((await submissionSettings(f.env, context, user, {}, false, f.io)).settings.Enabled, false);
  await assert.rejects(submissionSettings(f.env, { ...context, permissions: {} }, user, { Enabled: true, Rules: [rule] }, true, f.io), /Only authorised/);
  const saved = await f.enable();
  assert.equal(saved.settings.Rules[0].Deadline, '2026-10-01T08:00:00.000Z');
  await assert.rejects(f.enable(), /changed/);
  assert.equal([...f.docs.keys()].filter(key => key.startsWith(C.history)).length, 1);
});

test('settings return active scoped catalog choices independently of the open workspace', async () => {
  const f = fixture();
  const scoped = { ...context, state: {
    classes: [{ ClassId: 'g7', Name: 'Grade 7' }],
    subjects: [{ SubjectId: 'math', Name: 'Mathematics' }, { SubjectId: 'old', Name: 'Old', Status: 'Archived' }]
  } };
  const result = await submissionSettings(f.env, scoped, user, { IncludeChoices: true }, false, f.io);
  assert.deepEqual(result.subjects, [{ SubjectId: 'math', Name: 'Mathematics' }]);
  assert.deepEqual(result.classes, [{ ClassId: 'g7', Name: 'Grade 7' }]);
  assert.equal((await submissionSettings(f.env, scoped, user, {}, false, f.io)).subjects, undefined);
});

test('payment register uses a supported database query for managers and teachers', async () => {
  const f = fixture();
  for (const canReviewScores of [true, false]) {
    const result = await submissionPaymentAction(f.env, { ...context, permissions: { canReviewScores } }, user, {}, 'listacademicsubmissions', f.io);
    assert.deepEqual(result.submissions, []);
  }
});
test('amount, timezone, duplicate selectors and record types are validated', () => {
  for (const invalid of [{ AmountKobo: 0 }, { AmountKobo: 1.5 }, { AmountKobo: Infinity }, { Deadline: '2026-10-01T09:00' }, { RecordType: 'unknown' }, { Week: '54' }]) {
    assert.throws(() => normalizeSubmissionRules([{ ...rule, ...invalid }]));
  }
  assert.throws(() => normalizeSubmissionRules([rule, rule]), /repeat/);
  assert.throws(() => normalizeSubmissionRules([{ ...rule, ClassId: 'g7' }, { ...rule, SubjectId: 'math' }]), /overlap/);
  assert.throws(() => normalizeSubmissionRules([{ ...rule, Week: '1' }]), /Week filters/);
  assert.throws(() => normalizeSubmissionRules([{ ...rule, AssessmentComponentId: 'ca1' }]), /Test component/);
  assert.throws(() => normalizeSubmissionRules([{ ...rule, RecordType: 'diary', SubjectId: 'math' }]), /all subjects/);
});
for (const ArmId of ['a', '']) test(`concurrent subject work is merged without overwriting or charging again (${ArmId ? 'legacy arm' : 'class-wide'} diary)`, async () => {
  const f = fixture(); await f.enable([{ ...rule, RecordType: 'diary-entry' }]);
  const base = { BranchId: 'main', SchoolSection: 'secondary', SessionId: '2026', TermId: 'first',
    ClassId: 'g7', ArmId, Week: 1, WeekEnding: '2026-10-23', Status: 'Draft', Version: 0, Entries: [] };
  const next = { ...base, Version: 1, Entries: [{ SubjectId: 'math', Status: 'Submitted', WorkCompleted: 'Fractions' }] };
  let pending;
  try { await commitAcademicSubmission(f.env, context, user, { SubjectId: 'math', ClassId: 'g7', Week: 1 }, 'diary-entry', [
    { collectionPath: 'academicWeeklyDiaries', documentId: 'week', exists: false, data: next },
    { collectionPath: 'academicDiaryHistory', documentId: 'week-1', exists: false, data: { Previous: {}, Current: next } }
  ], f.io); } catch (error) { pending = await f.io.getDocument(f.env, C.pending, error.submission.Reference); }
  const english = { SubjectId: 'english', Status: 'Submitted', WorkCompleted: 'Grammar' };
  f.docs.set('academicWeeklyDiaries/week', { ...base, Version: 1, Entries: [english], __updateTime: 'english-v1' });
  f.docs.set('academicDiaryHistory/week-1', { Current: { ...base, Entries: [english] } });
  f.setPaid(pending);
  assert.equal((await verifySubmissionPayment(f.env, pending.Reference, f.io)).submission.Status, 'Submitted');
  const saved = f.docs.get('academicWeeklyDiaries/week');
  assert.equal(saved.Version, 2);
  assert.deepEqual(saved.Entries.find(row => row.SubjectId === 'english'), english);
  assert.equal(saved.Entries.find(row => row.SubjectId === 'math').WorkCompleted, 'Fractions');
  assert.ok(f.docs.has('academicDiaryHistory/week-2'));
});
test('deadline boundary uses server time, disabled rules do not charge, most specific rule wins', () => {
  const settings = { Enabled: true, Rules: normalizeSubmissionRules([rule, { ...rule, ClassId: 'g7', AmountKobo: 10000 }]) };
  assert.equal(applicableSubmissionRule(settings, 'scorebook', {}, Date.parse(rule.Deadline)), null);
  assert.equal(applicableSubmissionRule(settings, 'scorebook', { ClassId: 'g7' }, Date.parse(rule.Deadline) + 1).AmountKobo, 10000);
  assert.equal(applicableSubmissionRule({ ...settings, Enabled: false }, 'scorebook', {}), null);
  assert.equal(deadlineButtonLabel(settings, 'scorebook', { ClassId: 'g7' }, 'Submit', Date.parse(rule.Deadline) + 1), 'Pay charges — NGN 100.00');
  assert.equal(deadlineButtonLabel(settings, 'diary', {}, 'Submit'), 'Submit');
});
test('on-time and disabled submissions commit normally without payment intents', async () => {
  const f = fixture(), writes = [{ collectionPath: 'records', documentId: 'x', exists: false, data: { value: 1 } }];
  await commitAcademicSubmission(f.env, context, user, {}, 'scorebook', writes, f.io);
  assert.equal(f.docs.size, 3);
  const g = fixture(); await g.enable([{ ...rule, Deadline: '2099-01-01T00:00:00Z' }]);
  await commitAcademicSubmission(g.env, context, user, {}, 'scorebook', writes, g.io);
  assert.equal([...g.docs.keys()].some(key => key.startsWith(C.pending)), false);
});
test('late reservation preserves record, scopes checkout and retries the same reference', async () => {
  const f = fixture(); await f.enable();
  const first = await f.reserve(), second = await f.reserve();
  assert.equal(first.Reference, second.Reference);
  assert.equal(f.docs.has('academicScoreSheets/sheet'), false);
  const checkout = await initializeSubmissionPayment(f.env, first, f.io);
  assert.equal(checkout.checkoutUrl, 'https://checkout.paystack.com/test');
  const body = JSON.parse(f.calls[0].options.body);
  assert.equal(body.amount, 250000); assert.equal(body.email, 'teacher@example.test');
  assert.equal(body.reference, first.Reference);
  await assert.rejects(submissionPaymentAction(f.env, context, { username: 'other' }, { Reference: first.Reference }, 'payacademicsubmission', f.io), /submitting teacher/);
  await assert.rejects(submissionPaymentAction(f.env, { ...context, scope: { ...context.scope, branchId: 'other' } }, user, { Reference: first.Reference }, 'verifyacademicsubmission', f.io), /not available/);
});
test('pending payment cannot submit; verified payment atomically submits exactly once', async () => {
  const f = fixture(); await f.enable(); const pending = await f.reserve();
  const before = f.commits.length;
  assert.equal((await verifySubmissionPayment(f.env, pending.Reference, f.io)).submission.Status, 'Awaiting payment');
  assert.equal(f.commits.length, before);
  f.setPaid(pending);
  assert.equal((await verifySubmissionPayment(f.env, pending.Reference, f.io)).submission.Status, 'Submitted');
  assert.equal(f.docs.get('academicScoreSheets/sheet').Score, 75);
  assert.equal(f.commits.at(-1).length, 3);
  const after = f.commits.length;
  await verifySubmissionPayment(f.env, pending.Reference, f.io);
  assert.equal(f.commits.length, after);
  assert.equal([...f.docs.keys()].filter(key => key.startsWith(C.receipts)).length, 1);
});
test('amount, reference, currency and live/test mismatches never submit', async () => {
  for (const bad of [{ amount: 1 }, { reference: 'other' }, { currency: 'USD' }, { domain: 'live' }]) {
    const f = fixture(); await f.enable(); const pending = await f.reserve(); f.setPaid(pending, bad);
    await assert.rejects(verifySubmissionPayment(f.env, pending.Reference, f.io), /does not match/);
    assert.equal(f.docs.has('academicScoreSheets/sheet'), false);
  }
});
test('concurrent callback and webhook deliver one academic commit and one receipt', async () => {
  const f = fixture(); await f.enable(); const pending = await f.reserve(); f.setPaid(pending);
  const results = await Promise.all([verifySubmissionPayment(f.env, pending.Reference, f.io), verifySubmissionPayment(f.env, pending.Reference, f.io)]);
  assert.ok(results.every(result => result.submission.Status === 'Submitted'));
  assert.equal(f.commits.filter(writes => writes.some(w => w.collectionPath === 'academicScoreSheets')).length, 1);
});
test('lost commit response is recovered without duplicate submission', async () => {
  const f = fixture(); await f.enable(); const pending = await f.reserve(); f.setPaid(pending);
  const commit = f.io.batchCommitDocuments;
  f.io.batchCommitDocuments = async (...args) => { await commit(...args); throw Object.assign(new Error('lost response'), { status: 503 }); };
  assert.equal((await verifySubmissionPayment(f.env, pending.Reference, f.io)).submission.Status, 'Submitted');
});
test('changed records, closed periods and deactivated staff preserve payment and require review, not overwrite', async () => {
  for (const reason of ['record', 'account', 'period']) {
    const f = fixture(); await f.enable(); const pending = await f.reserve(); f.setPaid(pending);
    if (reason === 'record') f.docs.set('academicScoreSheets/sheet', { Score: 90, __updateTime: 'newer' });
    else if (reason === 'account') f.setAccount({ Active: false });
    else f.docs.set('academicTerms/first', { TermId: 'first', SessionId: '2026', Status: 'Closed' });
    const result = await verifySubmissionPayment(f.env, pending.Reference, f.io);
    assert.equal(result.submission.Status, 'Paid — review required');
    assert.equal(f.docs.get('academicScoreSheets/sheet')?.Score, reason === 'record' ? 90 : undefined);
    assert.ok(f.docs.get(`${C.receipts}/${pending.Reference}`));
  }
});
test('all submission types route through server guard; drafts and CBT result uploads stay ungated', () => {
  const source = readFileSync(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8');
  const diary = readFileSync(new URL('../functions/lib/academic-diary.js', import.meta.url), 'utf8');
  assert.match(source, /target === 'Submitted'\) await commitAcademicSubmission/);
  assert.match(source, /commitAcademicSubmission\(env, validation.context, user, input, 'cbt'/);
  assert.match(source, /SubjectId: mode === 'Subject' \? clean\(input.SubjectId\) : ''\s*\}, 'attendance', writes\)/);
  assert.match(diary, /submitacademicdiaryentry: 'diary-entry'/);
  assert.doesNotMatch(diary, /saveacademicdiaryentry: 'diary-entry'/);
  const sync = source.slice(source.indexOf('export async function syncAcademicCbtScores'), source.indexOf('export const ACADEMIC_CBT_OPTION_STYLES'));
  assert.doesNotMatch(sync, /commitAcademicSubmission/);
});
