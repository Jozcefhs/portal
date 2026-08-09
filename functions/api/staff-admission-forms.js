import QRCode from 'qrcode';
import { requireFirestoreEnv } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { readJsonBody } from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

function admissionPurchaseQrSvg(value = '') {
  const qr = QRCode.create(clean(value), { errorCorrectionLevel: 'M' });
  const margin = 3;
  const size = qr.modules.size + (margin * 2);
  const modules = [];
  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (qr.modules.get(row, column)) modules.push(`M${column + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Admission form purchase QR code" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${size}v${size}H0z"/><path fill="#071b2c" d="${modules.join('')}"/></svg>`;
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    const body = await readJsonBody(request, { maxBytes: 32 * 1024 });
    const action = clean(body.action || 'genericQr').toLowerCase();
    const edition = clean(user.edition || user.OrganisationEdition).toLowerCase();
    if (edition !== 'school') {
      const error = new Error('Admission form purchase QR codes are available only in the school workspace.');
      error.status = 403;
      throw error;
    }
    if (!(user.allowedSections || []).some((section) => ['admissions', 'formPurchases'].includes(section))) {
      const error = new Error('This staff account is not allowed to manage admission form purchases.');
      error.status = 403;
      throw error;
    }
    if (action !== 'genericqr') {
      const error = new Error('Choose a valid admission-form action.');
      error.status = 400;
      throw error;
    }

    const origin = new URL(request.url).origin.replace(/\/+$/, '');
    const purchaseUrl = `${origin}/buy-form.html`;
    if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/|$)/.test(purchaseUrl)) {
      const error = new Error('The public admission form purchase address is unavailable on this deployment.');
      error.status = 503;
      throw error;
    }
    return Response.json({
      ok: true,
      generic: true,
      message: 'Reusable admission form purchase QR code generated.',
      purchaseUrl,
      paymentLink: purchaseUrl,
      qrSvg: admissionPurchaseQrSvg(purchaseUrl)
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
