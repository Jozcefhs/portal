// Cloudflare Pages Function: /api/verify-form-payment
// Verifies a Paystack admission form purchase, records the form sale, and sends the school email.

import { getSchoolCode, recordSale as recordSaleInFirestore } from './backend.js';
import { getDocument, listCollection, requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { legacyGoogleDataEnabled } from '../lib/backend-mode.js';

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

function makeVerificationCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  bytes.forEach((byte) => {
    code += chars[byte % chars.length];
  });
  return code;
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function makeReceiptNo(reference, schoolCode = 'DCA') {
  const year = new Date().getFullYear();
  const prefix = String(schoolCode || 'DCA').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'DCA';
  const suffix = String(reference || '').replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  return `${prefix}/FORM/${year}/${suffix || Date.now().toString().slice(-6)}`;
}

function formatNairaAmount(value) {
  const number = Number(String(value || '0').replace(/[₦\s,]/g, ''));
  if (!Number.isFinite(number) || number <= 0) return String(value || '').trim();
  return `₦${number.toLocaleString('en-NG', {
    minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

async function getSettingsDocument(env, id) {
  try {
    requireFirestoreEnv(env);
    const rows = await listCollection(env, 'settings');
    return rows.find((row) => row.__id === id) || {};
  } catch (_err) {
    return {};
  }
}

function renderGreeting(template, applicantName, schoolName) {
  const name = String(applicantName || '').trim();
  const firstName = name.split(/\s+/)[0] || '';
  return String(template || 'Dear Parent/Guardian,')
    .replaceAll('{FULL_NAME}', name)
    .replaceAll('{FIRST_NAME}', firstName)
    .replaceAll('{SCHOOL_NAME}', schoolName || '');
}

async function sendSchoolFormPurchaseEmail(env, sale) {
  const profile = await getSettingsDocument(env, 'schoolProfile');
  const brevo = await getSettingsDocument(env, 'brevo');
  const apiKey = String(brevo.BrevoApiKey || env.BREVO_API_KEY || '').trim();
  const senderEmail = String(brevo.BrevoSenderEmail || env.BREVO_SENDER_EMAIL || env.SCHOOL_EMAIL || '').trim();
  const schoolName = String(profile.SchoolName || env.SCHOOL_NAME || 'Integrated School Management Suite').trim();
  const senderName = String(brevo.BrevoSenderName || env.BREVO_SENDER_NAME || schoolName).trim();
  if (!apiKey || !senderEmail || !sale.Email) {
    return { ok: false, skipped: true, message: 'Brevo API key, sender email, or recipient email is missing.' };
  }

  const schoolAddress = String(profile.SchoolAddress || env.SCHOOL_ADDRESS || '').trim();
  const office = 'School Office';
  const greeting = renderGreeting(profile.EmailGreetingTemplate || env.EMAIL_GREETING_TEMPLATE, sale.ApplicantName, schoolName);
  const textContent = `${greeting}

Thank you for purchasing the ${schoolName} admission form for ${sale.ApplicantName}.

Amount Paid: ${sale.AmountPaid}
Receipt No: ${sale.ReceiptNo}
Verification Code: ${sale.VerificationCode}
Code Expiry Date: ${sale.ExpiryDate}

Kindly complete the online application form using the link below:
${sale.FormLink}

Regards,
${schoolName}
${office}`;

  const htmlContent = `
    <div style="font-family:Arial,sans-serif; color:#2b2b2b; max-width:680px; border:1px solid #dbe6f2;">
      <div style="background:#eaf2ff; padding:18px 22px;">
        <h2 style="margin:0; color:#1f4e79; font-size:20px; letter-spacing:.3px;">${escapeHtml(schoolName)}</h2>
        ${schoolAddress ? `<p style="margin:8px 0 0; font-size:13px;">${escapeHtml(schoolAddress)}</p>` : ''}
      </div>
      <div style="padding:22px;">
        <h3 style="color:#1f4e79; margin-top:0;">Admission Application Form Link</h3>
        <p>${escapeHtml(greeting)}</p>
        <p>Thank you for purchasing the ${escapeHtml(schoolName)} admission form for <strong>${escapeHtml(sale.ApplicantName)}</strong>.</p>
        <div style="background:#f7f9fc; border:1px solid #dde5ef; border-radius:8px; padding:12px 14px; margin:14px 0;">
          <p style="margin:0 0 6px;"><strong>Amount Paid:</strong> ${escapeHtml(sale.AmountPaid)}</p>
          <p style="margin:0 0 6px;"><strong>Receipt No:</strong> ${escapeHtml(sale.ReceiptNo)}</p>
          <p style="margin:0 0 6px;"><strong>Verification Code:</strong> ${escapeHtml(sale.VerificationCode)}</p>
          <p style="margin:0;"><strong>Code Expiry Date:</strong> ${escapeHtml(sale.ExpiryDate)}</p>
        </div>
        <p>When the form opens, click <strong>Register</strong> and verify using the email address used for this purchase and the verification code above.</p>
        <p><a href="${escapeHtml(sale.FormLink)}" style="display:inline-block; background:#1f4e79; color:#ffffff; padding:10px 14px; border-radius:6px; text-decoration:none;">Open Application Form</a></p>
        <p>If the button does not open, copy and paste this link into your browser:<br>${escapeHtml(sale.FormLink)}</p>
        <p style="margin-top:24px;">Regards,<br><strong>${escapeHtml(schoolName)}</strong><br>${escapeHtml(office)}</p>
      </div>
    </div>`;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: sale.Email, name: sale.ApplicantName || sale.Email }],
      subject: `Admission Application Form Link - ${schoolName}`,
      textContent,
      htmlContent
    })
  });
  const detail = await response.text().catch(() => '');
  return { ok: response.ok, status: response.status, message: detail };
}

async function recordSaleInAppsScript(env, payload) {
  const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Secret: env.GOOGLE_APPS_SCRIPT_SECRET,
      Action: 'recordSale',
      ...payload
    })
  });
  const data = await response.json();
  return { response, data };
}

async function recordSale(env, payload) {
  try {
    requireFirestoreEnv(env);
    const data = await recordSaleInFirestore(env, {
      ...payload,
      CreatedBy: 'Online Payment',
      PaymentReference: payload.PaymentReference || payload.Reference || ''
    });
    return { response: { ok: true, status: 200 }, data };
  } catch (firestoreErr) {
    if (!legacyGoogleDataEnabled(env) || !env.GOOGLE_APPS_SCRIPT_URL || !env.GOOGLE_APPS_SCRIPT_SECRET) {
      return {
        response: { ok: false, status: firestoreErr.status || 500 },
        data: { ok: false, message: firestoreErr.message || String(firestoreErr) }
      };
    }
    return recordSaleInAppsScript(env, payload);
  }
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const reference = String(body.reference || '').trim();

    if (!reference) {
      return Response.json({ ok: false, message: 'Payment reference is required.' }, { status: 400 });
    }
    if (!env.PAYSTACK_SECRET_KEY) {
      return Response.json({ ok: false, message: 'Admission form payment verification is not configured yet.' }, { status: 500 });
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
    if (meta.paymentType && meta.paymentType !== 'AdmissionForm') {
      return Response.json({ ok: false, message: 'This payment is not an admission form purchase.' }, { status: 400 });
    }

    const origin = new URL(request.url).origin;
    const grossAmount = Number(tx.amount || 0) / 100;
    const gatewayFee = Math.max(0, Number(tx.fees || 0) / 100);
    const netAmount = Math.max(0, grossAmount - gatewayFee);
    const formAmount = Number(meta.formAmount || tx.requested_amount || grossAmount);
    const amountPaid = formatNairaAmount(netAmount);
    const intent = await getDocument(env, 'paymentIntents', String(tx.reference || reference).replace(/[\/\\?#\[\]]/g, '-')).catch(() => null);
    if (intent) {
      const requestedAmount = Number(tx.requested_amount || 0) / 100 || grossAmount;
      if (Math.abs(Number(intent.Amount || 0) - requestedAmount) > 0.01) {
        return Response.json({ ok: false, message: 'The verified amount does not match the initialized form purchase.' }, { status: 409 });
      }
      if (String(intent.ParentEmail || '').trim().toLowerCase() &&
          String(intent.ParentEmail).trim().toLowerCase() !== String((tx.customer && tx.customer.email) || '').trim().toLowerCase()) {
        return Response.json({ ok: false, message: 'The verified form purchase belongs to a different parent email.' }, { status: 409 });
      }
    }
    const expiryDays = Number(env.ADMISSION_FORM_EXPIRY_DAYS || 30);
    const receiptNo = makeReceiptNo(tx.reference || reference, await getSchoolCode(env));
    const basePayload = {
      ReceiptNo: receiptNo,
      ApplicantName: meta.applicantName || '',
      Email: (tx.customer && tx.customer.email) || meta.email || '',
      Phone: meta.phone || '',
      ClassApplyingFor: meta.classApplyingFor || '',
      AmountPaid: amountPaid,
      FormAmount: Number.isFinite(formAmount) && formAmount > 0 ? formAmount : grossAmount,
      GrossAmount: grossAmount,
      GatewayFee: gatewayFee,
      NetAmount: netAmount,
      Gateway: 'Paystack',
      PaymentMethod: 'Online',
      FormLink: `${origin}/verify.html`,
      PaymentDate: tx.paid_at || tx.paidAt || new Date().toISOString(),
      PaymentReference: tx.reference || reference,
      ExpiryDate: formatDateOnly(addDays(new Date(), Number.isFinite(expiryDays) && expiryDays > 0 ? expiryDays : 30)),
      Status: 'PAID',
      Used: 'NO'
    };

    let recordData = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const verificationCode = makeVerificationCode();
      const result = await recordSale(env, { ...basePayload, VerificationCode: verificationCode });
      recordData = result.data;
      if (recordData && recordData.ok) break;
      if (!String((recordData && recordData.message) || '').toLowerCase().includes('verification code already exists')) {
        return Response.json(recordData || { ok: false, message: 'Could not record form sale.' }, { status: 400 });
      }
    }

    if (!recordData || !recordData.ok) {
      return Response.json({ ok: false, message: 'Could not generate a unique verification code. Please contact the Admissions Office.' }, { status: 500 });
    }

    const verificationCode = recordData.verificationCode || recordData.VerificationCode || '';
    if (intent) {
      await upsertDocument(env, 'paymentIntents', String(tx.reference || reference).replace(/[\/\\?#\[\]]/g, '-'), {
        ...intent,
        Status: 'Completed',
        CompletedAt: new Date().toISOString(),
        GrossAmount: grossAmount,
        GatewayFee: gatewayFee,
        NetAmount: netAmount,
        ReceiptNo: receiptNo
      });
    }
    const emailResult = await sendSchoolFormPurchaseEmail(env, {
      ...basePayload,
      VerificationCode: verificationCode
    }).catch((err) => ({ ok: false, message: String(err && err.message ? err.message : err) }));

    return Response.json({
      ok: true,
      message: recordData.duplicate ? 'Admission form purchase was already recorded.' : 'Admission form purchase verified and recorded.',
      applicantName: basePayload.ApplicantName,
      email: basePayload.Email,
      receiptNo,
      verificationCode,
      amount: netAmount,
      grossAmount,
      gatewayFee,
      netAmount,
      currency: tx.currency || 'NGN',
      reference: tx.reference || reference,
      formLink: basePayload.FormLink,
      expiryDate: recordData.expiryDate || basePayload.ExpiryDate,
      schoolEmailSent: Boolean(emailResult && emailResult.ok),
      schoolEmailMessage: emailResult && emailResult.message ? String(emailResult.message).slice(0, 300) : ''
    });
  } catch (err) {
    return Response.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
