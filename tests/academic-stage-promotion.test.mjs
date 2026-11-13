import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from './helpers/module-policy-vm.mjs';
import { normalizeAcademicPolicy, academicPolicyIssues, academicResultSchoolStage, academicPromotionForStage, deriveAcademicPolicyOverrides, applyAcademicPolicyOverrides } from '../functions/lib/academic-policy.js';
import { evaluateAcademicPromotionDecision } from '../functions/lib/academic-session-outcomes.js';
import { publicAcademicResult } from '../functions/lib/academic-result-access.js';
import { academicAutomaticResultComments } from '../functions/lib/academic-term-results.js';

const policy = normalizeAcademicPolicy({Promotion:{Mode:'manual-review',
  Nursery:{Mode:'manual-review'}, Primary:{Mode:'criteria',MinimumOverallAverage:60,MaximumFailedSubjects:0,MinimumAttendancePercentage:70}}});
const result = {SchoolStage:'primary',ClassName:'Primary 4',OverallAverage:65,Attendance:{AttendancePercentage:80},Subjects:[{SubjectId:'math',SubjectName:'Numeracy',AnnualTotal:65,Total:65,Grade:'B',Classification:'pass'}]};

test('nursery and primary policies are independent and do not apply secondary Core requirements', () => {
  const before=structuredClone(result);
  assert.equal(evaluateAcademicPromotionDecision(result,policy).RecommendedOutcome,'Promoted');
  assert.equal(evaluateAcademicPromotionDecision({...result,OverallAverage:55},policy).RecommendedOutcome,'Repeated');
  assert.equal(evaluateAcademicPromotionDecision({...result,Attendance:{AttendancePercentage:50}},policy).RecommendedOutcome,'Repeated');
  assert.equal(evaluateAcademicPromotionDecision({...result,SchoolStage:'nursery'},policy).RecommendationType,'Manual Review');
  assert.equal(evaluateAcademicPromotionDecision({...result,SchoolStage:'senior-secondary',ClassName:'Grade 12'},policy).RecommendationType,'Manual Review');
  assert.deepEqual(result,before);
  assert.match(academicAutomaticResultComments(result,policy).PrincipalRemark,/benchmark of 60%/);
});

test('legacy secondary policy falls back to head-teacher review for early years', () => {
  const legacy=normalizeAcademicPolicy({Promotion:{Mode:'division-rules',MinimumAttendancePercentage:90}});
  for (const ClassName of ['Nursery2','Pre-Nursery','Reception','Creche','Primary 4','GRADE 6']) {
    const record={...result,SchoolStage:'',SchoolSection:'primary',ClassName};
    assert.equal(evaluateAcademicPromotionDecision(record,legacy).RecommendationType,'Manual Review');
    assert.equal(academicPromotionForStage(legacy,record).MinimumAttendancePercentage,null);
  }
  assert.equal(academicResultSchoolStage({SchoolSection:'primary',ClassName:'Nursery 2'}),'nursery');
  assert.equal(academicResultSchoolStage({ClassName:'Grade 10'}),'');
});

test('stage criteria require a criterion; zero and inherited legacy settings remain valid', () => {
  assert.ok(academicPolicyIssues({Promotion:{Primary:{Mode:'criteria'}}}).some(issue=>issue.path==='Promotion.Primary'));
  assert.ok(!academicPolicyIssues(policy).some(issue=>issue.code==='STAGE_PROMOTION_CRITERIA_REQUIRED'));
  const zero=normalizeAcademicPolicy({Promotion:{Nursery:{Mode:'criteria',MaximumFailedSubjects:0}}});
  assert.ok(!academicPolicyIssues(zero).some(issue=>issue.path==='Promotion.Nursery'));
  assert.equal(academicPromotionForStage(normalizeAcademicPolicy({Promotion:{Mode:'criteria',MinimumOverallAverage:40}}),result).MinimumOverallAverage,40);
});

test('branch overrides round trip without changing the organisation policy or saved public snapshot', () => {
  const parent=normalizeAcademicPolicy({Promotion:{Mode:'manual-review'}}), before=structuredClone(parent);
  const overrides=deriveAcademicPolicyOverrides(parent,policy);
  assert.deepEqual(normalizeAcademicPolicy(applyAcademicPolicyOverrides(parent,overrides)),policy);
  assert.deepEqual(parent,before);
  const view=publicAcademicResult({...result,PolicySnapshot:policy},{Allowed:true},parent);
  assert.equal(view.PolicySnapshot.Promotion.Primary.MinimumOverallAverage,60);
});

test('early-years reports omit secondary labels; samples never embed live signature or verification URLs', async () => {
  const context=vm.createContext({});vm.runInContext(await readFile(new URL('../js/academic-result-template.js',import.meta.url),'utf8'),context);
  const render=context.DynamaxAcademicResultTemplate.render;
  const profile={ResultSignatoryName:'REAL SIGNER',ResultSignatoryTitle:'REAL TITLE',DocumentStampUrl:'https://school.example/private-stamp'};
  for (const stage of ['nursery','primary']) {
    const report={...result,SchoolStage:stage,PolicySnapshot:policy,Subjects:[],ResultReference:'SAMPLE'};
    const sample=render({},report,{profile,sampleLabel:stage,origin:'https://school.example'});
    assert.doesNotMatch(sample,/<th>Junior|<th>Senior|REAL SIGNER|REAL TITLE|private-stamp|api\/academic-result-qr/);
    assert.match(sample,/Sample signature/);assert.match(sample,/Alex Sample/);assert.match(sample,/Progression criteria/);
    const real=render({},report,{profile});assert.match(real,/REAL SIGNER/);assert.match(real,/private-stamp/);
  }
});
