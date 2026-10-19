import { getDocument, upsertDocument } from '../lib/firestore.js';
import { requirePlatformAdmin } from '../lib/platform-admin.js';
import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { normalizeTutorialCatalog, TUTORIAL_CATALOG_DOCUMENT_ID } from '../lib/tutorial-catalog.js';
import { readJsonBody } from '../lib/request-security.js';

function failure(error) {
  return Response.json({ ok: false, message: error.message || String(error) }, {
    status: error.status || 500,
    headers: { 'Cache-Control': 'no-store' }
  });
}

function requireOwnerPortal(request) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (['dynamax.cc', 'www.dynamax.cc', 'dynamaxms.pages.dev'].includes(hostname)) return;
  const error = new Error('Tutorial publishing is available only on the Dynamax owner portal.');
  error.status = 403;
  throw error;
}

export async function onRequestGet({ env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    const saved = await getDocument(platformEnv, 'settings', TUTORIAL_CATALOG_DOCUMENT_ID);
    return Response.json({ ok: true, published: Boolean(saved), catalog: normalizeTutorialCatalog(saved || {}) }, {
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' }
    });
  } catch (error) {
    return failure(error);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    requireOwnerPortal(request);
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    requirePlatformAdmin(env, body.password);
    const platformEnv = requirePlatformFirestoreEnv(env);
    const catalog = {
      ...normalizeTutorialCatalog(body.catalog),
      UpdatedAt: new Date().toISOString(),
      UpdatedBy: 'Dynamax owner'
    };
    await upsertDocument(platformEnv, 'settings', TUTORIAL_CATALOG_DOCUMENT_ID, catalog);
    return Response.json({ ok: true, published: true, catalog, message: 'Tutorial catalogue published for all editions.' }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    return failure(error);
  }
}
