import test from 'node:test';
import assert from 'node:assert/strict';
import '../js/academic-workflow-status.js';
const workflow = globalThis.DynamaxAcademicWorkflow;

test('test approval stays separate from full-term approval and changed marks require resubmission', () => {
  const sheet = {Status:'Draft',ComponentReviews:{ca1:{Status:'Approved',PendingStudentRefs:['student-2']},exam:{Status:'Submitted'}}};
  const before = structuredClone(sheet);
  assert.equal(workflow.scoreStatus(workflow.scoreReview(sheet,'ca1')),'Approved');
  assert.equal(workflow.scoreStatus(workflow.scoreReview(sheet,'exam')),'Submitted');
  assert.equal(workflow.scoreStatus(workflow.scoreReview(sheet,'')),'Draft');
  assert.equal(workflow.scoreStatus(workflow.scoreReview({...sheet,TestReviewStatus:[]},'ca1')),'Draft');
  assert.equal(workflow.scoreStatus(workflow.scoreReview({...sheet,TestReviewStatus:[{ComponentId:'ca1',Status:'Approved',Stale:true}]},'ca1')),'Draft');
  assert.deepEqual(sheet,before);
});

test('whole-sheet approval includes its tests; locked records are retained in approved or published views', () => {
  for(const Status of ['Approved','Locked']) assert.equal(workflow.scoreStatus(workflow.scoreReview({Status},'ca1')),'Approved');
  for(const Status of ['Published','Locked']) assert.equal(workflow.resultStatus({Status}),'Published');
  assert.equal(workflow.resultStatus({Status:'Approved',CalculationPending:true}),'Pending');
  assert.equal(workflow.resultStatus({Status:'Reviewed',SubjectChangeRecalculationRequired:true}),'Pending');
  assert.equal(workflow.resultStatus({Status:'Withdrawn'}),'Withdrawn');
});

test('counts are exclusive and approval/publication moves only the changed record', () => {
  const rows=[{Status:'Reviewed'},{Status:'Approved'},{Status:'Published'},{Status:'Locked'},{Status:'Calculated Draft',CalculationPending:true}];
  let counts=workflow.counts(rows,workflow.resultStatus,workflow.resultStages);
  assert.deepEqual(counts,{All:5,Draft:0,Reviewed:1,Approved:1,Published:2,Pending:1,Withdrawn:0});
  rows[0]={...rows[0],Status:'Approved'};
  counts=workflow.counts(rows,workflow.resultStatus,workflow.resultStages);
  assert.equal(counts.Reviewed,0);assert.equal(counts.Approved,2);
  rows[0]={...rows[0],Status:'Published'};
  counts=workflow.counts(rows,workflow.resultStatus,workflow.resultStages);
  assert.equal(counts.Approved,1);assert.equal(counts.Published,3);assert.equal(counts.Pending,1);assert.equal(counts.All,5);
});

test('status labels escape markup and preserve human-readable text alongside colour', () => {
  assert.match(workflow.badge('Approved','Approved · 2 pending'),/workflow-approved.*Approved · 2 pending/);
  assert.ok(!workflow.badge('Draft','<script>alert(1)</script>').includes('<script>'));
});

test('arm counts deduplicate subjects, keep different classes separate and retain mixed statuses', () => {
  const rows=[
    {ClassId:'grade7',ArmId:'genius',Status:'Approved'},
    {ClassId:'grade7',ArmId:'genius',Status:'Locked'},
    {ClassId:'grade7',ArmId:'genius',Status:'Submitted'},
    {ClassId:'grade8',ArmId:'genius',Status:'Approved'},
    {ClassId:'grade8',ArmId:'brilliance',Status:'Draft'},
    {ClassId:'grade8',ArmId:'',Status:'Approved'}
  ],before=structuredClone(rows);
  assert.deepEqual(workflow.armCounts(rows,workflow.scoreStatus,workflow.scoreStages),{All:3,Draft:1,Submitted:1,Approved:2});
  assert.deepEqual(workflow.armCounts([],workflow.scoreStatus,workflow.scoreStages),{All:0,Draft:0,Submitted:0,Approved:0});
  assert.deepEqual(rows,before);
});

test('arm counts follow the selected test, scope and refreshed review statuses', () => {
  const rows=[
    {ClassId:'grade7',ArmId:'genius',Status:'Draft',ComponentReviews:{ca1:{Status:'Approved'},exam:{Status:'Submitted'}}},
    {ClassId:'grade7',ArmId:'brilliance',Status:'Draft',ComponentReviews:{ca1:{Status:'Approved',Stale:true},exam:{Status:'Draft'}}}
  ];
  const byTest=id=>row=>workflow.scoreStatus(workflow.scoreReview(row,id));
  assert.deepEqual(workflow.armCounts(rows,byTest('ca1'),workflow.scoreStages),{All:2,Draft:1,Submitted:0,Approved:1});
  assert.deepEqual(workflow.armCounts(rows,byTest('exam'),workflow.scoreStages),{All:2,Draft:1,Submitted:1,Approved:0});
  assert.deepEqual(workflow.armCounts(rows.filter(row=>row.ArmId==='genius'),byTest(''),workflow.scoreStages),{All:1,Draft:1,Submitted:0,Approved:0});
  rows[0].TestReviewStatus=[];
  assert.equal(workflow.armCounts(rows,byTest('ca1'),workflow.scoreStages).Approved,0);
});

test('published arm filters use actual results, deduplicate arms and distinguish partial publication and tests',()=>{
  const rows=[
    {ClassId:'g7',ArmId:'genius',ResultType:'Mid-Term',ComponentIds:['ca1'],Published:20,Other:2},
    {ClassId:'g7',ArmId:'genius',ResultType:'End of Term',ComponentIds:[],Published:0,Other:22},
    {ClassId:'g8',ArmId:'genius',ResultType:'Mid-Term',ComponentIds:['ca2'],Published:15,Other:0},
    {ClassId:'g9',ArmId:'brilliance',ResultType:'End of Term',ComponentIds:[],Published:18,Other:0},
    {ClassId:'g10',ArmId:'perfection',ResultType:'Mid-Term',ComponentIds:['ca1'],Published:0,Other:20}
  ],before=structuredClone(rows);
  const ca1=workflow.publicationArms(rows,'ca1');assert.equal(ca1.published.size,2);assert.equal(ca1.partial.size,1);
  assert.ok(ca1.published.has(JSON.stringify(['g7','genius'])));assert.ok(!ca1.published.has(JSON.stringify(['g10','perfection'])));
  const ca2=workflow.publicationArms(rows,'ca2');assert.equal(ca2.published.size,2);assert.equal(ca2.partial.size,0);
  const full=workflow.publicationArms(rows,'');assert.equal(full.published.size,1);assert.equal(full.partial.size,0);
  assert.deepEqual(rows,before);
});
