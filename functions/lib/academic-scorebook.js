const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

export const ACADEMIC_SCORE_STATES = Object.freeze(['Numeric', 'Missing', 'Absent', 'Exempt', 'Incomplete']);
export const ACADEMIC_SCORE_SHEET_STATUSES = Object.freeze(['Draft', 'Submitted', 'Approved', 'Locked']);
export const ACADEMIC_SCORE_IMPORT_MODES = Object.freeze(['all-or-nothing', 'valid-rows-only']);
export const ACADEMIC_SCORE_IMPORT_BASE_COLUMNS = Object.freeze(['StudentRef', 'StudentName']);

function oneOf(value, choices, fallback = '') {
  const wanted = lower(value);
  return choices.find((choice) => lower(choice) === wanted) || fallback;
}

function finiteNumber(value) {
  if (value === '' || value === undefined || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function componentId(row = {}) {
  return clean(row.Id || row.ComponentId || row.Code || row.Name);
}

function normalizedComponents(policy = {}) {
  const assessment = policy.Assessment || policy.assessment || {};
  return (Array.isArray(assessment.Components) ? assessment.Components : [])
    .map((row, index) => ({
      Id: componentId(row),
      Name: clean(row.Name || row.Label || componentId(row)),
      MaximumScore: finiteNumber(row.MaximumScore) ?? 0,
      WeightPercentage: finiteNumber(row.WeightPercentage) ?? 0,
      SourceMode: clean(row.SourceMode || 'any'),
      Required: row.Required !== false,
      Order: Number(row.Order || index + 1)
    }))
    .filter((row) => row.Id)
    .sort((a, b) => a.Order - b.Order || a.Name.localeCompare(b.Name));
}

function normalizedGradeBands(policy = {}) {
  const assessment = policy.Assessment || policy.assessment || {};
  return (Array.isArray(assessment.GradeBands) ? assessment.GradeBands : [])
    .map((row, index) => ({
      Id: clean(row.Id || row.Grade || `grade-${index + 1}`),
      Grade: clean(row.Grade || row.Name).toUpperCase(),
      MinimumPercentage: finiteNumber(row.MinimumPercentage) ?? 0,
      MaximumPercentage: finiteNumber(row.MaximumPercentage) ?? 100,
      GradePoint: finiteNumber(row.GradePoint) ?? 0,
      Remark: clean(row.Remark),
      Classification: oneOf(row.Classification, ['pass', 'fail'], 'pass'),
      Order: Number(row.Order || index + 1)
    }))
    .filter((row) => row.Grade)
    .sort((a, b) => b.MinimumPercentage - a.MinimumPercentage || a.Order - b.Order);
}

export function academicAssessmentScheme(policy = {}, options = {}) {
  const Components = normalizedComponents(policy);
  const GradeBands = normalizedGradeBands(policy);
  const Issues = [];
  const componentIds = new Set();
  Components.forEach((component) => {
    if (componentIds.has(lower(component.Id))) Issues.push(`Assessment component ${component.Id} is duplicated.`);
    componentIds.add(lower(component.Id));
    if (component.MaximumScore <= 0) Issues.push(`${component.Name} needs a maximum score greater than zero.`);
    if (component.WeightPercentage <= 0) Issues.push(`${component.Name} needs a weight greater than zero.`);
  });
  const weight = rounded(Components.reduce((sum, row) => sum + row.WeightPercentage, 0), 4);
  if (!Components.length) Issues.push('No active assessment components are configured.');
  else if (Math.abs(weight - 100) > 0.001) Issues.push(`Assessment component weights total ${weight}; they must total 100.`);
  const ascending = [...GradeBands].sort((a, b) => a.MinimumPercentage - b.MinimumPercentage);
  if (!ascending.length) Issues.push('No active grading bands are configured.');
  ascending.forEach((band, index) => {
    if (band.MinimumPercentage > band.MaximumPercentage) Issues.push(`${band.Grade} has an invalid percentage range.`);
    const previous = ascending[index - 1];
    if (previous && band.MinimumPercentage <= previous.MaximumPercentage) Issues.push(`${previous.Grade} overlaps ${band.Grade}.`);
    if (previous && band.MinimumPercentage - previous.MaximumPercentage > 0.011) Issues.push(`${previous.Grade} and ${band.Grade} leave a grading gap.`);
  });
  if (ascending.length && (ascending[0].MinimumPercentage !== 0 || ascending.at(-1).MaximumPercentage !== 100)) {
    Issues.push('Grading bands must cover 0 through 100 percent.');
  }
  return {
    Ready: Issues.length === 0,
    RevisionId: clean(options.RevisionId || options.revisionId),
    Components,
    GradeBands,
    TotalWeightPercentage: weight,
    Issues
  };
}

function suppliedComponentMap(value) {
  const map = new Map();
  if (Array.isArray(value)) {
    value.forEach((row = {}) => {
      const id = componentId(row);
      if (id) map.set(lower(id), row);
    });
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([id, score]) => {
      map.set(lower(id), score && typeof score === 'object' ? { ...score, ComponentId: id } : { ComponentId: id, RawScore: score });
    });
  }
  return map;
}

function inferredScoreState(row = {}) {
  const explicit = oneOf(row.State || row.Status, ACADEMIC_SCORE_STATES, '');
  if (explicit) return explicit;
  const value = clean(row.RawScore ?? row.Score ?? row.Value);
  if (!value) return 'Missing';
  const token = lower(value).replace(/[\s_-]+/g, '');
  const tokens = {
    absent: 'Absent', abs: 'Absent', a: 'Absent', exempt: 'Exempt', ex: 'Exempt',
    missing: 'Missing', miss: 'Missing', m: 'Missing', incomplete: 'Incomplete', inc: 'Incomplete', i: 'Incomplete'
  };
  return tokens[token] || 'Numeric';
}

export function normalizeAcademicComponentScores(value, schemeValue = {}, options = {}) {
  const scheme = schemeValue.Components ? schemeValue : academicAssessmentScheme(schemeValue);
  if (!scheme.Ready && options.requireReady !== false) throw new Error(scheme.Issues[0] || 'Configure an active assessment scheme first.');
  const supplied = suppliedComponentMap(value);
  const existing = suppliedComponentMap(options.existing || []);
  const known = new Set(scheme.Components.map((row) => lower(row.Id)));
  const unknown = [...supplied.keys()].filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown assessment component: ${unknown.join(', ')}.`);
  return scheme.Components.map((component) => {
    const row = supplied.get(lower(component.Id)) || (options.partial ? existing.get(lower(component.Id)) : null) || {};
    const State = inferredScoreState(row);
    let RawScore = null;
    if (State === 'Numeric') {
      RawScore = finiteNumber(row.RawScore ?? row.Score ?? row.Value);
      if (RawScore === null) throw new Error(`Enter a numeric score for ${component.Name}.`);
      if (RawScore < 0 || RawScore > component.MaximumScore) {
        throw new Error(`${component.Name} must be between 0 and ${component.MaximumScore}.`);
      }
      RawScore = rounded(RawScore, 4);
    }
    return {
      ComponentId: component.Id,
      State,
      RawScore,
      MaximumScore: component.MaximumScore,
      WeightPercentage: component.WeightPercentage,
      Note: clean(row.Note).slice(0, 300)
    };
  });
}

export function gradeAcademicPercentage(percentage, schemeValue = {}) {
  const scheme = schemeValue.GradeBands ? schemeValue : academicAssessmentScheme(schemeValue);
  const value = finiteNumber(percentage);
  if (value === null) return null;
  return scheme.GradeBands.find((band) => value >= band.MinimumPercentage && value <= band.MaximumPercentage + 0.0001) || null;
}

export function calculateAcademicStudentScore(schemeValue = {}, componentScores = []) {
  const scheme = schemeValue.Components ? schemeValue : academicAssessmentScheme(schemeValue);
  if (!scheme.Ready) throw new Error(scheme.Issues[0] || 'Configure an active assessment scheme first.');
  const Scores = normalizeAcademicComponentScores(componentScores, scheme);
  let includedWeight = 0;
  let weightedEarned = 0;
  const unresolved = [];
  Scores.forEach((score) => {
    const component = scheme.Components.find((row) => row.Id === score.ComponentId);
    if (score.State === 'Exempt') return;
    includedWeight += component.WeightPercentage;
    if (score.State === 'Numeric') weightedEarned += (score.RawScore / component.MaximumScore) * component.WeightPercentage;
    if (['Missing', 'Incomplete'].includes(score.State) && component.Required) unresolved.push(component.Id);
  });
  const Percentage = includedWeight > 0 ? rounded(weightedEarned * 100 / includedWeight, 2) : null;
  const complete = unresolved.length === 0 && includedWeight > 0;
  const band = complete ? gradeAcademicPercentage(Percentage, scheme) : null;
  return {
    ComponentScores: Scores,
    WeightedTotal: rounded(weightedEarned, 2),
    IncludedWeightPercentage: rounded(includedWeight, 2),
    Percentage,
    Grade: band?.Grade || '',
    GradePoint: band?.GradePoint ?? null,
    Remark: band?.Remark || '',
    Classification: band?.Classification || '',
    CompletionStatus: complete ? 'Complete' : 'Incomplete',
    UnresolvedComponentIds: unresolved
  };
}

export function academicScoreSourceIssues(schemeValue = {}, componentScores = [], sourceMode = 'manual') {
  const scheme = schemeValue.Components ? schemeValue : academicAssessmentScheme(schemeValue);
  const supplied = suppliedComponentMap(componentScores);
  const source = lower(sourceMode);
  return scheme.Components.flatMap((component) => {
    const row = supplied.get(lower(component.Id));
    if (!row || ['missing', 'incomplete'].includes(lower(inferredScoreState(row)))) return [];
    const allowed = lower(component.SourceMode || 'any');
    return ['any', source].includes(allowed) ? [] : [`${component.Name} accepts scores only from ${component.SourceMode}.`];
  });
}

function importComponentEntry(row = {}, component = {}) {
  if (row.ComponentScores) {
    const map = suppliedComponentMap(row.ComponentScores);
    const key = map.has(lower(component.Id)) ? lower(component.Id) : lower(component.Name);
    return { found: map.has(key), value: map.get(key) };
  }
  const matchingKey = Object.keys(row).find((key) => lower(key) === lower(component.Id) || lower(key) === lower(component.Name));
  return { found: Boolean(matchingKey), value: matchingKey ? row[matchingKey] : '' };
}

export function normalizeAcademicScoreImportRows(value, schemeValue = {}) {
  const scheme = schemeValue.Components ? schemeValue : academicAssessmentScheme(schemeValue);
  let supplied = value;
  if (typeof supplied === 'string') {
    try { supplied = JSON.parse(supplied); } catch (_error) { supplied = []; }
  }
  if (!Array.isArray(supplied)) return [];
  return supplied.map((row = {}, index) => ({
    RowNumber: Number(row.RowNumber || index + 2),
    StudentRef: clean(row.StudentRef || row.AdmissionNo || row.AccountRef),
    StudentName: clean(row.StudentName || row.DisplayName),
    ComponentScores: scheme.Components.flatMap((component) => {
      const entry = importComponentEntry(row, component);
      if (!entry.found) return [];
      const suppliedScore = entry.value;
      return suppliedScore && typeof suppliedScore === 'object'
        ? [{ ...suppliedScore, ComponentId: component.Id }]
        : [{ ComponentId: component.Id, RawScore: suppliedScore }];
    })
  }));
}

export function validateAcademicScoreImport(value, options = {}) {
  const scheme = options.scheme?.Components ? options.scheme : academicAssessmentScheme(options.policy || {}, options);
  const rows = normalizeAcademicScoreImportRows(value, scheme);
  const roster = new Map((options.roster || []).map((row) => [lower(row.StudentRef || row.AdmissionNo), row]));
  const existingScores = new Map((options.existingScores || []).map((row) => [lower(row.StudentRef), row]));
  const seen = new Set();
  const Results = rows.map((row) => {
    const Issues = [];
    const key = lower(row.StudentRef);
    if (!key) Issues.push('StudentRef is required.');
    else if (seen.has(key)) Issues.push(`Student ${row.StudentRef} is duplicated in this import.`);
    else if (!roster.has(key)) Issues.push(`Student ${row.StudentRef} is not in the selected subject roster.`);
    seen.add(key);
    let Calculated = null;
    if (!row.ComponentScores.length) Issues.push('No recognized assessment component columns were supplied.');
    try {
      const merged = normalizeAcademicComponentScores(row.ComponentScores, scheme, {
        existing: existingScores.get(key)?.ComponentScores || [], partial: true
      });
      Calculated = calculateAcademicStudentScore(scheme, merged);
    } catch (error) {
      Issues.push(clean(error?.message || error));
    }
    Issues.push(...academicScoreSourceIssues(scheme, row.ComponentScores, options.sourceMode || 'spreadsheet'));
    return { ...row, Valid: Issues.length === 0, Issues, Calculated };
  });
  return {
    Rows: Results,
    TotalRows: Results.length,
    ValidRows: Results.filter((row) => row.Valid).length,
    InvalidRows: Results.filter((row) => !row.Valid).length,
    Ready: Results.length > 0 && Results.every((row) => row.Valid)
  };
}
