import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  allocateCurrencySettlement,
  buildDonationInsights,
  donationCurrencySettings
} from '../functions/lib/church-donation-management.js';
import { buildChurchDonationAccountingJournal } from '../functions/api/backend.js';

test('currency policy preserves the established per-donation flow by default', () => {
  assert.equal(donationCurrencySettings({}).ForeignCurrencyMode, 'PER_DONATION');
  assert.equal(donationCurrencySettings({ Mode: 'batch_settlement' }).ForeignCurrencyMode, 'BATCH_SETTLEMENT');
});

test('a batch settlement allocates actual NGN proceeds and charges without rounding drift', () => {
  const result = allocateCurrencySettlement([
    { DonationId: 'D1', Amount: 100, Currency: 'USD' },
    { DonationId: 'D2', Amount: 50, Currency: 'USD' }
  ], 240000, 3000);

  assert.equal(result.currency, 'USD');
  assert.equal(result.rate, 1600);
  assert.equal(result.totalForeign, 150);
  assert.deepEqual(result.allocations, [
    { DonationId: 'D1', Amount: 100, BaseAmount: 160000, BaseConversionFee: 2000, BaseNetAmount: 158000 },
    { DonationId: 'D2', Amount: 50, BaseAmount: 80000, BaseConversionFee: 1000, BaseNetAmount: 79000 }
  ]);
  assert.equal(result.allocations.reduce((sum, row) => sum + row.BaseAmount, 0), 240000);
  assert.equal(result.allocations.reduce((sum, row) => sum + row.BaseConversionFee, 0), 3000);
});

test('donor ranking combines only settled NGN equivalents and preserves currency holdings separately', () => {
  const insights = buildDonationInsights([
    { DonorName: 'Ada', DonorEmail: 'ada@example.test', Status: 'Paid', Amount: 100, Currency: 'USD', ConversionStatus: 'Awaiting Rate' },
    { DonorName: 'Ada', DonorEmail: 'ada@example.test', Status: 'Paid', Amount: 50, Currency: 'USD', ConversionStatus: 'Converted', BaseAmount: 80000 },
    { DonorName: 'Ben', DonorEmail: 'ben@example.test', Status: 'Paid', Amount: 100000, Currency: 'NGN', ConversionStatus: 'Converted', BaseAmount: 100000 }
  ]);
  assert.equal(insights.topDonors[0].DonorName, 'Ben');
  assert.equal(insights.topDonors[1].SettledNgnTotal, 80000);
  assert.deepEqual(insights.foreignHoldings, [{ Currency: 'USD', PaidAmount: 150, AwaitingAmount: 100, DonationCount: 2 }]);
});

test('batch conversion charge posts as an expense while revenue remains gross', () => {
  const journal = buildChurchDonationAccountingJournal({
    DonationId: 'D1', DonorName: 'Ada', Status: 'Paid', PaymentMethod: 'BANK TRANSFER',
    Amount: 100, Currency: 'USD', TransactionCurrency: 'USD', BaseCurrency: 'NGN',
    BaseAmount: 160000, BaseConversionFee: 2000, BaseNetAmount: 158000,
    ExchangeRate: 1600, ConversionStatus: 'Converted'
  });
  assert.deepEqual(journal.Lines.map((line) => [line.AccountCode, line.Debit, line.Credit]), [
    ['1020', 158000, 0], ['6060', 2000, 0], ['4080', 0, 160000]
  ]);
});

test('church staff interface exposes clean donor, currency and staff-attendance workspaces', async () => {
  const [admin, style] = await Promise.all([
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8')
  ]);
  assert.match(admin, /Donor register/);
  assert.match(admin, /name="ForeignCurrencyMode"/);
  assert.match(admin, /Settle selected gifts/);
  assert.match(admin, /\['staffAttendance', 'Staff Attendance'\]/);
  assert.match(admin, /\/api\/staff-attendance/);
  assert.match(style, /\.attendance-clock-card/);
  assert.match(style, /\.workspace-subnav button\{[^}]*width:fit-content/);
});
