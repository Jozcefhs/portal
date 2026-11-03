// Isolated real-browser checks: every request is intercepted; no live payments or credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const admin = await read('js/admin.js');
const declaration = name => admin.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`))[0];
const { chromium } = await import(pathToFileURL(`${process.env.PLAYWRIGHT_MODULE}/index.mjs`).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage(), errors = [], posts = [];
  context.on('page', p => p.on('pageerror', error => errors.push(error.message)));
  page.on('pageerror', error => errors.push(error.message));
  let gates = [], transferContext = 'school-payment', completed = false, stage = 0, failure = false, qrFailure = false, qrReads = 0;
  const progress = ['Bank reference secured. Recording the payment now...', 'Payment recorded. Preparing the parent notification and receipt...', 'Receipt delivery completed. Finalizing the verified transfer...'];
  await context.route('**/*', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/staff-admission-forms') {
      qrReads++;
      return route.fulfill({ status: qrFailure ? 503 : 200, json: qrFailure
        ? { ok: false, message: 'QR temporarily unavailable.' }
        : { ok: true, message: 'Reusable admission form purchase QR code generated.', purchaseUrl: 'https://dialog-fixture.test/buy-form.html', qrSvg: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' } });
    }
    if (path === '/api/staff-direct-transfers') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { ok: true, transfers: completed ? [] : [{ Reference: 'TEST-TRANSFER', Context: transferContext, PayerName: 'Fixture payer', Amount: 1000, Status: 'Awaiting Verification' }] } });
      const index = stage++;
      posts.push(route.request().postDataJSON());
      await gates[index].promise;
      if (failure) return route.fulfill({ status: 409, json: { ok: false, message: 'Transfer could not be verified.' } });
      completed = index === 3;
      return route.fulfill({ status: completed ? 200 : 202, json: completed
        ? { ok: true, message: `${transferContext}: Transfer verified and receipt issued.` }
        : { ok: true, continueApproval: true, stage: ['record', 'deliver-receipt', 'complete'][index], message: progress[index] } });
    }
    assert.equal(path, '/', `Unexpected network request: ${path}`);
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><span data-school-name>Fixture School</span><p id="status"></p><button id="admissionFormPurchaseQrButton">Purchase QR</button><main id="panel"></main>' });
  });
  await page.goto('https://dialog-fixture.test/');
  await page.addStyleTag({ content: (await read('css/style.css')).replace(/@import[^;]+;/g, '') });
  for (const script of ['app-dialogs', 'staff-action-feedback', 'staff-workspace-cache']) await page.addScriptTag({ content: await read(`js/${script}.js`) });
  await page.addScriptTag({ content: `
    const clean = value => String(value ?? '').trim(), dashboardStatus = document.getElementById('status');
    const selectedBranchId = 'main', staffBearerToken = '', activeSection = 'accounts', staffBrand = null;
    const staffSessionAbortController = new AbortController(), historyDateWorkspace = { range: () => null };
    window.DynamaxHistoryDates = { datedHistoryBody: (path, body) => body };
    const DynamaxTime = { formatDateTime: value => value };
    const staffWorkspaceReads = DynamaxWorkspaceCache.create({ context: () => ({ scope: 'fixture', signal: staffSessionAbortController.signal }) });
    ${['escapeHtml', 'setStatus', 'setButtonLoading', 'receivedResponseError', 'staffFetch', 'showAdmissionFormPurchaseQr', 'bindAdmissionFormPurchaseQr', 'directTransferContextLabel', 'directTransferAmount', 'directTransferVerificationWorkspace', 'loadDirectTransferVerification'].map(declaration).join('\n')}
    const refreshDirectTransferModule = contexts => loadDirectTransferVerification(contexts, 'transfers');
    window.renderTransfers = async context => { document.getElementById('panel').innerHTML = directTransferVerificationWorkspace('transfers'); await loadDirectTransferVerification([context], 'transfers'); };
    bindAdmissionFormPurchaseQr();
  ` });
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Purchase QR', exact: true }).click();
  const qr = await popupPromise;
  await qr.getByRole('button', { name: 'Print QR', exact: true }).waitFor();
  assert.equal(await qr.getByRole('link', { name: 'Open purchase form' }).getAttribute('href'), 'https://dialog-fixture.test/buy-form.html');
  assert.equal(await page.locator('dialog[open]').count(), 0, 'QR preview must not open a success modal');
  assert.equal(qrReads, 1);
  await qr.close();

  // Exercise the shared handler in all four payment contexts, including mobile.
  for (const paymentContext of ['school-payment', 'admission-form', 'church-donation', 'organization-store']) {
    transferContext = paymentContext; completed = false; stage = 0; gates = Array.from({ length: 4 }, deferred);
    if (paymentContext === 'organization-store') await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(context => renderTransfers(context), paymentContext);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    assert.equal(stage, 0, 'No write before accountant confirmation');
    await page.getByRole('button', { name: 'Approve transfer', exact: true }).click();
    for (let index = 0; index < 3; index++) {
      gates[index].resolve();
      await page.waitForFunction(message => document.querySelector('[data-direct-transfer-status]').textContent === message, progress[index]);
      assert.equal(await page.locator('dialog[open]').count(), 0, 'Intermediate stages stay inline');
      assert.equal(await page.getByRole('button', { name: /Recording|Sending receipt/ }).isDisabled(), true);
    }
    gates[3].resolve();
    await page.getByRole('heading', { name: 'Action completed', exact: true }).waitFor();
    await page.getByText('No direct bank transfer is awaiting verification here.').waitFor();
    assert.equal(stage, 4, 'Only the four expected resumable calls');
    assert.equal(await page.locator('.app-decision-message').innerText(), `${paymentContext}: Transfer verified and receipt issued.`);
    await page.getByRole('button', { name: paymentContext === 'organization-store' ? 'Close dialog' : 'Close', exact: true }).click();
    assert.equal(await page.locator('dialog[open]').count(), 0, 'One click must close the only final success dialog');
  }
  assert.equal(posts.length, 16);
  assert.ok(posts.every(body => body.action === 'approve' && body.Reference === 'TEST-TRANSFER'));

  // Errors remain visible and stop the continuation loop.
  completed = false; stage = 0; failure = true; gates = [deferred()];
  await page.evaluate(() => renderTransfers('organization-store'));
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: 'Approve transfer', exact: true }).click();
  gates[0].resolve();
  await page.getByRole('heading', { name: 'Action not completed', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-direct-transfer-action="approve"]').disabled);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(stage, 1);
  qrFailure = true;
  const failedPopup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Purchase QR', exact: true }).click();
  const failedQr = await failedPopup;
  await page.getByRole('heading', { name: 'Action not completed', exact: true }).waitFor();
  assert.equal(await page.locator('.app-decision-message').innerText(), 'QR temporarily unavailable.');
  assert.equal(failedQr.isClosed(), true);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: QR-only preview; staged approval in four contexts; one-click success dismissal on desktop/mobile; failures remain visible; no live payments used.');
} finally { await browser.close(); }
