import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [adminJs, portalCss] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8')
]);

test('departments and members use focused task-based workspaces', () => {
  assert.match(adminJs, /function organizedDepartmentWorkspace\(data\)/);
  assert.match(adminJs, /\['overview', '▦', 'Overview'\]/);
  assert.match(adminJs, /\['departments', '⌂', 'Departments'\]/);
  assert.match(adminJs, /\['members', '♟', 'Members & Positions'\]/);
  assert.match(adminJs, /\['meetings', '▣', 'Meetings & Attendance'\]/);
  assert.match(adminJs, /\['offerings', '₦', 'Offerings'\]/);
  assert.match(adminJs, /\['programs', '★', 'Programs & Visitors'\]/);
  assert.match(adminJs, /data-organization-workspace-panel="overview"/);
  assert.match(adminJs, /panel\.hidden = panel\.dataset\.organizationWorkspacePanel/);
  assert.match(adminJs, /panelEl\.innerHTML = organizedDepartmentWorkspace\(data\)/);
});

test('department workspace preserves forms, registers and direct editing', () => {
  [
    'saveDepartment',
    'saveChurchMember',
    'savePosition',
    'saveDepartmentMember',
    'saveMeeting',
    'recordAttendance',
    'saveOffering',
    'saveProgram',
    'registerParticipant',
    'saveForeignVisitor'
  ].forEach((action) => assert.match(adminJs, new RegExp(`data-department-action="${action}"`)));
  assert.match(adminJs, /data-edit-department=/);
  assert.match(adminJs, /organizationDepartmentEditor/);
  assert.match(adminJs, /Department register/);
  assert.match(adminJs, /Attendance register/);
  assert.match(adminJs, /Program participants/);
});

test('members can be registered before they are assigned to a department', () => {
  assert.match(adminJs, /<h3>Register a member<\/h3>/);
  assert.match(adminJs, /name="MemberId" value="MEM-\$\{Date\.now\(\)\}"/);
  assert.match(adminJs, /name="DisplayName" placeholder="Full display name" required/);
  assert.match(adminJs, /<h3>Assign a member<\/h3>/);
  assert.match(adminJs, /No registered members .* create one first/);
  assert.match(adminJs, /Registered members/);
  assert.match(adminJs, /data-department-id="\$\{escapeHtml\(row\.DepartmentId\)\}"/);
  assert.match(adminJs, /clean\(option\.dataset\.departmentId\) === departmentId/);
});

test('department workspace is responsive and supports dark mode', () => {
  assert.match(portalCss, /\.organization-workspace-tabs/);
  assert.match(portalCss, /\.organization-workspace-panel\[hidden\]/);
  assert.match(portalCss, /\.department-two-column-grid/);
  assert.match(portalCss, /\.department-three-column-grid/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.organization-workspace-tabs/);
  assert.match(portalCss, /\.department-member-onboarding/);
  assert.match(portalCss, /html\[data-theme="dark"\] \.department-member-onboarding/);
  assert.match(portalCss, /@media \(max-width: 640px\)[\s\S]*?\.organization-workspace-tabs/);
});
