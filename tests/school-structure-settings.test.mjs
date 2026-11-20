import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSchoolOwner, schoolSettingsWrites } from '../functions/api/school-structure-settings.js';

const owner = { edition: 'school', role: 'Super Admin', subscriptionActive: true, branchAccess: 'all', canSwitchBranches: true, branchId: 'main' };
const structure = { __updateTime: 'v1', ActiveBranchId: 'main', Sections: ['primary'], Branches: [
  { Id: 'main', Name: 'Main', SchoolSectionMode: 'primary', ExternalCode: 'legacy' }
] };
const docs = { __updateTime: 'v2', Enabled: { AcceptanceForm: false, OtherLegacyDocument: true } };
const form = () => ({
  branches: [{ Id: 'main', Name: 'Main' }], activeIndex: 0, sections: ['primary'], structureVersion: 'v1', documentsVersion: 'v2',
  documents: { BirthCertificate: true, PreviousSchoolReport: true, PassportPhotograph: true, MedicalReport: true, TransferCertificateDoc: true, AcceptanceForm: false }
});
test('school owner can edit from a selected working branch, branch-limited accounts cannot', () => {
  checkSchoolOwner(owner, true);
  for (const override of [{ branchAccess: 'selected' }, { assignedBranchIds: ['main','west'] }, { role: 'Management' },
    { subscriptionReadOnly: true }, { edition: 'hospital' }]) assert.throws(() => checkSchoolOwner({ ...owner, ...override }, true));
});
test('idempotent saves and optimistic concurrency protect documents and branch metadata', () => {
  const input = form();
  assert.deepEqual(schoolSettingsWrites(input, structure, docs, 'owner'), []);
  input.branches[0].Name = 'Main campus';
  input.branches.push({ Id: '', Name: 'North campus' });
  input.activeIndex = 1;
  input.documents.AcceptanceForm = true;
  const [registry, documents] = schoolSettingsWrites(input, structure, docs, 'owner');
  assert.deepEqual(registry.data.Branches[0], { ...structure.Branches[0], Name: 'Main campus' });
  assert.equal(registry.data.ActiveBranchId, 'north-campus');
  assert.equal(documents.data.Enabled.OtherLegacyDocument, true);
  assert.equal(documents.data.Enabled.AcceptanceForm, true);
  assert.equal(registry.updateTime, 'v1');
  assert.equal(documents.updateTime, 'v2');
  assert.throws(() => schoolSettingsWrites({ ...input, documentsVersion: 'stale' }, structure, docs, 'owner'), /changed/);
  assert.throws(() => schoolSettingsWrites({ ...input, branches: input.branches.slice(1) }, structure, docs, 'owner'), /existing branch/);
  assert.throws(() => schoolSettingsWrites({ ...input, branches: [...input.branches, input.branches[1]] }, structure, docs, 'owner'), /unique/);
});
