import { batchCommitDocuments, getDocument, queryCollection } from './firestore.js';
import { academicManagementCapabilities, scopedAcademicRows } from './academic-management.js';
import { enforceActorBranch } from './branch-scope.js';
import { getSchoolStructure, listSchoolCollection, safeScopeId, schoolSectionFor } from './school-scope.js';
import { normalizeNotification } from './notifications.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const unique = (rows) => [...new Set(rows.map(clean).filter(Boolean))].sort();
const active = (row) => lower(row.Status) === 'active' && row.Active !== false && !['no', 'false', '0'].includes(lower(row.Active));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const hash = async (value) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export function requireHomeworkAccess(user, writing = false) {
  if (!academicManagementCapabilities(user).canEnterScores || !clean(user.username)) fail('This account cannot send teacher homework.', 403);
  if (writing && user.subscriptionActive === false) fail('The organisation subscription is not active.', 402);
  if (writing && user.subscriptionReadOnly === true) fail('Homework cannot be sent during the read-only payment grace period.', 403);
}

export async function loadHomeworkState(env, user, input = {}, dependencies = {}) {
  requireHomeworkAccess(user);
  const structure = await (dependencies.getSchoolStructure || getSchoolStructure)(env);
  const requested = clean(input.BranchId || user.branchId);
  if (!requested || lower(requested) === 'all') fail('Choose one working branch.');
  const branchId = safeScopeId(enforceActorBranch(user, requested));
  if (!structure.Branches.some((row) => lower(row.Id) === branchId)) fail('This branch is not configured.', 403);
  const section = lower(input.SchoolSection);
  if (!['primary', 'secondary'].includes(section) || !structure.Sections.includes(section)) fail('Choose a configured school section.');
  const allowedSection = lower(user.schoolSectionAccess || 'all');
  if (allowedSection !== 'all' && allowedSection !== section) fail('This account is restricted to another school section.', 403);
  const query = dependencies.queryCollection || queryCollection;
  const scope = { branchId, section, structure };
  const collections = { sessions: 'academicSessions', terms: 'academicTerms', classes: 'academicClasses', arms: 'academicArms', subjects: 'academicSubjects', offerings: 'academicSubjectOfferings', teacherAllocations: 'academicTeacherAllocations' };
  const state = { scope };
  const load = async ([key, collection]) => {
    const filters = [{ field: 'BranchId', op: '==', value: branchId }];
    if (key === 'teacherAllocations') filters.push({ field: 'TeacherUsername', op: '==', value: lower(user.username) });
    const rows = await query(env, collection, { filters, limit: 5001 });
    if (rows.length > 5000) fail('The homework workspace needs a narrower scope; no partial audience was loaded.', 413);
    state[key] = scopedAcademicRows(rows.filter((row) => lower(row.BranchId) === branchId), scope);
  };
  // Warm the request's OAuth token before parallel collection queries.
  const entries = Object.entries(collections);
  await load(entries[0]);
  await Promise.all(entries.slice(1).map(load));
  return state;
}

export function homeworkTargets(state, user) {
  const inScope = (row) => lower(row.BranchId) === state.scope.branchId && (!row.SchoolSection || lower(row.SchoolSection) === state.scope.section);
  const groups = new Map();
  for (const allocation of state.teacherAllocations.filter((row) => active(row) && inScope(row)
    && lower(row.TeacherUsername) === lower(user.username) && lower(row.AllocationRole) === 'subject teacher')) {
    const session = state.sessions.find((row) => active(row) && inScope(row) && row.SessionId === allocation.SessionId);
    const term = state.terms.find((row) => active(row) && inScope(row) && row.SessionId === allocation.SessionId && row.TermId === allocation.TermId);
    const schoolClass = state.classes.find((row) => active(row) && inScope(row) && row.ClassId === allocation.ClassId);
    const subject = state.subjects.find((row) => active(row) && inScope(row) && row.SubjectId === allocation.SubjectId);
    if (!session || !term || !schoolClass || !subject) continue;
    const arms = state.arms.filter((arm) => active(arm) && inScope(arm) && arm.ClassId === schoolClass.ClassId
      && (!allocation.ArmId || allocation.ArmId === arm.ArmId)
      && state.offerings.some((offering) => active(offering) && inScope(offering)
        && offering.SessionId === session.SessionId && offering.TermId === term.TermId
        && offering.ClassId === schoolClass.ClassId && offering.SubjectId === subject.SubjectId
        && (!offering.ArmId || offering.ArmId === arm.ArmId)));
    if (!arms.length) continue;
    const key = JSON.stringify([session.SessionId, term.TermId, schoolClass.ClassId, subject.SubjectId]);
    if (!groups.has(key)) groups.set(key, {
      SessionId: session.SessionId, TermId: term.TermId, ClassId: schoolClass.ClassId, SubjectId: subject.SubjectId,
      SessionName: session.Name, TermName: term.Name, ClassName: schoolClass.Name, SubjectName: subject.Name, Arms: []
    });
    const group = groups.get(key);
    arms.forEach((arm) => { if (!group.Arms.some((row) => row.ArmId === arm.ArmId)) group.Arms.push({ ArmId: arm.ArmId, Name: arm.Name }); });
  }
  return [...groups.values()].sort((a, b) => `${a.ClassName} ${a.SubjectName}`.localeCompare(`${b.ClassName} ${b.SubjectName}`));
}

export function normalizeHomeworkInput(input) {
  const payload = Object.fromEntries(['SessionId', 'TermId', 'ClassId', 'SubjectId', 'Title', 'Message', 'DueDate'].map((key) => [key, clean(input[key])]));
  if (!Array.isArray(input.ArmIds) || !input.ArmIds.length || input.ArmIds.length > 100) fail('Choose at least one of your assigned arms (maximum 100).');
  payload.ArmIds = unique(input.ArmIds);
  if (['SessionId', 'TermId', 'ClassId', 'SubjectId'].some((key) => !payload[key] || payload[key].length > 200)) fail('Choose your assigned class and subject.');
  if (!payload.Title || payload.Title.length > 160 || !payload.Message || payload.Message.length > 2000) fail('Enter a title (up to 160 characters) and homework instructions (up to 2,000 characters).');
  if (payload.DueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(payload.DueDate) || !Number.isFinite(Date.parse(`${payload.DueDate}T00:00:00Z`))
    || new Date(`${payload.DueDate}T00:00:00Z`).toISOString().slice(0, 10) !== payload.DueDate)) fail('Choose a valid homework due date.');
  return payload;
}

export function homeworkAudience(state, user, payload, memberships, students) {
  const target = homeworkTargets(state, user).find((row) => ['SessionId', 'TermId', 'ClassId', 'SubjectId'].every((key) => row[key] === payload[key]));
  if (!target || payload.ArmIds.some((id) => !target.Arms.some((row) => row.ArmId === id))) fail('You are not the active subject teacher for every selected arm.', 403);
  const scope = state.scope;
  const roster = memberships.filter((row) => active(row) && lower(row.BranchId) === scope.branchId && lower(row.SchoolSection) === scope.section
    && row.SessionId === payload.SessionId && row.TermId === payload.TermId && row.ClassId === payload.ClassId
    && payload.ArmIds.includes(row.ArmId) && (row.SubjectIds || []).includes(payload.SubjectId));
  const references = new Set();
  const emails = new Set();
  let missingParentEmail = 0;
  const seen = new Set();
  const profiles = new Map();
  for (const student of students) {
    if (lower(student.BranchId || 'main') !== scope.branchId || schoolSectionFor(student) !== scope.section) continue;
    for (const ref of unique([student.AdmissionNo, student.AccountRef, student.__id]).map(lower)) {
      const previous = profiles.get(ref);
      // Prefer the section-scoped profile over its legacy duplicate. Never combine stale addresses.
      if (!previous || (!clean(previous.__scopePath).startsWith('schoolBranches/') && clean(student.__scopePath).startsWith('schoolBranches/'))) profiles.set(ref, student);
    }
  }
  for (const membership of roster) {
    const ref = lower(membership.StudentRef);
    if (!ref || seen.has(ref)) continue;
    const student = profiles.get(ref);
    if (!student || student.Active === false || ['no', 'false', '0'].includes(lower(student.Active))
      || ['withdrawn', 'graduated', 'inactive', 'deleted', 'left', 'rejected'].includes(lower(student.Status || student.EnrollmentStatus || student.StudentStatus))) continue;
    seen.add(ref);
    references.add(ref);
    // ParentEmail is the portal identity; other contact fields can be unrelated people.
    const email = lower(student.ParentEmail || student.Email || student.VerificationEmail);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) emails.add(email);
    else missingParentEmail += 1;
  }
  return { target, references: [...references].sort(), emails: [...emails].sort(), summary: {
    Students: seen.size, ParentAccounts: emails.size, MissingParentEmail: missingParentEmail,
    ClassName: target.ClassName, SubjectName: target.SubjectName,
    Arms: target.Arms.filter((arm) => payload.ArmIds.includes(arm.ArmId)).map((arm) => arm.Name)
  } };
}

export async function handleTeacherHomework(env, user, input, dependencies = {}) {
  const action = lower(input.action || 'getContext');
  if (!['getcontext', 'previewhomework', 'sendhomework'].includes(action)) fail('Unsupported homework action.');
  requireHomeworkAccess(user, action === 'sendhomework');
  const state = await loadHomeworkState(env, user, input, dependencies);
  if (action === 'getcontext') return { ok: true, targets: homeworkTargets(state, user) };
  const payload = normalizeHomeworkInput(input);
  const fingerprint = await hash(JSON.stringify([lower(env.DYNAMAX_WORKSPACE_ID), lower(user.username), state.scope.branchId, state.scope.section, payload]));
  const get = dependencies.getDocument || getDocument;
  let homeworkId = '';
  if (action === 'sendhomework') {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(clean(input.RequestId))) fail('A valid homework request ID is required.');
    homeworkId = `HW-${await hash(`${lower(env.DYNAMAX_WORKSPACE_ID)}:${lower(user.username)}:${clean(input.RequestId)}`)}`;
    const existing = await get(env, 'academicHomework', homeworkId);
    if (existing) {
      if (existing.Fingerprint !== fingerprint || lower(existing.CreatedBy) !== lower(user.username)) fail('This request ID was already used for different homework.', 409);
      return { ok: true, alreadySent: true, HomeworkId: homeworkId, summary: existing.RecipientSummary, message: 'This homework was already sent; it has not been sent again.' };
    }
  }
  // Reject manipulated classroom selections before loading any student profiles.
  homeworkAudience(state, user, payload, [], []);
  // Policy reads must fail closed on database errors, not default to enabled delivery.
  const settings = await (dependencies.loadNotificationSettings || ((environment) => getDocument(environment, 'notificationSettings', 'system')))(env) || {};
  const policy = settings.AudiencePolicies?.Parent || {};
  if (policy.Categories?.Academics === false || (policy.Channels?.InApp === false && policy.Channels?.Push === false)) fail('Parent academic notifications are disabled in School settings.', 409);
  const query = dependencies.queryCollection || queryCollection;
  const memberships = await query(env, 'academicStudentMemberships', { filters: [{ field: 'BranchId', op: '==', value: state.scope.branchId },
    { field: 'SessionId', op: '==', value: payload.SessionId }, { field: 'TermId', op: '==', value: payload.TermId }, { field: 'ClassId', op: '==', value: payload.ClassId }], limit: 5001 });
  if (memberships.length > 5000) fail('This class has too many memberships for one message. No message was sent.', 413);
  const students = await (dependencies.listSchoolCollection || listSchoolCollection)(env, 'students', { branchId: state.scope.branchId, schoolSectionAccess: state.scope.section });
  const audience = homeworkAudience(state, user, payload, memberships, students);
  if (!audience.references.length) fail('No active students taking this subject were found in the selected arms.', 409);
  const previewDigest = await hash(JSON.stringify([fingerprint, audience.references, audience.emails,
    { InApp: policy.Channels?.InApp !== false, Push: policy.Channels?.Push !== false }]));
  if (action === 'previewhomework') return { ok: true, summary: audience.summary, PreviewDigest: previewDigest,
    preview: { Title: payload.Title, Message: payload.Message, DueDate: payload.DueDate } };
  if (clean(input.PreviewDigest) !== previewDigest) fail('The homework or audience has changed. Preview it again before sending.', 409);
  const now = dependencies.now || new Date().toISOString();
  const notification = normalizeNotification({
    EventKey: `teacher-homework:${homeworkId}`, Type: 'Teacher Homework', Category: 'Academics', Audience: 'Parent',
    Channels: ['InApp', 'Push'].filter((channel) => policy.Channels?.[channel] !== false),
    TargetEmails: audience.emails, TargetAccountRefs: audience.references,
    Title: payload.Title, Message: `${audience.target.SubjectName} — ${audience.target.ClassName}\n${payload.Message}${payload.DueDate ? `\nDue: ${payload.DueDate}` : ''}\nTeacher: ${clean(user.displayName || user.username)}`,
    DueDate: payload.DueDate, ActionUrl: 'parent-dashboard.html', RecordType: 'TeacherHomework', RecordId: homeworkId,
    SchoolId: lower(env.DYNAMAX_WORKSPACE_ID), BranchId: state.scope.branchId, SchoolSection: state.scope.section,
    CreatedAt: now, CreatedBy: user.username, ActorType: 'Staff', ActorId: user.username
  }, now);
  const pushQueued = notification.Channels.includes('Push') && audience.emails.length > 0;
  const record = { ...payload, HomeworkId: homeworkId, Fingerprint: fingerprint, BranchId: state.scope.branchId,
    SchoolSection: state.scope.section, SchoolId: lower(env.DYNAMAX_WORKSPACE_ID), CreatedBy: user.username,
    CreatedAt: now, RecipientSummary: audience.summary, NotificationId: notification.NotificationId, PushQueued: pushQueued, Status: 'Sent' };
  const writes = [
    { collectionPath: 'academicHomework', documentId: homeworkId, data: record, exists: false },
    { collectionPath: 'notifications', documentId: notification.NotificationId, data: notification, exists: false }
  ];
  if (pushQueued) {
    const id = `ANN-PUSH-${notification.NotificationId}`.slice(0, 180);
    writes.push({ collectionPath: 'notificationAnnouncementPushJobs', documentId: id, exists: false, data: {
      PushJobId: id, SchoolId: lower(env.DYNAMAX_WORKSPACE_ID), NotificationId: notification.NotificationId,
      AnnouncementId: '', Status: 'Pending', AttemptCount: 0, FailureCount: 0, Offset: 0, CreatedAt: now, UpdatedAt: now
    } });
  }
  // One atomic create prevents partial audiences and duplicate sends on concurrent retries.
  try { await (dependencies.batchCommitDocuments || batchCommitDocuments)(env, writes); }
  catch (error) {
    const saved = await get(env, 'academicHomework', homeworkId);
    if (!saved || saved.Fingerprint !== fingerprint) throw error;
    return { ok: true, alreadySent: true, HomeworkId: homeworkId, summary: saved.RecipientSummary, message: 'This homework was already sent; it has not been sent again.' };
  }
  return { ok: true, HomeworkId: homeworkId, summary: audience.summary, PushQueued: pushQueued,
    message: pushQueued ? 'Homework saved for the selected parents. Push delivery is queued for parents with notifications enabled.'
      : 'Homework saved for the selected parents. No push was queued: push is disabled or no valid parent email is available.' };
}
