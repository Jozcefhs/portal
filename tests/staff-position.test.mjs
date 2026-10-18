import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStaffPosition } from '../functions/lib/staff-position.js';

const user = { username: 'legacy-admin', branchId: 'main', role: 'Super Admin' };
const staff = { Username: 'Canonical Officer', LoginUsername: 'legacy-admin', __id: 'admin', BranchId: 'main' };
const envFor = edition => ({ ORGANISATION_EDITION: edition, DYNAMAX_WORKSPACE_ID: 'isolated-position' });
function ioFor({ hr = [], payroll = [], account = staff } = {}) {
  const reads = [];
  return { reads, staff: async () => account,
    get: async (_, collection, id) => { reads.push([collection, id]); return hr.find(row => row.__id === id) || null; },
    query: async (_, collection, options) => { reads.push([collection, options]); assert.equal(options.filters.length, 1);
      assert.equal(options.filters[0].field, 'Username'); return payroll.filter(row => row.Username === options.filters[0].value); } };
}
for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: HR position is resolved through the canonical account, not its permission role`, async () => {
    const io = ioFor({ hr: [{ __id: 'canonical-officer', Username: 'canonical officer', Position: ' Executive Director ', BranchId: 'main' }],
      account: { ...staff, Position: 'Old title' } });
    const result = await loadStaffPosition(envFor(edition), user, io);
    assert.equal(result.IssuerTitle, 'Executive Director'); assert.equal(result.Position, 'Executive Director');
    assert.equal(result.Edition, edition); assert.equal(result.Username, user.username);
    assert.ok(result.Aliases.includes('canonical officer'));
    assert.ok(!io.reads.some(([collection]) => collection === 'payrollProfiles'));
    assert.deepEqual(Object.keys(result), ['Username', 'Aliases', 'Edition', 'BranchId', 'Position', 'IssuerTitle']);
  });
}
test('payroll-only position is available when HR and login account have no position', async () => {
  const io = ioFor({ payroll: [{ Username: 'Canonical Officer', Position: 'IT Director', BranchId: 'main', BasicSalary: 123456 }] });
  const result = await loadStaffPosition(envFor('school'), user, io);
  assert.equal(result.IssuerTitle, 'IT Director'); assert.equal(result.BasicSalary, undefined);
});
test('legacy account position and genuine missing-position fallback remain supported', async () => {
  assert.equal((await loadStaffPosition(envFor('school'), user, ioFor({ account: { ...staff, Position: 'Owner' } }))).IssuerTitle, 'Owner');
  const blank = await loadStaffPosition(envFor('school'), user, ioFor());
  assert.equal(blank.IssuerTitle, 'Authorised Officer'); assert.equal(blank.Position, '');
});
test('another officer, branch, edition or inactive employment record cannot supply the title', async () => {
  for (const change of [{ Username: 'different' }, { BranchId: 'north' }, { OrganisationEdition: 'faith' }, { Status: 'Inactive' }]) {
    const io = ioFor({ hr: [{ __id: 'canonical-officer', Username: 'canonical officer', Position: 'Wrong position', BranchId: 'main', ...change }] });
    assert.equal((await loadStaffPosition(envFor('school'), user, io)).IssuerTitle, 'Authorised Officer');
  }
});
test('ambiguous positions and failed reads do not silently print the generic title', async () => {
  const io = ioFor({ payroll: [{ Username: 'Canonical Officer', Position: 'Director', BranchId: 'main' },
    { Username: 'Canonical Officer', Position: 'Accountant', BranchId: 'main' }] });
  await assert.rejects(loadStaffPosition(envFor('school'), user, io), /Conflicting staff positions/);
  await assert.rejects(loadStaffPosition(envFor('school'), user, { ...ioFor(), get: async () => { throw Error('Read unavailable'); } }), /Read unavailable/);
});

test('working in another branch still uses the authenticated officer home employment title', async () => {
  const result = await loadStaffPosition(envFor('school'), { ...user, branchId: 'north' }, ioFor({
    hr: [{ __id: 'canonical-officer', Username: 'canonical officer', BranchId: 'main', Position: 'Director' }]
  }));
  assert.equal(result.Position, 'Director'); assert.equal(result.BranchId, 'north');
});
