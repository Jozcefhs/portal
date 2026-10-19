import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminJs = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const payments = await readFile(new URL('../functions/lib/church-payments.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../functions/api/staff-church-payments.js', import.meta.url), 'utf8');

test('pending online gifts expose a printable secure payment QR action', () => {
  assert.match(adminJs, /status === 'pending' && clean\(pick\(row, \['PaymentLink'\]\)\)/);
  assert.match(adminJs, /data-donation-qr=/);
  assert.match(adminJs, /churchDonationRequest\('paymentqr'/);
  assert.match(adminJs, /function showChurchGivingQr\(data = \{\}\)/);
  assert.match(adminJs, /Scan this code with a phone camera/);
});

test('giving QR is generated from the saved gateway link behind staff authorization', () => {
  assert.match(payments, /export async function buildChurchDonationPaymentQr/);
  assert.match(payments, /requireCapability\(user, 'canInitiateOnline'\)/);
  assert.match(payments, /const paymentLink = clean\(donation\.PaymentLink\)/);
  assert.match(payments, /QRCode\.create\(clean\(value\), \{ errorCorrectionLevel: 'M' \}\)/);
  assert.match(payments, /Create the online payment link before generating its QR code\./);
  assert.match(api, /'paymentqr', 'givingqr', 'generateqr'/);
});

test('staff can generate a reusable public giving QR without creating a donation first', () => {
  assert.match(adminJs, /id="genericChurchGivingQr"/);
  assert.match(adminJs, /churchDonationRequest\('genericqr'\)/);
  assert.match(payments, /export async function buildChurchGenericGivingQr/);
  assert.match(payments, /\/give\.html\?workspace=faith&branch=/);
  assert.match(api, /action === 'genericqr'/);
});
