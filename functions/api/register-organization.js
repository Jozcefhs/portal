import { createDocumentIfAbsent, queryCollection, requireFirestoreEnv } from '../lib/firestore.js';
import { normalizeOrganizationEdition } from '../lib/organization-config.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody,
  verifyTurnstile
} from '../lib/request-security.js';

const clean = (value) => String(value ?? '').trim();
const plans = Object.freeze({
  Starter: { UserLimit: 5, Features: ['people', 'departments', 'records'] },
  Standard: { UserLimit: 20, Features: ['people', 'departments', 'records', 'accounting', 'approvals'] },
  Professional: { UserLimit: 50, Features: ['people', 'departments', 'records', 'accounting', 'approvals', 'payroll', 'programs'] },
  Enterprise: { UserLimit: 250, Features: ['all'] }
});

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(value).toLowerCase());
}

export async function onRequestPost({ request, env }) {
  let idempotency = null;
  try {
    requireFirestoreEnv(env);
    const body = await readJsonBody(request, { maxBytes: 96 * 1024 });
    const name = clean(body.OrganisationName);
    const email = clean(body.Email).toLowerCase();
    const plan = plans[clean(body.Plan)] ? clean(body.Plan) : 'Starter';
    if (!name || !clean(body.ContactName) || !validEmail(email) || !clean(body.Phone) || !clean(body.Country)) {
      const error = new Error('Organisation, contact name, valid email, phone and country are required.');
      error.status = 400; throw error;
    }
    if (clean(body.Consent).toUpperCase() !== 'YES') {
      const error = new Error('Authorisation confirmation is required.'); error.status = 400; throw error;
    }
    await verifyTurnstile(env, request, body, 'register_organization');
    const {
      turnstileToken: _turnstileToken,
      turnstileAction: _turnstileAction,
      idempotencyKey: _idempotencyKey,
      ...idempotencyPayload
    } = body;
    idempotency = await beginIdempotentRequest(env, request, body, {
      scope: 'register-organization',
      actor: email,
      ttlMinutes: 30 * 24 * 60,
      fingerprintPayload: idempotencyPayload
    });
    if (idempotency.replay) {
      return Response.json(idempotency.response, {
        status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
        headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
      });
    }
    const existing = (await queryCollection(env, 'tenantRegistrations', {
      filters: [{ field: 'Email', op: '==', value: email }],
      limit: 5
    }).catch(() => []))
      .find((row) => clean(row.OrganisationName).toLowerCase() === name.toLowerCase()
        && !['rejected', 'cancelled'].includes(clean(row.Status).toLowerCase()));
    if (existing) {
      const result = {
        ok: true,
        reference: clean(existing.Reference || existing.__id),
        message: 'This organisation registration has already been received.'
      };
      await completeIdempotentRequest(env, idempotency, result, 200);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    const reference = `DMX-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    const created = await createDocumentIfAbsent(env, 'tenantRegistrations', reference, {
      Reference: reference, OrganisationName: name,
      Edition: normalizeOrganizationEdition(body.Edition),
      ContactName: clean(body.ContactName), Email: email, Phone: clean(body.Phone), Country: clean(body.Country),
      Plan: plan, UserLimit: plans[plan].UserLimit, Features: plans[plan].Features,
      Status: 'Pending Activation', CreatedAt: new Date().toISOString(), Source: 'Dynamax public registration'
    });
    if (!created.created) {
      const error = new Error('Could not reserve a unique registration reference. Please try again.');
      error.status = 409;
      throw error;
    }
    const result = {
      ok: true,
      reference,
      message: 'Registration received. Your Dynamax workspace will be activated after plan confirmation.'
    };
    await completeIdempotentRequest(env, idempotency, result, 200);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (idempotency?.owner) await failIdempotentRequest(env, idempotency, error);
    return Response.json({ ok: false, message: error.message || String(error) }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
