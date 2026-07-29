import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  authoritativeDepartmentMemberAssignment,
  departmentCapabilities,
  departmentSummaries,
  normalizedDepartment
} from '../functions/lib/organization-departments.js';

const departmentSource = await readFile(new URL('../functions/lib/organization-departments.js', import.meta.url), 'utf8');

test('department records normalize generic, home-cell and foreign-desk identities', () => {
  const home = normalizedDepartment({
    DepartmentId: 'CELL-01', Name: 'Central Home Cell', DepartmentType: 'Home Cell', AreaZone: 'Central'
  }, 'main');
  const foreign = normalizedDepartment({
    DepartmentId: 'FOREIGN', Name: 'Foreign Desk'
  }, 'main');
  assert.equal(home.IsHomeChurch, true);
  assert.equal(home.AreaZone, 'Central');
  assert.equal(foreign.IsForeignDesk, true);
});

test('department roles separate recordings from accounting remittance confirmation', () => {
  assert.equal(departmentCapabilities({ role: 'Membership Officer' }).canRecordMeetings, true);
  assert.equal(departmentCapabilities({ role: 'Membership Officer' }).canConfirmRemittance, false);
  assert.equal(departmentCapabilities({ role: 'Treasurer' }).canSubmitOfferings, true);
  assert.equal(departmentCapabilities({ role: 'Treasurer' }).canConfirmRemittance, true);
});

test('department summaries feed vertical charts, home-cell comparisons and country totals', () => {
  const result = departmentSummaries(
    [
      { DepartmentId: 'CELL-A', Name: 'Home A', DepartmentType: 'Home Cell', AreaZone: 'North' },
      { DepartmentId: 'CELL-B', Name: 'Home B', DepartmentType: 'Home Church', AreaZone: 'North' },
      { DepartmentId: 'CHOIR', Name: 'Choir', DepartmentType: 'Department' }
    ],
    [{ DepartmentId: 'CHOIR', Status: 'Active' }],
    [
      { MeetingId: 'M1', DepartmentId: 'CELL-A' },
      { MeetingId: 'M2', DepartmentId: 'CELL-B' }
    ],
    [
      { MeetingId: 'M1' }, { MeetingId: 'M1' }, { MeetingId: 'M2' }
    ],
    [
      { DepartmentId: 'CHOIR', Amount: 1000, RemittanceStatus: 'Unpaid' },
      { DepartmentId: 'CHOIR', Amount: 500, RemittanceStatus: 'Paid' }
    ],
    [{ Country: 'Nigeria' }, { Country: 'Nigeria' }, { Country: 'Ghana' }]
  );
  assert.deepEqual(result.homeChurchAreas, [{ AreaZone: 'North', HomeChurches: 2, Attendance: 3 }]);
  assert.equal(result.departments.find((row) => row.DepartmentId === 'CHOIR').Unremitted, 1000);
  assert.deepEqual(result.participantsByCountry, [
    { Country: 'Nigeria', Participants: 2 }, { Country: 'Ghana', Participants: 1 }
  ]);
});

test('department write actions persist the resolved branch without an undefined identifier', () => {
  assert.doesNotMatch(departmentSource, /(?:,\s*|\{\s*)BranchId(?=\s*[,}])/);
  assert.equal((departmentSource.match(/BranchId: branchId/g) || []).length >= 9, true);
});

test('department-member assignments hydrate identity and position names from authoritative records', () => {
  const assignment = authoritativeDepartmentMemberAssignment(
    {
      DepartmentId: 'CHOIR',
      MemberId: 'MEM-001',
      DisplayName: 'Forged browser name',
      PositionId: 'LEAD',
      PositionName: 'Forged browser position',
      JoinedDate: '2026-07-28'
    },
    'main',
    { DepartmentId: 'CHOIR', Name: 'Choir', BranchId: 'main' },
    { MemberId: 'MEM-001', DisplayName: 'Ada Okafor', BranchId: 'main' },
    { PositionId: 'LEAD', DepartmentId: 'CHOIR', Name: 'Choir Lead', BranchId: 'main' }
  );
  assert.equal(assignment.DisplayName, 'Ada Okafor');
  assert.equal(assignment.PositionName, 'Choir Lead');
  assert.equal(assignment.DepartmentName, 'Choir');
  assert.equal(assignment.JoinedDate, '2026-07-28');
});

test('department-member assignments reject missing, cross-branch and cross-department records', () => {
  const base = { DepartmentId: 'CHOIR', MemberId: 'MEM-001', PositionId: 'LEAD' };
  const department = { DepartmentId: 'CHOIR', Name: 'Choir', BranchId: 'main' };
  const member = { MemberId: 'MEM-001', DisplayName: 'Ada Okafor', BranchId: 'main' };
  const position = { PositionId: 'LEAD', DepartmentId: 'CHOIR', Name: 'Choir Lead', BranchId: 'main' };

  assert.throws(
    () => authoritativeDepartmentMemberAssignment(base, 'main', department, null, position),
    /member was not found in this branch/i
  );
  assert.throws(
    () => authoritativeDepartmentMemberAssignment(
      base,
      'main',
      department,
      { ...member, BranchId: 'abuja' },
      position
    ),
    /member was not found in this branch/i
  );
  assert.throws(
    () => authoritativeDepartmentMemberAssignment(
      base,
      'main',
      department,
      member,
      { ...position, DepartmentId: 'USHERS' }
    ),
    /does not belong to this department/i
  );
});

test('department endpoint exposes member creation while preserving membership and branch guards', () => {
  assert.match(
    departmentSource,
    /import\s+\{[^}]*resolveMembershipBranch[^}]*saveChurchMember[^}]*\}\s+from '\.\/church-membership\.js'/
  );
  assert.match(departmentSource, /\['savemember', 'savechurchmember'\]\.includes\(action\)/);
  assert.match(departmentSource, /requireCapability\(user, 'canManageMembers'\)/);
  assert.match(departmentSource, /saveChurchMember\(env, user, \{ \.\.\.body, BranchId: branchId \}\)/);
});

test('department membership can be removed without deleting the master member record', () => {
  assert.match(departmentSource, /async function removeDepartmentMember/);
  assert.match(departmentSource, /requireCapability\(user, 'canManageMembers'\)/);
  assert.match(departmentSource, /operation:\s*'delete'/);
  assert.match(departmentSource, /batchUpsertDocuments\(env,\s*\[\s*\{/);
  assert.match(departmentSource, /departmentAuditWrite\([\s\S]*?'REMOVE'/);
  assert.doesNotMatch(departmentSource, /deleteDocument\(env, path\('members', branchId\), membershipId\)/);
  assert.match(departmentSource, /action === 'removedepartmentmember'/);
});

test('member and position deletion is guarded, branch scoped, audited and routed', () => {
  assert.match(departmentSource, /async function deleteMember/);
  assert.match(departmentSource, /Remove this member from every department before deleting the member profile/);
  assert.match(departmentSource, /async function deletePosition/);
  assert.match(departmentSource, /Reassign or remove every member using this position before deleting it/);
  assert.match(departmentSource, /departmentAuditWrite\([\s\S]*?'DELETE'[\s\S]*?'Member'/);
  assert.match(departmentSource, /departmentAuditWrite\([\s\S]*?'DELETE'[\s\S]*?'Position'/);
  assert.match(departmentSource, /operation:\s*'delete'/);
  assert.match(departmentSource, /action === 'deletemember'/);
  assert.match(departmentSource, /action === 'deleteposition'/);
});

test('department workspace supports validated batch imports for members and departments', () => {
  assert.match(departmentSource, /importChurchMembers/);
  assert.match(departmentSource, /\['importmembers', 'importchurchmembers'\]\.includes\(action\)/);
  assert.match(departmentSource, /async function importDepartments/);
  assert.match(departmentSource, /validatedCsvImportRows\(body\.departments, 'department'\)/);
  assert.match(departmentSource, /Duplicate DepartmentId in import/);
  assert.match(departmentSource, /batchUpsertDocuments\(env, writes\)/);
  assert.match(departmentSource, /action === 'importdepartments'/);
});
