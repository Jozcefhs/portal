import { safeScopeId } from './school-scope.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export const ACADEMIC_POLICY_SCHEMA_VERSION = 1;
export const ACADEMIC_POLICY_SCOPE_TYPES = Object.freeze([
  'organisation',
  'branch',
  'section',
  'class',
  'subject'
]);
export const RESULT_VISIBILITY_MODES = Object.freeze([
  'unconfigured',
  'current-term',
  'current-session',
  'all-published',
  'published-and-transcripts'
]);
export const FEE_CLEARANCE_MODES = Object.freeze([
  'unconfigured',
  'none',
  'any-balance',
  'minimum-paid-percentage',
  'maximum-outstanding',
  'selected-fee-categories',
  'manual-clearance'
]);
export const POSITION_MODES = Object.freeze([
  'unconfigured',
  'none',
  'internal-only',
  'exact-overall',
  'subject-only',
  'percentile-band',
  'assessed-count'
]);
export const POSITION_TIE_MODES = Object.freeze(['competition', 'dense', 'shared']);
export const ASSESSMENT_SOURCE_MODES = Object.freeze([
  'any',
  'manual',
  'spreadsheet',
  'built-in-cbt',
  'external-cbt'
]);
export const PROMOTION_MODES = Object.freeze(['unconfigured', 'manual-review', 'criteria']);
export const CUMULATIVE_MISSING_MODES = Object.freeze(['block', 'exclude', 'zero', 'manual-review']);

function oneOf(value, choices, fallback) {
  const candidate = lower(value);
  return choices.includes(candidate) ? candidate : fallback;
}

function boundedNumber(value, fallback, minimum, maximum) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function optionalBoundedNumber(value, minimum, maximum) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(maximum, Math.max(minimum, number));
}

function yesNoBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = lower(value);
  if (['yes', 'true', '1', 'on'].includes(normalized)) return true;
  if (['no', 'false', '0', 'off'].includes(normalized)) return false;
  return fallback;
}

function uniqueTextList(value) {
  const rows = Array.isArray(value) ? value : clean(value).split(',');
  const seen = new Set();
  return rows.map(clean).filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function policyId(value, fallback = '') {
  const source = clean(value || fallback);
  return source ? safeScopeId(source, '') : '';
}

function normalizeComponent(row = {}, index = 0) {
  const name = clean(row.Name || row.name || row.Label || row.label);
  return {
    Id: policyId(row.Id || row.id, name || `component-${index + 1}`),
    Name: name,
    MaximumScore: boundedNumber(row.MaximumScore ?? row.maximumScore ?? row.MaxScore, 0, 0, 10000),
    WeightPercentage: boundedNumber(row.WeightPercentage ?? row.weightPercentage ?? row.Weight, 0, 0, 100),
    SourceMode: oneOf(row.SourceMode ?? row.sourceMode ?? row.Source, ASSESSMENT_SOURCE_MODES, 'any'),
    Required: yesNoBoolean(row.Required ?? row.required, true),
    Order: Math.max(1, Math.floor(boundedNumber(row.Order ?? row.order, index + 1, 1, 1000)))
  };
}

function normalizeGradeBand(row = {}, index = 0) {
  const grade = clean(row.Grade || row.grade || row.Name || row.name).toUpperCase();
  return {
    Id: policyId(row.Id || row.id, grade || `grade-${index + 1}`),
    Grade: grade,
    MinimumPercentage: boundedNumber(row.MinimumPercentage ?? row.minimumPercentage ?? row.Minimum, 0, 0, 100),
    MaximumPercentage: boundedNumber(row.MaximumPercentage ?? row.maximumPercentage ?? row.Maximum, 100, 0, 100),
    GradePoint: boundedNumber(row.GradePoint ?? row.gradePoint ?? row.Point, 0, 0, 100),
    Remark: clean(row.Remark || row.remark),
    Classification: oneOf(row.Classification ?? row.classification, ['pass', 'fail'], 'pass'),
    Order: Math.max(1, Math.floor(boundedNumber(row.Order ?? row.order, index + 1, 1, 1000)))
  };
}

function normalizeCumulativeTerm(row = {}, index = 0) {
  const name = clean(row.TermName || row.termName || row.Name || row.name);
  return {
    Id: policyId(row.Id || row.id, name || `term-${index + 1}`),
    TermId: clean(row.TermId || row.termId),
    TermName: name,
    WeightPercentage: boundedNumber(row.WeightPercentage ?? row.weightPercentage ?? row.Weight, 0, 0, 100),
    Required: yesNoBoolean(row.Required ?? row.required, true),
    Order: Math.max(1, Math.floor(boundedNumber(row.Order ?? row.order, index + 1, 1, 1000)))
  };
}

export function defaultAcademicPolicy() {
  return {
    SchemaVersion: ACADEMIC_POLICY_SCHEMA_VERSION,
    ResultAccess: {
      VisibilityMode: 'unconfigured',
      FinancialClearance: {
        Mode: 'unconfigured',
        MinimumPaidPercentage: 100,
        MaximumOutstanding: 0,
        FeeCategoryIds: [],
        RecognizeScholarships: true,
        RecognizePaymentPlans: true,
        AllowManualExemptions: true
      }
    },
    Position: {
      Mode: 'unconfigured',
      TieMode: 'competition',
      MinimumAssessedSubjects: 1
    },
    Assessment: {
      Components: [],
      GradeBands: []
    },
    Cumulative: {
      Terms: [],
      MissingTermMode: 'block',
      MissingSubjectMode: 'block',
      IncludeTransferredResults: true
    },
    Promotion: {
      Mode: 'unconfigured',
      MinimumOverallAverage: null,
      RequiredCoreSubjectIds: [],
      MaximumFailedSubjects: null,
      MinimumAttendancePercentage: null,
      RequireAllTerms: true,
      ManualReviewMinimum: null,
      ManualReviewMaximum: null
    }
  };
}

export function normalizeAcademicPolicy(value = {}) {
  const defaults = defaultAcademicPolicy();
  const result = value.ResultAccess || value.resultAccess || {};
  const financial = result.FinancialClearance || result.financialClearance || {};
  const position = value.Position || value.position || {};
  const assessment = value.Assessment || value.assessment || {};
  const cumulative = value.Cumulative || value.cumulative || {};
  const promotion = value.Promotion || value.promotion || {};
  const components = Array.isArray(assessment.Components || assessment.components)
    ? (assessment.Components || assessment.components)
    : [];
  const gradeBands = Array.isArray(assessment.GradeBands || assessment.gradeBands)
    ? (assessment.GradeBands || assessment.gradeBands)
    : [];
  const cumulativeTerms = Array.isArray(cumulative.Terms || cumulative.terms)
    ? (cumulative.Terms || cumulative.terms)
    : [];
  return {
    SchemaVersion: ACADEMIC_POLICY_SCHEMA_VERSION,
    ResultAccess: {
      VisibilityMode: oneOf(
        result.VisibilityMode ?? result.visibilityMode,
        RESULT_VISIBILITY_MODES,
        defaults.ResultAccess.VisibilityMode
      ),
      FinancialClearance: {
        Mode: oneOf(
          financial.Mode ?? financial.mode,
          FEE_CLEARANCE_MODES,
          defaults.ResultAccess.FinancialClearance.Mode
        ),
        MinimumPaidPercentage: boundedNumber(
          financial.MinimumPaidPercentage ?? financial.minimumPaidPercentage,
          defaults.ResultAccess.FinancialClearance.MinimumPaidPercentage,
          0,
          100
        ),
        MaximumOutstanding: boundedNumber(
          financial.MaximumOutstanding ?? financial.maximumOutstanding,
          defaults.ResultAccess.FinancialClearance.MaximumOutstanding,
          0,
          1000000000000
        ),
        FeeCategoryIds: uniqueTextList(financial.FeeCategoryIds ?? financial.feeCategoryIds ?? []),
        RecognizeScholarships: yesNoBoolean(
          financial.RecognizeScholarships ?? financial.recognizeScholarships,
          defaults.ResultAccess.FinancialClearance.RecognizeScholarships
        ),
        RecognizePaymentPlans: yesNoBoolean(
          financial.RecognizePaymentPlans ?? financial.recognizePaymentPlans,
          defaults.ResultAccess.FinancialClearance.RecognizePaymentPlans
        ),
        AllowManualExemptions: yesNoBoolean(
          financial.AllowManualExemptions ?? financial.allowManualExemptions,
          defaults.ResultAccess.FinancialClearance.AllowManualExemptions
        )
      }
    },
    Position: {
      Mode: oneOf(position.Mode ?? position.mode, POSITION_MODES, defaults.Position.Mode),
      TieMode: oneOf(position.TieMode ?? position.tieMode, POSITION_TIE_MODES, defaults.Position.TieMode),
      MinimumAssessedSubjects: Math.max(1, Math.floor(boundedNumber(
        position.MinimumAssessedSubjects ?? position.minimumAssessedSubjects,
        defaults.Position.MinimumAssessedSubjects,
        1,
        100
      )))
    },
    Assessment: {
      Components: components.map(normalizeComponent).sort((a, b) => a.Order - b.Order || a.Name.localeCompare(b.Name)),
      GradeBands: gradeBands.map(normalizeGradeBand).sort((a, b) => b.MinimumPercentage - a.MinimumPercentage || a.Order - b.Order)
    },
    Cumulative: {
      Terms: cumulativeTerms.map(normalizeCumulativeTerm).sort((a, b) => a.Order - b.Order || a.TermName.localeCompare(b.TermName)),
      MissingTermMode: oneOf(
        cumulative.MissingTermMode ?? cumulative.missingTermMode,
        CUMULATIVE_MISSING_MODES,
        defaults.Cumulative.MissingTermMode
      ),
      MissingSubjectMode: oneOf(
        cumulative.MissingSubjectMode ?? cumulative.missingSubjectMode,
        CUMULATIVE_MISSING_MODES,
        defaults.Cumulative.MissingSubjectMode
      ),
      IncludeTransferredResults: yesNoBoolean(
        cumulative.IncludeTransferredResults ?? cumulative.includeTransferredResults,
        defaults.Cumulative.IncludeTransferredResults
      )
    },
    Promotion: {
      Mode: oneOf(promotion.Mode ?? promotion.mode, PROMOTION_MODES, defaults.Promotion.Mode),
      MinimumOverallAverage: optionalBoundedNumber(
        promotion.MinimumOverallAverage ?? promotion.minimumOverallAverage,
        0,
        100
      ),
      RequiredCoreSubjectIds: uniqueTextList(
        promotion.RequiredCoreSubjectIds ?? promotion.requiredCoreSubjectIds ?? []
      ),
      MaximumFailedSubjects: optionalBoundedNumber(
        promotion.MaximumFailedSubjects ?? promotion.maximumFailedSubjects,
        0,
        100
      ),
      MinimumAttendancePercentage: optionalBoundedNumber(
        promotion.MinimumAttendancePercentage ?? promotion.minimumAttendancePercentage,
        0,
        100
      ),
      RequireAllTerms: yesNoBoolean(
        promotion.RequireAllTerms ?? promotion.requireAllTerms,
        defaults.Promotion.RequireAllTerms
      ),
      ManualReviewMinimum: optionalBoundedNumber(
        promotion.ManualReviewMinimum ?? promotion.manualReviewMinimum,
        0,
        100
      ),
      ManualReviewMaximum: optionalBoundedNumber(
        promotion.ManualReviewMaximum ?? promotion.manualReviewMaximum,
        0,
        100
      )
    }
  };
}

function deepMerge(base, overrides) {
  if (Array.isArray(overrides)) return overrides.map((item) => (
    item && typeof item === 'object' ? deepMerge(Array.isArray(item) ? [] : {}, item) : item
  ));
  if (!overrides || typeof overrides !== 'object') return overrides;
  const output = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  Object.entries(overrides).forEach(([key, value]) => {
    output[key] = value && typeof value === 'object'
      ? deepMerge(output[key], value)
      : value;
  });
  return output;
}

function deepDiff(base, submitted) {
  if (Array.isArray(submitted)) {
    return JSON.stringify(base) === JSON.stringify(submitted) ? undefined : submitted;
  }
  if (!submitted || typeof submitted !== 'object') {
    return Object.is(base, submitted) ? undefined : submitted;
  }
  const difference = {};
  Object.entries(submitted).forEach(([key, value]) => {
    const child = deepDiff(base?.[key], value);
    if (child !== undefined) difference[key] = child;
  });
  return Object.keys(difference).length ? difference : undefined;
}

export function applyAcademicPolicyOverrides(basePolicy = {}, overrides = {}) {
  return normalizeAcademicPolicy(deepMerge(normalizeAcademicPolicy(basePolicy), overrides || {}));
}

export function deriveAcademicPolicyOverrides(inheritedPolicy = {}, submittedPolicy = {}) {
  return deepDiff(normalizeAcademicPolicy(inheritedPolicy), normalizeAcademicPolicy(submittedPolicy)) || {};
}

export function resolveAcademicPolicyChain(revisions = []) {
  return (Array.isArray(revisions) ? revisions : []).reduce(
    (policy, revision) => applyAcademicPolicyOverrides(policy, revision?.Overrides || revision || {}),
    defaultAcademicPolicy()
  );
}

export function normalizeAcademicPolicyScope(value = {}) {
  const rawType = lower(value.Type || value.type || value.ScopeType || value.scopeType || 'organisation');
  const type = rawType === 'organization' ? 'organisation' : rawType;
  if (!ACADEMIC_POLICY_SCOPE_TYPES.includes(type)) {
    const error = new Error('Academic policy scope must be organisation, branch, section, class or subject.');
    error.status = 400;
    throw error;
  }
  if (type === 'organisation') return { Type: type, Id: 'organisation' };
  const rawId = clean(value.Id || value.id || value.ScopeId || value.scopeId);
  if (!rawId) {
    const error = new Error(`Select a ${type} before editing its academic policy.`);
    error.status = 400;
    throw error;
  }
  return { Type: type, Id: safeScopeId(rawId, '') };
}

export function normalizeAcademicPolicyPeriod(value = {}) {
  const session = clean(value.Session || value.session || value.AcademicSession || value.academicSession);
  const term = clean(value.Term || value.term);
  if (!session || !term) {
    const error = new Error('Academic session and term are required for an effective-dated policy.');
    error.status = 400;
    throw error;
  }
  return { Session: session, Term: term };
}

function identifierPart(value) {
  const part = safeScopeId(value, '');
  if (!part) {
    const error = new Error('Academic policy identifiers cannot be blank.');
    error.status = 400;
    throw error;
  }
  return part;
}

export function academicPolicyAssignmentId(scopeValue = {}, periodValue = {}) {
  const scope = normalizeAcademicPolicyScope(scopeValue);
  const period = normalizeAcademicPolicyPeriod(periodValue);
  return [
    'policy',
    scope.Type,
    identifierPart(scope.Id),
    identifierPart(period.Session),
    identifierPart(period.Term)
  ].join('__');
}

export function academicPolicyScopeChain(value = {}) {
  const scopes = [{ Type: 'organisation', Id: 'organisation' }];
  const definitions = [
    ['branch', value.BranchId || value.branchId],
    ['section', value.SectionId || value.sectionId],
    ['class', value.ClassId || value.classId],
    ['subject', value.SubjectId || value.subjectId]
  ];
  definitions.forEach(([type, id]) => {
    if (clean(id)) scopes.push(normalizeAcademicPolicyScope({ Type: type, Id: id }));
  });
  return scopes;
}

function duplicateIds(rows = []) {
  const seen = new Set();
  const duplicates = new Set();
  rows.forEach((row) => {
    const id = lower(row.Id);
    if (seen.has(id)) duplicates.add(row.Id);
    seen.add(id);
  });
  return [...duplicates];
}

export function academicPolicyIssues(value = {}, options = {}) {
  const policy = normalizeAcademicPolicy(value);
  const activation = Boolean(options.forActivation || options.activation);
  const issues = [];
  const add = (code, message, path) => issues.push({ code, message, path });

  if (policy.ResultAccess.VisibilityMode === 'unconfigured' && activation) {
    add('RESULT_VISIBILITY_REQUIRED', 'Choose which published results parents may access.', 'ResultAccess.VisibilityMode');
  }
  const clearance = policy.ResultAccess.FinancialClearance;
  if (clearance.Mode === 'unconfigured' && activation) {
    add('FEE_CLEARANCE_REQUIRED', 'Choose a financial-clearance policy for parent result access.', 'ResultAccess.FinancialClearance.Mode');
  }
  if (clearance.Mode === 'minimum-paid-percentage' && clearance.MinimumPaidPercentage <= 0) {
    add('FEE_PERCENTAGE_INVALID', 'The minimum paid percentage must be greater than zero.', 'ResultAccess.FinancialClearance.MinimumPaidPercentage');
  }
  if (clearance.Mode === 'selected-fee-categories' && !clearance.FeeCategoryIds.length) {
    add('FEE_CATEGORIES_REQUIRED', 'Select at least one fee category for the selected clearance mode.', 'ResultAccess.FinancialClearance.FeeCategoryIds');
  }
  if (policy.Position.Mode === 'unconfigured' && activation) {
    add('POSITION_POLICY_REQUIRED', 'Choose how class and subject positions should be handled.', 'Position.Mode');
  }

  const components = policy.Assessment.Components;
  duplicateIds(components).forEach((id) => add(
    'ASSESSMENT_COMPONENT_DUPLICATE',
    `Assessment component id ${id} is duplicated.`,
    'Assessment.Components'
  ));
  components.forEach((component, index) => {
    if (!component.Name) add('ASSESSMENT_COMPONENT_NAME_REQUIRED', `Assessment component ${index + 1} needs a name.`, `Assessment.Components.${index}.Name`);
    if (component.MaximumScore <= 0) add('ASSESSMENT_COMPONENT_MAXIMUM_INVALID', `${component.Name || `Component ${index + 1}`} needs a maximum score greater than zero.`, `Assessment.Components.${index}.MaximumScore`);
    if (component.WeightPercentage <= 0) add('ASSESSMENT_COMPONENT_WEIGHT_INVALID', `${component.Name || `Component ${index + 1}`} needs a weight greater than zero.`, `Assessment.Components.${index}.WeightPercentage`);
  });
  const totalWeight = components.reduce((sum, component) => sum + component.WeightPercentage, 0);
  if ((activation || components.length) && Math.abs(totalWeight - 100) > 0.001) {
    add('ASSESSMENT_WEIGHT_TOTAL_INVALID', `Assessment component weights total ${totalWeight}; they must total 100.`, 'Assessment.Components');
  }
  if (activation && !components.length) {
    add('ASSESSMENT_COMPONENTS_REQUIRED', 'Add at least one assessment component.', 'Assessment.Components');
  }

  const bands = [...policy.Assessment.GradeBands].sort((a, b) => a.MinimumPercentage - b.MinimumPercentage);
  duplicateIds(bands).forEach((id) => add('GRADE_BAND_DUPLICATE', `Grade band id ${id} is duplicated.`, 'Assessment.GradeBands'));
  bands.forEach((band, index) => {
    if (!band.Grade) add('GRADE_BAND_NAME_REQUIRED', `Grade band ${index + 1} needs a grade.`, `Assessment.GradeBands.${index}.Grade`);
    if (band.MinimumPercentage > band.MaximumPercentage) add('GRADE_BAND_RANGE_INVALID', `${band.Grade || `Grade band ${index + 1}`} has a minimum above its maximum.`, `Assessment.GradeBands.${index}`);
    const previous = bands[index - 1];
    if (previous && band.MinimumPercentage <= previous.MaximumPercentage) {
      add('GRADE_BAND_OVERLAP', `${previous.Grade || 'A grade band'} overlaps ${band.Grade || 'another grade band'}.`, 'Assessment.GradeBands');
    }
    if (previous && band.MinimumPercentage - previous.MaximumPercentage > 0.011) {
      add('GRADE_BAND_GAP', `${previous.Grade || 'A grade band'} and ${band.Grade || 'another grade band'} leave an uncovered percentage range.`, 'Assessment.GradeBands');
    }
  });
  if (activation && !bands.length) add('GRADE_BANDS_REQUIRED', 'Add grade bands covering 0 through 100 percent.', 'Assessment.GradeBands');
  if (activation && bands.length && (bands[0].MinimumPercentage !== 0 || bands.at(-1).MaximumPercentage !== 100)) {
    add('GRADE_BAND_COVERAGE_INVALID', 'Grade bands must cover the complete 0 through 100 percent range.', 'Assessment.GradeBands');
  }

  const promotion = policy.Promotion;
  if (activation && promotion.Mode === 'unconfigured') {
    add('PROMOTION_POLICY_REQUIRED', 'Choose manual review or configured promotion criteria.', 'Promotion.Mode');
  }
  if (promotion.Mode === 'criteria') {
    const hasCriterion = promotion.MinimumOverallAverage !== null
      || promotion.RequiredCoreSubjectIds.length
      || promotion.MaximumFailedSubjects !== null
      || promotion.MinimumAttendancePercentage !== null;
    if (!hasCriterion) add('PROMOTION_CRITERIA_REQUIRED', 'Configure at least one promotion criterion.', 'Promotion');
  }
  if (
    promotion.ManualReviewMinimum !== null
    && promotion.ManualReviewMaximum !== null
    && promotion.ManualReviewMinimum > promotion.ManualReviewMaximum
  ) {
    add('PROMOTION_REVIEW_RANGE_INVALID', 'The manual-review minimum cannot exceed its maximum.', 'Promotion');
  }
  return issues;
}

export function academicCumulativePolicyIssues(value = {}) {
  const policy = normalizeAcademicPolicy(value);
  const terms = policy.Cumulative.Terms || [];
  const issues = [];
  const add = (code, message, path) => issues.push({ code, message, path });
  if (!terms.length) {
    add('CUMULATIVE_TERMS_REQUIRED', 'Add the session terms and their cumulative weights.', 'Cumulative.Terms');
    return issues;
  }
  duplicateIds(terms).forEach((id) => add(
    'CUMULATIVE_TERM_DUPLICATE',
    `Cumulative term id ${id} is duplicated.`,
    'Cumulative.Terms'
  ));
  terms.forEach((term, index) => {
    if (!term.TermName && !term.TermId) {
      add('CUMULATIVE_TERM_NAME_REQUIRED', `Cumulative term ${index + 1} needs a term name or term id.`, `Cumulative.Terms.${index}`);
    }
    if (term.WeightPercentage <= 0) {
      add('CUMULATIVE_TERM_WEIGHT_INVALID', `${term.TermName || `Term ${index + 1}`} needs a weight greater than zero.`, `Cumulative.Terms.${index}.WeightPercentage`);
    }
  });
  const totalWeight = terms.reduce((sum, term) => sum + term.WeightPercentage, 0);
  if (Math.abs(totalWeight - 100) > 0.001) {
    add('CUMULATIVE_WEIGHT_TOTAL_INVALID', `Cumulative term weights total ${totalWeight}; they must total 100.`, 'Cumulative.Terms');
  }
  return issues;
}

export function assertAcademicPolicyActivatable(value = {}) {
  const issues = academicPolicyIssues(value, { forActivation: true });
  if (issues.length) {
    const error = new Error(`Academic policy cannot be activated: ${issues.map((issue) => issue.message).join(' ')}`);
    error.status = 400;
    error.code = 'ACADEMIC_POLICY_INCOMPLETE';
    error.issues = issues;
    throw error;
  }
  return normalizeAcademicPolicy(value);
}

export function hasAcademicPolicyOverride(overrides = {}) {
  return Boolean(overrides && typeof overrides === 'object' && Object.keys(overrides).length);
}

export function academicPolicyFieldWasSupplied(value = {}, path = []) {
  let current = value;
  for (const key of path) {
    if (!hasOwn(current, key)) return false;
    current = current[key];
  }
  return true;
}
