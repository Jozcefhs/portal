import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
  externalAuditAccessExpired,
  externalAuditCursor,
  externalAuditDate,
  externalAuditFindingCursor,
  externalAuditJournal,
  externalAuditNextDate,
  externalAuditScope,
  normalizeExternalAuditGrant
} from '../functions/lib/external-audit.js';
import { resolveAuthoritativeDesktopActor } from '../functions/lib/backend-security.js';
import { featureFlagsForEdition } from '../functions/lib/organization-config.js';
import { allowedSectionsFor, staffUserForAccess } from '../functions/lib/staff-auth.js';
import { evaluateStaffMfaRequirement } from '../functions/lib/staff-mfa.js';

const api = await readFile(new URL('../functions/api/external-audit.js', import.meta.url), 'utf8');
const dashboardApi = await readFile(new URL('../functions/api/admin.js', import.meta.url), 'utf8');
const adminJs = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');

const auditor = {
  role: 'External Auditor', username: 'audit.one', branchId: 'west',
  auditDateFrom: '2026-01-01', auditDateTo: '2026-12-31', auditExpiresAt: '2027-01-15'
};

test('external auditor is a distinct audit-only role in every edition', () => {
  for (const edition of ['school', 'faith', 'organization']) {
    const access = allowedSectionsFor({
      ...auditor, TabAccess: ['accounts', 'incomeAnalytics', 'staffUsers', 'payroll', 'externalAudit']
    }, featureFlagsForEdition(edition), { edition, roleModules: ['accounts', 'staffUsers'] });
    assert.deepEqual(access, ['externalAudit']);
    const hydrated = staffUserForAccess({
      ...auditor, approvalEnabled: true, requisitionEditEnabled: true,
      approvalMaxAmount: 1000000, approvalAccounts: ['1000'],
      biometricLookupEnabled: true, tabAccess: ['accounts', 'staffUsers']
    }, { edition, allowedSections: access, featureFlags: featureFlagsForEdition(edition) });
    assert.equal(hydrated.approvalEnabled, false);
    assert.equal(hydrated.requisitionEditEnabled, false);
    assert.equal(hydrated.approvalMaxAmount, 0);
    assert.deepEqual(hydrated.approvalAccounts, []);
    assert.equal(hydrated.biometricLookupEnabled, false);
    assert.deepEqual(hydrated.tabAccess, []);
  }
});

test('audit grant rejects invalid dates and is inclusive through its expiry day', () => {
  assert.equal(externalAuditDate('2026-02-30'), '');
  assert.equal(externalAuditNextDate('2026-12-31'), '2027-01-01');
  assert.deepEqual(normalizeExternalAuditGrant({
    AuditDateFrom: '2026-01-01', AuditDateTo: '2026-12-31', AuditExpiresAt: '2027-01-15'
  }, '2026-10-02'), {
    AuditDateFrom: '2026-01-01', AuditDateTo: '2026-12-31', AuditExpiresAt: '2027-01-15'
  });
  assert.throws(() => normalizeExternalAuditGrant({
    AuditDateFrom: '2026-12-31', AuditDateTo: '2026-01-01', AuditExpiresAt: '2027-01-15'
  }, '2026-10-02'), /start date/);
  assert.equal(externalAuditAccessExpired(auditor, '2027-01-15'), false);
  assert.equal(externalAuditAccessExpired(auditor, '2027-01-16'), true);
});

test('auditor scope is bound to assigned dates and server branch', () => {
  assert.deepEqual(externalAuditScope(auditor, {
    dateFrom: '2026-03-01', dateTo: '2026-04-30', branchId: 'west'
  }, '2026-10-02'), {
    dateFrom: '2026-03-01', dateTo: '2026-04-30', branchId: 'west',
    auditDateFrom: '2026-01-01', auditDateTo: '2026-12-31', auditExpiresAt: '2027-01-15'
  });
  assert.throws(() => externalAuditScope(auditor, { dateFrom: '2025-12-31' }, '2026-10-02'), /outside/);
  assert.throws(() => externalAuditScope(auditor, { dateTo: '2027-01-01' }, '2026-10-02'), /outside/);
  assert.throws(() => externalAuditScope(auditor, { branchId: 'east' }, '2026-10-02'), /Switch branch/);
  assert.throws(() => externalAuditScope(auditor, {}, '2027-01-16'), /expired/);
});

test('journal cursor and public projection reject unrelated data', () => {
  const env = { FIREBASE_PROJECT_ID: 'example' };
  assert.deepEqual(externalAuditCursor(env, {
    date: '2026-10-01', name: 'projects/example/databases/(default)/documents/accountingJournals/JRN-1'
  }), {
    date: '2026-10-01', name: 'projects/example/databases/(default)/documents/accountingJournals/JRN-1'
  });
  assert.throws(() => externalAuditCursor(env, {
    date: '2026-10-01', name: 'projects/other/databases/(default)/documents/accountingJournals/JRN-1'
  }), /invalid/);
  assert.deepEqual(externalAuditFindingCursor(env, {
    name: 'projects/example/databases/(default)/documents/financialAuditFindings/FIN-AUD-1'
  }), {
    date: '', name: 'projects/example/databases/(default)/documents/financialAuditFindings/FIN-AUD-1'
  });
  const record = externalAuditJournal({
    JournalNo: 'JRN-1', Date: '2026-10-01', Source: 'Payment', BranchId: 'west',
    TotalDebit: 100, TotalCredit: 100, Secret: 'not for export',
    Lines: [{ AccountCode: '1000', Debit: 100, Credit: 0, PrivateNote: 'hidden' }]
  });
  assert.equal(record.SourceType, 'Payment');
  assert.equal(record.Secret, undefined);
  assert.equal(record.Lines[0].PrivateNote, undefined);
});

test('auditor MFA and desktop separation cannot be disabled by ordinary policy', () => {
  assert.deepEqual(evaluateStaffMfaRequirement({ Mode: 'DISABLED' }, {}, 0, auditor, Date.parse('2026-10-02')), {
    required: true, enrollmentRequired: true, hasFactor: false, dueAt: '', policyRequired: true
  });
  assert.throws(() => resolveAuthoritativeDesktopActor(
    { UserUsername: 'audit.one' }, [{ Username: 'audit.one', Role: 'External Auditor', Active: true }], {}
  ), (error) => error.status === 403 && error.code === 'BACKEND_AUDITOR_WEB_ONLY');
});

test('journal register scans a bounded page, filters branches, and never reports partial totals', async () => {
  const source = api.slice(api.indexOf('async function listJournals('), api.indexOf('async function listFindings('));
  const requested = [];
  const rows = Array.from({ length: 101 }, (_, index) => ({
    JournalNo: `JRN-${index}`, Date: '2026-10-01',
    BranchId: index === 0 ? 'east' : 'west',
    __name: `projects/example/databases/(default)/documents/accountingJournals/JRN-${index}`
  }));
  const list = vm.runInNewContext(`(${source})`, {
    PAGE_SIZE: 100, clean: value => String(value ?? '').trim(),
    externalAuditCursor: () => null, externalAuditNextDate,
    queryCollection: async (_env, _collection, options) => { requested.push(options); return rows; },
    logAccess: async () => {},
    visibleInBranch: (row, branch) => row.BranchId === branch,
    externalAuditJournal
  });
  const result = await list({}, auditor, {}, externalAuditScope(auditor, {}, '2026-10-02'));
  assert.equal(requested[0].limit, 101);
  assert.equal(result.pageSize, 100);
  assert.equal(result.journals.length, 99);
  assert.equal(result.journals[0].JournalNo, 'JRN-1');
  assert.equal(result.nextCursor.name, rows[99].__name);
  assert.equal('total' in result, false);
});

test('findings register can page beyond the first hundred records', async () => {
  const source = api.slice(api.indexOf('async function listFindings('), api.indexOf('async function createFinding('));
  const requested = [];
  const rows = Array.from({ length: 101 }, (_, index) => ({
    FindingId: `FIN-AUD-${index}`, AuditorUsernameKey: 'audit.one',
    BranchId: index === 0 ? 'east' : 'west',
    AuditDateFrom: '2026-01-01', AuditDateTo: '2026-12-31',
    CreatedAt: '2026-10-02T00:00:00Z',
    __name: `projects/example/databases/(default)/documents/financialAuditFindings/FIN-AUD-${index}`
  }));
  const list = vm.runInNewContext(`(${source})`, {
    PAGE_SIZE: 100, clean: value => String(value ?? '').trim(),
    lower: value => String(value ?? '').trim().toLowerCase(),
    EXTERNAL_AUDITOR_ROLE: 'External Auditor',
    externalAuditFindingCursor: () => null,
    queryCollection: async (_env, _collection, options) => { requested.push(options); return rows; },
    logAccess: async () => {},
    visibleInBranch: (row, branch) => row.BranchId === branch,
    publicFinding: row => ({ FindingId: row.FindingId, CreatedAt: row.CreatedAt })
  });
  const result = await list({}, auditor, {}, externalAuditScope(auditor, {}, '2026-10-02'));
  assert.equal(requested[0].limit, 101);
  assert.equal(requested[0].filters[0].value, 'audit.one');
  assert.equal(result.pageSize, 100);
  assert.equal(result.findings.length, 99);
  assert.equal(result.nextCursor.name, rows[99].__name);
});

test('financial audit route is bounded, read-only to finance, and management response is separate', () => {
  assert.match(api, /const PAGE_SIZE = 100/);
  assert.match(api, /queryCollection\(env, 'accountingJournals'/);
  assert.match(api, /limit: PAGE_SIZE \+ 1/);
  assert.match(api, /financialAuditFindings/);
  assert.match(api, /startAfterName: cursor\.name/);
  assert.match(api, /FINANCIAL AUDIT EXPORT/);
  assert.doesNotMatch(api, /upsertDocument\(env, 'accountingJournals'/);
  assert.match(dashboardApi, /user\.role === 'External Auditor' && !shellOnly/);
  assert.match(adminJs, /Download this page CSV/);
  assert.match(adminJs, /currentUser\?\.role === 'External Auditor'/);
});
