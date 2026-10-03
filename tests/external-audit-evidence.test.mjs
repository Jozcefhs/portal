import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  AUDIT_REGISTERS, auditError, auditCollection, auditRecordProjection, auditRecordVisible,
  auditRegisterCursor, buildAuditPeriodReports
} from '../functions/lib/external-audit-evidence.js';
import { externalAuditDate, externalAuditNextDate } from '../functions/lib/external-audit.js';
import { recordBranchId } from '../functions/lib/branch-scope.js';
import { churchCollectionPath } from '../functions/lib/church-foundation.js';
import { auditRecordsCsv, auditRegisterPreviewHtml, previewAuditRegister } from '../js/external-audit-workspace.js';

const scope = { branchId: 'west', dateFrom: '2026-09-01', dateTo: '2026-09-30' };
const source = await readFile(new URL('../functions/lib/external-audit-evidence.js', import.meta.url), 'utf8');
const documentSource = await readFile(new URL('../functions/api/external-audit-document.js', import.meta.url), 'utf8');
function isolatedModule(source, exports, mocks) {
  return vm.runInNewContext(`${source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '')}\n;({${exports.join(',')}})`, mocks);
}
function evidenceModule(mocks = {}) {
  return isolatedModule(source, ['listAuditRecords', 'getAuditRecord', 'exportAuditRegister', 'loadAuditPeriodReports', 'auditRecordEvidence'], {
    externalAuditDate, externalAuditNextDate, recordBranchId, churchCollectionPath,
    getDocument: async () => null, queryCollection: async () => [], queryCollectionPages: async () => [], ...mocks
  });
}
const journal = (date, debit, credit, amount, extra = {}) => ({
  JournalNo: `J-${date}`, Date: date, Status: 'Posted', BranchId: 'west',
  Lines: [{ AccountCode: debit, Debit: amount, Credit: 0 }, { AccountCode: credit, Debit: 0, Credit: amount }], ...extra
});

test('period statements include earlier opening journals, period movements and accumulated earnings', () => {
  const chart = [
    { Code: '1000', Name: 'Cash', Type: 'Asset' }, { Code: '3000', Name: 'Capital', Type: 'Equity' },
    { Code: '4000', Name: 'Income', Type: 'Revenue' }, { Code: '5000', Name: 'Costs', Type: 'Expense' }
  ];
  const report = buildAuditPeriodReports(chart, [
    journal('2026-08-01', '1000', '3000', 1000), journal('2026-08-05', '1000', '4000', 50),
    journal('2026-09-01', '1000', '4000', 250.25), journal('2026-09-30', '5000', '1000', 100.10),
    journal('2026-10-01', '1000', '4000', 800), journal('2026-09-01', '1000', '4000', 900, { BranchId: 'east' }),
    journal('2026-09-01', '1000', '4000', 700, { Status: 'Draft' })
  ], scope);
  const cash = report.trialBalance.find(row => row.code === '1000');
  assert.deepEqual([cash.opening, cash.debit, cash.credit, cash.closing], [1050, 250.25, 100.1, 1200.15]);
  assert.equal(report.postedJournals, 2);
  assert.equal(report.totals.income, 250.25);
  assert.equal(report.totals.expenditure, 100.1);
  assert.equal(report.totals.surplus, 150.15);
  assert.equal(report.totals.unclosedEarnings, 200.15);
  assert.equal(report.totals.balanceSheetDifference, 0);
  assert.equal(report.totals.closing, 0);
  assert.equal(report.complete, true);
});

test('reports fail for corrupt posted lines and flag missing classifications and imbalance', () => {
  for (const Lines of [null, 'invalid json', [], [{ Debit: 1 }], [{ AccountCode: '1000', Debit: 'wrong' }]]) {
    assert.throws(() => buildAuditPeriodReports([], [journal('2026-09-01', '1000', '3000', 1, { Lines })], scope), error => error.status === 409);
  }
  const report = buildAuditPeriodReports([], [journal('2026-09-01', '1000', '4000', 10, { Lines: [{ AccountCode: '1000', Debit: 10, Credit: 0 }] })], scope);
  assert.match(report.warnings.join(' '), /missing from the chart/);
  assert.match(report.warnings.join(' '), /does not balance/);
  assert.equal(report.totals.closing, 10);
});

test('receipt projection preserves a single total, all fee allocations and no credentials or storage URLs', () => {
  const record = auditRecordProjection({
    __id: 'PAY-1', Date: '2026-09-03', Reference: 'PAY-1', BranchId: 'west', Amount: 1000, GrossAmount: 1000,
    FeeItems: JSON.stringify([{ feeCode: 'TUITION', feeName: 'Tuition', amount: 700 }, { feeCode: 'BOOK', amount: 300 }]),
    ReceiptUrl: 'r2://dynamax-documents/private/key', Password: 'secret', Token: 'secret', Metadata: 'gateway raw secret'
  }, 'payments');
  assert.equal(record.reference, 'PAY-1');
  assert.equal(record.fields.GrossAmount, 1000);
  assert.deepEqual(record.fields.FeeItems.map(item => item.Amount), [700, 300]);
  assert.equal(record.attachments[0].available, true);
  assert.doesNotMatch(JSON.stringify(record), /secret|private\/key/);
  assert.throws(() => auditRecordProjection({ Lines: Array.from({ length: 1001 }, () => ({})) }, 'journals'), error => error.status === 413);
});

test('every finance register respects branch and period boundaries, and masters are explicitly current snapshots', () => {
  const payment = { Date: '2026-09-30T23:59:59Z', BranchId: 'west' };
  assert.equal(auditRecordVisible(payment, AUDIT_REGISTERS.payments, scope), true);
  assert.equal(auditRecordVisible({ ...payment, Date: '2026-10-01' }, AUDIT_REGISTERS.payments, scope), false);
  assert.equal(auditRecordVisible({ ...payment, BranchId: 'east' }, AUDIT_REGISTERS.payments, scope), false);
  assert.equal(auditRecordVisible({ BranchId: 'west' }, AUDIT_REGISTERS.payments, scope), false);
  assert.equal(auditRecordProjection({ BranchId: 'west' }, 'assets').snapshot, true);
  assert.equal(auditRecordVisible({ BranchId: 'east' }, AUDIT_REGISTERS.assets, scope), false);
  assert.throws(() => auditCollection('donations', { ...scope, branchId: 'all' }), /working branch/);
  assert.throws(() => auditCollection('staffUsers', scope), /valid audit register/);
  assert.throws(() => auditCollection('constructor', scope), /valid audit register/);
  assert.throws(() => auditCollection('__proto__', scope), /valid audit register/);
});

test('register cursors cannot switch collection, project or nested record path', () => {
  const env = { FIREBASE_PROJECT_ID: 'p' };
  const name = 'projects/p/databases/(default)/documents/payments/P1';
  assert.deepEqual(auditRegisterCursor(env, { name }, 'payments'), { name });
  for (const bad of [name.replace('/p/', '/other/'), name.replace('/payments/', '/staffUsers/'), `${name}/private/X`]) {
    assert.throws(() => auditRegisterCursor(env, { name: bad }, 'payments'), /invalid/);
  }
});

test('pagination continues past a page containing only out-of-scope records without leaking them', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({ __id: `P${i}`, __name: `projects/p/databases/(default)/documents/payments/P${i}`, BranchId: 'east', Date: '2026-09-01' }));
  let options;
  const { listAuditRecords } = evidenceModule({ queryCollection: async (_env, _collection, input) => { options = input; return rows; } });
  const result = await listAuditRecords({ FIREBASE_PROJECT_ID: 'p' }, scope, { register: 'payments' });
  assert.equal(options.limit, 101);
  assert.equal(result.records.length, 0);
  assert.equal(result.scanned, 100);
  assert.equal(result.nextCursor.name, rows[99].__name);
});

test('complete register exports and reports use a consistent database snapshot and never replace limit errors with partial totals', async () => {
  const calls = [];
  const { exportAuditRegister, loadAuditPeriodReports } = evidenceModule({ queryCollectionPages: async (_env, name, options) => { calls.push({ name, options }); return []; } });
  const exported = await exportAuditRegister({}, scope, 'payments');
  assert.equal(exported.complete, true);
  assert.equal(calls[0].options.maxRows, 10000);
  const report = await loadAuditPeriodReports({}, scope);
  assert.equal(calls[1].options.readTime, calls[2].options.readTime);
  assert.equal(report.readTime, calls[2].options.readTime);
  assert.equal(calls[2].options.filters[0].value, '2026-10-01');
  assert.equal(calls[2].options.filters.length, 1, 'do not exclude journals needed for opening balances');
  const limited = evidenceModule({ queryCollectionPages: async () => { const error = new Error('too large; no partial totals'); error.status = 413; throw error; } });
  await assert.rejects(() => limited.loadAuditPeriodReports({}, scope), error => error.status === 413);
});

test('payroll item parent dates remain separated when different branches share a run reference', async () => {
  const rows = [{ __id: 'I1', RunId: 'RUN1', BranchId: 'west' }, { __id: 'I2', RunId: 'RUN1', BranchId: 'east' }];
  const { exportAuditRegister } = evidenceModule({ queryCollectionPages: async () => rows,
    queryCollection: async () => [{ RunId: 'RUN1', BranchId: 'west', PayDate: '2026-09-02' }, { RunId: 'RUN1', BranchId: 'east', PayDate: '2026-10-02' }] });
  const exported = await exportAuditRegister({}, { ...scope, branchId: 'all' }, 'payrollItems');
  assert.equal(exported.records.length, 1);
  assert.equal(exported.records[0].branchId, 'west');
});

test('evidence lookup refuses an out-of-scope parent before querying related records', async () => {
  let lookups = 0;
  const { auditRecordEvidence } = evidenceModule({ getDocument: async () => ({ Date: '2026-09-01', BranchId: 'east' }), queryCollection: async () => { lookups++; return []; } });
  await assert.rejects(() => auditRecordEvidence({}, scope, 'payments', 'P1'), error => error.status === 404);
  assert.equal(lookups, 0);
});

function documentModule(mocks = {}) {
  return isolatedModule(documentSource, ['onRequestGet', 'onRequestPost'], {
    Response, URL, recordBranchId, auditError, requireFirestoreEnv: () => {}, requireStaffSession: async () => ({ role: 'External Auditor' }),
    authorizedScope: () => scope, logAccess: async () => {},
    ...mocks
  });
}
test('external auditors cannot upload evidence, even before reading or storing request contents', async () => {
  let reads = 0;
  const { onRequestPost } = documentModule({ readJsonBody: () => { reads++; } });
  const response = await onRequestPost({ env: {}, request: {} });
  assert.equal(response.status, 403);
  assert.equal(reads, 0);
});

test('document download resolves the authorised parent reference, not a caller URL, and checks storage branch metadata', async () => {
  const references = [];
  const mocks = {
    getAuditRecord: async () => ({ BranchId: 'west', DocumentUrl: 'r2://authorised-reference' }),
    auditAttachments: row => [{ label: 'Invoice', reference: row.DocumentUrl }],
    getStoredDocument: async (_env, ref) => { references.push(ref); return { object: { customMetadata: { branchId: 'west' } } }; },
    storedDocumentResponse: () => new Response('file')
  };
  const request = new Request('https://example/api/external-audit-document?register=evidence&recordId=E1&attachment=0&url=https://attacker/private');
  const context = { env: {}, request, data: {} };
  assert.equal((await documentModule(mocks).onRequestGet(context)).status, 200);
  assert.deepEqual(references, ['r2://authorised-reference']);
  assert.equal(context.data.securityAuditHandled, true);
  const foreign = documentModule({ ...mocks, getStoredDocument: async () => ({ object: { customMetadata: { branchId: 'east' } } }) });
  assert.equal((await foreign.onRequestGet(context)).status, 404);
});

test('receipt preview is complete, escaped, printable and retains one row per original payment', async () => {
  const record = auditRecordProjection({ __id: 'P1', Date: '2026-09-01', Reference: 'P1', Description: '<script>bad</script>', BranchId: 'west', GrossAmount: 1000,
    FeeItems: [{ Amount: 700 }, { Amount: 300 }] }, 'payments');
  const html = auditRegisterPreviewHtml([record], scope, 'Payments');
  assert.equal((html.match(/<strong>P1<\/strong>|<td>P1<\/td>/g) || []).length, 1);
  assert.match(html, /1,000\.00/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>bad/);
  assert.match(html, /Print \/ save as PDF/);
  assert.match(html, /Amount: 700/);
  assert.match(auditRecordsCsv([{ ...record, fields: { Description: '=HYPERLINK("bad")' } }]), /'=/);
  const events = [];
  let preparePrint;
  const details = [{ open: false }, { open: false }];
  const popup = { closed: false, addEventListener: (event, callback) => { if (event === 'beforeprint') preparePrint = callback; },
    document: { write: value => events.push(value), open: () => {}, close: () => {}, querySelectorAll: () => details } };
  globalThis.window = { open: () => { events.push('opened'); return popup; } };
  try {
    await previewAuditRegister(async (action, payload) => { events.push('request'); assert.equal(action, 'exportRegister'); assert.equal(payload.register, 'payments'); return { records: [record] }; }, scope, 'payments');
    assert.equal(events[0], 'opened');
    assert.equal(popup.opener, null);
    assert.ok(events.indexOf('request') > events.indexOf('opened'));
    preparePrint();
    assert.ok(details.every(item => item.open), 'all receipt allocations and source lines must be expanded for printing');
  } finally { delete globalThis.window; }
});
