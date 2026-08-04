import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  HUMAN_RESOURCES_ROLES,
  hrCapabilitiesFor,
  humanResourcesRole,
  leaveDays,
  normalizeHrCandidate,
  normalizeHrCompensationChange,
  normalizeHrCompliance,
  normalizeHrEmployee,
  normalizeHrEmployeeCase,
  normalizeHrEmploymentHistory,
  normalizeHrExit,
  normalizeHrLeave,
  normalizeHrReview,
  normalizeHrTimeRecord,
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
  assert.equal(manager.canManageEmploymentHistory, true);
  assert.equal(manager.canManageCompensation, true);
  assert.equal(manager.canReviewCompensation, true);
  assert.equal(manager.canManageTime, true);
  assert.equal(manager.canManageRelations, true);
  assert.equal(manager.canManageDiscipline, true);
  assert.equal(manager.canManageCompliance, true);
  assert.equal(manager.canManageExit, true);

  const recruiter = hrCapabilitiesFor({ role: 'Recruitment Officer' });
  assert.equal(recruiter.canManageRecruitment, true);
  assert.equal(recruiter.canManagePeople, false);
  assert.equal(recruiter.canApproveLeave, false);

  const payroll = hrCapabilitiesFor({ role: 'Payroll Officer' });
  assert.equal(payroll.canViewDirectory, true);
  assert.equal(payroll.canManagePeople, false);
  assert.equal(payroll.canManageRecruitment, false);
  assert.equal(payroll.canReviewCompensation, true);
  assert.equal(payroll.canManageCompensation, false);

  const relations = hrCapabilitiesFor({ role: 'Employee Relations Officer' });
  assert.equal(relations.canManageRelations, true);
  assert.equal(relations.canManageDiscipline, true);
  assert.equal(relations.canManageExit, true);

  const lineManager = hrCapabilitiesFor({ role: 'Line Manager' });
  assert.equal(lineManager.canManageTime, true);
  assert.equal(lineManager.canManageCompensation, false);
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

test('candidate pipeline covers applications, interviews, checks and selection', () => {
  const candidate = normalizeHrCandidate({
    VacancyId: 'VAC-1', CandidateName: 'Ada Candidate', Email: 'ADA@example.com',
    QualificationCheck: 'Verified', ReferenceCheck: 'Pending', Status: 'Interview'
  });
  assert.equal(candidate.Email, 'ada@example.com');
  assert.equal(candidate.Status, 'Interview');
  assert.throws(() => normalizeHrCandidate({ VacancyId: 'VAC-1', CandidateName: 'No Contact' }), /email or phone/);
  assert.throws(() => normalizeHrCandidate({ VacancyId: 'VAC-1', CandidateName: 'Ada', Phone: '1', Status: 'Hired secretly' }), /candidate status/);
});

test('employment journey records cover documents, pay, attendance, relations, compliance and exit', () => {
  assert.equal(normalizeHrEmploymentHistory({
    Username: 'Ada', RecordType: 'Promotion', Title: 'Promoted to manager', EffectiveDate: '2026-08-04'
  }).Username, 'ada');
  assert.equal(normalizeHrCompensationChange({
    Username: 'Ada', ChangeType: 'Allowance', Amount: '12500.50', EffectiveDate: '2026-09-01', Details: 'Transport allowance'
  }).Amount, 12500.5);
  assert.equal(normalizeHrTimeRecord({
    Username: 'Ada', RecordType: 'Lateness', WorkDate: '2026-08-04', Status: 'Excused'
  }).Status, 'Excused');
  assert.equal(normalizeHrEmployeeCase({
    Username: 'Ada', CaseType: 'Welfare concern', OpenedDate: '2026-08-04', Summary: 'Support required'
  }).Severity, 'Moderate');
  assert.equal(normalizeHrCompliance({
    Category: 'Pension', Obligation: 'Submit monthly pension schedule', Status: 'In progress'
  }).Category, 'Pension');
  const exit = normalizeHrExit({
    Username: 'Ada', ExitType: 'Retirement', LastWorkingDate: '2026-12-31', ClearanceStatus: 'In progress'
  });
  assert.equal(exit.Username, 'ada');
  assert.equal(exit.FinalPayStatus, 'Pending');
  assert.throws(() => normalizeHrCompensationChange({
    Username: 'Ada', ChangeType: 'Bonus', Amount: -1, EffectiveDate: '2026-09-01', Details: 'Invalid'
  }), /positive amount/);
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
  for (const label of ['People', 'Records', 'Time & leave', 'Recruitment', 'Performance', 'Training', 'Pay & benefits', 'Relations & conduct', 'Compliance', 'Exit']) {
    assert.match(adminJs, new RegExp(`label: '${label}'`));
  }
  assert.match(apiSource, /requireStaffSession/);
  assert.match(apiSource, /Human Resources is not available to this account/);
  assert.match(apiSource, /you cannot approve your own leave request/i);
  assert.match(apiSource, /hrLifecycleRecords/);
  for (const recordKind of ['Candidate', 'EmploymentHistory', 'Compensation', 'TimeRecord', 'EmployeeCase', 'Compliance', 'Exit']) {
    assert.match(apiSource, new RegExp(`recordKind: '${recordKind}'`));
  }
  for (const action of ['savecandidate', 'saveemploymenthistory', 'savecompensation', 'reviewcompensation', 'savetimerecord', 'saveemployeecase', 'savecompliance', 'saveexit']) {
    assert.match(apiSource, new RegExp(action));
    assert.match(adminJs, new RegExp(action));
  }
  assert.match(portalCss, /\.hr-role-guide/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.hr-role-guide/);
  assert.match(portalCss, /@media\(max-width:620px\)/);
});

test('completing an employee exit deactivates access and excludes exited staff from the active total', () => {
  assert.match(apiSource, /Active: false/);
  assert.match(apiSource, /Automatically deactivated after completed/);
  assert.match(apiSource, /At least one active Super Admin must remain/);
  assert.match(apiSource, /Employee exit completed and staff account deactivated/);
  assert.match(apiSource, /batchCommitDocuments\(env, writes\)/);
  assert.match(apiSource, /AccessSyncStatus = 'Completed'/);
  assert.match(apiSource, /REPAIR COMPLETED EMPLOYEE EXIT/);
  assert.match(adminJs, /inactive\|suspended\|terminated\|exited/i);
  assert.match(adminJs, /data-repair-hr-exit/);
  assert.match(adminJs, /Access disabled/);
});

test('HR people can be searched wherever an existing staff record is required', () => {
  assert.match(adminJs, /function hrPersonPicker\(/);
  assert.match(adminJs, /function bindHrPersonPickers\(/);
  assert.match(adminJs, /data-hr-person-search/);
  assert.match(adminJs, /Name, ID, email, phone or department/);
  assert.match(adminJs, /function bindHrWorkspaceSearch\(/);
  assert.equal([...adminJs.matchAll(/hrPersonPicker\('hr[A-Z][^']*'/g)].length, 10);
  for (const field of [
    'hrEmployeeUsername', 'hrEmployeeManager', 'hrHistoryUsername', 'hrLeaveUsername', 'hrTimeUsername',
    'hrReviewUsername', 'hrTrainingUsername', 'hrCompensationUsername', 'hrCaseUsername', 'hrExitUsername'
  ]) assert.match(adminJs, new RegExp(field));
  assert.match(portalCss, /\.hr-person-picker/);
  assert.match(portalCss, /\.hr-workspace-actions/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.hr-person-picker/);
});
