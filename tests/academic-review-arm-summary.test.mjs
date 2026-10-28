import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAcademicReviewArmSummary } from '../functions/lib/academic-review-arm-summary.js';
import { handleAcademicManagementAction } from '../functions/lib/academic-management.js';

const scope = { branchId:'main', section:'secondary', legacySection:'secondary' };
const input = { SessionId:'session', TermId:'term', ClassId:'grade7', RecordClassId:'grade7', ArmId:'genius' };
const period = { BranchId:'main', SchoolSection:'secondary', SessionId:'session', TermId:'term' };
const sheet = (SheetId, ClassId, ArmId, extra={}) => ({...period,SheetId,ClassId,ArmId,Status:'Draft',
  UpdatedAt:'2026-10-28T12:00:00.000Z', AssessmentComponents:[{Id:'ca1',Name:'CA1',Weight:10}],
  ComponentReviews:{ca1:{Status:'Approved',Stale:false,PendingStudentRefs:['private-student'],Signature:'private-signature'}},
  StudentScores:[{StudentRef:'private-student',Score:80}],...extra});
function fixture(rows=[], docs={session:period,term:period}) {
  const calls=[];
  return {calls, db:{getDocument:async(_env,path,id)=>{calls.push({path,id});return docs[id];},
    queryCollectionPages:async(_env,path,options)=>{calls.push({path,options});return rows;}}};
}

test('review summary covers every class in the selected branch period without loading marks or changing records', async()=>{
  const rows=[sheet('s1','grade7','genius'),sheet('s2','grade8','genius'),sheet('s3','grade10','brilliance')];
  const before=structuredClone(rows),{db,calls}=fixture(rows);
  const result=await loadAcademicReviewArmSummary({},scope,input,db);
  assert.deepEqual(result.branchReviewSummary.sheets.map(row=>row.ClassId),['grade7','grade8','grade10']);
  assert.deepEqual(calls.slice(0,2),[{path:'academicSessions',id:'session'},{path:'academicTerms',id:'term'}]);
  assert.equal(calls.length,3,'two exact period reads and one paginated metadata query');
  const options=calls[2].options;
  assert.deepEqual(options.filters,[{field:'BranchId',op:'==',value:'main'},{field:'SessionId',op:'==',value:'session'},{field:'TermId',op:'==',value:'term'}]);
  assert.ok(options.select.includes('ComponentReviews'));
  assert.ok(!options.select.some(field=>/student|score$|history|roster/i.test(field)));
  assert.equal(options.readTime,result.branchReviewSummary.loadedAt);
  assert.equal(options.pageSize,250);assert.equal(options.maxRows,10000);
  assert.deepEqual(result.branchReviewSummary.sheets[0],{SheetId:'s1',ClassId:'grade7',ArmId:'genius',Status:'Draft',UpdatedAt:rows[0].UpdatedAt,
    AssessmentComponents:[{Id:'ca1',Name:'CA1'}],ComponentReviews:{ca1:{Status:'Approved',Stale:false}}});
  assert.doesNotMatch(JSON.stringify(result),/private-student|private-signature|StudentScores|Weight/);
  assert.deepEqual(rows,before,'read-only query leaves all records untouched');
});

test('summary excludes other branches, sections, sessions and terms even if returned by the database', async()=>{
  const rows=[sheet('good','g7','a1'),sheet('branch','g7','a2',{BranchId:'north'}),sheet('section','g7','a3',{SchoolSection:'primary'}),
    sheet('session','g7','a4',{SessionId:'other'}),sheet('term','g7','a5',{TermId:'other'}),sheet('legacy','g8','a6',{SchoolSection:''})];
  const {db}=fixture(rows);
  assert.deepEqual((await loadAcademicReviewArmSummary({},scope,input,db)).branchReviewSummary.sheets.map(row=>row.SheetId),['good','legacy']);
});

test('missing and mismatched periods fail before the score-sheet query', async()=>{
  for(const change of [{BranchId:'north'},{SchoolSection:'primary'},{SessionId:'other'}]) {
    const {db,calls}=fixture([],{session:period,term:{...period,...change}});
    await assert.rejects(loadAcademicReviewArmSummary({},scope,input,db),{code:'ACADEMIC_REVIEW_SCOPE_INVALID'});
    assert.equal(calls.length,2);
  }
  const {db,calls}=fixture();
  await assert.rejects(loadAcademicReviewArmSummary({},scope,{SessionId:'session'},db),{code:'ACADEMIC_REVIEW_SCOPE_INVALID'});
  assert.equal(calls.length,0);
  await assert.rejects(loadAcademicReviewArmSummary({},scope,input,fixture([],{session:period}).db),{code:'ACADEMIC_REVIEW_SCOPE_INVALID'});
});

test('database failures never masquerade as empty or partial branch totals', async()=>{
  const {db}=fixture();
  db.queryCollectionPages=async()=>{throw Object.assign(new Error('Limit reached'),{code:'FIRESTORE_QUERY_REPORT_LIMIT'});};
  await assert.rejects(loadAcademicReviewArmSummary({},scope,input,db),{code:'FIRESTORE_QUERY_REPORT_LIMIT'});
  assert.deepEqual((await loadAcademicReviewArmSummary({},scope,input,fixture().db)).branchReviewSummary.sheets,[]);
});

test('non-reviewers cannot load branch-wide statuses', async()=>{
  await assert.rejects(handleAcademicManagementAction({}, {role:'Teacher',allowedSections:['academics'],edition:'school'},
    {...input,action:'getAcademicReviewArmSummary'}),error=>error.status===403);
});
