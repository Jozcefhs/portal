// Cloudflare Pages Function: /api/verify-payment
// Verifies Paystack payment and records it in the configured backend.

import { postChurchDonationToAccounting, recordManualPayment } from './backend.js';
import { batchUpsertDocuments, createDocumentIfAbsent, getDocument, upsertDocument } from '../lib/firestore.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';
import { markDonationPaidByReference, sendChurchDonationReceipt } from '../lib/church-payments.js';
import { registerDonorFromPaidDonation } from '../lib/church-donation-management.js';
import { finalizeOnlineOrganizationCommerceSale } from '../lib/organization-commerce.js';
import { paymentIntentReference, paymentIntentType } from '../lib/payment-intent.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';

function safeId(value) { return String(value || '').replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140); }

function clean(value) {
  return String(value || '').trim();
}

function paymentType(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isAdmissionFormType(value) {
  return ['admissionform', 'admissionformpurchase', 'formpurchase'].includes(paymentType(value));
}

function withoutFirestoreMetadata(document = {}) {
  const payload = { ...document };
  delete payload.__id;
  delete payload.__name;
  delete payload.__createTime;
  delete payload.__updateTime;
  return payload;
}

function storeItemDemand(items, storeType) {
  const demand = new Map();
  for (const item of items) {
    const documentId = safeId(`${storeType}-${item.ItemCode}`);
    const previous = demand.get(documentId);
    demand.set(documentId, {
      documentId,
      itemCode: clean(item.ItemCode),
      itemName: clean(item.ItemName || item.FeeName || item.ItemCode),
      quantity: Number(previous?.quantity || 0) + Math.max(1, Number(item.Quantity || 1))
    });
  }
  return [...demand.values()];
}

async function createPaidStoreOrder(env, orderData, items, storeType) {
  const documentId = safeId(orderData.OrderNo);
  if (await getDocument(env, 'storeOrders', documentId).catch(() => null)) {
    return { created: false, warning: '' };
  }

  const demand = storeItemDemand(items, storeType);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const stockRows = await Promise.all(demand.map(async (entry) => ({
      ...entry,
      stock: await getDocument(env, 'storeItems', entry.documentId).catch(() => null)
    })));
    const unavailable = stockRows.filter(({ stock, quantity }) => !stock || Number(stock.Quantity || 0) < quantity);
    if (unavailable.length) {
      const issue = unavailable
        .map(({ itemName, quantity, stock }) => `${itemName}: requested ${quantity}, available ${Number(stock?.Quantity || 0)}`)
        .join('; ');
      const created = await createDocumentIfAbsent(env, 'storeOrders', documentId, {
        ...orderData,
        InventoryStatus: 'Review Required',
        InventoryIssue: issue
      });
      return {
        created: created.created,
        warning: created.created ? `Inventory review required for ${storeType}: ${issue}` : ''
      };
    }

    const updatedAt = new Date().toISOString();
    const writes = [
      {
        collectionPath: 'storeOrders',
        documentId,
        data: { ...orderData, InventoryStatus: 'Deducted' },
        exists: false
      },
      ...stockRows.map(({ documentId: stockId, stock, quantity }) => ({
        collectionPath: 'storeItems',
        documentId: stock.__id || stockId,
        data: {
          ...withoutFirestoreMetadata(stock),
          Quantity: Number(stock.Quantity || 0) - quantity,
          UpdatedAt: updatedAt
        },
        updateTime: stock.__updateTime
      }))
    ];
    try {
      await batchUpsertDocuments(env, writes);
      return { created: true, warning: '' };
    } catch (error) {
      if (![409, 412].includes(Number(error?.status))) throw error;
      if (await getDocument(env, 'storeOrders', documentId).catch(() => null)) {
        return { created: false, warning: '' };
      }
      if (attempt === 0) continue;
      const created = await createDocumentIfAbsent(env, 'storeOrders', documentId, {
        ...orderData,
        InventoryStatus: 'Review Required',
        InventoryIssue: 'Inventory changed during payment confirmation. Reconcile this order before collection.'
      });
      return {
        created: created.created,
        warning: created.created
          ? `Inventory review required for ${storeType}: stock changed during payment confirmation.`
          : ''
      };
    }
  }
  return { created: false, warning: '' };
}

function extractMetadata(data) {
  const metadata = data && data.metadata;
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch (_err) {
      return {};
    }
  }
  return metadata;
}

async function recordInAppsScript(env, payload) {
  const recordRes = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return recordRes.json();
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    const reference = String(body.reference || '').trim();

    if (!reference) {
      return Response.json({ ok: false, message: 'Payment reference is required.' }, { status: 400 });
    }

    const firestoreConfigured = env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY;
    const appsScriptConfigured = legacyGoogleDataEnabled(env) && env.GOOGLE_APPS_SCRIPT_URL && env.GOOGLE_APPS_SCRIPT_SECRET;

    if (!env.PAYSTACK_SECRET_KEY || (!firestoreConfigured && !appsScriptConfigured)) {
      return Response.json({ ok: false, message: 'Online payment verification is not configured yet.' }, { status: 500 });
    }

    const paystackRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }
    });
    const paystackData = await paystackRes.json();
    if (!paystackData.status || !paystackData.data || paystackData.data.status !== 'success') {
      return Response.json({ ok: false, message: paystackData.message || 'Payment has not been confirmed.' }, { status: 400 });
    }

    const tx = paystackData.data;
    const meta = extractMetadata(tx);
    const amount = Number(tx.amount || 0) / 100;
    const gatewayFee = Math.max(0, Number(tx.fees || 0) / 100);
    const netAmount = Math.max(0, amount - gatewayFee);
    const intent = firestoreConfigured ? await getDocument(env, 'paymentIntents', safeId(tx.reference || reference)).catch(() => null) : null;
    const metadataPaymentType = clean(meta.paymentType || meta.PaymentType);
    const storedIntentType = paymentIntentType(intent);
    if (metadataPaymentType && storedIntentType && paymentType(metadataPaymentType) !== paymentType(storedIntentType)) {
      return Response.json({ ok: false, message: 'The transaction metadata does not match its saved payment intent.' }, { status: 409 });
    }
    if (isAdmissionFormType(metadataPaymentType) || isAdmissionFormType(storedIntentType)) {
      return Response.json({
        ok: false,
        message: 'This is an admission form purchase and must be verified by the admission form payment verifier.'
      }, { status: 400 });
    }
    const resolvedPaymentType = paymentType(metadataPaymentType || storedIntentType);
    const isChurchDonation = resolvedPaymentType === 'churchdonation';
    const isOrganizationCommerce = resolvedPaymentType === 'organizationcommerce';
    if (isChurchDonation) {
      const requestedCurrency = clean(meta.currency || meta.Currency).toUpperCase();
      const settledCurrency = clean(tx.currency || 'NGN').toUpperCase();
      if (requestedCurrency && requestedCurrency !== settledCurrency) {
        return Response.json({ ok: false, message: 'The verified donation currency does not match the initialized payment.' }, { status: 409 });
      }
      const requestedDonationAmount = Number(meta.amount || meta.Amount || 0);
      const settledRequestedAmount = Number(tx.requested_amount || tx.amount || 0) / 100;
      if (requestedDonationAmount > 0 && Math.abs(requestedDonationAmount - settledRequestedAmount) > 0.01) {
        return Response.json({ ok: false, message: 'The verified donation amount does not match the initialized payment.' }, { status: 409 });
      }
    }
    if (isOrganizationCommerce && !intent) {
      return Response.json({
        ok: false,
        message: 'The saved organisation commerce payment intent was not found.'
      }, { status: 409 });
    }
    if (intent) {
      const savedReference = paymentIntentReference(intent);
      if (savedReference && clean(tx.reference || reference).toLowerCase() !== savedReference.toLowerCase()) {
        return Response.json({ ok: false, message: 'The verified transaction reference does not match the saved payment intent.' }, { status: 409 });
      }
      const requestedAmount = Number(tx.requested_amount || 0) / 100 || amount;
      if (Math.abs(Number(intent.Amount || 0) - requestedAmount) > 0.01) {
        return Response.json({ ok: false, message: 'The verified amount does not match the initialized payment.' }, { status: 409 });
      }
      if (String(intent.AccountRef || '').trim() && String(meta.accountRef || '').trim() &&
          String(intent.AccountRef).trim().toLowerCase() !== String(meta.accountRef).trim().toLowerCase()) {
        return Response.json({ ok: false, message: 'The verified payment belongs to a different student account.' }, { status: 409 });
      }
      if (isOrganizationCommerce && clean(meta.commerceSaleId) &&
          clean(meta.commerceSaleId).toLowerCase() !== clean(intent.SaleId).toLowerCase()) {
        return Response.json({ ok: false, message: 'The verified transaction belongs to a different commerce sale.' }, { status: 409 });
      }
      if (isOrganizationCommerce && clean(meta.commerceSection) &&
          clean(meta.commerceSection) !== clean(intent.SaleType)) {
        return Response.json({ ok: false, message: 'The verified transaction belongs to a different commerce workspace.' }, { status: 409 });
      }
    }
    if (!body.idempotencyKey && !body.IdempotencyKey && !request.headers.get('Idempotency-Key')) {
      body.idempotencyKey = `verify:${safeId(reference)}`;
    }
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: 'verify-payment',
      actor: clean(meta.accountRef || meta.applicationReference || meta.donationId || meta.commerceSaleId || intent?.SaleId || tx.reference),
      ttlMinutes: 30 * 24 * 60,
      fingerprintPayload: { reference: tx.reference || reference }
    });
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }

    const paymentPayload = {
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'recordOnlinePayment',
      AccountRef: meta.accountRef || meta.applicationReference,
      ApplicationReference: meta.applicationReference || '',
      AdmissionNo: meta.admissionNo || '',
      DisplayName: meta.displayName || '',
      ClassName: meta.className || '',
      StudentType: meta.studentType || '',
      AcademicSession: meta.academicSession || '',
      Term: meta.term || '',
      FeeCode: meta.feeCode || 'ONLINE_PAYMENT',
      FeeName: meta.feeName || 'Online Payment',
      FeeCategory: meta.feeCategory || '',
      PaymentType: meta.paymentType || '',
      FeeItems: meta.feeItems ? JSON.stringify(meta.feeItems) : '',
      StoreCart: meta.storeCart ? JSON.stringify(meta.storeCart) : '',
      Amount: amount,
      GrossAmount: amount,
      GatewayFee: gatewayFee,
      NetAmount: netAmount,
      Currency: tx.currency || 'NGN',
      Gateway: 'Paystack',
      Method: 'Online',
      Reference: tx.reference,
      GatewayReference: tx.reference,
      Channel: tx.channel || '',
      PaidAt: tx.paid_at || tx.paidAt || '',
      ReceiptNo: tx.receipt_number || '',
      Metadata: JSON.stringify({
        paystackId: tx.id,
        gatewayResponse: tx.gateway_response,
        fees: tx.fees,
        requestedAmount: tx.requested_amount,
        metadata: meta
      })
    };

    let recordData = null;
    const recordErrors = [];
    let commerceResult = null;
    if (firestoreConfigured && isOrganizationCommerce) {
      try {
        commerceResult = await finalizeOnlineOrganizationCommerceSale(env, intent, {
          SaleId: clean(meta.commerceSaleId || intent?.SaleId),
          SaleType: clean(meta.commerceSection || intent?.SaleType),
          GrossAmount: amount,
          GatewayFee: gatewayFee,
          NetAmount: netAmount,
          Reference: tx.reference,
          PaidAt: tx.paid_at || tx.paidAt || new Date().toISOString(),
          PaymentMethod: 'Paystack Online'
        }, typeof context.waitUntil === 'function'
          ? { waitUntil: (task) => context.waitUntil(task) }
          : {});
        if (commerceResult?.ok) {
          recordData = { ok: true, payment: commerceResult.sale };
        } else {
          recordErrors.push(`Organisation commerce: ${commerceResult?.message || 'record failed'}`);
        }
      } catch (err) {
        recordErrors.push(`Organisation commerce: ${err?.message || String(err)}`);
      }
    }
    if (firestoreConfigured && !isChurchDonation && !isOrganizationCommerce) {
      try {
        const firestoreData = await recordManualPayment(env, paymentPayload);
        if (firestoreData && firestoreData.ok) {
          recordData = firestoreData;
        } else {
          recordErrors.push(`Database: ${(firestoreData && firestoreData.message) || 'record failed'}`);
        }
      } catch (err) {
        recordErrors.push(`Database: ${err && err.message ? err.message : String(err)}`);
      }
    }
    if (!isOrganizationCommerce && appsScriptConfigured && (!firestoreConfigured || !isChurchDonation)) {
      try {
        const sheetData = await recordInAppsScript(env, paymentPayload);
        if (sheetData && sheetData.ok) {
          recordData = recordData || sheetData;
        } else {
          recordErrors.push(`Google Sheets: ${(sheetData && sheetData.message) || 'record failed'}`);
        }
      } catch (err) {
        recordErrors.push(`Google Sheets: ${err && err.message ? err.message : String(err)}`);
      }
    }

    let donation = null;
    let donationReceipt = null;
    let donationJournal = null;
    if (isChurchDonation) {
      try {
        donation = await markDonationPaidByReference(env, tx.reference || reference, {
          BranchId: meta.branchId || meta.BranchId,
          DonationId: meta.donationId || meta.DonationId,
          PaymentMethod: 'ONLINE',
          Status: 'Paid',
          PaidAt: tx.paid_at || tx.paidAt || new Date().toISOString(),
          GrossAmount: amount,
          GatewayFee: gatewayFee,
          NetAmount: netAmount,
          Currency: clean(tx.currency || 'NGN').toUpperCase(),
          Gateway: 'Paystack',
          GatewayReference: tx.reference,
          UpdatedBy: 'Paystack Verification'
        });
        if (donation) {
          await registerDonorFromPaidDonation(env, donation).catch(() => null);
          donationReceipt = await sendChurchDonationReceipt(env, donation, {
            donorName: donation.DonorName,
            subject: clean(meta.receiptSubject || meta.subject || donation.ReceiptSubject || 'Payment confirmation - Church Donation'),
            message: clean(meta.receiptMessage || meta.message || donation.ReceiptMessage || 'Thank you for your support.'),
            paymentLink: ''
          }).catch((error) => ({ ok: false, message: error?.message || String(error) }));
          if (donationReceipt?.ok) {
            recordErrors.push('');
          } else if (donationReceipt?.skipped) {
            recordErrors.push('Church donation receipt was not sent because email is not configured.');
          } else {
            recordErrors.push(`Church receipt: ${donationReceipt?.message || 'unable to send payment receipt'}`);
          }
          try {
            donationJournal = await postChurchDonationToAccounting(env, donation, {
              Status: 'Paid',
              PaymentMethod: 'ONLINE',
              Gateway: 'Paystack',
              Reference: tx.reference,
              GrossAmount: amount,
              GatewayFee: gatewayFee,
              NetAmount: netAmount,
              Currency: clean(tx.currency || 'NGN').toUpperCase(),
              PaidAt: tx.paid_at || tx.paidAt || new Date().toISOString()
            });
          } catch (accountingError) {
            recordErrors.push(`Church donation accounting: ${accountingError?.message || String(accountingError)}`);
          }
        } else {
          recordErrors.push('Church donation record was not found for the payment reference.');
        }
      } catch (err) {
        recordErrors.push(`Church donation: ${err?.message || String(err)}`);
      }
    }

    if (!recordData || !recordData.ok) {
      const churchHandled = isChurchDonation && donation;
      const commerceHandled = isOrganizationCommerce && commerceResult?.ok;
      if (!churchHandled && !commerceHandled) {
        const error = new Error(recordErrors.length
          ? `Payment confirmed, but backend recording failed. ${recordErrors.filter(Boolean).join(' | ')}`
          : 'Payment confirmed, but it could not be recorded.');
        error.status = 502;
        error.retryable = true;
        throw error;
      }
    }

    if (firestoreConfigured) {
      if (gatewayFee > 0) {
        const feeId = safeId(`PAYSTACK-FEE-${tx.reference}`);
        await upsertDocument(env, 'paymentGatewayCharges', feeId, {
          ChargeId: feeId,
          Date: tx.paid_at || new Date().toISOString(),
          Description: `Paystack transaction charge - ${tx.reference}`,
          Amount: gatewayFee,
          GrossCollection: amount,
          NetSettlement: netAmount,
          Treatment: isOrganizationCommerce ? 'DeductedBeforeRevenueSettlement' : 'DeductedBeforeStudentCredit',
          Status: 'Recorded',
          Reference: tx.reference,
          Source: isChurchDonation
            ? 'Church Donation / Paystack'
            : (isOrganizationCommerce ? 'Organisation Commerce / Paystack' : 'Paystack'),
          CreatedAt: new Date().toISOString()
        });
      }
      const paidItems = Array.isArray(meta.storeCart) ? meta.storeCart : [];
      const feeCandidates = Array.isArray(meta.feeItems) && meta.feeItems.length ? meta.feeItems : [{ FeeCode: meta.feeCode, FeeName: meta.feeName, FeeCategory: meta.feeCategory, Amount: amount }];
      const includedItems = !paidItems.length
        ? feeCandidates.filter((item) => /book|uniform|wear/i.test(`${item.FeeCategory || ''} ${item.FeeName || ''}`)).map((item) => ({
          ItemCode: item.FeeCode, ItemName: item.FeeName, StoreType: /uniform|wear/i.test(`${item.FeeCategory || ''} ${item.FeeName || ''}`) ? 'Uniform Store' : 'Bookstore', Quantity: 1, UnitPrice: Number(item.Amount || 0), Amount: Number(item.Amount || 0), IncludedInSchoolFees: 'YES'
        })) : [];
      const orderItems = paidItems.length ? paidItems : includedItems;
      if (!isOrganizationCommerce && orderItems.length) {
        for (const storeType of [...new Set(orderItems.map((item) => item.StoreType || 'Bookstore'))]) {
          const items = orderItems.filter((item) => (item.StoreType || 'Bookstore') === storeType);
          const orderNo = `${tx.reference}-${storeType === 'Uniform Store' ? 'UNIFORM' : 'BOOKS'}`;
          const orderResult = await createPaidStoreOrder(env, {
            OrderNo: orderNo, StoreType: storeType, AccountRef: meta.accountRef || meta.admissionNo,
            AccountRefNormalized: safeId(meta.accountRef || meta.admissionNo).toLowerCase(),
            AdmissionNo: meta.admissionNo || '', DisplayName: meta.displayName || '', ClassName: meta.className || '',
            BranchId: items[0]?.BranchId || 'main', SchoolSection: items[0]?.SchoolSection || '',
            ParentEmail: meta.verificationEmail || '', Items: items, Amount: items.reduce((sum, item) => sum + Number(item.Amount || 0), 0),
            PaymentReference: tx.reference, PaidAt: tx.paid_at || new Date().toISOString(), Status: 'Paid - Awaiting Collection', CreatedAt: new Date().toISOString()
          }, items, storeType);
          if (orderResult.warning) recordErrors.push(orderResult.warning);
        }
      }
      if (intent) {
        await upsertDocument(env, 'paymentIntents', safeId(tx.reference || reference), {
          ...intent,
          Status: 'Completed',
          CompletedAt: new Date().toISOString(),
          GrossAmount: amount,
          GatewayFee: gatewayFee,
          NetAmount: netAmount
        });
      }
    }

    const warningText = recordErrors.filter(Boolean).join(' | ');
    const result = {
      ok: true,
      message: warningText ? `Payment verified and recorded with warning: ${warningText}` : 'Payment verified and recorded.',
      payment: recordData?.payment || {},
      donation: donation || null,
      reference: tx.reference,
      amount,
      grossAmount: amount,
      gatewayFee,
      netAmount,
      currency: tx.currency || 'NGN',
      feeName: isChurchDonation
        ? 'Church Donation'
        : (isOrganizationCommerce ? `${commerceResult?.sale?.Department || 'Organisation'} sale` : (meta.feeName || 'Online Payment')),
      commerceSale: commerceResult?.sale || null,
      donationJournal: donationJournal || null,
      receipt: donationReceipt || null,
      receiptStatus: donationReceipt ? (donationReceipt.ok ? 'sent' : (donationReceipt.skipped ? 'skipped' : 'failed')) : null
    };
    await completeIdempotentRequest(env, idempotency, result, 200);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, err);
    return Response.json({ ok: false, message: err.message || String(err) }, {
      status: err.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
