import { batchUpsertDocuments, queryCollection } from './firestore.js';
import { queueNotificationPush } from './school-announcements.js';
import {
  aggregateSchoolFeeDueInvoices,
  loadNotificationSettings,
  notifyParentPaymentDue
} from './notifications.js';

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();

function dateOnly(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${dateOnly(value)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function amount(value) {
  const number = Number(String(value ?? 0).replace(/[,\s]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function reminderStatusEligible(status) {
  return !['paid', 'cancelled', 'canceled', 'voided', 'waived'].includes(lower(status));
}

function stages(settings = {}) {
  const due = (settings.FeeDueIntervals || [14, 7, 3, 1, 0]).map(Number).filter((value) => Number.isInteger(value) && value >= 0)
    .map((days) => ({ key: `due-${days}`, days, dateDelta: -days }));
  const overdue = (settings.FeeOverdueIntervals || [1, 7, 14, 30]).map(Number).filter((value) => Number.isInteger(value) && value > 0)
    .map((days) => ({ key: `overdue-${days}`, days, dateDelta: days }));
  return [...due, ...overdue];
}

export function invoiceReminderFields(invoice = {}, settings = {}, today = new Date().toISOString().slice(0, 10)) {
  const dueDate = dateOnly(invoice.DueDate);
  const balance = Math.max(0, amount(invoice.Balance ?? invoice.Amount) - (invoice.Balance === undefined ? amount(invoice.Credit) : 0));
  const sent = Array.isArray(invoice.SentReminderStages) ? [...new Set(invoice.SentReminderStages.map(clean).filter(Boolean))] : [];
  const eligible = dueDate && balance > 0 && reminderStatusEligible(invoice.Status);
  const future = eligible ? stages(settings)
    .map((stage) => ({ ...stage, date: addDays(dueDate, stage.dateDelta) }))
    .filter((stage) => !sent.includes(stage.key) && stage.date >= today)
    .sort((left, right) => left.date.localeCompare(right.date))[0] : null;
  const next = eligible ? selectedStage(invoice, settings, today) || future : null;
  return {
    ReminderEligible: Boolean(next),
    NextReminderDate: next?.date || '',
    NextReminderStage: next?.key || '',
    SentReminderStages: sent,
    ReminderBalance: balance
  };
}

function selectedStage(invoice, settings, today) {
  const sent = new Set(Array.isArray(invoice.SentReminderStages) ? invoice.SentReminderStages.map(clean) : []);
  const latest = stages(settings)
    .map((stage) => ({ ...stage, date: addDays(invoice.DueDate, stage.dateDelta) }))
    .filter((stage) => stage.date && stage.date <= today)
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  // Once the latest applicable stage is recorded, never fall back to an older
  // missed stage on retries or on the next day.
  return latest && !sent.has(latest.key) ? latest : null;
}

function groupKey(invoice, stage) {
  const schoolFee = lower(invoice.FeeCategory).replace(/[_-]+/g, ' ') === 'school fee'
    || lower(invoice.FeeCode) === 'school_fees_total';
  return [
    lower(invoice.BranchId || 'main'), lower(invoice.SchoolSection), lower(invoice.AccountRef),
    lower(invoice.AcademicSession), lower(invoice.Term), lower(invoice.Currency || 'NGN'),
    dateOnly(invoice.DueDate), stage.key,
    schoolFee ? 'school-fees' : lower(invoice.FeeCode || invoice.InvoiceId || invoice.__id)
  ].join('::');
}

function pageOptions(env, cursor) {
  if (!cursor?.afterName) return {};
  const prefix = `projects/${clean(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents/invoices/`;
  if (!clean(cursor.afterName).startsWith(prefix) || clean(cursor.afterName).slice(prefix.length).includes('/')
    || !dateOnly(cursor.afterValue)) throw Object.assign(new Error('Invalid fee-reminder page cursor.'), { status: 400 });
  return { startAfterName: cursor.afterName, startAfterFieldValue: cursor.afterValue };
}

function nextPage(rows, limit, field) {
  if (rows.length < limit) return { done: true };
  const last = rows.at(-1);
  if (!clean(last.__name)) throw new Error('The reminder page is missing its database cursor.');
  return { afterName: last.__name, afterValue: clean(last[field]), done: false };
}

export async function processFeeReminderSchedule(env, options = {}) {
  const today = dateOnly(options.today || new Date().toISOString()) || new Date().toISOString().slice(0, 10);
  const limit = Math.max(1, Math.min(50, Number(options.limit || 25)));
  const settings = await (options.loadNotificationSettings || loadNotificationSettings)(env);
  const query = options.queryCollection || queryCollection;
  const cursor = options.cursor || {};
  const [scheduledRows, legacyRows] = await Promise.all([
    cursor.scheduled?.done ? [] : query(env, 'invoices', {
      filters: [
        { field: 'ReminderEligible', op: '==', value: true },
        { field: 'NextReminderDate', op: '>', value: '' },
        { field: 'NextReminderDate', op: '<=', value: today }
      ],
      orderBy: [{ field: 'NextReminderDate', direction: 'ASCENDING' }, { field: '__name__', direction: 'ASCENDING' }],
      ...pageOptions(env, cursor.scheduled, 'NextReminderDate'),
      limit
    }),
    cursor.legacy?.done ? [] : query(env, 'invoices', {
      filters: [
        { field: 'DueDate', op: '>=', value: addDays(today, -30) },
        { field: 'DueDate', op: '<=', value: addDays(today, 14) }
      ],
      orderBy: [{ field: 'DueDate', direction: 'ASCENDING' }, { field: '__name__', direction: 'ASCENDING' }],
      ...pageOptions(env, cursor.legacy, 'DueDate'),
      limit
    })
  ]);
  const invoices = [...new Map([...scheduledRows, ...legacyRows]
    .map((row) => [clean(row.__name || row.__id || row.InvoiceId), row])).values()];
  const groups = new Map();
  invoices.forEach((invoice) => {
    if (amount(invoice.Balance) <= 0 || !reminderStatusEligible(invoice.Status)) return;
    const stage = selectedStage(invoice, settings, today);
    if (!stage) return;
    const key = groupKey(invoice, stage);
    if (!groups.has(key)) groups.set(key, { stage, invoices: [] });
    groups.get(key).invoices.push(invoice);
  });
  let created = 0;
  let duplicates = 0;
  let pushQueued = 0;
  const writes = [];
  const accountInvoices = new Map();
  for (const group of groups.values()) {
    const seed = group.invoices[0];
    // A page boundary must never turn a pupil's total into a partial reminder.
    // Fetch only this account, then enforce the full branch/period/due-date key.
    // Never silently truncate an unusually large account.
    const accountRef = clean(seed.AccountRef);
    if (!accountRef) continue;
    if (!accountInvoices.has(accountRef)) {
      const rows = await query(env, 'invoices', {
        filters: [{ field: 'AccountRef', op: '==', value: accountRef }], limit: 501
      });
      if (rows.length >= 501) throw new Error('Fee reminder account exceeds the bounded review limit.');
      accountInvoices.set(accountRef, rows);
    }
    const key = groupKey(seed, group.stage);
    group.invoices = accountInvoices.get(accountRef).filter(row => groupKey(row, group.stage) === key
      && amount(row.Balance) > 0 && reminderStatusEligible(row.Status));
    if (!group.invoices.length) continue;
    const pending = group.invoices.filter(row => selectedStage(row, settings, today)?.key === group.stage.key);
    if (!pending.length) continue;
    const aggregate = aggregateSchoolFeeDueInvoices(group.invoices)[0] || group.invoices[0];
    const result = await (options.notifyParentPaymentDue || notifyParentPaymentDue)(env, {
      ...aggregate,
      ParentEmails: [...new Set(group.invoices.flatMap((row) => Array.isArray(row.ParentEmails) ? row.ParentEmails : [row.ParentEmail]).map(lower).filter(Boolean))],
      ScheduleStage: group.stage.key,
      NotificationMessage: group.stage.key.startsWith('overdue')
        ? `${clean(aggregate.FeeName || 'School fees')} of ${clean(aggregate.Currency || 'NGN')} ${amount(aggregate.Balance).toLocaleString('en-NG', { minimumFractionDigits: 2 })} is overdue by ${group.stage.days} day${group.stage.days === 1 ? '' : 's'}.`
        : `${clean(aggregate.FeeName || 'School fees')} of ${clean(aggregate.Currency || 'NGN')} ${amount(aggregate.Balance).toLocaleString('en-NG', { minimumFractionDigits: 2 })} is due ${group.stage.days === 0 ? 'today' : `in ${group.stage.days} day${group.stage.days === 1 ? '' : 's'}`}.`
    }, { retryDelivery: false, deliver: false });
    // Durable, deterministic queue entries resume after an interrupted request.
    // The five-minute worker delivers these; a daily retry never sends directly.
    if (result.notification?.NotificationId && result.notification.Channels?.includes('Push')) {
      const job = await (options.queueNotificationPush || queueNotificationPush)(env, result.notification);
      if (!lower(job.Status).startsWith('completed')) pushQueued += 1;
    }
    if (result.created) created += 1;
    else duplicates += 1;
    pending.forEach((invoice) => {
      const updated = {
        ...invoice,
        SentReminderStages: [...new Set([...(invoice.SentReminderStages || []), group.stage.key])],
        LastReminderStage: group.stage.key,
        LastReminderAt: new Date().toISOString(),
      };
      Object.assign(updated, invoiceReminderFields(updated, settings, today));
      const fields = ['SentReminderStages', 'LastReminderStage', 'LastReminderAt', 'ReminderEligible', 'NextReminderDate', 'NextReminderStage', 'ReminderBalance'];
      writes.push({ collectionPath: 'invoices', documentId: clean(invoice.__id || invoice.InvoiceId),
        literalDocumentId: true, updateMask: fields,
        ...(clean(invoice.__updateTime) ? { updateTime: invoice.__updateTime } : { exists: true }),
        data: Object.fromEntries(fields.map(field => [field, updated[field]])) });
    });
  }
  for (let start = 0; start < writes.length; start += 450) {
    await (options.batchUpsertDocuments || batchUpsertDocuments)(env, writes.slice(start, start + 450));
  }
  const nextCursor = { scheduled: nextPage(scheduledRows, limit, 'NextReminderDate'), legacy: nextPage(legacyRows, limit, 'DueDate') };
  const hasMore = !nextCursor.scheduled.done || !nextCursor.legacy.done;
  return { ok: true, date: today, inspected: invoices.length, groups: groups.size, created, duplicates, pushQueued,
    updated: writes.length, hasMore, cursor: hasMore ? nextCursor : null };
}
