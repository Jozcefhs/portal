import { getDocument, batchCommitDocuments } from './firestore.js';
import { commitAcademicSubmission } from './academic-submissions.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const active = row => row && !['archived', 'inactive', 'closed', 'deleted', 'withdrawn', 'cancelled'].includes(lower(row.Status));
const fail = (message, status = 400) => Object.assign(new Error(message), { status, code: 'ACADEMIC_DIARY_INVALID' });
const publicRow = row => Object.fromEntries(Object.entries(row || {}).filter(([key]) => !key.startsWith('__')));
const username = user => lower(user.username || user.Username);
export const DIARY_COLLECTIONS = { scheme: 'academicDiarySchemes', week: 'academicWeeklyDiaries', history: 'academicDiaryHistory' };

export async function diaryId(kind, scope, input) {
  // Reuse the original classroom identity so saved work, history and payment
  // reservations resume in their own arm without migration or duplication.
  return legacyDiaryId(kind, scope, input);
}

export async function legacyClassDiaryId(kind, scope, input) {
  return hashedDiaryId(kind, ['class-v2', kind, scope.branchId, scope.section, input.SessionId, input.TermId,
    input.ClassId, kind === 'scheme' ? input.SubjectId : Number(input.Week)]);
}

export async function legacyDiaryId(kind, scope, input) {
  const parts = [kind, scope.branchId, scope.section, input.SessionId, input.TermId, input.ClassId, input.ArmId,
    kind === 'scheme' ? input.SubjectId : Number(input.Week)];
  return hashedDiaryId(kind, parts);
}

async function hashedDiaryId(kind, parts) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts)));
  return `${kind}-${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
}

function periodRows(rows, input) {
  return (rows || []).filter(row => active(row) && row.SessionId === input.SessionId && row.TermId === input.TermId);
}

export function diaryAccess(context, user, input) {
  const { state, permissions } = context;
  const validArm = row => !row.ArmId || (state.arms || []).some(arm => active(arm)
    && arm.IsClassroom !== false && arm.ClassId === row.ClassId && arm.ArmId === row.ArmId);
  const allocations = periodRows(state.teacherAllocations, input).filter(validArm);
  const reviewer = !!permissions.canReviewScores;
  const classrooms = (state.arms || []).filter(arm => active(arm) && arm.IsClassroom !== false && arm.ArmId
    && (state.classes || []).some(row => active(row) && row.ClassId === arm.ClassId)
    && (reviewer || allocations.some(row => row.ClassId === arm.ClassId && (!row.ArmId || row.ArmId === arm.ArmId)
      && lower(row.TeacherUsername) === username(user))));
  if (!input.ClassId && !input.ArmId) return { classrooms, reviewer };
  const classroom = classrooms.find(row => row.ClassId === input.ClassId && row.ArmId === input.ArmId);
  if (!classroom) throw fail('Choose a class and arm assigned to you in this school section and period.', 403);
  const applicable = rows => rows.filter(row => row.ClassId === input.ClassId && (!row.ArmId || row.ArmId === input.ArmId));
  const teachers = applicable(allocations);
  const offered = new Set(applicable(periodRows(state.offerings, input)).map(row => row.SubjectId));
  // Class-wide offerings apply to each arm; another arm's allocation does not.
  teachers.filter(row => lower(row.AllocationRole) === 'subject teacher' && row.SubjectId)
    .forEach(row => offered.add(row.SubjectId));
  const subjects = (state.subjects || []).filter(row => active(row) && offered.has(row.SubjectId))
    .sort((a, b) => clean(a.Name).localeCompare(clean(b.Name)));
  const ownSubjects = [...new Set(teachers.filter(row => lower(row.AllocationRole) === 'subject teacher'
    && lower(row.TeacherUsername) === username(user)).map(row => row.SubjectId))];
  return { classrooms, classroom, subjects, ownSubjects, reviewer,
    compiler: teachers.some(row => row.ArmId === input.ArmId && lower(row.AllocationRole) === 'form teacher'
      && lower(row.TeacherUsername) === username(user)) };
}

// The short-lived class-wide version has a distinct identity. Management can
// inspect it without copying its shared entries/approvals into individual arms.
async function legacyClassRecords(context, env, selected, io) {
  const [weekly, scheme] = await Promise.all([
    legacyClassDiaryId('week', context.scope, selected).then(id => io.getDocument(env, DIARY_COLLECTIONS.week, id)),
    selected.SubjectId ? legacyClassDiaryId('scheme', context.scope, selected).then(id => io.getDocument(env, DIARY_COLLECTIONS.scheme, id)) : null,
  ]);
  return weekly || scheme ? [{ Name: context.state.classes.find(row => row.ClassId === selected.ClassId)?.Name || selected.ClassId,
    Weekly: publicRow(weekly), Scheme: publicRow(scheme) }] : [];
}

export function normalizeSchemeWeeks(rows) {
  if (!Array.isArray(rows) || rows.length > 53) throw fail('Enter up to 53 scheme-of-work weeks.');
  const seen = new Set();
  return rows.map(row => {
    const Week = Number(row.Week), Theme = clean(row.Theme), Content = clean(row.Content);
    if (!Number.isInteger(Week) || Week < 1 || Week > 53 || seen.has(Week)) throw fail('Each scheme week must be unique, from 1 to 53.');
    if (!Theme || !Content || Theme.length > 300 || Content.length > 4000) throw fail('Each week needs a theme (up to 300 characters) and content (up to 4,000 characters).');
    seen.add(Week);
    return { Week, Theme, Content };
  }).sort((a, b) => a.Week - b.Week);
}

function assertDate(value, term) {
  const date = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw fail('Choose a valid week-ending date.');
  if ((term.StartDate && date < term.StartDate.slice(0, 10)) || (term.EndDate && date > term.EndDate.slice(0, 10))) {
    throw fail('The week-ending date must fall within the selected term.');
  }
  return date;
}

function assertRevision(existing, input) {
  if (Number(input.Version ?? 0) !== Number(existing?.Version || 0)) throw fail('This diary changed. Reload it before saving your changes.', 409);
}

// All writes use one optimistic transaction: record + immutable previous/new
// snapshots. Two teachers cannot silently overwrite one another's work.
async function commit(io, env, collection, id, previous, next, user, action, reason = '') {
  if (previous && !previous.__updateTime) throw fail('The record revision is unavailable. Reload before saving.', 409);
  const record = { ...publicRow(next), RecordId: id, Version: Number(previous?.Version || 0) + 1,
    UpdatedAt: new Date().toISOString(), UpdatedBy: username(user) };
  // History contains both old and new snapshots; reserve room under Firestore's document limit.
  if (new TextEncoder().encode(JSON.stringify(record)).length > 350000) throw fail('This diary is too large. Shorten the weekly descriptions.');
  await io.batchCommitDocuments(env, [
    { collectionPath: collection, documentId: id, data: record,
      ...(previous ? { updateTime: previous.__updateTime } : { exists: false }) },
    { collectionPath: DIARY_COLLECTIONS.history, documentId: `${id}-${record.Version}`, exists: false,
      data: { RecordId: id, Version: record.Version, BranchId: record.BranchId, SchoolSection: record.SchoolSection,
        SessionId: record.SessionId, TermId: record.TermId, Action: action, ActorUsername: username(user),
        Timestamp: record.UpdatedAt, Reason: reason, Previous: publicRow(previous), Current: record } },
  ]);
  return record;
}

export async function handleDiary(context, env, user, input, action, io = { getDocument, batchCommitDocuments }) {
  if (input.ClassId && !clean(input.ArmId)) {
    throw fail('Diaries are separate for each class and arm. Reopen Teaching diary and select a class / arm before loading or saving.', 409);
  }
  const access = diaryAccess(context, user, input);
  if (input.IncludeLegacyClassRecords === true && !access.reviewer) throw fail('Only Academic Management may view earlier class-wide records.', 403);
  const { scope, state, session, term } = context;
  const submissionType = ({ saveacademicdiaryscheme: 'scheme', submitacademicdiaryentry: 'diary-entry', submitacademicdiary: 'diary' })[action];
  // Custom IO remains injectable for local tests. Drafts and review decisions
  // never incur a surcharge; only the validated final submission is gated.
  if (submissionType) {
    const originalIo = io;
    io = { ...io, batchCommitDocuments: (targetEnv, writes) => commitAcademicSubmission(targetEnv, context, user, input, submissionType, writes, originalIo) };
  }
  const choices = { DiaryScope: 'Classroom', CanViewLegacyClassRecords: access.reviewer,
    Classrooms: access.classrooms.map(row => ({ ClassId: row.ClassId, ArmId: row.ArmId,
      Name: `${state.classes.find(item => item.ClassId === row.ClassId)?.Name || row.ClassId} / ${row.Name || row.ArmId}` }))
      .sort((a, b) => a.Name.localeCompare(b.Name, undefined, { numeric: true })),
    SessionName: session.Name, TermName: term.Name };
  if (!input.ClassId && action === 'getacademicdiary') return { ok: true, diary: choices };
  if (!access.classroom) throw fail('Choose a class and arm.');
  const Week = Number(input.Week || 1);
  if (!Number.isInteger(Week) || Week < 1 || Week > 53) throw fail('Choose a week from 1 to 53.');
  const fields = { BranchId: scope.branchId, SchoolSection: scope.section, SessionId: session.SessionId,
    TermId: term.TermId, ClassId: input.ClassId, ArmId: input.ArmId, DiaryScope: 'Classroom' };
  const selected = { ...fields, Week, SubjectId: clean(input.SubjectId) };
  if (selected.SubjectId && !access.subjects.some(row => row.SubjectId === selected.SubjectId)) throw fail('This subject is not offered in the selected class / arm.', 403);
  const weekId = await diaryId('week', scope, selected);
  const week = await io.getDocument(env, DIARY_COLLECTIONS.week, weekId);
  const schemeId = selected.SubjectId ? await diaryId('scheme', scope, selected) : '';
  const scheme = schemeId ? await io.getDocument(env, DIARY_COLLECTIONS.scheme, schemeId) : null;
  let SessionSchemes = [];
  if (input.IncludeSessionSchemes === true && selected.SubjectId) {
    const terms = state.terms.filter(row => row.SessionId === session.SessionId);
    if (terms.length > 20) throw fail('This session has too many terms to print together.');
    SessionSchemes = await Promise.all(terms.map(async item => ({ TermName: item.Name,
      ...publicRow(await io.getDocument(env, DIARY_COLLECTIONS.scheme,
        await diaryId('scheme', scope, { ...selected, TermId: item.TermId }))) })));
  }
  const draft = week || { ...fields, Week, WeekEnding: '', Status: 'Draft', Entries: [], Version: 0 };
  let result;
  const requireSubjectTeacher = () => {
    if (!selected.SubjectId || !access.ownSubjects.includes(selected.SubjectId)) throw fail('Only the allocated subject teacher may enter this subject’s work.', 403);
  };
  const stamp = () => ({ At: new Date().toISOString(), By: username(user) });
  if (action === 'saveacademicdiaryscheme') {
    requireSubjectTeacher();
    assertRevision(scheme, input);
    result = await commit(io, env, DIARY_COLLECTIONS.scheme, schemeId, scheme,
      { ...fields, SubjectId: selected.SubjectId, Weeks: normalizeSchemeWeeks(input.Weeks) }, user, action);
  } else if (['saveacademicdiaryentry', 'submitacademicdiaryentry'].includes(action)) {
    requireSubjectTeacher();
    assertRevision(week, input);
    if (['Submitted', 'Approved'].includes(draft.Status)) throw fail('This compiled diary is locked. Academic Management must return it for correction.', 409);
    const oldEntry = draft.Entries.find(row => row.SubjectId === selected.SubjectId);
    if (oldEntry?.Status === 'Submitted') throw fail('This subject entry has been submitted. Ask the class teacher to return it for correction.', 409);
    const WorkCompleted = clean(input.WorkCompleted), Notes = clean(input.Notes);
    if (WorkCompleted.length > 4000 || Notes.length > 2000) throw fail('Weekly work is limited to 4,000 characters and notes to 2,000.');
    const submitting = action === 'submitacademicdiaryentry';
    if (submitting && !WorkCompleted) throw fail('Record the work completed (or explain why no lesson took place) before submitting.');
    const WeekEnding = assertDate(input.WeekEnding, term);
    if (draft.WeekEnding && draft.WeekEnding !== WeekEnding) throw fail(`This week already ends on ${draft.WeekEnding}. Use the same date for all subjects.`);
    const entry = { SubjectId: selected.SubjectId, TeacherUsername: username(user), WorkCompleted, Notes,
      Status: submitting ? 'Submitted' : 'Draft', ...stamp(),
      PlannedWork: (scheme?.Weeks || []).find(row => row.Week === Week) || null,
      SchemeVersion: Number(scheme?.Version || 0) };
    result = await commit(io, env, DIARY_COLLECTIONS.week, weekId, week, { ...draft, WeekEnding,
      Entries: [...draft.Entries.filter(row => row.SubjectId !== entry.SubjectId), entry] }, user, action);
  } else if (action === 'returnacademicdiaryentry') {
    if (!access.compiler) throw fail('Only the assigned class teacher may return a subject entry.', 403);
    assertRevision(week, input);
    if (!week || ['Submitted', 'Approved'].includes(week.Status)) throw fail('Return the compiled diary through Academic Management first.', 409);
    const reason = clean(input.Reason);
    if (!reason || reason.length > 2000) throw fail('Enter a correction reason (up to 2,000 characters).');
    if (!week.Entries.some(row => row.SubjectId === selected.SubjectId && row.Status === 'Submitted')) throw fail('Choose a submitted subject entry.');
    result = await commit(io, env, DIARY_COLLECTIONS.week, weekId, week, { ...week,
      Entries: week.Entries.map(row => row.SubjectId === selected.SubjectId ? { ...row, Status: 'Returned', ReturnReason: reason } : row) }, user, action, reason);
  } else if (action === 'submitacademicdiary') {
    if (!access.compiler) throw fail('Only the assigned class teacher may compile and submit this diary.', 403);
    assertRevision(week, input);
    if (!week || !['Draft', 'Returned'].includes(week.Status)) throw fail('Choose a draft or returned diary to compile.', 409);
    const missing = access.subjects.filter(subject => !week.Entries.some(row => row.SubjectId === subject.SubjectId && row.Status === 'Submitted'));
    if (!access.subjects.length || missing.length) throw fail(`All offered subjects must be submitted first. Missing: ${missing.map(row => row.Name).join(', ') || 'subject offerings'}.`, 409);
    result = await commit(io, env, DIARY_COLLECTIONS.week, weekId, week,
      { ...week, Status: 'Submitted', Compiled: stamp(), SubjectSnapshot: access.subjects.map(row => ({ SubjectId: row.SubjectId, Name: row.Name })) }, user, action);
  } else if (['approveacademicdiary', 'returnacademicdiary'].includes(action)) {
    if (!access.reviewer) throw fail('Only Academic Management may review and approve a diary.', 403);
    assertRevision(week, input);
    const returning = action === 'returnacademicdiary';
    if (!week || !(returning ? ['Submitted', 'Approved'] : ['Submitted']).includes(week.Status)) throw fail('This diary is not at the required review stage.', 409);
    const reason = clean(input.Reason);
    if ((returning && !reason) || reason.length > 2000) throw fail('Enter a review comment; a reason is required when returning a diary (up to 2,000 characters).');
    result = await commit(io, env, DIARY_COLLECTIONS.week, weekId, week, { ...week,
      Status: returning ? 'Returned' : 'Approved', Reviewed: { ...stamp(), Comment: reason },
      Entries: returning ? week.Entries.map(row => ({ ...row, Status: 'Returned', ReturnReason: reason })) : week.Entries }, user, action, reason);
  } else if (action !== 'getacademicdiary') throw fail('Unsupported diary action.');
  return { ok: true, message: result ? 'Diary record saved.' : '', diary: { ...choices,
    Subjects: access.subjects.map(row => ({ SubjectId: row.SubjectId, Name: row.Name })),
    OwnSubjects: access.ownSubjects, CanCompile: access.compiler, CanReview: access.reviewer, SessionSchemes,
    ...(action === 'getacademicdiary' && input.IncludeLegacyClassRecords === true
      ? { LegacyClassRecords: await legacyClassRecords(context, env, selected, io) } : {}),
    Weekly: publicRow(action === 'saveacademicdiaryscheme' ? draft : result || draft),
    Scheme: publicRow(action === 'saveacademicdiaryscheme' ? result : scheme) } };
}
