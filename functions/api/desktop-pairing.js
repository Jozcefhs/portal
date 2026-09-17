import { requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import { consumeRequestAllowance, readJsonBody } from '../lib/request-security.js';
import {
  createDesktopPairingCode,
  exchangeDesktopPairingCode,
  listDesktopDevices,
  revokeDesktopDevice
} from '../lib/desktop-pairing.js';

const clean = (value) => String(value ?? '').trim();

function organisationWideSuperAdmin(user = {}) {
  const assignedBranchId = clean(user.assignedBranchId || (user.canSwitchBranches === false ? user.branchId : ''));
  return clean(user.role) === 'Super Admin' && !assignedBranchId;
}

function requireOrganisationWideSuperAdmin(user) {
  if (organisationWideSuperAdmin(user)) return user;
  const error = new Error('Only an organisation-wide Super Admin can pair or revoke desktop devices.');
  error.status = 403;
  error.code = 'DESKTOP_PAIRING_FORBIDDEN';
  throw error;
}

async function audit(env, actor, action, details = '') {
  const now = new Date().toISOString();
  const id = `DESKTOP-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await upsertDocument(env, 'staffSecurityAudit', id, {
    AuditId: id,
    Timestamp: now,
    Action: action,
    Module: 'Desktop setup',
    Outcome: 'Success',
    Username: clean(actor.username),
    DisplayName: clean(actor.displayName || actor.username),
    Role: clean(actor.role),
    Details: clean(details),
    Source: 'Web companion'
  });
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost(context) {
  try {
    const { env, request } = context;
    requireFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 32 * 1024 });
    const action = clean(body.action).toLowerCase();

    if (action === 'exchange') {
      const allowance = await consumeRequestAllowance(env, request, {
        scope: 'desktop-pairing-exchange', maximum: 20, windowSeconds: 15 * 60
      });
      if (!allowance.allowed) {
        return json({ ok: false, message: 'Too many pairing attempts. Generate a new code and try again later.' }, 429);
      }
      const result = await exchangeDesktopPairingCode(env, body.code, body.deviceName);
      return json({ ok: true, message: 'This desktop is now paired with the organisation.', ...result });
    }

    const actor = requireOrganisationWideSuperAdmin(await requireStaffSession(env, request));
    if (action === 'create') {
      const pairing = await createDesktopPairingCode(env, actor);
      await audit(env, actor, 'CREATE_DESKTOP_PAIRING_CODE', `Pairing code expires at ${pairing.expiresAt}.`);
      return json({
        ok: true,
        message: `Pairing code created. It expires in ${pairing.validForMinutes} minutes and can be used once.`,
        portalUrl: new URL(request.url).origin,
        ...pairing
      });
    }
    if (action === 'list') {
      return json({ ok: true, devices: await listDesktopDevices(env) });
    }
    if (action === 'revoke') {
      const device = await revokeDesktopDevice(env, body.deviceId, actor);
      await audit(env, actor, 'REVOKE_DESKTOP_DEVICE', `${device.deviceName} (${device.deviceId})`);
      return json({ ok: true, message: `${device.deviceName} can no longer connect.`, device });
    }
    return json({ ok: false, message: 'Choose a valid desktop setup action.' }, 400);
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error('Desktop pairing failed', error);
    return json({
      ok: false,
      message: status >= 500 ? 'Desktop setup could not be completed right now.' : clean(error?.message || error),
      ...(error?.code ? { code: error.code } : {})
    }, status);
  }
}

export async function onRequestGet() {
  return json({ ok: false, message: 'Desktop setup requests require POST.' }, 405);
}
