import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { formatDateTime, formatDate, formatTime } from '../functions/lib/display-time.js';
import { schoolPaymentReceiptDetails } from '../functions/lib/school-payment-email.js';
import { subscriptionReceiptText, subscriptionReceiptHtml, publicSubscriptionReceipt } from '../functions/lib/subscription-receipt.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const core = read('js/display-time.js');
const admin = read('js/admin.js');

test('UTC receipt instants display one hour ahead in WAT, without changing the stored value', () => {
  const stored = '2026-10-10T12:34:56.123Z';
  assert.equal(formatDateTime(stored), '2026-10-10 13:34:56 WAT');
  assert.equal(formatDateTime('2026-10-10T13:34:56+01:00'), '2026-10-10 13:34:56 WAT');
  assert.equal(formatDateTime('2026-10-10T07:34:56-05:00'), '2026-10-10 13:34:56 WAT');
  assert.equal(formatDateTime(new Date(stored)), '2026-10-10 13:34:56 WAT');
  assert.equal(formatDateTime(Date.parse(stored)), '2026-10-10 13:34:56 WAT');
  assert.equal(stored, '2026-10-10T12:34:56.123Z');
});

test('midnight and year rollover display the Nigerian day and never hour 24', () => {
  assert.equal(formatDateTime('2026-12-31T23:00:00Z'), '2027-01-01 00:00:00 WAT');
  assert.equal(formatDate('2026-10-10T23:30:00Z'), '2026-10-11');
  assert.equal(formatTime('2026-10-10T23:30:00Z'), '00:30');
});

test('date-only, legacy local timestamps and invalid values are not shifted', () => {
  assert.equal(formatDateTime('2026-10-10'), '2026-10-10');
  assert.equal(formatDateTime('2026-10-10T13:34:56'), '2026-10-10 13:34:56');
  assert.equal(formatDateTime('2026-10-10 13:34'), '2026-10-10 13:34');
  assert.equal(formatDate('2026-10-10T13:34:56'), '2026-10-10');
  assert.equal(formatTime('2026-10-10T13:34:56'), '13:34');
  assert.equal(formatTime('2026-10-10'), '');
  for (const value of [null, undefined, '', ' ']) assert.equal(formatDateTime(value), '');
  assert.equal(formatDateTime('not a date'), 'not a date');
  assert.equal(formatDateTime('2026-13-99T26:30:00Z'), '2026-13-99T26:30:00Z');
});

test('explicit attendance time zones remain respected with a safe Nigerian fallback', () => {
  assert.equal(formatTime('2026-10-10T12:30:00Z', 'Africa/Nairobi'), '15:30');
  assert.equal(formatTime('2026-10-10T12:30:00Z', 'invalid/zone'), '13:30');
  assert.equal(formatDateTime('2026-10-10T12:30:00Z', 'UTC'), '2026-10-10 12:30:00 UTC');
});

test('browser and backend share the formatter and ignore the device or server time zone', () => {
  const browser = {};
  runInNewContext(core, browser);
  assert.equal(browser.DynamaxTime.formatDateTime('2026-10-10T12:30:00Z'), '2026-10-10 13:30:00 WAT');
  assert.equal(browser.DynamaxTime.formatDateTime(new Date('2026-10-10T12:30:00Z')), '2026-10-10 13:30:00 WAT');
  for (const TZ of ['UTC', 'America/New_York', 'Asia/Kolkata', 'Africa/Lagos']) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', "import './js/display-time.js'; process.stdout.write(DynamaxTime.formatDateTime('2026-10-10T12:30:00Z'));"], {
      cwd: new URL('..', import.meta.url), env: { ...process.env, TZ }, encoding: 'utf8'
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, '2026-10-10 13:30:00 WAT');
  }
});

test('generic table cells format only timestamps, retaining financial numbers and IDs', () => {
  const { formatCell } = globalThis.DynamaxTime;
  for (const value of ['PAY-20261010-1230', 12000, '2026-10-10', false, null]) assert.equal(formatCell(value), value);
  assert.equal(formatCell('2026-10-10T12:30:00Z'), '2026-10-10 13:30:00 WAT');
  assert.match(admin, /escapeHtml\(DynamaxTime\.formatCell\(column\.value\(entry\.row\)\)\)/);
});

function declaration(name) {
  const start = admin.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const rest = admin.slice(start + 9);
  const next = /\n(?:async )?function /.exec(rest);
  return admin.slice(start, next ? start + 9 + next.index : undefined);
}

for (const name of ['printOrganizationCommerceReceipt', 'printChurchDonationReceipt']) {
  for (const format of ['standard', 'pos']) test(`${name} ${format} prints the corrected actual receipt timestamp`, () => {
    let output = '';
    const receiptWindow = { document: { write: value => { output += value; }, close() {} } };
    const scope = {
      DynamaxTime: globalThis.DynamaxTime, URL, Intl,
      window: { open: () => receiptWindow, location: { href: 'https://example.test/admin' } },
      document: { querySelector: () => null, getElementById: () => null }, staffBrand: null,
      clean: value => String(value ?? '').trim(), escapeHtml: value => String(value ?? ''),
      money: value => `NGN ${Number(value).toFixed(2)}`, setStatus() {}, dashboardStatus: null
    };
    const print = runInNewContext(`${declaration(name)}\n${name}`, scope);
    const sale = { SaleNo: 'TEST-001', ReceiptNo: 'TEST-001', Status: 'Paid', PaymentStatus: 'Paid', PaidAt: '2026-10-10T23:30:00Z', Amount: 100, Items: [] };
    print(sale, format);
    assert.match(output, /2026-10-11 00:30:00 WAT/);
    assert.doesNotMatch(output, /2026-10-10 23:30/);
    assert.equal(sale.PaidAt, '2026-10-10T23:30:00Z');
  });
}

test('today sales totals use the Nigerian day around midnight without changing sale dates', () => {
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-10T23:10:00Z'])); }
  }
  const summary = runInNewContext(`${declaration('commerceSalesSummary')}\ncommerceSalesSummary`, {
    Date: FixedDate, DynamaxTime: globalThis.DynamaxTime,
    clean: value => String(value ?? '').trim(), commerceNumber: Number
  });
  const sale = { Status: 'Paid', PaidAt: '2026-10-10T23:05:00Z', Amount: 100 };
  const result = summary([sale, { Status: 'Paid', PaidAt: '2026-10-10T21:00:00Z', Amount: 200 }]);
  assert.equal(result.todayTransactions, 1);
  assert.equal(result.todayAmount, 100);
  assert.equal(sale.PaidAt, '2026-10-10T23:05:00Z');
});

test('school and subscription emails display WAT while APIs retain the original instant', () => {
  const receipt = { PaidAt: '2026-10-10T23:30:00Z' };
  assert.equal(schoolPaymentReceiptDetails(receipt).paidAt, '2026-10-11 00:30:00 WAT');
  assert.match(subscriptionReceiptText(receipt), /2026-10-11 00:30:00 WAT/);
  assert.match(subscriptionReceiptHtml(receipt), /2026-10-11 00:30:00 WAT/);
  assert.equal(publicSubscriptionReceipt(receipt).paidAt, receipt.PaidAt);
  assert.match(read('functions/lib/organization-commerce-email.js'), /const paidAt = formatDateTime\(sale.PaidAt \|\| sale.SaleDate\)/);
});

test('every affected page loads the shared helper synchronously before consumers', () => {
  for (const page of ['admin', 'parent-dashboard', 'subscription-receipt', 'plan-management', 'activate-account', 'register-organization', 'verify-transcript']) {
    const html = read(`${page}.html`);
    const helper = html.indexOf('js/display-time.js?v=20261010-wat-timestamps');
    assert.ok(helper > 0 && helper < html.indexOf(`js/${page}.js`), page);
  }
  assert.match(read('sw.js'), /dynamax-v355-wat-timestamps/);
  assert.match(read('sw.js'), /\/js\/display-time.js/);
});
