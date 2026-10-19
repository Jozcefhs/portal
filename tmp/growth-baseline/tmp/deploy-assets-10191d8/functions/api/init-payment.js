// Cloudflare Pages Function: /api/init-payment
// Initializes Paystack checkout from the backend so the secret key stays private.

import { getPayableFees, getSchoolCode, SCHOOL_FEES_TOTAL_CODE } from './backend.js';
import { createDocumentIfAbsent, findOneByField, getDocument, requireFirestoreEnv } from '../lib/firestore.js';
import { normalizeClassKey } from '../lib/class-names.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';

const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize';
function cleanReference(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.=-]/g, '-');
}

function safeDocumentId(value) {
  return String(value || '').replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);
}

function toAmount(value) {
  const amount = Number(String(value || '0').replace(/,/g, ''));
  return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) / 100 : 0;
}

function allScope(value) {
  return !String(value || '').trim() || ['all', '*'].includes(String(value).trim().toLowerCase());
}

export function normalizeStoreGender(value) {
  const text = String(value || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (['m', 'male', 'boy', 'boys', 'malestudent'].includes(text)) return 'male';
  if (['f', 'female', 'girl', 'girls', 'femalestudent'].includes(text)) return 'female';
  return text;
}

export function storeGenderMatches(configured, actual) {
  if (allScope(configured)) return true;
  const wanted = normalizeStoreGender(actual);
  if (!wanted) return false;
  return String(configured).split(/[,;|]+/).map(normalizeStoreGender).filter(Boolean).includes(wanted);
}

function normalizedStoreSection(record = {}) {
  const classKey = normalizeClassKey(record.ClassName || record.ClassAdmitted || '');
  if (/^(creche|prenursery|nursery[1-3]|primary[1-6])$/.test(classKey)) return 'primary';
  if (/^(jss[1-3]|ss[1-3])$/.test(classKey)) return 'secondary';
  return String(record.SchoolSection || '').trim().toLowerCase();
}

function normalizedStoreBranch(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['mainbranch', 'default'].includes(key) ? 'main' : key;
}

export function storeItemIsPurchasable(item = {}, account = {}) {
  const itemSection = normalizedStoreSection(item);
  const accountSection = normalizedStoreSection(account);
  const sectionMatches = allScope(item.SchoolSection) || !accountSection || itemSection === accountSection;
  const itemBranch = normalizedStoreBranch(item.BranchId);
  const accountBranch = normalizedStoreBranch(account.BranchId);
  const branchMatches = allScope(item.BranchId) || !accountBranch || itemBranch === accountBranch;
  return branchMatches && sectionMatches;
}

function isWalletFee(fee) {
  return fee && (String(fee.FeeCode || '').trim() === 'WALLET_TOPUP' || String(fee.FeeCategory || '').trim().toLowerCase() === 'wallet');
}

function isSchoolFee(fee) {
  return fee && !isWalletFee(fee) && String(fee.FeeCategory || 'School Fee').trim().toLowerCase() === 'school fee';
}

function isYes(value) {
  return ['yes', 'y', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function schoolFeeInstallmentRules(components) {
  const total = toAmount((components || []).reduce((sum, item) => sum + toAmount(item.Amount), 0));
  const installmentItems = (components || []).filter((item) => {
    const mode = String(item.PartPaymentMode || 'Item').trim().toLowerCase();
    return isYes(item.AllowInstallment) && (mode === 'total' || mode === 'both');
  });
  const installmentMinimum = installmentItems.reduce((max, item) => Math.max(max, toAmount(item.MinAmount)), 0);
  const minimumInstallmentPortion = installmentItems.length && installmentMinimum <= 0 ? 1 : installmentMinimum;
  const minAmount = Math.min(total, minimumInstallmentPortion);
  const allowInstallment = installmentItems.length > 0 && minAmount < total;
  return { total, minAmount, maxAmount: total, allowInstallment };
}

function allocateSchoolFeePayment(components, amount) {
  let remaining = toAmount(amount);
  const allocations = [];
  const totalMode = (components || []).some((item) => isYes(item.AllowInstallment) && ['total', 'both'].includes(String(item.PartPaymentMode || '').toLowerCase()));
  const ordered = totalMode ? [...(components || [])] : [
    ...(components || []).filter((item) => !isYes(item.AllowInstallment)),
    ...(components || []).filter((item) => isYes(item.AllowInstallment))
  ];
  ordered.forEach((item) => {
    const componentAmount = toAmount(item.Amount);
    if (componentAmount <= 0) return;
    let payAmount = 0;
    if (!totalMode && !isYes(item.AllowInstallment)) {
      payAmount = componentAmount;
    } else if (remaining > 0) {
      payAmount = Math.min(componentAmount, remaining);
    }
    remaining = toAmount(remaining - payAmount);
    if (payAmount > 0) {
      allocations.push({
        FeeCode: item.FeeCode,
        FeeName: item.FeeName,
        FeeCategory: item.FeeCategory || 'School Fee',
        Amount: payAmount,
        OriginalAmount: componentAmount,
        Currency: item.Currency || 'NGN',
        AcademicSession: item.AcademicSession || '',
        Term: item.Term || '',
        AllowInstallment: item.AllowInstallment || '',
        MinAmount: item.MinAmount || '',
        MaxAmount: item.MaxAmount || ''
      });
    }
  });
  return allocations;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim().toUpperCase();
    const feeCode = String(body.feeCode || '').trim();
    const accountRef = String(body.accountRef || body.AccountRef || '').trim();
    const sourceType = String(body.sourceType || body.SourceType || '').trim();
    const scopePath = String(body.scopePath || body.ScopePath || '').trim();
    const requestedAmount = Number(String(body.amount || '0').replace(/,/g, ''));

    if (!email || !code || !feeCode) {
      return Response.json({ ok: false, message: 'Email, verification code, and fee are required.' }, { status: 400 });
    }

    if (!env.PAYSTACK_SECRET_KEY) {
      return Response.json({ ok: false, message: 'Online payment is not configured yet.' }, { status: 500 });
    }

    let feeData = null;
    try {
      requireFirestoreEnv(env);
      feeData = await getPayableFees(env, {
        Email: email,
        VerificationCode: code,
        AccountRef: accountRef,
        SourceType: sourceType,
        ScopePath: scopePath
      });
    } catch (firestoreErr) {
      if (!legacyGoogleDataEnabled(env) || !env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
        return Response.json({ ok: false, message: firestoreErr.message || String(firestoreErr) }, { status: firestoreErr.status || 500 });
      }
    }
    if (!feeData && legacyGoogleDataEnabled(env) && env.GOOGLE_APPS_SCRIPT_URL && env.GOOGLE_APPS_SCRIPT_SECRET) {
      const feeRes = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
          Action: 'getPayableFees',
          Email: email,
          VerificationCode: code,
          AccountRef: accountRef,
          SourceType: sourceType,
          ScopePath: scopePath
        })
      });
      feeData = await feeRes.json();
    }
    if (!feeData.ok) {
      return Response.json(feeData, { status: 400 });
    }
    const payableAccount = feeData.account || {};

    let storeCart = [];
    let fee = (feeData.fees || []).find((item) => String(item.FeeCode || '').trim() === feeCode);
    if (feeCode === 'STORE_CART') {
      const requestedCart = Array.isArray(body.storeCart) ? body.storeCart.slice(0, 25) : [];
      storeCart = await Promise.all(requestedCart.map(async (entry) => {
        const itemCode = String(entry.itemCode || '').trim();
        const storeType = String(entry.storeType || '').trim();
        const direct = await getDocument(env, 'storeItems', safeDocumentId(`${storeType}-${itemCode}`)).catch(() => null);
        const fallback = direct || await findOneByField(env, 'storeItems', 'ItemCode', itemCode).catch(() => null);
        const item = fallback && String(fallback.StoreType || '').trim() === storeType && storeItemIsPurchasable(fallback, payableAccount) ? fallback : null;
        if (!item || !isYes(item.Active === undefined ? 'YES' : item.Active)) throw new Error('A selected store item is no longer available.');
        const quantity = Math.max(1, Math.floor(toAmount(entry.quantity || 1)));
        if (quantity > toAmount(item.Quantity)) throw new Error(`${item.ItemName} does not have enough stock.`);
        return { ItemCode: item.ItemCode, ItemName: item.ItemName, StoreType: item.StoreType, CategoryId: item.CategoryId || '', Category: item.Category || '', Size: item.Size || '', Gender: item.Gender || 'All', BranchId: item.BranchId || 'main', SchoolSection: item.SchoolSection || '', Quantity: quantity, UnitPrice: toAmount(item.Price), Amount: toAmount(item.Price) * quantity };
      }));
      if (!storeCart.length) throw new Error('Choose at least one store item.');
      const cartTotal = storeCart.reduce((sum, item) => sum + item.Amount, 0);
      fee = { FeeCode: 'STORE_CART', FeeName: 'School Store Purchase', FeeCategory: 'Store', Amount: cartTotal, Currency: 'NGN', AllowInstallment: 'NO', StoreCart: storeCart };
    }
    const schoolFeeComponents = (feeData.schoolFeeBreakdown || []).filter(isSchoolFee);
    if (feeCode === SCHOOL_FEES_TOTAL_CODE && schoolFeeComponents.length) {
      const rules = schoolFeeInstallmentRules(schoolFeeComponents);
      fee = {
        FeeCode: SCHOOL_FEES_TOTAL_CODE,
        FeeName: 'School Fees Total',
        FeeCategory: 'School Fee',
        Amount: rules.total,
        Currency: schoolFeeComponents[0].Currency || 'NGN',
        AllowInstallment: rules.allowInstallment ? 'YES' : 'NO',
        MinAmount: rules.allowInstallment ? rules.minAmount : '',
        MaxAmount: rules.total,
        PaymentType: 'SchoolFeesTotal',
        AcademicSession: schoolFeeComponents[0].AcademicSession || '',
        Term: schoolFeeComponents[0].Term || '',
        Components: schoolFeeComponents.map((item) => ({
          FeeCode: item.FeeCode,
          FeeName: item.FeeName,
          FeeCategory: item.FeeCategory || 'School Fee',
          Amount: toAmount(item.Amount),
          OriginalAmount: toAmount(item.OriginalAmount || item.Amount),
          PaidAmount: toAmount(item.PaidAmount),
          BalanceAmount: toAmount(item.BalanceAmount || item.Amount),
          Currency: item.Currency || schoolFeeComponents[0].Currency || 'NGN',
          AcademicSession: item.AcademicSession || '',
          Term: item.Term || '',
          AllowInstallment: item.AllowInstallment || '',
          PartPaymentMode: item.PartPaymentMode || 'Item',
          MinAmount: item.MinAmount || '',
          MaxAmount: item.MaxAmount || ''
        }))
      };
    }
    if (!fee && feeCode === 'WALLET_TOPUP') {
      fee = {
        FeeCode: 'WALLET_TOPUP',
        FeeName: 'Student Wallet Top-up',
        FeeCategory: 'Wallet',
        Amount: 0,
        Currency: 'NGN',
        AllowInstallment: 'YES',
        MinAmount: 500,
        MaxAmount: '',
        PaymentType: 'Wallet',
        AcademicSession: feeData.account?.AcademicSession || '',
        Term: feeData.account?.Term || ''
      };
    }
    if (!fee) {
      return Response.json({ ok: false, message: 'That fee is not currently payable.' }, { status: 400 });
    }

    const isWallet = isWalletFee(fee);
    const isSchoolFeesTotal = feeCode === SCHOOL_FEES_TOTAL_CODE;
    const configuredAmount = toAmount(fee.Amount);
    const schoolFeeRules = isSchoolFeesTotal ? schoolFeeInstallmentRules(fee.Components || []) : null;
    const canPartPaySchoolFees = Boolean(schoolFeeRules && schoolFeeRules.allowInstallment);
    const partMode = String(fee.PartPaymentMode || 'Item').trim().toLowerCase();
    const canPartPayItem = !isSchoolFeesTotal && isYes(fee.AllowInstallment) && ['item', 'both'].includes(partMode);
    const amount = (isWallet || canPartPaySchoolFees || canPartPayItem) ? requestedAmount : configuredAmount;
    if (!Number.isFinite(amount) || amount <= 0) {
      return Response.json({ ok: false, message: (isWallet || canPartPaySchoolFees || canPartPayItem) ? 'Enter an amount greater than zero.' : 'This fee amount has not been configured.' }, { status: 400 });
    }
    const minAmount = toAmount(fee.MinAmount);
    const maxAmount = toAmount(fee.MaxAmount);
    if (isWallet && String(fee.WalletLimitReached || '').trim().toUpperCase() === 'YES') {
      return Response.json({ ok: false, message: 'This wallet has reached the maximum balance allowed for this class.' }, { status: 400 });
    }
    if (isWallet && minAmount > 0 && amount < minAmount) {
      return Response.json({ ok: false, message: `Minimum wallet top-up is ${minAmount}.` }, { status: 400 });
    }
    if (isWallet && maxAmount > 0 && amount > maxAmount) {
      return Response.json({ ok: false, message: `Maximum wallet top-up is ${maxAmount}.` }, { status: 400 });
    }
    if (canPartPayItem && minAmount > 0 && amount < minAmount) {
      return Response.json({ ok: false, message: `Minimum part payment is ${minAmount}.` }, { status: 400 });
    }
    if (canPartPayItem && amount > configuredAmount) {
      return Response.json({ ok: false, message: `Payment cannot exceed ${configuredAmount}.` }, { status: 400 });
    }
    if (isSchoolFeesTotal && !canPartPaySchoolFees && Math.abs(amount - configuredAmount) > 0.01) {
      return Response.json({ ok: false, message: 'Part payment is not enabled for this school fee.' }, { status: 400 });
    }
    if (canPartPaySchoolFees && schoolFeeRules.minAmount > 0 && amount < schoolFeeRules.minAmount) {
      return Response.json({ ok: false, message: `Minimum school fee payment is ${schoolFeeRules.minAmount}.` }, { status: 400 });
    }
    if (canPartPaySchoolFees && schoolFeeRules.maxAmount > 0 && amount > schoolFeeRules.maxAmount) {
      return Response.json({ ok: false, message: `Maximum school fee payment is ${schoolFeeRules.maxAmount}.` }, { status: 400 });
    }
    const schoolFeeItems = isSchoolFeesTotal
      ? allocateSchoolFeePayment(fee.Components || [], amount)
      : undefined;

    const account = payableAccount;
    const origin = new URL(request.url).origin;
    const schoolCode = await getSchoolCode(env);
    const reference = cleanReference(`${schoolCode}-${feeCode}-${account.ApplicationReference || account.AccountRef}-${Date.now()}`);
    const callbackUrl = `${origin}/payment-success.html?reference=${encodeURIComponent(reference)}`;
    await createDocumentIfAbsent(env, 'paymentIntents', safeDocumentId(reference), {
      Reference: reference,
      AccountRef: account.AccountRef,
      AccountRefNormalized: safeDocumentId(account.AccountRef).toLowerCase(),
      ApplicationReference: account.ApplicationReference || '',
      AdmissionNo: account.AdmissionNo || '',
      FeeCode: feeCode,
      FeeName: fee.FeeName,
      FeeCategory: fee.FeeCategory || '',
      Amount: amount,
      Currency: String(fee.Currency || 'NGN'),
      Status: 'Pending',
      CreatedAt: new Date().toISOString()
    });

    const paystackRes = await fetch(PAYSTACK_INIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amount * 100),
        currency: String(fee.Currency || 'NGN'),
        reference,
        callback_url: callbackUrl,
        metadata: {
          feeCode,
          feeName: fee.FeeName,
          feeCategory: fee.FeeCategory || '',
          paymentType: isWallet ? 'Wallet' : (isSchoolFeesTotal ? 'SchoolFeesTotal' : 'Fee'),
          feeItems: schoolFeeItems,
          fullSchoolFeeAmount: isSchoolFeesTotal ? configuredAmount : undefined,
          partPayment: isSchoolFeesTotal && amount < configuredAmount,
          accountRef: account.AccountRef,
          applicationReference: account.ApplicationReference,
          admissionNo: account.AdmissionNo,
          displayName: account.DisplayName,
          className: account.ClassName,
          studentType: account.StudentType,
          academicSession: account.AcademicSession,
          term: account.Term,
          verificationEmail: email
          ,storeCart: storeCart.length ? storeCart : undefined
        }
      })
    });
    const paystackData = await paystackRes.json();
    if (!paystackData.status) {
      return Response.json({ ok: false, message: paystackData.message || 'Could not start Paystack payment.' }, { status: 400 });
    }

    return Response.json({
      ok: true,
      message: 'Payment initialized.',
      authorizationUrl: paystackData.data.authorization_url,
      reference: paystackData.data.reference
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
