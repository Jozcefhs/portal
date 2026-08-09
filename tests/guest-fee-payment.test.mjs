import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createGuestFeePaymentToken,
  maskGuestFeeParentEmail,
  readGuestFeePaymentToken
} from '../functions/lib/guest-fee-payment.js';

const portalRoot = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, portalRoot), 'utf8');

test('guest fee token is encrypted, student-bound and short-lived', async () => {
  const now = Date.UTC(2026, 7, 9, 10, 0, 0);
  const env = { PARENT_SESSION_SECRET: 'guest-fee-payment-test-secret' };
  const target = {
    accountRef: 'DCA/26/001',
    admissionNo: 'DCA/26/001',
    parentEmail: 'parent@example.com',
    branchId: 'main',
    sourceType: 'student',
    scopePath: 'students'
  };
  const token = await createGuestFeePaymentToken(env, target, now);
  assert.doesNotMatch(token, /parent@example\.com|DCA\/26\/001/);

  const payload = await readGuestFeePaymentToken(env, token, now + 60_000);
  assert.equal(payload.purpose, 'guest-fee-payment');
  assert.equal(payload.accountRef, target.accountRef);
  assert.equal(payload.parentEmail, target.parentEmail);
  assert.equal(payload.scopePath, target.scopePath);
  assert.equal(payload.sourceType, 'student');
  assert.equal(await readGuestFeePaymentToken(env, token, now + 21 * 60_000), null);

  const [ivPart, encryptedPart] = token.split('.');
  const mutationIndex = Math.floor(encryptedPart.length / 2);
  const replacement = encryptedPart[mutationIndex] === 'A' ? 'B' : 'A';
  const tampered = `${ivPart}.${encryptedPart.slice(0, mutationIndex)}${replacement}${encryptedPart.slice(mutationIndex + 1)}`;
  assert.equal(await readGuestFeePaymentToken(env, tampered, now), null);
});

test('parent address shown to a guest is masked', () => {
  assert.equal(maskGuestFeeParentEmail('parent@example.com'), 'pa****@example.com');
  assert.equal(maskGuestFeeParentEmail('a@example.com'), 'a***@example.com');
  assert.equal(maskGuestFeeParentEmail('not-an-email'), '');
});

test('public fee page uses admission number and parent OTP rather than parent credentials', async () => {
  const [html, browser, endpoint, library] = await Promise.all([
    source('payments.html'),
    source('js/payments.js'),
    source('functions/api/guest-fee-payment.js'),
    source('functions/lib/guest-fee-payment.js')
  ]);
  assert.match(html, /id="admissionNumber"/);
  assert.match(html, /id="otp"[^>]*autocomplete="one-time-code"/);
  assert.match(html, /never opens the parent dashboard/i);
  assert.doesNotMatch(html, /id="email"|id="code"/);
  assert.match(browser, /fetch\('\/api\/guest-fee-payment'/);
  assert.match(browser, /guestPaymentToken/);
  assert.doesNotMatch(browser, /localStorage|sessionStorage/);
  assert.match(endpoint, /guest_fee_otp_request/);
  assert.match(endpoint, /guest_fee_otp_verify/);
  assert.match(endpoint, /maximum: 5/);
  assert.match(library, /OtpHash/);
  assert.match(library, /AES-GCM/);
  assert.match(library, /MAX_OTP_ATTEMPTS = 5/);
  assert.match(library, /deleteDocumentIfCurrent/);
  assert.match(library, /toEmail: target\.parentEmail/);
  assert.match(library, /cannot open the parent dashboard/i);
});

test('guest authorization is accepted only by payment APIs and never by the parent dashboard', async () => {
  const [optionsApi, initApi, parentDashboard, landing, landingCss, siteConfig] = await Promise.all([
    source('functions/api/payment-options.js'),
    source('functions/api/init-payment.js'),
    source('js/parent-dashboard.js'),
    source('school.html'),
    source('css/school-landing.css'),
    source('js/site-config.js')
  ]);
  assert.match(optionsApi, /requireGuestFeePaymentToken/);
  assert.match(optionsApi, /AccountRef: guestAccess\.accountRef/);
  assert.match(optionsApi, /code !== 'WALLET_TOPUP'/);
  assert.match(initApi, /requireGuestFeePaymentToken/);
  assert.match(initApi, /guestAccess\?\.accountRef/);
  assert.match(initApi, /parent_otp_guest_payment/);
  assert.match(initApi, /parent-approved link can pay school fees only/);
  assert.doesNotMatch(parentDashboard, /guestPaymentToken|requireGuestFeePaymentToken/);
  assert.match(landing, /parent-approved OTP/i);
  assert.match(landing, /service-directory/);
  assert.match(landing, /data-fresh-site-profile/);
  assert.match(landing, /landing-announcement portal-notice/);
  assert.match(landingCss, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(landingCss, /\.landing-announcement\[hidden\]\s*\{\s*display: none !important/);
  assert.match(landingCss, /\.landing-nav\s*\{[\s\S]*?position: sticky;[\s\S]*?z-index: 100;/);
  assert.match(landingCss, /\.landing-page\s*\{[\s\S]*?overflow-x: clip;/);
  assert.match(landingCss, /\.landing-hero \.hero-copy\s*\{\s*min-height: 310px;/);
  assert.match(landingCss, /\.landing-nav \[data-school-address\]\s*\{\s*display: none;/);
  assert.match(landingCss, /@media \(max-width: 620px\)/);
  assert.match(landing, /class="landing-mobile-menu"/);
  assert.match(landing, /class="nav-actions landing-desktop-actions"/);
  assert.match(landingCss, /\.landing-nav \.landing-desktop-actions\s*\{\s*display: none !important;/);
  assert.match(landingCss, /\.landing-mobile-menu-panel\s*\{[\s\S]*?position: absolute;/);
  assert.match(siteConfig, /hasAttribute\('data-fresh-site-profile'\)/);
  assert.match(siteConfig, /freshInitialSiteProfile\s*\?\s*refreshSiteProfile\(\)/);
});
