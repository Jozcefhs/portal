import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const adminJs = await readFile(new URL('js/admin.js', portalRoot), 'utf8');
const rendererStart = adminJs.indexOf('function organizedDepartmentWorkspace(data)');
const rendererEnd = adminJs.indexOf('function setOrganizationDepartmentWorkspaceTab', rendererStart);
const loaderStart = adminJs.indexOf('async function loadOrganizationDepartments()');
const loaderEnd = adminJs.indexOf('async function loadChurchServices()', loaderStart);
const helperStart = adminJs.indexOf('function resetOrganizationRecordEditor(form');
const helperEnd = adminJs.indexOf('function departmentOptions(', helperStart);

assert.notEqual(rendererStart, -1);
assert.notEqual(rendererEnd, -1);
assert.notEqual(loaderStart, -1);
assert.notEqual(loaderEnd, -1);
assert.notEqual(helperStart, -1);
assert.notEqual(helperEnd, -1);

const rendererSource = adminJs.slice(rendererStart, rendererEnd);
const loaderSource = adminJs.slice(loaderStart, loaderEnd);
const helperSource = adminJs.slice(helperStart, helperEnd);

function renderWithCapabilities(capabilities) {
  const context = {
    organizationDepartmentWorkspaceTab: 'members',
    clean: (value) => String(value ?? '').trim(),
    escapeHtml: (value) => String(value ?? ''),
    lower: (value) => String(value ?? '').trim().toLowerCase(),
    money: (value) => String(value ?? ''),
    verticalBars: () => '',
    departmentOptions: (rows) => `<option value="">Choose department</option>${rows.map((row) =>
      `<option value="${row.DepartmentId}">${row.Name}</option>`).join('')}`,
    table: (title, rows, columns) => `
      <section data-test-table="${title}">
        <h3>${title}</h3>
        ${rows.map((row) => columns.map((column) =>
          column.render ? column.render(row) : `<span>${column.value(row)}</span>`
        ).join('')).join('')}
      </section>`
  };
  vm.createContext(context);
  vm.runInContext(`${rendererSource}\nglobalThis.renderDepartmentWorkspace = organizedDepartmentWorkspace;`, context);
  return context.renderDepartmentWorkspace({
    capabilities,
    departments: [{
      DepartmentId: 'CHOIR',
      Name: 'Choir',
      DepartmentType: 'Department',
      Active: 'YES'
    }],
    departmentPositions: [{
      DepartmentId: 'CHOIR',
      PositionId: 'LEAD',
      Name: 'Choir Lead',
      Active: 'YES'
    }],
    members: [{
      MemberId: 'MEM-001',
      DisplayName: 'Ada Okafor',
      Phone: '+2348000000000',
      Email: 'ada@example.com',
      MembershipStatus: 'Active'
    }],
    departmentMembers: [],
    departmentMeetings: [],
    departmentAttendance: [],
    departmentOfferings: [],
    specialPrograms: [],
    programRegistrations: [],
    foreignVisitors: [],
    summaries: {}
  });
}

test('department, member and position editors preserve original IDs and expose compact edit states', () => {
  const html = renderWithCapabilities({
    canManageDepartments: true,
    canManageMembers: true
  });

  assert.match(html, /id="organizationDepartmentEditor"[^>]*data-record-id-field="DepartmentId"/);
  assert.match(html, /name="OriginalDepartmentId"/);
  assert.match(html, /id="organizationMemberEditor"[^>]*data-record-id-field="MemberId"/);
  assert.match(html, /name="OriginalMemberId"/);
  assert.match(html, /id="organizationPositionEditor"[^>]*data-record-id-field="PositionId"[^>]*data-record-parent-field="DepartmentId"/);
  assert.match(html, /name="OriginalPositionId"/);
  assert.match(html, /data-cancel-record-edit hidden/);
  assert.match(html, /data-edit-department="CHOIR"/);
  assert.match(html, /data-edit-member="MEM-001"/);
  assert.match(html, /data-edit-position="LEAD"/);
  assert.match(html, /data-position-department="CHOIR"/);
  assert.match(html, /Department positions/);
});

test('record edit controls are independently capability-gated', () => {
  const departmentManager = renderWithCapabilities({
    canManageDepartments: true,
    canManageMembers: false
  });
  assert.match(departmentManager, /data-edit-department="CHOIR"/);
  assert.match(departmentManager, /data-edit-position="LEAD"/);
  assert.doesNotMatch(departmentManager, /data-edit-member=/);

  const memberManager = renderWithCapabilities({
    canManageDepartments: false,
    canManageMembers: true
  });
  assert.doesNotMatch(memberManager, /data-edit-department=/);
  assert.doesNotMatch(memberManager, /data-edit-position=/);
  assert.match(memberManager, /data-edit-member="MEM-001"/);

  const viewer = renderWithCapabilities({
    canManageDepartments: false,
    canManageMembers: false
  });
  assert.doesNotMatch(viewer, /data-edit-department=/);
  assert.doesNotMatch(viewer, /data-edit-position=/);
  assert.doesNotMatch(viewer, /data-edit-member=/);
});

test('edit handlers switch workspaces, lock IDs, and reset after save or cancel', () => {
  assert.match(helperSource, /idInput\.readOnly = true/);
  assert.match(helperSource, /input\[name\^="Original"\]/);
  assert.match(helperSource, /idInput\.readOnly = false/);
  assert.match(helperSource, /parentInput\.disabled = true/);
  assert.match(helperSource, /parentInput\.disabled = false/);
  assert.match(helperSource, /cancelButton\.hidden = false/);
  assert.match(helperSource, /cancelButton\.hidden = true/);
  assert.match(loaderSource, /setOrganizationDepartmentWorkspaceTab\('departments'\)[\s\S]*?OriginalDepartmentId/);
  assert.match(loaderSource, /data-edit-member[\s\S]*?setOrganizationDepartmentWorkspaceTab\('members'\)[\s\S]*?OriginalMemberId/);
  assert.match(loaderSource, /data-edit-position[\s\S]*?OriginalPositionId[\s\S]*?OriginalDepartmentId/);
  assert.match(loaderSource, /data-cancel-record-edit[\s\S]*?resetOrganizationRecordEditor/);
  assert.match(loaderSource, /form\.matches\('\[data-record-id-field\]'\)[\s\S]*?resetOrganizationRecordEditor/);
});
