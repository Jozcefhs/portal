import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../functions/lib/academic-management.js',import.meta.url),'utf8');
const input={BranchId:'main',SchoolSection:'secondary',SessionId:'s1',TermId:'t1',Status:'Approved',AllowPendingStudents:true,
  Items:[{SheetId:'sheet1',ClassId:'c1',ArmId:'a1',SubjectId:'math',ComponentId:'ca1',RevisionToken:'r1'}]};
function fixture(){
  const calls=[],changes=[];
  const context=vm.createContext({clean:value=>String(value??'').trim(),
    requireCapability:user=>{if(user.role!=='Reviewer')throw Object.assign(new Error('Only reviewer'),{status:403});},
    failure:(message,status=400)=>Object.assign(new Error(message),{status}),
    ACADEMIC_SCOREBOOK_STATE_KEYS:['sessions','studentScores','scoreImports','scoreSyncBatches'],
    ACADEMIC_MANAGEMENT_COLLECTIONS:{scoreSheets:'academicScoreSheets'},
    academicScoreSheetContext:async(_e,_u,request,_capability,keys,options)=>{calls.push({request,keys,options});if(request.SubjectId==='invalid')throw new Error('Subject not found');return {existing:{SheetId:request.SheetId}};},
    changeAcademicScoreSheetStatus:async(_e,_u,request,loaded)=>{assert.equal(loaded.existing.SheetId,request.SheetId);changes.push(request);return {message:'Approved; incomplete students pending'};},
    getDocument:async(_e,_c,id)=>({SheetId:id,Status:'Draft',__updateTime:'new-revision',ComponentReviews:{ca1:{Status:'Approved'}}}),
    publicRecord:row=>({...row,RevisionToken:row.__updateTime})});
  vm.runInContext(source.match(/export async function batchReviewAcademicScores\([\s\S]*?\n}/)[0].replace('export ',''),context);
  return {context,calls,changes};
}
test('batch approval reuses validation once per chosen sheet and bounds the scope and payload',async()=>{
  const f=fixture();const result=await f.context.batchReviewAcademicScores({}, {role:'Reviewer'}, {...input,Items:[
    {...input.Items[0],BranchId:'evil',SessionId:'old'},input.Items[0],{...input.Items[0],SheetId:'bad',SubjectId:'invalid'}]});
  assert.equal(f.calls.length,2);assert.equal(f.changes.length,1);assert.equal(result.batchReview.length,2);
  assert.equal(result.batchReview[0].ok,true);assert.equal(result.batchReview[1].ok,false);
  assert.equal(result.batchReview[0].sheet.RevisionToken,'new-revision');
  assert.equal(f.calls[0].request.BranchId,'main');assert.equal(f.calls[0].request.SessionId,'s1');
  assert.equal(f.calls[0].options.workspaceRead,true);
  assert.ok(!f.calls[0].keys.includes('scoreImports'));assert.ok(!f.calls[0].keys.includes('scoreSyncBatches'));
});
test('batch rejects unauthorised users, oversized requests and implicit approval transitions before reads',async()=>{
  const f=fixture();
  await assert.rejects(f.context.batchReviewAcademicScores({}, {role:'Teacher'},input),{status:403});
  for(const change of [{Items:Array(26).fill(input.Items[0])},{Status:'Locked'},{TermId:''},{Items:[]}]){
    await assert.rejects(f.context.batchReviewAcademicScores({}, {role:'Reviewer'},{...input,...change}));
  }
  assert.equal(f.calls.length,0);assert.equal(f.changes.length,0);
});
