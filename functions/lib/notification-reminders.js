import { batchUpsertDocuments, queryCollection } from './firestore.js';
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
  const future = dueDate && balance > 0 && reminderStatusEligible(invoice.Status) ? stages(settings)
    .map((stage) => ({ ...stage, date: addDays(dueDate, stage.dateDelta) }))
    .filter((stage) => !sent.includes(stage.key) && stage.date >= today)
    .sort((left, right) => left.date.localeCompare(right.date))[0] : null;
  return {
    ReminderEligible: Boolean(dueDate && balance > 0 && reminderStatusEligible(invoice.Status)),
    NextReminderDate: future?.date || '',
    NextReminderStage: future?.key || '',
    SentReminderStages: sent,
    ReminderBalance: balance
  };
}

function selectedStage(invoice, settings, today) {
  const sent = new Set(Array.isArray(invoice.SentReminderStages) ? invoice.SentReminderStages.map(clean) : []);
  return stages(settings)
    .map((stage) => ({ ...stage, date: addDays(invoice.DueDate, stage.dateDelta) }))
    .filter((stage) => stage.date && stage.date <= today && !sent.has(stage.key))
    .sort((left, right) => right.date.localeCompare(left.date))[0] || null;
}

function groupKey(invoice, stage) {
  return [
    lower(invoice.BranchId || 'main'), lower(invoice.SchoolSection), lower(invoice.AccountRef),
    lower(invoice.AcademicSession), lower(invoice.Term), lower(invoice.Currency || 'NGN'),
    dateOnly(invoice.DueDate), stage.key
  ].join('::');
}

export async function processFeeReminderSchedule(env, options = {}) {
  const today = dateOnly(options.today || new Date().toISOString()) || new Date().toISOString().slice(0, 10);
  const limit = Math.max(1, Math.min(500, Number(options.limit || 250)));
  const settings = await loadNotificationSettings(env);
  const query = options.queryCollection || queryCollection;
  const [scheduledRows, legacyRows] = await Promise.all([
    query(env, 'invoices', {
      filters: [
        { field: 'ReminderEligible', op: '==', value: true },
        { field: 'NextReminderDate', op: '<=', value: today }
      ],
      orderBy: [{ field: 'NextReminderDate', direction: 'ASCENDING' }],
      limit
    }),
    query(env, 'invoices', {
      filters: [
        { field: 'DueDate', op: '>=', value: addDays(today, -30) },
        { field: 'DueDate', op: '<=', value: addDays(today, 14) }
      ],
      orderBy: [{ field: 'DueDate', direction: 'ASCENDING' }],
      limit
    })
  ]);
  const invoices = [...new Map([...scheduledRows, ...legacyRows]
    .map((row) => [clean(row.InvoiceId || row.__id), row])).values()].slice(0, limit);
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
  const writes = [];
  for (const group of groups.values()) {
    const aggregate = aggregateSchoolFeeDueInvoices(group.invoices)[0] || group.invoices[0];
    const result = await (options.notifyParentPaymentDue || notifyParentPaymentDue)(env, {
      ...aggregate,
      ParentEmails: [...new Set(group.invoices.flatMap((row) => Array.isArray(row.ParentEmails) ? row.ParentEmails : [row.ParentEmail]).map(lower).filter(Boolean))],
      ScheduleStage: group.stage.key,
      NotificationMessage: group.stage.key.startsWith('overdue')
        ? `${clean(aggregate.FeeName || 'School fees')} of ${clean(aggregate.Currency || 'NGN')} ${amount(aggregate.Balance).toLocaleString('en-NG', { minimumFractionDigits: 2 })} is overdue by ${group.stage.days} day${group.stage.days === 1 ? '' : 's'}.`
        : `${clean(aggregate.FeeName || 'School fees')} of ${clean(aggregate.Currency || 'NGN')} ${amount(aggregate.Balance).toLocaleString('en-NG', { minimumFractionDigits: 2 })} is due ${group.stage.days === 0 ? 'today' : `in ${group.stage.days} day${group.stage.days === 1 ? '' : 's'}`}.`
    });
    if (result.created) created += 1;
    else duplicates += 1;
    group.invoices.forEach((invoice) => {
      const updated = {
        ...invoice,
        SentReminderStages: [...new Set([...(invoice.SentReminderStages || []), group.stage.key])],
        LastReminderStage: group.stage.key,
        LastReminderAt: new Date().toISOString(),
        UpdatedAt: new Date().toISOString()
      };
      Object.assign(updated, invoiceReminderFields(updated, settings, today));
      writes.push({ collectionPath: 'invoices', documentId: clean(invoice.InvoiceId || invoice.__id), data: updated });
    });
  }
  if (writes.length) await (options.batchUpsertDocuments || batchUpsertDocuments)(env, writes);
  return { ok: true, date: today, inspected: invoices.length, groups: groups.size, created, duplicates, updated: writes.length };
}
