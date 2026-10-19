const clean = (value) => String(value ?? '').trim();

export const ACCOUNTING_BASE_CURRENCY = 'NGN';

export function roundMoney(value) {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return NaN;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export function normalizeCurrencyCode(value, fallback = ACCOUNTING_BASE_CURRENCY) {
  const currency = clean(value || fallback).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    const error = new Error('Currency must be a three-letter code.');
    error.status = 400;
    throw error;
  }
  return currency;
}

function conversionError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function conversionDate(input = {}) {
  return clean(
    input.ExchangeRateDate || input.exchangeRateDate || input.RateDate || input.rateDate
      || input.PaidAt || input.paidAt || input.Date || input.date || input.CreatedAt
  ).slice(0, 10);
}

export function normalizeDonationCurrency(input = {}, options = {}) {
  const amount = roundMoney(input.Amount ?? input.amount);
  if (!Number.isFinite(amount) || amount <= 0) conversionError('Donation amount must be greater than zero.');

  const baseCurrency = normalizeCurrencyCode(
    options.baseCurrency || ACCOUNTING_BASE_CURRENCY,
    ACCOUNTING_BASE_CURRENCY
  );
  const transactionCurrency = normalizeCurrencyCode(
    input.TransactionCurrency || input.transactionCurrency || input.Currency || input.currency,
    baseCurrency
  );

  if (transactionCurrency === baseCurrency) {
    return {
      Currency: transactionCurrency,
      TransactionCurrency: transactionCurrency,
      BaseCurrency: baseCurrency,
      ExchangeRate: 1,
      ExchangeRateDate: conversionDate(input),
      ExchangeRateSource: 'Base currency',
      BaseAmount: amount,
      ConversionStatus: 'Converted'
    };
  }

  const suppliedRate = input.ExchangeRate ?? input.exchangeRate ?? input.Rate ?? input.rate;
  const hasSuppliedRate = clean(suppliedRate) !== '';
  const exchangeRate = hasSuppliedRate ? Number(String(suppliedRate).replace(/,/g, '').trim()) : NaN;
  if (hasSuppliedRate && (!Number.isFinite(exchangeRate) || exchangeRate <= 0)) {
    conversionError(`Enter a valid ${baseCurrency} exchange rate for ${transactionCurrency}.`);
  }
  if (!Number.isFinite(exchangeRate)) {
    if (options.allowMissingRate === false) {
      conversionError(`Enter the ${baseCurrency} value of 1 ${transactionCurrency} before recording this donation.`);
    }
    return {
      Currency: transactionCurrency,
      TransactionCurrency: transactionCurrency,
      BaseCurrency: baseCurrency,
      ExchangeRate: null,
      ExchangeRateDate: '',
      ExchangeRateSource: '',
      BaseAmount: null,
      ConversionStatus: 'Awaiting Rate'
    };
  }

  const baseAmount = roundMoney(amount * exchangeRate);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) {
    conversionError('The converted donation amount is invalid.');
  }
  return {
    Currency: transactionCurrency,
    TransactionCurrency: transactionCurrency,
    BaseCurrency: baseCurrency,
    ExchangeRate: exchangeRate,
    ExchangeRateDate: conversionDate(input) || new Date().toISOString().slice(0, 10),
    ExchangeRateSource: clean(input.ExchangeRateSource || input.exchangeRateSource) || clean(options.rateSource) || 'Manual staff rate',
    BaseAmount: baseAmount,
    ConversionStatus: 'Converted'
  };
}

export function convertedDonationBaseAmount(row = {}, baseCurrency = ACCOUNTING_BASE_CURRENCY) {
  const expectedBase = normalizeCurrencyCode(baseCurrency, ACCOUNTING_BASE_CURRENCY);
  const transactionCurrency = normalizeCurrencyCode(
    row.TransactionCurrency || row.transactionCurrency || row.Currency || row.currency,
    expectedBase
  );
  const storedBaseCurrency = normalizeCurrencyCode(
    row.BaseCurrency || row.baseCurrency,
    expectedBase
  );
  if (storedBaseCurrency !== expectedBase) return null;

  const stored = roundMoney(row.BaseAmount ?? row.baseAmount);
  if (transactionCurrency === expectedBase) {
    if (Number.isFinite(stored) && stored >= 0) return stored;
    const original = roundMoney(row.Amount ?? row.amount);
    return Number.isFinite(original) ? original : null;
  }
  const exchangeRate = Number(row.ExchangeRate ?? row.exchangeRate);
  const status = clean(row.ConversionStatus || row.conversionStatus).toLowerCase();
  return Number.isFinite(stored) && stored >= 0
    && Number.isFinite(exchangeRate) && exchangeRate > 0
    && (!status || status === 'converted')
    ? stored
    : null;
}

export function journalUsesAccountingBaseCurrency(journal = {}, baseCurrency = ACCOUNTING_BASE_CURRENCY) {
  const expectedBase = normalizeCurrencyCode(baseCurrency, ACCOUNTING_BASE_CURRENCY);
  const transactionCurrency = normalizeCurrencyCode(
    journal.TransactionCurrency || journal.transactionCurrency || journal.Currency || journal.currency,
    expectedBase
  );
  const storedBaseCurrency = clean(journal.BaseCurrency || journal.baseCurrency).toUpperCase();

  if (!clean(journal.TransactionCurrency || journal.transactionCurrency)) {
    return transactionCurrency === expectedBase;
  }
  if (transactionCurrency === expectedBase) {
    return !storedBaseCurrency || storedBaseCurrency === expectedBase;
  }
  return storedBaseCurrency === expectedBase
    && clean(journal.ConversionStatus || journal.conversionStatus).toLowerCase() === 'converted';
}
