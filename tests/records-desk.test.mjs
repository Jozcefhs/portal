import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  allowedRecordsDeskTypes,
  donorDetailProjection,
  donorSearchCard,
  memberDetailProjection,
  normalizeRecordsDeskQuery,
  recordMatches,
  recordsDeskCapabilities,
  recordsDeskLimit,
  staffRecordMatchesEdition,
  staffDetailProjection,
  studentDetailProjection,
  studentSearchCard
} from '../functions/lib/records-desk.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';
import { donorDirectoryRows } from '../functions/api/staff-records.js';

const portalRoot = new URL('../', import.meta.url);
const [apiSource, adminJs, portalCss, staffAuth] = await Promise.all([
  readFile(new URL('functions/api/staff-records.js', portalRoot), 'utf8'),
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('functions/lib/staff-auth.js', portalRoot), 'utf8')
]);

test('record types are derived from the signed-in edition and allowed sections', () => {
  const schoolAccounts = recordsDeskCapabilities({
    edition: 'school',
    role: 'Accounts Officer',
    allowedSections: ['recordsDesk', 'students', 'accounts']
  });
  assert.deepEqual(allowedRecordsDeskTypes(schoolAccounts), ['students']);
  assert.equal(schoolAccounts.canViewStudentFinance, true);
  assert.equal(schoolAccounts.canViewStudentClinic, false);
  assert.equal(schoolAccounts.canViewStudentConduct, false);

  const welfare = recordsDeskCapabilities({
    edition: 'school',
    role: 'Student Welfare Officer',
    allowedSections: ['recordsDesk', 'studentConduct']
  });
  assert.deepEqual(allowedRecordsDeskTypes(welfare), ['students']);
  assert.equal(welfare.canViewStudentConduct, true);

  const membershipOfficer = recordsDeskCapabilities({
    edition: 'faith',
    role: 'Membership Officer',
    allowedSections: ['recordsDesk', 'members', 'services']
  });
  assert.deepEqual(allowedRecordsDeskTypes(membershipOfficer), ['members', 'departments']);
  assert.equal(membershipOfficer.canViewPastoralNotes, false);

  const treasurer = recordsDeskCapabilities({
    edition: 'faith',
    role: 'Treasurer',
    allowedSections: ['recordsDesk', 'funds', 'offerings', 'donations']
  });
  assert.deepEqual(allowedRecordsDeskTypes(treasurer), ['departments', 'donors']);
  assert.equal(treasurer.canSearchMembers, false);
  assert.equal(treasurer.canViewDepartmentFinance, true);
  assert.equal(treasurer.canViewDonorContact, true);

  const delegatedStaffTab = recordsDeskCapabilities({
    edition: 'school',
    role: 'Management',
    allowedSections: ['recordsDesk', 'staffUsers']
  });
  assert.equal(delegatedStaffTab.canSearchStaff, false);
});

test('staff directory records never cross organisation editions', () => {
  const legacySchoolStaff = { Username: 'school.teacher', Role: 'Department User' };
  const schoolStaff = { Username: 'school.principal', OrganisationEdition: 'school' };
  const faithStaff = { Username: 'faith.pastor', OrganisationEdition: 'church' };
  const otherStaff = { Username: 'other.manager', OrganisationEdition: 'organization' };

  assert.equal(staffRecordMatchesEdition(legacySchoolStaff, { edition: 'school', username: 'admin' }), true);
  assert.equal(staffRecordMatchesEdition(legacySchoolStaff, { edition: 'faith', username: 'faith.admin' }), false);
  assert.equal(staffRecordMatchesEdition(schoolStaff, { edition: 'faith', username: 'faith.admin' }), false);
  assert.equal(staffRecordMatchesEdition(faithStaff, { edition: 'faith', username: 'faith.admin' }), true);
  assert.equal(staffRecordMatchesEdition(faithStaff, { edition: 'church', username: 'faith.admin' }), true);
  assert.equal(staffRecordMatchesEdition(otherStaff, { edition: 'faith', username: 'faith.admin' }), false);
  assert.equal(staffRecordMatchesEdition(legacySchoolStaff, { edition: 'faith', username: 'school.teacher' }), true);
});

test('student projections whitelist fields and keep credentials out of every response', () => {
  const row = {
    AdmissionNo: 'DCA/26/001',
    DisplayName: 'Ada Grace',
    ClassName: 'JSS 1',
    ParentEmail: 'parent@example.com',
    ParentLoginCode: 'SECRET-CODE',
    VerificationCode: 'VERIFY-ME',
    WalletCardId: 'CARD-PRIVATE',
    WalletPinHash: 'PIN-HASH',
    PasswordHash: 'PASSWORD-HASH',
    BloodGroup: 'O+',
    MedicalCondition: 'Asthma'
  };
  const detail = studentDetailProjection(row, {
    canViewStudentContact: true,
    canViewStudentClinic: false
  });
  const json = JSON.stringify(detail);
  assert.match(json, /parent@example\.com/);
  assert.doesNotMatch(json, /SECRET-CODE|VERIFY-ME|CARD-PRIVATE|PIN-HASH|PASSWORD-HASH|Asthma|O\+/);
  assert.deepEqual(studentSearchCard(row), {
    type: 'students',
    id: 'DCA/26/001',
    title: 'Ada Grace',
    subtitle: 'DCA/26/001 · JSS 1',
    status: 'Active',
    branchId: 'main',
    schoolSection: ''
  });
});

test('medical and pastoral detail appears only for the corresponding privileged roles', () => {
  const clinicDetail = studentDetailProjection({
    AdmissionNo: 'DCA/26/001',
    DisplayName: 'Ada',
    MedicalCondition: 'Asthma'
  }, { canViewStudentClinic: true });
  assert.match(JSON.stringify(clinicDetail), /Asthma/);

  const member = {
    MemberId: 'MEM-1',
    DisplayName: 'James Hope',
    Email: 'james@example.com',
    PastoralNotes: 'Private care note'
  };
  const officer = JSON.stringify(memberDetailProjection(member, {
    canViewMemberContact: true,
    canViewPastoralNotes: false
  }));
  const pastor = JSON.stringify(memberDetailProjection(member, {
    canViewMemberContact: true,
    canViewPastoralNotes: true
  }));
  assert.doesNotMatch(officer, /Private care note/);
  assert.match(pastor, /Private care note/);
});

test('donor cards and details expose useful giving identity without leaking restricted notes', () => {
  const donor = {
    DonorId: 'DONOR-nancy@example.test',
    DisplayName: 'Nancy Gregory',
    Email: 'nancy@example.test',
    Phone: '+2348012345678',
    Notes: 'Contact only through the finance office',
    DonorType: 'Registered donor',
    ContributionCount: 2
  };
  assert.deepEqual(donorSearchCard(donor), {
    type: 'donors',
    id: 'DONOR-nancy@example.test',
    title: 'Nancy Gregory',
    subtitle: 'nancy@example.test Â· +2348012345678 Â· 2 contributions',
    status: 'Registered donor',
    branchId: 'main',
    schoolSection: ''
  });
  assert.doesNotMatch(JSON.stringify(donorDetailProjection(donor, {
    canViewDonorContact: true,
    canViewDonorNotes: false
  })), /Contact only through/);
  assert.match(JSON.stringify(donorDetailProjection(donor, {
    canViewDonorContact: true,
    canViewDonorNotes: true
  })), /Contact only through/);
});

test('donor directory includes occasional donors and does not merge different people using one receipt email', () => {
  const rows = donorDirectoryRows([], [{
    DonationId: 'D1',
    DonorName: 'Nancy Gregory',
    DonorEmail: 'finance@example.test',
    Amount: 1000,
    Currency: 'NGN'
  }, {
    DonationId: 'D2',
    DonorName: 'Nnamdi Jerry',
    DonorEmail: 'finance@example.test',
    Amount: 500,
    Currency: 'USD'
  }, {
    DonationId: 'D3',
    DonorName: 'Nancy Gregory',
    DonorEmail: 'finance@example.test',
    Amount: 2000,
    Currency: 'NGN'
  }]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.DisplayName === 'Nancy Gregory').ContributionCount, 2);
  assert.equal(rows.find((row) => row.DisplayName === 'Nnamdi Jerry').ContributionCount, 1);
  assert.equal(recordMatches(rows[0], 'finance@example.test', ['Email']), true);
  assert.equal(rows.every((row) => row.DonorType === 'Occasional donor'), true);
});

test('staff directory projection never returns password or approval secrets', () => {
  const detail = staffDetailProjection({
    Username: 'staff.user',
    DisplayName: 'Staff User',
    Role: 'Front Desk',
    Active: true,
    PasswordHash: 'HASH',
    DesktopPassword: 'DESKTOP',
    ApprovalAccounts: ['1000'],
    ProfilePhotoDataUrl: 'data:image/png;base64,PRIVATE'
  }, { canViewStaffSecurity: true });
  assert.doesNotMatch(JSON.stringify(detail), /HASH|DESKTOP|ApprovalAccounts|PRIVATE/);
});

test('search normalization, matching and output limits remain bounded', () => {
  assert.equal(normalizeRecordsDeskQuery(`  ADA   GRACE ${'x'.repeat(200)}`).length, 120);
  assert.equal(recordMatches({ DisplayName: 'Ada Grace Okafor', AdmissionNo: 'DCA/26/001' }, 'ada okafor', ['DisplayName', 'AdmissionNo']), true);
  assert.equal(recordMatches({ DisplayName: 'Ada Grace' }, 'peter', ['DisplayName']), false);
  assert.equal(recordsDeskLimit(500), 40);
  assert.equal(recordsDeskLimit('bad'), 24);
});

test('records API requires a live staff session, scopes every type, audits record views, and gates finance', () => {
  assert.match(apiSource, /requireStaffSession\(env, request\)/);
  assert.match(apiSource, /recordsDeskCapabilities\(user\)/);
  assert.match(apiSource, /visibleSchoolRecord\(row, user, branchId\)/);
  assert.match(apiSource, /staffRecordMatchesEdition\(row, user\)/);
  assert.match(apiSource, /resolveMembershipBranch\(user, branchId\)/);
  assert.match(apiSource, /CHURCH_COLLECTIONS\.donors, organisationBranch/);
  assert.match(apiSource, /CHURCH_COLLECTIONS\.donations, organisationBranch/);
  assert.match(apiSource, /donorDirectoryRows\(donors, donations, organisationBranch\)/);
  assert.match(apiSource, /type === 'donors'\) detail = donorDetail/);
  assert.match(apiSource, /query\.length < 3/);
  assert.match(apiSource, /recordsDeskLimit\(body\.limit\)/);
  assert.match(apiSource, /capabilities\.canViewStudentFinance \? listCollection\(env, 'payments'\)/);
  assert.match(apiSource, /capabilities\.canViewStudentConduct[\s\S]*?listSchoolCollection\(env, 'studentConductCases'/);
  assert.match(apiSource, /title: 'Conduct & discipline'/);
  assert.match(apiSource, /No conduct cases recorded/);
  assert.match(apiSource, /row\.StudentRef/);
  assert.match(apiSource, /legacyStudentReferenceIsUnique\(env, row\)\.catch\(\(\) => false\)/);
  assert.match(apiSource, /if \(!itemBranch && !legacyReferenceIsSafe\) return false/);
  assert.match(apiSource, /if \(!itemSection && !legacyReferenceIsSafe\) return false/);
  assert.match(apiSource, /pageSize: '500'/);
  assert.match(apiSource, /remainingRequests = Math\.min\(12, Math\.max\(0, 38 - paths\.length\)\)/);
  assert.match(apiSource, /row\.ApplicationID,\s*row\.__id/);
  assert.doesNotMatch(apiSource, /writeAudit\(env, user, 'SEARCH'/);
  assert.match(apiSource, /writeAudit\(env, user, 'VIEW'/);
  assert.match(apiSource, /Cache-Control': 'no-store/);
  assert.doesNotMatch(apiSource, /BACKEND_SHARED_SECRET|GOOGLE_APPS_SCRIPT_SECRET/);
});

test('student conduct history is permission-gated and rendered in the student profile', () => {
  assert.match(apiSource, /allowed\.has\('studentConduct'\).*Open Conduct & Discipline/);
  assert.match(apiSource, /item\.Resolution \? `Resolution:/);
  assert.match(adminJs, /row\.detail \? `<small>\$\{escapeHtml\(row\.detail\)\}<\/small>`/);
  assert.match(adminJs, /takeRecordsDeskHandoff\('studentConduct'\)/);
});

test('role defaults expose Records Desk without weakening member privacy', () => {
  assert.match(staffAuth, /'Super Admin': \['recordsDesk'/);
  assert.match(staffAuth, /'Accounts Officer': \['recordsDesk'/);
  assert.match(staffAuth, /'Membership Officer': \['recordsDesk', 'members', 'services'\]/);
  assert.match(staffAuth, /Treasurer: \['recordsDesk', 'funds'/);
});

test('existing custom access derives Records Desk without widening its source permissions', () => {
  const accounts = allowedSectionsFor({
    Role: 'Accounts Officer',
    TabAccess: ['accounts', 'financeRequests']
  });
  const unrelated = allowedSectionsFor({
    Role: 'Department User',
    TabAccess: ['payroll', 'financeRequests']
  });
  assert.equal(accounts.includes('recordsDesk'), true);
  assert.equal(accounts.includes('students'), false);
  assert.equal(accounts.includes('clinic'), false);
  assert.equal(unrelated.includes('recordsDesk'), false);
});

test('records workspace is three-pane on desktop and list-to-detail on mobile', () => {
  assert.match(adminJs, /\['recordsDesk', 'Records Desk'\]/);
  assert.match(adminJs, /recordsDeskSearchTimer = window\.setTimeout\(\(\) => searchRecordsDesk\(\{ keepFocus: true \}\), 450\)/);
  assert.match(adminJs, /class="records-desk-shell\$\{recordsDeskState\.detail \|\| recordsDeskState\.loadingDetail \? ' detail-open' : ''\}"/);
  assert.match(adminJs, /sessionStorage\.setItem\('dynamaxRecordsDeskContext'/);
  assert.doesNotMatch(adminJs, /recordsDesk[\s\S]{0,200}recordManualPayment/);
  assert.match(portalCss, /\.records-desk-shell\{display:grid;grid-template-columns:minmax\(230px,270px\) minmax\(310px,360px\) minmax\(380px,1fr\)/);
  assert.match(portalCss, /@media \(max-width:680px\)\{[\s\S]*?\.records-desk-shell\.detail-open \.records-desk-filters,[\s\S]*?display:none/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.records-desk-shell/);
});
