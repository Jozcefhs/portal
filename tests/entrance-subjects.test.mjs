import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultEntranceSubjects, normalizeEntranceSubjects, entranceSubjectRows, entranceScoreSummary, entranceScoreUpdates, assertEntranceScoresUnchanged } from '../functions/lib/entrance-subjects.js';
import { buildEntranceResultUpdates } from '../functions/api/backend.js';

const profile = { EntranceExamSubjects: normalizeEntranceSubjects('Science | 50\nVerbal reasoning | 20\nCreative writing | 40\nFrench | 100') };
const inputRows = (scores = [40, 10, 30, 0]) => profile.EntranceExamSubjects.map((subject, index) => ({ ...subject, score: scores[index] }));

test('schools may configure a single subject or more than three with their own maximum marks', () => {
  assert.equal(normalizeEntranceSubjects('Reasoning | 50').length, 1);
  assert.equal(profile.EntranceExamSubjects.length, 4);
  assert.equal(normalizeEntranceSubjects('Art')[0].maxScore, 100);
  assert.deepEqual(entranceSubjectRows({}, profile).map((row) => row.name), ['Science', 'Verbal reasoning', 'Creative writing', 'French']);
});

test('defaults are independent copies and do not carry one school configuration into another', () => {
  const schoolA = normalizeEntranceSubjects('Aptitude | 25');
  const schoolB = normalizeEntranceSubjects('Music | 80\nDrama | 60');
  schoolA[0].name = 'Edited';
  assert.equal(entranceSubjectRows({}, { EntranceExamSubjects: schoolB })[0].name, 'Music');
  const defaults = defaultEntranceSubjects(); defaults[0].name = 'Changed';
  assert.equal(defaultEntranceSubjects()[0].name, 'English');
});

test('settings reject duplicates, empty lists and invalid maxima', () => {
  for (const input of ['', [], 'Science | 0', 'Science | -1', 'Science | NaN', 'Science | Infinity', 'Science | 10001', 'Math | 50\nmath | 80', 'A | 5 | 10', Array.from({ length: 31 }, (_, i) => ({ name: `Subject ${i}` }))]) {
    assert.throws(() => normalizeEntranceSubjects(input));
  }
  assert.throws(() => normalizeEntranceSubjects([{ id: 'same', name: 'One' }, { id: 'same', name: 'Two' }]), /unique/);
});

test('totals use any number of configured subjects, including zero and unequal maxima', () => {
  assert.deepEqual(entranceScoreSummary(inputRows()), { TotalScore: '80', ResultPercentage: '51.3' });
  assert.deepEqual(entranceScoreSummary(inputRows(['', 0, '', ''])), { TotalScore: '0', ResultPercentage: '0.0' });
  assert.deepEqual(entranceScoreSummary(inputRows(['', '', '', ''])), { TotalScore: '', ResultPercentage: '' });
});

test('new results use server configuration and server calculated totals', () => {
  const updates = buildEntranceResultUpdates({}, { EntranceSubjectScores: inputRows(), TotalScore: '9999', ResultPercentage: '100', ResultStatus: 'Pending' }, 'now', profile);
  assert.equal(updates.TotalScore, '80');
  assert.equal(updates.ResultPercentage, '51.3');
  assert.equal(updates.EntranceSubjectScores.length, 4);
  assert.equal(Object.hasOwn(updates, 'InterviewScore'), false);
});

test('stored subjects and legacy marks keep their meaning after configuration changes', () => {
  const saved = { EntranceSubjectScores: inputRows(), EnglishScore: '91', Answers: { q1: 'B' } };
  const before = structuredClone(saved);
  assert.deepEqual(entranceSubjectRows(saved, { EntranceExamSubjects: [{ id: 'art', name: 'Art', maxScore: 10 }] }), inputRows());
  const legacy = { EnglishScore: 0, MathematicsScore: '71', InterviewScore: '82' };
  assert.deepEqual(entranceSubjectRows(legacy, profile).map((row) => row.score), [0, '71', '82']);
  const updates = entranceScoreUpdates(saved, { EntranceSubjectScores: inputRows() }, {});
  assert.equal(Object.hasOwn(updates, 'EnglishScore'), false);
  assert.deepEqual(saved, before);
});

test('omitted, substituted, duplicate or changed subject metadata cannot erase or reassign marks', () => {
  const original = inputRows();
  for (const rows of [original.slice(1), [...original, original[0]], original.map((row, i) => i ? row : { ...row, name: 'Other' }), original.map((row, i) => i ? row : { ...row, maxScore: 500 })]) {
    assert.throws(() => entranceScoreUpdates({ EntranceSubjectScores: original }, { EntranceSubjectScores: rows }, profile));
  }
  assert.throws(() => entranceScoreUpdates({}, { EntranceSubjectScores: original }, { EntranceExamSubjects: [{ id: 'other', name: 'Other', maxScore: 100 }] }), /changed/);
});

test('invalid marks fail validation and do not mutate original records', () => {
  for (const score of [-1, 51, 'NaN', 'Infinity', true, 'forty', [], [40], {}]) {
    assert.throws(() => entranceScoreUpdates({}, { EntranceSubjectScores: inputRows([score, 10, 20, 30]) }, profile));
  }
  assert.throws(() => entranceScoreUpdates({ EntranceSubjectScores: inputRows() }, { EntranceSubjectScores: profile.EntranceExamSubjects }, profile), /explicit blank score/);
});

test('old clients preserve omitted legacy fields but cannot overwrite dynamic results', () => {
  assert.deepEqual(entranceScoreUpdates({ EnglishScore: '80', MathematicsScore: '70', InterviewScore: '90' }, { EnglishScore: '81' }), { EnglishScore: '81', MathematicsScore: '70', InterviewScore: '90' });
  assert.throws(() => entranceScoreUpdates({ EntranceSubjectScores: inputRows() }, { EnglishScore: '1' }), /updated entrance-result editor/);
  assert.throws(() => entranceScoreUpdates({}, { EnglishScore: '1' }, profile), /updated entrance-result editor/);
});

test('legacy marks are mirrored by subject identity, not position', () => {
  const rows = entranceSubjectRows({ EnglishScore: '81', MathematicsScore: '72', InterviewScore: '90' });
  const updates = entranceScoreUpdates({ EnglishScore: '81', MathematicsScore: '72', InterviewScore: '90' }, { EntranceSubjectScores: rows }, profile);
  assert.equal(updates.InterviewScore, '90');
  assert.equal(updates.TotalScore, '243');
});

test('changed subject scores invalidate a previously generated result PDF even if the total stays the same', () => {
  const existing = { EntranceSubjectScores: inputRows(), TotalScore: '80', ResultPercentage: '51.3', ResultStatus: 'Pending', ResultNotes: '', ResultNextStep: '', EntranceResultPdfUrl: 'old.pdf' };
  const changes = inputRows([35, 12, 30, 3]);
  const updates = buildEntranceResultUpdates(existing, { EntranceSubjectScores: changes }, 'now', profile);
  assert.equal(updates.EntranceResultPdfUrl, '');
  assert.equal(updates.ResultSent, 'NO');
});

test('web settings persist the configuration and branch overrides cannot change it', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.match(read('../functions/api/settings.js'), /EntranceExamSubjects: null/);
  assert.match(read('../functions/api/settings.js'), /profile.EntranceExamSubjects = normalizeEntranceSubjects\(profile.EntranceExamSubjects\)/);
  assert.match(read('../functions/api/settings.js'), /EntranceExamSubjects: normalizeEntranceSubjects\(incoming.EntranceExamSubjects \?\? existing.EntranceExamSubjects\)/);
  assert.ok(!read('../functions/lib/branch-profile-settings.js').includes("'EntranceExamSubjects'"));
  assert.match(read('../js/setup.js'), /getElementById\('entranceExamSubjects'\).disabled = branchMode \|\| scopeLocked/);
});

test('other applicant editors cannot change saved subject marks behind the result editor', () => {
  const existing = { EntranceSubjectScores: inputRows(), InterviewScore: '80', TotalScore: '80' };
  assert.doesNotThrow(() => assertEntranceScoresUnchanged(existing, { InterviewDate: '2026-10-24', InterviewScore: '80' }));
  assert.throws(() => assertEntranceScoresUnchanged(existing, { InterviewScore: '90' }), /entrance-result editor/);
  assert.throws(() => assertEntranceScoresUnchanged(existing, { EntranceSubjectScores: [] }), /entrance-result editor/);
  assert.throws(() => assertEntranceScoresUnchanged({}, { EntranceSubjectScores: inputRows() }), /entrance-result editor/);
});
