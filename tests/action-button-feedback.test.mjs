import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalRoot = new URL('../', import.meta.url);
const [
  adminJs,
  parentDashboardJs,
  portalCss,
  actionFeedbackJs,
  applicationJs,
  buyFormJs,
  paymentsJs,
  registrationJs,
  setupJs,
  uploadDocumentsJs,
  verifyJs,
  pwaInstallJs
] = await Promise.all([
  readFile(new URL('js/admin.js', portalRoot), 'utf8'),
  readFile(new URL('js/parent-dashboard.js', portalRoot), 'utf8'),
  readFile(new URL('css/style.css', portalRoot), 'utf8'),
  readFile(new URL('js/action-feedback.js', portalRoot), 'utf8'),
  readFile(new URL('js/application.js', portalRoot), 'utf8'),
  readFile(new URL('js/buy-form.js', portalRoot), 'utf8'),
  readFile(new URL('js/payments.js', portalRoot), 'utf8'),
  readFile(new URL('js/register-organization.js', portalRoot), 'utf8'),
  readFile(new URL('js/setup.js', portalRoot), 'utf8'),
  readFile(new URL('js/upload-documents.js', portalRoot), 'utf8'),
  readFile(new URL('js/verify.js', portalRoot), 'utf8'),
  readFile(new URL('js/pwa-install.js', portalRoot), 'utf8')
]);

test('staff action helper disables repeated clicks and exposes accessible busy state', () => {
  assert.match(adminJs, /async function runButtonAction\(button, loadingText, action, normalText = ''\)/);
  assert.match(adminJs, /button\.disabled \|\| button\.getAttribute\('aria-busy'\) === 'true'/);
  assert.match(adminJs, /setButtonLoading\(button, true, loadingText \|\| 'Working\.\.\.', restingText\)/);
  assert.match(adminJs, /if \(button\.isConnected\) setButtonLoading\(button, false/);
});

test('high-risk staff actions use visible busy guards', () => {
  [
    /runButtonAction\(button, 'Recording purchase\.\.\.',[\s\S]*?recordWalletPurchase/,
    /runButtonAction\(button, 'Sending report\.\.\.',[\s\S]*?sendClinicReport/,
    /runButtonAction\(button, 'Sending list\.\.\.',[\s\S]*?sendMarketList/,
    /data-delete-department[\s\S]*?runButtonAction\(button, 'Deleting\.\.\.'/,
    /data-mark-offering-paid[\s\S]*?runButtonAction\(button, 'Posting\.\.\.'/,
    /input\.dataset\.importing === 'true'/,
    /setButtonLoading\(button, true, 'Importing staff\.\.\.', normalText\)/
  ].forEach((pattern) => assert.match(adminJs, pattern));
  assert.equal(
    (adminJs.match(/runButtonAction\(event\.currentTarget, 'Refreshing\.\.\.'/g) || []).length >= 10,
    true
  );
  assert.match(adminJs, /if \(idempotencyKey\) headers\['Idempotency-Key'\] = idempotencyKey/);
  [
    /walletPurchaseForm[\s\S]*?form\.dataset\.idempotencyKey[\s\S]*?recordWalletPurchase/,
    /clinicReportForm[\s\S]*?form\.dataset\.idempotencyKey[\s\S]*?sendClinicReport/,
    /marketListForm[\s\S]*?form\.dataset\.idempotencyKey[\s\S]*?sendMarketList/
  ].forEach((pattern) => assert.match(adminJs, pattern));
});

test('executive document actions share one form-level submission lock', () => {
  assert.match(adminJs, /composer\.dataset\.submitting === 'true'/);
  assert.match(adminJs, /button\[type="submit"\], \[data-save-executive-template\]/);
  assert.match(adminJs, /actionButtons\.forEach\(\(item\) => \{ item\.disabled = true; \}\)/);
  assert.match(adminJs, /delete composer\.dataset\.submitting/);
});

test('parent payment, checkout, download, wallet and refresh actions show busy state', () => {
  assert.match(parentDashboardJs, /function setActionLoading\(button, loading/);
  assert.match(parentDashboardJs, /button\.classList\.toggle\('is-loading', loading\)/);
  assert.match(parentDashboardJs, /button\.setAttribute\('aria-busy', loading \? 'true' : 'false'\)/);
  [
    "setActionLoading(payButton, true, paymentChoice.paymentMethod === 'direct_bank_transfer' ? 'Submitting transfer...' : 'Opening checkout...')",
    "setActionLoading(button, true, 'Preparing download...', originalLabel)",
    "setActionLoading(checkoutStoreCartBtn, true, paymentChoice.paymentMethod === 'direct_bank_transfer' ? 'Submitting transfer...' : 'Connecting to Paystack...', normalText)",
    "setActionLoading(button, true, 'Saving...', normalText)",
    "setActionLoading(refreshDashboardBtn, true, 'Refreshing...', normalText)"
  ].forEach((source) => assert.equal(parentDashboardJs.includes(source), true));
});

test('busy spinners remain visible on light secondary and compact action buttons', () => {
  assert.match(portalCss, /\.secondary\.is-loading::before/);
  assert.match(portalCss, /\.workflow-icon-action\.is-loading::before/);
  assert.match(portalCss, /\.compact-action\.is-loading::before/);
  assert.match(portalCss, /border-color:\s*currentColor transparent currentColor currentColor/);
});

test('shared public action feedback preserves labels and blocks repeated async actions', () => {
  assert.match(actionFeedbackJs, /button\.dataset\.actionBusy === 'true'/);
  assert.match(actionFeedbackJs, /button\.dataset\.actionNormalHtml = button\.innerHTML/);
  assert.match(actionFeedbackJs, /button\.classList\.add\('is-loading'\)/);
  assert.match(actionFeedbackJs, /button\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(actionFeedbackJs, /button\.innerHTML = normalHtml/);
});

test('public submission, payment, setup, upload and install actions use shared busy feedback', () => {
  [
    [applicationJs, /DynamaxActionFeedback\.begin\(submitBtn, 'Submitting application\.\.\.'\)/],
    [buyFormJs, /DynamaxActionFeedback\.begin\(button, paymentChoice\.paymentMethod === 'direct_bank_transfer' \? 'Submitting transfer\.\.\.' : 'Starting checkout\.\.\.'\)/],
    [paymentsJs, /DynamaxActionFeedback\.begin\(lookupBtn, 'Checking fees\.\.\.'\)/],
    [paymentsJs, /DynamaxActionFeedback\.begin\(payBtn, paymentChoice\.paymentMethod === 'direct_bank_transfer' \? 'Submitting transfer\.\.\.' : 'Starting checkout\.\.\.'\)/],
    [registrationJs, /DynamaxActionFeedback\.begin\(button,\s*paymentChoice\.paymentMethod === 'direct_bank_transfer'\s*\? 'Submitting transfer\.\.\.'\s*:\s*'Submitting registration\.\.\.'\)/s],
    [setupJs, /DynamaxActionFeedback\.begin\(button, 'Unlocking settings\.\.\.'\)/],
    [setupJs, /DynamaxActionFeedback\.begin\(saveSetupButton, 'Saving changes\.\.\.'\)/],
    [uploadDocumentsJs, /DynamaxActionFeedback\.begin\(button, 'Uploading documents\.\.\.'\)/],
    [verifyJs, /DynamaxActionFeedback\.begin\(button, 'Verifying\.\.\.'\)/],
    [pwaInstallJs, /DynamaxActionFeedback\.begin\(button, 'Opening installer\.\.\.'\)/]
  ].forEach(([source, pattern]) => assert.match(source, pattern));
});
