import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  applicationDocumentScope,
  staffCanAccessApplicationDocument
} from '../functions/api/staff-document.js';

const secondaryApplication = {
  ApplicationReference: 'DCA/26/001',
  __scopePath: 'schoolBranches/main/sections/secondary/applications'
};

test('staff document scope is derived from the application collection path when fields are absent', () => {
  assert.deepEqual(applicationDocumentScope(secondaryApplication), {
    branchId: 'main',
    schoolSection: 'secondary',
    valid: true
  });
  assert.equal(staffCanAccessApplicationDocument({
    role: 'Admissions Officer',
    branchId: 'main',
    schoolSectionAccess: 'secondary'
  }, secondaryApplication), true);
});

test('non-super-admin staff cannot use absent application fields as cross-scope wildcards', () => {
  assert.equal(staffCanAccessApplicationDocument({
    role: 'Admissions Officer',
    branchId: 'west',
    schoolSectionAccess: 'secondary'
  }, secondaryApplication), false);
  assert.equal(staffCanAccessApplicationDocument({
    role: 'Admissions Officer',
    branchId: 'main',
    schoolSectionAccess: 'primary'
  }, secondaryApplication), false);
});

test('unknown legacy scope and conflicting field metadata fail closed for constrained staff', () => {
  assert.equal(staffCanAccessApplicationDocument({
    role: 'Admissions Officer',
    branchId: 'main',
    schoolSectionAccess: 'secondary'
  }, {
    ApplicationReference: 'DCA/26/002',
    __scopePath: 'applications'
  }), false);

  const conflictingApplication = {
    ...secondaryApplication,
    BranchId: 'west',
    SchoolSection: 'primary'
  };
  assert.equal(applicationDocumentScope(conflictingApplication).valid, false);
  assert.equal(staffCanAccessApplicationDocument({
    role: 'Admissions Officer',
    branchId: 'west',
    schoolSectionAccess: 'primary'
  }, conflictingApplication), false);
});

test('super admin remains authorized while the shared request handler guards view and delete paths', async () => {
  assert.equal(staffCanAccessApplicationDocument({
    role: 'Super Admin',
    branchId: 'west',
    schoolSectionAccess: 'primary'
  }, secondaryApplication), true);

  const source = await readFile(
    new URL('../functions/api/staff-document.js', import.meta.url),
    'utf8'
  );
  const guardIndex = source.indexOf('!staffCanAccessApplicationDocument(user, application)');
  const deleteIndex = source.indexOf("if (action === 'delete')");
  const loadIndex = source.indexOf('const file = await loadDriveFile');
  assert.ok(guardIndex > 0, 'the shared handler must enforce application scope');
  assert.ok(deleteIndex > guardIndex, 'delete must run only after the shared scope guard');
  assert.ok(loadIndex > guardIndex, 'view/download must run only after the shared scope guard');
});
