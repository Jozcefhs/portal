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

test('invalid component totals and grade ranges are reported before activation', () => {
  const policy = completePolicy();
  policy.Assessment.Components[0].WeightPercentage = 30;
  policy.Assessment.GradeBands[1].MinimumPercentage = 60;
  policy.Assessment.GradeBands[1].MaximumPercentage = 80;

  const issues = academicPolicyIssues(policy, { forActivation: true });

  assert.ok(issues.some((issue) => issue.code === 'ASSESSMENT_WEIGHT_TOTAL_INVALID'));
  assert.ok(issues.some((issue) => issue.code === 'GRADE_BAND_OVERLAP'));
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
    { Type: 'section', Id: 'secondary' },
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
  assert.match(setupHtmlSource, /id="academicGradeBands"/);
  assert.match(setupHtmlSource, /id="academicCumulativeTerms"/);
  assert.match(setupHtmlSource, /id="academicMissingTermMode"/);
  assert.match(setupHtmlSource, /id="academicMissingSubjectMode"/);
  assert.match(setupHtmlSource, /id="academicIncludeTransferredResults"/);
  assert.match(setupHtmlSource, /id="academicPromotionMode"/);
  assert.match(setupHtmlSource, /id="saveAcademicPolicyButton"/);
  assert.match(setupHtmlSource, /id="activateAcademicPolicyButton"/);
  assert.match(setupHtmlSource, /protected result module will enforce the active policy when it is introduced/);
  assert.match(setupJsSource, /fetch\('\/api\/academic-policy'/);
  assert.match(setupJsSource, /function academicPolicyFromForm\(\)/);
  assert.match(setupJsSource, /function renderAcademicCumulativeTerms\(/);
  assert.match(setupJsSource, /function renderAcademicPolicyView\(view = \{\}, message = ''\)/);
  assert.match(setupJsSource, /DynamaxDialogs\.confirm\(\{/);
  assert.match(styleSource, /\.academic-component-grid/);
  assert.match(styleSource, /\.academic-grade-grid/);
  assert.match(styleSource, /\.academic-cumulative-grid/);
  assert.match(styleSource, /html\[data-theme="dark"\] \.academic-policy-state/);
});
