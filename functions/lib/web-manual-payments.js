import { getAccountSnapshot, recordManualPayment, feeMatchesAccountPeriod, applyBillingCategoryOverrides } from '../api/backend.js';
import { getDocument } from './firestore.js';
import { assertManualPaymentScope } from './manual-payment-scope.js';
import { financeDate, financeFailure, financeMoney } from './accounting-mutation-guards.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const ioDefaults = { snapshot: getAccountSnapshot, record: recordManualPayment,
  payment: (env, reference) => getDocument(env, 'payments', reference) };

export function webManualPaymentScope(user = {}) {
  if (user.edition !== 'school' || !['Super Admin', 'Accounts Officer'].includes(user.role)
      || !(user.allowedSections || []).includes('accounts')) {
    throw financeFailure('Only authorised school Accounts users may record manual payments.', 403);
  }
  const branch = lower(user.branchId), section = lower(user.schoolSectionAccess || 'all');
  if (!branch || branch === 'all' || !['all', 'primary', 'secondary'].includes(section)) {
    throw financeFailure('Select one working branch before recording a payment.', 403);
  }
  return { branchId: branch, schoolSectionAccess: section === 'all' ? '' : section };
}

const period = (value, fallback) => !clean(value) || lower(value) === 'all' ? clean(fallback) : clean(value);
const choiceId = row => JSON.stringify([row.FeeCode, row.AcademicSession, row.Term]);
const publicAccount = row => Object.fromEntries(['AccountRef', 'AdmissionNo', 'DisplayName', 'ClassName',
  'SchoolSection', 'BranchId', 'AcademicSession', 'Term'].map(key => [key, clean(row[key])]));

export function webManualPaymentChoices(snapshot, account) {
  const choices = new Map();
  const add = (fee, extra = {}) => {
    const row = { FeeCode: clean(fee.FeeCode), FeeName: clean(fee.FeeName || fee.FeeCode),
      FeeCategory: clean(fee.FeeCategory), Currency: clean(fee.Currency || 'NGN').toUpperCase(),
      AcademicSession: period(fee.AcademicSession, account.AcademicSession), Term: period(fee.Term, account.Term), ...extra };
    if (!row.FeeCode) return;
    row.ChoiceId = choiceId(row);
    if (choices.has(row.ChoiceId)) throw financeFailure('Duplicate fee configuration needs finance review before recording this payment.', 409);
    choices.set(row.ChoiceId, row);
  };
  const fees = applyBillingCategoryOverrides((snapshot.feeItems || []).filter(fee =>
    !['no', 'false', '0', 'inactive'].includes(lower(fee.Active)) && feeMatchesAccountPeriod(fee, account)), account);
  for (const fee of fees) add(fee, { Amount: financeMoney(fee.Amount, 'Configured fee amount') });
  for (const invoice of snapshot.invoices || []) {
    assertManualPaymentScope(invoice, { branchId: lower(account.BranchId), schoolSectionAccess: lower(account.SchoolSection),
      references: [account.AccountRef, account.AdmissionNo, account.ApplicationReference].filter(Boolean) }, 'Invoice');
    if (['cancelled', 'canceled', 'void', 'reversed'].includes(lower(invoice.Status))) continue;
    const balance = Math.max(0, financeMoney(invoice.Debit ?? invoice.Amount ?? 0) - financeMoney(invoice.Credit ?? 0));
    if (!balance) continue;
    const key = choiceId({ FeeCode: clean(invoice.FeeCode), AcademicSession: period(invoice.AcademicSession, account.AcademicSession), Term: period(invoice.Term, account.Term) });
    const existing = choices.get(key);
    if (existing) existing.Balance = Math.round(((existing.Balance || 0) + balance) * 100) / 100;
    else add(invoice, { Balance: balance });
  }
  if (!choices.has(choiceId({ FeeCode: 'WALLET_TOPUP', AcademicSession: account.AcademicSession, Term: account.Term }))) {
    add({ FeeCode: 'WALLET_TOPUP', FeeName: 'Student Wallet Top-up', FeeCategory: 'Wallet' });
  }
  // General credit follows the existing audited school-fee allocation process.
  if (!choices.has(choiceId({ FeeCode: 'MANUAL_PAYMENT', AcademicSession: account.AcademicSession, Term: account.Term }))) {
    add({ FeeCode: 'MANUAL_PAYMENT', FeeName: 'Unallocated Account Credit', FeeCategory: '' });
  }
  if (Number(account.SchoolFeeOutstanding) > 0 && ![...choices.values()].some(row => row.FeeCode === 'SCHOOL_FEES_TOTAL')) {
    add({ FeeCode: 'SCHOOL_FEES_TOTAL', FeeName: 'School Fees Total', FeeCategory: 'School Fee' }, { Balance: financeMoney(account.SchoolFeeOutstanding) });
  }
  return [...choices.values()].sort((a, b) => a.FeeName.localeCompare(b.FeeName) || a.ChoiceId.localeCompare(b.ChoiceId));
}

export async function handleWebManualPayment(env, user, body = {}, overrides = {}) {
  const io = { ...ioDefaults, ...overrides }, scope = webManualPaymentScope(user);
  const action = lower(body.action), accountRef = clean(body.AccountRef);
  if (!['lookup', 'post'].includes(action)) throw financeFailure('Choose lookup or post.');
  if (!accountRef || accountRef.length > 180) throw financeFailure('Enter the full admission or applicant reference.');
  // Allowlist inputs; browser-supplied role, scope, gateway and account metadata are ignored.
  const actor = { UserUsername: user.username, UserRole: user.role, RecordedBy: clean(user.displayName || user.username),
    DeviceBranchId: scope.branchId, UserBranchId: scope.branchId, BranchId: scope.branchId,
    UserSchoolSectionAccess: user.schoolSectionAccess || 'All' };
  let instruction, reference, existing;
  if (action === 'post') {
    reference = clean(body.Reference);
    if (!/^WEB-MANUAL-[a-f0-9-]{36}$/i.test(reference)) throw financeFailure('Reload the payment form to obtain a valid payment reference.');
    instruction = { AccountRef: accountRef, ChoiceId: clean(body.ChoiceId), Amount: financeMoney(body.Amount, 'Payment amount', { min: 0.01 }),
      Description: clean(body.Description), Method: clean(body.Method), PaidAt: financeDate(body.PaidAt),
      PaymentProof: clean(body.PaymentProof), Actor: clean(user.username) };
    if (!instruction.ChoiceId || instruction.ChoiceId.length > 600 || !instruction.Description || instruction.Description.length > 300
        || !instruction.PaymentProof || instruction.PaymentProof.length > 200
        || !['Cash', 'Bank Transfer', 'POS', 'Cheque'].includes(instruction.Method)) {
      throw financeFailure('Choose a fee and payment method, and enter a description and payment-proof reference.');
    }
    existing = await io.payment(env, reference);
    if (existing) {
      assertManualPaymentScope(existing, scope, 'Existing payment');
      if (existing.Metadata !== JSON.stringify({ WebManualPaymentInstruction: instruction })) {
        throw financeFailure('This reference belongs to a different instruction. Check the existing receipt before starting another payment.', 409);
      }
    }
  }
  let account, choice;
  if (existing) {
    account = existing;
    choice = existing;
  } else {
    const snapshot = await io.snapshot(env, { ...actor, AccountRef: accountRef });
    account = snapshot.accounts?.[0];
    if (!account || snapshot.accounts.length !== 1) throw financeFailure('The account could not be uniquely verified.', 409);
    assertManualPaymentScope(account, scope, 'Selected account');
    const choices = webManualPaymentChoices(snapshot, account);
    if (action === 'lookup') return { ok: true, account: publicAccount(account), choices, message: 'Account and payable components loaded.' };
    choice = choices.find(row => row.ChoiceId === instruction.ChoiceId);
    if (!choice) throw financeFailure('This fee or period is no longer available for the account. Reload it before recording payment.', 409);
  }
  const result = await io.record(env, { ...actor, AccountRef: account.AccountRef, SchoolSection: account.SchoolSection,
    FeeCode: choice.FeeCode, FeeName: instruction.Description, FeeCategory: choice.FeeCategory, Currency: choice.Currency || 'NGN',
    AcademicSession: choice.AcademicSession, Term: choice.Term, Amount: instruction.Amount, Method: instruction.Method,
    PaidAt: instruction.PaidAt, Gateway: 'Manual', GatewayReference: instruction.PaymentProof,
    Reference: reference, ReferenceIsDocumentId: true, Channel: 'Web manual payment',
    Metadata: JSON.stringify({ WebManualPaymentInstruction: instruction }),
    DuplicateWalletReviewDigest: clean(body.DuplicateWalletReviewDigest) }, { reviewWalletDuplicates: true });
  if (!result.ok) return result;
  return { ok: true, duplicate: Boolean(result.duplicate), message: result.message || 'Manual payment recorded.',
    payment: { Reference: result.payment.Reference, ReceiptNo: result.payment.ReceiptNo,
      AccountRef: result.payment.AccountRef, Amount: result.payment.Amount, Currency: result.payment.Currency } };
}
