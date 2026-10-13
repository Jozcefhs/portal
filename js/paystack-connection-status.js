(function (root) {
  'use strict';

  function normalizePending(value) {
    if (!value || !['live', 'test'].includes(value.mode)) return null;
    if (!new RegExp(`^${value.mode}:[a-f0-9]{24}$`).test(value.fingerprint || '')) return null;
    return { mode: value.mode, fingerprint: value.fingerprint };
  }

  function createTracker(storage, workspaceId) {
    const key = `dynamax:paystack-activation:${workspaceId}`;
    let pending = null;
    try { pending = normalizePending(JSON.parse(storage?.getItem(key) || 'null')); } catch (_error) { /* Storage can be unavailable. */ }
    function remember(value) {
      pending = normalizePending(value);
      // Only a one-way identifier and mode are retained, never the payment key.
      try {
        if (pending) storage?.setItem(key, JSON.stringify(pending));
        else storage?.removeItem(key);
      } catch (_error) { /* Keep the pending state in memory when storage is blocked. */ }
      return pending;
    }
    return {
      remember,
      pending: () => pending,
      reconcile(profile) {
        if (pending && profile.PaystackConnectionMode === pending.mode
          && profile.PaystackCredentialFingerprint === pending.fingerprint) remember(null);
        return pending;
      }
    };
  }

  function presentation(mode, pending) {
    const configured = mode !== 'not-configured';
    if (pending) {
      const target = pending.mode === 'live' ? 'Live' : 'Test';
      const current = mode === 'live' ? 'Live mode is still active.'
        : mode === 'test' ? 'Test mode is still active.' : 'The new key is not active yet.';
      return {
        title: `${target} activation pending`, badge: `${target} pending`, live: false,
        message: `The ${pending.mode} key was saved securely. ${current} Activation requires a deployment; scheduled deployments can be delayed. Save changes does not activate or replace the key. Use Check activation to confirm when the saved key is active.`
      };
    }
    return {
      title: mode === 'live' ? 'Live payments connected' : mode === 'test' ? 'Test payments connected'
        : configured ? 'Payment credential connected' : 'No Paystack account connected',
      badge: configured ? `${mode} mode` : 'Not connected', live: mode === 'live',
      message: configured ? 'The active deployment is using this payment credential. The secret remains encrypted in Cloudflare and is never displayed here.'
        : 'Paste a Paystack secret key to validate and connect this organisation.'
    };
  }

  root.DynamaxPaystackConnectionStatus = { createTracker, presentation };
})(typeof window === 'object' ? window : globalThis);
