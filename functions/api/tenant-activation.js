import { requirePlatformFirestoreEnv } from '../lib/platform-firestore.js';
import { readJsonBody } from '../lib/request-security.js';
import {
  claimTenantActivation,
  completeTenantActivation,
  inspectTenantActivation,
  releaseTenantActivationClaim
} from '../lib/tenant-activation.js';

const clean = (value) => String(value ?? '').trim();

function portalHost(request) {
  return clean(request.headers.get('X-Dynamax-Portal'));
}

export async function onRequestPost({ request, env }) {
  try {
    const platformEnv = requirePlatformFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 24 * 1024 });
    const action = clean(body.action || 'inspect').toLowerCase();
    const details = {
      activationId: body.activationId,
      token: body.token,
      claimId: body.claimId,
      username: body.username,
      portalHost: portalHost(request)
    };
    let result;
    if (action === 'inspect') result = await inspectTenantActivation(platformEnv, details);
    else if (action === 'claim') result = await claimTenantActivation(platformEnv, details);
    else if (action === 'complete') result = await completeTenantActivation(platformEnv, details);
    else if (action === 'release') result = { released: await releaseTenantActivationClaim(platformEnv, details) };
    else {
      const error = new Error('Unsupported activation action.');
      error.status = 400;
      throw error;
    }
    return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ ok: false, code: clean(error.code), message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
