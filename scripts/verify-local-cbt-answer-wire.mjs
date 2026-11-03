// Real Python store/signature -> production JavaScript verifier, fixture data only.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { localCbtAnswerCopies, ANSWER_COPIES } from '../functions/lib/local-cbt-answer-copies.js';
const desktop = process.env.DYNAMAX_DESKTOP_ROOT || resolve(import.meta.dirname, '../../suite');
const script = `import json
from tests.test_local_cbt_answers import AnswerUploadTests
t=AnswerUploadTests(); t.setUp()
copies=[]
def request(action,body):
    copies.append(body)
    return t.request(action,body)
try:
    result=t.upload_scores(request)
    assert result.get('Answers') == 1, result
    print(json.dumps(copies[-1],ensure_ascii=False))
finally:
    t.doCleanups()
`;
const input = JSON.parse(execFileSync(process.env.PYTHON || 'python', ['-c', script], { cwd: desktop, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONPATH: '.;tests' } }));
const evidence = JSON.parse(input.EvidenceJson), scope = { BranchId: input.BranchId, SchoolSection: input.SchoolSection }, batch = input.ScoreBatch;
const db = new Map([
  [`academicCbtTests/${batch.SourceTestId}`, { ...batch, ...scope, Title: 'Wire fixture' }],
  [`academicScoreSyncBatches/${evidence.SyncId}`, { ...batch, ...scope, ReceiptVersion: 2, RejectedScores: [] }]
]);
let writes = 0;
const service = localCbtAnswerCopies({ ORGANISATION_EDITION: 'school', DYNAMAX_WORKSPACE_ID: 'wire-fixture' },
  { username: 'fixture', role: 'ICT', edition: 'school', allowedSections: ['academics'] }, {
    get: async (_, collection, id) => db.get(`${collection}/${id}`) || null,
    commit: async (_, changes) => { for (const change of changes) { assert.equal(change.collectionPath, ANSWER_COPIES); db.set(`${change.collectionPath}/${change.documentId}`, change.data); writes++; } }
  });
const saved = await service.upload(input);
assert.equal(saved.answerCopyReceipt.SavedReports, 1);
assert.equal((await service.upload(input)).alreadySaved, true);
assert.equal(writes, 1);
const review = await service.review({ ...scope, CbtTestId: batch.SourceTestId, CopyId: saved.answerCopyReceipt.CopyId, AttemptId: evidence.Reports[0].AttemptId });
assert.equal(review.Answers.Q1, 'b'); assert.equal(review.Questions[0].AnswerKey, 'b');
console.log('PASS: real desktop answers/signature accepted by web; exact answer and key retained; retry writes nothing.');
