import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { auditWords, auditNarrative, auditActionContext, paymentAuditSummary } from '../functions/lib/audit-language.js';
import { directTransferAudit, setDirectTransferAudit } from '../functions/lib/direct-transfer-audit.js';
import { securityAuditAction, normalizedLegacyAudit, prepareSecurityAudit } from '../functions/lib/security-audit.js';

test('plain-language action names cover non-financial modules and legacy naming styles', () => {
  for (const [route, action, expected] of [
    ['staff-hr', 'saveemployee', 'Save employee'], ['staff-hr', 'reviewleave', 'Review leave'],
    ['staff-academics', 'saveAcademicScorebook', 'Save academic scorebook'],
    ['staff-academics', 'saveacademictimetablegenerationrules', 'Save academic timetable generation rules'],
    ['staff-academics', 'calculateacademicmidtermresults', 'Calculate academic midterm results'],
    ['staff-academics', 'bulkassignacademicclassteachers', 'Bulk assign academic class teachers'],
    ['staff-services', 'savechurchserviceoccurrence', 'Save church service occurrence'],
    ['staff-library', 'RETURN_BOOK', 'Return book'], ['staff-attendance', 'saveattendancegroup', 'Save attendance group'],
    ['staff-departments', 'saveclinicvisit', 'Save clinic visit'],
    ['staff-hotel', 'checkIn', 'Check guest into hotel room'], ['staff-members', 'saveMember', 'Save member'],
    ['staff-users', 'save-role-access', 'Save role access'], ['data-backup', 'complete-restore', 'Complete restore']
  ]) {
    const label = securityAuditAction({ pathname: '/api/' + route, method: 'POST', body: { action } });
    assert.equal(label, expected);
    const row = normalizedLegacyAudit({ Action: action, Actor: 'Ada', EntityId: 'TEST-42', Outcome: 'Success' }, { collection: 'hrAudit' });
    assert.match(row.Summary, /Ada/); assert.match(row.Summary, /TEST-42/);
    assert.notEqual(row.Action, row.Action.toUpperCase());
  }
  assert.equal(auditWords('saveAcademicCbtScores'), 'save academic cbt scores');
});

test('receipt lookup and preview cannot masquerade as completed financial corrections', () => {
  for (const desktop of [false, true]) {
    const label = command => securityAuditAction({ pathname: desktop ? '/api/backend' : '/api/staff-payment-corrections', method: 'POST',
      body: desktop ? { Action: 'manualPaymentCorrection', Command: command, Kind: 'move' } : { action: command, Kind: 'move' } });
    assert.match(label('lookup'), /^Load manual payment receipt and current wallet balance$/);
    assert.match(label('preview'), /^Preview.*move credit to another student wallet/);
    assert.match(auditNarrative({ Action: label('preview'), Actor: 'Ada', Outcome: 'Success' }), /preview, not confirmation/);
  }
});

test('actual library, clinic and hotel commands describe what they do', () => {
  for (const [route, action, expected] of [
    ['staff-library', 'checkout', 'Issue library book to borrower'],
    ['staff-library', 'return', 'Record library book return'],
    ['staff-departments', 'saveclinicrecord', 'Save clinic visit and items dispensed'],
    ['staff-departments', 'sendmarketlist', 'Send supply order to supplier'],
    ['staff-hotel', 'checkout', 'Check guest out of hotel room']
  ]) assert.equal(securityAuditAction({ pathname: '/api/' + route, body: { action } }), expected);
});

test('all modules can explain recorded scope without copying sensitive request content', () => {
  const scope = auditActionContext({ ClassName: 'Grade 8', Term: 'First Term', AttendanceDate: '2026-10-14',
    GroupId: 'NURSES', Quantity: 0, Password: 'hidden', Notes: 'private complaint', Treatment: 'private prescription',
    ApprovalPassword: 'hidden', Signature: 'hidden', Media: 'hidden' });
  assert.equal(scope, 'Class: Grade 8; Term: First Term; Date: 2026-10-14; Attendance group: NURSES; Quantity: 0');
  const summary = auditNarrative({ Action: 'Save class attendance', Actor: 'Ada', Outcome: 'Success',
    SourceCollection: 'platformSecurityAudit', Module: 'Academic management', ActionContext: scope });
  assert.match(summary, /requested to save class attendance in Academic management/);
  assert.match(summary, /Class: Grade 8/); assert.match(summary, /Date: 2026-10-14/);
  assert.doesNotMatch(summary, /hidden|private/);
});

test('authoritative business events use natural past tense and include recorded details', () => {
  const row = normalizedLegacyAudit({ Action: 'CREATE EMPLOYEE', Actor: 'Ada', Reference: 'STAFF-42', Details: 'Procurement Officer' },
    { collection: 'hrAudit', module: 'Human Resources' });
  assert.equal(row.Summary, 'Ada created employee in Human Resources. Affected record: STAFF-42. Recorded detail: Procurement Officer.');
  const leave = normalizedLegacyAudit({ Action: 'APPROVED LEAVE', Actor: 'Ada', Reference: 'LEAVE-1', Details: 'Test Staff' },
    { collection: 'hrAudit', module: 'Human Resources' });
  assert.match(leave.Summary, /^Ada approved leave/);
});

test('audit outcomes never imply that denied, failed or unfinished requests completed', () => {
  const row = { Action: 'Save employee', Actor: 'Ada', EntityId: 'STAFF-1' };
  assert.match(auditNarrative({ ...row, Outcome: 'Denied' }), /denied permission/);
  assert.match(auditNarrative({ ...row, Outcome: 'Failed' }), /completion was not confirmed/);
  assert.match(auditNarrative({ ...row, HttpStatus: 202, Outcome: 'Success' }), /still in progress/);
});

const transfer = { Context: 'school-payment', Amount: 20000, Currency: 'NGN',
  Payload: { AccountRef: 'TEST/001', FeeCode: 'WALLET_TOPUP', FeeCategory: 'Wallet' },
  ProofDataUrl: 'secret-proof', BankReference: 'secret-bank-reference' };
const payment = { ...transfer.Payload, Amount: 20000, Currency: 'NGN' };

test('one approval produces distinct stage explanations, with a credit only at the recording stage', () => {
  const phases = ['reserve', 'record', 'delivery', 'complete'];
  const results = [{ completed: true }, { recorded: { payment } }, { email: { ok: true }, notification: { notification: {}, created: true } }, {}];
  const audits = phases.map((stage, i) => directTransferAudit(transfer, stage, results[i]));
  assert.equal(new Set(audits.map(row => row.action)).size, 4);
  assert.match(audits[1].summary, /20,000.00 credited to student TEST\/001's wallet through bank-transfer approval/);
  assert.match(audits[0].summary, /No payment or wallet credit was posted/);
  assert.match(audits[2].summary, /Parent notification: created/);
  assert.match(audits[3].summary, /earlier step/);
  assert.doesNotMatch(JSON.stringify(audits), /secret-proof|secret-bank-reference/);
  assert.equal(directTransferAudit(transfer, 'record').summary, '', 'no success narrative before payment returns');
  assert.match(directTransferAudit(transfer, 'record', { recorded: { payment, duplicate: true } }).summary, /not a second receipt/);
  const context = {}; setDirectTransferAudit(context, { username: 'accounts' }, transfer, 'record', results[1]);
  assert.equal(context.data.securityAuditSummary, audits[1].summary);
});

test('receipt delivery does not claim that an email was sent when delivery failed or was skipped', () => {
  const row = directTransferAudit(transfer, 'delivery', { email: { skipped: true }, notification: { ok: false } });
  assert.match(row.summary, /email: skipped/); assert.match(row.summary, /notification: not confirmed/);
});

test('manual top-up narrative distinguishes a new receipt from a retry and a school-store payment', () => {
  assert.match(paymentAuditSummary(payment), /20,000.00 credited.*manual entry/);
  assert.match(paymentAuditSummary(payment, { duplicate: true }), /already recorded/);
  assert.match(paymentAuditSummary({ ...payment, FeeCode: 'STORE_CART', FeeCategory: 'Store' }), /not a wallet top-up/);
});

test('historical transfer stages are explicitly unknown and immutable originals are preserved', () => {
  const input = { Action: 'APPROVE STAFF DIRECT TRANSFERS', Route: '/api/staff-direct-transfers',
    Actor: 'Ada', EntityId: 'TRANSFER-1', HttpStatus: 202, Details: 'Original evidence' };
  const before = structuredClone(input);
  const row = normalizedLegacyAudit(input, { collection: 'platformSecurityAudit' });
  assert.equal(row.OriginalAction, input.Action);
  assert.match(row.Action, /stage not recorded/);
  assert.match(row.Summary, /does not identify which step/);
  assert.deepEqual(input, before);
});

test('non-financial entity identifiers are captured but sensitive content is not', async () => {
  const prepared = await prepareSecurityAudit(new Request('https://example.test/api/staff-library', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'returnbook', LoanId: 'LOAN-1', Password: 'secret', Notes: 'private details' })
  }), '/api/staff-library');
  assert.equal(prepared.entityId, 'LOAN-1'); assert.equal(prepared.action, 'Return book');
  assert.doesNotMatch(JSON.stringify(prepared), /secret|private details/);
});

test('plain-language audit summaries are visible and escaped, not confined to tooltips', () => {
  const source = readFileSync(new URL('../js/admin.js', import.meta.url), 'utf8');
  const render = source.slice(source.indexOf('function securityAuditRowsHtml('), source.indexOf('function updateSecurityAuditTable('));
  const escapeHtml = value => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const { securityAuditRowsHtml } = vm.runInNewContext(render + ';({securityAuditRowsHtml})', {
    escapeHtml, lower: value => String(value).toLowerCase(), securityAuditDateTime: String, securityAuditDetail: () => ''
  });
  const html = securityAuditRowsHtml([{ Action: 'Save employee', Summary: 'Ada saved <script>private</script>' }]);
  assert.match(html, /<p>Ada saved &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
