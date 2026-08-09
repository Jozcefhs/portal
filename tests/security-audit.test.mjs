import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  prepareSecurityAudit,
  securityAuditAction,
  securityAuditModuleForRoute,
  securityAuditOutcome,
  shouldPersistSecurityAudit
} from '../functions/lib/security-audit.js';
import { defaultModulesForRole, modulesForEdition } from '../functions/lib/role-module-access.js';

test('security audit classifies modules, declared actions and outcomes consistently', () => {
  assert.equal(securityAuditModuleForRoute('/api/staff-hr'), 'Human Resources');
  assert.equal(securityAuditModuleForRoute('/api/backend'), 'Desktop operations');
  assert.equal(securityAuditAction({ pathname: '/api/staff-users', method: 'POST', body: { action: 'save-role-access' } }), 'SAVE ROLE ACCESS');
  assert.equal(securityAuditAction({ pathname: '/api/staff-session', method: 'POST', body: { password: 'not-recorded' } }), 'SIGN IN');
  assert.equal(securityAuditOutcome(200), 'Success');
  assert.equal(securityAuditOutcome(403), 'Denied');
  assert.equal(securityAuditOutcome(500), 'Failed');
});

test('audit preparation retains metadata but never copies request payloads or credentials', async () => {
  const request = new Request('https://example.test/api/accounting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dynamax-Branch': 'west', 'User-Agent': 'Dynamax Desktop' },
    body: JSON.stringify({ Action: 'postJournal', RecordedBy: 'accountant', Password: 'secret-value', EntityId: 'JRN-10' })
  });
  const prepared = await prepareSecurityAudit(request, '/api/accounting');
  assert.equal(prepared.action, 'POST JOURNAL');
  assert.equal(prepared.actorHint, 'accountant');
  assert.equal(prepared.entityId, 'JRN-10');
  assert.equal(prepared.requestedBranchId, 'west');
  assert.equal(prepared.sourcePlatform, 'Desktop');
  assert.equal('password' in prepared, false);
  assert.equal(JSON.stringify(prepared).includes('secret-value'), false);
});

test('authenticated reads and all public mutations are auditable while public reads remain write-free', () => {
  assert.equal(shouldPersistSecurityAudit({ method: 'GET' }, { username: 'admin' }), true);
  assert.equal(shouldPersistSecurityAudit({ method: 'POST' }, null), true);
  assert.equal(shouldPersistSecurityAudit({ method: 'GET' }, null), false);
});

test('security audit is a configurable cross-edition module and mandatory for super administrators', () => {
  for (const edition of ['school', 'faith', 'organization']) {
    assert.equal(modulesForEdition(edition).some((module) => module.key === 'securityAudit'), true);
    assert.equal(defaultModulesForRole('Super Admin', { edition }).includes('securityAudit'), true);
  }
  assert.equal(defaultModulesForRole('Auditor', { edition: 'faith' }).includes('securityAudit'), true);
});

test('middleware, protected endpoint and filterable print interface are wired together', async () => {
  const [middleware, endpoint, adminJs, style] = await Promise.all([
    readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/security-audit.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);
  assert.match(middleware, /persistRequestSecurityAudit/);
  assert.match(middleware, /context\.waitUntil/);
  assert.match(endpoint, /requireStaffSession/);
  assert.match(endpoint, /loadAggregatedSecurityAudit/);
  assert.match(adminJs, /Aggregated Security Audit Log/);
  assert.match(adminJs, /name="action"/);
  assert.match(adminJs, /name="user"/);
  assert.match(adminJs, /window\.print\(\)/);
  assert.match(style, /body\.security-audit-print/);
});
