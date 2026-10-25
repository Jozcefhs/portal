// These are compatibility defaults, not a fixed examination curriculum.
const LEGACY = Object.freeze([
  { id: 'english', name: 'English', maxScore: 100, fields: ['EnglishScore', 'englishScore', 'English', 'english'] },
  { id: 'mathematics', name: 'Mathematics', maxScore: 100, fields: ['MathematicsScore', 'mathematicsScore', 'MathScore', 'MathsScore', 'Mathematics', 'mathematics'] },
  { id: 'interview-general', name: 'Interview/General knowledge', maxScore: 100, fields: ['InterviewScore', 'interviewScore', 'GeneralPaperScore', 'generalPaperScore'] }
]);
const clean = (value) => String(value ?? '').trim();
const present = (value) => value !== undefined && value !== null && clean(value) !== '';
const invalid = (message) => Object.assign(new Error(message), { status: 400 });
const definition = ({ id, name, maxScore }) => ({ id, name, maxScore });
const legacyValue = (record, subject) => subject.fields.map((field) => record[field]).find(present) ?? '';

export function defaultEntranceSubjects() {
  return LEGACY.map(definition);
}

export function retainedOrganisationEntranceSubjects(existing, submitted) {
  const retained = normalizeEntranceSubjects(existing);
  if (submitted != null && JSON.stringify(normalizeEntranceSubjects(submitted)) !== JSON.stringify(retained)) {
    throw invalid('Select a branch in Settings to change its entrance examination subjects.');
  }
  return retained;
}

export function normalizeEntranceSubjects(value) {
  if (value === undefined || value === null) return defaultEntranceSubjects();
  let rows = value;
  if (typeof value === 'string') {
    if (value.length > 10000) throw invalid('Entrance subject settings are too long.');
    rows = value.split(/\r?\n/).map(clean).filter(Boolean).map((line) => {
      const parts = line.split('|');
      if (parts.length > 2) throw invalid('Use Subject name | maximum mark, one subject per line.');
      return { name: clean(parts[0]), maxScore: parts.length === 2 ? clean(parts[1]) : 100 };
    });
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 30) {
    throw invalid('Configure between 1 and 30 entrance subjects.');
  }
  const names = new Set();
  const ids = new Set();
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid('Each entrance subject needs a name and maximum mark.');
    const name = clean(row.name);
    const maxScore = Number(row.maxScore ?? 100);
    const legacy = LEGACY.find((item) => item.name.toLowerCase() === name.toLowerCase());
    const id = clean(row.id) || legacy?.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (typeof row.name !== 'string' || !name || name.length > 100 || /[|\r\n\x00-\x1f]/.test(name)) throw invalid('Subject names must be 1–100 characters without line breaks or |.');
    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw invalid('Use a unique entrance subject ID containing letters, numbers or hyphens.');
    if ((row.maxScore != null && !['number', 'string'].includes(typeof row.maxScore)) || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 10000) throw invalid('Each maximum mark must be greater than zero and at most 10000.');
    if (names.has(name.toLowerCase()) || ids.has(id)) throw invalid('Entrance subjects must have unique names and IDs.');
    names.add(name.toLowerCase()); ids.add(id);
    return { id, name, maxScore };
  });
}

export function entranceSubjectRows(record = {}, profile = {}) {
  if (Array.isArray(record.EntranceSubjectScores) && record.EntranceSubjectScores.length) {
    const definitions = normalizeEntranceSubjects(record.EntranceSubjectScores);
    return definitions.map((subject, index) => ({ ...subject, score: record.EntranceSubjectScores[index].score ?? '' }));
  }
  // Never relabel historical marks when the school's current curriculum changes.
  const hasLegacyMarks = LEGACY.some((subject) => present(legacyValue(record, subject)));
  const subjects = hasLegacyMarks ? defaultEntranceSubjects() : normalizeEntranceSubjects(profile.EntranceExamSubjects);
  return subjects.map((subject) => {
    const legacy = LEGACY.find((item) => item.id === subject.id && item.name === subject.name && item.maxScore === subject.maxScore);
    return { ...subject, score: legacy ? legacyValue(record, legacy) : '' };
  });
}

export function entranceScoreSummary(rows) {
  let total = 0; let percentage = 0; let count = 0;
  for (const row of rows) {
    if (!present(row.score)) continue;
    const score = Number(row.score);
    if (typeof row.score === 'boolean' || !Number.isFinite(score) || score < 0 || score > row.maxScore) {
      throw invalid(`${row.name}: enter a mark between 0 and ${row.maxScore}.`);
    }
    total += score; percentage += score / row.maxScore * 100; count += 1;
  }
  return { TotalScore: count ? String(Number(total.toFixed(2))) : '', ResultPercentage: count ? (percentage / count).toFixed(1) : '' };
}

export function entranceScoreUpdates(existing = {}, body = {}, profile = {}) {
  const expected = entranceSubjectRows(existing, profile);
  if (!Object.hasOwn(body, 'EntranceSubjectScores')) {
    if (existing.EntranceSubjectScores?.length || JSON.stringify(expected.map(definition)) !== JSON.stringify(defaultEntranceSubjects())) {
      throw invalid('This result uses configured entrance subjects. Refresh and use the updated entrance-result editor.');
    }
    // Older installed clients remain compatible and omitted marks are preserved.
    return Object.fromEntries(LEGACY.map((subject) => [subject.fields[0], body[subject.fields[0]] ?? legacyValue(existing, subject)]));
  }
  const submitted = body.EntranceSubjectScores;
  const definitions = normalizeEntranceSubjects(submitted);
  if (JSON.stringify(definitions) !== JSON.stringify(expected.map(definition))) {
    throw invalid('Entrance subjects changed. Refresh the applicant before saving; existing marks have not been changed.');
  }
  if (submitted.some((row) => !Object.hasOwn(row, 'score') || (row.score != null && !['number', 'string'].includes(typeof row.score)))) {
    throw invalid('Each subject must include a numeric mark or an explicit blank score.');
  }
  const rows = expected.map((subject, index) => ({ ...subject, score: clean(submitted[index].score) }));
  const updates = { EntranceSubjectScores: rows, ...entranceScoreSummary(rows) };
  for (const subject of LEGACY) {
    const row = rows.find((item) => item.id === subject.id && item.name === subject.name && item.maxScore === subject.maxScore);
    if (row) updates[subject.fields[0]] = row.score;
  }
  return updates;
}

export function assertEntranceScoresUnchanged(existing = {}, body = {}) {
  // Generic applicant/profile editors must not bypass subject validation.
  for (const field of ['EntranceSubjectScores', 'EntranceSubjectDefinitions']) {
    if (Object.hasOwn(body, field) && JSON.stringify(body[field]) !== JSON.stringify(existing[field])) {
      throw invalid('Use the entrance-result editor to change subject marks.');
    }
  }
  if (existing.EntranceSubjectScores?.length) {
    for (const field of [...LEGACY.flatMap((subject) => subject.fields), 'TotalScore', 'ResultPercentage']) {
      if (Object.hasOwn(body, field) && clean(body[field]) !== clean(existing[field])) {
        throw invalid('Use the entrance-result editor to change subject marks.');
      }
    }
  }
}
