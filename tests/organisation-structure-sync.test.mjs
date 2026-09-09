import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizeSchoolStructure } from '../functions/lib/school-scope.js';

const backendSource = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');

test('desktop structure has a dedicated backend action that refreshes the shared branch registry', () => {
  assert.match(backendSource, /async function saveOrganisationStructure\(env, body\)/);
  assert.match(backendSource, /getDocument\(env, 'settings', 'schoolStructure'\)/);
  assert.match(backendSource, /upsertDocument\(env, 'settings', 'schoolStructure'/);
  assert.match(backendSource, /invalidateSchoolStructureCache\(\)/);
  assert.match(backendSource, /case 'saveOrganisationStructure':\s*return saveOrganisationStructure\(env, body\)/);
});

test('installed desktop clients also synchronize structure while saving branch overrides', () => {
  assert.match(backendSource, /const structureResult = \([\s\S]*hasOwnProperty\.call\(body, 'SchoolBranches'\)/);
  assert.match(backendSource, /\? await saveOrganisationStructure\(env, body\) : null/);
  assert.match(backendSource, /structureResult\?\.message/);
});

test('structure normalization creates stable branch ids without dropping saved sections', () => {
  assert.match(backendSource, /function normalizedOrganisationStructure\(body = \{\}, existing = \{\}\)/);
  assert.match(backendSource, /return normalizeSchoolStructure\(\{/);
  assert.match(backendSource, /const savedSections = Array\.isArray\(existing\.Sections\)/);
  assert.match(backendSource, /Sections: savedSections/);
});

test('the Main Branch display label always resolves to the canonical main scope', () => {
  assert.deepEqual(normalizeSchoolStructure({
    Branches: ['Main Branch', 'Area One'],
    ActiveBranchId: 'area-one',
    Sections: ['primary', 'secondary']
  }), {
    Branches: [
      { Id: 'main', Name: 'Main Branch' },
      { Id: 'area-one', Name: 'Area One' }
    ],
    ActiveBranchId: 'area-one',
    Sections: ['primary', 'secondary']
  });
});

test('legacy saved main-branch structures are repaired while they are read', () => {
  assert.deepEqual(normalizeSchoolStructure({
    Branches: [{ Id: 'main-branch', Name: 'Main Branch' }],
    ActiveBranchId: 'main'
  }), {
    Branches: [{ Id: 'main', Name: 'Main Branch' }],
    ActiveBranchId: 'main',
    Sections: ['primary', 'secondary']
  });
});
