import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function endpoint(file, handler, result) {
  const source = await readFile(new URL(`../functions/api/${file}`, import.meta.url), 'utf8');
  return vm.runInNewContext(`${source.replace(/^import[\s\S]*?;\r?\n/gm, '').replace(/\bexport\s+/g, '')}\n;onRequestPost`, {
    Response, requireFirestoreEnv() {}, requireStaffSession: async () => ({ username: 'verified' }),
    readJsonBody: request => request.json(), [handler]: async () => result
  });
}
const context = body => ({ data: {}, env: {}, request: new Request('https://example.test/api/payments', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}) });

test('web payment retries skip only verified duplicates; new payments, client flags and duplicate warnings remain auditable', async () => {
  for (const [result, expected] of [
    [{ ok: true, duplicate: true, payment: { Reference: 'ORIGINAL' } }, true],
    [{ ok: true, duplicate: false, payment: { Reference: 'NEW' } }, false],
    [{ ok: false, code: 'WALLET_DUPLICATE_REVIEW_REQUIRED' }, false],
    [{ ok: true, duplicate: true }, false]
  ]) {
    const run = await endpoint('staff-manual-payments.js', 'handleWebManualPayment', result);
    const ctx = context({ action: 'post', duplicate: true, securityAuditHandled: true });
    assert.equal((await run(ctx)).status, 200);
    assert.equal(ctx.data.securityAuditHandled === true, expected);
  }
});

test('web corrections reuse their atomic audit for both the initial post and a replay, without silencing failure', async () => {
  for (const [result, expected] of [
    [{ ok: true }, true], [{ ok: true, replayed: true }, true], [{ ok: false, replayed: true }, false]
  ]) {
    const run = await endpoint('staff-payment-corrections.js', 'handleManualPaymentCorrection', result);
    const ctx = context({ action: 'post' });
    await run(ctx);
    assert.equal(ctx.data.securityAuditHandled === true, expected);
  }
});

test('desktop financial retries reuse existing audits only when their authenticated handler confirms a no-op', async () => {
  const source = await readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8');
  const start = source.indexOf("    if (context.data && action === 'terminalPayments' && data.ok");
  const end = source.indexOf('    finishRequestMetric(metric, { status: 200, action });', start);
  assert.ok(start > 0 && end > start);
  const run = (action, data, body = {}) => {
    const context = { data: {} };
    vm.runInNewContext(source.slice(start, end), { context, action, data, body,
      paymentAuditSummary: () => 'Recorded payment' });
    return context.data.securityAuditHandled === true;
  };
  for (const action of ['payPayrollItem', 'saveAccountingAdjustment']) {
    assert.equal(run(action, { ok: true, replayed: true }), true);
    assert.equal(run(action, { ok: true }, { replayed: true }), false);
    assert.equal(run(action, { ok: false, replayed: true }), false);
  }
  assert.equal(run('saveOtherRecord', { ok: true, replayed: true }), false);
  // A store replay can retry receipt delivery, so it is not an attested no-op.
  assert.equal(run('recordTuckShopStaffSale', { ok: true, replayed: true }), false);
  assert.equal(run('recordManualPayment', { ok: true, duplicate: true, payment: {} }), true);
  assert.equal(run('recordManualPayment', { ok: true, payment: {} }), false);
  assert.equal(run('manualPaymentCorrection', { ok: true, replayed: true }, { Command: 'post' }), true);
  assert.equal(run('manualPaymentCorrection', { ok: true }, { Command: 'post' }), true);
  assert.equal(run('manualPaymentCorrection', { ok: false }, { Command: 'post' }), false);
  assert.equal(run('syncAccountingRevenue', { ok: true, done: false }), true);
  assert.equal(run('syncAccountingRevenue', { ok: false }), false);
});
