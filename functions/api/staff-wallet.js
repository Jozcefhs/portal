import { getWalletCardAccount, saveWalletCard } from './backend.js';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const CARD_STATUSES = Object.freeze({
  active: 'Active',
  blocked: 'Blocked',
  lost: 'Lost',
  replaced: 'Replaced'
});

export function staffWalletPayload(body = {}, user = {}, options = {}) {
  const branchId = clean(user.branchId || user.activeBranchId);
  if (!branchId || lower(branchId) === 'all') {
    throw httpError('Select one working branch before looking up or changing a student wallet.');
  }
  const action = lower(options.action || body.action);
  const accountRef = clean(body.AccountRef || body.AdmissionNo || body.accountRef);
  const cardId = clean(body.WalletCardId || body.CardId || body.cardId).toUpperCase();
  if (action === 'lookup' && !accountRef && !cardId) {
    throw httpError('Enter an admission number or wallet card ID.');
  }
  if (action === 'save') {
    if (!accountRef) throw httpError('Load a student before saving wallet setup.');
    if (!cardId) throw httpError('Wallet card ID is required.');
  }

  const walletPin = clean(body.WalletPin || body.Pin);
  if (walletPin && !/^\d{4,8}$/.test(walletPin)) {
    throw httpError('The new wallet PIN must contain 4 to 8 digits.');
  }
  const numericFields = ['WalletPinThreshold', 'WalletTxnLimit', 'WalletDailyLimit'];
  numericFields.forEach((field) => {
    if (clean(body[field]) && (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0)) {
      throw httpError(`${field.replace(/([a-z])([A-Z])/g, '$1 $2')} must be zero or a positive amount.`);
    }
  });

  const requestedStatus = lower(body.WalletCardStatus || body.CardStatus || 'active');
  if (action === 'save' && !CARD_STATUSES[requestedStatus]) {
    throw httpError('Choose a valid wallet card status.');
  }

  return {
    AccountRef: accountRef,
    WalletCardId: cardId,
    WalletCardStatus: CARD_STATUSES[requestedStatus] || 'Active',
    WalletPin: walletPin,
    WalletPinThreshold: clean(body.WalletPinThreshold),
    WalletTxnLimit: clean(body.WalletTxnLimit),
    WalletDailyLimit: clean(body.WalletDailyLimit),
    BranchId: branchId,
    UserBranchId: branchId,
    SchoolSection: clean(user.schoolSectionAccess || 'All') || 'All',
    UserSchoolSectionAccess: clean(user.schoolSectionAccess || 'All') || 'All',
    WalletUpdatedBy: clean(user.displayName || user.username)
  };
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('accounts')) {
      throw httpError('This staff account is not allowed to manage student wallets.', 403);
    }
    const body = await readJsonBody(request, { maxBytes: 32 * 1024 });
    const action = lower(body.action);
    if (!['lookup', 'save'].includes(action)) {
      throw httpError('Choose a valid wallet setup action.');
    }
    const payload = staffWalletPayload(body, user, { action });
    const result = action === 'lookup'
      ? await getWalletCardAccount(env, payload)
      : await saveWalletCard(env, payload);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json(
      { ok: false, message: error.message || String(error) },
      { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
