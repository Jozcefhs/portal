/* Shared staff action outcomes. Reads/navigation stay quiet; no record data is persisted. */
(function (root) {
  'use strict';
  let activeActions = 0;
  let lastServerResult = 0;
  const readActions = new Set(['bootstrap', 'list', 'shell', 'section', 'status', 'adminstatus', 'quick',
    'presencequick', 'detail', 'recorddetail', 'records', 'document', 'catalog', 'findings', 'reports',
    'report', 'statement', 'analysis', 'balance', 'balances', 'context', 'taxbreakdown', 'lookupinventory']);
  function isMutation(url, init = {}) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(init.method || 'GET').toUpperCase())) return false;
    if (!/^\/api\/(?:admin$|staff-|approval-settings|finance-workflow|vendor-|procurement|payment-corrections|data-backup|external-audit|backend)/.test(url.pathname)) return false;
    let body = {};
    try { body = typeof init.body === 'string' ? JSON.parse(init.body) : {}; } catch (_) { return false; }
    const action = String(body.action || body.Action || body.mode || url.searchParams.get('action') || '').toLowerCase().replace(/[^a-z]/g, '');
    if (readActions.has(action) || /^(?:get|list|search|lookup|preview|validate|check|download|export|poll|verify|prepare)/.test(action)) return false;
    // Identity challenges are intermediate steps, not completed business actions.
    if (/passkey|webauthn|staff-session|staff-mfa|approval-profile/.test(url.pathname)) return false;
    // Restore/reset chunks belong to one action; its completion is reported once.
    if (url.pathname === '/api/data-backup' && !action.startsWith('complete')) return false;
    return true;
  }
  function report(message, type = 'ok', options = {}) {
    if (!String(message || '').trim()) return;
    return root.DynamaxDialogs?.alert({ title: type === 'ok' ? 'Action completed' : 'Action not completed',
      message: String(message), ...(type === 'ok' ? {} : { tone: 'danger' }), ...options });
  }
  function inline(message, type) {
    if (type === 'good') type = 'ok';
    if (type === 'bad' || (type === 'ok' && activeActions > 0 && Date.now() - lastServerResult > 1000)) {
      void report(message, type);
    }
  }
  async function response(result) {
    // A 200 response alone is not evidence that an action was recorded.
    const data = await result.clone().json().catch(() => null);
    lastServerResult = Date.now();
    if (result.ok && data?.ok === true) {
      void report(data.message || 'The server confirmed that your action was completed.', 'ok',
        Number(data.bulkResult?.PendingApproval || 0) > 0 ? { title: 'Request saved — awaiting approval' } : {});
    } else if (data?.ok === false && result.status < 500) {
      void report(data.message || 'The server did not accept this action. Check the form and try again.', 'bad', {
        ...(Array.isArray(data.issues) ? { items: data.issues, detailsLabel: 'Items to review' } : {})
      });
    } else {
      uncertain(data?.message);
    }
  }
  function uncertain(message = '') {
    lastServerResult = Date.now();
    void report(`${message ? `${message}\n\n` : ''}Completion could not be confirmed. The server may have saved the action. Refresh and check the records before retrying.`, 'bad', { title: 'Check the outcome before retrying' });
  }
  root.DynamaxStaffActionFeedback = { isMutation, response, report, inline, uncertain,
    begin: () => { activeActions++; }, end: () => { activeActions = Math.max(0, activeActions - 1); } };
  // Form validation is shared by all portals in app-dialogs.js.
})(window);
