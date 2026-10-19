import { getDocument } from '../lib/firestore.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { publicSubscriptionReceipt } from '../lib/subscription-receipt.js';

const clean = (value) => String(value ?? '').trim();
const safeId = (value) => clean(value).replace(/[\/\\?#\[\]]/g, '-').replace(/\s+/g, '_').slice(0, 140);

function response(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const reference = safeId(url.searchParams.get('reference'));
    const registrationReference = clean(url.searchParams.get('registration'));
    if (!reference || !registrationReference) {
      return response({ ok: false, message: 'The receipt link is incomplete.' }, 400);
    }
    const platformEnv = requirePlatformFirestoreEnv(env);
    const receipt = await getDocument(platformEnv, 'subscriptionReceipts', reference);
    if (!receipt
      || clean(receipt.PaymentReference) !== reference
      || clean(receipt.RegistrationReference).toLowerCase() !== registrationReference.toLowerCase()
      || clean(receipt.Status).toLowerCase() !== 'paid') {
      return response({ ok: false, message: 'This paid subscription receipt could not be found.' }, 404);
    }
    return response({ ok: true, receipt: publicSubscriptionReceipt(receipt) });
  } catch (error) {
    return response({ ok: false, message: error.message || String(error) }, error.status || 500);
  }
}
