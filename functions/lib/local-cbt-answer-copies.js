import { getDocument, queryCollection, batchCommitDocuments } from './firestore.js';
import { portalCbtScope, cbtHash } from './portal-cbt.js';
import { academicCbtScoreBatchDigest, verifyAcademicCbtScoreSignature } from './academic-management.js';

export const ANSWER_COPIES = 'academicCbtAnswerCopies';
const clean = value => String(value ?? '').trim();
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const answerCopyDigest = input => cbtHash(typeof input === 'string' ? input : JSON.stringify(canonical(input)));
const scoped = (row, scope) => ['BranchId', 'SchoolSection', 'WorkspaceId'].every(key => row?.[key] === scope[key]);
const receiptView = row => ({ CopyId: row.CopyId, CopyDigest: row.CopyDigest, SavedReports: row.Candidates.length });

// Immutable copies are independent of scorebook writes. A replay reads one
// receipt document; it never recalculates, republishes or overwrites a score.
export function localCbtAnswerCopies(env, user, dependencies = {}) {
  const get = dependencies.get || getDocument, query = dependencies.query || queryCollection;
  const commit = dependencies.commit || batchCommitDocuments;
  const authorize = input => portalCbtScope(env, user, { ...input, Audience: 'student' });
  async function upload(input) {
    const scope = authorize(input), scoreBatch = input.ScoreBatch;
    let evidence;
    try { evidence = typeof input.EvidenceJson === 'string' ? JSON.parse(input.EvidenceJson) : input.Evidence; }
    catch { throw fail('The signed answer copy is not valid JSON.'); }
    if (!evidence || evidence.Version !== 'dynamax-cbt-answer-copy-v1' || !scoreBatch
      || !/^[\w.:-]{1,250}$/.test(evidence.SyncId || '') || !/^[\w.:-]{1,250}$/.test(evidence.SourceTestId || '')
      || evidence.BranchId !== scope.BranchId || evidence.SchoolSection !== scope.SchoolSection
      || !Array.isArray(evidence.Reports) || !evidence.Reports.length || evidence.Reports.length > 10
      || !Array.isArray(evidence.Questions) || !evidence.Questions.length || evidence.Questions.length > 200
      || new TextEncoder().encode(JSON.stringify(input)).length > 700 * 1024) throw fail('Choose a complete, bounded local answer copy.');
    const digest = await answerCopyDigest(typeof input.EvidenceJson === 'string' ? input.EvidenceJson : evidence);
    if (digest !== input.CopyDigest) throw fail('The answer copy changed after signing. Export it again from the original CBT server.');
    const signer = await verifyAcademicCbtScoreSignature({ ...input, BatchDigest: digest });
    const id = await cbtHash(`${scope.WorkspaceId}|${scope.BranchId}|${scope.SchoolSection}|${signer}|${digest}`);
    const previous = await get(env, ANSWER_COPIES, id);
    if (previous) {
      if (!scoped(previous, scope) || previous.CopyDigest !== digest) throw fail('The answer copy scope does not match.', 403);
      return { ok: true, alreadySaved: true, answerCopyReceipt: receiptView(previous) };
    }
    if (await academicCbtScoreBatchDigest(scoreBatch) !== evidence.ScoreBatchDigest
      || scoreBatch.BatchDigest !== evidence.ScoreBatchDigest || scoreBatch.SourceType !== 'BuiltInCBT'
      || scoreBatch.ApprovalStatus !== 'Approved' || scoreBatch.SourceTestId !== evidence.SourceTestId) throw fail('The original approved score batch does not match this answer copy.');
    const [receipt, source] = await Promise.all([
      get(env, 'academicScoreSyncBatches', evidence.SyncId), get(env, 'academicCbtTests', evidence.SourceTestId)
    ]);
    if (!receipt || receipt.ReceiptVersion !== 2 || receipt.SigningKeyId !== signer || receipt.SourceType !== 'BuiltInCBT'
      || receipt.BatchDigest !== scoreBatch.BatchDigest || receipt.SourceTestId !== evidence.SourceTestId
      || ['BranchId', 'SchoolSection'].some(key => receipt[key] !== scope[key] || source?.[key] !== scope[key])
      || ['SessionId', 'TermId', 'ClassId', 'SubjectId', 'AssessmentComponentId'].some(key => receipt[key] !== scoreBatch[key] || source?.[key] !== scoreBatch[key])) {
      throw fail('A matching saved score-upload receipt from this CBT server and branch is required.');
    }
    const ids = new Set();
    for (const q of evidence.Questions) {
      if (!q || !/^[\w.:-]{1,200}$/.test(q.QuestionId || '') || ids.has(q.QuestionId)
        || !['single', 'multiple', 'true-false', 'short', 'extended'].includes(q.QuestionType)
        || !q.Prompt || !Array.isArray(q.Options) || q.Options.some(option => !option || typeof option.Id !== 'string' || typeof option.Text !== 'string')
        || !Number.isFinite(q.MaximumScore) || q.MaximumScore <= 0) throw fail('The saved question list is incomplete or duplicated.');
      ids.add(q.QuestionId);
    }
    const attempts = new Set();
    for (const report of evidence.Reports) {
      const original = scoreBatch.Scores?.find(row => clean(row.StudentRef).toLowerCase() === clean(report.StudentRef).toLowerCase() && row.AttemptId === report.AttemptId);
      if (!original || (receipt.RejectedScores || []).some(row => clean(row.StudentRef).toLowerCase() === clean(report.StudentRef).toLowerCase()) || original.State !== 'Numeric' || !['Submitted', 'Expired', 'Locked'].includes(report.AttemptStatus)
        || !clean(report.AttemptId) || attempts.has(report.AttemptId) || !Number.isFinite(Date.parse(report.SubmittedAt))
        || !report.Answers || !report.QuestionMarks || Object.keys(report.Answers).some(id => !ids.has(id))
        || Object.keys(report.QuestionMarks).some(id => !ids.has(id))) throw fail('An answer copy must match one completed student attempt in the original score batch.');
      let total = 0;
      for (const q of evidence.Questions) {
        const mark = report.QuestionMarks[q.QuestionId];
        if (!Number.isFinite(mark) || mark < 0 || mark > q.MaximumScore) throw fail('Finish marking the saved attempt before copying its answers.');
        total += mark;
      }
      if (Math.abs(total - original.RawScore) > 0.001) throw fail('These saved marks differ from the approved upload. Upload the reviewed score revision first.');
      attempts.add(report.AttemptId);
    }
    const record = { ...scope, CopyId: id, CopyDigest: digest, SourceTestId: evidence.SourceTestId, SyncId: evidence.SyncId,
      SigningKeyId: signer, UploadedAt: new Date().toISOString(), UploadedBy: clean(user.username || user.Username),
      Title: clean(source.Title), ClassName: clean(source.ClassName), SubjectName: clean(source.SubjectName),
      Candidates: evidence.Reports.map(row => ({ AttemptId: row.AttemptId, Reference: row.StudentRef,
        DisplayName: clean(row.DisplayName).slice(0, 200), Status: row.AttemptStatus, SubmittedAt: row.SubmittedAt })),
      EvidenceJson: typeof input.EvidenceJson === 'string' ? input.EvidenceJson : JSON.stringify(evidence), TestJson: JSON.stringify({ Title: source.Title, ClassName: source.ClassName,
        SubjectName: source.SubjectName, AcademicSession: source.AcademicSession, Term: source.Term }) };
    try { await commit(env, [{ collectionPath: ANSWER_COPIES, documentId: id, data: record, exists: false }]); }
    catch (error) {
      const saved = await get(env, ANSWER_COPIES, id).catch(() => null);
      if (!saved || saved.CopyDigest !== digest || !scoped(saved, scope)) throw error;
      return { ok: true, alreadySaved: true, answerCopyReceipt: receiptView(saved) };
    }
    return { ok: true, alreadySaved: false, answerCopyReceipt: receiptView(record) };
  }
  async function list(input) {
    const scope = authorize(input), source = clean(input.CbtTestId), after = clean(input.After);
    if (!/^[\w.:-]{1,250}$/.test(source) || after && !/^[a-f0-9]{64}$/.test(after)) throw fail('Choose a valid uploaded test and answer page.');
    const test = await get(env, 'academicCbtTests', source);
    if (!test || test.BranchId !== scope.BranchId || test.SchoolSection !== scope.SchoolSection) throw fail('This test is unavailable in the selected branch.', 403);
    const rows = await query(env, ANSWER_COPIES, { filters: [{ field: 'SourceTestId', op: '==', value: source }],
      orderBy: [{ field: '__name__' }], limit: 51,
      select: ['CopyId', 'SourceTestId', 'BranchId', 'SchoolSection', 'WorkspaceId', 'Candidates', 'UploadedAt', 'SigningKeyId'],
      ...(after ? { startAfterName: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${ANSWER_COPIES}/${after}` } : {}) });
    return { ok: true, title: clean(test.Title), copies: rows.slice(0, 50).filter(row => scoped(row, scope)).map(({ CopyId, Candidates, UploadedAt, SigningKeyId }) => ({ CopyId, Candidates, UploadedAt, SigningKeyId })),
      nextAfter: rows.length > 50 ? rows[49].CopyId : '' };
  }
  async function review(input) {
    const scope = authorize(input);
    if (!/^[a-f0-9]{64}$/.test(input.CopyId || '')) throw fail('Choose a saved answer copy.');
    const copy = await get(env, ANSWER_COPIES, input.CopyId);
    if (!copy || !scoped(copy, scope) || copy.SourceTestId !== input.CbtTestId) throw fail('This answer copy is unavailable in the selected branch.', 403);
    const evidence = JSON.parse(copy.EvidenceJson), row = evidence.Reports.find(row => row.AttemptId === input.AttemptId);
    if (!row) throw fail('This student attempt was not found.', 404);
    return { ok: true, test: JSON.parse(copy.TestJson), candidate: { DisplayName: row.DisplayName, Reference: row.StudentRef, Status: row.AttemptStatus },
      Questions: evidence.Questions, Answers: row.Answers, QuestionMarks: row.QuestionMarks,
      readOnly: true, UploadedAt: copy.UploadedAt };
  }
  return { upload, list, review };
}
