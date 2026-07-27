import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
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
