import { getDocument } from './firestore.js';
import { requirePlatformFirestoreEnv } from './platform-firestore.js';

export const PLATFORM_PAYMENT_SETTINGS_DOCUMENT = 'dynamaxPaymentSettings';

const clean = (value) => String(value ?? '').trim();
const yes = (value) => ['yes', 'true', '1', 'enabled'].includes(clean(value).toLowerCase());

function paymentError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function normalizePlatformPaymentSettings(input = {}) {
  const settings = {
    OnlinePaymentEnabled: clean(input.OnlinePaymentEnabled || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES',
    DirectBankTransferEnabled: yes(input.DirectBankTransferEnabled) ? 'YES' : 'NO',
    PaymentBankName: clean(input.PaymentBankName).slice(0, 120),
    PaymentAccountName: clean(input.PaymentAccountName).slice(0, 160),
    PaymentAccountNumber: clean(input.PaymentAccountNumber).replace(/\s+/g, '').slice(0, 40),
    PaymentBankCurrency: clean(input.PaymentBankCurrency || 'NGN').toUpperCase().slice(0, 3) || 'NGN',
    PaymentTransferInstructions: clean(input.PaymentTransferInstructions).slice(0, 500)
  };
  settings.DirectBankTransferReady = settings.DirectBankTransferEnabled === 'YES'
    && Boolean(settings.PaymentBankName && settings.PaymentAccountName && settings.PaymentAccountNumber);
  return settings;
}

export function validatePlatformPaymentSettings(input = {}) {
  const settings = normalizePlatformPaymentSettings(input);
  if (settings.DirectBankTransferEnabled === 'YES' && !settings.DirectBankTransferReady) {
    throw paymentError('Enter the Dynamax bank name, account name and account number before enabling direct bank transfer.');
  }
  return settings;
}

export async function loadPlatformPaymentSettings(env) {
  const platformEnv = requirePlatformFirestoreEnv(env);
  const saved = await getDocument(platformEnv, 'settings', PLATFORM_PAYMENT_SETTINGS_DOCUMENT).catch(() => null);
  return normalizePlatformPaymentSettings(saved || {});
}

export async function publicPlatformPaymentMethods(env) {
  const settings = await loadPlatformPaymentSettings(env);
  return {
    online: {
      enabled: settings.OnlinePaymentEnabled !== 'NO' && Boolean(clean(env.PAYSTACK_SECRET_KEY)),
      provider: 'Paystack',
      label: 'Pay online (Card / USSD / Bank)'
    },
    directTransfer: {
      enabled: settings.DirectBankTransferReady,
      ready: settings.DirectBankTransferReady,
      bankName: settings.PaymentBankName,
      accountName: settings.PaymentAccountName,
      accountNumber: settings.PaymentAccountNumber,
      currency: settings.PaymentBankCurrency,
      instructions: settings.PaymentTransferInstructions
    }
  };
}

export function platformTransferEvidence(input = {}) {
  const bankReference = clean(input.bankReference || input.BankReference || input.PaymentReference).slice(0, 160);
  if (!bankReference) throw paymentError('Enter the bank transaction reference before submitting the subscription transfer.');
  const proofDataUrl = clean(input.proofDataUrl || input.ProofDataUrl);
  if (proofDataUrl && (!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/i.test(proofDataUrl) || proofDataUrl.length > 600000)) {
    throw paymentError('Payment proof must be a PNG, JPG, WebP or PDF file below 450 KB.');
  }
  return {
    BankReference: bankReference,
    ProofDataUrl: proofDataUrl,
    ProofFileName: clean(input.proofFileName || input.ProofFileName).replace(/[^A-Za-z0-9._ -]/g, '').slice(0, 120)
  };
}

export async function platformBankReferenceHash(value) {
  const normalized = clean(value).toLowerCase().replace(/\s+/g, '');
  if (!normalized) throw paymentError('A bank transaction reference is required.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function publicPlatformTransferRecord(row = {}) {
  return {
    Reference: clean(row.Reference || row.__id),
    RegistrationReference: clean(row.RegistrationReference),
    OrganisationName: clean(row.OrganisationName),
    Email: clean(row.Email),
    Plan: clean(row.Plan),
    BillingCycle: clean(row.BillingCycle),
    Amount: Number(row.Amount || 0),
    Currency: clean(row.Currency || 'NGN'),
    BankReference: clean(row.BankReference),
    ProofFileName: clean(row.ProofFileName),
    HasProof: Boolean(clean(row.ProofDataUrl)),
    Status: clean(row.Status),
    CreatedAt: clean(row.CreatedAt),
    UpdatedAt: clean(row.UpdatedAt),
    ReviewedAt: clean(row.ReviewedAt),
    ReviewNotes: clean(row.ReviewNotes)
  };
}
