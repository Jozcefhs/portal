import test from 'node:test';
import assert from 'node:assert/strict';
import { academicSubjectName, academicResultWithSubjectLabels } from '../functions/lib/academic-result-subject-labels.js';
import { academicAutomaticResultComments } from '../functions/lib/academic-term-results.js';

const id = 'subject__main__secondary__civ';
const catalogue = [{ RecordId: id, Name: 'Civic Education' }];

test('legacy result comments resolve subject IDs without modifying saved records or marks', () => {
  const result = { Status: 'Locked', Revision: 7, TeacherRemark: `Greater attention to ${id} will help.`,
    PrincipalRemark: `Further practice in ${id}.`, Recommendation: 'Keep up regular reading.',
    Subjects: [{ SubjectId: id, SubjectName: id, Total: 48, ComponentScores: [{ RawScore: 12 }] }] };
  const before = structuredClone(result);
  const output = academicResultWithSubjectLabels(result, catalogue);
  assert.equal(output.Subjects[0].SubjectName, 'Civic Education');
  assert.equal(output.TeacherRemark, 'Greater attention to Civic Education will help.');
  assert.equal(output.PrincipalRemark, 'Further practice in Civic Education.');
  assert.equal(output.Recommendation, result.Recommendation);
  assert.equal(output.Status, 'Locked');
  assert.equal(output.Revision, 7);
  assert.deepEqual(output.Subjects[0].ComponentScores, before.Subjects[0].ComponentScores);
  assert.deepEqual(result, before);
});

test('catalogue aliases and school-specific names work without hardcoded subject codes', () => {
  for (const field of ['SubjectId', 'RecordId', '__id', 'Id']) {
    assert.equal(academicSubjectName({ SubjectId: id, SubjectName: id }, [{ [field]: id, Name: 'Citizenship & Society' }]), 'Citizenship & Society');
  }
  assert.equal(academicSubjectName({ SubjectId: id, SubjectName: 'Civic Education' }, []), 'Civic Education');
});

test('new automatic comments use readable snapshots and never expose unresolved IDs', () => {
  const named = academicAutomaticResultComments({ Subjects: [{ SubjectId: id, SubjectName: 'Civic Education', Total: 30 }] });
  assert.match(named.TeacherRemark, /Civic Education/);
  const unknown = academicAutomaticResultComments({ Subjects: [{ SubjectId: id, SubjectName: id, Total: 30 }] });
  assert.doesNotMatch(JSON.stringify(unknown), /subject__/);
});

test('exact subject tokens are resolved without partial-ID matches or rewriting custom prose', () => {
  const output = academicResultWithSubjectLabels({ TeacherRemark: `Civic effort: ${id} and ${id}2.`,
    PrincipalRemark: 'A carefully written personal comment.', Subjects: [] }, catalogue);
  assert.equal(output.TeacherRemark, 'Civic effort: Civic Education and this subject.');
  assert.equal(output.PrincipalRemark, 'A carefully written personal comment.');
});
