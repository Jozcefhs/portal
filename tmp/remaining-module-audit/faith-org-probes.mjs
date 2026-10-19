// Read-only audit harness: execute current business logic against an in-memory datastore.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { membershipCapabilities } from '../../functions/lib/church-membership.js';
import { allowedSectionsFor } from '../../functions/lib/staff-auth.js';
import { buildChurchAnnouncementAudienceGroups, canManageChurchAnnouncements } from '../../functions/lib/church-announcements.js';

const store = new Map();
const writes = [];
const key = (collection, id) => `${collection}/${id}`;
const seed = (collection, id, data) => store.set(key(collection, id), structuredClone(data));
globalThis.__remainingAuditDb = {
  getDocument: async (_env, collection, id) => structuredClone(store.get(key(collection, id)) || null),
  listCollection: async (_env, collection) => [...store].filter(([path]) => path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes('/')).map(([, row]) => structuredClone(row)),
  upsertDocument: async (_env, collection, id, data) => {
    writes.push({ collection, id, data: structuredClone(data) });
    seed(collection, id, data);
    return structuredClone(data);
  },
  deleteDocument: async (_env, collection, id) => store.delete(key(collection, id)),
  batchUpsertDocuments: async (_env, rows) => {
    for (const row of rows) {
      if (row.operation === 'delete') store.delete(key(row.collectionPath, row.documentId));
      else await globalThis.__remainingAuditDb.upsertDocument(_env, row.collectionPath, row.documentId, row.data);
    }
  }
};
const dbModule = `data:text/javascript,${encodeURIComponent(Object.keys(globalThis.__remainingAuditDb).map((name) => `export const ${name} = (...args) => globalThis.__remainingAuditDb.${name}(...args);`).join('\n'))}`;
async function loadWithMemoryStore(filename) {
  const url = new URL(`../../functions/lib/${filename}`, import.meta.url);
  const source = (await readFile(url, 'utf8')).replace(/from\s+(['"])(\.[^'"]+)\1/g, (_match, _quote, path) => `from ${JSON.stringify(path === './firestore.js' ? dbModule : new URL(path, url).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const departments = await loadWithMemoryStore('organization-departments.js');
const services = await loadWithMemoryStore('church-services.js');
const membership = await loadWithMemoryStore('church-membership.js');
const branch = 'organisationBranches/main/';
const officer = { role: 'Membership Officer', username: 'officer', branchId: 'main', edition: 'faith', allowedSections: ['members', 'services'] };
const admin = { ...officer, role: 'Church Administrator' };
seed('settings', 'organisationProfile', { Edition: 'faith', Plan: 'Professional' });
seed(`${branch}churchMembers`, 'M1', { MemberId: 'M1', DisplayName: 'Synthetic Member', PastoralNotes: 'Synthetic confidential note', BranchId: 'main' });
const data = await departments.listOrganizationDepartments({}, officer, {});
assert.equal(membershipCapabilities(officer).canViewPastoralNotes, false);
assert.equal(data.members[0].PastoralNotes, 'Synthetic confidential note');
console.log('CONFIRMED: department list discloses pastoral notes to Membership Officer.');

seed(`${branch}churchHouseholds`, 'H1', { HouseholdId: 'H1', HouseholdName: 'Synthetic Household', BranchId: 'main' });
seed(`${branch}churchMembers`, 'M2', { MemberId: 'M2', DisplayName: 'Synthetic Full Profile', HouseholdId: 'H1', DateOfBirth: '1990-01-01', Address: 'Synthetic Street', Notes: 'Keep this profile note', PastoralNotes: 'Keep this confidential note', BranchId: 'main' });
await membership.saveChurchMember({}, { ...officer, role: 'Super Admin' }, { MemberId: 'M2', OriginalMemberId: 'M2', DisplayName: 'Synthetic Full Profile', FirstName: 'Synthetic', Surname: 'Profile', Phone: '08000000000', Email: '', Gender: '', MembershipDate: '2020-01-01', MembershipStatus: 'Active' });
const editedMember = store.get(`${branch}churchMembers/M2`);
for (const field of ['HouseholdId', 'DateOfBirth', 'Address', 'Notes', 'PastoralNotes']) assert.equal(editedMember[field], '');
console.log('CONFIRMED: normal web member edit erases unseen household / DOB / address / notes fields.');

for (const role of ['Executive Director', 'Organisation Administrator', 'Operations Manager', 'Records Officer']) {
  const actor = { role, edition: 'organization', allowedSections: ['members', 'services'] };
  assert.ok(allowedSectionsFor(actor, null, { edition: 'organization' }).includes('services'));
  assert.equal(services.serviceCapabilities(actor).canView, false);
  assert.equal(departments.departmentCapabilities(actor).canManageMembers, false);
}
console.log('CONFIRMED: native Organisation roles get module navigation but service access / department actions deny them.');

const audience = buildChurchAnnouncementAudienceGroups([], [{ Username: 'synthetic-org-admin', OrganisationEdition: 'organization', BranchId: 'main', Active: 'YES', Role: 'Super Admin' }], { Staff: true }, { branchId: 'main' });
assert.equal(audience.summary.Staff, 0);
assert.equal(canManageChurchAnnouncements({ role: 'Organisation Administrator', edition: 'organization' }), false);
console.log('CONFIRMED: Organisation-tagged staff excluded from announcements (0 of 1 recipients).');

seed(`${branch}organisationDepartments`, 'D1', { DepartmentId: 'D1', Name: 'Synthetic Team', BranchId: 'main' });
seed(`${branch}organisationDepartmentPositions`, 'D1--LEAD', { DepartmentId: 'D1', PositionId: 'LEAD', Name: 'Leader', BranchId: 'main' });
seed(`${branch}organisationDepartmentMembers`, 'D1--M1', { MembershipId: 'D1--M1', DepartmentId: 'D1', MemberId: 'M1', DisplayName: 'Synthetic Member', PositionId: 'LEAD', PositionName: 'Leader', JoinedDate: '2024-01-01', BranchId: 'main', Status: 'Inactive' });
await departments.handleOrganizationDepartmentAction({}, admin, { action: 'batchAssignDepartmentPeople', DepartmentId: 'D1', PersonKeys: ['member:M1'] });
const assignment = store.get(`${branch}organisationDepartmentMembers/D1--M1`);
assert.equal(assignment.PositionId, '');
assert.equal(assignment.JoinedDate, '');
assert.equal(assignment.Status, 'Active');
console.log('CONFIRMED: batch reassign of existing member removes role / joined date and reactivates membership.');

await departments.handleOrganizationDepartmentAction({}, admin, { action: 'saveOffering', OfferingId: 'SYNTHETIC-O1', DepartmentId: 'D1', Amount: 100, PaymentMethod: 'Transfer', PaymentStatus: 'Paid' });
assert.equal(departments.departmentCapabilities(admin).canConfirmRemittance, false);
assert.equal(store.get(`${branch}organisationDepartmentOfferings/SYNTHETIC-O1`).RemittanceStatus, 'Paid');
console.log('CONFIRMED: non-remittance approver can set transfer Paid using client PaymentStatus.');

const visitorOne = services.normalizeAttendance({ OccurrenceId: 'O1', AttendanceType: 'Visitor', DisplayName: 'Visitor One' });
const visitorTwo = services.normalizeAttendance({ OccurrenceId: 'O1', AttendanceType: 'Visitor', DisplayName: 'Visitor Two' });
assert.equal(visitorOne.AttendanceId, visitorTwo.AttendanceId);
console.log('CONFIRMED: missing visitor references accepted and collapse to same attendance key.');

seed(`${branch}churchServiceOccurrences`, 'O1', { OccurrenceId: 'O1', ServiceId: 'S1', Date: '2026-10-11', Status: 'Scheduled', BranchId: 'main', AttendanceCount: 100, ChildrenCount: 40, AdultCount: 60, MaleCount: 30, FemaleCount: 30 });
await services.recordChurchAttendanceTotal({}, officer, { OccurrenceId: 'O1', AttendanceCount: 5 });
const occurrence = store.get(`${branch}churchServiceOccurrences/O1`);
assert.equal(occurrence.AttendanceCount, 5);
assert.equal(occurrence.ChildrenCount + occurrence.AdultCount, 100);
console.log('CONFIRMED: total-only attendance update retains incompatible older breakdown (5 total, 100 age breakdown).');
console.log(`Synthetic writes: ${writes.length}. No network or live datastore used.`);
