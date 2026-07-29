import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const adminJs = await readFile(new URL('js/admin.js', portalRoot), 'utf8');
const functionStart = adminJs.indexOf('function organizedDepartmentWorkspace(data)');
const functionEnd = adminJs.indexOf('function setOrganizationDepartmentWorkspaceTab', functionStart);

assert.notEqual(functionStart, -1);
assert.notEqual(functionEnd, -1);

const rendererSource = adminJs.slice(functionStart, functionEnd);

function renderWithCapabilities(capabilities) {
  const context = {
    organizationDepartmentWorkspaceTab: 'members',
    clean: (value) => String(value ?? '').trim(),
    escapeHtml: (value) => String(value ?? ''),
    lower: (value) => String(value ?? '').trim().toLowerCase(),
    money: (value) => String(value ?? ''),
    verticalBars: () => '',
    departmentOptions: () => '<option value="">Choose department</option>',
    table: (title, rows, columns) => `
      <section data-test-table="${title}">
        <h3>${title}</h3>
        <div>${columns.map((column) => `<span data-test-column="${column.label}">${column.label}</span>`).join('')}</div>
        ${rows.map((row) => columns.map((column) =>
          column.render ? column.render(row) : `<span>${column.value(row)}</span>`
        ).join('')).join('')}
      </section>`
  };
  vm.createContext(context);
  vm.runInContext(`${rendererSource}\nglobalThis.renderDepartmentWorkspace = organizedDepartmentWorkspace;`, context);
  return context.renderDepartmentWorkspace({
    capabilities,
    departments: [{ DepartmentId: 'CHOIR', Name: 'Choir', Active: 'YES' }],
    departmentPositions: [{
      DepartmentId: 'CHOIR',
      PositionId: 'LEAD',
      Name: 'Choir Lead',
      Active: 'YES'
    }],
    members: [{
      MemberId: 'MEM-001',
      DisplayName: 'Ada Okafor',
      MembershipStatus: 'Active'
    }],
    departmentMembers: [{
      MembershipId: 'CHOIR--MEM-001',
      DepartmentId: 'CHOIR',
      DepartmentName: 'Choir',
      MemberId: 'MEM-001',
      DisplayName: 'Ada Okafor',
      Status: 'Active'
    }],
    departmentMeetings: [],
    departmentAttendance: [],
    departmentOfferings: [],
    specialPrograms: [],
    programRegistrations: [],
    foreignVisitors: [],
    summaries: {}
  });
}

test('department and member administrators retain their relevant import and removal controls', () => {
  const html = renderWithCapabilities({
    canManageDepartments: true,
    canManageMembers: true
  });

  assert.match(html, /id="importDepartmentsCsv"/);
  assert.match(html, /id="departmentsCsvFile"/);
  assert.match(html, /id="importMembersCsv"/);
  assert.match(html, /id="membersCsvFile"/);
  assert.match(html, /data-remove-department-member="CHOIR--MEM-001"/);
  assert.match(html, /data-delete-member="MEM-001"/);
  assert.match(html, /data-delete-position="LEAD"/);
});

test('capabilities independently gate department and member controls', () => {
  const departmentManagerHtml = renderWithCapabilities({
    canManageDepartments: true,
    canManageMembers: false
  });
  assert.match(departmentManagerHtml, /id="importDepartmentsCsv"/);
  assert.doesNotMatch(departmentManagerHtml, /id="importMembersCsv"/);
  assert.doesNotMatch(departmentManagerHtml, /data-remove-department-member=/);
  assert.doesNotMatch(departmentManagerHtml, /data-delete-member=/);
  assert.match(departmentManagerHtml, /data-delete-position="LEAD"/);

  const memberManagerHtml = renderWithCapabilities({
    canManageDepartments: false,
    canManageMembers: true
  });
  assert.doesNotMatch(memberManagerHtml, /id="importDepartmentsCsv"/);
  assert.match(memberManagerHtml, /id="importMembersCsv"/);
  assert.match(memberManagerHtml, /data-remove-department-member="CHOIR--MEM-001"/);
  assert.match(memberManagerHtml, /data-delete-member="MEM-001"/);
  assert.doesNotMatch(memberManagerHtml, /data-delete-position=/);
});

test('view-only users receive readable member assignments without forbidden action controls', () => {
  const html = renderWithCapabilities({
    canManageDepartments: false,
    canManageMembers: false
  });

  assert.match(html, /Department members and positions/);
  assert.match(html, /Ada Okafor/);
  assert.match(html, /Choir/);
  assert.doesNotMatch(html, /id="importDepartmentsCsv"/);
  assert.doesNotMatch(html, /id="importMembersCsv"/);
  assert.doesNotMatch(html, /data-remove-department-member=/);
  assert.doesNotMatch(html, /data-delete-member=/);
  assert.doesNotMatch(html, /data-delete-position=/);
});
