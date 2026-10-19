import {
  createDocumentIfAbsent,
  getDocument,
  queryCollection,
  upsertDocument
} from './firestore.js';

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function values(input) {
  const rows = Array.isArray(input) ? input : clean(input).split(',');
  return [...new Set(rows.map(clean).filter(Boolean))];
}

function lowerValues(input) {
  return [...new Set(values(input).map(lower).filter(Boolean))];
}

function safeId(value) {
  return clean(value)
    .replace(/[\/\\?#\[\]]/g, '-')
    .replace(/[^a-zA-Z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 170);
}

function shortHash(value) {
  let hash = 2166136261;
  for (const character of clean(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase();
}

function nowIso() {
  return new Date().toISOString();
}

function amount(value) {
  const number = Number(String(value ?? '0').replace(/[₦,\s]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function money(value, currency = 'NGN') {
  try {
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: clean(currency) || 'NGN'
    }).format(amount(value));
  } catch {
    return `${clean(currency) || 'NGN'} ${amount(value).toFixed(2)}`;
  }
}

export function notificationDocumentId(eventKey) {
  const key = clean(eventKey);
  if (!key) throw new Error('A notification event key is required.');
  return `NOTIF-${safeId(key).slice(0, 130)}-${shortHash(key)}`;
}

export function normalizeNotification(input = {}, createdAt = nowIso()) {
  const audience = lower(input.Audience || input.audience);
  if (!['staff', 'parent'].includes(audience)) {
    throw new Error('Notification audience must be Staff or Parent.');
  }
  const eventKey = clean(input.EventKey || input.eventKey || input.NotificationId || input.notificationId);
  const title = clean(input.Title || input.title);
  const message = clean(input.Message || input.message);
  if (!eventKey || !title || !message) {
    throw new Error('Notification event key, title and message are required.');
  }
  const notificationId = notificationDocumentId(eventKey);
  return {
    NotificationId: notificationId,
    EventKey: eventKey,
    Type: clean(input.Type || input.type || 'General'),
    Audience: audience === 'staff' ? 'Staff' : 'Parent',
    TargetRoles: values(input.TargetRoles || input.targetRoles),
    TargetUsernames: lowerValues(input.TargetUsernames || input.targetUsernames),
    TargetEmails: lowerValues(input.TargetEmails || input.targetEmails),
    TargetAccountRefs: lowerValues(input.TargetAccountRefs || input.targetAccountRefs),
    Title: title,
    Message: message,
    ActionUrl: clean(input.ActionUrl || input.actionUrl),
    RecordType: clean(input.RecordType || input.recordType),
    RecordId: clean(input.RecordId || input.recordId),
    DueDate: clean(input.DueDate || input.dueDate),
    BranchId: lower(input.BranchId || input.branchId || 'main') || 'main',
    SchoolSection: lower(input.SchoolSection || input.schoolSection),
    CreatedAt: clean(input.CreatedAt || input.createdAt || createdAt),
    CreatedBy: clean(input.CreatedBy || input.createdBy || 'System')
  };
}

export async function createNotification(env, input, options = {}) {
  const record = normalizeNotification(input, options.now || nowIso());
  const create = options.createDocumentIfAbsent || createDocumentIfAbsent;
  const result = await create(env, 'notifications', record.NotificationId, record);
  return {
    created: Boolean(result?.created),
    notification: result?.document ? { ...result.document, ...record } : record
  };
}

function sameScope(notification, recipient = {}) {
  const wantedBranches = lowerValues([
    ...(Array.isArray(recipient.branchIds) ? recipient.branchIds : []),
    recipient.branchId,
    recipient.BranchId
  ]);
  const wantedSections = lowerValues([
    ...(Array.isArray(recipient.schoolSections) ? recipient.schoolSections : []),
    recipient.schoolSection,
    recipient.SchoolSection,
    recipient.schoolSectionAccess
  ]);
  const branchMatches = !wantedBranches.length || wantedBranches.includes('all') ||
    wantedBranches.includes(lower(notification.BranchId || 'main'));
  const sectionMatches = !wantedSections.length || wantedSections.includes('all') ||
    !clean(notification.SchoolSection) || wantedSections.includes(lower(notification.SchoolSection));
  return branchMatches && sectionMatches;
}

function notificationScopeMatches(notification, scope = {}) {
  const branch = lower(scope.branchId || scope.BranchId);
  const section = lower(scope.schoolSection || scope.SchoolSection);
  return Boolean(branch && section) &&
    lower(notification.BranchId || 'main') === branch &&
    (!clean(notification.SchoolSection) || lower(notification.SchoolSection) === section);
}

function parentScopeBindings(recipient = {}) {
  const supplied = Array.isArray(recipient.scopes) ? recipient.scopes : [];
  if (supplied.length) {
    return supplied.map((scope) => ({
      accountRef: lower(scope.accountRef || scope.AccountRef),
      branchId: lower(scope.branchId || scope.BranchId),
      schoolSection: lower(scope.schoolSection || scope.SchoolSection)
    })).filter((scope) => scope.branchId && scope.schoolSection);
  }
  const branches = lowerValues(recipient.branchIds || recipient.BranchIds);
  const sections = lowerValues(recipient.schoolSections || recipient.SchoolSections);
  if (branches.length !== 1 || sections.length !== 1) return [];
  const refs = lowerValues(recipient.accountRefs || recipient.AccountRefs);
  return (refs.length ? refs : ['']).map((accountRef) => ({
    accountRef,
    branchId: branches[0],
    schoolSection: sections[0]
  }));
}

function staffScopeBinding(recipient = {}) {
  const rawBranch = lower(recipient.branchId || recipient.BranchId);
  const rawSection = lower(
    recipient.schoolSection || recipient.SchoolSection ||
    recipient.schoolSectionAccess || recipient.SchoolSectionAccess
  );
  return {
    branchId: rawBranch === 'all' ? '' : rawBranch,
    schoolSection: rawSection === 'all' ? '' : rawSection
  };
}

function notificationQueryScopes(recipient = {}, audience = '', lookup = {}) {
  let scopes = audience === 'parent'
    ? parentScopeBindings(recipient)
    : [staffScopeBinding(recipient)];
  if (audience === 'parent' && lookup.field === 'TargetAccountRefs') {
    const accountRef = lower(lookup.value);
    scopes = scopes.filter((scope) => lower(scope.accountRef) === accountRef);
  }
  const unique = new Map();
  scopes.forEach((scope) => {
    const branchId = lower(scope.branchId || scope.BranchId);
    const schoolSection = lower(scope.schoolSection || scope.SchoolSection);
    const key = `${branchId}::${schoolSection}`;
    if (!unique.has(key)) unique.set(key, { branchId, schoolSection });
  });
  return [...unique.values()];
}

function missingQueryIndex(error) {
  return clean(error?.upstreamCode).toUpperCase() === 'FAILED_PRECONDITION' &&
    /\bindex\b/i.test(clean(error?.message));
}

export function notificationTargetsRecipient(notification = {}, recipient = {}) {
  const audience = lower(recipient.audience || recipient.Audience);
  if (lower(notification.Audience) !== audience) return false;
  if (audience === 'staff') {
    if (!sameScope(notification, recipient)) return false;
    const username = lower(recipient.username || recipient.Username);
    const role = lower(recipient.role || recipient.Role);
    const usernames = lowerValues(notification.TargetUsernames);
    const roles = lowerValues(notification.TargetRoles);
    return (username && usernames.includes(username)) || (role && roles.includes(role));
  }
  if (audience === 'parent') {
    const email = lower(recipient.email || recipient.ParentEmail || recipient.Email);
    const targetEmails = lowerValues(notification.TargetEmails);
    const targetRefs = lowerValues(notification.TargetAccountRefs);
    const scopes = parentScopeBindings(recipient);
    if (!scopes.length) return false;
    const emailMatches = email && targetEmails.includes(email);
    return scopes.some((scope) => {
      if (!notificationScopeMatches(notification, scope)) return false;
      return emailMatches || (scope.accountRef && targetRefs.includes(scope.accountRef));
    });
  }
  return false;
}

export function notificationReadDocumentId(notificationId, recipientKey) {
  const value = `${clean(notificationId)}::${lower(recipientKey)}`;
  if (!clean(notificationId) || !lower(recipientKey)) {
    throw new Error('Notification and recipient are required.');
  }
  return `READ-${safeId(value).slice(0, 130)}-${shortHash(value)}`;
}

function uniqueNotifications(rows = []) {
  const records = new Map();
  rows.forEach((row) => {
    const id = clean(row.NotificationId || row.__id);
    if (id && !records.has(id)) records.set(id, row);
  });
  return [...records.values()];
}

async function queryTargetedNotifications(env, recipient, query, limit) {
  const audience = lower(recipient.audience || recipient.Audience);
  const lookups = [];
  if (audience === 'staff') {
    const username = lower(recipient.username || recipient.Username);
    const role = clean(recipient.role || recipient.Role);
    if (username) lookups.push({ field: 'TargetUsernames', value: username });
    if (role) lookups.push({ field: 'TargetRoles', value: role });
  } else if (audience === 'parent') {
    const email = lower(recipient.email || recipient.ParentEmail || recipient.Email);
    if (email) lookups.push({ field: 'TargetEmails', value: email });
    const accountRefs = lowerValues([
      ...values(recipient.accountRefs || recipient.AccountRefs),
      ...parentScopeBindings(recipient).map((scope) => scope.accountRef)
    ]);
    accountRefs.forEach((reference) => {
      lookups.push({ field: 'TargetAccountRefs', value: reference });
    });
  }
  if (!lookups.length) return [];
  const perTargetLimit = Math.max(25, Math.min(200, Number(limit || 50) * 2));
  const plans = [];
  lookups.forEach(({ field, value }) => {
    const scopes = notificationQueryScopes(recipient, audience, { field, value });
    scopes.forEach((scope) => {
      const sectionFilters = scope.schoolSection ? [scope.schoolSection, ''] : [null];
      sectionFilters.forEach((schoolSectionFilter) => {
        plans.push({ field, value, ...scope, schoolSectionFilter });
      });
    });
  });
  if (!plans.length) return [];
  const uniquePlans = [...new Map(plans.map((plan) => [
    [
      plan.field,
      lower(plan.value),
      plan.branchId,
      plan.schoolSectionFilter === null ? '*' : plan.schoolSectionFilter
    ].join('::'),
    plan
  ])).values()];
  const broadTargetQueries = new Map();
  const broadRows = async (field, value) => {
    const key = `${field}::${lower(value)}`;
    if (!broadTargetQueries.has(key)) {
      broadTargetQueries.set(key, query(env, 'notifications', {
        filters: [{ field, op: 'array-contains', value }]
      }));
    }
    return broadTargetQueries.get(key);
  };
  const groups = await Promise.all(uniquePlans.map(async (plan) => {
    const filters = [{ field: plan.field, op: 'array-contains', value: plan.value }];
    if (plan.branchId) filters.push({ field: 'BranchId', op: '==', value: plan.branchId });
    if (plan.schoolSectionFilter !== null) {
      filters.push({ field: 'SchoolSection', op: '==', value: plan.schoolSectionFilter });
    }
    const options = {
      filters,
      orderBy: [{ field: 'CreatedAt', direction: 'DESCENDING' }],
      limit: perTargetLimit
    };
    try {
      return await query(env, 'notifications', options);
    } catch (error) {
      if (!missingQueryIndex(error)) throw error;
      const rows = await broadRows(plan.field, plan.value);
      return rows.filter((row) => {
        const branchMatches = !plan.branchId ||
          lower(row.BranchId || 'main') === plan.branchId;
        const sectionMatches = plan.schoolSectionFilter === null
          ? true
          : plan.schoolSectionFilter === ''
            ? !clean(row.SchoolSection)
            : lower(row.SchoolSection) === plan.schoolSectionFilter;
        return branchMatches && sectionMatches;
      });
    }
  }));
  return uniqueNotifications(groups.flat());
}

function chunks(rows, size = 30) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

async function readStatesForNotifications(env, recipientKey, notificationIds, query, get) {
  const groups = await Promise.all(chunks(notificationIds).map(async (ids) => {
    try {
      return await query(env, 'notificationReads', {
        filters: [
          { field: 'RecipientKey', op: '==', value: recipientKey },
          { field: 'NotificationId', op: 'in', value: ids }
        ],
        limit: ids.length
      });
    } catch (error) {
      if (!missingQueryIndex(error)) throw error;
      return (await Promise.all(ids.map((notificationId) =>
        get(env, 'notificationReads', notificationReadDocumentId(notificationId, recipientKey))
          .catch(() => null)
      ))).filter(Boolean);
    }
  }));
  const wanted = new Set(notificationIds);
  return uniqueNotifications(groups.flat())
    .filter((row) =>
      lower(row.RecipientKey) === recipientKey &&
      wanted.has(clean(row.NotificationId))
    );
}

export async function listNotifications(env, recipient, options = {}) {
  const recipientKey = lower(
    recipient.recipientKey || recipient.RecipientKey ||
    recipient.username || recipient.Username ||
    recipient.email || recipient.ParentEmail || recipient.Email
  );
  if (!recipientKey) throw new Error('A notification recipient is required.');
  const query = options.queryCollection || queryCollection;
  const get = options.getDocument || getDocument;
  const limit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const rows = await queryTargetedNotifications(env, recipient, query, limit);
  const visible = rows
    .filter((row) => notificationTargetsRecipient(row, recipient))
    .sort((left, right) => clean(right.CreatedAt).localeCompare(clean(left.CreatedAt)))
    .slice(0, limit);
  const reads = visible.length
    ? await readStatesForNotifications(
        env,
        recipientKey,
        visible.map((row) => clean(row.NotificationId || row.__id)).filter(Boolean),
        query,
        get
      )
    : [];
  const readById = new Map(reads.map((row) => [clean(row.NotificationId), row]));
  const notifications = visible.map((row) => ({
      ...row,
      Read: readById.has(clean(row.NotificationId)),
      ReadAt: clean(readById.get(clean(row.NotificationId))?.ReadAt)
    }));
  return {
    notifications,
    unreadCount: notifications.filter((row) => !row.Read).length
  };
}

export async function markNotificationRead(env, notificationId, recipientKey, options = {}) {
  const get = options.getDocument || getDocument;
  const upsert = options.upsertDocument || upsertDocument;
  const id = clean(notificationId);
  const key = lower(recipientKey);
  const notification = await get(env, 'notifications', id);
  if (!notification) {
    const error = new Error('Notification not found.');
    error.status = 404;
    throw error;
  }
  const readAt = clean(options.now || nowIso());
  const read = {
    NotificationId: id,
    RecipientKey: key,
    ReadAt: readAt
  };
  await upsert(env, 'notificationReads', notificationReadDocumentId(id, key), read);
  return read;
}

export async function markAllNotificationsRead(env, notifications, recipientKey, options = {}) {
  const rows = Array.isArray(notifications) ? notifications : [];
  await Promise.all(rows.filter((row) => !row.Read).map((row) =>
    markNotificationRead(env, row.NotificationId, recipientKey, options)
  ));
  return rows.length;
}

export function staffRequisitionNotification(requisition = {}, submittedBy = '') {
  const recordId = clean(requisition.ExpenseNo || requisition.RequisitionNo || requisition.RecordId);
  const revision = clean(
    requisition.ResubmittedAt || requisition.RequestedAt || requisition.UpdatedAt ||
    requisition.Revision || requisition.ResubmissionCount
  );
  const material = lower(requisition.RequisitionType) === 'material';
  return {
    EventKey: `requisition-submitted:${lower(requisition.BranchId || 'main')}:${lower(requisition.SchoolSection || 'all')}:${recordId}:${revision}`,
    Type: 'Requisition Submitted',
    Audience: 'Staff',
    TargetRoles: ['Super Admin', 'Accounts Officer', 'Management'],
    Title: material ? 'Material requisition submitted' : 'Requisition submitted',
    Message: `${clean(requisition.Department) || 'A department'} submitted ${recordId || 'a requisition'} for ${money(requisition.Amount)}.`,
    ActionUrl: 'admin.html?section=financeRequests',
    RecordType: 'Requisition',
    RecordId: recordId,
    BranchId: requisition.BranchId || 'main',
    SchoolSection: requisition.SchoolSection,
    CreatedBy: submittedBy || requisition.RequestedBy || 'System'
  };
}

export async function notifyStaffRequisitionSubmitted(env, requisition, submittedBy = '', options = {}) {
  return createNotification(env, staffRequisitionNotification(requisition, submittedBy), options);
}

export function parentPaymentNotification(payment = {}) {
  const reference = clean(
    payment.Reference || payment.GatewayReference || payment.PaymentId || payment.ReceiptNo
  );
  const accountRef = clean(payment.AccountRef || payment.AdmissionNo || payment.ApplicationReference);
  return {
    EventKey: `payment-received:${lower(payment.BranchId || 'main')}:${lower(payment.SchoolSection || 'all')}:${reference || payment.PaidAt}:${accountRef}`,
    Type: 'Payment Received',
    Audience: 'Parent',
    TargetEmails: [payment.ParentEmail || payment.VerificationEmail || payment.Email].filter(Boolean),
    TargetAccountRefs: [accountRef].filter(Boolean),
    Title: 'Payment received',
    Message: `${money(payment.Amount || payment.Credit, payment.Currency)} was received for ${clean(payment.FeeName || payment.Description || 'your child account')}.`,
    ActionUrl: 'parent-dashboard.html?tab=payments',
    RecordType: 'Payment',
    RecordId: reference,
    BranchId: payment.BranchId || 'main',
    SchoolSection: payment.SchoolSection,
    CreatedAt: payment.PaidAt || payment.RecordedAt,
    CreatedBy: payment.RecordedBy || 'Accounts Office'
  };
}

export async function notifyParentPaymentReceived(env, payment, options = {}) {
  return createNotification(env, parentPaymentNotification(payment), options);
}

function dueBalance(invoice = {}) {
  const explicit = invoice.Balance ?? invoice.BalanceAmount;
  if (explicit !== undefined && explicit !== '') return Math.max(0, amount(explicit));
  const debit = amount(invoice.Debit ?? invoice.Amount);
  return Math.max(0, debit - amount(invoice.Credit));
}

function schoolFeeInvoice(invoice = {}) {
  return lower(invoice.FeeCategory).replace(/[_-]+/g, ' ') === 'school fee' ||
    lower(invoice.FeeCode) === 'school_fees_total';
}

export function aggregateSchoolFeeDueInvoices(invoices = []) {
  const groups = new Map();
  (Array.isArray(invoices) ? invoices : [])
    .filter((invoice) => schoolFeeInvoice(invoice))
    .filter((invoice) => clean(invoice.DueDate) && dueBalance(invoice) > 0)
    .forEach((invoice) => {
      const accountRef = clean(invoice.AccountRef || invoice.AdmissionNo || invoice.ApplicationReference);
      const key = [
        lower(invoice.BranchId || 'main'),
        lower(invoice.SchoolSection),
        lower(accountRef),
        lower(invoice.AcademicSession),
        lower(invoice.Term),
        lower(invoice.Currency || 'NGN')
      ].join('::');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(invoice);
    });
  return [...groups.values()].map((rows) => {
    const aggregateRows = rows.filter((row) => lower(row.FeeCode) === 'school_fees_total');
    const sources = aggregateRows.length ? aggregateRows : rows;
    const first = sources[0];
    const balance = amount(sources.reduce((sum, row) => sum + dueBalance(row), 0));
    const dueDate = sources.map((row) => clean(row.DueDate)).filter(Boolean).sort()[0] || '';
    return {
      ...first,
      InvoiceId: 'SCHOOL_FEES_TOTAL',
      Reference: 'SCHOOL_FEES_TOTAL',
      FeeCode: 'SCHOOL_FEES_TOTAL',
      FeeName: 'School Fees Total',
      FeeCategory: 'School Fee',
      Amount: balance,
      Debit: balance,
      Credit: 0,
      Balance: balance,
      DueDate: dueDate
    };
  });
}

export function parentPaymentDueNotification(invoice = {}) {
  const invoiceId = clean(invoice.FeeCode || invoice.InvoiceId || invoice.Reference || invoice.RecordId);
  const accountRef = clean(invoice.AccountRef || invoice.AdmissionNo || invoice.ApplicationReference);
  const period = [lower(invoice.AcademicSession), lower(invoice.Term)].filter(Boolean).join(':');
  return {
    EventKey: `payment-due:${lower(invoice.BranchId || 'main')}:${lower(invoice.SchoolSection || 'all')}:${lower(invoiceId)}:${period}:${lower(invoice.DueDate)}:${lower(accountRef)}`,
    Type: 'Payment Due',
    Audience: 'Parent',
    TargetEmails: [invoice.ParentEmail || invoice.VerificationEmail || invoice.Email].filter(Boolean),
    TargetAccountRefs: [accountRef].filter(Boolean),
    Title: 'Payment due date',
    Message: `${clean(invoice.FeeName || invoice.Description || 'A school charge')} of ${money(invoice.Balance || invoice.Amount, invoice.Currency)} is due ${clean(invoice.DueDate) ? `on ${clean(invoice.DueDate)}` : 'soon'}.`,
    ActionUrl: 'parent-dashboard.html?tab=payments',
    RecordType: 'Invoice',
    RecordId: invoiceId,
    DueDate: invoice.DueDate,
    BranchId: invoice.BranchId || 'main',
    SchoolSection: invoice.SchoolSection,
    CreatedAt: invoice.CreatedAt || invoice.Date,
    CreatedBy: invoice.RecordedBy || 'Accounts Office'
  };
}

export async function notifyParentPaymentDue(env, invoice, options = {}) {
  if (!clean(invoice?.DueDate) || amount(invoice?.Balance ?? invoice?.Amount) <= 0) {
    return { created: false, skipped: true, notification: null };
  }
  return createNotification(env, parentPaymentDueNotification(invoice), options);
}
