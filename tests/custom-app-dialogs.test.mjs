import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const nativeDialogPattern = /window\.(?:prompt|confirm|alert)\s*\(/;

test('shared Dynamax dialogs replace native JavaScript prompts and confirmations', async () => {
  const [dialogs, admin, notifications, setup, faceLookup, pwa, plan] = await Promise.all([
    source('js/app-dialogs.js'), source('js/admin.js'), source('js/notifications.js'), source('js/setup.js'),
    source('js/student-face-lookup.js'), source('js/pwa-install.js'), source('js/plan-management.js')
  ]);
  assert.match(dialogs, /window\.DynamaxDialogs = \{/);
  assert.match(dialogs, /confirm: \(options\) => open\(options, 'confirm'\)/);
  assert.match(dialogs, /prompt: \(options\) => open\(options, 'prompt'\)/);
  assert.match(dialogs, /alert: \(options\) => open\(options, 'alert'\)/);
  for (const code of [admin, notifications, setup, faceLookup, pwa, plan]) assert.doesNotMatch(code, nativeDialogPattern);
});

test('parent and staff portals load the branded dialog component before their application code', async () => {
  for (const [htmlFile, consumer] of [
    ['admin.html', 'js/admin.js'], ['parent-dashboard.html', 'js/parent-dashboard.js'],
    ['setup.html', 'js/setup.js'], ['plan-management.html', 'js/plan-management.js'],
    ['index.html', 'js/pwa-install.js'], ['school.html', 'js/pwa-install.js']
  ]) {
    const html = await source(htmlFile);
    assert.match(html, /js\/app-dialogs\.js/);
    assert.ok(html.indexOf('js/app-dialogs.js') < html.indexOf(consumer), `${htmlFile} must load branded dialogs before ${consumer}`);
  }
});

test('subscription transfer decisions use a detailed in-app approval dialog', async () => {
  const [html, client] = await Promise.all([source('plan-management.html'), source('js/plan-management.js')]);
  assert.match(html, /id="platformTransferDecisionDialog"/);
  assert.match(html, /id="platformDecisionSubscriber"/);
  assert.match(html, /id="platformDecisionAmount"/);
  assert.match(client, /requestPlatformTransferDecision\(approve, decisionButton\.dataset\.reference\)/);
  assert.match(client, /Approval note \(optional\)/);
  assert.match(client, /Rejection reason/);
});

test('custom dialogs are responsive and retain dark-mode contrast', async () => {
  const styles = await source('css/style.css');
  assert.match(styles, /\.app-decision-dialog \{[^}]*width: min\(500px, calc\(100vw - 24px\)\)/);
  assert.match(styles, /html\[data-theme="dark"\] \.app-decision-dialog/);
  assert.match(styles, /\.platform-transfer-decision-dialog::backdrop/);
  assert.match(styles, /@media \(max-width: 430px\) \{ \.platform-decision-summary \{ grid-template-columns: 1fr; \} \}/);
});
