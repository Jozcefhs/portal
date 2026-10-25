import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Run the actual workflow code with only its storage/delivery boundaries mocked.
// Every record is synthetic; these tests cannot contact Firestore or send messages.
const store = new Map();
const writes = [];
const notifications = [];
let revision = 0;
let beforeWrite = null;
const key = (collection, id) => `${collection}/${id}`;
const seed = (collection, id, data) => store.set(key(collection, id), structuredClone(data));
const read = (collection, id) => structuredClone(store.get(key(collection, id)) || null);
const rows = (collection) => [...store]
  .filter(([path]) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes('/'))
  .map(([, row]) => structuredClone(row));
function validateWrite(collection, id, condition = {}) {
  const current = read(collection, id);
  if ((condition.exists === false && current) || (condition.exists === true && !current)
      || (condition.updateTime && current?.__updateTime !== condition.updateTime)) {
    throw Object.assign(new Error('Synthetic write conflict'), { status: 409 });
  }
}
function commit(collection, id, data, condition = {}) {
  writes.push({ collection, id, data: structuredClone(data), condition });
  seed(collection, id, { ...data, __updateTime: `revision-${++revision}` });
  return read(collection, id);
}
const database = {
  getDocument: async (_env, collection, id) => read(collection, id),
  listCollection: async (_env, collection) => rows(collection),
  queryCollection: async (_env, collection, options = {}) => rows(collection).filter((row) =>
    (options.filters || []).every(({ field, op, value }) => op !== '==' || row[field] === value)),
  upsertDocument: async (_env, collection, id, data, condition = {}) => {
    beforeWrite?.(collection, id);
    validateWrite(collection, id, condition);
    return commit(collection, id, data, condition);
  },
  createDocumentIfAbsent: async (_env, collection, id, data) => ({
    document: read(collection, id) || commit(collection, id, data, { exists: false })
  }),
  deleteDocument: async (_env, collection, id) => store.delete(key(collection, id)),
  batchUpsertDocuments: async (_env, batch) => {
    for (const row of batch) {
      beforeWrite?.(row.collectionPath, row.documentId);
      validateWrite(row.collectionPath, row.documentId, row);
    }
    for (const row of batch) {
      if (row.operation === 'delete') store.delete(key(row.collectionPath, row.documentId));
      else commit(row.collectionPath, row.documentId, row.data, row);
    }
  }
};
database.queryCollectionPages = database.queryCollection;
globalThis.__faithOrganizationRegressionDb = database;
globalThis.__faithOrganizationRegressionNotifications = {
  createNotification: async (_env, payload) => {
    notifications.push(payload);
    return { notification: { ...payload, NotificationId: `N-${notifications.length}` } };
  },
  loadNotificationSettings: async () => ({})
};
const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const mockModule = (globalName, methods) => dataModule(methods.map((name) =>
  `export const ${name} = (...args) => globalThis.${globalName}.${name}(...args);`).join('\n'));
const substitutions = new Map([
  ['./firestore.js', mockModule('__faithOrganizationRegressionDb', Object.keys(database))],
  ['./notifications.js', mockModule('__faithOrganizationRegressionNotifications', ['createNotification', 'loadNotificationSettings'])]
]);
async function loadWorkflow(filename) {
  const url = new URL(`../functions/lib/${filename}`, import.meta.url);
  const source = (await readFile(url, 'utf8')).replace(/from\s+(['"])(\.[^'"]+)\1/g,
    (_match, _quote, path) => `from ${JSON.stringify(substitutions.get(path) || new URL(path, url).href)}`);
  const moduleUrl = dataModule(source);
  substitutions.set(`./${filename}`, moduleUrl);
  return import(moduleUrl);
}
await loadWorkflow('history-date-range.js');
const membership = await loadWorkflow('church-membership.js');
const services = await loadWorkflow('church-services.js');
const departments = await loadWorkflow('organization-departments.js');
const announcements = await loadWorkflow('church-announcements.js');
const branch = 'organisationBranches/main/';
const officer = { role: 'Membership Officer', username: 'synthetic-officer', branchId: 'main', edition: 'faith', allowedSections: ['members', 'services'] };
const admin = { ...officer, role: 'Church Administrator' };
const superAdmin = { ...officer, role: 'Super Admin' };
const orgUser = (role) => ({ ...officer, role, edition: 'organization' });
const departmentAction = (user, input) => departments.handleOrganizationDepartmentAction({}, user, input);
const breakdownFields = ['ChildrenCount', 'AdultCount', 'MaleCount', 'FemaleCount', 'FirstTimerCount', 'NewConvertCount'];

beforeEach(() => {
  store.clear(); writes.length = 0; notifications.length = 0; beforeWrite = null;
  seed('settings', 'organisationProfile', { Edition: 'faith', Plan: 'Professional' });
  seed(`${branch}churchMembers`, 'M1', { MemberId: 'M1', DisplayName: 'Synthetic Member', BranchId: 'main' });
  seed(`${branch}organisationDepartments`, 'D1', { DepartmentId: 'D1', Name: 'Synthetic Team', BranchId: 'main' });
});

test('department responses redact pastoral notes for record/finance/Organisation roles', async () => {
  seed(`${branch}churchMembers`, 'M1', {
    MemberId: 'M1', DisplayName: 'Synthetic Member', BranchId: 'main',
    PastoralNotes: 'Confidential upper-case value', pastoralNotes: 'Confidential legacy value'
  });
  for (const user of [officer, admin, { ...officer, role: 'Treasurer' }, orgUser('Organisation Administrator')]) {
    const result = await departments.listOrganizationDepartments({}, user, {});
    assert.equal(Object.hasOwn(result.members[0], 'PastoralNotes'), false);
    assert.equal(Object.hasOwn(result.members[0], 'pastoralNotes'), false);
    assert.doesNotMatch(JSON.stringify(result), /Confidential/);
  }
  for (const user of [superAdmin, { ...officer, role: 'Pastor' }]) {
    const result = await departments.listOrganizationDepartments({}, user, {});
    assert.equal(result.members[0].PastoralNotes, 'Confidential upper-case value');
  }
});

test('compact member edits preserve omitted profile fields and support intentional blank aliases', async () => {
  seed(`${branch}churchHouseholds`, 'H1', { HouseholdId: 'H1', HouseholdName: 'Synthetic household', BranchId: 'main' });
  const original = {
    MemberId: 'M1', DisplayName: 'Synthetic Member', HouseholdId: 'H1', BranchId: 'main',
    DateOfBirth: '1990-01-01', Address: 'Synthetic street', Notes: 'Keep general notes',
    PastoralNotes: 'Keep private notes', Phone: '08000000000', __updateTime: 'member-v1'
  };
  seed(`${branch}churchMembers`, 'M1', original);
  const result = await membership.saveChurchMember({}, officer, {
    MemberId: 'M1', OriginalMemberId: 'M1', DisplayName: 'Updated synthetic name', Phone: '08000000001'
  });
  for (const field of ['HouseholdId', 'DateOfBirth', 'Address', 'Notes', 'PastoralNotes']) {
    assert.equal(read(`${branch}churchMembers`, 'M1')[field], original[field]);
  }
  assert.equal(Object.hasOwn(result.member, 'PastoralNotes'), false);
  assert.deepEqual(writes[0].condition, { updateTime: 'member-v1' });
  const normalized = membership.normalizeChurchMemberUpdate({ memberId: 'M1', address: '', notes: '', surname: '' }, 'main', {
    ...original, address: 'Legacy address', notes: 'Legacy notes', LastName: 'Legacy surname'
  });
  assert.equal(normalized.Address, '');
  assert.equal(normalized.Notes, '');
  assert.equal(normalized.Surname, '');
  await membership.saveChurchMember({}, superAdmin, { MemberId: 'M1', OriginalMemberId: 'M1', HouseholdId: '', PastoralNotes: '' });
  assert.equal(read(`${branch}churchMembers`, 'M1').HouseholdId, '');
  assert.equal(read(`${branch}churchMembers`, 'M1').PastoralNotes, '');
});

test('member edit cannot change identity, branch, or pastoral fields without authority', async () => {
  await assert.rejects(membership.saveChurchMember({}, officer, {
    MemberId: 'M2', OriginalMemberId: 'M1', DisplayName: 'New identity'
  }), { status: 409 });
  await assert.rejects(membership.saveChurchMember({}, officer, {
    MemberId: 'M1', BranchId: 'other', DisplayName: 'Other branch'
  }), { status: 403 });
  await assert.rejects(membership.saveChurchMember({}, officer, { MemberId: 'M1', PastoralNotes: '' }), { status: 403 });
  assert.equal(writes.length, 0);
});

test('native Organisation roles have usable operations with least privilege and explicit edition', () => {
  for (const role of ['Executive Director', 'Organisation Administrator', 'Operations Manager', 'Records Officer']) {
    const user = orgUser(role);
    const personnel = membership.membershipCapabilities(user);
    const meetings = services.serviceCapabilities(user);
    const teams = departments.departmentCapabilities(user);
    assert.equal(personnel.canEditMembers, true, role);
    assert.equal(personnel.canViewPastoralNotes, false, role);
    assert.equal(meetings.canRecordAttendance, true, role);
    assert.equal(teams.canManageMembers, true, role);
    assert.equal(teams.canConfirmRemittance, false, role);
    assert.equal(meetings.canManageServices, role !== 'Records Officer', role);
    assert.equal(teams.canManagePrograms, role !== 'Records Officer', role);
    assert.equal(teams.canManageDepartments, role !== 'Records Officer', role);
    for (const edition of ['', 'faith', 'school']) {
      const wrongEdition = { role, edition };
      assert.equal(membership.membershipCapabilities(wrongEdition).canEditMembers, false);
      assert.equal(services.serviceCapabilities(wrongEdition).canRecordAttendance, false);
      assert.equal(departments.departmentCapabilities(wrongEdition).canManageMembers, false);
    }
  }
  assert.equal(membership.membershipCapabilities({ role: 'Pastor', edition: 'faith' }).canEditPastoralNotes, true);
  assert.equal(departments.departmentCapabilities({ role: 'Treasurer', edition: 'faith' }).canConfirmRemittance, true);
  assert.equal(services.serviceCapabilities(orgUser('Finance Officer')).canManageServices, false);
});

test('Organisation records officer can save personnel and attendance but cannot define programs', async () => {
  seed('settings', 'organisationProfile', { Edition: 'organization', Plan: 'Professional' });
  const user = orgUser('Records Officer');
  await membership.saveChurchMember({}, user, { MemberId: 'M1', DisplayName: 'Updated personnel' });
  seed(`${branch}churchServiceOccurrences`, 'O1', { OccurrenceId: 'O1', BranchId: 'main', Status: 'Scheduled' });
  await services.recordChurchAttendanceTotal({}, user, { OccurrenceId: 'O1', AttendanceCount: 4 });
  assert.equal(read(`${branch}churchServiceOccurrences`, 'O1').AttendanceCount, 4);
  await assert.rejects(departmentAction(user, { action: 'saveProgram', ProgramId: 'P1', Name: 'Program' }), { status: 403 });
  await assert.rejects(services.saveChurchService({}, user, { ServiceId: 'S1', Name: 'Meeting' }), { status: 403 });
});

test('offering submissions never trust browser paid fields, including direct and online methods', async () => {
  for (const [index, PaymentMethod] of ['Cash', 'Transfer', 'Paystack', 'Online'].entries()) {
    const OfferingId = `O-${index}`;
    await departmentAction(admin, {
      action: 'saveOffering', OfferingId, DepartmentId: 'D1', Amount: 100, PaymentMethod,
      PaymentStatus: 'Paid', Status: 'Paid', RemittanceStatus: 'Paid', PaidBy: 'forged'
    });
    const offering = read(`${branch}organisationDepartmentOfferings`, OfferingId);
    assert.equal(offering.Status, 'Awaiting Remittance');
    assert.equal(offering.RemittanceStatus, 'Unpaid');
    assert.equal(offering.PaidBy, '');
    assert.equal(offering.PaidAt, '');
  }
  await assert.rejects(departmentAction(admin, { action: 'markOfferingPaid', OfferingId: 'O-0' }), { status: 403 });
  await departmentAction({ ...officer, role: 'Treasurer' }, { action: 'markOfferingPaid', OfferingId: 'O-0', RemittanceReference: 'SYNTHETIC-RECEIPT' });
  const paid = read(`${branch}organisationDepartmentOfferings`, 'O-0');
  assert.equal(paid.RemittanceStatus, 'Paid');
  await assert.rejects(departmentAction(admin, {
    action: 'saveOffering', OfferingId: 'O-0', DepartmentId: 'D1', Amount: 900
  }), { status: 409 });
  assert.deepEqual(read(`${branch}organisationDepartmentOfferings`, 'O-0'), paid);
});

test('stale offering submission cannot overwrite a concurrent finance confirmation', async () => {
  const path = `${branch}organisationDepartmentOfferings`;
  seed(path, 'O1', { OfferingId: 'O1', Amount: 100, RemittanceStatus: 'Unpaid', __updateTime: 'v1' });
  beforeWrite = (collection, id) => {
    if (collection === path && id === 'O1') {
      beforeWrite = null;
      seed(path, id, { ...read(path, id), RemittanceStatus: 'Paid', __updateTime: 'v2' });
    }
  };
  await assert.rejects(departmentAction(admin, {
    action: 'saveOffering', OfferingId: 'O1', DepartmentId: 'D1', Amount: 200
  }), { status: 409 });
  assert.equal(read(path, 'O1').RemittanceStatus, 'Paid');
  assert.equal(read(path, 'O1').Amount, 100);
});

test('batch assignment preserves existing role, dates, status and is harmless on retry', async () => {
  const path = `${branch}organisationDepartmentMembers`;
  const original = {
    MembershipId: 'D1--M1', DepartmentId: 'D1', MemberId: 'M1', DisplayName: 'Synthetic Member',
    PositionId: 'LEAD', PositionName: 'Leader', JoinedDate: '2024-01-01', BranchId: 'main', Status: 'Inactive'
  };
  seed(path, 'D1--M1', original);
  seed(`${branch}churchMembers`, 'M2', { MemberId: 'M2', DisplayName: 'New Member', BranchId: 'main' });
  const input = { action: 'batchAssignDepartmentPeople', DepartmentId: 'D1', PersonKeys: ['member:M1', 'member:M2'] };
  await departmentAction(admin, input);
  assert.deepEqual(read(path, 'D1--M1'), original);
  const newMember = read(path, 'D1--M2');
  assert.equal(newMember.Status, 'Active');
  assert.equal(writes.find((write) => write.id === 'D1--M2').condition.exists, false);
  await departmentAction(admin, input);
  assert.deepEqual(read(path, 'D1--M1'), original);
  assert.deepEqual(read(path, 'D1--M2'), newMember);
  assert.equal(writes.filter((write) => write.collection === path).length, 1);
  await assert.rejects(departmentAction(admin, { ...input, BranchId: 'other' }), { status: 403 });
});

test('batch assignment does not overwrite an assignment created after the initial read', async () => {
  const path = `${branch}organisationDepartmentMembers`;
  beforeWrite = (collection, id) => {
    if (collection === path) {
      beforeWrite = null;
      seed(collection, id, { MembershipId: id, PositionId: 'LEAD', Status: 'Inactive' });
    }
  };
  await assert.rejects(departmentAction(admin, {
    action: 'batchAssignDepartmentPeople', DepartmentId: 'D1', PersonKeys: ['member:M1']
  }), { status: 409 });
  assert.equal(read(path, 'D1--M1').PositionId, 'LEAD');
  assert.equal(writes.length, 0);
});

test('visitor attendance requires a stable identity and retains deterministic member IDs', () => {
  const visitor = { OccurrenceId: 'O1', AttendanceType: 'Visitor', DisplayName: 'Synthetic Visitor' };
  assert.throws(() => services.normalizeAttendance(visitor), /AttendanceId or VisitorReference/);
  assert.throws(() => services.normalizeAttendance({ ...visitor, VisitorReference: '  ' }), /AttendanceId or VisitorReference/);
  const first = services.normalizeAttendance({ ...visitor, VisitorReference: 'V1' });
  const second = services.normalizeAttendance({ ...visitor, VisitorReference: 'V2' });
  assert.notEqual(first.AttendanceId, second.AttendanceId);
  assert.equal(services.normalizeAttendance({ ...visitor, AttendanceId: 'legacy-visitor' }).AttendanceId, 'legacy-visitor');
  assert.equal(services.normalizeAttendance({ OccurrenceId: 'O1', MemberId: 'M1' }).AttendanceId, 'O1--member--M1');
});

test('attendance replacement clears omitted/blank optional breakdowns and preserves valid zeros', async () => {
  const path = `${branch}churchServiceOccurrences`;
  seed(path, 'O1', {
    OccurrenceId: 'O1', ServiceId: 'S1', BranchId: 'main', Status: 'Scheduled', AttendanceCount: 100,
    ChildrenCount: 40, AdultCount: 60, MaleCount: 30, FemaleCount: 30, FirstTimerCount: 4, NewConvertCount: 2,
    __updateTime: 'occurrence-v1'
  });
  await services.recordChurchAttendanceTotal({}, officer, { OccurrenceId: 'O1', AttendanceCount: 5, ChildrenCount: '', AdultCount: '' });
  const saved = read(path, 'O1');
  assert.equal(saved.AttendanceCount, 5);
  for (const field of breakdownFields) assert.equal(Object.hasOwn(saved, field), false, field);
  assert.deepEqual(writes[0].condition, { updateTime: 'occurrence-v1' });
  await services.recordChurchAttendanceTotal({}, officer, {
    OccurrenceId: 'O1', AttendanceCount: 0, ...Object.fromEntries(breakdownFields.map((field) => [field, 0]))
  });
  for (const field of breakdownFields) assert.equal(read(path, 'O1')[field], 0, field);
  const before = read(path, 'O1');
  await assert.rejects(services.recordChurchAttendanceTotal({}, officer, {
    OccurrenceId: 'O1', AttendanceCount: 5, ChildrenCount: 4, AdultCount: 4
  }), /add up to the total/);
  assert.deepEqual(read(path, 'O1'), before);
});

const announcementInput = {
  Title: 'Synthetic update', Message: 'Test only', Recipients: { Staff: true }, Channels: { InApp: true, Push: true }
};
const now = '2026-10-11T10:00:00.000Z';
function seedAnnouncementStaff() {
  for (const [Username, edition, BranchId, Active] of [
    ['org-main', 'organization', 'main', 'YES'], ['org-other', 'organization', 'other', 'YES'],
    ['org-disabled', 'organization', 'main', 'NO'], ['faith-main', 'faith', 'main', 'YES'], ['school-main', 'school', 'main', 'YES']
  ]) seed('staffUsers', Username, { Username, OrganisationEdition: edition, BranchId, Active, Role: 'Super Admin' });
}

test('Organisation announcement composing is limited to leadership, with legacy Faith behavior intact', () => {
  for (const role of ['Super Admin', 'Executive Director', 'Organisation Administrator']) {
    assert.equal(announcements.canManageChurchAnnouncements(orgUser(role)), true, role);
  }
  for (const role of ['Operations Manager', 'Records Officer', 'Finance Officer', 'Pastor']) {
    assert.equal(announcements.canManageChurchAnnouncements(orgUser(role)), false, role);
  }
  assert.equal(announcements.canManageChurchAnnouncements({ role: 'Pastor', featureFlags: { members: true } }), true);
  assert.equal(announcements.canManageChurchAnnouncements({ role: 'Super Admin', edition: 'school' }), false);
});

test('immediate Organisation announcements use trusted edition and correct active branch audience', async () => {
  seedAnnouncementStaff();
  const result = await announcements.createChurchAnnouncement({ DYNAMAX_WORKSPACE_ID: 'synthetic' }, orgUser('Organisation Administrator'), {
    ...announcementInput, OrganisationEdition: 'faith', Edition: 'school'
  }, { now });
  assert.equal(result.Status, 'Sent');
  assert.equal(result.OrganisationEdition, 'organization');
  assert.equal(result.Edition, 'church'); // Existing notification-family wire format remains compatible.
  assert.deepEqual(result.RecipientSummary, { Members: 0, Staff: 1 });
  assert.deepEqual(notifications[0].TargetUsernames, ['org-main']);
  assert.equal(notifications[0].BranchId, 'main');
  assert.equal(rows('notificationAnnouncementPushJobs')[0].Edition, 'church');
  assert.equal(rows('notificationAnnouncementPushJobs')[0].SchoolId, 'synthetic');
});

test('legacy Faith announcements default to Faith while Organisation scheduler supplies its verified edition', async () => {
  seedAnnouncementStaff();
  const legacy = { ...announcements.normalizeChurchAnnouncementInput(announcementInput, { now }), BranchId: 'main' };
  delete legacy.OrganisationEdition;
  await announcements.sendChurchAnnouncement({}, legacy, { now });
  assert.deepEqual(notifications[0].TargetUsernames, ['faith-main']);
  notifications.length = 0;
  seed('notificationAnnouncements', 'LEGACY-ORG', {
    ...legacy, AnnouncementId: 'LEGACY-ORG', Status: 'Scheduled', ScheduledAt: '2026-10-11T09:00:00.000Z', SchoolId: 'synthetic'
  });
  const result = await announcements.processScheduledChurchAnnouncements({ DYNAMAX_WORKSPACE_ID: 'synthetic' }, { now, edition: 'organization' });
  assert.equal(result.sent, 1);
  assert.deepEqual(notifications[0].TargetUsernames, ['org-main']);
});

test('scheduler invokes the correct announcement family and queue in all three editions', async () => {
  const url = new URL('../functions/api/notification-scheduler.js', import.meta.url);
  const calls = [];
  globalThis.__faithOrganizationSchedulerMocks = {
    notificationSchedulerDiagnostic: () => ({ stage: 'unexpected-test-failure' }),
    secureTextEqual: (a, b) => a === b,
    requiredDeploymentIdentity: (env) => ({ edition: env.DYNAMAX_EDITION, workspaceId: 'synthetic' }),
    readJsonBody: async () => ({ announcementsOnly: true })
  };
  for (const name of [
    'processFeeReminderSchedule', 'processDueSchoolFeeCredits', 'retryFailedPushDeliveries',
    'processScheduledSchoolAnnouncements', 'processSchoolAnnouncementPushQueue', 'processScheduledChurchAnnouncements',
    'processAttendancePresenceNotifications', 'processLibraryDueReminders', 'processAcademicCbtPaperRetention'
  ]) globalThis.__faithOrganizationSchedulerMocks[name] = async (_env, options) => {
    calls.push({ name, options }); return { processed: 1, sent: 1 };
  };
  const dependency = mockModule('__faithOrganizationSchedulerMocks', Object.keys(globalThis.__faithOrganizationSchedulerMocks));
  const source = (await readFile(url, 'utf8')).replace(/from\s+(['"])(\.[^'"]+)\1/g, `from '${dependency}'`);
  const { onRequestPost } = await import(dataModule(source));
  for (const edition of ['school', 'faith', 'organization']) {
    calls.length = 0;
    const response = await onRequestPost({
      env: { DYNAMAX_EDITION: edition, NOTIFICATION_SCHEDULER_SECRET: 'synthetic-secret' },
      request: new Request('https://example.invalid/api/notification-scheduler', {
        method: 'POST', headers: { Authorization: 'Bearer synthetic-secret' }
      })
    });
    assert.equal(response.status, 200);
    const routine = edition === 'school' ? 'processScheduledSchoolAnnouncements' : 'processScheduledChurchAnnouncements';
    assert.equal(calls.some(({ name }) => name === routine), true, edition);
    assert.equal(calls.filter(({ name }) => name.startsWith('processScheduled')).length, 1, edition);
    const queue = calls.find(({ name }) => name === 'processSchoolAnnouncementPushQueue');
    assert.equal(queue.options.edition, edition === 'school' ? 'school' : 'church');
    assert.equal(calls.some(({name}) => name === 'processAcademicCbtPaperRetention'), false);
    if (edition !== 'school') assert.equal(calls.find(({ name }) => name === routine).options.edition, edition);
  }
});
