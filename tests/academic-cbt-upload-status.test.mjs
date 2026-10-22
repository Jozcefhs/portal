import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { extractFunction, source } from './helpers/academic-register-fixture.mjs';

const label = runInNewContext(`(${extractFunction('academicCbtUploadStatus')})`);
test('zero and partial upload receipts cannot masquerade as fully saved marks in the web register',()=>{
  assert.match(label({Status:'Committed',ImportedRows:0}), /No marks saved/);
  assert.match(label({Status:'Committed',ImportedRows:5,RejectedCount:3}), /Partially saved/);
  assert.equal(label({Status:'Committed',ImportedRows:5,RejectedCount:0}), 'Committed');
  assert.match(label({Status:'Committed'}), /No marks saved/);
  assert.match(source, /label: 'Rejected', value: \(row\) => row.RejectedCount/);
});
