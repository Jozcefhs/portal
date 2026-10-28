import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { prepareSecurityAudit, shouldPersistSecurityAudit, persistRequestSecurityAudit,
  normalizedLegacyAudit, securityAuditRowVisible } from '../functions/lib/security-audit.js';
import { auditWords, auditSentence, auditNarrative, auditActionContext } from '../functions/lib/audit-language.js';
import { reviewAllStudentBilling } from '../js/student-maintenance.js';

const prepared = async (path, body) => prepareSecurityAudit(new Request(`https://example.test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}), path);
const previews = [
  ...['previewAll', 'previewBatch', 'preview', 'previewReversalsAll', 'previewReversal',
    'obsoleteRoster', 'obsoleteBatch', 'previewObsoleteReversal'].map(action => ['/api/student-billing-reconciliation', { action }]),
  ['/api/student-billing-preview', { AccountRef: 'TEST/001' }],
  ...['previewProfileDefaults', 'previewIntakeCorrection'].map(action => ['/api/staff-students', { action }]),
  ['/api/staff-payment-corrections', { action: 'preview', Kind: 'reduce' }],
  ['/api/backend', { Action: 'manualPaymentCorrection', Command: 'preview', Kind: 'reverse' }],
  ...['previewAcademicTimetableGeneration', 'previewAcademicTimetableCopy', 'previewTimetableCopy',
    'previewAcademicScoreImport', 'previewScoreSheetImport', 'previewAcademicTermResultWithdrawal',
    'previewTermResultWithdrawal', 'previewAcademicCbtRoster', 'previewAcademicCbtRosterAdditions',
    'previewAcademicCbtLateEntry'].flatMap(action => [
    ['/api/staff-academics', { action }], ['/api/backend', { Action: action }]
  ])
];

test('reviewed preview commands skip successful audit writes across editions and clients; failed or unconfirmed attempts remain', async () => {
  for (const edition of ['school', 'faith', 'organization']) {
    for (const [path, body] of previews) {
      const input = await prepared(path, body);
      for (const status of [200, 202, 206, 400, 401, 403, 409, 500]) {
        assert.equal(shouldPersistSecurityAudit(input, { edition }, status), status !== 200, `${edition}: ${input.action}, ${status}`);
      }
      // No env/session is supplied: this must return before any actor/database access.
      assert.equal(await persistRequestSecurityAudit({ prepared: input, response: { status: 200 } }), null);
    }
  }
});

test('unknown previews, exports, actual saves and client replay claims cannot silence their audit', async () => {
  for (const [path, body] of [
    ['/api/student-billing-reconciliation', { action: 'apply' }],
    ['/api/student-billing-reconciliation', { action: 'applyReversal' }],
    ['/api/student-billing-reconciliation', { action: 'applyObsoleteReversal' }],
    ['/api/staff-students', { action: 'applyProfileDefaults' }],
    ['/api/staff-students', { action: 'applyIntakeCorrection' }],
    ['/api/staff-academics', { action: 'saveAcademicTimetableGeneration' }],
    ['/api/staff-academics', { action: 'importAcademicScores' }],
    ['/api/staff-academics', { action: 'refreshAcademicCbtRoster' }],
    ['/api/staff-academics', { action: 'createAcademicCbtLateEntry' }],
    ['/api/unknown-module', { action: 'previewBatch' }],
    ['/api/data-backup', { action: 'preview-reset' }],
    ['/api/staff-departments', { action: 'previewclinicreferral' }],
    ['/api/staff-students', { action: 'export' }],
    ['/api/backend', { Action: 'payPayrollItem', replayed: true, securityAuditHandled: true }]
  ]) assert.equal(shouldPersistSecurityAudit(await prepared(path, body), null, 200), true, `${path} ${JSON.stringify(body)}`);
});

test('duplicate-score comparison is a quiet read, but resolution keeps its security audit', async()=>{
  assert.equal(shouldPersistSecurityAudit(await prepared('/api/staff-academics',{action:'getAcademicDuplicateScoreReview'}),null,200),false);
  assert.equal(shouldPersistSecurityAudit(await prepared('/api/staff-academics',{action:'resolveAcademicDuplicateScore'}),null,200),true);
});

test('one complete multi-batch billing review still checks every student without audit writes or actor lookups', async () => {
  const profiles = Array.from({ length: 23 }, (_, i) => ({ AccountRef: `TEST/${i}`, revision: 'one' }));
  let batches = 0, students = 0;
  const report = await reviewAllStudentBilling(async (path, body) => {
    const input = await prepared(path, body);
    assert.equal(await persistRequestSecurityAudit({ prepared: input, response: { status: 200 } }), null);
    if (body.action === 'previewAll') return { pendingProfiles: profiles, rows: [], total: 23, incomplete: 0, matched: 0 };
    batches += 1; students += body.Profiles.length;
    return { rows: [], checked: body.Profiles.length, matched: body.Profiles.length };
  });
  assert.equal(batches, 3); assert.equal(students, 23); assert.equal(report.matched, 23);
});

test('historical preview batches remain intact and available under the routine toggle; failures and changes stay visible', async () => {
  const source = { collection: 'platformSecurityAudit' };
  const original = { AuditId: 'old', Action: 'Preview batch', Method: 'POST', Route: '/api/student-billing-reconciliation',
    HttpStatus: 200, Outcome: 'Success', Actor: 'Officer', BranchId: 'main' };
  const snapshot = structuredClone(original);
  const rows = [original, { ...original, AuditId: 'failed', HttpStatus: 500, Outcome: 'Failed' },
    { ...original, AuditId: 'denied', HttpStatus: 403, Outcome: 'Denied' },
    { ...original, AuditId: 'unconfirmed', HttpStatus: 202 },
    { ...original, AuditId: 'unknown', HttpStatus: 0 },
    { ...original, AuditId: 'save', Action: 'Apply reversal' },
    { ...original, AuditId: 'other', Route: '/api/unknown-module' }].map(row => normalizedLegacyAudit(row, source));
  assert.deepEqual(original, snapshot);
  assert.equal(rows[0].ActivityClass, 'Routine preview');
  assert.equal(normalizedLegacyAudit(rows[0], source).Summary, rows[0].Summary);
  for (const row of rows) assert.equal(securityAuditRowVisible(row), true);
  const client = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
  const context = vm.createContext({ securityAuditData: { rows, filters: {} },
    clean: v => String(v ?? '').trim(), lower: v => String(v ?? '').trim().toLowerCase() });
  vm.runInContext(client.slice(client.indexOf('function securityAuditFilteredRows('), client.indexOf('function securityAuditDateTime(')), context);
  assert.equal(vm.runInContext('securityAuditFilteredRows().length', context), 6);
  vm.runInContext('securityAuditData.filters.includeRoutineSystem = true', context);
  assert.equal(vm.runInContext('securityAuditFilteredRows().length', context), 7);
});

test('authoritative failures still write even when a route marked a request handled', async () => {
  const source = await readFile(new URL('../functions/lib/security-audit.js', import.meta.url), 'utf8');
  const written = [];
  const module = vm.runInNewContext(`${source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '')}\n;({persistRequestSecurityAudit})`, {
    Response, Request, crypto, auditWords, auditSentence, auditNarrative, auditActionContext,
    upsertDocument: async (_env, _path, _id, row) => written.push(row), readStaffSession: async () => null
  });
  await module.persistRequestSecurityAudit({
    env: { FIREBASE_PROJECT_ID: 'test', FIREBASE_CLIENT_EMAIL: 'test', FIREBASE_PRIVATE_KEY: 'test' },
    prepared: await prepared('/api/student-billing-reconciliation', { action: 'previewBatch' }),
    response: { status: 200 }, auditHandled: true, authoritativeOutcome: 'Failed'
  });
  assert.equal(written.length, 1); assert.equal(written[0].Outcome, 'Failed');
});
