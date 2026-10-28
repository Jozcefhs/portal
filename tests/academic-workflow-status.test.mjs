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
