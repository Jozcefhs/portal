// Cloudflare Pages Function: /api/verify-payment
// Verifies Paystack payment and records it in the configured backend.

import { recordManualPayment } from './backend.js';
import { createDocumentIfAbsent, getDocument, upsertDocument } from '../lib/firestore.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';
import { markDonationPaidByReference, sendChurchDonationReceipt } from '../lib/church-payments.js';

function safeId(value) { return String(value || '').replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140); }

function clean(value) {
  return String(value || '').trim();
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
  try {
    const { request, env } = context;
    const body = await request.json();
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
    const isChurchDonation = clean(meta.paymentType).toLowerCase() === 'churchdonation';
    const amount = Number(tx.amount || 0) / 100;
    const gatewayFee = Math.max(0, Number(tx.fees || 0) / 100);
    const netAmount = Math.max(0, amount - gatewayFee);
    const intent = firestoreConfigured ? await getDocument(env, 'paymentIntents', safeId(tx.reference || reference)).catch(() => null) : null;
    if (intent) {
      const requestedAmount = Number(tx.requested_amount || 0) / 100 || amount;
      if (Math.abs(Number(intent.Amount || 0) - requestedAmount) > 0.01) {
        return Response.json({ ok: false, message: 'The verified amount does not match the initialized payment.' }, { status: 409 });
      }
      if (String(intent.AccountRef || '').trim() && String(meta.accountRef || '').trim() &&
          String(intent.AccountRef).trim().toLowerCase() !== String(meta.accountRef).trim().toLowerCase()) {
        return Response.json({ ok: false, message: 'The verified payment belongs to a different student account.' }, { status: 409 });
      }
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
    if (firestoreConfigured && !isChurchDonation) {
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
    if (appsScriptConfigured && (!firestoreConfigured || !isChurchDonation)) {
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
    if (isChurchDonation) {
      try {
        donation = await markDonationPaidByReference(env, tx.reference || reference, {
          BranchId: meta.branchId || meta.BranchId,
          DonationId: meta.donationId || meta.DonationId,
          PaymentMethod: 'ONLINE',
          Status: 'Paid',
          PaidAt: tx.paid_at || tx.paidAt || new Date().toISOString(),
          Gateway: 'Paystack',
          GatewayReference: tx.reference,
          UpdatedBy: 'Paystack Verification'
        });
        if (donation) {
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
        } else {
          recordErrors.push('Church donation record was not found for the payment reference.');
        }
      } catch (err) {
        recordErrors.push(`Church donation: ${err?.message || String(err)}`);
      }
    }

    if (!recordData || !recordData.ok) {
      const churchHandled = isChurchDonation && donation;
      if (!churchHandled) {
        return Response.json({
          ok: false,
          message: recordErrors.length
            ? `Payment confirmed, but backend recording failed. ${recordErrors.filter(Boolean).join(' | ')}`
            : 'Payment confirmed, but it could not be recorded.'
        }, { status: 400 });
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
          Treatment: 'DeductedBeforeStudentCredit',
          Status: 'Recorded',
          Reference: tx.reference,
          Source: 'Paystack',
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
      if (orderItems.length) {
        for (const storeType of [...new Set(orderItems.map((item) => item.StoreType || 'Bookstore'))]) {
          const items = orderItems.filter((item) => (item.StoreType || 'Bookstore') === storeType);
          const orderNo = `${tx.reference}-${storeType === 'Uniform Store' ? 'UNIFORM' : 'BOOKS'}`;
          const documentId = safeId(orderNo);
          const orderCreate = await createDocumentIfAbsent(env, 'storeOrders', documentId, {
            OrderNo: orderNo, StoreType: storeType, AccountRef: meta.accountRef || meta.admissionNo,
            AccountRefNormalized: safeId(meta.accountRef || meta.admissionNo).toLowerCase(),
            AdmissionNo: meta.admissionNo || '', DisplayName: meta.displayName || '', ClassName: meta.className || '',
            BranchId: items[0]?.BranchId || 'main', SchoolSection: items[0]?.SchoolSection || '',
            ParentEmail: meta.verificationEmail || '', Items: items, Amount: items.reduce((sum, item) => sum + Number(item.Amount || 0), 0),
            PaymentReference: tx.reference, PaidAt: tx.paid_at || new Date().toISOString(), Status: 'Paid - Awaiting Collection', CreatedAt: new Date().toISOString()
          });
          if (!orderCreate.created) continue;
          for (const item of items) {
            const stock = await getDocument(env, 'storeItems', safeId(`${storeType}-${item.ItemCode}`)).catch(() => null);
            if (!stock) continue;
            const payload = { ...stock, Quantity: Math.max(0, Number(stock.Quantity || 0) - Number(item.Quantity || 1)), UpdatedAt: new Date().toISOString() };
            delete payload.__id; delete payload.__name;
            await upsertDocument(env, 'storeItems', stock.__id || safeId(`${storeType}-${item.ItemCode}`), payload);
          }
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
    return Response.json({
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
      feeName: isChurchDonation ? 'Church Donation' : (meta.feeName || 'Online Payment'),
      receipt: donationReceipt || null,
      receiptStatus: donationReceipt ? (donationReceipt.ok ? 'sent' : (donationReceipt.skipped ? 'skipped' : 'failed')) : null
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
