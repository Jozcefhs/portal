import { batchUpsertDocuments, listCollection } from '../functions/lib/firestore.js';
import { invoiceReminderFields } from '../functions/lib/notification-reminders.js';
import { loadNotificationSettings } from '../functions/lib/notifications.js';

const apply = process.argv.includes('--apply');
const env = {
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  DYNAMAX_WORKSPACE_ID: process.env.DYNAMAX_WORKSPACE_ID
};
const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'DYNAMAX_WORKSPACE_ID'];
const missing = required.filter((key) => !String(env[key] || '').trim());
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

const settings = await loadNotificationSettings(env);
const invoices = await listCollection(env, 'invoices', { pageSize: 1000, maxPages: 25 });
const writes = invoices.map((invoice) => {
  const data = { ...invoice, ...invoiceReminderFields(invoice, settings), UpdatedAt: invoice.UpdatedAt || new Date().toISOString() };
  return {
    collectionPath: 'invoices',
    documentId: String(invoice.InvoiceId || invoice.__id || '').trim(),
    data,
    updateTime: invoice.__updateTime
  };
}).filter((write) => write.documentId);

const summary = {
  mode: apply ? 'apply' : 'dry-run',
  workspaceId: env.DYNAMAX_WORKSPACE_ID,
  invoicesInspected: invoices.length,
  invoicesPrepared: writes.length,
  eligible: writes.filter((write) => write.data.ReminderEligible).length
};

if (apply) {
  for (let index = 0; index < writes.length; index += 400) {
    await batchUpsertDocuments(env, writes.slice(index, index + 400));
  }
}

console.log(JSON.stringify(summary, null, 2));
