import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { billingPreviewStudent } from '../functions/api/student-billing-preview.js';

const source = (await readFile(new URL('../functions/api/student-billing-reconciliation.js', import.meta.url), 'utf8'))
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?$/gm, '').replace('export async function', 'async function');
const actor = { role: 'Super Admin', edition: 'school', branchId: 'main', schoolSectionAccess: 'secondary',
  allowedSections: ['accounts', 'students'] };
const reference = 'TEST/26/274';
const profile = { AdmissionNo: reference, AccountRef: reference, BranchId: 'main', SchoolSection: 'secondary',
  __scopePath: 'schoolBranches/main/sections/secondary/students', __id: 'TEST-26-274', __updateTime: 'v1' };

async function invoke({ action = 'previewReinstatedCharges', user = actor, rows = [profile], result = { ok: true, ready: true }, extra = {} } = {}) {
  const calls = [];
  const handler = vm.runInNewContext(`${source}; onRequestPost`, {
    Response, requireFirestoreEnv: () => {}, requireStaffSession: async () => user,
    readJsonBody: async () => ({ action, AccountRef: reference, PreviewToken: 'reviewed-token', Reason: 'Reviewed updated fee setup', ...extra }),
    querySchoolCollection: async (_env, collection, options) => {
      calls.push('profile'); assert.equal(collection, 'students');
      assert.equal(options.limit, 3); assert.equal(options.scope.branchId, user.branchId);
      assert.equal(options.scope.schoolSectionAccess, user.schoolSectionAccess); return rows;
    }, billingPreviewStudent,
    getReinstatedSchoolChargeRecoveryData: async (_env, student) => {
      calls.push('read'); assert.equal(student.BranchId, 'main'); assert.equal(student.AdmissionNo, reference); return { evidence: true };
    },
    reinstatedSchoolChargeRecoveryPlan: async (student, evidence) => {
      calls.push('plan'); assert.equal(student.AdmissionNo, reference); assert.equal(evidence.evidence, true); return result;
    },
    recoverReinstatedSchoolCharges: async (_env, student, token, who, reason) => {
      calls.push('apply'); assert.equal(student.AdmissionNo, reference); assert.equal(token, 'reviewed-token');
      assert.equal(who, user); assert.equal(reason, 'Reviewed updated fee setup'); return result;
    }
  });
  const response = await handler({ request: {}, env: {} });
  return { calls, response, data: await response.json() };
}

test('explicit recovery preview reads one selected account and never invokes posting', async () => {
  const { calls, response, data } = await invoke();
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(data.ready, true); assert.deepEqual(calls, ['profile', 'profile', 'profile', 'profile', 'read', 'plan']);
});

test('reviewed apply passes the fingerprint and reason to the idempotent recovery service', async () => {
  const { calls, response } = await invoke({ action: 'applyReinstatedCharges', result: { ok: true, message: 'Charges posted.' } });
  assert.equal(response.status, 200); assert.deepEqual(calls, ['profile', 'profile', 'profile', 'profile', 'apply']);
});

test('no-op recovery plan remains a successful read-only response', async () => {
  const { calls, data, response } = await invoke({ result: { ok: true, ready: false, noOp: true, reason: 'No applicable missing charges.' } });
  assert.equal(response.status, 200); assert.equal(data.noOp, true); assert.ok(!calls.includes('apply'));
});

test('recovery writes require Super Admin, school, explicit branch, both modules and writable subscription', async () => {
  for (const patch of [{ role: 'Accountant' }, { edition: 'faith' }, { branchId: '' }, { branchId: 'all' }, { branchId: '*' },
    { allowedSections: ['accounts'] }, { allowedSections: ['students'] }, { subscriptionReadOnly: true }, { subscriptionActive: false }]) {
    const { calls, response } = await invoke({ action: 'applyReinstatedCharges', user: { ...actor, ...patch } });
    assert.equal(response.status, 403, JSON.stringify(patch)); assert.deepEqual(calls, []);
  }
  const preview = await invoke({ user: { ...actor, subscriptionReadOnly: true } });
  assert.equal(preview.response.status, 200); assert.ok(!preview.calls.includes('apply'));
});

test('other branch or section with the same admission number cannot reach recovery evidence or posting', async () => {
  for (const action of ['previewReinstatedCharges', 'applyReinstatedCharges']) for (const patch of [{ BranchId: 'annex' }, { SchoolSection: 'primary' }]) {
    const result = await invoke({ action, rows: [{ ...profile, ...patch, __scopePath: `schoolBranches/${patch.BranchId || 'main'}/sections/${patch.SchoolSection || 'secondary'}/students` }] });
    assert.equal(result.response.status, 404); assert.ok(result.calls.every(call => call === 'profile'));
  }
});
