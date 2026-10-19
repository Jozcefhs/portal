import { firestoreRequest, requireFirestoreEnv } from '../lib/firestore.js';
import { secureSecretEqual } from '../lib/request-security.js';

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const deep = new URL(request.url).searchParams.get('deep') === '1';
    if (!deep) {
      return Response.json({
        ok: true,
        message: 'Database service is configured.',
        deepCheck: false
      }, {
        headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=120' }
      });
    }
    const configuredSecret = String(env.BACKEND_SHARED_SECRET || '').trim();
    if (!configuredSecret) {
      return Response.json({ ok: false, message: 'Detailed health checks are unavailable.' }, {
        status: 503,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    const authorization = String(request.headers.get('Authorization') || '').trim();
    const providedSecret = String(
      request.headers.get('X-Backend-Secret')
      || (authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7) : '')
    ).trim();
    if (!await secureSecretEqual(configuredSecret, providedSecret)) {
      return Response.json({ ok: false, message: 'Detailed health check authorization failed.' }, {
        status: 401,
        headers: { 'Cache-Control': 'no-store' }
      });
    }
    let documentFound = false;
    try {
      await firestoreRequest(env, 'system/health');
      documentFound = true;
    } catch (err) {
      if (err.status !== 404) {
        throw err;
      }
    }
    return Response.json({
      ok: true,
      message: 'Database connection is configured.',
      healthDocumentFound: documentFound,
      deepCheck: true
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return Response.json({
      ok: false,
      message: 'Database service is not configured or unavailable.'
    }, {
      status: Number(err?.status || 500),
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
