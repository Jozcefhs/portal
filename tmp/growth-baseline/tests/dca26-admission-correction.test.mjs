import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PROJECT, correctedAdmission, admissionMap, rewrittenFields, destinationName, validatePlan, repairBatches, forwardWrites } from '../scripts/correct-dca26-admissions.mjs';

const base = `projects/${PROJECT}/databases/(default)/documents`;
const s = stringValue => ({ stringValue });
const doc = (type, id, fields) => ({ name: `${base}/${type}/${id}`, fields, updateTime: '2026-10-05T09:00:00.000001Z' });
const students = [doc('students', 'DCA-26-0001', { AdmissionNo: s('DCA/26/0001'), AccountRef: s('DCA/26/0001') }),
  doc('students', 'DCA-26-0045', { AdmissionNo: s('DCA/26/0045'), AccountRef: s('DCA/26/0045') })];
const map = admissionMap(students);
function planFor(documents = students) {
  return { project: PROJECT, map: [...map], operations: documents.map(before => {
    const rewrite = rewrittenFields(before.fields, map);
    return { before, destination: destinationName(before, map), fields: rewrite.after, mask: rewrite.mask };
  }) };
}

test('only the exact DCA/26 four-digit extra-zero format is corrected', () => {
  assert.equal(correctedAdmission('DCA/26/0001'), 'DCA/26/001');
  assert.equal(correctedAdmission('DCA/26/0045'), 'DCA/26/045');
  assert.equal(correctedAdmission('DCA/26/0999'), 'DCA/26/999');
  for (const value of ['DCA/26/001', 'DCA/25/0001', 'ORG/26/0001', 'DCA/26/1001', 'DCA/26/00001', ' DCA/26/0001', 'DCA/26/A001']) assert.equal(correctedAdmission(value), null);
});
test('duplicate and collision checks happen before a plan can be applied', () => {
  assert.throws(() => admissionMap([...students, students[0]]), /Duplicate/);
  assert.throws(() => admissionMap([...students, doc('students', 'DCA-26-001', { AdmissionNo: s('DCA/26/001') })]), /already belongs/);
});
test('unrelated financial, profile and credential values are preserved', () => {
  const fields = { AccountRef: s('DCA/26/0001'), ParentEmail: s('parent@example.test'), PasswordHash: s('unchanged-hash'),
    PasswordChangedAt: s('2026-10-01'), ParentOnboardingStatus: s('Complete'), Amount: { integerValue: '150000' },
    Debit: { doubleValue: 15.5 }, Description: s('DCA/26/0001'), EmptyArray: { arrayValue: {} }, EmptyMap: { mapValue: {} },
    Photo: { bytesValue: 'AA==' }, Active: { booleanValue: true } };
  const rewrite = rewrittenFields(fields, map);
  assert.deepEqual(rewrite.mask, ['AccountRef']);
  assert.deepEqual(rewrite.ignored, ['Description']);
  assert.deepEqual({ ...rewrite.after, AccountRef: fields.AccountRef }, fields);
});
test('nested operational references and normalized references are updated', () => {
  const fields = { AccountRefNormalized: s('dca260001'), LinkedReferences: { arrayValue: { values: [s('DCA/26/0001'), s('APP-1')] } },
    Lines: { arrayValue: { values: [{ mapValue: { fields: { StudentRef: s('dca/26/0045'), Credit: { integerValue: '100' } } } }] } } };
  const rewrite = rewrittenFields(fields, map);
  assert.equal(rewrite.after.AccountRefNormalized.stringValue, 'dca26001');
  assert.equal(rewrite.after.LinkedReferences.arrayValue.values[0].stringValue, 'DCA/26/001');
  assert.equal(rewrite.after.Lines.arrayValue.values[0].mapValue.fields.StudentRef.stringValue, 'DCA/26/045');
  assert.deepEqual(rewrite.after.Lines.arrayValue.values[0].mapValue.fields.Credit, { integerValue: '100' });
});
test('student and account-summary keys move but stable journal identifiers do not', () => {
  assert.equal(destinationName(students[0], map), `${base}/students/DCA-26-001`);
  assert.equal(destinationName(doc('accountSummaries', 'DCA-26-0001', { AccountRef: s('DCA/26/0001') }), map), `${base}/accountSummaries/DCA-26-001`);
  const journal = doc('accountingJournals', 'SYS-DCA-26-0001', { AccountRef: s('DCA/26/0001') });
  assert.equal(destinationName(journal, map), journal.name);
  assert.throws(() => destinationName({ ...students[0], name: `${base}/students/unexpected` }, map), /not canonical/);
});
test('student-login hash keys move without changing the password hash', () => {
  const sha = value => createHash('sha256').update(value).digest('hex');
  const credential = doc('studentLoginCredentials', `student-login-${sha('dca/26/0001')}`, { StudentRef: s('DCA/26/0001'), PasswordHash: s('keep'), Salt: s('keep-salt') });
  assert.equal(destinationName(credential, map), `${base}/studentLoginCredentials/student-login-${sha('dca/26/001')}`);
  assert.equal(rewrittenFields(credential.fields, map).after.PasswordHash.stringValue, 'keep');
  assert.throws(() => destinationName({ ...credential, name: `${base}/studentLoginCredentials/wrong` }, map), /does not match/);
});
test('plan validation rejects tampering, other projects, wrong counts and audit writes', () => {
  const plan = planFor();
  assert.doesNotThrow(() => validatePlan(plan, 2));
  assert.throws(() => validatePlan(plan), /count/);
  assert.throws(() => validatePlan({ ...plan, project: 'another-project' }, 2), /identity/);
  const changed = structuredClone(plan); changed.operations[0].fields.Amount = { integerValue: '0' };
  assert.throws(() => validatePlan(changed, 2), /differ/);
  const audit = doc('platformSecurityAudit', 'event', { StudentRef: s('DCA/26/0001') });
  assert.throws(() => validatePlan(planFor([...students, audit]), 2), /Protected/);
});
test('shared references keep related students in one atomic batch', () => {
  const shared = doc('ledger', 'L-1', { AccountRef: s('DCA/26/0001'), TargetAccountRef: s('DCA/26/0045') });
  const batches = repairBatches(planFor([...students, shared]));
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 3);
  const writes = forwardWrites(batches[0]);
  assert.equal(writes.length, 5);
  const deletes = writes.filter(write => write.delete);
  assert.equal(deletes.length, 2);
  assert.ok(deletes.every(write => write.currentDocument.updateTime));
  assert.ok(writes.filter(write => write.update && !write.updateMask).every(write => write.currentDocument.exists === false));
  assert.deepEqual(writes.find(write => write.updateMask).updateMask.fieldPaths, ['AccountRef', 'TargetAccountRef']);
});
