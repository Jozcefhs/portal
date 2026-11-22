import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  academicPolicyAssignmentId,
  academicPolicyIssues,
  academicPolicyScopeChain,
  applyAcademicPolicyOverrides,
  assertAcademicPolicyActivatable,
  defaultAcademicPolicy,
  deriveAcademicPolicyOverrides,
  normalizeAcademicPolicy,
  normalizeAcademicPolicyScope,
  resolveAcademicPolicyChain
} from '../functions/lib/academic-policy.js';

const [policyApiSource, policyStoreSource, backupSource, setupHtmlSource, setupJsSource, styleSource] = await Promise.all([
  readFile(new URL('../functions/api/academic-policy.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/academic-policy-store.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/organization-backup.js', import.meta.url), 'utf8'),
  readFile(new URL('../setup.html', import.meta.url), 'utf8'),
  readFile(new URL('../js/setup.js', import.meta.url), 'utf8'),
  readFile(new URL('../css/style.css', import.meta.url), 'utf8')
]);

function completePolicy() {
  return normalizeAcademicPolicy({
    ResultAccess: {
      VisibilityMode: 'current-term',
      FinancialClearance: {
        Mode: 'minimum-paid-percentage',
        MinimumPaidPercentage: 75,
        RecognizeScholarships: true,
        RecognizePaymentPlans: true,
        AllowManualExemptions: true
      }
    },
    Position: {
      Mode: 'internal-only',
      TieMode: 'dense',
      MinimumAssessedSubjects: 5
    },
    Assessment: {
      Components: [
        { Id: 'ca', Name: 'Continuous assessment', MaximumScore: 40, WeightPercentage: 40, SourceMode: 'any' },
        { Id: 'exam', Name: 'Examination', MaximumScore: 60, WeightPercentage: 60, SourceMode: 'built-in-cbt' }
      ],
      GradeBands: [
        { Grade: 'A', MinimumPercentage: 70, MaximumPercentage: 100, GradePoint: 5, Remark: 'Excellent' },
        { Grade: 'B', MinimumPercentage: 40, MaximumPercentage: 69.99, GradePoint: 3, Remark: 'Pass' },
        { Grade: 'F', MinimumPercentage: 0, MaximumPercentage: 39.99, GradePoint: 0, Remark: 'Needs improvement', Classification: 'fail' }
      ]
    },
    Cumulative: {
      Terms: [
        { Id: 'first', TermName: 'First Term', WeightPercentage: 30, Required: true, Order: 1 },
        { Id: 'second', TermName: 'Second Term', WeightPercentage: 30, Required: true, Order: 2 },
        { Id: 'third', TermName: 'Third Term', WeightPercentage: 40, Required: true, Order: 3 }
      ],
      MissingTermMode: 'block',
      MissingSubjectMode: 'manual-review',
      IncludeTransferredResults: true
    },
    Promotion: {
      Mode: 'criteria',
      MinimumOverallAverage: 50,
      RequiredCoreSubjectIds: ['english', 'mathematics'],
      MaximumFailedSubjects: 3,
      MinimumAttendancePercentage: 75,
      RequireAllTerms: true,
      ManualReviewMinimum: 45,
      ManualReviewMaximum: 49.99
    }
  });
}

test('academic policy starts explicitly unconfigured instead of hardcoding school decisions', () => {
  const policy = defaultAcademicPolicy();

  assert.equal(policy.ResultAccess.VisibilityMode, 'unconfigured');
  assert.equal(policy.ResultAccess.FinancialClearance.Mode, 'unconfigured');
  assert.equal(policy.Position.Mode, 'unconfigured');
  assert.equal(policy.Promotion.Mode, 'unconfigured');
  assert.equal(policy.Promotion.ProbationResit.Enabled, false);
  assert.equal(policy.Promotion.ProbationResit.PassPercentage, 50);
  assert.deepEqual(policy.Assessment.Components, []);
  assert.deepEqual(policy.Assessment.GradeBands, []);
});

test('normalization supports configurable result, finance, grading and promotion choices', () => {
  const policy = completePolicy();

  assert.equal(policy.ResultAccess.VisibilityMode, 'current-term');
  assert.equal(policy.ResultAccess.FinancialClearance.MinimumPaidPercentage, 75);
  assert.equal(policy.Position.Mode, 'internal-only');
  assert.equal(policy.Assessment.Components.reduce((sum, row) => sum + row.WeightPercentage, 0), 100);
  assert.equal(policy.Cumulative.Terms.reduce((sum, row) => sum + row.WeightPercentage, 0), 100);
  assert.equal(policy.Cumulative.MissingSubjectMode, 'manual-review');
  assert.deepEqual(policy.Promotion.RequiredCoreSubjectIds, ['english', 'mathematics']);
  assert.equal(policy.Promotion.MinimumAttendancePercentage, 75);
  assert.equal(policy.Promotion.ProbationResit.Enabled, false);
});

test('separate Junior and Senior promotion rules are normalized and validated without hardcoded thresholds', () => {
  const policy = completePolicy();
  policy.Promotion = {
    Mode: 'division-rules',
    ProbationResit: { Enabled: true, PassPercentage: 60 },
    RequireAllTerms: true,
    MinimumAttendancePercentage: null,
    JuniorSecondary: { PromotedMinimumAverage: 54.5, ProbationMinimumAverage: 49.5 },
    SeniorSecondary: {
      CreditMinimumPercentage: 50,
      ExpectedCoreSubjectCount: 5,
      PromotedMinimumCredits: 3,
      PromotedRequiredSubjectIds: ['mathematics', 'english'],
      PromotedRequiredSubjectMode: 'all',
      ProbationCreditCount: 2,
      ProbationCreditCountMode: 'exactly',
      ProbationRequiredSubjectIds: ['mathematics', 'english'],
      ProbationRequiredSubjectMode: 'any'
    }
  };
  const normalized = normalizeAcademicPolicy(policy);
  assert.equal(normalized.Promotion.JuniorSecondary.PromotedMinimumAverage, 54.5);
  assert.equal(normalized.Promotion.ProbationResit.Enabled, true);
  assert.equal(normalized.Promotion.ProbationResit.PassPercentage, 60);
  assert.equal(normalized.Promotion.SeniorSecondary.ExpectedCoreSubjectCount, 5);
  assert.deepEqual(normalized.Promotion.SeniorSecondary.PromotedRequiredSubjectIds, ['mathematics', 'english']);
  assert.equal(academicPolicyIssues(normalized, { forActivation: true }).filter((issue) => issue.path.startsWith('Promotion')).length, 0);

  normalized.Promotion.JuniorSecondary.ProbationMinimumAverage = 60;
  assert.ok(academicPolicyIssues(normalized).some((issue) => issue.code === 'JUNIOR_PROMOTION_THRESHOLDS_INVALID'));
});

test('activation fails closed while required policy choices are incomplete', () => {
  const issues = academicPolicyIssues(defaultAcademicPolicy(), { forActivation: true });

  assert.ok(issues.some((issue) => issue.code === 'RESULT_VISIBILITY_REQUIRED'));
  assert.ok(issues.some((issue) => issue.code === 'FEE_CLEARANCE_REQUIRED'));
  assert.ok(issues.some((issue) => issue.code === 'POSITION_POLICY_REQUIRED'));
  assert.ok(issues.some((issue) => issue.code === 'ASSESSMENT_COMPONENTS_REQUIRED'));
  assert.ok(issues.some((issue) => issue.code === 'GRADE_BANDS_REQUIRED'));
  assert.ok(issues.some((issue) => issue.code === 'PROMOTION_POLICY_REQUIRED'));
  assert.throws(() => assertAcademicPolicyActivatable(defaultAcademicPolicy()), {
    code: 'ACADEMIC_POLICY_INCOMPLETE'
  });
});

test('a complete configured policy can be activated', () => {
  const policy = assertAcademicPolicyActivatable(completePolicy());

  assert.equal(policy.Assessment.Components.length, 2);
  assert.equal(policy.Assessment.GradeBands.length, 3);
});

test('A through F bands can classify E as probation without losing full grading coverage', () => {
  const policy = completePolicy();
  policy.Assessment.GradeBands = [
    { Grade: 'A', MinimumPercentage: 80, MaximumPercentage: 100, GradePoint: 5, Classification: 'pass' },
    { Grade: 'B', MinimumPercentage: 70, MaximumPercentage: 79.99, GradePoint: 4, Classification: 'pass' },
    { Grade: 'C', MinimumPercentage: 60, MaximumPercentage: 69.99, GradePoint: 3, Classification: 'pass' },
    { Grade: 'D', MinimumPercentage: 50, MaximumPercentage: 59.99, GradePoint: 2, Classification: 'pass' },
    { Grade: 'E', MinimumPercentage: 40, MaximumPercentage: 49.99, GradePoint: 1, Classification: 'probation' },
    { Grade: 'F', MinimumPercentage: 0, MaximumPercentage: 39.99, GradePoint: 0, Classification: 'fail' }
  ];
  const activated = assertAcademicPolicyActivatable(policy);

  assert.equal(activated.Assessment.GradeBands.find((band) => band.Grade === 'E').Classification, 'probation');
  assert.match(setupJsSource, /\['probation', 'Probation'\]/);
});

test('invalid component totals and grade ranges are reported before activation', () => {
  const policy = completePolicy();
  policy.Assessment.Components[0].WeightPercentage = 30;
  policy.Assessment.GradeBands[1].MinimumPercentage = 60;
  policy.Assessment.GradeBands[1].MaximumPercentage = 80;

  const issues = academicPolicyIssues(policy, { forActivation: true });

  assert.ok(issues.some((issue) => issue.code === 'ASSESSMENT_WEIGHT_TOTAL_INVALID'));
  assert.ok(issues.some((issue) => issue.code === 'GRADE_BAND_OVERLAP'));
});

test('assessment policy can create separate Objective A and Theory B scorebook fields', () => {
  const policy = completePolicy();
  policy.Assessment.Components[0] = {
    ...policy.Assessment.Components[0],
    ScoreEntryMode: 'objective-theory',
    ObjectiveMaximumScore: 25,
    TheoryMaximumScore: 15,
    SourceMode: 'built-in-cbt'
  };
  const normalized = normalizeAcademicPolicy(policy);
  assert.equal(normalized.Assessment.Components[0].ScoreEntryMode, 'objective-theory');
  assert.equal(normalized.Assessment.Components[0].ObjectiveMaximumScore, 25);
  assert.equal(normalized.Assessment.Components[0].TheoryMaximumScore, 15);
  assert.equal(academicPolicyIssues(normalized, { forActivation: true }).filter((issue) => issue.path.startsWith('Assessment.Components.0')).length, 0);

  normalized.Assessment.Components[0].TheoryMaximumScore = 10;
  assert.ok(academicPolicyIssues(normalized).some((issue) => issue.code === 'ASSESSMENT_SPLIT_MAXIMUM_INVALID'));
  assert.match(setupHtmlSource, /Split A\/B/);
  assert.match(setupJsSource, /ScoreEntryMode: split\.checked \? 'objective-theory' : 'single'/);
});

test('mid-term release is policy-controlled and limited to one or two configured components', () => {
  const policy = completePolicy();
  policy.MidTerm = { Enabled: true, ComponentIds: ['ca'] };
  const normalized = normalizeAcademicPolicy(policy);
  assert.equal(normalized.MidTerm.Enabled, true);
  assert.deepEqual(normalized.MidTerm.ComponentIds, ['ca']);
  assert.equal(academicPolicyIssues(normalized, { forActivation: true }).filter((issue) => issue.path.startsWith('MidTerm')).length, 0);

  normalized.MidTerm.ComponentIds = [];
  assert.ok(academicPolicyIssues(normalized).some((issue) => issue.code === 'MIDTERM_COMPONENTS_REQUIRED'));
  normalized.MidTerm.ComponentIds = ['ca', 'exam', 'invented'];
  const issues = academicPolicyIssues(normalized);
  assert.ok(issues.some((issue) => issue.code === 'MIDTERM_COMPONENT_LIMIT'));
  assert.ok(issues.some((issue) => issue.code === 'MIDTERM_COMPONENT_UNKNOWN'));
});

test('lower academic scopes store only intentional differences and inherit the rest', () => {
  const organisation = completePolicy();
  const branchSubmission = structuredClone(organisation);
  branchSubmission.ResultAccess.FinancialClearance.Mode = 'any-balance';
  branchSubmission.Position.Mode = 'none';

  const overrides = deriveAcademicPolicyOverrides(organisation, branchSubmission);
  const effective = applyAcademicPolicyOverrides(organisation, overrides);

  assert.deepEqual(overrides, {
    ResultAccess: { FinancialClearance: { Mode: 'any-balance' } },
    Position: { Mode: 'none' }
  });
  assert.equal(effective.ResultAccess.FinancialClearance.Mode, 'any-balance');
  assert.equal(effective.Position.Mode, 'none');
  assert.deepEqual(effective.Assessment.Components, organisation.Assessment.Components);
  assert.equal(effective.Promotion.MinimumOverallAverage, 50);
});

test('policy chains resolve organisation, branch, section, class and subject precedence', () => {
  const effective = resolveAcademicPolicyChain([
    { Overrides: deriveAcademicPolicyOverrides(defaultAcademicPolicy(), completePolicy()) },
    { Overrides: { Position: { Mode: 'none' } } },
    { Overrides: { ResultAccess: { VisibilityMode: 'current-session' } } },
    { Overrides: { Promotion: { MinimumOverallAverage: 55 } } },
    { Overrides: { Assessment: { Components: [
      { Id: 'exam', Name: 'Subject examination', MaximumScore: 100, WeightPercentage: 100, SourceMode: 'built-in-cbt', Required: true, Order: 1 }
    ] } } }
  ]);

  assert.equal(effective.Position.Mode, 'none');
  assert.equal(effective.ResultAccess.VisibilityMode, 'current-session');
  assert.equal(effective.Promotion.MinimumOverallAverage, 55);
  assert.equal(effective.Assessment.Components.length, 1);
  assert.equal(effective.Assessment.Components[0].WeightPercentage, 100);
});

test('independent branch policies isolate the complete policy and test components from organisation changes', () => {
  const organisation = completePolicy();
  organisation.Assessment.Components = [{
    Id: 'organisation-exam', Name: 'Organisation exam', MaximumScore: 100,
    WeightPercentage: 100, SourceMode: 'built-in-cbt', Required: true, Order: 1
  }];
  const branch = completePolicy();
  branch.Assessment.Components = [
    { Id: 'branch-test', Name: 'Branch test', MaximumScore: 30, WeightPercentage: 30, SourceMode: 'any', Required: true, Order: 1 },
    { Id: 'branch-exam', Name: 'Branch exam', MaximumScore: 70, WeightPercentage: 70, SourceMode: 'built-in-cbt', Required: true, Order: 2 }
  ];

  const effective = resolveAcademicPolicyChain([
    {
      Scope: { Type: 'organisation', Id: 'organisation' },
      InheritanceMode: 'independent',
      Overrides: deriveAcademicPolicyOverrides(defaultAcademicPolicy(), organisation)
    },
    {
      Scope: { Type: 'branch', Id: 'area-one' },
      InheritanceMode: 'independent',
      Overrides: deriveAcademicPolicyOverrides(defaultAcademicPolicy(), branch)
    }
  ]);

  assert.deepEqual(effective.Assessment.Components.map((row) => row.Id), ['branch-test', 'branch-exam']);
  assert.equal(effective.Position.Mode, branch.Position.Mode);
  assert.equal(effective.ResultAccess.FinancialClearance.Mode, branch.ResultAccess.FinancialClearance.Mode);
});

test('effective-dated assignment ids are stable and isolated by scope', () => {
  const organisationId = academicPolicyAssignmentId(
    { Type: 'organisation' },
    { Session: '2026/2027', Term: 'First Term' }
  );
  const branchId = academicPolicyAssignmentId(
    { Type: 'branch', Id: 'North Campus' },
    { Session: '2026/2027', Term: 'First Term' }
  );

  assert.equal(organisationId, 'policy__organisation__organisation__2026-2027__first-term');
  assert.equal(branchId, 'policy__branch__north-campus__2026-2027__first-term');
  assert.notEqual(organisationId, branchId);
  assert.deepEqual(normalizeAcademicPolicyScope({ Type: 'organization' }), {
    Type: 'organisation',
    Id: 'organisation'
  });
});

test('scope chains preserve the documented policy inheritance order', () => {
  assert.deepEqual(academicPolicyScopeChain({
    BranchId: 'North',
    SectionId: 'Secondary',
    ClassId: 'JSS 1',
    SubjectId: 'Mathematics'
  }), [
    { Type: 'organisation', Id: 'organisation' },
    { Type: 'branch', Id: 'north' },
    { Type: 'section', Id: 'secondary', BranchId: 'north' },
    { Type: 'class', Id: 'jss-1' },
    { Type: 'subject', Id: 'mathematics' }
  ]);
});

test('protected academic policy persistence keeps immutable revisions separate from active assignments', () => {
  assert.match(policyApiSource, /requireSetupAdministrator/);
  assert.match(policyApiSource, /deployment\.edition !== 'school'/);
  assert.match(policyApiSource, /saveAcademicPolicyDraft/);
  assert.match(policyApiSource, /activateAcademicPolicyDraft/);
  assert.match(policyApiSource, /inheritAcademicPolicyAtScope/);
  assert.match(policyStoreSource, /academicPolicyRevisions/);
  assert.match(policyStoreSource, /academicPolicyAssignments/);
  assert.match(policyStoreSource, /createDocumentIfAbsent/);
  assert.match(policyStoreSource, /ActiveRevisionId/);
  assert.match(policyStoreSource, /DraftRevisionId/);
  assert.match(policyStoreSource, /ActiveRevisionId: view\.DraftRevisionId,[\s\S]*DraftRevisionId: ''/);
  assert.match(policyStoreSource, /assertAcademicPolicyActivatable/);
  assert.match(policyStoreSource, /InheritanceMode: mode/);
  assert.match(policyStoreSource, /mode === 'independent' \? defaultAcademicPolicy\(\) : view\.InheritedPolicy/);
});

test('academic policy assignments and immutable revisions are covered by dynamic backup and restore', () => {
  assert.match(backupSource, /listRootCollectionIds/);
  assert.match(backupSource, /rootIds[\s\S]*filter\(\(collection\) => !EXCLUDED_ROOT_COLLECTIONS\.has\(collection\)\)/);
  assert.doesNotMatch(backupSource, /EXCLUDED_ROOT_COLLECTIONS[\s\S]{0,500}academicPolicy(?:Assignments|Revisions)/);
  assert.match(backupSource, /if \(parts\.length === 1\) return \/\^\[A-Za-z0-9\._-\]/);
});

test('School settings expose configurable result, grading and promotion policy controls', () => {
  assert.match(setupHtmlSource, /id="academic-policy-settings"[^>]*data-school-settings-only/);
  assert.match(setupHtmlSource, /id="academicResultVisibility"/);
  assert.match(setupHtmlSource, /id="academicFeeClearanceMode"/);
  assert.match(setupHtmlSource, /id="academicPositionMode"/);
  assert.match(setupHtmlSource, /id="academicComponents"/);
  assert.match(setupHtmlSource, /id="academicPolicyInheritanceMode"/);
  assert.match(setupHtmlSource, /Independent branch policy/);
  assert.match(setupHtmlSource, /id="academicMidTermEnabled"/);
  assert.match(setupHtmlSource, /id="academicGradeBands"/);
  assert.match(setupHtmlSource, /id="academicCumulativeTerms"/);
  assert.match(setupHtmlSource, /id="academicMissingTermMode"/);
  assert.match(setupHtmlSource, /id="academicMissingSubjectMode"/);
  assert.match(setupHtmlSource, /id="academicIncludeTransferredResults"/);
  assert.match(setupHtmlSource, /id="academicPromotionMode"/);
  assert.match(setupHtmlSource, /id="academicProbationResitEnabled"/);
  assert.match(setupHtmlSource, /id="academicProbationResitPassPercentage"/);
  assert.match(setupHtmlSource, /id="academicJuniorPromotedMinimum"/);
  assert.match(setupHtmlSource, /id="academicJuniorProbationMinimum"/);
  assert.match(setupHtmlSource, /id="academicSeniorCreditMinimum"/);
  assert.match(setupHtmlSource, /id="academicSeniorPromotedRequiredSubjects"/);
  assert.match(setupHtmlSource, /id="academicSeniorProbationRequiredSubjects"/);
  assert.match(setupHtmlSource, /id="saveAcademicPolicyButton"/);
  assert.match(setupHtmlSource, /id="activateAcademicPolicyButton"/);
  assert.match(setupHtmlSource, /Choose which published results families can open/);
  assert.match(setupJsSource, /fetch\('\/api\/academic-policy'/);
  assert.match(setupJsSource, /function academicPolicyFromForm\(\)/);
  assert.match(setupJsSource, /InheritanceMode: settingsScopeField\.value === 'branch'/);
  assert.match(setupJsSource, /MidTermIncluded/);
  assert.match(setupJsSource, /function renderAcademicCumulativeTerms\(/);
  assert.match(setupJsSource, /function renderAcademicPolicyView\(view = \{\}, message = ''\)/);
  assert.match(setupJsSource, /DynamaxDialogs\.confirm\(\{/);
  assert.match(setupJsSource, /activateAcademicPolicyButton\?\.addEventListener\('click', async \(event\) => \{\s*const button = event\.currentTarget;\s*if \(!await window\.DynamaxDialogs\.confirm/);
  assert.match(setupJsSource, /inheritAcademicPolicyButton\?\.addEventListener\('click', async \(event\) => \{\s*const button = event\.currentTarget;/);
  assert.doesNotMatch(setupJsSource, /DynamaxDialogs\.confirm\([\s\S]{0,500}\)\) return;\s*const button = event\.currentTarget;/);
  assert.match(setupJsSource, /requestAcademicPolicy\('activate'\);\s*announceSettingsChange\(\);/);
  assert.match(setupJsSource, /requestAcademicPolicy\('inherit'\);\s*announceSettingsChange\(\);/);
  assert.match(setupHtmlSource, /css\/style\.css\?v=20260923-youtube-tutorials/);
  assert.match(setupHtmlSource, /js\/setup\.js\?v=[^"\s]+/);
  assert.match(setupHtmlSource, /<span>Split A\/B<\/span><span>A objective<\/span><span>B theory<\/span><span>Required<\/span><span>Mid-term<\/span>/);
  assert.match(setupJsSource, /row\.append\(name, maximum, weight, source, split, objective, theory, required, midTerm, remove\)/);
  assert.match(styleSource, /\.academic-component-grid/);
  assert.match(styleSource, /\.academic-grade-grid/);
  assert.match(styleSource, /\.academic-cumulative-grid/);
  assert.match(styleSource, /html\[data-theme="dark"\] \.academic-policy-state/);
});

async function policyFixture() {
  const { runInNewContext } = await import('node:vm');
  const model = await import('../functions/lib/academic-policy.js');
  const { academicAssessmentScheme, calculateAcademicStudentScore } = await import('../functions/lib/academic-scorebook.js');
  const records = new Map();
  let version = 0;
  const read = (_, collection, id) => records.get(collection + '/' + id);
  const store = { ...model, crypto, getDocument:read,
    createDocumentIfAbsent(_,collection,id,row) {
      assert.equal(collection,'academicPolicyRevisions');
      assert.ok(!read(null,collection,id));
      records.set(collection+'/'+id,structuredClone(row));
      return {created:true};
    },
    upsertDocument(_,collection,id,row,condition) {
      assert.equal(collection,'academicPolicyAssignments');
      const current = read(null,collection,id);
      if (condition.exists === false) assert.equal(current,undefined);
      else assert.equal(condition.updateTime,current.__updateTime);
      records.set(collection+'/'+id,{...row,__updateTime:String(++version)});
    }
  };
  runInNewContext(policyStoreSource.replace(/^import [\s\S]*?;\s*/gm,'').replace(/^export /gm,''),store);
  const period = {Session:'2026/2027',Term:'First Term'};
  function target(branch,section,schoolClass,metadata) {
    const scopeChain = academicPolicyScopeChain({BranchId:branch,SectionId:section,ClassId:schoolClass,SchoolClass:metadata});
    return {scope:scopeChain.at(-1),scopeChain,period};
  }
  async function load(where) { return store.loadAcademicPolicyView({},where); }
  async function draft(where,policy,sectionRuleChanges) {
    const view = await load(where);
    return store.saveAcademicPolicyDraft({},{...where,policy,sectionRuleChanges,expectedRevision:view.RevisionToken});
  }
  async function activate(where,view) {
    return store.activateAcademicPolicyDraft({},{...where,expectedRevision:view.RevisionToken,expectedDraftRevisionId:view.DraftRevisionId});
  }
  return {store,target,load,draft,activate,academicAssessmentScheme,calculateAcademicStudentScore};
}

test('an assessment-only Primary draft can complete all four activation requirements inside its section', async () => {
  const {target,load,draft,activate}=await policyFixture();
  const primary=target('main','primary');
  const assessments=defaultAcademicPolicy();
  assessments.Assessment=completePolicy().Assessment;
  const before=await draft(primary,assessments);
  assert.deepEqual(Array.from(before.ActivationIssues, issue=>issue.path).sort(),[
    'Position.Mode','Promotion.Mode','ResultAccess.FinancialClearance.Mode','ResultAccess.VisibilityMode'
  ]);
  const edited=structuredClone(before.Policy);
  edited.ResultAccess.VisibilityMode='current-session';
  edited.ResultAccess.FinancialClearance.Mode='any-balance';
  edited.Position.Mode='internal-only';
  edited.Promotion.Mode='criteria';
  edited.Promotion.MinimumOverallAverage=55;
  const saved=await draft(primary,edited,['ResultAccess','Position','Promotion']);
  assert.equal(saved.CanActivate,true);
  assert.equal((await load(primary)).ActivePolicy.Promotion.Mode,'unconfigured');
  const active=await activate(primary,saved);
  for(const group of ['ResultAccess','Position','Promotion','Assessment']) {
    assert.deepEqual(active.ActivePolicy[group],edited[group]);
  }
  assert.equal((await load(target('main','nursery'))).ActivePolicy.Promotion.MinimumOverallAverage,55);
  for(const other of [target('main'),target('main','secondary'),target('west','primary')]) {
    assert.equal((await load(other)).ActivePolicy.ResultAccess.VisibilityMode,'unconfigured');
  }
  const legacy=await draft(primary,assessments);
  assert.deepEqual(legacy.Policy.ResultAccess,edited.ResultAccess);
  assert.deepEqual(legacy.Policy.Assessment,assessments.Assessment);
  const inherited=structuredClone(edited);
  inherited.Position=defaultAcademicPolicy().Position;
  const cleared=await draft(primary,inherited,['Position']);
  assert.equal(cleared.DraftOverrides.Position,undefined);
  assert.equal(cleared.CanActivate,false);
});

test('section cumulative settings persist, inherit and revert independently', async () => {
  const { target, load, draft, activate } = await policyFixture();
  const branch = target('main');
  const original = completePolicy();
  await activate(branch, await draft(branch, original));
  const primary = target('main', 'primary');
  const nursery = target('main', 'nursery');
  const secondary = target('main', 'secondary');
  const edited = structuredClone(original);
  edited.Cumulative.Terms[0].WeightPercentage = 20;
  edited.Cumulative.Terms[2].WeightPercentage = 50;
  edited.Cumulative.IncludeTransferredResults = false;
  const saved = await draft(primary, edited, ['Cumulative']);
  assert.deepEqual((await load(primary)).ActivePolicy.Cumulative, original.Cumulative);
  await activate(primary, saved);
  for (const scope of [primary, nursery]) {
    assert.deepEqual((await load(scope)).ActivePolicy.Cumulative, edited.Cumulative);
  }
  assert.deepEqual((await load(secondary)).ActivePolicy.Cumulative, original.Cumulative);
  assert.deepEqual((await draft(primary, original)).Policy.Cumulative, edited.Cumulative);
  const reverted = await draft(primary, original, ['Cumulative']);
  assert.equal(reverted.DraftOverrides.Cumulative, undefined);
  await activate(primary, reverted);
  assert.deepEqual((await load(nursery)).ActivePolicy.Cumulative, original.Cumulative);
});

test('primary and secondary grading activate independently in each branch and retain historical schemes', async () => {
  const {store,target,load,draft,activate,academicAssessmentScheme,calculateAcademicStudentScore}=await policyFixture();
  const organisation=target(), primary=target('main','primary'), secondary=target('main','secondary');
  const original=completePolicy();
  await activate(organisation,await draft(organisation,original));
  const primaryPolicy=structuredClone(original);
  primaryPolicy.Assessment.Components=[{...original.Assessment.Components[1],WeightPercentage:100,MaximumScore:100}];
  primaryPolicy.Assessment.GradeBands=[{Grade:'P',MinimumPercentage:0,MaximumPercentage:100,GradePoint:1,Remark:'Primary'}];
  primaryPolicy.ResultAccess.VisibilityMode='all-published';
  const saved=await draft(primary,primaryPolicy);
  assert.equal((await load(primary)).ActivePolicy.Assessment.Components.length,2);
  await activate(primary,saved);
  const classPolicy=async (branch,section)=>(await load(target(branch,section,'class-1'))).ActivePolicy;
  const primaryActive=await classPolicy('main','primary');
  const historical=academicAssessmentScheme(primaryActive);
  const marks=[{ComponentId:'exam',RawScore:70}];
  assert.equal(calculateAcademicStudentScore(historical,marks).Grade,'P');
  assert.equal(primaryActive.ResultAccess.VisibilityMode,original.ResultAccess.VisibilityMode);
  for (const [branch,section] of [['main','secondary'],['west','primary']]) {
    const other=await classPolicy(branch,section);
    assert.deepEqual(other.Assessment,original.Assessment);
  }
  const secondaryPolicy=structuredClone(original);
  secondaryPolicy.Assessment.Components[0].WeightPercentage=25;
  secondaryPolicy.Assessment.Components[1].WeightPercentage=75;
  await activate(secondary,await draft(secondary,secondaryPolicy));
  const secondaryScheme=academicAssessmentScheme(await classPolicy('main','secondary'));
  const secondaryScore=calculateAcademicStudentScore(secondaryScheme,[{ComponentId:'ca',RawScore:40},{ComponentId:'exam',RawScore:30}]);
  assert.equal(secondaryScore.Percentage,62.5);
  const nursery = target('main','nursery');
  const early = target('main','primary','early',{Name:'Nursery Two',SchoolStage:'primary'});
  assert.deepEqual((await load(early)).ActivePolicy.Assessment,primaryActive.Assessment);
  const nurseryPolicy=structuredClone(original);
  nurseryPolicy.Assessment.Components[0].WeightPercentage=80;
  nurseryPolicy.Assessment.Components[1].WeightPercentage=20;
  nurseryPolicy.Assessment.GradeBands=[{Grade:'N',MinimumPercentage:0,MaximumPercentage:100,GradePoint:1,Remark:'Nursery'}];
  const nurseryDraft=await draft(nursery,nurseryPolicy);
  assert.deepEqual((await load(early)).ActivePolicy.Assessment,primaryActive.Assessment);
  await activate(nursery,nurseryDraft);
  const nurseryScheme=academicAssessmentScheme((await load(early)).ActivePolicy);
  const nurseryMarks=[{ComponentId:'ca',RawScore:40},{ComponentId:'exam',RawScore:30}];
  const result=calculateAcademicStudentScore(nurseryScheme,nurseryMarks);
  assert.equal(result.Percentage,90);
  assert.equal(result.Grade,'N');
  const ids=(branch,section,metadata)=>target(branch,section,'a',metadata).scopeChain.map(s=>s.Id);
  for(const Name of ['KG 1','Pre-Nursery','Crèche','Reception','Kindergarten']) assert.ok(ids('main','primary',{Name}).includes('nursery'));
  assert.ok(ids('main','primary',{SchoolStage:'nursery',Name:'Sunflowers'}).includes('nursery'));
  assert.ok(!ids('main','secondary',{Name:'Nursery Two'}).includes('nursery'));
  assert.deepEqual((await classPolicy('main','primary')).Assessment,primaryActive.Assessment);
  assert.deepEqual((await load(target('west','primary','early',{Name:'Nursery Two'}))).ActivePolicy.Assessment,original.Assessment);
  const activeNursery=await load(nursery);
  await store.inheritAcademicPolicyAtScope({},{...nursery,expectedRevision:activeNursery.RevisionToken});
  assert.deepEqual((await load(early)).ActivePolicy.Assessment,primaryActive.Assessment);
  assert.deepEqual(calculateAcademicStudentScore(nurseryScheme,nurseryMarks),result);
  const view=await load(primary);
  await store.inheritAcademicPolicyAtScope({},{...primary,expectedRevision:view.RevisionToken});
  assert.deepEqual((await classPolicy('main','primary')).Assessment,original.Assessment);
  assert.equal(calculateAcademicStudentScore(historical,marks).Grade,'P');
  assert.equal((await classPolicy('main','secondary')).Assessment.Components[0].WeightPercentage,25);
});
