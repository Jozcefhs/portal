import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import {
  prepareSecurityAudit,
  securityAuditAction,
  securityAuditModuleForRoute,
  securityAuditOutcome,
  shouldPersistSecurityAudit
} from '../functions/lib/security-audit.js';
import { explicitAuditAction, normalizedLegacyAudit, securityAuditRowVisible, persistRequestSecurityAudit } from '../functions/lib/security-audit.js';

test('generic audit verbs identify their exact record type and preserve historical actor/reference fields', () => {
  const row = normalizedLegacyAudit({ Action: 'UPDATE', User: 'Ada Officer', ActorUsername: 'ada',
    UserRole: 'Admin', RecordType: 'Material Requisition', RecordId: 'WEB-MAT-42', Details: 'Changed quantity' },
  { collection: 'accountingAudit', module: 'Finance & accounting' });
  assert.equal(row.Action, 'UPDATE MATERIAL REQUISITION');
  assert.equal(row.OriginalAction, 'UPDATE');
  assert.equal(row.Actor, 'Ada Officer');
  assert.equal(row.ActorUsername, 'ada');
  assert.equal(row.EntityId, 'WEB-MAT-42');
  assert.equal(row.ActorRole, 'Admin');
  assert.equal(explicitAuditAction('', 'Requisition'), 'ACTION NOT RECORDED — REQUISITION');
});

test('routing metadata distinguishes list, decisions, document reads and desktop saves', async () => {
  assert.equal(securityAuditAction({ pathname: '/api/finance-workflow', method: 'POST', body: { action: 'list' } }), 'LIST FINANCE WORKFLOW');
  assert.equal(securityAuditAction({ pathname: '/api/finance-workflow', method: 'POST', body: { action: 'review', recordType: 'bill', decision: 'Rejected' } }), 'REVIEW BILL — REQUESTED REJECTED');
  const prepared = await prepareSecurityAudit(new Request('https://example.test/api/staff-records?action=export&recordType=student&recordId=S1&token=secret&password=hidden'), '/api/staff-records');
  assert.equal(prepared.action, 'EXPORT STUDENT');
  assert.equal(prepared.entityId, 'S1');
  assert.doesNotMatch(JSON.stringify(prepared), /secret|hidden/);
  const desktop = await prepareSecurityAudit(new Request('https://example.test/api/backend', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Action: 'saveAccountingExpense', ExpenseNo: 'REQ-42', Status: 'Submitted', ApprovalPassword: 'secret' })
  }), '/api/backend');
  assert.equal(desktop.entityId, 'REQ-42');
  assert.equal(desktop.action, 'SAVE ACCOUNTING EXPENSE — REQUESTED SUBMITTED');
  assert.doesNotMatch(JSON.stringify(desktop), /secret/);
});
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

test('routine page loads and expired-session polling are write-free; changes and permission violations remain auditable', async () => {
  assert.equal(shouldPersistSecurityAudit({ method: 'GET' }, { username: 'admin' }), false);
  assert.equal(shouldPersistSecurityAudit({ method: 'POST' }, null), true);
  assert.equal(shouldPersistSecurityAudit({ method: 'GET' }, null), false);
  for (const [pathname, body] of [
    ['/api/admin', { mode: 'shell' }], ['/api/settings', {}],
    ['/api/security-audit', { action: 'list' }], ['/api/staff-attendance', { action: 'quick' }],
    ['/api/desktop-pairing', { action: 'list' }], ['/api/desktop-pairing', { action: 'status' }],
    ['/api/staff-notifications', { action: 'list' }], ['/api/backend', { Action: 'getStudents' }]
  ]) {
    const prepared = await prepareSecurityAudit(new Request(`https://example.test${pathname}`, {
      method: pathname === '/api/settings' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(pathname === '/api/settings' ? {} : { body: JSON.stringify(body) })
    }), pathname);
    assert.equal(shouldPersistSecurityAudit(prepared, { username: 'admin' }, 200), false, prepared.action);
    assert.equal(shouldPersistSecurityAudit(prepared, null, 401), false, prepared.action);
    assert.equal(shouldPersistSecurityAudit(prepared, { username: 'admin' }, 403), true, prepared.action);
    // A routine poll must return before attempting any session/database reads.
    assert.equal(await persistRequestSecurityAudit({ prepared, response: { status: 200 } }), null);
  }
  for (const action of ['SAVE SETTINGS', 'APPROVE BILL', 'REVOKE DESKTOP PAIRING', 'PRINT SECURITY AUDIT', 'EXPORT STUDENT']) {
    assert.equal(shouldPersistSecurityAudit({ method: 'POST', action }, { username: 'admin' }), true, action);
  }
  assert.equal(shouldPersistSecurityAudit({ method: 'GET', action: 'EXPORT STUDENT' }, { username: 'admin' }), true);
});

test('completed sign-ins use their existing authoritative audit; failed sign-ins remain recorded', () => {
  for (const [pathname, action] of [
    ['/api/staff-session', 'LOGIN'], ['/api/staff-session', 'SIGN IN'],
    ['/api/staff-passkey', 'AUTHENTICATION VERIFY'], ['/api/staff-mfa', 'VERIFY LOGIN']
  ]) {
    assert.equal(shouldPersistSecurityAudit({ method: 'POST', pathname, action }, null, 200), false);
    assert.equal(shouldPersistSecurityAudit({ method: 'POST', pathname, action }, null, 401), true);
  }
});

test('historical request noise is excluded without suppressing legacy records or permission violations', () => {
  const source = { collection: 'platformSecurityAudit' };
  for (const HttpStatus of [200, 401]) {
    assert.equal(securityAuditRowVisible(normalizedLegacyAudit({
      Method: 'POST', Route: '/api/desktop-pairing', Action: 'LIST DESKTOP PAIRING', HttpStatus
    }, source)), false);
  }
  assert.equal(securityAuditRowVisible(normalizedLegacyAudit({
    Method: 'POST', Route: '/api/desktop-pairing', Action: 'LIST DESKTOP PAIRING', HttpStatus: 403
  }, source)), true);
  assert.equal(securityAuditRowVisible(normalizedLegacyAudit({ Action: 'LOGIN' }, { collection: 'staffSecurityAudit' })), true);
  assert.equal(securityAuditRowVisible(normalizedLegacyAudit({ Action: 'APPROVE BILL', HttpStatus: 200 }, source)), true);
});

test('filtered print sends the print command, preserves filters, invokes printing and restores the page', async () => {
  const source = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const handlers = new Map();
  const printed = [];
  const requests = [];
  const classes = new Set();
  const rows = [{ Action: 'LOGIN' }];
  const context = vm.createContext({
    activeSection: 'securityAudit', panelEl: { querySelector: () => null }, dashboardStatus: {},
    securityAuditData: { rows, facets: {}, filters: { action: 'LOGIN', user: 'ada' }, fromDate: '2026-10-01', toDate: '2026-10-03' },
    clean: (value) => String(value ?? '').trim(), escapeHtml: (value) => String(value ?? ''),
    securityAuditFilteredRows: () => rows, securityAuditRowsHtml: () => '<tr><td>LOGIN</td></tr>',
    renderModuleSummary() {}, setButtonLoading() {}, setStatus() {},
    updateSecurityAuditTable() {},
    staffFetch: async (_url, init) => { requests.push(JSON.parse(init.body)); return { status: 200, ok: true, json: async () => ({ ok: true }) }; },
    document: {
      querySelector: () => ({ textContent: 'Dynamax' }),
      getElementById: (id) => id === 'securityAuditFilters' ? null : { addEventListener: (event, handler) => handlers.set(`${id}:${event}`, handler) },
      body: { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } }
    },
    window: {
      addEventListener: (event, handler) => handlers.set(`window:${event}`, handler),
      removeEventListener: (event) => handlers.delete(`window:${event}`),
      print: () => printed.push(classes.has('security-audit-print'))
    }
  });
  vm.runInContext(source.slice(source.indexOf('async function securityAuditRequest('), source.indexOf('function securityAuditDefaultDate(')), context);
  vm.runInContext(source.slice(source.indexOf('function renderSecurityAudit('), source.indexOf('async function loadSecurityAudit(')), context);
  vm.runInContext('renderSecurityAudit()', context);
  await handlers.get('printSecurityAudit:click')({ currentTarget: { isConnected: true } });
  assert.deepEqual(requests[0], { action: 'print', user: 'ada', actionFilter: 'LOGIN', fromDate: '2026-10-01', toDate: '2026-10-03' });
  assert.deepEqual(printed, [true]);
  handlers.get('window:afterprint')();
  assert.equal(classes.size, 0);
  context.window.print = () => { throw new Error('Print unavailable'); };
  await handlers.get('printSecurityAudit:click')({ currentTarget: { isConnected: true } });
  assert.equal(classes.size, 0);
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
