import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { prepareSecurityAudit, normalizedLegacyAudit, shouldPersistSecurityAudit, securityAuditRowVisible } from '../functions/lib/security-audit.js';

const source = { collection: 'platformSecurityAudit' };
const old = { Action: 'SUBMIT TO PASSPORT PHOTO', Route: '/api/passport-photo', Method: 'POST', Actor: 'Test Officer',
  ActorUsername: 'officer', Outcome: 'Success', HttpStatus: 200, Timestamp: '2026-10-15T23:58:55.000Z',
  Summary: 'Test Officer requested to submit to passport photo.', AuditId: 'PHOTO-1' };

test('passport-photo requests describe an existing photograph read, with a safe target reference', async () => {
  const request = new Request('https://example.test/api/passport-photo', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ applicationReference: 'TEST/001', code: 'SECRET-CODE' }) });
  const prepared = await prepareSecurityAudit(request, '/api/passport-photo');
  assert.equal(prepared.action, 'Load existing passport photograph for display');
  assert.equal(prepared.subject, 'TEST/001');
  assert.equal(prepared.entityType, 'Student/application photograph');
  assert.doesNotMatch(JSON.stringify(prepared), /SECRET-CODE/);
  for (const status of [200, 202, 206, 401, 403, 404, 500]) assert.equal(shouldPersistSecurityAudit(prepared, null, status), status !== 200);
});

test('historic passport-photo labels are corrected for display, not rewritten or deleted', () => {
  const before = structuredClone(old), row = normalizedLegacyAudit(old, source);
  assert.equal(row.Action, 'Loaded existing passport photograph for display');
  assert.equal(row.OriginalAction, old.Action);
  assert.equal(row.ActorUsername, old.ActorUsername);
  assert.equal(row.Timestamp, old.Timestamp);
  assert.equal(row.ActivityClass, 'Routine photograph load');
  assert.equal(row.Module, 'Students');
  assert.match(row.Summary, /session associated with Test Officer/);
  assert.match(row.Summary, /not a photograph upload or change/);
  assert.equal(securityAuditRowVisible(row), true);
  assert.deepEqual(old, before);
  assert.equal(normalizedLegacyAudit(row, source).Action, row.Action);
  for (const route of ['/api/upload-document', '/api/staff-student-passport']) {
    const upload = normalizedLegacyAudit({ ...old, Route: route }, source);
    assert.notEqual(upload.ActivityClass, 'Routine photograph load');
  }
});

test('failed and denied photo reads stay visible; only confirmed successes use the routine toggle', async () => {
  const rows = [old, { ...old, HttpStatus: 403, Outcome: 'Denied' }, { ...old, HttpStatus: 404, Outcome: 'Failed' },
    { ...old, HttpStatus: 500, Outcome: 'Failed' }, { ...old, HttpStatus: 202 }, { ...old, HttpStatus: 0 }]
    .map(row => normalizedLegacyAudit(row, source));
  assert.match(rows[1].Action, /^Access denied:/);
  assert.match(rows[2].Action, /^Failed to load/);
  assert.match(rows[3].Summary, /could not be loaded/);
  for (const row of rows.slice(4)) assert.match(row.Summary, /Completion was not confirmed/);
  for (const row of rows) assert.equal(securityAuditRowVisible(row), true);
  const client = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const context = vm.createContext({ securityAuditData: { rows, filters: {} },
    clean: value => String(value ?? '').trim(), lower: value => String(value ?? '').trim().toLowerCase() });
  vm.runInContext(client.slice(client.indexOf('function securityAuditFilteredRows('), client.indexOf('function securityAuditDateTime(')), context);
  assert.equal(vm.runInContext('securityAuditFilteredRows().length', context), 5);
  vm.runInContext('securityAuditData.filters.includeRoutineSystem = true', context);
  assert.equal(vm.runInContext('securityAuditFilteredRows().length', context), 6);
});
