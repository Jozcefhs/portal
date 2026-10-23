import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCbtRejectionReview, cbtRejectionNextStep, cbtRejectionPrintHtml } from '../js/academic-cbt-rejection-review.js';

export function fixture() {
  const batch = { SyncId: 'receipt-1', BatchId: 'upload-1', SheetId: 'sheet-1', SessionId: 'session', TermId: 'term',
    ClassId: 'class', ArmId: 'arm', SubjectId: 'music', AssessmentComponentId: 'ca1', MaximumScore: 100,
    SynchronizedAt: '2026-10-22T22:18:17Z', ImportedRows: 8, RejectedCount: 3,
    RejectedScores: [
      { StudentRef: 'TEST/001', Code: 'ACADEMIC_CBT_SYNC_ATTEMPT_CONFLICT', Reason: 'An earlier accepted result is preserved. This attempt was not posted.' },
      { StudentRef: 'TEST/002', Code: 'ACADEMIC_CBT_SYNC_ATTEMPT_CONFLICT', Reason: 'An authorised score correction is preserved. This attempt was not posted.' },
      { StudentRef: 'TEST/003', Code: 'LEGACY_REASON', Reason: 'Needs original upload report' }
    ] };
  const sheet = { SheetId: 'sheet-1', Status: 'Draft', AssessmentComponents: [{ Id: 'ca1', Name: 'CA1' }] };
  const data = { permissions: { canReviewScores: true }, scoreSyncBatches: [batch], scoreSheets: [sheet],
    classes: [{ ClassId: 'class', Name: 'Grade 9' }], arms: [{ ArmId: 'arm', ClassId: 'class', Name: 'Radiance' }],
    subjects: [{ SubjectId: 'music', Name: 'Music' }], sessions: [{ SessionId: 'session', Name: '2026/2027' }],
    terms: [{ TermId: 'term', Name: 'First Term' }], studentMemberships: [],
    teacherAllocations: [{ ClassId: 'class', ArmId: 'arm', SubjectId: 'music', AllocationRole: 'Subject Teacher', TeacherUsername: 'teacher' }],
    students: ['Ada', 'Ben', 'Chidi'].map((StudentName, index) => ({ StudentName, StudentRef: `TEST/00${index + 1}` })) };
  const snapshot = { SheetId: 'sheet-1', sheet, scores: [
    { SheetId: 'sheet-1', StudentRef: 'test/001', ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 0, MaximumScore: 100 }],
      CbtScoreSources: [{ CellId: 'ca1', AttemptId: 'first-attempt', SourceTestId: 'original-test', SubmittedAt: '2026-10-20T10:00:00Z' }] },
    { SheetId: 'sheet-1', StudentRef: 'TEST/002', ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 85, MaximumScore: 100 }],
      ManualScoreCorrections: [{ CellId: 'ca1' }] },
    { SheetId: 'other-sheet', StudentRef: 'TEST/003', ComponentScores: [{ ComponentId: 'ca1', State: 'Numeric', RawScore: 90, MaximumScore: 100 }] }
  ] };
  return { batch, data, snapshot };
}

test('review preserves historical reasons, finds names and compares only the exact current sheet/component', () => {
  const f = fixture(), before = structuredClone(f), model = buildCbtRejectionReview(f.batch, f.data, f.snapshot);
  assert.equal(model.title, 'Grade 9 / Radiance · Music · CA1');
  assert.equal(model.rows[0].studentName, 'Ada');
  assert.equal(model.rows[0].onlineScore, '0 / 100');
  assert.equal(model.rows[0].reason, f.batch.RejectedScores[0].Reason);
  assert.match(model.rows[0].technicalDetails, /first-attempt/);
  assert.doesNotMatch(model.rows[0].evidence, /first-attempt|original-test/);
  assert.equal(model.rows[1].onlineScore, '85 / 100');
  assert.match(model.rows[1].evidence, /manual correction/);
  assert.equal(model.rows[2].onlineScore, 'Not found in this scorebook');
  assert.deepEqual(f, before);
});

test('unchecked marks and legacy receipts never become invented rejections or zero scores', () => {
  const f = fixture();
  assert.equal(buildCbtRejectionReview(f.batch, f.data).rows[0].onlineScore, 'Not checked yet');
  const legacy = buildCbtRejectionReview({ ...f.batch, RejectedCount: 11, RejectedScores: undefined }, f.data);
  assert.equal(legacy.rows.length, 0); assert.equal(legacy.unavailable, 11);
  const html = cbtRejectionPrintHtml(legacy);
  assert.match(html, /cannot be reconstructed/); assert.match(html, /Current marks checked: Not checked/);
  const partial = buildCbtRejectionReview({ ...f.batch, RejectedCount: 11 }, f.data);
  assert.equal(partial.unavailable, 8);
  assert.equal(buildCbtRejectionReview({ ...f.batch, RejectedCount: 0 }, f.data).count, 3);
  const missingReason = buildCbtRejectionReview({ ...f.batch, RejectedScores: [{ StudentRef: 'unknown' }] }, f.data);
  assert.match(missingReason.rows[0].reason, /did not save a reason/);
  assert.equal(missingReason.rows[0].studentName, 'Name unavailable');
});

test('split components show objective marks only and preserve exceptional states and duplicate warnings', () => {
  const f = fixture();
  f.snapshot.sheet.AssessmentComponents[0].ScoreEntryMode = 'objective-theory';
  f.snapshot.scores[0].ComponentScores[0] = { ComponentId: 'ca1', Parts: [
    { PartId: 'objective', State: 'Numeric', RawScore: 22, MaximumScore: 50 },
    { PartId: 'theory', State: 'Numeric', RawScore: 40, MaximumScore: 50 }
  ] };
  f.snapshot.scores[0].CbtScoreSources[0].CellId = 'ca1:objective';
  assert.equal(buildCbtRejectionReview(f.batch, f.data, f.snapshot).rows[0].onlineScore, '22 / 50');
  assert.match(buildCbtRejectionReview(f.batch, f.data, f.snapshot).rows[0].technicalDetails, /first-attempt/);
  f.snapshot.scores[0].ComponentScores[0].Parts[0].State = 'Absent';
  assert.equal(buildCbtRejectionReview(f.batch, f.data, f.snapshot).rows[0].onlineScore, 'Absent');
  f.snapshot.scores.push(structuredClone(f.snapshot.scores[0]));
  assert.match(buildCbtRejectionReview(f.batch, f.data, f.snapshot).rows[0].onlineScore, /Duplicate score records/);
});

test('review guidance never automatically retries or overwrites protected results and print escapes all stored strings', () => {
  const f = fixture();
  f.batch.RejectedScores[0].Reason = '<img src=x onerror=alert(1)>';
  f.data.students[0].StudentName = '<script>alert(1)</script>';
  const model = buildCbtRejectionReview(f.batch, f.data, f.snapshot);
  const html = cbtRejectionPrintHtml(model, [model.rows[0]], 'Checked now');
  assert.doesNotMatch(html, /<script>|<img|Ben|Chidi/);
  assert.match(html, /&lt;img/); assert.match(html, /1 shown/);
  assert.match(cbtRejectionNextStep(f.batch.RejectedScores[0]), /do not repeat the test/);
  assert.match(cbtRejectionNextStep({}), /does not approve, retry or overwrite/);
});

test('internal attempt and test references stay in closed technical details, including print preview', () => {
  const f = fixture(), before = structuredClone(f);
  const model = buildCbtRejectionReview(f.batch, f.data, f.snapshot);
  const html = cbtRejectionPrintHtml(model);
  assert.match(html, /<details class="review-technical-details"><summary>Technical details<\/summary><small>Saved attempt: first-attempt\nSaved test: original-test<\/small><\/details>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  assert.doesNotMatch(html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, ''), /first-attempt|original-test/);
  assert.match(model.rows[0].evidence, /Submitted:.*\nCurrent scorebook: Draft/);
  assert.equal(model.rows[1].technicalDetails, '');
  assert.equal(buildCbtRejectionReview(f.batch, f.data).rows[0].technicalDetails, '');
  assert.deepEqual(f, before);
  f.snapshot.scores[0].CbtScoreSources[0].AttemptId = '<img src=x onerror=alert(1)>';
  const escaped = cbtRejectionPrintHtml(buildCbtRejectionReview(f.batch, f.data, f.snapshot));
  assert.doesNotMatch(escaped, /<img/);
  assert.match(escaped, /Saved attempt: &lt;img/);
});

test('history binds an authorised scoped read-only review and caches the new module', async () => {
  const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const start = source.indexOf('function bindAcademicCbtRejectionReviews(');
  const binding = source.slice(start, source.indexOf('\nfunction bindAcademicManagement(', start));
  assert.match(source, /data-academic-cbt-rejections=/);
  assert.match(binding, /canReviewScores/); assert.match(binding, /selectedBranchId === branch/);
  assert.match(binding, /getAcademicScorebookContext/); assert.match(binding, /SheetId: batch.SheetId/);
  assert.match(binding, /academicManagementTaskViews.scorebook = 'entry'/);
  assert.doesNotMatch(binding, /syncAcademicCbtScores|reactivateAcademicScoreEditing|saveAcademicScoreDraft/);
  assert.match(sw, /\/js\/academic-cbt-rejection-review.js/);
});
