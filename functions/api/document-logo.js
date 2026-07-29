import { requireFirestoreEnv } from '../lib/firestore.js';
import {
  documentBrandingMatchesDeployment,
  getDocumentBranding
} from '../lib/document-branding.js';
import { getWebBranding, webBrandingMatchesDeployment } from '../lib/web-branding.js';

function clean(value) {
  return String(value ?? '').trim();
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function onRequestGet(context) {
  try {
    requireFirestoreEnv(context.env);
    const [documentBranding, webBranding] = await Promise.all([
      getDocumentBranding(context.env).catch(() => ({})),
      getWebBranding(context.env).catch(() => ({}))
    ]);
    const dataUrl = clean(
      (documentBrandingMatchesDeployment(context.env, documentBranding)
        ? documentBranding?.DocumentLogoDataUrl
        : '')
      || (webBrandingMatchesDeployment(context.env, webBranding)
        ? webBranding?.WebLogoDataUrl
        : '')
    );
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i);
    if (!match) return new Response(null, { status: 404 });
    return new Response(decodeBase64(match[2]), {
      headers: {
        'Content-Type': match[1].toLowerCase(),
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    return Response.json({
      ok: false,
      message: clean(error && error.message ? error.message : error)
    }, { status: error.status || 500 });
  }
}
