import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rolesForEdition, defaultModulesForRole } from '../functions/lib/role-module-access.js';
import { allowedSectionsFor } from '../functions/lib/staff-auth.js';
import { academicManagementCapabilities } from '../functions/lib/academic-management.js';
import { canManageAttendanceGroups } from '../functions/lib/staff-attendance-groups.js';
import { canManageStaffAttendance } from '../functions/lib/staff-time-attendance.js';

test('ICT is a distinct school role with the three requested modules, not a finance administrator', () => {
  assert.ok(rolesForEdition('school').includes('ICT'));
  for (const edition of ['faith','organization']) assert.ok(!rolesForEdition(edition).includes('ICT'));
  const modules = defaultModulesForRole('ICT',{edition:'school'});
  for (const key of ['academics','students','staffAttendance']) assert.ok(modules.includes(key), key);
  for (const key of ['accounts','staffUsers','dataBackup','vendorSettlements']) assert.ok(!modules.includes(key), key);
  const user = { role:'ICT',edition:'school',allowedSections:modules };
  for (const [key,value] of Object.entries(academicManagementCapabilities(user))) {
    assert.equal(value, !['teacherView','financeView'].includes(key), key);
  }
  assert.equal(canManageAttendanceGroups(user),true);
  assert.equal(canManageStaffAttendance(user),true);
  for (const edition of ['faith','organization']) assert.equal(canManageAttendanceGroups({...user,edition}),false);
  assert.equal(academicManagementCapabilities({...user,allowedSections:[]}).enabled,false);
  assert.equal(academicManagementCapabilities({...user,edition:'faith'}).enabled,false);
  assert.ok(!allowedSectionsFor(user,null,{edition:'school',roleModules:[]}).includes('academics'));
});

test('ICT is offered by the browser role picker and edition filter', async () => {
  const source = await readFile(new URL('../js/admin.js',import.meta.url),'utf8');
  for (const [start,end] of [['const staffRoleOptions','const schoolOnlyStaffRoles'],['const schoolOnlyStaffRoles','const faithOnlyStaffRoles']]) {
    assert.match(source.slice(source.indexOf(start),source.indexOf(end)),/'ICT'/);
  }
});
