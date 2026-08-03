import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  archiveNotification,
  createNotification,
  normalizeNotification,
  notificationTargetsRecipient,
  parentPaymentDueNotification,
  parentPaymentNotification,
  quietHoursActive,
  listNotifications,
  staffRequisitionEventNotification
} from '../functions/lib/notifications.js';
import { invoiceReminderFields, processFeeReminderSchedule } from '../functions/lib/notification-reminders.js';
import { deliveryDocumentId, subscriptionDocumentId } from '../functions/lib/firebase-messaging.js';

const invoice = (overrides = {}) => ({
  InvoiceId: 'INV-1', AccountRef: 'STD-1', ParentEmail: 'parent@example.com',
  BranchId: 'main', SchoolSection: 'secondary', FeeCode: 'TUITION', FeeName: 'Tuition',
  FeeCategory: 'School Fee', Balance: 100000, Amount: 100000, Currency: 'NGN',
  AcademicSession: '2026/2027', Term: 'First Term', DueDate: '2026-08-15', Status: 'Unpaid',
  ...overrides
});

test('notification normalization stores central model metadata', () => {
  const row = normalizeNotification({ EventKey: 'event-1', Audience: 'Parent', Title: 'Title', Message: 'Body', Category: 'Fees', Channels: ['InApp', 'Push'], SchoolId: 'School-A' });
  assert.equal(row.SchoolId, 'school-a');
  assert.equal(row.Category, 'Fees');
  assert.deepEqual(row.Channels, ['InApp', 'Push']);
  assert.equal(row.DeliveryStatus, 'Created');
});

test('central notification creation is idempotent', async () => {
  let creates = 0;
  const createDocumentIfAbsent = async (_env, _collection, _id, record) => ({ created: ++creates === 1, document: record });
  const input = { EventKey: 'same-event', Audience: 'Staff', TargetUsernames: ['admin'], Title: 'Once', Message: 'Only once', Channels: ['InApp'] };
  assert.equal((await createNotification({}, input, { createDocumentIfAbsent })).created, true);
  assert.equal((await createNotification({}, input, { createDocumentIfAbsent })).created, false);
});

test('deleting from the tray archives only the recipient read state', async () => {
  const writes = [];
  const state = await archiveNotification({}, 'NOTIF-1', 'Admin', true, {
    getDocument: async (_env, collection) => collection === 'notifications' ? { NotificationId: 'NOTIF-1' } : null,
    upsertDocument: async (_env, collection, id, document) => { writes.push({ collection, id, document }); }
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].collection, 'notificationReads');
  assert.equal(state.RecipientKey, 'admin');
  assert.ok(state.ArchivedAt);
});

test('notification creation exposes the real push delivery result', async () => {
  const env = {
    FIREBASE_WEB_API_KEY: 'api-key',
    FIREBASE_PROJECT_ID: 'school-project',
    FIREBASE_APP_ID: 'app-id',
    FIREBASE_MESSAGING_SENDER_ID: 'sender-id',
    FCM_VAPID_KEY: 'vapid-key'
  };
  const result = await createNotification(env, {
    EventKey: 'push-result:test',
    Audience: 'Staff',
    Channels: ['Push'],
    TargetUsernames: ['admin'],
    Title: 'Push test',
    Message: 'Delivery status test'
  }, {
    createDocumentIfAbsent: async (_env, _collection, _id, document) => ({ created: true, document }),
    dispatchNotificationPush: async () => [{ status: 'Delivered', deliveryId: 'DEL-1' }]
  });
  assert.deepEqual(result.pushDeliveries, [{ status: 'Delivered', deliveryId: 'DEL-1' }]);
});

test('payment confirmation targets every known active parent email', () => {
  const row = parentPaymentNotification({ Reference: 'PAY-1', AccountRef: 'STD-1', ParentEmails: ['one@example.com', 'two@example.com'], Amount: 5000 });
  assert.deepEqual(row.TargetEmails, ['one@example.com', 'two@example.com']);
  assert.equal(row.Category, 'Payments');
});

test('payment due notification carries its deterministic reminder stage', () => {
  const row = parentPaymentDueNotification(invoice({ ScheduleStage: 'due-7' }));
  assert.match(row.EventKey, /due-7$/);
  assert.equal(row.ScheduleStage, 'due-7');
});

test('14-day fee reminder is scheduled', () => {
  const fields = invoiceReminderFields(invoice(), {}, '2026-08-01');
  assert.equal(fields.NextReminderStage, 'due-14');
  assert.equal(fields.NextReminderDate, '2026-08-01');
});

test('7-day fee reminder follows the 14-day reminder', () => {
  const fields = invoiceReminderFields(invoice({ SentReminderStages: ['due-14'] }), {}, '2026-08-01');
  assert.equal(fields.NextReminderStage, 'due-7');
  assert.equal(fields.NextReminderDate, '2026-08-08');
});

test('3-day fee reminder follows the 7-day reminder', () => {
  const fields = invoiceReminderFields(invoice({ SentReminderStages: ['due-14', 'due-7'] }), {}, '2026-08-08');
  assert.equal(fields.NextReminderStage, 'due-3');
});

test('1-day fee reminder follows the 3-day reminder', () => {
  const fields = invoiceReminderFields(invoice({ SentReminderStages: ['due-14', 'due-7', 'due-3'] }), {}, '2026-08-12');
  assert.equal(fields.NextReminderStage, 'due-1');
});

test('same-day fee reminder follows the 1-day reminder', () => {
  const fields = invoiceReminderFields(invoice({ SentReminderStages: ['due-14', 'due-7', 'due-3', 'due-1'] }), {}, '2026-08-14');
  assert.equal(fields.NextReminderStage, 'due-0');
  assert.equal(fields.NextReminderDate, '2026-08-15');
});

test('paid invoices are removed from reminder eligibility', () => {
  const fields = invoiceReminderFields(invoice({ Balance: 0, Status: 'Paid' }), {}, '2026-08-01');
  assert.equal(fields.ReminderEligible, false);
  assert.equal(fields.NextReminderDate, '');
});

test('cancelled fee records are removed from reminder eligibility', () => {
  const fields = invoiceReminderFields(invoice({ Status: 'Cancelled' }), {}, '2026-08-01');
  assert.equal(fields.ReminderEligible, false);
  assert.equal(fields.NextReminderDate, '');
});

test('part-paid invoices retain the remaining reminder balance', () => {
  const fields = invoiceReminderFields(invoice({ Balance: 25000, Credit: 75000, Status: 'Part Paid' }), {}, '2026-08-01');
  assert.equal(fields.ReminderEligible, true);
  assert.equal(fields.ReminderBalance, 25000);
});

test('overdue schedule sends the applicable stage', async () => {
  let sent;
  const row = invoice({ DueDate: '2026-07-31', NextReminderDate: '2026-08-01', ReminderEligible: true, SentReminderStages: ['due-14', 'due-7', 'due-3', 'due-1', 'due-0'] });
  const result = await processFeeReminderSchedule({}, {
    today: '2026-08-01',
    queryCollection: async () => [row],
    notifyParentPaymentDue: async (_env, notice) => { sent = notice; return { created: true }; },
    batchUpsertDocuments: async () => {}
  });
  assert.equal(sent.ScheduleStage, 'overdue-1');
  assert.equal(result.created, 1);
});

test('scheduler reports duplicate reminder events without creating another', async () => {
  const row = invoice({ NextReminderDate: '2026-08-01', ReminderEligible: true });
  const result = await processFeeReminderSchedule({}, {
    today: '2026-08-01', queryCollection: async () => [row],
    notifyParentPaymentDue: async () => ({ created: false }), batchUpsertDocuments: async () => {}
  });
  assert.equal(result.duplicates, 1);
});

for (const event of ['Submitted', 'Approved', 'Rejected', 'Pushed', 'Posted']) {
  test(`requisition ${event.toLowerCase()} transition builds the correct notification`, () => {
    const row = staffRequisitionEventNotification({ ExpenseNo: 'REQ-1', Amount: 20000, Department: 'Science', RequestedByUsername: 'requester', BranchId: 'main', SchoolSection: 'secondary', UpdatedAt: '2026-08-01T10:00:00Z' }, event, 'reviewer');
    assert.equal(row.Type, `Requisition ${event}`);
    assert.equal(row.Category, 'Requisitions');
    assert.match(row.EventKey, new RegExp(`requisition-${event.toLowerCase()}`));
  });
}

test('subscription identity is isolated by recipient and device', () => {
  assert.notEqual(subscriptionDocumentId('user-a', 'device-1'), subscriptionDocumentId('user-b', 'device-1'));
});

test('workspace identity prevents cross-school notification access', () => {
  const row = normalizeNotification({ EventKey: 'school-scope', Audience: 'Staff', TargetUsernames: ['admin'], Title: 'Private', Message: 'Private', SchoolId: 'school-a' });
  assert.equal(notificationTargetsRecipient(row, { audience: 'Staff', username: 'admin', schoolId: 'school-b' }), false);
});

test('quiet hours use the configured organisation timezone', () => {
  const settings = { QuietHoursEnabled: true, QuietHoursStart: '21:00', QuietHoursEnd: '06:00', Timezone: 'Africa/Lagos' };
  assert.equal(quietHoursActive(settings, new Date('2026-08-01T20:30:00.000Z')), true);
  assert.equal(quietHoursActive(settings, new Date('2026-08-01T10:00:00.000Z')), false);
});

test('disabled notification categories are respected by in-app history', async () => {
  const row = normalizeNotification({ EventKey: 'fees-off', Audience: 'Staff', TargetUsernames: ['admin'], Title: 'Fee', Message: 'Fee', Category: 'Fees' });
  const result = await listNotifications({}, { audience: 'Staff', username: 'admin', recipientKey: 'admin' }, {
    queryCollection: async (_env, collection) => collection === 'notifications' ? [row] : [],
    getDocument: async () => null,
    preferences: { Channels: { InApp: true }, Categories: { Fees: false } }
  });
  assert.equal(result.notifications.length, 0);
});

test('delivery identity prevents duplicate sends per device and channel', () => {
  assert.equal(deliveryDocumentId('N-1', 'push', 'user-a', 'd-1'), deliveryDocumentId('N-1', 'push', 'user-a', 'd-1'));
  assert.notEqual(deliveryDocumentId('N-1', 'push', 'user-a', 'd-1'), deliveryDocumentId('N-1', 'push', 'user-a', 'd-2'));
});

test('parent dashboard reads do not create payment or due notifications', async () => {
  const source = await readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /notifyParentPayment(?:Due|Received)/);
});

test('push permission is requested only by the explicit enable operation', async () => {
  const source = await readFile(new URL('../js/web-push.js', import.meta.url), 'utf8');
  assert.match(source, /async function enable/);
  assert.equal((source.match(/Notification\.requestPermission\(\)/g) || []).length, 1);
  assert.match(source, /messagingModule\.isSupported\(\)/);
  assert.match(source, /getApps\(\)\.find/);
  assert.doesNotMatch(source, /getApps\(\)\[0\]/);
});

test('denied push permission returns a user-facing error without breaking in-app use', async () => {
  const source = await readFile(new URL('../js/web-push.js', import.meta.url), 'utf8');
  assert.match(source, /permission !== 'granted'/);
  assert.match(source, /Notification permission was not granted/);
});

test('foreground push displays a deduplicated audible system notification', async () => {
  const [client, worker] = await Promise.all([
    readFile(new URL('../js/web-push.js', import.meta.url), 'utf8'),
    readFile(new URL('../sw.js', import.meta.url), 'utf8')
  ]);
  assert.match(client, /void showForegroundNotification\(payload\)/);
  assert.match(client, /registration\.getNotifications\(\{ tag \}\)/);
  assert.match(client, /registration\.showNotification\(title, options\)/);
  assert.match(client, /icon:\s*TRANSPARENT_NOTIFICATION_ICON/);
  assert.match(client, /badge:\s*'\/images\/notification-badge\.png\?v=20260803-monochrome-status-badge'/);
  assert.doesNotMatch(client, /\bicon:\s*notification\.icon/);
  assert.doesNotMatch(client, /\bbadge:\s*notification\.badge/);
  assert.match(client, /silent:\s*false/);
  assert.match(client, /vibrate:\s*\[200, 100, 200\]/);
  assert.match(worker, /self\.registration\.getNotifications\(\{ tag \}\)/);
  assert.match(worker, /icon:\s*TRANSPARENT_NOTIFICATION_ICON/);
  assert.match(worker, /badge:\s*'\/images\/notification-badge\.png\?v=20260803-monochrome-status-badge'/);
  assert.doesNotMatch(worker, /\bicon:\s*notification\.icon/);
  assert.doesNotMatch(worker, /\bbadge:\s*notification\.badge/);
  assert.match(worker, /silent:\s*false/);
  assert.match(worker, /vibrate:\s*\[200, 100, 200\]/);
});

test('invalid FCM subscriptions are removed after provider rejection', async () => {
  const source = await readFile(new URL('../functions/lib/firebase-messaging.js', import.meta.url), 'utf8');
  assert.match(source, /error\.invalidToken/);
  assert.match(source, /deleteDocument\(env, 'notificationSubscriptions'/);
  assert.match(source, /allSubscriptions\.filter\(\(row\) => clean\(row\.DeviceId\) === clean\(options\.deviceId\)\)/);
  assert.doesNotMatch(source, /fcm_options:\s*\{\s*link:\s*clean\(notification\.ActionUrl/);
});

test('test push endpoints reject missing devices and surface delivery failures', async () => {
  const [staff, parent] = await Promise.all([
    readFile(new URL('../functions/api/staff-notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8')
  ]);
  for (const source of [staff, parent]) {
    assert.match(source, /Enable push on this device before sending a test notification/);
    assert.match(source, /testResult\.pushDeliveries\.some\(\(delivery\) => delivery\.status === 'Delivered'\)/);
  }
});

test('parent and staff notification APIs retain protected authentication', async () => {
  const [staff, parent] = await Promise.all([
    readFile(new URL('../functions/api/staff-notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8')
  ]);
  assert.match(staff, /requireStaffSession/);
  assert.match(parent, /assertParentAccess/);
});
