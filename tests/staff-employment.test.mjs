import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withStaffEmployment, staffEmploymentDetails, employmentDirectoryRow,
  employmentPayrollProfile } from '../functions/lib/staff-employment.js';
import { normalizeHrEmployee } from '../functions/lib/human-resources.js';
import { staffAttendanceDirectoryFor } from '../functions/lib/staff-time-attendance.js';
import { staffDetailProjection } from '../functions/lib/records-desk.js';

const env = edition => ({ ORGANISATION_EDITION: edition, DYNAMAX_WORKSPACE_ID: 'hr-test' });
const account = edition => ({ Username: 'Officer', LoginUsername: 'officer-login', BranchId: 'main',
  OrganisationEdition: edition, DisplayName: 'Account Name', Role: 'Accounts Officer',
  Department: 'Permission Department', Active: true, ApprovalMaxAmount: 123, Email: 'login@example.test' });
const employee = { Username: 'officer', BranchId: 'main', DisplayName: 'HR Name', Position: 'Director',
  Department: 'Operations', EmploymentType: 'Permanent', HireDate: '2024-01-01', ManagerUsername: 'manager',
  WorkEmail: 'work@example.test', Phone: '12345', Status: 'Active', EmployeeId: 'HR-1',
  EmergencyContact: 'PRIVATE', CaseNotes: 'PRIVATE', BasicSalary: 999999,
  Role: 'Super Admin', Active: false, ApprovalMaxAmount: 999999, PasswordHash: 'PRIVATE' };

for (const edition of ['school', 'faith', 'organization']) {
  test(`${edition}: current HR fields reach directories, payroll drafts and attendance without changing access`, async () => {
    const original = account(edition);
    const [linked] = await withStaffEmployment(env(edition), [original], { read: async (_, collection, ids) => {
      assert.equal(collection, 'hrEmployees');
      assert.deepEqual(ids, ['officer', 'officer-login']);
      return [employee, null];
    } });
    assert.equal(linked.Position, 'Director');
    for (const field of ['Username', 'Role', 'Department', 'Active', 'ApprovalMaxAmount', 'Email']) {
      assert.equal(linked[field], original[field]);
    }
    assert.ok(!JSON.stringify(linked).includes('PRIVATE'));
    assert.equal(linked.Employment.BasicSalary, undefined);
    const directory = employmentDirectoryRow(linked);
    assert.equal(directory.DisplayName, 'HR Name'); assert.equal(directory.Email, 'work@example.test');
    assert.equal(directory.Department, 'Operations'); assert.equal(directory.Role, 'Accounts Officer');
    assert.match(JSON.stringify(staffDetailProjection(directory)), /Director/);
    const payroll = { Username: 'Officer', EmployeeId: 'PAY-1', Position: 'Old title', BasicSalary: 100000,
      BankName: 'Bank', AccountNumber: '123', TaxProfileId: 'TAX', Active: 'YES', PaidAmount: 80000 };
    const projected = employmentPayrollProfile(payroll, linked);
    assert.equal(projected.Position, 'Director'); assert.equal(projected.Department, 'Operations');
    for (const field of ['EmployeeId', 'BasicSalary', 'BankName', 'AccountNumber', 'TaxProfileId', 'Active', 'PaidAmount']) {
      assert.equal(projected[field], payroll[field]);
    }
    assert.equal(payroll.Position, 'Old title', 'historical/input records stay untouched');
    const attendance = staffAttendanceDirectoryFor([original], [employee], { edition }, 'main');
    assert.equal(attendance[0].Department, 'Operations'); assert.equal(attendance[0].Position, 'Director');
    assert.equal(attendance[0].Role, 'Accounts Officer');
    assert.deepEqual(original, account(edition));
  });

  test(`${edition}: HR lookups reject another person, branch and edition`, () => {
    for (const changes of [{ Username: 'someone-else' }, { BranchId: 'north' },
      { OrganisationEdition: edition === 'school' ? 'faith' : 'school' }]) {
      assert.deepEqual(staffEmploymentDetails(account(edition), [{ ...employee, ...changes }], edition), {});
    }
    assert.equal(staffEmploymentDetails(account(edition), [{ ...employee, Username: 'officer-login' }], edition).Position, 'Director');
  });
}

test('HR edits are read on refresh, without write-through to accounts or old payroll items', async () => {
  let current = { ...employee };
  const read = async () => [current];
  assert.equal((await withStaffEmployment(env('school'), [account('school')], { read }))[0].Position, 'Director');
  current.Position = 'Operations Director';
  assert.equal((await withStaffEmployment(env('school'), [account('school')], { read }))[0].Position, 'Operations Director');
});

test('missing HR records preserve legacy fields; failures and conflicting links are not silently ignored', async () => {
  const original = { ...account('school'), Position: 'Legacy Director' };
  const [result] = await withStaffEmployment(env('school'), [original], { read: async () => [null] });
  assert.equal(result.Position, 'Legacy Director'); assert.deepEqual(result.Employment, {});
  await assert.rejects(withStaffEmployment(env('school'), [original], { read: async () => { throw Error('read failed'); } }), /read failed/);
  assert.throws(() => staffEmploymentDetails(original, [employee, { ...employee, Position: 'Other title' }], 'school'), /Conflicting HR Position/);
});

test('HR can clear optional fields without old values silently reappearing in the HR record', () => {
  const existing = { ...employee, EmergencyContact: 'Old contact' };
  const saved = normalizeHrEmployee({ Username: 'officer', Position: '', ManagerUsername: '', WorkEmail: '', Phone: '', EmergencyContact: '' }, existing);
  for (const field of ['Position', 'ManagerUsername', 'WorkEmail', 'Phone', 'EmergencyContact']) assert.equal(saved[field], '');
  assert.equal(existing.EmergencyContact, 'Old contact');
});

test('all consumers use the shared projection and preserve existing approval workflows', async () => {
  for (const file of ['functions/api/staff-records.js', 'functions/lib/executive-correspondence.js',
    'functions/api/staff-session.js', 'functions/api/backend.js']) {
    assert.match(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /withStaffEmployment\(env|withStaffEmployment\(context.env/);
  }
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.match(backend, /assertPayrollCanRegenerate\(existing\)/);
  assert.match(backend, /employmentPayrollProfile\(row, row\)/);
  const hr = await readFile(new URL('../functions/api/staff-hr.js', import.meta.url), 'utf8');
  assert.match(hr, /You cannot approve a pay or benefit change that you created/);
  assert.match(hr, /AccountDeactivated = true/);
  assert.match(hr, /updateTime: existing.__updateTime/);
  const clinic = await readFile(new URL('../js/clinic-referrals.js', import.meta.url), 'utf8');
  assert.match(clinic, /ClinicianTitle.value = result.signatory\?\.Position/);
});
