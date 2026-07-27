import { requireFirestoreEnv, upsertDocument } from '../lib/firestore.js';
import { normalizeOrganizationEdition } from '../lib/organization-config.js';

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
  try {
    requireFirestoreEnv(env);
    const body = await request.json().catch(() => ({}));
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
    const reference = `DMX-${Date.now()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    await upsertDocument(env, 'tenantRegistrations', reference, {
      Reference: reference, OrganisationName: name,
      Edition: normalizeOrganizationEdition(body.Edition),
      ContactName: clean(body.ContactName), Email: email, Phone: clean(body.Phone), Country: clean(body.Country),
      Plan: plan, UserLimit: plans[plan].UserLimit, Features: plans[plan].Features,
      Status: 'Pending Activation', CreatedAt: new Date().toISOString(), Source: 'Dynamax public registration'
    });
    return Response.json({ ok: true, reference, message: 'Registration received. Your Dynamax workspace will be activated after plan confirmation.' });
  } catch (error) {
    return Response.json({ ok: false, message: error.message || String(error) }, { status: error.status || 500 });
  }
}
