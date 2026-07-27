import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildDonationReceiptHtml } from '../functions/lib/church-payments.js';

const adminJs = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const paymentSource = await readFile(new URL('../functions/lib/church-payments.js', import.meta.url), 'utf8');

test('donation rows render one state-aware action button', () => {
  assert.match(adminJs, /if \(receiptSent\)[\s\S]*?>Receipt sent<\/button>/);
  assert.match(adminJs, /status === 'paid'[\s\S]*?>Send receipt<\/button>/);
  assert.match(adminJs, /status === 'pending'[\s\S]*?>Send payment link<\/button>/);
  assert.doesNotMatch(adminJs, /data-donation-action="setstatus"[\s\S]*?>Mark Paid<\/button>/);
});

test('successful receipt delivery is persisted and pending payment links stay distinct', () => {
  assert.match(paymentSource, /ReceiptStatus: 'Sent'/);
  assert.match(paymentSource, /ReceiptSentAt: sentAt/);
  assert.match(paymentSource, /PaymentLinkSentAt: sentAt/);
  assert.match(paymentSource, /A receipt can only be sent after the donation is paid\./);
});

test('donation receipt includes a subdued organisation logo watermark', () => {
  const html = buildDonationReceiptHtml({
    DonorName: 'Example Donor',
    DonorEmail: 'donor@example.test',
    Amount: 5000,
    Currency: 'NGN',
    PaymentMethod: 'ONLINE',
    PaymentType: 'Offering',
    Reference: 'DON-123',
    ReceiptNo: 'ORG/DON/2026/ABC',
    Status: 'Paid',
    ChurchName: 'Example Organisation',
    ReceiptLogoSource: 'https://example.test/logo.png'
  });

  assert.equal((html.match(/src="https:\/\/example\.test\/logo\.png"/g) || []).length, 2);
  assert.match(html, /opacity:0\.07/);
  assert.match(html, /alt="Example Organisation logo"/);
  assert.match(html, /width="50" height="50"/);
  assert.match(html, /Example Organisation donation receipt/);
  assert.doesNotMatch(html, />Pay Now</);
});

test('configured web branding uses a public image endpoint that email clients can load', () => {
  assert.match(paymentSource, /return `\$\{publicPortalUrl\}\/api\/web-logo`/);
  assert.doesNotMatch(paymentSource, /if \(\/\^data:image[\s\S]{0,120}return embeddedLogo/);
});
