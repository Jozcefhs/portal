import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  HUMAN_RESOURCES_ROLES,
  hrCapabilitiesFor,
  humanResourcesRole,
  leaveDays,
  normalizeHrEmployee,
  normalizeHrLeave,
  normalizeHrReview,
  normalizeHrTraining,
  normalizeHrVacancy,
  safeHrStaffUser
} from '../functions/lib/human-resources.js';

const adminJs = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const portalCss = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../functions/api/staff-hr.js', import.meta.url), 'utf8');
const desktopSource = await readFile(new URL('../../suite/main.py', import.meta.url), 'utf8');

test('HR role catalogue covers leadership and specialist responsibilities', () => {
  for (const role of [
    'HR Director', 'HR Manager', 'HR Business Partner', 'HR Officer', 'HR Assistant', 'Recruitment Officer',
    'Learning & Development Officer', 'Employee Relations Officer',
    'Performance Management Officer', 'Compensation & Benefits Officer',
    'Payroll Officer', 'Health & Safety Officer', 'Line Manager'
  ]) {
    assert.equal(HUMAN_RESOURCES_ROLES.includes(role), true);
    assert.equal(humanResourcesRole(role), true);
    assert.match(adminJs, new RegExp(role.replace(/[&]/g, '\\&')));
    assert.match(desktopSource, new RegExp(role.replace(/[&]/g, '\\&')));
  }
});

test('HR capabilities follow least privilege rather than granting every HR tool to every role', () => {
  const manager = hrCapabilitiesFor({ role: 'HR Manager' });
  assert.equal(manager.canManagePeople, true);
  assert.equal(manager.canApproveLeave, true);
  assert.equal(manager.canManageRecruitment, true);
  assert.equal(manager.canManagePerformance, true);
  assert.equal(manager.canManageTraining, true);

  const recruiter = hrCapabilitiesFor({ role: 'Recruitment Officer' });
  assert.equal(recruiter.canManageRecruitment, true);
  assert.equal(recruiter.canManagePeople, false);
  assert.equal(recruiter.canApproveLeave, false);

  const payroll = hrCapabilitiesFor({ role: 'Payroll Officer' });
  assert.equal(payroll.canViewDirectory, true);
  assert.equal(payroll.canManagePeople, false);
  assert.equal(payroll.canManageRecruitment, false);
});

test('HR records are normalized and leave duration is calculated inclusively', () => {
  assert.equal(leaveDays('2026-08-03', '2026-08-05'), 3);
  assert.equal(leaveDays('2026-08-05', '2026-08-03'), 0);
  assert.deepEqual(normalizeHrEmployee({
    Username: ' Ada ', DisplayName: 'Ada Staff', Position: 'Teacher', Department: 'Academic'
  }), {
    EmployeeId: '', Username: 'ada', DisplayName: 'Ada Staff', Position: 'Teacher', Department: 'Academic',
    EmploymentType: 'Permanent', HireDate: '', ManagerUsername: '', WorkEmail: '', Phone: '', EmergencyContact: '', Status: 'Active'
  });
  const leave = normalizeHrLeave({
    StartDate: '2026-08-03', EndDate: '2026-08-05', LeaveType: 'Annual leave', Reason: 'Annual break'
  }, { username: 'Ada', displayName: 'Ada Staff' });
  assert.equal(leave.Username, 'ada');
  assert.equal(leave.Days, 3);
  assert.throws(() => normalizeHrLeave({ StartDate: '2026-08-05', EndDate: '2026-08-03', Reason: 'Invalid' }, { username: 'ada' }), /on or after/);
});

test('recruitment, performance and training validations preserve useful HR data', () => {
  assert.equal(normalizeHrVacancy({ Title: 'Teacher', Department: 'Academic', Openings: 2 }).Openings, 2);
  assert.equal(normalizeHrReview({ Username: 'Ada', ReviewPeriod: '2026', Rating: 4 }).Rating, 4);
  assert.throws(() => normalizeHrReview({ Username: 'Ada', ReviewPeriod: '2026', Rating: 8 }), /between 1 and 5/);
  assert.equal(normalizeHrTraining({ Username: 'Ada', Course: 'Safeguarding' }).Status, 'Planned');
});

test('staff directory projection excludes credentials', () => {
  const safe = safeHrStaffUser({
    Username: 'ada', DisplayName: 'Ada Staff', Role: 'HR Officer', PasswordHash: 'secret', Salt: 'secret'
  });
  assert.equal(safe.Username, 'ada');
  assert.equal('PasswordHash' in safe, false);
  assert.equal('Salt' in safe, false);
});

test('HR web workspace is tabbed, responsive and backed by a protected API', () => {
  assert.match(adminJs, /\['humanResources', 'Human Resources'\]/);
  assert.match(adminJs, /\/api\/staff-hr/);
  for (const label of ['People', 'Leave', 'Recruitment', 'Performance', 'Training']) {
    assert.match(adminJs, new RegExp(`label: '${label}'`));
  }
  assert.match(apiSource, /requireStaffSession/);
  assert.match(apiSource, /Human Resources is not available to this account/);
  assert.match(apiSource, /you cannot approve your own leave request/i);
  assert.match(portalCss, /\.hr-role-guide/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.hr-role-guide/);
  assert.match(portalCss, /@media\(max-width:620px\)/);
});
