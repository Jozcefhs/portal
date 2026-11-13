import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionAccessFor, staffUserForAccess } from '../functions/lib/staff-auth.js';
import { featureFlagsForEdition } from '../functions/lib/organization-config.js';
import { hasFullModuleAccess } from '../functions/lib/module-authority.js';
import { academicManagementCapabilities, academicWebActor } from '../functions/lib/academic-management.js';
import { hrCapabilitiesFor } from '../functions/lib/human-resources.js';
import { fundCapabilities } from '../functions/lib/church-funds.js';
import { serviceCapabilities } from '../functions/lib/church-services.js';
import { membershipCapabilities } from '../functions/lib/church-membership.js';
import { offeringCapabilities } from '../functions/lib/church-offerings.js';
import { donationCapabilities } from '../functions/lib/church-payments.js';
import { departmentCapabilities } from '../functions/lib/organization-departments.js';
import { hotelCapabilities } from '../functions/lib/hotel-services.js';
import { executiveOfficeCapabilities } from '../functions/lib/executive-correspondence.js';
import { requisitionCapabilities, assertRequisitionTransition } from '../functions/lib/requisition-workflow.js';
import { canManageAttendanceGroups } from '../functions/lib/staff-attendance-groups.js';
import { capabilitiesFor as procurementCapabilities } from '../functions/lib/procurement-rules.js';
import { enforceActorBranch } from '../functions/lib/branch-scope.js';
import { canManageApprovalSettings } from '../functions/lib/approval-settings.js';

function resolved(edition, modules = [], role = 'Teacher', policy = null, branchId = 'area-1-primary') {
  const user = {username:'multifunction', role, department:'Administration', branchId,
    assignedBranchId:branchId, schoolSectionAccess:'Primary', tabAccess:modules};
  const flags = featureFlagsForEdition(edition);
  return staffUserForAccess(user,sectionAccessFor(user,{Edition:edition,Plan:'Professional',FeatureFlags:flags,PlanFeatureFlags:flags},policy));
}
test('ordinary menu defaults do not become full academic, HR or finance grants', () => {
  const user = resolved('school');
  assert.ok(user.allowedSections.includes('academics'));
  assert.ok(user.allowedSections.includes('humanResources'));
  assert.deepEqual(user.fullAccessModules,[]);
  assert.equal(academicManagementCapabilities(academicWebActor(user)).canApproveScores,false);
  assert.equal(hrCapabilitiesFor(user).canManageSalaryStructure,false);
  assert.equal(requisitionCapabilities(user).canPostRequisitions,false);
});
test('individual academic grant enables every regular academic management capability without changing actor or branch', () => {
  const user=resolved('school',['academics']);
  const cap=academicManagementCapabilities(academicWebActor(user));
  for(const [key,value] of Object.entries(cap).filter(([key])=>key.startsWith('can'))) assert.equal(value,true,key);
  assert.equal(cap.teacherView,false);assert.equal(cap.financeView,false);
  assert.equal(user.role,'Teacher');assert.equal(user.schoolSectionAccess,'Primary');
  assert.equal(enforceActorBranch(user,'area-1-primary'),'area-1-primary');
  assert.throws(()=>enforceActorBranch(user,'main'),/branch/i);
  assert.equal(hrCapabilitiesFor(user).canManageSalaryStructure,false);
});
test('role grants resolve only in the requested branch and are revoked immediately by a saved empty policy', () => {
  const policy={Scopes:{global:{Teacher:['academics']},'area-1-primary':{Teacher:['library','humanResources']}}};
  const local=resolved('school',[],'Teacher',policy);
  assert.equal(hasFullModuleAccess(local,'academics'),false);
  assert.equal(hrCapabilitiesFor(local).canManageSalaryStructure,true);
  const global=resolved('school',[],'Teacher',policy,'main');
  assert.equal(hasFullModuleAccess(global,'academics'),true);
  policy.Scopes['area-1-primary'].Teacher=[];
  assert.equal(hasFullModuleAccess(resolved('school',[],'Teacher',policy),'humanResources'),false);
});
test('old mandatory self-service modules are not inferred to be full finance grants; explicitly saved grants are',()=>{
  const policy={Scopes:{main:{Teacher:['financeRequests','payroll','academics']}}};
  assert.equal(hasFullModuleAccess(resolved('school',[],'Teacher',policy,'main'),'financeRequests'),false);
  policy.FullAccessScopes={main:{Teacher:['financeRequests','academics']}};
  const user=resolved('school',[],'Teacher',policy,'main');
  for(const value of Object.values(requisitionCapabilities(user))) assert.equal(value,true);
  assert.equal(assertRequisitionTransition({Status:'Submitted'},user,'Accounts Confirmed').nextStatus,'Accounts Confirmed');
  assert.throws(()=>assertRequisitionTransition({Status:'Submitted'},user,'Approved'),/stages cannot be skipped/i);
});
test('grants cannot bypass subscription and edition gates or elevate through a forged menu list',()=>{
  const user=resolved('school',['academics']);
  assert.equal(hasFullModuleAccess({...user,subscriptionActive:false},'academics'),false);
  assert.equal(hasFullModuleAccess({...user,allowedSections:[]},'academics'),false);
  assert.equal(hasFullModuleAccess({...user,fullAccessModules:[]},'academics'),false);
  assert.equal(hasFullModuleAccess(resolved('faith',['academics'],'Accounts Officer'),'academics'),false);
  const denied=sectionAccessFor({...user,tabAccess:[],fullAccessModules:['humanResources']},{Edition:'school',FeatureFlags:featureFlagsForEdition('school')});
  assert.deepEqual(denied.fullAccessModules,[]);
});
for(const [module,fn,edition] of [
  ['humanResources',hrCapabilitiesFor,'school'],['funds',fundCapabilities,'faith'],
  ['services',serviceCapabilities,'faith'],['members',membershipCapabilities,'faith'],
  ['members',departmentCapabilities,'organization'],['offerings',offeringCapabilities,'faith'],
  ['donations',donationCapabilities,'faith'],['hotel',hotelCapabilities,'organization']
]) test(`explicit ${module} grant opens all module capabilities in ${edition}`,()=>{
  const user=resolved(edition,[module],'HR Assistant');
  for(const [key,value] of Object.entries(fn(user)).filter(([key])=>key.startsWith('can'))) assert.equal(value,true,key);
  assert.equal(user.role,'HR Assistant');
});
test('attendance, executive office and procurement accept delegated management',()=>{
  const user=resolved('school',['staffAttendance','executiveOffice','procurement'],'Teacher');
  assert.equal(canManageAttendanceGroups(user),true);
  assert.equal(executiveOfficeCapabilities(user).canIssue,true);
  const cap=procurementCapabilities(user,{OrganisationEdition:'school'});
  assert.equal(cap.canApprove,true);assert.equal(cap.canManage,true);assert.equal(cap.canReceive,true);
});


test('an explicit academic grant preserves ICT web correction capability',()=>{
 const user=resolved('school',['academics'],'ICT');
 assert.equal(academicManagementCapabilities(academicWebActor(user)).fullAcademicAccess,true);
 assert.equal(academicManagementCapabilities(user).fullAcademicAccess,false);
});

test('additional Executive Office access removes the international-office-only restriction',()=>{
 const user=resolved('school',['executiveOffice'],'International Studies Officer');
 const cap=executiveOfficeCapabilities(user);
 assert.equal(cap.canSearchStaff,true);
 assert.equal(user.role,'International Studies Officer');
});

test('delegated finance authority does not change organisation-wide policies from a single branch',()=>{
 const user=resolved('school',['financeRequests']);
 assert.equal(canManageApprovalSettings(user),false);
 assert.equal(canManageApprovalSettings({...user,branchAccess:'all'}),true);
});
