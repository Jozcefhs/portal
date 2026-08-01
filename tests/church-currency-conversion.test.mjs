import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  convertedDonationBaseAmount,
  journalUsesAccountingBaseCurrency,
  normalizeDonationCurrency
} from '../functions/lib/currency-conversion.js';
import { buildDonationReceiptHtml, donationSummary } from '../functions/lib/church-payments.js';
import { buildChurchDonationAccountingJournal } from '../functions/api/backend.js';
import { buildIncomeAnalytics } from '../functions/lib/income-analytics.js';

test('foreign donations freeze their NGN equivalent at the supplied rate', () => {
  const conversion = normalizeDonationCurrency({
    Amount: 100,
    Currency: 'USD',
    ExchangeRate: 1600,
    ExchangeRateDate: '2026-08-01',
    ExchangeRateSource: 'Treasury rate'
  }, { allowMissingRate: false });

  assert.deepEqual(conversion, {
    Currency: 'USD',
    TransactionCurrency: 'USD',
    BaseCurrency: 'NGN',
    ExchangeRate: 1600,
    ExchangeRateDate: '2026-08-01',
    ExchangeRateSource: 'Treasury rate',
    BaseAmount: 160000,
    ConversionStatus: 'Converted'
  });
  assert.equal(convertedDonationBaseAmount({ Amount: 100, ...conversion }), 160000);
  const receipt = buildDonationReceiptHtml({
    DonorName: 'USD Donor', DonorEmail: 'usd@example.test', Amount: 100,
    PaymentMethod: 'CASH', PaymentType: 'Donation', Status: 'Paid', ...conversion
  });
  assert.match(receipt, /NGN Equivalent/);
  assert.match(receipt, /₦160,000\.00/);
  assert.match(receipt, /1 USD = NGN 1600/);
});

test('foreign donations without a rate remain unconverted and are excluded from NGN summaries', () => {
  const awaiting = normalizeDonationCurrency({ Amount: 50, Currency: 'USD' });
  assert.equal(awaiting.ConversionStatus, 'Awaiting Rate');
  assert.equal(awaiting.BaseAmount, null);
  assert.equal(convertedDonationBaseAmount({ Amount: 50, ...awaiting }), null);

  const summary = donationSummary([
    { Amount: 2000, Currency: 'NGN', Status: 'Paid', PaymentMethod: 'CASH', PaymentType: 'Tithe' },
    { Amount: 50, ...awaiting, Status: 'Paid', PaymentMethod: 'ONLINE', PaymentType: 'Donation' }
  ]);
  assert.equal(summary.totalAmount, 2000);
  assert.equal(summary.paidAmount, 2000);
  assert.equal(summary.awaitingRate, 1);
  assert.deepEqual(summary.awaitingRateByCurrency, { USD: 50 });
  assert.deepEqual(summary.byType, { Tithe: 2000 });
});

test('foreign donations post converted NGN debit, fee and revenue values', () => {
  const journal = buildChurchDonationAccountingJournal({
    DonationId: 'DON-USD-1',
    DonorName: 'USD Donor',
    Status: 'Paid',
    PaymentMethod: 'ONLINE',
    Gateway: 'Paystack',
    Amount: 100,
    Currency: 'USD',
    TransactionCurrency: 'USD',
    BaseCurrency: 'NGN',
    BaseAmount: 160000,
    ExchangeRate: 1600,
    ExchangeRateDate: '2026-08-01',
    ExchangeRateSource: 'Treasury rate',
    ConversionStatus: 'Converted'
  }, {
    Currency: 'USD',
    GrossAmount: 100,
    NetAmount: 97,
    GatewayFee: 3
  });

  assert.equal(journal.Currency, 'NGN');
  assert.equal(journal.TransactionCurrency, 'USD');
  assert.equal(journal.OriginalAmount, 100);
  assert.equal(journal.BaseAmount, 160000);
  assert.equal(journal.TotalDebit, 160000);
  assert.equal(journal.TotalCredit, 160000);
  assert.deepEqual(
    journal.Lines.map((line) => [line.AccountCode, line.Debit, line.Credit]),
    [['1030', 155200, 0], ['6060', 4800, 0], ['4080', 0, 160000]]
  );
  assert.equal(journalUsesAccountingBaseCurrency(journal), true);
});

test('accounting refuses to mix an unconverted foreign donation into NGN', () => {
  assert.throws(() => buildChurchDonationAccountingJournal({
    DonationId: 'DON-USD-NO-RATE',
    Status: 'Paid',
    PaymentMethod: 'CASH',
    Amount: 100,
    Currency: 'USD'
  }), /freeze the NGN exchange rate/);
});

test('income analytics excludes legacy foreign journals without a frozen base conversion', () => {
  const chart = [{ Code: '4080', Name: 'Donation Income', Type: 'Revenue' }];
  const report = buildIncomeAnalytics(chart, [
    {
      JournalNo: 'LEGACY-USD', Date: '2026-08-01', Status: 'Posted', Source: 'Church Donation', Currency: 'USD',
      Lines: [{ AccountCode: '4080', Credit: 100 }]
    },
    {
      JournalNo: 'CONVERTED-USD', Date: '2026-08-01', Status: 'Posted', Source: 'Church Donation',
      Currency: 'NGN', TransactionCurrency: 'USD', BaseCurrency: 'NGN', BaseAmount: 160000,
      OriginalAmount: 100, ExchangeRate: 1600, ConversionStatus: 'Converted',
      Lines: [{ AccountCode: '4080', Credit: 160000 }]
    }
  ], { period: 'daily', dateFrom: '2026-08-01', dateTo: '2026-08-01' }, '2026-08-01');

  assert.equal(report.summary.totalIncome, 160000);
  assert.equal(report.summary.excludedUnconvertedTransactions, 1);
  assert.equal(report.transactions.length, 1);
  assert.equal(report.transactions[0].transactionCurrency, 'USD');
  assert.equal(report.transactions[0].originalAmount, 100);
  assert.equal(report.transactions[0].exchangeRate, 1600);
});

test('staff and public donation interfaces explain and collect conversion data', async () => {
  const [admin, giveHtml, giveJs] = await Promise.all([
    readFile(new URL('../js/admin.js', import.meta.url), 'utf8'),
    readFile(new URL('../give.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/give.js', import.meta.url), 'utf8')
  ]);
  assert.match(admin, /name="ExchangeRate"/);
  assert.match(admin, /data-donation-rate=/);
  assert.match(admin, /churchDonationRequest\('setconversion'/);
  assert.match(giveHtml, /id="givingCurrencyNote"/);
  assert.match(giveJs, /freeze the applicable NGN exchange rate/);
});
