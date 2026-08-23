import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  academicManagementCapabilities,
  academicMigrationReadiness,
  normalizeAcademicResultClearance
} from '../functions/lib/academic-management.js';

const [managementSource, adminSource, middlewareSource, parentSource, policyStoreSource, backendSource, headers] = await Promise.all([
  readFile(new URL('../functions/lib/academic-management.js', import.meta.url), 'utf8'),
  readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/_middleware.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/lib/academic-policy-store.js', import.meta.url), 'utf8'),
  readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
  readFile(new URL('../_headers', import.meta.url), 'utf8')
]);

test('AM-001 finance officers receive clearance permission without score permissions', () => {
  for (const role of ['Accounts Officer', 'Finance Officer']) {
    const permissions = academicManagementCapabilities({
      role, edition: 'school', allowedSections: ['academics']
    });
    assert.equal(permissions.enabled, true);
    assert.equal(permissions.financeView, true);
    assert.equal(permissions.canManageFinancialClearance, true);
    assert.equal(permissions.canEnterScores, false);
    assert.equal(permissions.canReviewScores, false);
    assert.equal(permissions.canPublishResults, false);
  }
});

test('AM-001 clearance records are period scoped, expiring and auditable', () => {
  const record = normalizeAcademicResultClearance({
    SessionId: 'session-2026', TermId: 'term-1', StudentRef: 'DCA/21/0001',
    AcademicSession: '2026/2027', Term: 'First Term', ExpiryDate: '2026-12-31',
    Reason: 'Approved payment arrangement', Status: 'Approved'
  }, { branchId: 'main', section: 'secondary' });
  assert.equal(record.BranchId, 'main');
  assert.equal(record.SchoolSection, 'secondary');
  assert.equal(record.ExpiresAt, '2026-12-31T23:59:59.999Z');
  assert.match(record.ClearanceId, /^clearance__main__secondary__/);
  assert.match(managementSource, /grantAcademicResultClearance/);
  assert.match(managementSource, /revokeAcademicResultClearance/);
  assert.match(managementSource, /ACADEMIC_CLEARANCE_POLICY_FORBIDDEN/);
  assert.match(managementSource, /canManageFinancialClearance/);
});

test('AM-002 migration readiness blocks orphan and duplicate academic data without changing it', () => {
  const state = {
    sessions: [{ SessionId: 'S1' }], terms: [{ TermId: 'T1', SessionId: 'S1' }],
    classes: [{ ClassId: 'C1', SchoolStage: 'senior-secondary' }],
    arms: [{ ArmId: 'A1', ClassId: 'C1' }], subjects: [{ SubjectId: 'MTH' }],
    departments: [{ DepartmentId: 'SCI', CoreSubjectIds: ['MTH'] }], offerings: [],
    studentMemberships: [
      { MembershipId: 'M1', BranchId: 'main', SchoolSection: 'secondary', SessionId: 'S1', TermId: 'T1', StudentRef: 'DCA/1', ClassId: 'C1', ArmId: 'A1', DepartmentId: 'SCI', TradeSubjectIds: [], Status: 'Active' },
      { MembershipId: 'M2', BranchId: 'main', SchoolSection: 'secondary', SessionId: 'S1', TermId: 'T1', StudentRef: 'DCA/1', ClassId: 'C1', ArmId: 'A1', DepartmentId: 'SCI', TradeSubjectIds: [], Status: 'Active' }
    ]
  };
  const report = academicMigrationReadiness(state, [{ AdmissionNo: 'DCA/1' }]);
  assert.equal(report.Status, 'Blocked');
  assert.ok(report.Issues.some((issue) => issue.Code === 'DUPLICATE_CURRENT_MEMBERSHIP'));
  assert.ok(report.Issues.some((issue) => issue.Code === 'PENDING_TRADE_SUBJECT'));
  assert.equal(state.studentMemberships.length, 2);
});

test('Milestone 11 web UI exposes finance clearance and migration readiness workspaces', () => {
  assert.match(adminSource, /Result clearances/);
  assert.match(adminSource, /data-academic-finance-clearance/);
  assert.match(adminSource, /grantAcademicResultClearance/);
  assert.match(adminSource, /revokeAcademicResultClearance/);
  assert.match(adminSource, /Academic Migration Readiness/);
  assert.match(adminSource, /data\.permissions\?\.financeView/);
});

test('Milestone 11 removes insecure random identifiers and applies response hardening', () => {
  [managementSource, parentSource, policyStoreSource, backendSource].forEach((source) => {
    assert.doesNotMatch(source, /Math\.random\(/);
  });
  assert.match(headers, /X-Frame-Options: DENY/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /Permissions-Policy: camera=\(self\), microphone=\(\), geolocation=\(self\)/);
  assert.match(middlewareSource, /Permissions-Policy', 'camera=\(self\), microphone=\(\), geolocation=\(self\)'/);
  assert.match(middlewareSource, /responseHeaders\.set\('X-Frame-Options', 'DENY'\)/);
  assert.match(middlewareSource, /responseHeaders\.set\('Referrer-Policy', 'no-referrer'\)/);
});
