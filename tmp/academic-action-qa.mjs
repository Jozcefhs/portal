import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/DYNAMAX/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><body><main><h1>Academic action checks — local sample</h1><button id="save">Save sample</button><form id="sample"><label>Transfer reason<input name="reason" required></label><button>Transfer sample student</button></form></main></body></html>');
  await page.addStyleTag({ content: await readFile(new URL('../css/style.css', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: await readFile(new URL('../js/app-dialogs.js', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: await readFile(new URL('../js/staff-action-feedback.js', import.meta.url), 'utf8') });
  await page.evaluate(() => {
    window.confirmResult = 'waiting';
    void DynamaxDialogs.confirm({ title: 'Approve transfer?', message: 'Existing scores will be preserved.' }).then(value => { window.confirmResult = value; });
    void DynamaxStaffActionFeedback.report('A separate action completed.', 'ok');
  });
  assert.equal(await page.locator('.app-decision-dialog h2').innerText(), 'Approve transfer?');
  assert.equal(await page.evaluate(() => window.confirmResult), 'waiting');
  await page.locator('.app-decision-confirm').click();
  assert.equal(await page.evaluate(() => window.confirmResult), true);
  assert.equal(await page.locator('.app-decision-dialog h2').innerText(), 'Action completed');
  await page.locator('.app-decision-confirm').click();
  await page.locator('#sample button').click();
  await page.locator('.app-decision-dialog[open]').waitFor();
  assert.equal(await page.locator('.app-decision-dialog h2').innerText(), 'Check the form');
  await page.locator('.app-decision-confirm').click();
  assert.equal(await page.locator('[name=reason]').evaluate(element => document.activeElement === element), true);
  await page.evaluate(() => {
    void DynamaxDialogs.alert({ title: 'Failure details', message: '<script>Unsafe stored text</script>', items: ['Sample Student needs a Trade subject.'], tone: 'danger' });
    void DynamaxDialogs.alert({ message: '<script>Unsafe stored text</script>', tone: 'danger' });
  });
  assert.equal(await page.locator('.app-decision-message script').count(), 0);
  await page.locator('.app-decision-confirm').click();
  assert.equal(await page.locator('.app-decision-dialog[open]').count(), 0);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.evaluate(() => { void DynamaxStaffActionFeedback.report('Transfer request saved. The student remains in the current classroom until another authorised administrator approves. Existing scores and history are preserved.', 'ok'); });
  await page.screenshot({ path: fileURLToPath(new URL('academic-transfer-popup-mobile.png', import.meta.url)) });
  const box = await page.locator('.app-decision-dialog').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390);
  assert.deepEqual(errors, []);
  console.log('PASS: queued confirmations, success/failure, duplicate suppression, required-field validation, focus, escaping and mobile bounds.');
} finally { await browser.close(); }
