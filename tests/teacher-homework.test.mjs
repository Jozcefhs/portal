import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { homeworkTargets, homeworkAudience, normalizeHomeworkInput, requireHomeworkAccess, handleTeacherHomework, loadHomeworkState } from '../functions/lib/teacher-homework.js';
import { notificationTargetsRecipient } from '../functions/lib/notifications.js';
import { homeworkPushPreview } from '../functions/lib/firebase-messaging.js';

const user = { username: 'teacher1', role: 'Teacher', edition: 'school', allowedSections: ['academics'], branchId: 'main', schoolSectionAccess: 'All' };
const input = { BranchId: 'main', SchoolSection: 'secondary', SessionId: 's1', TermId: 't1', ClassId: 'c1', SubjectId: 'math', ArmIds: ['a1'], Title: 'Homework', Message: 'Complete exercise 2.', DueDate: '2026-10-09' };
function fixture(section = 'secondary') {
  const scope = { BranchId: 'main', SchoolSection: section, Status: 'Active' };
  const state = {
    scope: { branchId: 'main', section },
    sessions: [{ ...scope, SessionId: 's1', Name: '2026/27' }],
    terms: [{ ...scope, SessionId: 's1', TermId: 't1', Name: 'First term' }],
    classes: [{ ...scope, ClassId: 'c1', Name: section === 'primary' ? 'Primary 1' : 'JSS 1' }],
    subjects: [{ ...scope, SubjectId: 'math', Name: 'Mathematics' }],
    arms: ['a1', 'a2', 'a3'].map((ArmId) => ({ ...scope, ClassId: 'c1', ArmId, Name: ArmId.toUpperCase() })),
    offerings: [{ ...scope, SessionId: 's1', TermId: 't1', ClassId: 'c1', SubjectId: 'math', ArmId: '' }],
    teacherAllocations: [{ ...scope, SessionId: 's1', TermId: 't1', ClassId: 'c1', SubjectId: 'math', ArmId: 'a1', TeacherUsername: 'teacher1', AllocationRole: 'Subject Teacher' }]
  };
  const memberships = ['p1', 'p2', 'p3'].map((StudentRef, index) => ({ ...scope, StudentRef, SessionId: 's1', TermId: 't1', ClassId: 'c1', ArmId: index === 2 ? 'a2' : 'a1', SubjectIds: ['math'] }));
  const students = ['p1', 'p2', 'p3'].map((AdmissionNo) => ({ ...scope, AdmissionNo, ParentEmail: AdmissionNo === 'p3' ? 'other@example.com' : 'parent@example.com' }));
  const saved = new Map();
  const batches = [];
  const collections = Object.fromEntries(['sessions', 'terms', 'classes', 'arms', 'subjects', 'offerings', 'teacherAllocations'].map((key) => [({ sessions: 'academicSessions', terms: 'academicTerms', classes: 'academicClasses', arms: 'academicArms', subjects: 'academicSubjects', offerings: 'academicSubjectOfferings', teacherAllocations: 'academicTeacherAllocations' })[key], state[key]]));
  collections.academicStudentMemberships = memberships;
  const dependencies = {
    getSchoolStructure: async () => ({ Branches: [{ Id: 'main' }, { Id: 'east' }], Sections: ['primary', 'secondary'] }),
    queryCollection: async (_env, collection) => collections[collection] || [],
    listSchoolCollection: async () => students,
    loadNotificationSettings: async () => ({ AudiencePolicies: { Parent: { Categories: { Academics: true }, Channels: { InApp: true, Push: true } } } }),
    getDocument: async (_env, collection, id) => saved.get(`${collection}/${id}`) || null,
    batchCommitDocuments: async (_env, writes) => {
      if (writes.some((write) => saved.has(`${write.collectionPath}/${write.documentId}`))) throw Object.assign(new Error('Already exists'), { status: 409 });
      writes.forEach((write) => saved.set(`${write.collectionPath}/${write.documentId}`, write.data)); batches.push(writes);
    },
    now: '2026-10-05T10:00:00Z'
  };
  return { state, memberships, students, dependencies, batches, saved };
}
const env = { DYNAMAX_WORKSPACE_ID: 'school1' };

test('Unicode homework push previews remain inside FCM byte limits without truncating in-app instructions', () => {
  const notification = { Title: '📚'.repeat(160), Message: '📚'.repeat(2000) };
  const push = homeworkPushPreview(notification);
  assert.ok(new TextEncoder().encode(JSON.stringify(push)).length < 3000);
  assert.match(push.body, /Open the parent portal/);
  assert.equal(notification.Message, '📚'.repeat(2000));
});
async function previewAndSend(f, extra = {}) {
  const body = { ...input, ...extra };
  const preview = await handleTeacherHomework(env, user, { ...body, action: 'previewHomework' }, f.dependencies);
  const send = { ...body, action: 'sendHomework', RequestId: 'request-1234567890', PreviewDigest: preview.PreviewDigest };
  const result = await handleTeacherHomework(env, user, send, f.dependencies);
  return { preview, send, result };
}

for (const section of ['primary', 'secondary']) test(`${section}: only assigned subject arms are available and unrelated parents stay excluded`, () => {
  const f = fixture(section);
  assert.deepEqual(homeworkTargets(f.state, user)[0].Arms.map((row) => row.ArmId), ['a1']);
  const audience = homeworkAudience(f.state, user, input, f.memberships, f.students);
  assert.deepEqual(audience.references, ['p1', 'p2']); assert.deepEqual(audience.emails, ['parent@example.com']);
  assert.equal(audience.summary.ParentAccounts, 1); assert.equal(audience.summary.Students, 2);
});

test('class-wide allocations expand to active offered arms, while arm-specific assignments cannot expand', () => {
  const f = fixture(); f.state.teacherAllocations[0].ArmId = '';
  f.state.arms[2].Status = 'Archived';
  assert.deepEqual(homeworkTargets(f.state, user)[0].Arms.map((row) => row.ArmId), ['a1', 'a2']);
  f.state.teacherAllocations[0].ArmId = 'a1';
  assert.throws(() => homeworkAudience(f.state, user, { ...input, ArmIds: ['a2'] }, f.memberships, f.students), /not the active subject teacher/);
});

for (const [key, field, value] of [
  ['teacherAllocations', 'TeacherUsername', 'teacher2'], ['teacherAllocations', 'AllocationRole', 'Form Teacher'],
  ['teacherAllocations', 'Status', 'Archived'], ['teacherAllocations', 'SubjectId', 'history'],
  ['teacherAllocations', 'TermId', 'old'], ['teacherAllocations', 'BranchId', 'east'],
  ['teacherAllocations', 'SchoolSection', 'primary'], ['sessions', 'Status', 'Closed'],
  ['terms', 'Status', 'Planned'], ['classes', 'Status', 'Archived'], ['subjects', 'Status', 'Archived'],
  ['offerings', 'Status', 'Archived']
]) test(`rejects inactive/foreign target: ${key}.${field}=${value}`, () => {
  const f = fixture(); f.state[key][0][field] = value;
  assert.equal(homeworkTargets(f.state, user).length, 0);
});

for (const [field, value] of [['ArmId', 'a2'], ['ClassId', 'c2'], ['TermId', 'old'], ['SessionId', 'old'], ['BranchId', 'east'], ['SchoolSection', 'primary'], ['Status', 'Withdrawn'], ['SubjectIds', ['history']]]) {
  test(`excludes membership outside selected active roster: ${field}`, () => {
    const f = fixture(); f.memberships[0][field] = value;
    assert.deepEqual(homeworkAudience(f.state, user, input, f.memberships, f.students).references, ['p2']);
  });
}

test('foreign, withdrawn and duplicated profiles do not leak or inflate recipients', () => {
  const f = fixture(); f.students[0].Status = 'Withdrawn'; f.students.push({ ...f.students[1] });
  f.students.push({ ...f.students[1], BranchId: 'east', ParentEmail: 'foreign@example.com' });
  const audience = homeworkAudience(f.state, user, input, f.memberships, f.students);
  assert.deepEqual(audience.references, ['p2']); assert.deepEqual(audience.emails, ['parent@example.com']);
});

test('canonical scoped profile overrides stale legacy email; contact fields are not arbitrary recipients', () => {
  const f = fixture(); f.students[0].FatherEmail = 'unrelated@example.com';
  f.students.push({ ...f.students[0], __scopePath: 'schoolBranches/main/sections/secondary/students', ParentEmail: 'correct@example.com' });
  const audience = homeworkAudience(f.state, user, input, f.memberships, f.students);
  assert.deepEqual(audience.emails, ['correct@example.com', 'parent@example.com']);
});

test('a missing email is counted and supports reference-based in-app delivery without broadening push targets', () => {
  const f = fixture(); f.students[0].ParentEmail = '';
  const audience = homeworkAudience(f.state, user, input, f.memberships, f.students);
  assert.equal(audience.summary.MissingParentEmail, 1); assert.deepEqual(audience.emails, ['parent@example.com']);
});

test('input limits, due date validation and unknown supplied recipients', () => {
  for (const extra of [{ ArmIds: [] }, { Title: '' }, { Message: 'x'.repeat(2001) }, { DueDate: '2026-02-30' }]) assert.throws(() => normalizeHomeworkInput({ ...input, ...extra }));
  assert.equal(normalizeHomeworkInput({ ...input, TargetEmails: ['attacker@example.com'] }).TargetEmails, undefined);
  assert.deepEqual(normalizeHomeworkInput({ ...input, ArmIds: ['a1', 'a1'] }).ArmIds, ['a1']);
});

test('unauthorised roles, non-school accounts and subscription write restrictions are rejected', () => {
  for (const extra of [{ role: 'Accounts Officer' }, { edition: 'church' }, { allowedSections: [] }, { username: '' }]) assert.throws(() => requireHomeworkAccess({ ...user, ...extra }), /cannot send/);
  assert.throws(() => requireHomeworkAccess({ ...user, subscriptionActive: false }, true), (error) => error.status === 402);
  assert.throws(() => requireHomeworkAccess({ ...user, subscriptionReadOnly: true }, true), (error) => error.status === 403);
});

test('server validates staff branch and school section before queries', async () => {
  const f = fixture();
  await assert.rejects(loadHomeworkState(env, user, { ...input, BranchId: 'east' }, f.dependencies), /another branch/);
  await assert.rejects(loadHomeworkState(env, { ...user, schoolSectionAccess: 'Primary' }, input, f.dependencies), /another school section/);
  await assert.rejects(loadHomeworkState(env, user, { ...input, BranchId: 'all' }, f.dependencies), /working branch/);
});

test('preview exposes counts/message, never private parent addresses, and creates nothing', async () => {
  const f = fixture();
  const result = await handleTeacherHomework(env, user, { ...input, action: 'previewHomework' }, f.dependencies);
  assert.equal(result.summary.ParentAccounts, 1); assert.equal(f.batches.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /parent@example|TargetEmails|TargetAccountRefs/);
});

test('send atomically creates the homework, exact parent notification and existing durable push job', async () => {
  const f = fixture(); const { result } = await previewAndSend(f, { TargetEmails: ['attacker@example.com'], CreatedBy: 'admin' });
  assert.equal(result.ok, true); assert.equal(f.batches.length, 1); assert.equal(f.batches[0].length, 3);
  assert.equal(f.batches[0].every((row) => row.exists === false), true);
  const notification = f.batches[0][1].data;
  assert.deepEqual(notification.TargetEmails, ['parent@example.com']); assert.deepEqual(notification.TargetAccountRefs, ['p1', 'p2']);
  assert.equal(notification.ActorId, 'teacher1'); assert.equal(notification.Category, 'Academics');
  assert.equal(notification.SchoolSection, 'secondary'); assert.equal(notification.BranchId, 'main');
  assert.equal(f.batches[0][2].collectionPath, 'notificationAnnouncementPushJobs');
  for (const [email, ref, branch, section, expected] of [
    ['parent@example.com', 'p1', 'main', 'secondary', true], ['other@example.com', 'p3', 'main', 'secondary', false],
    ['parent@example.com', 'p1', 'east', 'secondary', false], ['parent@example.com', 'p1', 'main', 'primary', false]
  ]) assert.equal(notificationTargetsRecipient(notification, { audience: 'Parent', email, schoolId: 'school1', scopes: [{ accountRef: ref, branchId: branch, schoolSection: section }] }), expected);
});

test('both Primary and Secondary send through the same protected path with section-isolated notifications', async () => {
  for (const section of ['primary', 'secondary']) {
    const f = fixture(section); await previewAndSend(f, { SchoolSection: section });
    assert.equal(f.batches[0][1].data.SchoolSection, section);
  }
});

test('duplicate and concurrent retries create one durable send; altered retries are rejected', async () => {
  const f = fixture(); const { send } = await previewAndSend(f);
  const retry = await handleTeacherHomework(env, user, send, f.dependencies);
  assert.equal(retry.alreadySent, true); assert.equal(f.batches.length, 1);
  await assert.rejects(handleTeacherHomework(env, user, { ...send, Message: 'Changed' }, f.dependencies), /different homework/);
  const concurrent = fixture(); const preview = await handleTeacherHomework(env, user, { ...input, action: 'previewHomework' }, concurrent.dependencies);
  const body = { ...input, action: 'sendHomework', RequestId: 'concurrent-1234567890', PreviewDigest: preview.PreviewDigest };
  const results = await Promise.all([handleTeacherHomework(env, user, body, concurrent.dependencies), handleTeacherHomework(env, user, body, concurrent.dependencies)]);
  assert.equal(concurrent.batches.length, 1); assert.equal(results.some((row) => row.alreadySent), true);
});

test('removed assignments, moved students and edited homework invalidate preview before any write', async () => {
  for (const change of [(f) => { f.state.teacherAllocations[0].Status = 'Archived'; }, (f) => { f.memberships[0].ArmId = 'a2'; }, (f) => { f.students[0].ParentEmail = 'new@example.com'; }]) {
    const f = fixture(); const preview = await handleTeacherHomework(env, user, { ...input, action: 'previewHomework' }, f.dependencies);
    change(f);
    await assert.rejects(handleTeacherHomework(env, user, { ...input, action: 'sendHomework', RequestId: 'request-1234567890', PreviewDigest: preview.PreviewDigest }, f.dependencies));
    assert.equal(f.batches.length, 0);
  }
});

test('empty roster, invalid request IDs and absent preview fail closed', async () => {
  const f = fixture(); f.memberships.length = 0;
  await assert.rejects(handleTeacherHomework(env, user, { ...input, action: 'previewHomework' }, f.dependencies), /No active students/);
  const g = fixture();
  await assert.rejects(handleTeacherHomework(env, user, { ...input, action: 'sendHomework', RequestId: '../bad' }, g.dependencies), /request ID/);
  await assert.rejects(handleTeacherHomework(env, user, { ...input, action: 'sendHomework', RequestId: 'request-1234567890' }, g.dependencies), /Preview it again/);
});

test('parent notification policies are respected and disabled push creates no push job', async () => {
  const f = fixture(); f.dependencies.loadNotificationSettings = async () => ({ AudiencePolicies: { Parent: { Categories: { Academics: false } } } });
  await assert.rejects(handleTeacherHomework(env, user, { ...input, action: 'previewHomework' }, f.dependencies), /disabled/);
  const g = fixture(); g.dependencies.loadNotificationSettings = async () => ({ AudiencePolicies: { Parent: { Channels: { Push: false } } } });
  await previewAndSend(g); assert.equal(g.batches[0].length, 2); assert.deepEqual(g.batches[0][1].data.Channels, ['InApp']);
});

test('database/policy failures cannot cause a partial send or enable delivery by default', async () => {
  const f = fixture(); f.dependencies.loadNotificationSettings = async () => { throw new Error('Policy unavailable'); };
  await assert.rejects(handleTeacherHomework(env, user, { ...input, action: 'previewHomework' }, f.dependencies), /Policy unavailable/);
  assert.equal(f.batches.length, 0);
  const g = fixture(); const preview = await handleTeacherHomework(env, user, { ...input, action: 'previewHomework' }, g.dependencies);
  g.dependencies.batchCommitDocuments = async () => { throw new Error('Commit unavailable'); };
  await assert.rejects(handleTeacherHomework(env, user, { ...input, action: 'sendHomework', RequestId: 'request-1234567890', PreviewDigest: preview.PreviewDigest }, g.dependencies), /Commit unavailable/);
  assert.equal(g.saved.size, 0);
});

test('focused homework queries have declared school indexes', async () => {
  const schema = JSON.parse(await readFile(new URL('../firestore.school.indexes.json', import.meta.url), 'utf8'));
  for (const [collection, fields] of [['academicTeacherAllocations', ['BranchId', 'TeacherUsername']], ['academicStudentMemberships', ['BranchId', 'SessionId', 'TermId', 'ClassId']]]) {
    assert.ok(schema.indexes.some((index) => index.collectionGroup === collection && index.queryScope === 'COLLECTION'
      && fields.every((field) => index.fields.some((entry) => entry.fieldPath === field))), collection);
  }
});

test('the staff UI and authenticated endpoint are connected with safe rendering and immutable retry controls', async () => {
  const [api, ui, admin, html] = await Promise.all(['functions/api/staff-homework.js', 'js/teacher-homework.js', 'js/admin.js', 'admin.html'].map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
  assert.match(api, /requireStaffSession\(env, request\)/); assert.match(api, /maxBytes: 16 \* 1024/); assert.match(api, /no-store/);
  assert.match(admin, /data-teacher-homework/); assert.match(admin, /schoolSection: academicManagementFilters.section/);
  assert.ok(html.indexOf('js/teacher-homework.js') < html.indexOf('js/admin.js'));
  assert.match(ui, /escape\(arm.ArmId\)/); assert.match(ui, /\.textContent = result.preview.Message/);
  assert.match(ui, /if \(!preview \|\| busy\) return/); assert.match(ui, /request\('sendHomework', preview\)/);
  assert.match(ui, /uncertain = true; send.disabled = false/); assert.doesNotMatch(ui, /localStorage|sessionStorage/);
});
