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
  assert.match(paymentSource, /if \(lower\(donation\.Status\) !== 'paid'\) return null/);
  assert.match(paymentSource, /A receipt can only be sent after the donation is paid\./);
});

test('donation receipt uses an email-safe centred watermark and visible organisation logo', () => {
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

  assert.equal((html.match(/src="https:\/\/example\.test\/logo\.png"/g) || []).length, 1);
  assert.match(html, /background-image:linear-gradient\(rgba\(255,255,255,0\.91\),rgba\(255,255,255,0\.91\)\),url\('https:\/\/example\.test\/logo\.png'\)/);
  assert.match(html, /background-position:center 58%/);
  assert.match(html, /background-size:240px auto/);
  assert.doesNotMatch(html, /position:absolute/);
  assert.match(html, /alt="Example Organisation logo"/);
  assert.match(html, /width="50" height="50"/);
  assert.match(html, /Example Organisation donation receipt/);
  assert.match(html, /background:#164a78/);
  assert.match(html, /border-top:5px solid #d39400/);
  assert.match(html, /background:#dff5e9/);
  assert.doesNotMatch(html, />Pay Now</);
});

test('pending online donation email is a payment request rather than a receipt', () => {
  const html = buildDonationReceiptHtml({
    DonorName: 'Pending Donor',
    DonorEmail: 'pending@example.test',
    Amount: 250000,
    Currency: 'NGN',
    PaymentMethod: 'ONLINE',
    PaymentType: 'Seed',
    Reference: 'DON-PENDING-1',
    ReceiptNo: 'ORG/DON/2026/PENDING',
    Status: 'Pending',
    ChurchName: 'Example Organisation',
    customMessage: 'Your gift was received.'
  }, 'https://checkout.example.test/pay');

  assert.match(html, /Secure online payment/);
  assert.match(html, /Example Organisation donation payment link/);
  assert.match(html, /No payment has been received yet\./);
  assert.match(html, /Payment Reference/);
  assert.match(html, />Pay Now</);
  assert.match(html, /This is a payment request, not a receipt\./);
  assert.doesNotMatch(html, /Official acknowledgement/);
  assert.doesNotMatch(html, /donation receipt/);
  assert.doesNotMatch(html, /Receipt Number/);
  assert.doesNotMatch(html, /Your gift was received\./);
});

test('configured web branding uses a public image endpoint that email clients can load', () => {
  assert.match(paymentSource, /return `\$\{publicPortalUrl\}\/api\/web-logo`/);
  assert.doesNotMatch(paymentSource, /if \(\/\^data:image[\s\S]{0,120}return embeddedLogo/);
});
