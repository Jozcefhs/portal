import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { academicManagementCapabilities, academicWebActor } from '../functions/lib/academic-management.js';

const ict = { username: 'ict', role: 'ICT', edition: 'school', allowedSections: ['academics'], branchId: 'main', schoolSectionAccess: 'Secondary' };

test('web ICT has every academic capability without changing its role or scope', () => {
  const actor = academicWebActor(ict);
  const permissions = academicManagementCapabilities(actor);
  assert.equal(permissions.fullAcademicAccess, true);
  for (const [name, value] of Object.entries(permissions).filter(([name]) => name.startsWith('can'))) {
    assert.equal(value, true, name);
  }
  assert.equal(actor.role, 'ICT');
  assert.equal(actor.branchId, 'main');
  assert.equal(actor.schoolSectionAccess, 'Secondary');
  assert.equal(academicManagementCapabilities(ict).fullAcademicAccess, false);
  assert.equal(academicManagementCapabilities({ ...ict, fullAcademicAccess: true, WebCompanion: true }).fullAcademicAccess, false);
  assert.equal(academicManagementCapabilities(JSON.parse(JSON.stringify(actor))).fullAcademicAccess, false);
  for (const role of ['Teacher', 'Principal', 'Super Admin', 'Admissions Officer']) {
    assert.equal(academicManagementCapabilities(academicWebActor({ ...ict, role })).fullAcademicAccess, false);
  }
  for (const denied of [{ ...ict, allowedSections: [] }, { ...ict, edition: 'church' }]) {
    assert.equal(academicManagementCapabilities(academicWebActor(denied)).fullAcademicAccess, false);
  }
});

test('the web route grants authority only from the authenticated staff session, not request fields', async () => {
  const source = await readFile(new URL('../functions/api/staff-academics.js', import.meta.url), 'utf8');
  let account = ict, authenticationError, calls = 0;
  const context = vm.createContext({
    Response, academicWebActor,
    requiredDeploymentIdentity: () => ({ edition: 'school' }), requireFirestoreEnv: () => {},
    startRequestMetric: () => ({}), finishRequestMetric: () => {},
    requireStaffSession: async () => { if (authenticationError) throw authenticationError; return account; },
    readJsonBody: request => request.json(),
    handleAcademicManagementAction: async (_env, actor) => { calls++; return { permissions: academicManagementCapabilities(actor), role: actor.role }; }
  });
  vm.runInContext(source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/^export /gm, ''), context);
  const request = () => context.onRequestPost({ env: {}, request: new Request('https://school.example/api/staff-academics', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'bootstrap', role: 'ICT', UserRole: 'ICT', fullAcademicAccess: true })
  }) });
  let response = await request();
  assert.equal((await response.json()).permissions.fullAcademicAccess, true);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  account = { ...ict, role: 'Teacher' };
  response = await request();
  const teacherResponse = await response.json();
  assert.equal(teacherResponse.role, 'Teacher');
  assert.equal(teacherResponse.permissions.fullAcademicAccess, false);
  authenticationError = Object.assign(new Error('Sign in required'), { status: 401 });
  assert.equal((await request()).status, 401);
  assert.equal(calls, 2);
  const backend = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  assert.doesNotMatch(backend, /academicWebActor/);
});
