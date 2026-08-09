import {
  createDocumentIfAbsent,
  getDocument,
  queryCollection,
  requireFirestoreEnv,
  updateDocumentIfCurrent,
  upsertDocument
} from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';
import { postChurchDonationToAccounting, recordManualPayment, recordSale } from './backend.js';
import { sendSchoolFormPurchaseEmail } from './verify-form-payment.js';
import { createPaidStoreOrder } from './verify-payment.js';
import { recordManualOrganizationCommerceSale } from '../lib/organization-commerce.js';
import { saveChurchDonation } from '../lib/church-payments.js';
import { sendSchoolPaymentReceiptEmail } from '../lib/school-payment-email.js';

const clean = (value) => String(value ?? '').trim();
const safeId = (value) => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);

function error(message, status = 400) {
  const result = new Error(message);
  result.status = status;
  return result;
}

function withoutMetadata(document = {}) {
  const result = { ...document };
  delete result.__id;
  delete result.__name;
  delete result.__createTime;
  delete result.__updateTime;
  return result;
}

function contextAllowed(user = {}, context = '') {
  const allowed = new Set(user.allowedSections || []);
  if (context === 'admission-form') return allowed.has('formPurchases') || allowed.has('admissions');
  if (context === 'school-payment') return allowed.has('accounts');
  if (context === 'church-donation') return allowed.has('donations');
  if (context === 'organization-store') return allowed.has('organizationStore');
  return false;
}

function verifyScope(user = {}, request = {}) {
  if (!contextAllowed(user, clean(request.Context))) throw error('This account is not permitted to verify that transfer.', 403);
  const userBranch = clean(user.branchId).toLowerCase();
  if (userBranch && userBranch !== clean(request.BranchId || 'main').toLowerCase()) {
    throw error('This transfer belongs to another branch.', 403);
  }
}

function verificationCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('');
}

async function bankReferenceClaimId(transfer = {}) {
  const value = [transfer.BranchId || 'main', transfer.Currency, transfer.BankReference]
    .map((item) => clean(item).toLowerCase()).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function approveAdmissionForm(env, transfer, user) {
  const payload = transfer.Payload || {};
  const code = verificationCode();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + Math.max(1, Number(env.ADMISSION_FORM_EXPIRY_DAYS || 30)));
  const sale = {
    ...payload,
    AmountPaid: transfer.Amount,
    GrossAmount: transfer.Amount,
    NetAmount: transfer.Amount,
    GatewayFee: 0,
    Gateway: 'Direct Bank Transfer',
    PaymentMethod: 'Bank Transfer',
    PaymentReference: transfer.BankReference,
    ReceiptNo: `FORM-${safeId(transfer.Reference)}`,
    VerificationCode: code,
    PaymentDate: new Date().toISOString(),
    ExpiryDate: expiry.toISOString().slice(0, 10),
    BranchId: transfer.BranchId,
    Status: 'PAID',
    Used: 'NO',
    RecordedBy: clean(user.displayName || user.username)
  };
  const recorded = await recordSale(env, sale);
  const email = await sendSchoolFormPurchaseEmail(env, { ...sale, ReceiptNo: recorded.receiptNo || sale.ReceiptNo }).catch((mailError) => ({ ok: false, message: mailError.message || String(mailError) }));
  return { recorded, email, verificationCode: recorded.verificationCode || code, receiptNo: recorded.receiptNo || sale.ReceiptNo };
}

async function approveSchoolPayment(env, transfer, user) {
  const payload = transfer.Payload || {};
  const recorded = await recordManualPayment(env, {
    ...payload,
    Amount: transfer.Amount,
    GrossAmount: transfer.Amount,
    NetAmount: transfer.Amount,
    GatewayFee: 0,
    Method: 'Bank Transfer',
    Gateway: 'Direct Bank Transfer',
    Reference: transfer.Reference,
    GatewayReference: transfer.BankReference,
    PaidAt: new Date().toISOString(),
    RecordedBy: clean(user.displayName || user.username)
  });
  const storeCart = Array.isArray(payload.StoreCart) ? payload.StoreCart : [];
  const orders = [];
  for (const storeType of [...new Set(storeCart.map((item) => item.StoreType || 'Bookstore'))]) {
    const items = storeCart.filter((item) => (item.StoreType || 'Bookstore') === storeType);
    if (!items.length) continue;
    const orderNo = `${transfer.Reference}-${storeType === 'Uniform Store' ? 'UNIFORM' : 'BOOKS'}`;
    orders.push(await createPaidStoreOrder(env, {
      OrderNo: orderNo,
      StoreType: storeType,
      AccountRef: payload.AccountRef || payload.AdmissionNo,
      AccountRefNormalized: safeId(payload.AccountRef || payload.AdmissionNo).toLowerCase(),
      AdmissionNo: payload.AdmissionNo || '',
      DisplayName: payload.DisplayName || transfer.PayerName,
      ClassName: payload.ClassName || '',
      BranchId: transfer.BranchId,
      SchoolSection: payload.SchoolSection || '',
      ParentEmail: payload.ParentEmail || transfer.PayerEmail,
      Items: items,
      Amount: items.reduce((sum, item) => sum + Number(item.Amount || 0), 0),
      PaymentReference: transfer.BankReference,
      PaidAt: new Date().toISOString(),
      Status: 'Paid - Awaiting Collection',
      CreatedAt: new Date().toISOString()
    }, items, storeType));
  }
  const email = await sendSchoolPaymentReceiptEmail(env, recorded.payment || {
    ...payload,
    Amount: transfer.Amount,
    GrossAmount: transfer.Amount,
    Method: 'Bank Transfer',
    Gateway: 'Direct Bank Transfer',
    Reference: transfer.Reference,
    GatewayReference: transfer.BankReference,
    PaidAt: new Date().toISOString(),
    BranchId: transfer.BranchId,
    ParentEmail: payload.ParentEmail || transfer.PayerEmail
  }).catch((mailError) => ({
    ok: false,
    message: mailError?.message || String(mailError)
  }));
  return { recorded, orders, email };
}

async function approveOrganizationStore(env, transfer, user, context = {}) {
  const payload = transfer.Payload || {};
  return recordManualOrganizationCommerceSale(env, payload.Section || 'organizationStore', {
    ...payload,
    PaymentMethod: 'Bank Transfer',
    PaymentReference: transfer.BankReference,
    ExpectedAmount: transfer.Amount,
    SaleRequestId: payload.SaleRequestId || transfer.Reference
  }, {
    ...user,
    branchId: transfer.BranchId,
    edition: payload.OrganisationEdition || user.edition
  }, typeof context.waitUntil === 'function' ? { waitUntil: (task) => context.waitUntil(task) } : {});
}

async function approveChurchDonation(env, transfer, user) {
  const payload = transfer.Payload || {};
  const result = await saveChurchDonation(env, { ...user, branchId: transfer.BranchId }, {
    ...payload,
    DonationId: `DON-${safeId(transfer.Reference)}`,
    PaymentMethod: 'BANK TRANSFER',
    PaymentReference: transfer.BankReference,
    Reference: transfer.Reference,
    Status: 'Paid',
    BranchId: transfer.BranchId,
    sendReceipt: 'yes'
  });
  const journal = await postChurchDonationToAccounting(env, result.donation, {
    Status: 'Paid',
    PaymentMethod: 'BANK TRANSFER',
    Gateway: 'Direct Bank Transfer',
    Reference: transfer.BankReference,
    GrossAmount: transfer.Amount,
    GatewayFee: 0,
    NetAmount: transfer.Amount,
    Currency: transfer.Currency,
    PaidAt: new Date().toISOString()
  });
  return { ...result, journal };
}

async function finalizeTransfer(context, transfer, user) {
  if (transfer.Context === 'admission-form') return approveAdmissionForm(context.env, transfer, user);
  if (transfer.Context === 'school-payment') return approveSchoolPayment(context.env, transfer, user);
  if (transfer.Context === 'organization-store') return approveOrganizationStore(context.env, transfer, user, context);
  if (transfer.Context === 'church-donation') return approveChurchDonation(context.env, transfer, user);
  throw error('This transfer type cannot be finalized.', 400);
}

export async function onRequestGet(context) {
  try {
    requireFirestoreEnv(context.env);
    const user = await requireStaffSession(context.env, context.request);
    const url = new URL(context.request.url);
    const requestedReference = safeId(url.searchParams.get('reference'));
    if (requestedReference && url.searchParams.get('proof') === '1') {
      const transfer = await getDocument(context.env, 'directTransferRequests', requestedReference);
      if (!transfer) throw error('The transfer request was not found.', 404);
      verifyScope(user, transfer);
      const match = clean(transfer.ProofDataUrl).match(/^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/i);
      if (!match) throw error('No payment proof is attached to this transfer.', 404);
      const binary = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
      const extension = match[1].toLowerCase() === 'application/pdf'
        ? 'pdf'
        : match[1].toLowerCase().replace('image/', '').replace('jpeg', 'jpg');
      return new Response(binary, {
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Type': match[1],
          'Content-Disposition': `inline; filename="${safeId(transfer.ProofFileName || `payment-proof.${extension}`)}"`,
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }
    const rows = await queryCollection(context.env, 'directTransferRequests', {
      filters: [{ field: 'Status', op: '==', value: 'Awaiting Verification' }],
      limit: 100
    });
    const transfers = rows.filter((row) => contextAllowed(user, clean(row.Context)))
      .filter((row) => !clean(user.branchId) || clean(row.BranchId || 'main').toLowerCase() === clean(user.branchId).toLowerCase())
      .sort((left, right) => clean(right.CreatedAt).localeCompare(clean(left.CreatedAt)))
      .map((row) => {
        const item = withoutMetadata(row);
        item.HasProof = Boolean(clean(item.ProofDataUrl));
        delete item.ProofDataUrl;
        delete item.Payload;
        return item;
      });
    return Response.json({ ok: true, transfers }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export async function onRequestPost(context) {
  let claimed = null;
  try {
    requireFirestoreEnv(context.env);
    const user = await requireStaffSession(context.env, context.request);
    const body = await readJsonBody(context.request, { maxBytes: 64 * 1024 });
    const reference = safeId(body.Reference || body.reference);
    const action = clean(body.action).toLowerCase();
    const transfer = reference ? await getDocument(context.env, 'directTransferRequests', reference) : null;
    if (!transfer) throw error('The transfer request was not found.', 404);
    verifyScope(user, transfer);
    if (action === 'reject') {
      const reason = clean(body.Reason || body.reason).slice(0, 500);
      if (!reason) throw error('Enter the reason for rejecting this transfer.');
      if (clean(transfer.Status) !== 'Awaiting Verification') throw error('This transfer has already been processed.', 409);
      if (clean(transfer.VerificationError)) throw error('This transfer has a previous approval attempt. Retry approval so its dependent records can be completed.', 409);
      await upsertDocument(context.env, 'directTransferRequests', reference, {
        ...withoutMetadata(transfer),
        Status: 'Rejected',
        RejectionReason: reason,
        ReviewedAt: new Date().toISOString(),
        ReviewedBy: clean(user.displayName || user.username),
        UpdatedAt: new Date().toISOString()
      });
      return Response.json({ ok: true, message: 'Transfer rejected. No receipt or accounting entry was created.' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (action !== 'approve') throw error('Choose approve or reject.');
    if (clean(transfer.Status) !== 'Awaiting Verification') throw error('This transfer has already been processed.', 409);
    const bankReferenceMatches = await queryCollection(context.env, 'directTransferRequests', {
      filters: [{ field: 'BankReference', op: '==', value: transfer.BankReference }],
      limit: 20
    });
    const alreadyCredited = bankReferenceMatches.find((row) => clean(row.Reference) !== reference
      && clean(row.BranchId || 'main').toLowerCase() === clean(transfer.BranchId || 'main').toLowerCase()
      && clean(row.Currency).toUpperCase() === clean(transfer.Currency).toUpperCase()
      && clean(row.Status).toLowerCase() === 'verified');
    if (alreadyCredited) {
      throw error(`Bank reference ${transfer.BankReference} was already approved for ${alreadyCredited.Reference}.`, 409);
    }
    const bankClaimId = await bankReferenceClaimId(transfer);
    const bankClaim = await createDocumentIfAbsent(context.env, 'verifiedBankReferences', bankClaimId, {
      ClaimId: bankClaimId,
      Reference: reference,
      BankReference: transfer.BankReference,
      BranchId: transfer.BranchId,
      Currency: transfer.Currency,
      CreatedAt: new Date().toISOString()
    });
    if (!bankClaim.created && clean(bankClaim.document?.Reference) !== reference) {
      throw error(`Bank reference ${transfer.BankReference} is already assigned to another payment.`, 409);
    }
    claimed = { ...withoutMetadata(transfer), Status: 'Verification in progress', UpdatedAt: new Date().toISOString() };
    await updateDocumentIfCurrent(context.env, 'directTransferRequests', reference, claimed, transfer);
    const result = await finalizeTransfer(context, transfer, user);
    await upsertDocument(context.env, 'directTransferRequests', reference, {
      ...withoutMetadata(transfer),
      Status: 'Verified',
      VerificationError: '',
      ReviewedAt: new Date().toISOString(),
      ReviewedBy: clean(user.displayName || user.username),
      Result: result,
      UpdatedAt: new Date().toISOString()
    });
    const intent = await getDocument(context.env, 'paymentIntents', reference).catch(() => null);
    if (intent) await upsertDocument(context.env, 'paymentIntents', reference, { ...withoutMetadata(intent), Status: 'Completed', CompletedAt: new Date().toISOString() });
    const receiptDelivery = result?.email;
    const receiptNote = transfer.Context !== 'school-payment'
      ? ''
      : receiptDelivery?.ok
        ? ' The parent receipt was emailed.'
        : receiptDelivery?.skipped
          ? ` Receipt email was skipped: ${clean(receiptDelivery.message)}`
          : ` Payment was recorded, but the receipt email needs attention: ${clean(receiptDelivery?.message || 'delivery was not confirmed')}`;
    return Response.json({ ok: true, message: `Transfer verified and recorded.${receiptNote}`, result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (claimed) {
      await upsertDocument(context.env, 'directTransferRequests', safeId(claimed.Reference), {
        ...claimed,
        Status: 'Awaiting Verification',
        VerificationError: clean(error.message || error).slice(0, 500),
        UpdatedAt: new Date().toISOString()
      }).catch(() => null);
    }
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
