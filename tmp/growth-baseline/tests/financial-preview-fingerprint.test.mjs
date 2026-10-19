import test from 'node:test';
import assert from 'node:assert/strict';
import { financialPreviewFingerprint } from '../functions/lib/financial-preview-fingerprint.js';

test('financial fingerprint ignores object and document order, not values or revisions', async () => {
  const snapshot = { profile: { AccountRef: 'TEST', ClassName: 'Grade 12' }, revision: 'student-1',
    records: [{ __id: 'A', __updateTime: 'rev-a', Amount: 60, Lines: [{ Debit: 60, Credit: 0 }, { Debit: 0, Credit: 60 }] },
      { __id: 'B', __updateTime: 'rev-b', Amount: 20 }] };
  const before = JSON.stringify(snapshot);
  const token = await financialPreviewFingerprint(snapshot, ['records']);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(await financialPreviewFingerprint({ records: [...snapshot.records].reverse(), revision: snapshot.revision,
    profile: { ClassName: 'Grade 12', AccountRef: 'TEST' } }, ['records']), token);
  for (const change of [
    (data) => { data.records[0].Amount++; },
    (data) => { data.records[0].__updateTime += '-new'; },
    (data) => { data.revision += '-new'; },
    (data) => { data.records[0].Lines.reverse(); },
    (data) => { data.records.push({ ...data.records[0] }); },
    (data) => { data.records.pop(); }
  ]) {
    const changed = structuredClone(snapshot); change(changed);
    assert.notEqual(await financialPreviewFingerprint(changed, ['records']), token);
  }
  assert.equal(JSON.stringify(snapshot), before);
});
