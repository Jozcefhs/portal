import { getDocument, listCollection, queryCollection, upsertDocument } from './firestore.js';
import { CHURCH_COLLECTIONS, churchCollectionPath, safeChurchDocumentId } from './church-foundation.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { resolveMembershipBranch } from './church-membership.js';

const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const nowIso = () => new Date().toISOString();

function inputError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function actorName(user = {}) {
  return clean(user.displayName || user.DisplayName || user.username || user.Username || 'Unknown staff');
}

function safeReceiptSuffix(length = 6) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase().slice(0, length);
}

function makeReceiptNo(prefix = 'CHURCH') {
  return `${prefix.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CHURCH'}/DON/${new Date().getFullYear()}/${safeReceiptSuffix(8)}`;
}

function makeDonationId(seed = '') {
  const suffix = clean(seed)
    ? clean(seed).replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 40)
    : `${new Date().getTime().toString(36).toUpperCase()}`;
  return safeChurchDocumentId(`DON-${suffix || clean(Math.random()).replace(/\./g, '')}`);
}

function makeReference(seed = '') {
  const salt = new Uint8Array(8);
  crypto.getRandomValues(salt);
  const random = [...salt].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase();
  const safe = clean(seed).replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').slice(0, 16);
  return safeChurchDocumentId(`DON-${safe || random}`);
}

function amountToNumber(value) {
  const parsed = Number(String(value ?? '0').replace(/,/g, '').trim());
  if (!Number.isFinite(parsed)) return NaN;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

const PAYMENT_METHODS = new Set(['CASH', 'BANK TRANSFER', 'CHEQUE', 'POS', 'ONLINE', 'CARD', 'MOBILE MONEY']);

function normalizePaymentMethod(value) {
  const method = clean(value).toUpperCase();
  if (!method) return 'CASH';
  return PAYMENT_METHODS.has(method) ? method : clean(value).toUpperCase().replace(/\s+/g, ' ');
}

function normalizeEmail(value) {
  const email = clean(value).toLowerCase();
  if (!email) return '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    inputError('Enter a valid donor email address.');
  }
  return email;
}

function normalizeDonationStatus(value = 'pending') {
  const status = clean(value).toLowerCase();
  if (!status) return 'Pending';
  if (status === 'completed' || status === 'paid' || status === 'cleared' || status === 'sent') return 'Paid';
  if (status === 'cancelled' || status === 'failed' || status === 'reversed') return 'Cancelled';
  return 'Pending';
}

function normalizeDonationInput(input = {}, branchId = 'main') {
  const statusHint = clean(input.Status || input.status);
  const paymentMethod = normalizePaymentMethod(input.PaymentMethod || input.paymentMethod || 'CASH');
  const donationId = safeChurchDocumentId(clean(input.DonationId || input.donationId) || makeDonationId(Date.now().toString(36).toUpperCase()));
  const amount = amountToNumber(input.Amount || input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    inputError('Donation amount must be greater than zero.');
  }
  const currency = clean(input.Currency || input.currency).toUpperCase() || 'NGN';
  if (!/^[A-Z]{3}$/.test(currency)) {
    inputError('Currency must be a three-letter code.');
  }
  const donorName = clean(input.DonorName || input.donorName);
  if (!donorName) inputError('Donor name is required.');
  const donorEmail = normalizeEmail(input.DonorEmail || input.donorEmail);
  if (!donorEmail) {
    inputError('Donor email is required.');
  }
  return {
    DonationId: donationId,
    BranchId: clean(branchId || 'main').toLowerCase() || 'main',
    DonorName: donorName,
    DonorEmail: donorEmail,
    Amount: amount,
    Currency: currency,
    PaymentMethod: paymentMethod,
    PaymentType: clean(input.PaymentType || input.paymentType) || 'Donation',
    Notes: clean(input.Notes || input.notes),
    Reference: clean(input.Reference || input.reference),
    ReceiptNo: clean(input.ReceiptNo || input.receiptNo) || makeReceiptNo(),
    ReceiptSubject: clean(input.ReceiptSubject || input.receiptSubject),
    ReceiptMessage: clean(input.ReceiptMessage || input.receiptMessage),
    Status: paymentMethod === 'ONLINE'
      ? normalizeDonationStatus(statusHint || 'Pending')
      : normalizeDonationStatus(statusHint || 'Paid'),
    Metadata: input.Metadata || input.metadata || {}
  };
}

const DONATION_VIEW_ROLES = new Set(['Super Admin', 'Pastor', 'Church Administrator', 'Treasurer', 'Auditor']);
const DONATION_MANAGE_ROLES = new Set(['Super Admin', 'Church Administrator', 'Treasurer']);

export function donationCapabilities(user = {}) {
  const role = clean(user.role || user.Role);
  return {
    canView: DONATION_VIEW_ROLES.has(role),
    canCollect: DONATION_MANAGE_ROLES.has(role),
    canSendReceipt: DONATION_MANAGE_ROLES.has(role),
    canInitiateOnline: DONATION_MANAGE_ROLES.has(role),
    canViewAudit: DONATION_VIEW_ROLES.has(role)
  };
}

function requireCapability(user = {}, capability) {
  const capabilities = donationCapabilities(user);
  if (!capabilities[capability]) {
    const error = new Error('This church role is not permitted to perform that donation action.');
    error.status = 403;
    throw error;
  }
  return capabilities;
}

async function requireDonationsEdition(env) {
  const [organizationProfile, legacyProfile] = await Promise.all([
    getDocument(env, 'settings', 'organisationProfile').catch(() => null),
    getDocument(env, 'settings', 'schoolProfile').catch(() => null)
  ]);
  const organization = resolveOrganizationConfig({ env, organizationProfile, legacyProfile });
  if (!['church', 'faith', 'organization'].includes(organization.Edition) || !organization.FeatureFlags.donations) {
    const error = new Error('Church donations are not enabled for this organisation.');
    error.status = 403;
    throw error;
  }
  return organization;
}

async function writeDonationAudit(env, branchId, user, action, donationId, details = '') {
  const auditId = `CHDON-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const payload = {
    AuditId: auditId,
    Timestamp: nowIso(),
    Action: clean(action),
    DonationId: clean(donationId),
    BranchId: branchId,
    Actor: actorName(user),
    ActorUsername: clean(user.username || user.Username),
    ActorRole: clean(user.role || user.Role),
    Details: clean(details)
  };
  await upsertDocument(env, churchCollectionPath(CHURCH_COLLECTIONS.donationAudit, branchId), auditId, payload);
}

function publicDonationRow(row = {}) {
  const copy = { ...row };
  delete copy.__name;
  return copy;
}

export function donationSummary(rows = []) {
  return rows.reduce((memo, row) => {
    const status = lower(row.Status || 'pending');
    const amount = Number(row.Amount || 0);
    memo.totalAmount += amount;
    memo.count += 1;
    if (status === 'paid') {
      memo.paid += 1;
      memo.paidAmount += amount;
    } else {
      memo.pending += 1;
      memo.pendingAmount += amount;
    }
    const method = clean(row.PaymentMethod || 'CASH').toUpperCase();
    memo.byMethod[method] = (memo.byMethod[method] || 0) + amount;
    return memo;
  }, { count: 0, paid: 0, pending: 0, paidAmount: 0, pendingAmount: 0, totalAmount: 0, byMethod: {} });
}

export async function listChurchDonations(env, user, body = {}) {
  await requireDonationsEdition(env);
  const capabilities = requireCapability(user, 'canView');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const [donations, audit] = await Promise.all([
    listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId)).catch(() => []),
    capabilities.canViewAudit
      ? listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.donationAudit, branchId)).catch(() => [])
      : Promise.resolve([])
  ]);
  const sorted = donations
    .map(publicDonationRow)
    .sort((a, b) => clean(b.UpdatedAt || b.CreatedAt).localeCompare(clean(a.UpdatedAt || a.CreatedAt)));
  return {
    ok: true,
    branchId,
    capabilities,
    donations: sorted,
    audit: audit.sort((a, b) => clean(b.Timestamp).localeCompare(clean(a.Timestamp))).slice(0, 100),
    summary: donationSummary(sorted)
  };
}

async function findDonationInBranch(env, branchId, reference, donationId = '') {
  const path = churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId);
  const candidates = [
    safeChurchDocumentId(donationId),
    safeChurchDocumentId(reference),
    clean(donationId),
    clean(reference)
  ].filter(Boolean).map((value) => safeChurchDocumentId(value));
  for (const candidate of candidates) {
    if (!candidate) continue;
    const row = await getDocument(env, path, candidate).catch(() => null);
    if (row) return row;
  }

  const rows = await queryCollection(env, path, {
    filters: [{ field: 'Reference', op: '==', value: reference }],
    limit: 3
  }).catch(() => []);
  const directMatch = rows.find((row) => clean(row.Reference || '') === clean(reference));
  if (directMatch) return directMatch;

  if (donationId) {
    const byDonationId = await queryCollection(env, path, {
      filters: [{ field: 'DonationId', op: '==', value: donationId }],
      limit: 3
    }).catch(() => []);
    const mapped = byDonationId.find((row) => clean(row.DonationId || '') === clean(donationId));
    if (mapped) return mapped;
  }

  return null;
}

async function upsertDonationRecord(env, branchId, donationId, donation, user) {
  const id = safeChurchDocumentId(donationId);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId);
  const now = nowIso();
  const existing = await getDocument(env, path, id).catch(() => null);

  const payload = {
    ...(existing || {}),
    ...donation,
    BranchId: branchId,
    DonationId: clean(donation.DonationId || donationId),
    CreatedAt: existing?.CreatedAt || now,
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: now,
    UpdatedBy: actorName(user)
  };
  if (!payload.ReceiptNo) payload.ReceiptNo = makeReceiptNo();

  delete payload.__id;
  delete payload.__name;
  await upsertDocument(env, path, id, payload);
  return payload;
}

function withReceiptStatus(payload, user) {
  const now = nowIso();
  const status = normalizeDonationStatus(payload.Status || 'Pending');
  const normalized = {
    ...payload,
    Status: status
  };
  if (status === 'Paid') {
    normalized.PaymentStatus = 'Completed';
    normalized.PaidAt = payload.PaidAt || now;
  } else {
    normalized.PaymentStatus = normalized.PaymentStatus || 'Pending';
    delete normalized.PaidAt;
  }
  return normalized;
}

async function sendReceipt(env, donation, body = {}, message = null, subject = null) {
  const send = lower(body.sendReceipt || 'yes');
  if (send === 'no' || send === 'false' || send === '0') return null;
  if (lower(donation.Status) !== 'paid') return null;
  return sendChurchDonationReceipt(env, donation, {
    donorName: clean(body.donorName || donation.DonorName),
    subject: subject || clean(body.subject || body.ReceiptSubject || body.receiptSubject),
    message: message || clean(body.message || body.ReceiptMessage || body.receiptMessage),
    paymentLink: clean(body.paymentLink || donation.PaymentLink)
  });
}

export async function saveChurchDonation(env, user, body = {}) {
  await requireDonationsEdition(env);
  const capabilities = requireCapability(user, 'canCollect');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const donation = normalizeDonationInput(body.donation || body.Donation || body, branchId);
  const path = churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId);
  const id = safeChurchDocumentId(donation.DonationId);
  const existing = await getDocument(env, path, id).catch(() => null);

  if (existing && existing.Status === 'Paid' && donation.PaymentMethod !== 'ONLINE') {
    inputError('A paid donation cannot be edited.', 409);
  }

  const now = nowIso();
  const prepared = withReceiptStatus({
    ...(existing || {}),
    ...donation,
    Status: donation.PaymentMethod === 'ONLINE' ? normalizeDonationStatus(donation.Status || 'Pending') : 'Paid',
    BranchId: branchId,
    ReceiptNo: existing?.ReceiptNo || donation.ReceiptNo,
    CreatedAt: existing?.CreatedAt || now,
    CreatedBy: existing?.CreatedBy || actorName(user),
    UpdatedAt: now,
    UpdatedBy: actorName(user)
  }, user);

  delete prepared.__id;
  delete prepared.__name;
  await upsertDocument(env, path, id, prepared);

  const action = existing ? 'UPDATE' : 'CREATE';
  await writeDonationAudit(env, branchId, user, action, prepared.DonationId, `${prepared.PaymentMethod} ${prepared.Currency} ${prepared.Amount} (${prepared.Status})`);

  const receipt = await sendReceipt(env, prepared, body, capabilities.canSendReceipt ? null : null).catch((error) => ({ ok: false, message: error?.message || String(error) }));

  return {
    ok: true,
    message: existing ? 'Donation record updated.' : 'Donation recorded.',
    donation: prepared,
    receipt
  };
}

async function findDonationByIdOrReference(env, body, branchId) {
  const donationId = clean(body.DonationId || body.donationId);
  const reference = clean(body.Reference || body.reference);
  if (donationId || reference) {
    const row = await findDonationInBranch(env, branchId, reference, donationId);
    if (row) return row;
  }
  inputError('DonationId or Reference is required.', 400);
  return null;
}

export async function setChurchDonationStatus(env, user, body = {}, status) {
  await requireDonationsEdition(env);
  requireCapability(user, 'canCollect');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const existing = await findDonationByIdOrReference(env, body, branchId);
  if (!existing) {
    inputError('Donation was not found.', 404);
  }
  if (existing.Status === 'Paid' && lower(status) !== 'paid') {
    inputError('A paid donation cannot be changed.', 409);
  }
  const now = nowIso();
  const requested = normalizeDonationStatus(status || existing.Status);
  const normalized = {
    ...(existing || {}),
    Status: requested,
    UpdatedAt: now,
    UpdatedBy: actorName(user)
  };
  if (requested === 'Paid' && !normalized.PaidAt) {
    normalized.PaidAt = now;
    normalized.PaymentStatus = 'Completed';
  }
  if (requested !== 'Paid') {
    normalized.PaymentStatus = normalized.PaymentStatus || 'Pending';
  }

  const path = churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId);
  const donationId = safeChurchDocumentId(existing.__id || existing.DonationId || existing.Reference);
  delete normalized.__id;
  delete normalized.__name;
  await upsertDocument(env, path, donationId, normalized);
  await writeDonationAudit(env, branchId, user, 'UPDATE STATUS', normalized.DonationId, `Status set to ${normalized.Status}`);

  const shouldSendReceipt = lower(body.sendReceipt || 'no');
  const receipt = shouldSendReceipt === 'yes'
    ? await sendChurchDonationReceipt(env, normalized, {
      subject: clean(body.subject || body.receiptSubject),
      message: clean(body.message || body.receiptMessage)
    }).catch((error) => ({ ok: false, message: error?.message || String(error) }))
    : null;

  return {
    ok: true,
    message: 'Donation status updated.',
    donation: normalized,
    receipt
  };
}

function settingsDocumentForDonation(settings = {}, env = {}) {
  const name = clean(settings.Name || settings.OrganisationName || settings.OrganizationName
    || env.ORG_NAME || env.CHURCH_NAME || env.SCHOOL_NAME || 'Church').trim();
  const senderEmail = clean(settings.BrevoSenderEmail || env.BREVO_SENDER_EMAIL || env.SCHOOL_EMAIL || '').trim();
  const senderName = clean(settings.BrevoSenderName || env.BREVO_SENDER_NAME || name).trim();
  const apiKey = clean(settings.BrevoApiKey || env.BREVO_API_KEY || '').trim();
  const profileName = clean(settings.Name || settings.OrganisationName || settings.OrganizationName || 'Church').trim();
  return { name, senderEmail, senderName, apiKey, profileName };
}

function receiptLogoSource(webBranding = {}, organizationProfile = {}, env = {}) {
  const publicPortalUrl = clean(env.PUBLIC_PORTAL_URL || env.CANONICAL_PORTAL_URL || 'https://digc-suite.pages.dev')
    .replace(/\/+$/, '');
  const embeddedLogo = clean(webBranding.WebLogoDataUrl);
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(embeddedLogo)) {
    return `${publicPortalUrl}/api/web-logo`;
  }

  const configuredLogo = clean(organizationProfile.BrandLogoUrl);
  if (/^https:\/\//i.test(configuredLogo)) return configuredLogo;
  if (configuredLogo.startsWith('/')) return `${publicPortalUrl}${configuredLogo}`;
  return `${publicPortalUrl}/images/Logo.png`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\"']|`/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char] || char));
}

function renderTemplate(value, donation = {}, link = '') {
  const safe = {
    DONOR_NAME: donation.DonorName || '',
    CHURCH_NAME: donation.ChurchName || donation.OrganisationName || 'Your Church',
    AMOUNT: donation.Amount,
    CURRENCY: donation.Currency,
    RECEIPT_NO: donation.ReceiptNo || '',
    PAYMENT_METHOD: donation.PaymentMethod || '',
    PAYMENT_TYPE: donation.PaymentType || 'Donation',
    PAYMENT_REFERENCE: donation.Reference || donation.DonationId || '',
    PAYMENT_LINK: link || '',
    DONATION_LINK: link || '',
    NOTES: donation.Notes || '',
    DONATION_ID: donation.DonationId || '',
    BRANCH_ID: donation.BranchId || ''
  };
  return String(value || '').replace(/\{([A-Z_]+)\}/g, (_, key) => clean(safe[key]));
}

function formatMoney(amount = 0, currency = 'NGN') {
  const number = Number(amount || 0);
  if (!Number.isFinite(number)) return String(amount);
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency
    }).format(number);
  } catch (_err) {
    return `${currency} ${number.toFixed(2)}`;
  }
}

export function buildDonationReceiptHtml(context, link = '') {
  const isPaid = lower(context.Status) === 'paid';
  const isPaymentRequest = clean(context.PaymentMethod).toUpperCase() === 'ONLINE'
    && Boolean(clean(link))
    && !isPaid;
  const logoSource = clean(context.ReceiptLogoSource);
  const lineItems = [
    ['Donor', context.DonorName || context.name || 'Donor'],
    ['Email', context.DonorEmail || context.email || ''],
    ['Amount', formatMoney(context.Amount, context.Currency)],
    ['Payment', `${context.PaymentType || 'Donation'} (${context.PaymentMethod || 'Cash'})`],
    [isPaymentRequest ? 'Payment Reference' : 'Reference', context.Reference || context.ReceiptNo || context.DonationId || ''],
    ['Status', context.Status || 'Pending']
  ];
  if (!isPaymentRequest && context.ReceiptNo) {
    lineItems.splice(5, 0, ['Receipt Number', context.ReceiptNo]);
  }
  if (context.Notes) {
    lineItems.push(['Notes', context.Notes]);
  }
  const rows = lineItems.map(([label, value], index) => {
    const amountRow = label === 'Amount';
    const statusRow = label === 'Status';
    const labelBackground = amountRow ? '#fff4d6' : (index % 2 ? '#edf8f7' : '#eef5ff');
    const valueBackground = amountRow ? '#fffaf0' : (index % 2 ? '#f7fcfb' : '#f8fbff');
    const renderedValue = statusRow
      ? `<span style="display:inline-block; padding:4px 10px; border-radius:999px; background:${lower(value) === 'paid' ? '#dff5e9' : '#fff1c7'}; color:${lower(value) === 'paid' ? '#08775f' : '#8a5b00'}; font-weight:700;">${escapeHtml(value)}</span>`
      : `<span style="${amountRow ? 'color:#08775f; font-size:17px; font-weight:700;' : ''}">${escapeHtml(value)}</span>`;
    return `<tr>
      <td style="width:36%; padding:9px 11px; border-bottom:1px solid #dce7f2; background:${labelBackground}; color:#173b63;"><strong>${escapeHtml(label)}:</strong></td>
      <td style="padding:9px 11px; border-bottom:1px solid #dce7f2; background:${valueBackground}; color:#243447;">${renderedValue}</td>
    </tr>`;
  }).join('');
  const callToAction = isPaymentRequest
    ? `<p style="margin:18px 0 4px;"><a href="${escapeHtml(link)}" style="display:inline-block; background:#087f72; color:#fff; padding:11px 18px; text-decoration:none; border-radius:7px; font-weight:700;">Pay Now</a></p>`
    : '';
  const headerLogo = logoSource
    ? `<td style="width:68px; padding:0 14px 0 0; vertical-align:middle;"><span style="display:inline-block; padding:6px; border-radius:12px; background:#ffffff;"><img src="${escapeHtml(logoSource)}" alt="${escapeHtml(context.ChurchName || context.name || 'Organisation')} logo" width="50" height="50" style="display:block; width:50px; height:50px; object-fit:contain; border:0;" /></span></td>`
    : '';
  const watermarkStyle = logoSource
    ? `background-image:linear-gradient(rgba(255,255,255,0.91),rgba(255,255,255,0.91)),url('${escapeHtml(logoSource)}'); background-position:center 58%; background-repeat:no-repeat; background-size:240px auto;`
    : '';
  const eyebrow = isPaymentRequest ? 'Secure online payment' : 'Official acknowledgement';
  const documentTitle = isPaymentRequest ? 'donation payment link' : 'donation receipt';
  const message = isPaymentRequest
    ? 'Please use the secure Pay Now button below to complete your gift. No payment has been received yet.'
    : (context.customMessage || 'Thank you for your payment.');
  const footerMessage = isPaymentRequest
    ? 'This is a payment request, not a receipt. A receipt will be emailed after payment is confirmed.'
    : 'Thank you for your generosity. Please retain this receipt for your records.';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-family:Arial,sans-serif; width:100%; max-width:680px; border-collapse:separate; border-spacing:0; border:1px solid #cbdced; border-top:5px solid #d39400; border-radius:12px; overflow:hidden; color:#243447; background:#ffffff;">
    <tr><td style="padding:20px 22px; background:#164a78; border-bottom:4px solid #18a69a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%;"><tr>
        ${headerLogo}
        <td style="vertical-align:middle;">
          <div style="margin:0 0 4px; color:#a9f0e7; font-size:11px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase;">${eyebrow}</div>
          <h3 style="margin:0; color:#ffffff; font-size:20px; line-height:1.3;">${escapeHtml(context.ChurchName || context.name || 'Church')} ${documentTitle}</h3>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:20px 20px 16px; background-color:#ffffff; ${watermarkStyle}">
      <p style="margin:0 0 10px; color:#173b63;">Dear ${escapeHtml(context.DonorName || 'Donor')},</p>
      <p style="margin:0 0 16px; color:#4d6075;">${escapeHtml(message)}</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%; border:1px solid #cfddeb; margin:12px 0; background:rgba(255,255,255,0.88);">
        ${rows}
      </table>
      ${callToAction}
    </td></tr>
    <tr><td style="padding:11px 20px; background:#edf8f7; border-top:1px solid #cfe8e4; color:#37655f; font-size:11px; line-height:1.5;">
      ${footerMessage}
    </td></tr>
  </table>`;
}

async function sendSchoolEmail(env, settings, subject, textContent, htmlContent, toEmail, toName) {
  if (!settings?.apiKey || !settings.senderEmail || !toEmail) {
    return { ok: false, skipped: true, message: 'Brevo API key, sender email, or recipient email is missing.' };
  }
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': settings.apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: settings.senderName, email: settings.senderEmail },
      to: [{ email: toEmail, name: toName || toEmail }],
      subject,
      textContent,
      htmlContent
    })
  });
  const detail = await response.text().catch(() => '');
  return { ok: response.ok, status: response.status, message: detail };
}

export async function sendChurchDonationReceipt(env, donation, options = {}) {
  const [brevoSettings, organizationProfile, webBranding] = await Promise.all([
    getDocument(env, 'settings', 'brevo').catch(() => ({})),
    getDocument(env, 'settings', 'organisationProfile').catch(() => ({})),
    getDocument(env, 'settings', 'webBranding').catch(() => ({}))
  ]);
  const settings = settingsDocumentForDonation({ ...brevoSettings, ...(organizationProfile || {}) }, env);
  const paymentLink = clean(options.paymentLink || '');
  const isPaymentRequest = Boolean(paymentLink) && lower(donation.Status) !== 'paid';
  const donationName = clean(options.donorName || donation.DonorName || 'Donor');
  const subjectTemplate = isPaymentRequest
    ? `Complete your donation - ${settings.profileName || settings.name}`
    : clean(options.subject || `Payment confirmation - ${settings.profileName || settings.name}`);
  const messageTemplate = isPaymentRequest
    ? 'Please use the secure Pay Now button below to complete your gift. No payment has been received yet.'
    : clean(options.message || 'Thank you for supporting our organisation.');
  const payload = {
    ...donation,
    DonationId: donation.DonationId,
    Reference: donation.Reference || donation.DonationId,
    ChurchName: settings.name,
    name: settings.name,
    ReceiptLogoSource: receiptLogoSource(webBranding, organizationProfile, env),
    customMessage: renderTemplate(messageTemplate, donation, paymentLink)
  };
  const subject = renderTemplate(subjectTemplate, payload, paymentLink);
  const content = isPaymentRequest
    ? `Complete your donation using this secure payment link: ${paymentLink}\nPayment reference: ${payload.Reference}\nAmount: ${payload.Currency} ${payload.Amount}\nNo payment has been received yet.`
    : `Donation receipt\nPayment reference: ${payload.Reference}\nAmount: ${payload.Currency} ${payload.Amount}\nStatus: Paid`;
  const htmlContent = `${buildDonationReceiptHtml(payload, paymentLink)}`;
  const result = await sendSchoolEmail(env, settings, subject, content, htmlContent, payload.DonorEmail, donationName);
  if (!result.ok || !clean(donation.DonationId || donation.__id)) return result;

  const sentAt = nowIso();
  const updatedDonation = {
    ...donation,
    ...(isPaymentRequest
      ? {
        PaymentLinkSentAt: sentAt,
        PaymentLinkSentTo: clean(payload.DonorEmail)
      }
      : {
        ReceiptStatus: 'Sent',
        ReceiptSentAt: sentAt,
        ReceiptSentTo: clean(payload.DonorEmail)
      }),
    UpdatedAt: sentAt
  };
  const branchId = clean(donation.BranchId || 'main').toLowerCase() || 'main';
  const donationId = safeChurchDocumentId(donation.__id || donation.DonationId || donation.Reference);
  delete updatedDonation.__id;
  delete updatedDonation.__name;
  await upsertDocument(env, churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId), donationId, updatedDonation);
  return {
    ...result,
    purpose: isPaymentRequest ? 'payment-link' : 'receipt',
    sentAt,
    donation: updatedDonation
  };
}

export async function buildChurchPaymentInitMetadata(env, donation = {}, body = {}, requestUrl = '') {
  const profile = await getDocument(env, 'settings', 'organisationProfile').catch(() => ({}));
  const organization = resolveOrganizationConfig({ env, organizationProfile: profile });
  const organizationCode = organization?.Code || 'CHURCH';
  const reference = clean(body.reference || body.Reference || donation.Reference || donation.DonationId || makeReference(organizationCode));
  return {
    organization,
    reference,
    organizationCode,
    callbackUrl: `${requestUrl}/payment-success.html?type=church&reference=${encodeURIComponent(reference)}`
  };
}

export async function initChurchDonationPayment(env, user, body = {}, requestUrl = '') {
  await requireDonationsEdition(env);
  requireCapability(user, 'canInitiateOnline');
  if (!env.PAYSTACK_SECRET_KEY) {
    inputError('Paystack is not configured in this environment.', 500);
  }

  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const donation = normalizeDonationInput({
    ...(body || {}),
    PaymentMethod: 'ONLINE',
    PaymentType: clean(body.PaymentType || body.paymentType || 'Donation')
  }, branchId);

  const metadata = {
    paymentType: 'ChurchDonation',
    branchId,
    paymentMethod: 'ONLINE',
    donorName: donation.DonorName,
    donorEmail: donation.DonorEmail,
    paymentTypeName: donation.PaymentType,
    currency: donation.Currency,
    amount: donation.Amount,
    subject: clean(body.ReceiptSubject || body.receiptSubject || ''),
    message: clean(body.ReceiptMessage || body.receiptMessage || ''),
    notes: donation.Notes,
    donationId: donation.DonationId
  };

  const organization = await getDocument(env, 'settings', 'organisationProfile').catch(() => ({}));
  const profile = resolveOrganizationConfig({ env, organizationProfile: organization });
  const code = `${(profile.Code || 'CHURCH').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'CHURCH'}-${makeReference(Math.floor(Math.random() * 1e6))}`;
  const reference = clean(body.Reference || body.reference || code);
  donation.Reference = reference;
  donation.PaymentStatus = 'Pending';
  donation.Status = 'Pending';

  const callbackUrl = `${requestUrl}/payment-success.html?type=church&reference=${encodeURIComponent(reference)}`;
  const paystackResponse = await fetch(PAYSTACK_INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: donation.DonorEmail,
      amount: Math.round(donation.Amount * 100),
      currency: donation.Currency,
      reference,
      callback_url: callbackUrl,
      metadata
    })
  });
  const paystackData = await paystackResponse.json().catch(() => null);
  if (!paystackData || !paystackData.status) {
    inputError(`Could not start online donation payment. ${paystackData?.message || 'Payment gateway returned an error.'}`);
  }

  const authorizationUrl = clean(paystackData.data?.authorization_url || '');
  if (!authorizationUrl) {
    inputError('Payment gateway did not return an authorization link.');
  }

  const donationWithSaved = await upsertDonationRecord(env, branchId, donation.DonationId, {
    ...(donation || {}),
    BranchId: branchId,
    Reference: reference,
    PaymentLink: authorizationUrl,
    Gateway: 'Paystack',
    GatewayReference: reference,
    GatewayInitiatedAt: nowIso(),
    Notes: donation.Notes,
    Status: 'Pending',
    PaymentStatus: 'Pending'
  }, user);

  const receipt = await sendChurchDonationReceipt(env, donationWithSaved, {
    paymentLink: authorizationUrl,
    subject: clean(body.subject || body.ReceiptSubject || body.receiptSubject || ''),
    message: clean(body.message || body.ReceiptMessage || body.receiptMessage || ''),
    donorName: donationWithSaved.DonorName
  }).catch((error) => ({ ok: false, message: error?.message || String(error) }));

  await writeDonationAudit(env, branchId, user, 'ONLINE INIT', donationWithSaved.DonationId, `Reference ${reference} created`);

  return {
    ok: true,
    message: receipt?.ok ? 'Online donation link created and sent to donor.' : 'Online donation link created; receipt email could not be sent in this environment.',
    donation: donationWithSaved,
    authorizationUrl,
    reference,
    receipt
  };
}

export function extractDonorEmailFromMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object') return '';
  return clean(metadata.donorEmail || metadata.DonorEmail || metadata.email || metadata.Email);
}

export async function markDonationPaidByReference(env, reference, payload = {}) {
  if (!reference) return null;
  const branchId = clean(payload.BranchId || 'main').toLowerCase() || 'main';
  const existing = await findDonationInBranch(env, branchId, reference, clean(payload.DonationId || payload.donationId));
  if (!existing) return null;

  const update = {
    ...(existing || {}),
    ...(payload || {}),
    BranchId: branchId,
    Status: 'Paid',
    PaymentStatus: 'Completed',
    PaidAt: payload.PaidAt || nowIso(),
    UpdatedAt: nowIso(),
    UpdatedBy: clean(payload.UpdatedBy || (payload.actor || '').toString()) || existing.UpdatedBy || existing.UpdatedBy
  };
  const path = churchCollectionPath(CHURCH_COLLECTIONS.donations, branchId);
  const donationId = safeChurchDocumentId(existing.__id || existing.DonationId || reference);
  delete update.__id;
  delete update.__name;
  await upsertDocument(env, path, donationId, update);
  return update;
}

async function sendChurchDonationReceiptAction(env, user, body = {}) {
  const capabilities = requireCapability(user, 'canSendReceipt');
  const branchId = resolveMembershipBranch(user, body.BranchId || body.branchId);
  const donation = await findDonationByIdOrReference(env, { ...body }, branchId);
  if (lower(donation.Status) !== 'paid') {
    inputError('A receipt can only be sent after the donation is paid.', 409);
  }
  const result = await sendChurchDonationReceipt(env, donation, {
    subject: clean(body.subject || body.ReceiptSubject || body.receiptSubject || ''),
    message: clean(body.message || body.ReceiptMessage || body.receiptMessage || ''),
    paymentLink: ''
  });
  if (result.ok) {
    await writeDonationAudit(env, branchId, user, 'SEND RECEIPT', donation.DonationId, `Receipt sent to ${extractDonorEmailFromMetadata(donation)} (${donation.Status})`);
  }
  return {
    ok: true,
    message: result.ok ? 'Donation receipt sent.' : (result.skipped ? 'Receipt skipped (email not configured).' : 'Receipt could not be sent.'),
    result,
    donation: capabilities?.canView
      ? publicDonationRow(result.donation || donation)
      : { ...publicDonationRow(result.donation || donation), DonorEmail: clean(donation.DonorEmail) }
  };
}

export async function handleChurchDonationAction(env, user, body = {}) {
  const action = lower(body.Action || body.action || 'list');
  if (['list', 'getchurchdonations'].includes(action)) {
    return listChurchDonations(env, user, body);
  }
  if (['save', 'savedonation', 'add'].includes(action)) {
    return saveChurchDonation(env, user, body);
  }
  if (['setstatus', 'markpaid', 'updatestatus'].includes(action)) {
    return setChurchDonationStatus(env, user, body, body.Status || body.status);
  }
  if (['sendreceipt', 'sendchurchdonationreceipt'].includes(action)) {
    return sendChurchDonationReceiptAction(env, user, body);
  }
  inputError('Choose a valid church donation action.');
}

export default {
  donationCapabilities,
  listChurchDonations,
  saveChurchDonation,
  setChurchDonationStatus,
  initChurchDonationPayment,
  sendChurchDonationReceipt,
  buildChurchPaymentInitMetadata,
  markDonationPaidByReference,
  extractDonorEmailFromMetadata,
  donationSummary,
  handleChurchDonationAction
};
