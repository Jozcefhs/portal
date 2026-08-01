import { requireFirestoreEnv } from '../lib/firestore.js';
import {
  buildChurchGenericGivingQr,
  handleChurchDonationAction,
  initChurchDonationPayment
} from '../lib/church-payments.js';
import { postChurchDonationToAccounting } from './backend.js';
import { requireStaffSession } from '../lib/staff-auth.js';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
  readJsonBody
} from '../lib/request-security.js';

function clean(value) {
  return String(value ?? '').trim();
}

function isPaidOfflineDonation(donation = {}) {
  const status = clean(donation.Status || donation.PaymentStatus).toLowerCase();
  const method = clean(donation.PaymentMethod || donation.Method).toUpperCase();
  return ['paid', 'completed'].includes(status) && method !== 'ONLINE';
}

async function postPaidOfflineDonation(env, donation = {}) {
  if (!isPaidOfflineDonation(donation)) return null;
  return postChurchDonationToAccounting(env, donation);
}

async function syncPaidOfflineDonations(env, user, body = {}) {
  const listed = await handleChurchDonationAction(env, user, { ...body, action: 'list' });
  if (!listed.capabilities?.canCollect) {
    const error = new Error('This staff account is not allowed to sync donation accounting.');
    error.status = 403;
    throw error;
  }

  const eligible = (listed.donations || []).filter(isPaidOfflineDonation);
  const failed = [];
  let confirmed = 0;
  for (const donation of eligible) {
    try {
      const journal = await postPaidOfflineDonation(env, donation);
      if (journal) confirmed += 1;
    } catch (error) {
      failed.push({
        DonationId: clean(donation.DonationId || donation.__id),
        message: error?.message || String(error)
      });
    }
  }

  return {
    ok: true,
    message: failed.length
      ? `Accounting confirmed for ${confirmed} paid offline donation(s); ${failed.length} still need attention.`
      : `Accounting confirmed for ${confirmed} paid offline donation(s).`,
    eligible: eligible.length,
    confirmed,
    failedCount: failed.length,
    failed
  };
}

export async function onRequestPost(context) {
  let idempotency = null;
  try {
    const { request, env } = context;
    requireFirestoreEnv(env);
    const user = await requireStaffSession(env, request);
    if (!(user.allowedSections || []).includes('donations')) {
      const error = new Error('This staff account is not allowed to manage church donations.');
      error.status = 403;
      throw error;
    }

    const body = await readJsonBody(request, { maxBytes: 512 * 1024 });
    const action = clean(body.Action || body.action || '').toLowerCase();
    const isMutation = !['list', 'getchurchdonations', 'paymentqr', 'givingqr', 'generateqr', 'genericqr'].includes(action);
    if (isMutation) {
      idempotency = await beginIdempotentRequest(env, request, body, {
        scope: `church-donation-${action || 'mutation'}`,
        actor: user.username,
        ttlMinutes: 30 * 24 * 60
      });
      if (idempotency.replay) {
        return Response.json(idempotency.response, {
          status: idempotency.status || (idempotency.response?.ok === false ? 409 : 200),
          headers: { 'Cache-Control': 'no-store', 'Idempotency-Replayed': 'true' }
        });
      }
    }

    let result;
    if (action === 'genericqr') {
      result = await buildChurchGenericGivingQr(env, user, body, new URL(request.url).origin);
    } else if (['init', 'initchurchpayment', 'initdonation', 'initpayment', 'sendpaystack'].includes(action)) {
      result = await initChurchDonationPayment(env, user, body, new URL(request.url).origin);
    } else if (action === 'syncaccounting') {
      result = await syncPaidOfflineDonations(env, user, body);
    } else {
      result = await handleChurchDonationAction(env, user, body);
    }
    if (
      result?.donation
      && ['save', 'savedonation', 'add', 'setstatus', 'markpaid', 'updatestatus'].includes(action)
      && isPaidOfflineDonation(result.donation)
    ) {
      try {
        const journal = await postPaidOfflineDonation(env, result.donation);
        result.accountingStatus = journal ? 'Posted' : 'Not applicable';
        if (journal) result.message = `${result.message} Accounting posted.`;
      } catch (error) {
        result.accountingStatus = 'Pending';
        result.accountingMessage = error?.message || String(error);
        result.message = `${result.message} Accounting is pending; use Sync paid giving to retry.`;
      }
    }
    if (isMutation) await completeIdempotentRequest(env, idempotency, result, 200);
    return Response.json(result, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    if (idempotency?.owner) await failIdempotentRequest(context.env, idempotency, error);
    return Response.json(
      { ok: false, message: error.message || String(error) },
      { status: error.status || 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
