import { createDocumentIfAbsent, getDocument } from './firestore.js';
import { effectiveBranchProfile } from './branch-profile-settings.js';

const clean = (value) => String(value ?? '').trim();
const yes = (value) => ['yes', 'true', '1', 'enabled'].includes(clean(value).toLowerCase());
const safeId = (value) => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);

function error(message, status = 400) {
  const result = new Error(message);
  result.status = status;
  return result;
}

export function normalizePublicPaymentMethod(value) {
  const method = clean(value || 'paystack').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (['paystack', 'online', 'card', 'ussd', 'bank', 'paywithbank', 'onlinebanktransfer'].includes(method)) return 'paystack';
  if (['directbanktransfer', 'directtransfer', 'manualtransfer', 'transfer'].includes(method)) return 'direct_bank_transfer';
  throw error('Choose Pay online or Direct bank transfer.');
}

function configurationFromProfile(env, profile = {}, branchId = '') {
  const currency = clean(profile.PaymentBankCurrency || env.PAYMENT_BANK_CURRENCY || 'NGN').toUpperCase().slice(0, 3) || 'NGN';
  const config = {
    enabled: yes(profile.DirectBankTransferEnabled ?? env.DIRECT_BANK_TRANSFER_ENABLED),
    bankName: clean(profile.PaymentBankName || env.PAYMENT_BANK_NAME),
    accountName: clean(profile.PaymentAccountName || env.PAYMENT_ACCOUNT_NAME),
    accountNumber: clean(profile.PaymentAccountNumber || env.PAYMENT_ACCOUNT_NUMBER),
    currency,
    instructions: clean(profile.PaymentTransferInstructions || env.PAYMENT_TRANSFER_INSTRUCTIONS).slice(0, 500),
    branchId: clean(branchId || profile.EffectiveBranchId || 'main').toLowerCase() || 'main'
  };
  config.ready = config.enabled && Boolean(config.bankName && config.accountName && config.accountNumber);
  return config;
}

export async function directTransferConfiguration(env, branchId = '') {
  const saved = await getDocument(env, 'settings', 'schoolProfile').catch(() => null) || {};
  const profile = branchId ? await effectiveBranchProfile(env, saved, branchId) : saved;
  return configurationFromProfile(env, profile, branchId);
}

export async function publicPaymentMethods(env, branchId = '') {
  const saved = await getDocument(env, 'settings', 'schoolProfile').catch(() => null) || {};
  const profile = branchId ? await effectiveBranchProfile(env, saved, branchId) : saved;
  const directTransfer = configurationFromProfile(env, profile, branchId);
  return {
    online: {
      enabled: clean(profile.OnlinePaymentEnabled || 'YES').toUpperCase() !== 'NO' && Boolean(clean(env.PAYSTACK_SECRET_KEY)),
      provider: 'Paystack',
      label: 'Pay online (Card / USSD / Bank)'
    },
    directTransfer: {
      ...directTransfer,
      enabled: directTransfer.ready
    }
  };
}

function proofFields(evidence = {}) {
  const bankReference = clean(evidence.bankReference || evidence.BankReference || evidence.PaymentReference).slice(0, 160);
  if (!bankReference) throw error('Enter the bank transaction reference before submitting a direct transfer.');
  const proofDataUrl = clean(evidence.proofDataUrl || evidence.ProofDataUrl);
  if (proofDataUrl && (!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/i.test(proofDataUrl) || proofDataUrl.length > 600000)) {
    throw error('Payment proof must be a PNG, JPG, WebP or PDF file below 450 KB.');
  }
  return {
    BankReference: bankReference,
    ProofDataUrl: proofDataUrl,
    ProofFileName: clean(evidence.proofFileName || evidence.ProofFileName).replace(/[^A-Za-z0-9._ -]/g, '').slice(0, 120)
  };
}

export async function createDirectTransferRequest(env, input = {}) {
  const branchId = clean(input.branchId || input.BranchId || 'main').toLowerCase() || 'main';
  const config = await directTransferConfiguration(env, branchId);
  if (!config.ready) throw error('Direct bank transfer is not configured for this branch.', 503);
  const amount = Number(input.amount || input.Amount || 0);
  const currency = clean(input.currency || input.Currency || config.currency).toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0) throw error('The transfer amount must be greater than zero.');
  if (currency !== config.currency) throw error(`Direct transfer is available only in ${config.currency} for this bank account.`);
  const context = clean(input.context || input.Context).toLowerCase();
  if (!['admission-form', 'school-payment', 'church-donation', 'organization-store'].includes(context)) {
    throw error('This payment type does not support direct transfer yet.');
  }
  const reference = safeId(input.reference || input.Reference || `DBT-${Date.now()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`);
  const evidence = proofFields(input.evidence || input.Evidence || input);
  const request = {
    Reference: reference,
    Context: context,
    BranchId: branchId,
    Amount: Math.round(amount * 100) / 100,
    Currency: currency,
    PayerName: clean(input.payerName || input.PayerName).slice(0, 160),
    PayerEmail: clean(input.payerEmail || input.PayerEmail).toLowerCase().slice(0, 254),
    PayerPhone: clean(input.payerPhone || input.PayerPhone).slice(0, 40),
    ...evidence,
    BankName: config.bankName,
    AccountName: config.accountName,
    AccountNumber: config.accountNumber,
    Status: 'Awaiting Verification',
    Payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    CreatedAt: new Date().toISOString(),
    UpdatedAt: new Date().toISOString()
  };
  const created = await createDocumentIfAbsent(env, 'directTransferRequests', reference, request);
  const saved = created.document || request;
  if (!created.created && !['Awaiting Verification', 'Verified'].includes(clean(saved.Status))) {
    throw error('This direct-transfer request can no longer be reused.', 409);
  }
  return {
    ok: true,
    directTransfer: true,
    paymentMethod: 'Direct Bank Transfer',
    status: saved.Status,
    reference,
    message: created.created
      ? 'Transfer submitted for verification. A final receipt will be issued only after approval.'
      : 'This transfer submission was already received.',
    bankDetails: {
      bankName: config.bankName,
      accountName: config.accountName,
      accountNumber: config.accountNumber,
      currency: config.currency,
      instructions: config.instructions
    }
  };
}
