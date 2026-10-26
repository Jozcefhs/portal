// Shared, deterministic examination rules. No browser-supplied marks are trusted.
export const clean = value => String(value ?? '').trim();
export const lower = value => clean(value).toLowerCase();
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const fields = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
export const conflict = error => Number(error?.status) === 409 || /CONFLICT|ABORTED|PRECONDITION/.test(error?.code || '');
export const condition = row => {
  if (row && !row.__updateTime) throw fail('The saved record has no revision. Reload before making changes.', 409);
  return row ? { updateTime: row.__updateTime } : { exists: false };
};

export function normalizeQuestions(value) {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw fail('Add between 1 and 200 questions.');
  const ids = new Set();
  const rows = value.map((row, index) => {
    const id = clean(row.QuestionId) || `Q${index + 1}`;
    const type = clean(row.QuestionType || 'single');
    const prompt = clean(row.Prompt?.Text ?? row.Prompt);
    const maximum = Number(row.MaximumScore);
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || ids.has(lower(id))) throw fail('Question identifiers must be unique.');
    ids.add(lower(id));
    if (!['single', 'extended'].includes(type)) throw fail('Choose multiple choice or written answer.');
    if (!prompt || prompt.length > 8000) throw fail(`Question ${index + 1} needs a prompt of at most 8,000 characters.`);
    if (!['number', 'string'].includes(typeof row.MaximumScore) || !Number.isFinite(maximum) || maximum <= 0 || maximum > 100) throw fail('Each question needs a mark greater than zero and at most 100.');
    const options = type === 'single' ? (row.Options || []).map((option, i) => ({ Id: String.fromCharCode(65 + i), Text: clean(option.Text ?? option) })) : [];
    if (type === 'single' && (options.length < 2 || options.length > 6 || options.some(option => !option.Text || option.Text.length > 4000))) throw fail('Multiple-choice questions need two to six options.');
    const key = type === 'single' ? clean(row.AnswerKey).toUpperCase() : '';
    if (type === 'single' && !options.some(option => option.Id === key)) throw fail(`Choose the correct answer for question ${index + 1}.`);
    return { QuestionId: id, Ordinal: index + 1, QuestionType: type, Prompt: { Text: prompt }, Options: options, AnswerKey: key, MaximumScore: maximum };
  });
  if (new TextEncoder().encode(JSON.stringify(rows)).length > 350000) throw fail('The question text is too large. Shorten the paper before saving.', 413);
  return rows;
}

export function normalizeSchedule(input) {
  const start = Date.parse(input.StartsAt), end = Date.parse(input.EndsAt), minutes = Number(input.DurationMinutes);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw fail('Choose a valid opening and closing time.');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) throw fail('Duration must be 1 to 480 minutes.');
  if (end - start < minutes * 60000) throw fail('The examination window must allow the full duration.');
  return { StartsAt: new Date(start).toISOString(), EndsAt: new Date(end).toISOString(), DurationMinutes: minutes };
}

export function normalizeAnswers(test, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('The answer packet is invalid.');
  if (new TextEncoder().encode(JSON.stringify(input)).length > 128000) throw fail('Answers exceed the 128 KB limit.', 413);
  const ids = new Set(test.Questions.map(q => q.QuestionId));
  if (Object.keys(input).some(id => !ids.has(id))) throw fail('An answer refers to a different question paper.');
  return Object.fromEntries(test.Questions.filter(q => Object.hasOwn(input, q.QuestionId)).map(q => {
    const answer = input[q.QuestionId];
    if (typeof answer !== 'string' || answer.length > 12000) throw fail('Each answer must be text of at most 12,000 characters.');
    if (q.QuestionType === 'single' && answer && !q.Options.some(option => option.Id === answer)) throw fail('Choose an available answer option.');
    return [q.QuestionId, answer];
  }));
}

export function markAnswers(test, answers, manual = {}) {
  let raw = 0, pending = false;
  const marks = {};
  for (const q of test.Questions) {
    let mark;
    if (q.QuestionType === 'single') mark = answers[q.QuestionId] === q.AnswerKey ? q.MaximumScore : 0;
    else if (!clean(answers[q.QuestionId])) mark = 0;
    else if (Object.hasOwn(manual, q.QuestionId) && manual[q.QuestionId] !== '') {
      mark = Number(manual[q.QuestionId]);
      if (!['number', 'string'].includes(typeof manual[q.QuestionId]) || !Number.isFinite(mark) || mark < 0 || mark > q.MaximumScore) throw fail(`${q.QuestionId}: enter a mark between 0 and ${q.MaximumScore}.`);
    } else { mark = null; pending = true; }
    marks[q.QuestionId] = mark;
    raw += mark || 0;
  }
  return { RawScore: Number(raw.toFixed(4)), QuestionMarks: marks, NeedsMarking: pending };
}

export function publicTest(test) {
  return Object.fromEntries(['TestId', 'Title', 'Audience', 'AccessMode', 'SubjectName', 'ClassName', 'AcademicSession', 'Term', 'StartsAt', 'EndsAt', 'DurationMinutes', 'MaximumScore', 'Instructions', 'Status', 'SchoolName'].map(key => [key, test[key] ?? '']));
}

export function publicAttempt(test, candidate, now) {
  const active = candidate.Status === 'In progress';
  return { ...publicTest(test), CandidateId: candidate.CandidateId, Reference: candidate.Reference, DisplayName: candidate.DisplayName,
    Status: candidate.Status, AttemptId: candidate.AttemptId || '', ExpiresAt: candidate.ExpiresAt || '', ServerTime: new Date(now).toISOString(),
    SaveVersion: candidate.SaveVersion || 0, SubmittedAt: candidate.SubmittedAt || '', TimedOut: candidate.TimedOut === true,
    Answers: active ? candidate.Answers || {} : {},
    Questions: active ? test.Questions.map(({ AnswerKey, ...question }) => question) : [],
    HasPaper: active && Boolean(test.Paper), PaperPageCount: active ? (test.Paper?.Pages?.length || 0) : 0, HasTheoryPaper: active && Boolean(test.TheoryPaper) };
}

export function startAttempt(test, candidate, now) {
  if (candidate.Status !== 'Ready') return candidate;
  if (test.Status !== 'Scheduled') throw fail('This test is not open. Contact the school.', 409);
  if (now < Date.parse(test.StartsAt)) throw fail('This test has not started yet.', 409);
  if (now >= Date.parse(test.EndsAt)) throw fail('The test window has closed.', 409);
  return { ...candidate, Status: 'In progress', AttemptId: candidate.CandidateId,
    StartedAt: new Date(now).toISOString(), ExpiresAt: new Date(Math.min(Date.parse(test.EndsAt), now + test.DurationMinutes * 60000)).toISOString(),
    Answers: {}, SaveVersion: 0 };
}

export function completeAttempt(test, candidate, now) {
  if (candidate.Status !== 'In progress') return candidate;
  const expired = now >= Date.parse(candidate.ExpiresAt);
  return { ...candidate, ...markAnswers(test, candidate.Answers || {}), Status: 'Submitted', TimedOut: expired,
    SubmittedAt: expired ? candidate.ExpiresAt : new Date(now).toISOString() };
}
