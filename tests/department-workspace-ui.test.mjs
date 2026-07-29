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

test('department creation shows an aligned active toggle and blocks repeated submissions', () => {
  assert.match(adminJs, /name="Active" value="YES" checked><span>Active<\/span>/);
  assert.match(portalCss, /\.inline-check\s*>\s*input\[type="checkbox"\][\s\S]*?flex:\s*0 0 16px/);
  assert.match(portalCss, /\.inline-check\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(adminJs, /data-loading-text="Saving department\.\.\."/);
  assert.match(adminJs, /form\.dataset\.submitting === 'true'/);
  assert.match(adminJs, /setButtonLoading\(submitButton, true, loadingText, normalText\)/);
  assert.match(adminJs, /delete form\.dataset\.submitting/);
  assert.match(adminJs, /payload\[input\.name\] = input\.checked \? \(input\.value \|\| 'YES'\) : 'NO'/);
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

test('department assignments expose a guarded remove action that preserves the member record', () => {
  assert.match(adminJs, /data-remove-department-member=/);
  assert.match(adminJs, /The member's main record will be kept/);
  assert.match(adminJs, /organizationDepartmentAction\('removeDepartmentMember'/);
  assert.match(adminJs, /setButtonLoading\(button, true, '', normalText\)/);
  assert.match(adminJs, /if \(button\.isConnected\) setButtonLoading\(button, false, '', normalText\)/);
});

test('members and departments can be imported from downloadable CSV templates', () => {
  assert.match(adminJs, /id="downloadDepartmentCsvTemplate"/);
  assert.match(adminJs, /id="importDepartmentsCsv"/);
  assert.match(adminJs, /id="departmentsCsvFile" accept="\.csv,text\/csv"/);
  assert.match(adminJs, /id="downloadMemberCsvTemplate"/);
  assert.match(adminJs, /id="importMembersCsv"/);
  assert.match(adminJs, /id="membersCsvFile" accept="\.csv,text\/csv"/);
  assert.match(adminJs, /function downloadCsvFile/);
  assert.match(adminJs, /async function importOrganizationCsv/);
  assert.match(adminJs, /action: 'importDepartments'/);
  assert.match(adminJs, /action: 'importMembers'/);
  assert.match(adminJs, /setButtonLoading\(button, true, options\.loadingText/);
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
