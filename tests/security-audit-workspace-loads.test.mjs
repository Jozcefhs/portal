import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { prepareSecurityAudit, shouldPersistSecurityAudit, normalizedLegacyAudit, securityAuditRowVisible } from '../functions/lib/security-audit.js';

const source = { collection: 'platformSecurityAudit' };
const load = { AuditId: 'LOAD-1', Actor: 'Test Officer', ActorRole: 'Teacher', Route: '/api/staff-academics',
  Action: 'Bootstrap', Method: 'POST', Outcome: 'Success', HttpStatus: 200, BranchId: 'main',
  ActionContext: 'School section: secondary', Summary: 'Test Officer requested to bootstrap in Academic management.' };
const normalize = row => normalizedLegacyAudit(row, source);

test('workspace loads use understandable names while all attempts remain auditable', async () => {
  const prepared = await prepareSecurityAudit(new Request('https://example.test/api/staff-academics', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bootstrap', SchoolSection: 'secondary' })
  }), '/api/staff-academics');
  assert.equal(prepared.action, 'Load Academic Management workspace');
  for (const status of [200, 202, 206, 401, 403, 500]) {
    assert.equal(shouldPersistSecurityAudit(prepared, null, status), true);
    assert.equal(shouldPersistSecurityAudit({ ...prepared, action: 'Bootstrap' }, null, status), true);
  }
});

test('historical bootstrap labels and summaries are interpreted without rewriting evidence', () => {
  const before = structuredClone(load);
  const row = normalize(load);
  assert.equal(row.Action, 'Loaded Academic Management workspace — Secondary section');
  assert.equal(row.OriginalAction, 'Bootstrap');
  assert.equal(row.ActivityClass, 'Routine workspace load');
  assert.match(row.Summary, /^Test Officer loaded the Academic Management workspace — Secondary section\./);
  assert.match(row.Summary, /does not save attendance, scores or other academic records/);
  assert.doesNotMatch(row.Summary, /bootstrap/i);
  assert.equal(securityAuditRowVisible(row), true, 'the server retains the row for the routine toggle');
  assert.deepEqual(load, before);
  for (const [section, label] of [['primary', 'Primary section'], ['all', 'All school sections'], ['', ''], ['unknown', '']]) {
    const normalized = normalize({ ...load, ActionContext: section ? `School section: ${section}` : '' });
    assert.equal(normalized.Action, `Loaded Academic Management workspace${label ? ` — ${label}` : ''}`);
  }
  assert.equal(normalize({ ...row }).Action, row.Action, 'normalization is stable for newly worded records');
});

test('failed, denied and unconfirmed loads never claim success', () => {
  for (const [status, outcome, action, summary] of [
    [401, 'Denied', 'Access denied:', /was denied access/],
    [403, 'Denied', 'Access denied:', /was denied access/],
    [500, 'Failed', 'Failed to load', /load request failed/],
    [200, 'Failed', 'Failed to load', /load request failed/],
    [202, 'Success', 'Load Academic', /Completion was not confirmed/],
    [206, 'Success', 'Load Academic', /Completion was not confirmed/],
    [0, 'Success', 'Load Academic', /Completion was not confirmed/]
  ]) {
    const row = normalize({ ...load, HttpStatus: status, Outcome: outcome });
    assert.ok(row.Action.startsWith(action));
    assert.match(row.Summary, summary);
    assert.equal(securityAuditRowVisible(row), true);
  }
});

test('only confirmed academic workspace loads hide by default and the toggle restores them', () => {
  const rows = [normalize(load),
    normalize({ ...load, AuditId: 'FAIL', HttpStatus: 500, Outcome: 'Failed' }),
    normalize({ ...load, AuditId: 'DENY', HttpStatus: 403, Outcome: 'Denied' }),
    normalize({ ...load, AuditId: 'WAIT', HttpStatus: 202 }),
    normalize({ ...load, AuditId: 'UNKNOWN', HttpStatus: 0 }),
    normalize({ ...load, AuditId: 'SAVE', Action: 'Save academic student attendance', Summary: '' }),
    normalize({ ...load, AuditId: 'OTHER', Route: '/api/other-workflow', Summary: '' })];
  const client = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  const context = vm.createContext({ securityAuditData: { rows, filters: {} },
    clean: value => String(value ?? '').trim(), lower: value => String(value ?? '').trim().toLowerCase() });
  vm.runInContext(client.slice(client.indexOf('function securityAuditFilteredRows('), client.indexOf('function securityAuditDateTime(')), context);
  assert.equal(vm.runInContext('securityAuditFilteredRows().length', context), 6);
  assert.equal(vm.runInContext('securityAuditRoutineSystemSuccess(securityAuditData.rows[0])', context), true);
  vm.runInContext('securityAuditData.filters.includeRoutineSystem = true', context);
  assert.equal(vm.runInContext('securityAuditFilteredRows().length', context), 7);
  assert.equal(rows.length, 7, 'filtering does not remove records');
  vm.runInContext('securityAuditData.filters.action = "Loaded Academic Management workspace — Secondary section"', context);
  assert.equal(vm.runInContext('securityAuditFilteredRows().length', context), 1);
  assert.equal(rows[5].ActivityClass, '', 'saving attendance is never classified as a workspace load');
  assert.equal(rows[6].ActivityClass, '', 'unverified bootstrap commands in other modules remain unclassified');
});
