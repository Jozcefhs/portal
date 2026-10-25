import test from 'node:test';
import assert from 'node:assert/strict';
import {assignedStaffBranches,resolveStaffBranchAssignment,selectAssignedStaffBranch,assertStaffScopeManageable} from '../functions/lib/staff-branch-access.js';
import {applyStaffBranchContext} from '../functions/lib/staff-branch-context.js';
const structure={Branches:[{Id:'main'},{Id:'east'},{Id:'west'}]};
const multi={BranchAccess:'selected',BranchIds:['main','east'],BranchId:'main'};
test('selected branches can switch without granting a combined or unassigned scope',()=>{
 assert.deepEqual(assignedStaffBranches(multi),['main','east']);
 const context=applyStaffBranchContext(multi,'east',structure);
 assert.equal(context.branchId,'east'); assert.equal(context.canSwitchBranches,true);
 assert.equal(selectAssignedStaffBranch(multi,'all'),'main');
 assert.throws(()=>applyStaffBranchContext(multi,'west',structure),e=>e.status===403);
 assert.throws(()=>selectAssignedStaffBranch({BranchAccess:'selected',BranchIds:[]},''),e=>e.status===403);
});
test('assignment is bounded by administrator scope, preserves legacy clients, and validates configuration',()=>{
 assert.deepEqual(resolveStaffBranchAssignment({},multi,null,structure),multi);
 assert.deepEqual(resolveStaffBranchAssignment({}, {BranchId:'main'},multi,structure),multi);
 assert.throws(()=>resolveStaffBranchAssignment(multi,{BranchAccess:'all'},null,structure),e=>e.status===403);
 assert.throws(()=>resolveStaffBranchAssignment(multi,{BranchIds:['west']},null,structure),e=>e.status===403);
 assert.throws(()=>resolveStaffBranchAssignment({}, {BranchIds:['missing']},null,structure),e=>e.status===400);
 assert.throws(()=>assertStaffScopeManageable({BranchId:'main'},multi),e=>e.status===403);
 assert.deepEqual(assignedStaffBranches({BranchId:'main'}),['main']); assert.equal(assignedStaffBranches({}),null);
});
