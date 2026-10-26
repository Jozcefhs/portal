import { getDocument, queryCollection, batchCommitLiteralDocuments } from './firestore.js';
import { financeMoney, financeDate, financeData, financeWrite, financeFailure, financeOperationId } from './accounting-mutation-guards.js';
import { getAccountingChartRows } from './accounting-reference-cache.js';
import { accountingChartChoicesForEdition, SCHOOL_ONLY_REVENUE_ACCOUNT_CODES } from './accounting-edition-scope.js';
import { resolveOrganizationConfig } from './organization-config.js';
import { assignedStaffBranches } from './staff-branch-access.js';
import { branchPaymentConfiguration } from './direct-bank-transfer.js';
import { paystackEnvironmentIdentity, paystackCredentialMatches } from './paystack-environment.js';
import { terminalPaystackRequest } from './paystack-terminal-client.js';

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const fail = (message, status = 400) => { throw financeFailure(message, status); };
const REQUESTS = 'terminalPaymentRequests', SETTINGS = 'paymentTerminalSettings';
const deps = {
  get: getDocument, query: queryCollection, commit: batchCommitLiteralDocuments,
  chart: getAccountingChartRows, provider: terminalPaystackRequest, identity: paystackEnvironmentIdentity,
  routing: branchPaymentConfiguration,
  config: async env => resolveOrganizationConfig({ env, organizationProfile: await getDocument(env, 'settings', 'organisationProfile') }),
  journal: async (env, body) => (await import('../api/backend.js')).saveAccountingJournal(env, body, true, { prepareOnly: true })
};

export function terminalStaffScope(user) {
  if (!clean(user?.username) || !['Super Admin', 'Director', 'Accounts Officer', 'Treasurer'].includes(clean(user.assignedRole || user.role))
      || !['accounting', 'incomeAnalytics', 'funds'].some(section => user.allowedSections?.includes(section))
      || user.subscriptionActive === false || user.subscriptionReadOnly === true) fail('Authorised finance access is required for card terminals.', 403);
  const branch = lower(user.branchId);
  if (!/^[a-z0-9][a-z0-9_-]{0,100}$/.test(branch) || branch === 'all') fail('Select one working branch first.', 403);
  const allowed = assignedStaffBranches(user);
  if (allowed !== null && !allowed.includes(branch)) fail('This branch is outside your assigned access.', 403);
  return branch;
}
const canConfigure = user => ['Super Admin', 'Director'].includes(clean(user.assignedRole || user.role));
const id = value => {
  const result = clean(value);
  if (!/^TERM-[a-f0-9-]{36}$/.test(result)) fail('Choose a valid terminal payment reference.');
  return result;
};
const terminalId = value => {
  const result = clean(value);
  if (!/^[A-Za-z0-9_-]{2,80}$/.test(result)) fail('Enter the terminal ID supplied by Paystack.');
  return result;
};
const requestCode = value => {
  const result = clean(value);
  if (!/^PRQ_[A-Za-z0-9]{5,80}$/.test(result)) fail('Enter the Paystack payment request code (PRQ_…).');
  return result;
};
const meta = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
const active = row => !['no', 'false', '0'].includes(lower(row.Active));
export function terminalIncomeAccounts(chart, edition) {
  // School invoices, wallets, stock and hotel bills must use their dedicated
  // allocation flows. This workspace collects independent general income only.
  return accountingChartChoicesForEdition(chart, edition).filter(row => active(row) && lower(row.Type) === 'revenue'
    && !SCHOOL_ONLY_REVENUE_ACCOUNT_CODES.includes(clean(row.Code))
    && lower(row.Group) !== 'contra revenue'
    && (['church revenue', 'giving income'].includes(lower(row.Group)) || !['4120', '4130', '4150'].includes(clean(row.Code)))
  ).map(row => ({ code: clean(row.Code), name: clean(row.Name) }));
}
const publicSettings = row => ({ terminalId: row?.TerminalId || '', label: row?.Label || '', enabled: row?.Enabled === true,
  splitId: row?.SplitId || '', version: row?.__updateTime || '' });
export const terminalPublicPayment = row => Object.fromEntries(['RequestId', 'BranchId', 'TerminalId', 'Description', 'PayerName',
  'Amount', 'Currency', 'RevenueAccountCode', 'RevenueAccountName', 'Status', 'RequestCode', 'OfflineReference', 'EventId',
  'CreatedAt', 'PaidAt', 'ReceiptNo', 'TransactionReference', 'JournalNo', 'Mode'].map(key => [key, row[key] ?? '']));
const reply = (row, message = '') => ({ ok: true, payment: terminalPublicPayment(row), message: message || ({
  Creating: 'Payment creation is unconfirmed. Recover the original PRQ code from Paystack before creating another payment.',
  Pending: 'Payment is pending. Send to terminal or check payment; delivery is not payment confirmation.',
  Dispatching: 'Delivery is unconfirmed. Check the terminal and this payment before sending the same invoice again.',
  Sent: 'Request sent. Waiting for verified payment.', Paid: 'Payment verified and recorded once.',
  TestPaid: 'Test payment verified. No live receipt or accounting entry was created.'
}[row.Status] || row.Status) });
const writeRequest = (row, current) => financeWrite(REQUESTS, row.RequestId, row, current);
const customerMatches = (customer, row) => clean(customer?.customer_code || customer) === row.CustomerCode
  || Boolean(row.CustomerId && clean(customer?.id || customer) === row.CustomerId);

function validateInvoice(row, invoice) {
  if (clean(invoice.request_code) !== row.RequestCode && row.RequestCode) fail('Paystack returned a different payment request.', 409);
  if (Number(invoice.amount) !== row.AmountMinor || invoice.currency !== 'NGN' || invoice.domain !== row.Mode
    || clean(invoice.id) !== clean(row.InvoiceId || invoice.id)
    || meta(invoice.metadata).dynamaxTerminalRequest !== row.RequestId
    || !customerMatches(invoice.customer, row)) {
    fail('The provider payment does not match the saved payer, amount, currency or request. No receipt was posted.', 409);
  }
}
async function bindInvoice(env, row, invoice, io) {
  if (!paystackCredentialMatches(row, await io.identity(env))) fail('Restore the original Paystack connection before recovering this payment.', 409);
  validateInvoice(row, invoice);
  const code = requestCode(invoice.request_code);
  if (!Number.isSafeInteger(Number(invoice.id)) || !/^[0-9]+$/.test(clean(invoice.offline_reference))) fail('Paystack invoice details are incomplete.', 502);
  const next = { ...financeData(row), RequestCode: code, InvoiceId: clean(invoice.id), OfflineReference: clean(invoice.offline_reference), Status: 'Pending' };
  const link = await io.get(env, 'terminalPaymentCodes', code);
  if (link && link.RequestId !== row.RequestId) fail('This invoice is already linked to another payment.', 409);
  await io.commit(env, [writeRequest(next, row), ...(!link ? [financeWrite('terminalPaymentCodes', code, { RequestId: row.RequestId })] : [])]);
  return io.get(env, REQUESTS, row.RequestId);
}
function journalBody(row, transaction) {
  const fees = transaction.fees;
  if (!Number.isSafeInteger(fees) || fees < 0 || fees > row.AmountMinor) fail('Paystack has not confirmed the transaction fee yet. Check payment again.', 409);
  const paid = clean(transaction.paid_at || transaction.paidAt);
  if (!paid || !Number.isFinite(Date.parse(paid))) fail('The verified payment date is missing.', 409);
  const reference = clean(transaction.reference);
  const amount = row.AmountMinor / 100, fee = fees / 100;
  return { JournalNo: `SYS-TERMINAL-${row.RequestId}`, BranchId: row.BranchId, UserBranchId: row.BranchId,
    OrganisationEdition: row.Edition, Date: paid, Description: `${row.Description} · ${row.PayerName}`,
    Reference: reference, Source: 'Paystack Terminal', SourceId: row.RequestId, RevenueAccountCode: row.RevenueAccountCode,
    PaymentMethod: 'Paystack Terminal', Gateway: 'Paystack', Currency: 'NGN', Status: 'Posted', RecordedBy: row.CreatedBy,
    Lines: [ ...(amount > fee ? [{ AccountCode: '1030', Debit: amount - fee, Credit: 0, Description: 'Paystack clearing' }] : []),
      ...(fee ? [{ AccountCode: '6060', Debit: fee, Credit: 0, Description: 'Paystack transaction fee' }] : []),
      { AccountCode: row.RevenueAccountCode, Debit: 0, Credit: amount, Description: row.Description }] };
}

export async function verifyTerminalPayment(env, reference, overrides = {}) {
  const io = { ...deps, ...overrides };
  let row = await io.get(env, REQUESTS, id(reference));
  if (!row) fail('Terminal payment not found.', 404);
  if (['Paid', 'TestPaid'].includes(row.Status)) return reply(row);
  const identity = await io.identity(env);
  if (!paystackCredentialMatches(row, identity)) fail('The Paystack account changed. Restore the original connection to verify this payment.', 409);
  if (!row.RequestCode) return reply(row);
  const invoice = await io.provider(env, `/paymentrequest/${encodeURIComponent(row.RequestCode)}`);
  validateInvoice(row, invoice);
  if (invoice.paid !== true || !['success', 'paid'].includes(lower(invoice.status))) return reply(row, 'Paystack has not confirmed payment. No receipt has been posted.');
  const transactions = Array.isArray(invoice.transactions) ? invoice.transactions : [];
  // Only a transaction listed by this invoice may settle it. Do not trust a
  // reference supplied by a browser or an unrelated successful transaction.
  let transaction;
  for (const candidate of transactions.slice(-10)) {
    const candidateId = typeof candidate === 'object' ? candidate.id : candidate;
    const candidateReference = typeof candidate === 'object' ? clean(candidate.reference) : '';
    let tx;
    if (candidateReference) tx = await io.provider(env, `/transaction/verify/${encodeURIComponent(candidateReference)}`);
    else if (/^[0-9]+$/.test(clean(candidateId))) tx = await io.provider(env, `/transaction/${candidateId}`);
    if (tx?.status === 'success' && tx.domain === row.Mode && tx.currency === row.Currency && Number(tx.amount) === row.AmountMinor
      && customerMatches(tx.customer, row) && clean(tx.reference)
      && (candidateReference ? tx.reference === candidateReference : clean(tx.id) === clean(candidateId))) { transaction = tx; break; }
  }
  if (!transaction) fail('The invoice is paid but its matching successful transaction is not yet available. Check payment again; do not charge again.', 409);
  const next = { ...financeData(row), Status: row.Mode === 'test' ? 'TestPaid' : 'Paid', PaidAt: clean(transaction.paid_at || transaction.paidAt),
    TransactionReference: clean(transaction.reference), VerifiedAt: new Date().toISOString() };
  const claimId = await financeOperationId('TERMINAL-TX', row.PaystackCredentialFingerprint, next.TransactionReference);
  const claimed = await io.get(env, 'terminalTransactionClaims', claimId);
  if (claimed && claimed.RequestId !== row.RequestId) fail('This transaction already settled a different payment.', 409);
  const writes = [];
  if (row.Mode === 'live') {
    const prepared = await io.journal(env, journalBody(row, transaction));
    next.JournalNo = prepared.payload.JournalNo;
    next.ReceiptNo = row.RequestId;
    next.GatewayFee = transaction.fees / 100;
    next.NetAmount = (row.AmountMinor - transaction.fees) / 100;
    if (prepared.existing?.__id) {
      const completed = await io.get(env, REQUESTS, row.RequestId);
      if (completed?.Status === 'Paid') return reply(completed);
      fail('An existing terminal journal needs review before posting a receipt.', 409);
    }
    writes.push(financeWrite('accountingJournals', next.JournalNo, prepared.payload),
      financeWrite('terminalPaymentReceipts', next.ReceiptNo, { ...next, Gateway: 'Paystack', PaymentMethod: 'Paystack Terminal' }),
      financeWrite('accountingAudit', `TERMINAL-${row.RequestId}`, { Timestamp: next.VerifiedAt, Action: 'Verified terminal payment',
        EntityType: 'Terminal receipt', EntityId: next.ReceiptNo, BranchId: row.BranchId, User: row.CreatedBy,
        Details: `${row.PayerName}: NGN ${row.Amount} · ${row.Description}`, SourcePlatform: row.SourcePlatform || 'Web' }));
  }
  writes.push(writeRequest(next, row), ...(!claimed ? [financeWrite('terminalTransactionClaims', claimId, { RequestId: row.RequestId })] : []));
  try { await io.commit(env, writes); }
  catch (error) {
    // A webhook and cashier check may complete together. Read the winning
    // transaction, never overwrite it or repeat its ledger writes.
    row = await io.get(env, REQUESTS, row.RequestId);
    if (['Paid', 'TestPaid'].includes(row.Status)) return reply(row);
    throw error;
  }
  return reply(next);
}

export async function handleTerminalPayments(env, user, body = {}, overrides = {}) {
  const io = { ...deps, ...overrides }, branch = terminalStaffScope(user);
  const config = await io.config(env);
  if (!config.FeatureFlags.accounting) fail('Accounting is not enabled for this organisation.', 403);
  const action = clean(body.action);
  // Release gate is off unless operations explicitly activates it after hardware
  // acceptance. Stored branch settings cannot override this deployment lock.
  const available = env.CARD_TERMINAL_PAYMENTS_ENABLED === 'true';
  const disabledMessage = 'Card terminal payments are disabled for now. Setup can be saved, but new payments and terminal charges are unavailable.';
  if (!available && (['create', 'send'].includes(action) || action === 'save-settings' && body.enabled === true)) {
    fail(disabledMessage, 409);
  }
  if (action === 'settings') {
    const [settings, chart, identity] = await Promise.all([io.get(env, SETTINGS, branch), io.chart(env), io.identity(env)]);
    return { ok: true, branchId: branch, mode: identity.mode, canConfigure: canConfigure(user), available,
      disabledMessage: available ? '' : disabledMessage,
      settings: { ...publicSettings(settings), enabled: available && settings?.Enabled === true },
      accounts: terminalIncomeAccounts(chart, config.Edition), message: 'General income payments. Select the correct income account. School fees, wallets, store orders and hotel bills use their existing payment screens.' };
  }
  if (action === 'save-settings') {
    if (!canConfigure(user)) fail('Only an administrator can assign or enable a terminal.', 403);
    if (typeof body.enabled !== 'boolean') fail('Choose whether this terminal is enabled.');
    const current = await io.get(env, SETTINGS, branch);
    if (clean(body.version) !== clean(current?.__updateTime)) fail('Terminal settings changed. Reload them before saving.', 409);
    const next = { BranchId: branch, TerminalId: clean(body.terminalId), Label: clean(body.label).slice(0, 100), Enabled: body.enabled,
      SplitId: clean(body.splitId), UpdatedBy: user.username, UpdatedAt: new Date().toISOString() };
    const writes = [];
    if (next.Enabled) {
      next.TerminalId = terminalId(next.TerminalId);
      const identity = await io.identity(env);
      const device = await io.provider(env, `/terminal/${encodeURIComponent(next.TerminalId)}`);
      if (device.terminal_id !== next.TerminalId || device.status !== 'active' || device.domain !== identity.mode) fail('The terminal is not active on this Paystack connection.', 409);
      const claim = await io.get(env, 'paymentTerminalClaims', next.TerminalId);
      if (claim && claim.BranchId !== branch) fail('Disable this terminal in its current branch before moving it.', 409);
      if (!claim) writes.push(financeWrite('paymentTerminalClaims', next.TerminalId, { BranchId: branch }));
      next.PaystackCredentialFingerprint = identity.fingerprint;
      next.IntegrationId = clean(device.integration);
      const routing = await io.routing(env, branch);
      next.SubaccountCode = routing.paystack?.subaccountCode || '';
      if (next.SplitId) {
        if (!/^[0-9]+$/.test(next.SplitId)) fail('Enter the numeric Paystack split ID.');
        const split = await io.provider(env, `/split/${next.SplitId}`);
        if (split.active !== true || split.currency !== 'NGN' || !/^SPL_[A-Za-z0-9]+$/.test(clean(split.split_code))) fail('Choose an active NGN payment split.');
        if (routing.paystack?.subaccountCode && !(split.subaccounts || []).some(row => row.subaccount?.subaccount_code === routing.paystack.subaccountCode)) {
          fail('The split does not include this branch’s configured settlement subaccount.');
        }
        next.SplitCode = split.split_code;
      } else if (routing.paystack?.subaccountCode) fail('This branch settles to a subaccount. Configure its Paystack split ID before enabling terminal payments.');
    }
    if (current?.TerminalId && (!next.Enabled || current.TerminalId !== next.TerminalId)) {
      const claim = await io.get(env, 'paymentTerminalClaims', current.TerminalId);
      if (claim?.BranchId === branch) writes.push({ collectionPath: 'paymentTerminalClaims', documentId: current.TerminalId, delete: true, updateTime: claim.__updateTime });
    }
    writes.push(financeWrite(SETTINGS, branch, next, current));
    await io.commit(env, writes);
    return { ok: true, settings: publicSettings(await io.get(env, SETTINGS, branch)), message: next.Enabled ? 'Terminal verified and enabled for this branch.' : 'Terminal payments are disabled for this branch.' };
  }
  if (action === 'history') {
    const from = financeDate(body.dateFrom), to = financeDate(body.dateTo);
    if (from > to || Date.parse(to) - Date.parse(from) > 31 * 86400000) fail('Choose a date range of up to 31 days.');
    const cursor = clean(body.cursor);
    if (cursor && (cursor.length > 250 || !cursor.startsWith(`${branch}|`) || cursor < `${branch}|${from}` || cursor > `${branch}|${to}~`)) fail('Reload this branch’s selected history dates.');
    // One range field encodes branch+date: no tenant-wide scan or composite index.
    const rows = await io.query(env, REQUESTS, { filters: [
      { field: 'BranchDate', op: '>=', value: `${branch}|${from}` }, { field: 'BranchDate', op: cursor ? '<' : '<=', value: cursor || `${branch}|${to}~` }
    ], orderBy: [{ field: 'BranchDate', direction: 'DESCENDING' }], limit: 101 });
    return { ok: true, payments: rows.slice(0, 100).map(terminalPublicPayment), nextCursor: rows.length > 100 ? rows[99].BranchDate : '' };
  }
  if (!['create', 'get', 'recover', 'send', 'verify'].includes(action)) fail('Choose a valid card-terminal action.');
  const reference = id(body.requestId);
  let row = await io.get(env, REQUESTS, reference);
  if (row && row.BranchId !== branch) fail('This payment belongs to another branch.', 403);
  if (action === 'get') { if (!row) fail('Payment not found.', 404); return reply(row); }
  if (action === 'verify') { if (!row) fail('Payment not found.', 404); return verifyTerminalPayment(env, reference, io); }
  if (action === 'create') {
    const amount = financeMoney(body.amount, 'Amount', { min: 1, max: 10000000 });
    const instruction = { BranchId: branch, AmountMinor: Math.round(amount * 100), Currency: 'NGN', PayerName: clean(body.payerName),
      Email: lower(body.email), Description: clean(body.description), RevenueAccountCode: clean(body.accountCode) };
    if (!instruction.PayerName || instruction.PayerName.length > 120 || !instruction.Description || instruction.Description.length > 200
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(instruction.Email) || instruction.Email.length > 200) fail('Enter the payer name, valid email and payment description.');
    const digest = await financeOperationId('INSTRUCTION', instruction);
    if (row) {
      if (row.InstructionDigest !== digest) fail('This reference already belongs to another payment. Resume it instead of changing its details.', 409);
      return reply(row); // Never repeat POST /paymentrequest on an uncertain outcome.
    }
    const settings = await io.get(env, SETTINGS, branch), identity = await io.identity(env);
    if (!settings?.Enabled || !paystackCredentialMatches(settings, identity)) fail('Enable and verify a terminal for this branch first.', 409);
    const chart = await io.chart(env);
    const account = terminalIncomeAccounts(chart, config.Edition).find(item => item.code === instruction.RevenueAccountCode);
    if (!account) fail('Choose an active general-income account.');
    const routing = await io.routing(env, branch);
    if (clean(routing.paystack?.subaccountCode) !== clean(settings.SubaccountCode)) fail('Branch settlement changed. Review terminal split settings first.', 409);
    const now = new Date().toISOString();
    row = { ...instruction, RequestId: reference, InstructionDigest: digest, Amount: amount, RevenueAccountName: account.name,
      TerminalId: settings.TerminalId, SplitCode: settings.SplitCode || '', Mode: identity.mode, PaystackCredentialFingerprint: identity.fingerprint,
      Edition: config.Edition, Status: 'Creating', CreatedAt: now,
      BranchDate: `${branch}|${new Date(Date.parse(now) + 3600000).toISOString().replace('Z', '+01:00')}|${reference}`,
      CreatedBy: user.username, SourcePlatform: user.sourcePlatform || 'Web' };
    // Validate accounts and the open posting period before requesting money.
    if (row.Mode === 'live') await io.journal(env, journalBody(row, { fees: 0, paid_at: now, reference }));
    await io.commit(env, [writeRequest(row)]); // Durable claim before any provider mutation.
    row = await io.get(env, REQUESTS, reference);
    const customer = await io.provider(env, '/customer', { email: row.Email, first_name: row.PayerName });
    if (!/^CUS_[A-Za-z0-9]+$/.test(clean(customer.customer_code))) fail('Paystack did not return a valid customer.', 502);
    await io.commit(env, [writeRequest({ ...financeData(row), CustomerCode: customer.customer_code, CustomerId: clean(customer.id) }, row)]);
    row = await io.get(env, REQUESTS, reference);
    const invoice = await io.provider(env, '/paymentrequest', { customer: row.CustomerCode, amount: row.AmountMinor, currency: row.Currency,
      description: row.Description, send_notification: false, draft: false,
      ...(row.SplitCode ? { split_code: row.SplitCode } : {}),
      metadata: JSON.stringify({ dynamaxTerminalRequest: reference, paymentType: 'DynamaxTerminal' }) });
    return reply(await bindInvoice(env, row, invoice, io));
  }
  if (!row) fail('Payment not found.', 404);
  const identity = await io.identity(env);
  if (!paystackCredentialMatches(row, identity)) fail('Restore the original Paystack connection before continuing this payment.', 409);
  if (action === 'recover') {
    if (row.RequestCode) return reply(row);
    if (!row.CustomerCode) fail('Creation stopped before an invoice could be requested. No terminal charge was sent. Start a new payment.', 409);
    const invoice = await io.provider(env, `/paymentrequest/${encodeURIComponent(requestCode(body.requestCode))}`);
    return reply(await bindInvoice(env, row, invoice, io));
  }
  if (['Paid', 'TestPaid'].includes(row.Status)) return reply(row);
  if (!row.RequestCode) return reply(row);
  const settings = await io.get(env, SETTINGS, branch);
  if (!settings?.Enabled || settings.TerminalId !== row.TerminalId || !paystackCredentialMatches(settings, identity)) fail('This payment’s original terminal is disabled or reassigned. Check payment status before continuing.', 409);
  // Re-check payment before any push, including a lost delivery response.
  const verified = await verifyTerminalPayment(env, reference, io);
  if (['Paid', 'TestPaid'].includes(verified.payment.Status)) return verified;
  row = await io.get(env, REQUESTS, reference);
  if (row.Status === 'Dispatching' && Date.now() - Date.parse(row.DispatchAt) < 60000) return reply(row);
  const presence = await io.provider(env, `/terminal/${encodeURIComponent(row.TerminalId)}/presence`);
  if (presence.online !== true || presence.available !== true) fail('The terminal is offline or busy. This payment is retained; retry when it is available.', 409);
  const lease = await io.get(env, 'terminalDispatchLocks', row.TerminalId);
  if (lease && Number(lease.ExpiresAt) > Date.now()) fail('A request was just sent to this terminal. Check its screen and wait a minute before sending another.', 409);
  await io.commit(env, [writeRequest({ ...financeData(row), Status: 'Dispatching', DispatchAt: new Date().toISOString() }, row),
    financeWrite('terminalDispatchLocks', row.TerminalId, { RequestId: reference, ExpiresAt: Date.now() + 60000 }, lease)]);
  row = await io.get(env, REQUESTS, reference);
  const event = await io.provider(env, `/terminal/${encodeURIComponent(row.TerminalId)}/event`, {
    type: 'invoice', action: 'process', data: { id: Number(row.InvoiceId), reference: row.OfflineReference }
  });
  if (!clean(event.id)) fail('Terminal delivery was not confirmed. Check the same payment.', 502);
  try { await io.commit(env, [writeRequest({ ...financeData(row), Status: 'Sent', EventId: clean(event.id) }, row)]); }
  catch (error) { const latest = await io.get(env, REQUESTS, reference); if (!['Paid', 'TestPaid'].includes(latest.Status)) throw error; }
  return reply(await io.get(env, REQUESTS, reference));
}

// Called only after the webhook route has verified the Paystack signature.
export async function terminalPaymentWebhook(env, event, overrides = {}) {
  const io = { ...deps, ...overrides }, data = event?.data || {};
  const request = clean(meta(data.metadata).dynamaxTerminalRequest);
  if (event.event === 'paymentrequest.success') {
    const code = clean(data.request_code);
    if (!/^PRQ_[A-Za-z0-9]{5,80}$/.test(code)) return null;
    const link = await io.get(env, 'terminalPaymentCodes', code);
    const reference = link?.RequestId || request;
    if (!reference) return null;
    const row = await io.get(env, REQUESTS, id(reference));
    if (!row) return null;
    if (!row.RequestCode) {
      const invoice = await io.provider(env, `/paymentrequest/${encodeURIComponent(code)}`);
      await bindInvoice(env, row, invoice, io);
    }
    return verifyTerminalPayment(env, reference, io);
  }
  if (event.event === 'charge.success' && request) return verifyTerminalPayment(env, request, io);
  // POS events without an invoice identity must not become generic school
  // payments. The invoice event or staff verification will settle this request.
  if (event.event === 'charge.success' && data.channel === 'pos') return { ok: true, pendingInvoiceVerification: true };
  return null;
}
