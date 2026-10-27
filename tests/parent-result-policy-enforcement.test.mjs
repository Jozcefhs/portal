import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as policy from '../functions/lib/academic-policy.js';
import * as access from '../functions/lib/academic-result-access.js';
import {recordMatchesSelectedChildScope,parentAcademicScholarshipFees} from '../functions/api/parent-dashboard.js';
import {effectiveInvoiceAfterReversal} from '../functions/lib/invoice-charge-reversal.js';
import {schoolSectionFor} from '../functions/lib/school-scope.js';
const source=await readFile(new URL('../functions/api/parent-dashboard.js',import.meta.url),'utf8');
const extract=name=>source.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([\\s\\S]*?\\n}\\r?\\n`))[0].replace(/^export /,'');
const result={ResultId:'r1',StudentRef:'TEST/1',SessionId:'s1',TermId:'t1',AcademicSession:'2026/2027',Term:'First Term',
  ClassId:'c1',ClassName:'Grade 7',BranchId:'west',SchoolSection:'secondary',Status:'Published',PublicationStatus:'Published',
  OverallAverage:75,OverallPosition:1,Subjects:[{SubjectId:'math',SubjectName:'Mathematics',Total:75,Position:1}],
  InternalReviewNote:'private'};
function activePolicy(visibility='current-term',mode='none',overrides={}){
  const value=policy.defaultAcademicPolicy();value.Position.Mode='internal-only';value.Promotion.Mode='manual-review';
  value.Assessment.Components=[{Id:'ca',Name:'CA',WeightPercentage:100,MaximumScore:100,Required:true}];
  value.Assessment.GradeBands=[{Grade:'A',MinimumPercentage:0,MaximumPercentage:100}];
  value.ResultAccess.VisibilityMode=visibility;
  Object.assign(value.ResultAccess.FinancialClearance,{Mode:mode},overrides);return value;
}
function fixture(){
  const state={policy:activePolicy(),draft:activePolicy('all-published','none'),sources:[{}],calls:[],audits:[]};
  const sandbox=vm.createContext({...policy,...access,recordMatchesSelectedChildScope,parentAcademicScholarshipFees,effectiveInvoiceAfterReversal,schoolSectionFor,
    loadAcademicPolicyView:async(_env,request)=>{state.calls.push(request);if(state.error)throw state.error;
      return {ActivePolicy:state.policy,Policy:state.draft,Sources:state.sources};},
    auditParentAcademicResultAccess:async(_env,entry)=>state.audits.push(entry)});
  for(const name of ['clean','lower','pick','sameText','referenceIdentityKey','financialKeys','financialReferenceMatches',
    'academicResultId','academicResultPeriod','academicResultBelongsToChild','academicClearanceForResult','parentAcademicResults',
    'asMoneyNumber','toDisplayDate','scopedPathIdentity','scopedRecordBranch','scopedRecordSection','normalizeLedger','normalizeInvoice']){
    vm.runInContext(extract(name),sandbox,{filename:name});
  }
  const args={email:'parent@example.test',child:{AdmissionNo:'TEST/1',AccountRef:'TEST/1',BillingCategory:'Regular'},
    selectedScope:{branchId:'west',schoolSection:'secondary'},schoolProfile:{CurrentAcademicSession:'2026/2027',CurrentTerm:'First Term'},
    resultRows:[structuredClone(result)],ledger:[],invoices:[],clearanceRows:[]};
  return {state,sandbox,args,run:()=>sandbox.parentAcademicResults({},args)};
}

test('view uses the active class policy, omits denied marks, and ignores another child, branch or section',async()=>{
  const f=fixture();f.state.policy=activePolicy('current-term','any-balance');
  f.args.invoices=[{FeeCategory:'School Fee',Debit:100}];
  f.args.resultRows.push({...result,ResultId:'other-child',StudentRef:'TEST/2'},
    {...result,ResultId:'other-branch',BranchId:'main'},{...result,ResultId:'other-section',SchoolSection:'primary'});
  const denied=await f.run();assert.equal(denied.length,1);assert.equal(denied[0].Access.Code,'FINANCIAL_CLEARANCE_REQUIRED');
  assert.equal('Subjects' in denied[0],false);assert.equal('OverallAverage' in denied[0],false);
  assert.equal(f.state.calls[0].scope.Type,'class');assert.equal(f.state.calls[0].scope.Id,'c1');
  assert.deepEqual(Array.from(f.state.calls[0].scopeChain,s=>s.Id),['organisation','west','secondary','c1']);
  f.args.ledger=[{FeeCategory:'School Fee',Credit:100}];const allowed=(await f.run())[0];
  assert.equal(allowed.Access.Allowed,true);assert.equal(allowed.Subjects[0].Total,75);
  assert.equal('InternalReviewNote' in allowed,false);assert.equal('OverallPosition' in allowed,false);
  assert.equal('Position' in allowed.Subjects[0],false);assert.equal(f.state.audits.length,2);
});

test('all parent visibility modes and financial thresholds are enforced at their boundaries',async()=>{
  const f=fixture();
  for(const [mode,session,term,allowed] of [
    ['current-term','2026/2027','First Term',true],['current-term','2026/2027','Second Term',false],
    ['current-session','2026/2027','Second Term',true],['current-session','2025/2026','First Term',false],
    ['all-published','2025/2026','First Term',true],['published-and-transcripts','2025/2026','First Term',true]]){
    f.state.policy=activePolicy(mode);Object.assign(f.args.resultRows[0],{AcademicSession:session,Term:term});
    assert.equal((await f.run())[0].Access.Allowed,allowed,mode);
  }
  f.args.resultRows=[structuredClone(result)];f.args.invoices=[{FeeCategory:'School Fee',Debit:100}];
  for(const [mode,credit,options,allowed] of [
    ['none',0,{},true],['any-balance',99.99,{},false],['any-balance',100,{},true],
    ['minimum-paid-percentage',69.99,{MinimumPaidPercentage:70},false],['minimum-paid-percentage',70,{MinimumPaidPercentage:70},true],
    ['maximum-outstanding',49.99,{MaximumOutstanding:50},false],['maximum-outstanding',50,{MaximumOutstanding:50},true]]){
    f.state.policy=activePolicy('current-term',mode,options);f.args.ledger=[{FeeCategory:'School Fee',Credit:credit}];
    assert.equal((await f.run())[0].Access.Allowed,allowed,`${mode}/${credit}`);
  }
});

test('an active clearance is not masked by expired or revoked records, and exact period IDs cannot cross terms',async()=>{
  const f=fixture();f.state.policy=activePolicy('current-term','manual-clearance',{AllowManualExemptions:false});
  const clearance={StudentRef:'TEST/1',BranchId:'west',SchoolSection:'secondary',SessionId:'s1',TermId:'t1',Status:'Approved'};
  f.args.clearanceRows=[{...clearance,ExpiresAt:'2000-01-01T00:00:00Z'},{...clearance,Status:'Revoked'},clearance];
  assert.equal((await f.run())[0].Access.Allowed,true);
  f.args.clearanceRows=[{...clearance,TermId:'other-term',Term:'First Term'},
    {...clearance,ResultId:'another-result'},{...clearance,StudentRef:'TEST/2'},
    {...clearance,BranchId:'main'},{...clearance,SchoolSection:'primary'}];
  assert.equal((await f.run())[0].Access.Allowed,false);
  f.args.clearanceRows=[clearance];f.state.policy=activePolicy('current-term','any-balance',{AllowManualExemptions:false});
  f.args.invoices=[{Debit:100}];assert.equal((await f.run())[0].Access.Allowed,false);
  f.state.policy.ResultAccess.FinancialClearance.AllowManualExemptions=true;assert.equal((await f.run())[0].Access.Allowed,true);
});

test('revoked publication, incomplete results and unavailable policy never return marks',async()=>{
  const f=fixture();
  for(const change of [{Status:'Calculated Draft'},{Status:'Reviewed'},{Status:'Approved'},{Status:'Withdrawn'},
    {PublicationStatus:'Withdrawn'},{CalculationPending:true},{SubjectChangeRecalculationRequired:true}]){
    f.args.resultRows=[{...result,...change}];const denied=(await f.run())[0];
    assert.equal(denied.Access.Allowed,false);assert.equal('Subjects' in denied,false);
  }
  f.args.resultRows=[structuredClone(result)];f.state.sources=[];
  assert.equal((await f.run())[0].Access.Code,'ACTIVE_POLICY_REQUIRED');
  f.state.sources=[{}];f.state.error=new Error('Policy read failed');assert.equal((await f.run())[0].Access.Allowed,false);
  delete f.state.error;f.state.policy=policy.defaultAcademicPolicy();assert.equal((await f.run())[0].Access.Allowed,false);
});

test('stable fee-category IDs survive normalization so selected-category clearance cannot be bypassed',async()=>{
  const f=fixture();f.state.policy=activePolicy('current-term','selected-fee-categories',{FeeCategoryIds:['tuition-id']});
  f.args.invoices=[f.sandbox.normalizeInvoice({FeeCategoryId:'tuition-id',FeeCategory:'Tuition display name',Debit:100})];
  f.args.ledger=[f.sandbox.normalizeLedger({FeeCategoryId:'tuition-id',FeeCategory:'Tuition display name',Credit:90})];
  assert.equal((await f.run())[0].Access.Allowed,false);
  f.args.ledger[0].Credit=100;assert.equal((await f.run())[0].Access.Allowed,true);
});

test('policy reads are reused only within one view, and printing rechecks changes and eligibility',async()=>{
  const f=fixture();f.args.resultRows.push({...result,ResultId:'mid-term',ResultType:'Mid-Term'});
  assert.equal((await f.run()).length,2);assert.equal(f.state.calls.length,1);
  f.state.policy=activePolicy('current-term','any-balance');f.args.invoices=[{Debit:100}];
  const profileCalls=[];
  f.sandbox.getChildActivity=async(_env,_body,options)=>{
    assert.equal(options.academicResultsOnly,true);
    assert.equal(options.academicResultPurpose,'Print');f.args.requestedResultId=options.requestedAcademicResultId;
    return {branchId:'west',academicResults:await f.run(),reportProfile:{SchoolName:'West School'}};
  };
  f.sandbox.getSchoolProfile=async(_env,branch)=>{profileCalls.push(branch);return {SchoolName:'West School'};};
  vm.runInContext(extract('getAcademicResultForPrint'),f.sandbox);
  await assert.rejects(f.sandbox.getAcademicResultForPrint({}, {ResultId:'r1'}),error=>error.status===403);
  assert.equal(f.state.calls.length,2);assert.equal(profileCalls.length,0);
  f.args.ledger=[{Credit:100}];const printed=await f.sandbox.getAcademicResultForPrint({}, {ResultId:'r1',BranchId:'main'});
  assert.equal(printed.academicResult.Access.Allowed,true);assert.deepEqual(profileCalls,[]);
  assert.equal(printed.reportProfile.SchoolName,'West School');
  await assert.rejects(f.sandbox.getAcademicResultForPrint({}, {ResultId:'someone-else'}),error=>error.status===404);
});

test('the selected branch supplies the current academic session and term before checking visibility',async()=>{
  const f=fixture();f.args.schoolProfile={CurrentAcademicSession:'2026/2027',CurrentAcademicSessionId:'s1',CurrentTerm:'Second Term',
    CurrentTermId:'t1',BranchOverrideFields:['CurrentTerm']};
  assert.equal((await f.run())[0].Access.Code,'OUTSIDE_VISIBLE_TERM');
  f.args.resultRows[0].Term='Second Term';f.args.resultRows[0].TermId='t2';assert.equal((await f.run())[0].Access.Allowed,true);
  const selected={BranchId:'main',SchoolSection:'secondary'};let actualBranch;
  const sandbox=vm.createContext({
    getSelectedIdentityRow:async()=>selected,
    getSchoolProfile:async(_env,branch)=>{actualBranch=branch;return {CurrentTerm:branch==='west'?'Second Term':'First Term'};},
    normalizeStudent:(_student,profile)=>{assert.equal(profile.CurrentTerm,'Second Term');throw new Error('profile verified');}
  });
  for(const name of ['clean','lower','validatedIdentityScopePath','scopedPathIdentity','getChildActivity'])vm.runInContext(extract(name),sandbox);
  await assert.rejects(sandbox.getChildActivity({}, {sourceType:'student',scopePath:'schoolBranches/west/sections/secondary/students',AccountRef:'TEST/1'}),/profile verified/);
  assert.equal(actualBranch,'west');
});

function focusedFixture(){
  const f=fixture(),reads=[];
  for(const name of ['accountKeys','parentAcademicReportProfile','loadParentAcademicResultActivity'])vm.runInContext(extract(name),f.sandbox);
  Object.assign(f.sandbox,{
    getDocument:async(_env,collection,id)=>{reads.push({collection,id});return f.args.resultRows.find(row=>row.ResultId===id);},
    queryRowsForReferences:async(_env,collection,_fields,keys,options)=>{
      assert.equal(options.strict,true);reads.push({collection,keys});
      if(f.resultError)throw f.resultError;
      return collection==='academicResults'?f.args.resultRows:f.args.clearanceRows;
    },
    queryParentFinancialRows:async(_env,collection,keys)=>{reads.push({collection,keys});if(f.financeError)throw f.financeError;return f.args[collection];},
    isFullScholarship:()=>false,
    listCollection:()=>{throw new Error('Unexpected full collection read');}
  });
  return Object.assign(f,{reads,load:(options={})=>f.sandbox.loadParentAcademicResultActivity({}, {...f.args,options})});
}

test('focused result print reads only its document and active policy when no financial clearance is required',async()=>{
  const f=focusedFixture();
  const response=await f.load({requestedAcademicResultId:'r1',academicResultPurpose:'Print'});
  assert.equal(response.academicResults[0].Access.Allowed,true);
  assert.deepEqual(f.reads,[{collection:'academicResults',id:'r1'}]);assert.equal(f.state.calls.length,1);
  assert.equal(f.state.audits[0].purpose,'Print');
  assert.equal(response.reportProfile.DocumentLogoUrl,'/api/document-logo');
  f.args.resultRows[0].StudentRef='OTHER/2';f.reads.length=0;f.state.calls.length=0;
  assert.equal((await f.load({requestedAcademicResultId:'r1'})).academicResults.length,0);
  assert.equal(f.state.calls.length,0,'no policy/finance reads for another child');
  await assert.rejects(f.load({requestedAcademicResultId:'wrong/path'}),error=>error.status===400);
});

test('focused refresh enforces financial policy, reuses its reads, and fails closed on unavailable evidence',async()=>{
  const f=focusedFixture();f.state.policy=activePolicy('current-term','any-balance');
  f.args.resultRows.push({...result,ResultId:'r2',ResultType:'Mid-Term'});
  f.args.invoices=[{Debit:100,BranchId:'west',SchoolSection:'secondary'}];
  let response=await f.load();assert.ok(response.academicResults.every(row=>!row.Access.Allowed));
  assert.equal(f.reads.filter(row=>row.collection==='ledger').length,1);
  f.args.ledger=[{Credit:100,BranchId:'west',SchoolSection:'secondary'}];
  response=await f.load();assert.ok(response.academicResults.every(row=>row.Access.Allowed));
  f.financeError=new Error('Financial evidence unavailable');await assert.rejects(f.load(),/Financial evidence unavailable/);
  delete f.financeError;f.resultError=new Error('Result query failed');await assert.rejects(f.load(),/Result query failed/);
  assert.ok(f.reads.every(row=>['academicResults','ledger','invoices','academicResultClearances'].includes(row.collection)));
});

test('strict child result reads propagate failures without converting them to an empty history',async()=>{
  const sandbox=vm.createContext({clean:value=>String(value??'').trim(),uniqueRows:rows=>rows,
    queryCollection:async()=>{throw new Error('Database offline');}});
  vm.runInContext(extract('queryRowsForReferences'),sandbox);
  await assert.rejects(sandbox.queryRowsForReferences({},'academicResults',['StudentRef'],['TEST/1'],{strict:true}),/Database offline/);
});
