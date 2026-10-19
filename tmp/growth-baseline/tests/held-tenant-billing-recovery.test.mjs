import test from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_ACCOUNT, TARGETS, recoverHeldTenants, validateHeldSlot, verifiedBilling } from '../scripts/recover-held-tenant-billing.mjs';

function fixture() {
  const slots = TARGETS.map(([project, edition]) => ({ Id: project, FirebaseProjectId: project,
    CloudflareProject: project, WorkspaceId: project, PortalUrl: `https://${project}.pages.dev`,
    Edition: edition, Status: 'Maintenance', MaintenanceReason: 'Billing disabled; hold until Blaze billing is verified' }));
  slots.push({ Id: 'assigned', FirebaseProjectId: 'dynamax-tenant-006', Status: 'Assigned', AssignedRegistrationReference: 'existing' });
  const calls = { links: [], registrations: [], verifies: [] };
  const linked = new Set();
  const options = {
    consoleVerifiedLegacy: true,
    load: async () => structuredClone({ slots }),
    billing: async (project) => ({ status: TARGETS.find(([id]) => id === project)[2] ? 403 : 200,
      info: { billingEnabled: linked.has(project), billingAccountName: linked.has(project) ? `billingAccounts/${BILLING_ACCOUNT}` : '' } }),
    link: async (project, account) => { calls.links.push([project, account]); linked.add(project); },
    verify: async (value) => calls.verifies.push(value),
    register: async (slot) => { calls.registrations.push(slot); Object.assign(slots.find((row) => row.Id === slot.Id), slot, { MaintenanceReason: '' }); return { slot }; }
  };
  return { slots, calls, options };
}

test('dry run validates seven targets without writes', async () => {
  const { options, calls } = fixture();
  const results = await recoverHeldTenants(options);
  assert.equal(results.length, 7);
  assert.equal(calls.verifies.length, 7);
  assert.deepEqual(calls.links, []);
  assert.deepEqual(calls.registrations, []);
});
test('apply links only the two newer projects, records billing and preserves assigned slots', async () => {
  const { options, calls, slots } = fixture();
  const assigned = structuredClone(slots.at(-1));
  const results = await recoverHeldTenants({ ...options, apply: true });
  assert.deepEqual(calls.links.map(([id]) => id), ['dynamax-tenant-010', 'dynamax-tenant-sch-f432840944']);
  assert.equal(calls.registrations.length, 7);
  assert.ok(calls.registrations.every((slot) => slot.BillingAccountId === BILLING_ACCOUNT && slot.BillingVerifiedAt));
  assert.ok(results.every((row) => row.status === 'Ready'));
  assert.deepEqual(slots.at(-1), assigned);
});
test('cannot override unknown billing without exact legacy console attestation', () => {
  assert.throws(() => verifiedBilling({}, 403, 'dynamax-tenant-002', false), /HTTP 403/);
  assert.throws(() => verifiedBilling({}, 403, 'dynamax-tenant-010', true), /HTTP 403/);
  assert.throws(() => verifiedBilling({}, 500, 'dynamax-tenant-002', true), /HTTP 500/);
  assert.throws(() => verifiedBilling({ billingEnabled: true, billingAccountName: 'billingAccounts/other' }, 200, 'dynamax-tenant-010', true), /not verified/);
});
test('preflight rejects changed hold, identity or assignment before any mutation', async () => {
  for (const change of [{ Status: 'Assigned' }, { AssignedRegistrationReference: 'new' },
    { MaintenanceReason: 'Tenant data sanitation' }, { WorkspaceId: 'wrong' }, { Id: 'wrong' }]) {
    const { options, calls, slots } = fixture();
    Object.assign(slots[6], change);
    await assert.rejects(recoverHeldTenants({ ...options, apply: true }));
    assert.deepEqual(calls.links, []);
    assert.deepEqual(calls.registrations, []);
  }
});
test('all billing links must verify before any hold is released', async () => {
  const { options, calls } = fixture();
  await assert.rejects(recoverHeldTenants({ ...options, apply: true, link: async (project) => {
    calls.links.push(project);
  } }), /not verified/);
  assert.deepEqual(calls.registrations, []);
});
test('missing or duplicate target is rejected', () => {
  const { slots } = fixture();
  assert.throws(() => validateHeldSlot({ slots: [] }, ...TARGETS[0]), /exactly one/);
  assert.throws(() => validateHeldSlot({ slots: [...slots, slots[0]] }, ...TARGETS[0]), /exactly one/);
});
test('a concurrent assignment stops registration instead of replacing the slot', async () => {
  const { options, calls, slots } = fixture();
  let reads = 0;
  await assert.rejects(recoverHeldTenants({ ...options, apply: true, load: async () => {
    if (++reads > 1) slots[0].Status = 'Assigned';
    return structuredClone({ slots });
  } }), /refusing to modify/);
  assert.deepEqual(calls.registrations, []);
});
