import { getDocument } from '../lib/firestore.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { createPricingBookPdf } from '../lib/pricing-book-pdf.js';
import { normalizeBillingCycle, normalizeSubscriptionPlanCatalog } from '../lib/subscription-plans.js';

const PLAN_DOCUMENT_ID = 'dynamaxPlanCatalog';

function clean(value) {
  return String(value ?? '').trim();
}

function edition(value) {
  const selected = clean(value).toLowerCase();
  return ['faith', 'organization'].includes(selected) ? selected : 'school';
}

function safeFilenamePart(value) {
  return clean(value).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Plans';
}

export async function onRequestGet({ request, env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    const url = new URL(request.url);
    const selectedEdition = edition(url.searchParams.get('edition'));
    const billingCycle = normalizeBillingCycle(url.searchParams.get('billingCycle'));
    const saved = await getDocument(platformEnv, 'settings', PLAN_DOCUMENT_ID);
    const catalog = normalizeSubscriptionPlanCatalog(saved || {});
    const bytes = await createPricingBookPdf(catalog, {
      edition: selectedEdition,
      billingCycle
    });
    const filename = `Dynamax_Pricing_Book_${safeFilenamePart(selectedEdition)}_${safeFilenamePart(billingCycle)}.pdf`;
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    return Response.json({
      ok: false,
      message: error?.message || 'The pricing book could not be prepared.'
    }, {
      status: error?.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
