import { requirePlatformAdmin } from '../lib/platform-admin.js';
import { isHelpOwnerHost, loadPublishedHelpConfig, readHelpConfigJson, saveHelpConfig } from '../lib/help-config.js';

function failure(error) {
  const status = Number(error?.status) || 500;
  return Response.json({ ok: false, message: status >= 500 ? 'Help settings are temporarily unavailable. Please try again.' : error.message,
    code: status >= 500 ? 'HELP_CONFIG_UNAVAILABLE' : error.code || '' }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestGet({ request, env }) {
  const result = await loadPublishedHelpConfig(env, request.url);
  return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': result.unavailable ? 'no-store' : 'public, max-age=60' } });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!isHelpOwnerHost(request.url)) throw Object.assign(new Error('Help settings can only be published from the Dynamax owner portal.'), { status: 403 });
    const contentType = request.headers.get('Content-Type') || '';
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) throw Object.assign(new Error('Send help settings as JSON.'), { status: 415 });
    const body = await readHelpConfigJson(request);
    requirePlatformAdmin(env, body.password);
    const config = await saveHelpConfig(env, body);
    return Response.json({ ok: true, published: true, config, message: 'Help, support and device settings published for all editions.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
