import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  aggregateSchoolFeeDueInvoices,
  createNotification,
  listNotifications,
  markNotificationRead,
  notificationDocumentId,
  notificationSettingsForAudience,
  notificationTargetsRecipient,
  parentPaymentDueNotification,
  parentPaymentNotification,
  staffRequisitionNotification
} from '../functions/lib/notifications.js';
import { parentPayableNotificationIdentity } from '../functions/api/parent-dashboard.js';

test('notification ids are deterministic while preserving distinct events', () => {
  assert.equal(
    notificationDocumentId('payment:PAY-001'),
    notificationDocumentId('payment:PAY-001')
  );
  assert.notEqual(
    notificationDocumentId('payment:PAY-001'),
    notificationDocumentId('payment:PAY-002')
  );
});

test('school notification policies override parent and staff category preferences', () => {
  const system = {
    AudiencePolicies: {
      Parent: { Channels: { InApp: true, Push: false }, Categories: { Fees: true, Requisitions: false } },
      Staff: { Channels: { InApp: false, Push: true }, Categories: { Fees: false, Requisitions: true } }
    }
  };
  const user = { Channels: { InApp: true, Push: true }, Categories: { Fees: true, Requisitions: true } };
  const parent = notificationSettingsForAudience(system, user, 'Parent');
  const staff = notificationSettingsForAudience(system, user, 'Staff');
  assert.equal(parent.Channels.Push, false);
  assert.equal(parent.Categories.Requisitions, false);
  assert.equal(staff.Channels.InApp, false);
  assert.equal(staff.Categories.Fees, false);
  assert.equal(parent.ManagedByOrganisation, true);
});

test('parent and staff notification types are school-managed by default', () => {
  const parent = notificationSettingsForAudience({}, {
    Channels: { InApp: false, Push: false },
    Categories: { Payments: false }
  }, 'Parent');
  assert.deepEqual(parent.Channels, { InApp: true, Push: true });
  assert.equal(parent.Categories.Payments, true);
  assert.equal(parent.Categories.Requisitions, false);
});

test('staff requisition notifications target finance decision makers in the record scope', () => {
  const notification = staffRequisitionNotification({
    ExpenseNo: 'WEB-MAT-20260730-ABC123',
    RequisitionType: 'Material',
    Amount: 125000,
    Department: 'Administration',
    RequestedAt: '2026-07-30T10:00:00.000Z',
    BranchId: 'main',
    SchoolSection: 'secondary'
  }, 'Requester');
  assert.equal(notification.Type, 'Requisition Submitted');
  assert.match(notification.Message, /Administration submitted WEB-MAT-20260730-ABC123/);
  assert.deepEqual(notification.TargetRoles, ['Super Admin', 'Accounts Officer', 'Management']);
  assert.equal(notificationTargetsRecipient(
    { ...notification, Audience: 'Staff' },
    { audience: 'Staff', role: 'Super Admin', branchId: 'main', schoolSectionAccess: 'secondary' }
  ), true);
  assert.equal(notificationTargetsRecipient(
    { ...notification, Audience: 'Staff' },
    { audience: 'Staff', role: 'Clinic User', branchId: 'main', schoolSectionAccess: 'secondary' }
  ), false);
  assert.equal(notificationTargetsRecipient(
    { ...notification, Audience: 'Staff' },
    { audience: 'Staff', role: 'Super Admin', branchId: '', schoolSectionAccess: 'All' }
  ), true);
});

test('parent payment notifications can be targeted through email or student account reference', () => {
  const notification = parentPaymentNotification({
    Reference: 'PAY-007',
    AccountRef: 'DCA/26/001',
    ParentEmail: 'Parent@Example.com',
    FeeName: 'Tuition',
    Amount: 50000,
    PaidAt: '2026-07-30T11:00:00.000Z'
  });
  assert.equal(notificationTargetsRecipient(
    { ...notification, Audience: 'Parent' },
    {
      audience: 'Parent',
      email: 'parent@example.com',
      accountRefs: [],
      branchIds: ['main'],
      schoolSections: ['secondary']
    }
  ), true);
  assert.equal(notificationTargetsRecipient(
    { ...notification, Audience: 'Parent' },
    {
      audience: 'Parent',
      email: 'other@example.com',
      accountRefs: ['dca/26/001'],
      branchIds: ['main'],
      schoolSections: ['secondary']
    }
  ), true);
  assert.equal(notificationTargetsRecipient(
    { ...notification, Audience: 'Parent' },
    {
      audience: 'Parent',
      email: 'other@example.com',
      accountRefs: ['dca/26/999'],
      branchIds: ['main'],
      schoolSections: ['secondary']
    }
  ), false);
});

test('parent notifications cannot cross branch or school-section boundaries on a repeated account reference', () => {
  const notification = parentPaymentNotification({
    Reference: 'PAY-008',
    AccountRef: 'DCA/26/001',
    Amount: 1000,
    BranchId: 'branch-b',
    SchoolSection: 'primary'
  });
  assert.equal(notificationTargetsRecipient(
    { ...notification, Audience: 'Parent' },
    {
      audience: 'Parent',
      email: 'parent@example.com',
      accountRefs: ['dca/26/001'],
      branchIds: ['branch-a'],
      schoolSections: ['secondary']
    }
  ), false);
  assert.equal(notificationTargetsRecipient(
    { ...notification, Audience: 'Parent' },
    {
      audience: 'Parent',
      email: 'parent@example.com',
      accountRefs: ['dca/26/001'],
      branchIds: ['branch-b'],
      schoolSections: ['primary']
    }
  ), true);
});

test('parent notification scope bindings do not create Cartesian branch and section access', () => {
  const notification = parentPaymentNotification({
    Reference: 'PAY-009',
    AccountRef: 'DCA/26/001',
    Amount: 1000,
    BranchId: 'west',
    SchoolSection: 'primary'
  });
  assert.equal(notificationTargetsRecipient(
    { ...notification, Audience: 'Parent' },
    {
      audience: 'Parent',
      email: 'parent@example.com',
      scopes: [
        { accountRef: 'dca/26/001', branchId: 'main', schoolSection: 'primary' },
        { accountRef: 'dca/26/002', branchId: 'west', schoolSection: 'secondary' }
      ]
    }
  ), false);
});

test('payable notification identity comes only from the validated server account', () => {
  assert.deepEqual(parentPayableNotificationIdentity({
    account: {
      AccountRef: 'DCA/26/001',
      Email: 'Verified@Example.com',
      BranchId: 'west',
      SchoolSection: 'primary'
    }
  }), {
    accountRef: 'DCA/26/001',
    email: 'verified@example.com',
    branchId: 'west',
    schoolSection: 'primary'
  });
});

test('notification event identities remain isolated by branch and school section', () => {
  const first = parentPaymentNotification({
    Reference: 'PAY-SHARED',
    AccountRef: 'DCA/26/001',
    Amount: 1000,
    BranchId: 'main',
    SchoolSection: 'secondary'
  });
  const second = parentPaymentNotification({
    Reference: 'PAY-SHARED',
    AccountRef: 'DCA/26/001',
    Amount: 1000,
    BranchId: 'west',
    SchoolSection: 'primary'
  });
  assert.notEqual(first.EventKey, second.EventKey);
});

test('payment due notification keeps the due date and outstanding balance', () => {
  const notification = parentPaymentDueNotification({
    InvoiceId: 'INV-1',
    AccountRef: 'DCA/26/001',
    FeeName: 'Tuition',
    Balance: 75000,
    DueDate: '2026-08-10'
  });
  assert.equal(notification.Type, 'Payment Due');
  assert.equal(notification.DueDate, '2026-08-10');
  assert.match(notification.Message, /2026-08-10/);
  assert.match(notification.Message, /75,000/);
});

test('invoice due notifications retain one event identity after dashboard normalization', () => {
  const direct = parentPaymentDueNotification({
    InvoiceId: 'INV-1',
    FeeCode: 'TUITION',
    AccountRef: 'DCA/26/001',
    DueDate: '2026-08-10',
    Balance: 75000
  });
  const normalized = parentPaymentDueNotification({
    Reference: 'INV-1',
    FeeCode: 'TUITION',
    AccountRef: 'DCA/26/001',
    DueDate: '2026-08-10',
    Balance: 75000
  });
  assert.equal(direct.EventKey, normalized.EventKey);
});

test('fee-definition and invoice due paths deduplicate by fee and billing period', () => {
  const invoice = parentPaymentDueNotification({
    InvoiceId: 'INV-RANDOM',
    FeeCode: 'TUITION',
    AccountRef: 'DCA/26/001',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    DueDate: '2026-08-10',
    Balance: 75000,
    BranchId: 'main',
    SchoolSection: 'secondary'
  });
  const payable = parentPaymentDueNotification({
    InvoiceId: 'TUITION',
    FeeCode: 'TUITION',
    AccountRef: 'DCA/26/001',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    DueDate: '2026-08-10',
    Amount: 75000,
    BranchId: 'main',
    SchoolSection: 'secondary'
  });
  assert.equal(invoice.EventKey, payable.EventKey);
});

test('school-fee component invoices aggregate into one total due event', () => {
  const aggregate = aggregateSchoolFeeDueInvoices([
    {
      InvoiceId: 'INV-TUITION',
      FeeCode: 'TUITION',
      FeeName: 'Tuition',
      FeeCategory: 'School Fee',
      AccountRef: 'DCA/26/001',
      AcademicSession: '2026/2027',
      Term: 'First Term',
      DueDate: '2026-08-15',
      Balance: 75000,
      BranchId: 'main',
      SchoolSection: 'secondary'
    },
    {
      InvoiceId: 'INV-DEVELOPMENT',
      FeeCode: 'DEVELOPMENT',
      FeeName: 'Development Levy',
      FeeCategory: 'School Fee',
      AccountRef: 'DCA/26/001',
      AcademicSession: '2026/2027',
      Term: 'First Term',
      DueDate: '2026-08-10',
      Balance: 50000,
      BranchId: 'main',
      SchoolSection: 'secondary'
    }
  ]);
  assert.equal(aggregate.length, 1);
  assert.equal(aggregate[0].FeeCode, 'SCHOOL_FEES_TOTAL');
  assert.equal(aggregate[0].FeeName, 'School Fees Total');
  assert.equal(aggregate[0].Balance, 125000);
  assert.equal(aggregate[0].DueDate, '2026-08-10');

  const invoiceEvent = parentPaymentDueNotification(aggregate[0]);
  const payableEvent = parentPaymentDueNotification({
    FeeCode: 'SCHOOL_FEES_TOTAL',
    FeeName: 'School Fees Total',
    FeeCategory: 'School Fee',
    AccountRef: 'dca/26/001',
    AcademicSession: '2026/2027',
    Term: 'First Term',
    DueDate: '2026-08-10',
    Amount: 125000,
    BranchId: 'main',
    SchoolSection: 'secondary'
  });
  assert.equal(invoiceEvent.EventKey, payableEvent.EventKey);
  assert.match(invoiceEvent.Message, /125,000/);
});

test('createNotification is idempotent through a stable event document', async () => {
  const calls = [];
  const result = await createNotification({}, {
    EventKey: 'requisition:REQ-1:submitted',
    Audience: 'Staff',
    TargetRoles: ['Super Admin'],
    Title: 'Submitted',
    Message: 'A request was submitted.'
  }, {
    now: '2026-07-30T12:00:00.000Z',
    createDocumentIfAbsent: async (_env, collection, documentId, data) => {
      calls.push({ collection, documentId, data });
      return { created: true, document: data };
    }
  });
  assert.equal(result.created, true);
  assert.equal(calls[0].collection, 'notifications');
  assert.equal(calls[0].documentId, notificationDocumentId('requisition:REQ-1:submitted'));
});

test('list and read helpers keep unread state per recipient', async () => {
  const notification = {
    NotificationId: notificationDocumentId('staff:1'),
    EventKey: 'staff:1',
    Audience: 'Staff',
    TargetRoles: ['Super Admin'],
    TargetUsernames: [],
    Title: 'Review request',
    Message: 'A request is ready.',
    BranchId: 'main',
    SchoolSection: 'secondary',
    CreatedAt: '2026-07-30T12:00:00.000Z'
  };
  const unread = await listNotifications({}, {
    audience: 'Staff',
    username: 'admin',
    role: 'Super Admin',
    branchId: 'main',
    schoolSectionAccess: 'secondary'
  }, {
    queryCollection: async (_env, collection) => collection === 'notifications'
      ? [notification]
      : []
  });
  assert.equal(unread.unreadCount, 1);
  assert.equal(unread.notifications[0].Read, false);

  const pushOnly = await listNotifications({}, {
    audience: 'Staff', username: 'admin', role: 'Super Admin', branchId: 'main', schoolSectionAccess: 'secondary'
  }, {
    queryCollection: async (_env, collection) => collection === 'notifications'
      ? [{ ...notification, Channels: ['Push'] }]
      : []
  });
  assert.equal(pushOnly.notifications.length, 0);

  const writes = [];
  await markNotificationRead({}, notification.NotificationId, 'admin', {
    now: '2026-07-30T12:05:00.000Z',
    getDocument: async () => notification,
    upsertDocument: async (...args) => writes.push(args)
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][3].RecipientKey, 'admin');
});

test('target queries batch parent account references within their paired scope', async () => {
  const calls = [];
  const scopes = Array.from({ length: 5 }, (_, index) => ({
    accountRef: `child-${index + 1}`,
    branchId: index % 2 ? 'west' : 'main',
    schoolSection: index % 2 ? 'primary' : 'secondary'
  }));
  await listNotifications({}, {
    audience: 'Parent',
    recipientKey: 'parent@example.com',
    email: 'parent@example.com',
    accountRefs: scopes.map((scope) => scope.accountRef),
    scopes
  }, {
    queryCollection: async (_env, collection, options) => {
      if (collection === 'notifications') calls.push(options);
      return [];
    }
  });

  const uniqueScopeCount = new Set(scopes.map((scope) =>
    `${scope.branchId}::${scope.schoolSection}`
  )).size;
  assert.equal(calls.length, uniqueScopeCount * 4);
  calls.filter((options) => options.filters[0].field === 'TargetAccountRefs')
    .forEach((options) => {
      assert.equal(options.filters[0].op, 'array-contains-any');
      const accountRefs = options.filters[0].value;
      const expected = scopes.filter((scope) => accountRefs.includes(scope.accountRef));
      assert.ok(expected.length > 0);
      assert.equal(new Set(expected.map((scope) => scope.branchId)).size, 1);
      assert.equal(new Set(expected.map((scope) => scope.schoolSection)).size, 1);
      assert.equal(options.filters.find((filter) => filter.field === 'BranchId')?.value, expected[0].branchId);
      assert.ok([
        expected[0].schoolSection,
        ''
      ].includes(options.filters.find((filter) => filter.field === 'SchoolSection')?.value));
    });
  assert.equal(calls.some((options) =>
    options.filters.some((filter) => filter.field === 'BranchId' && filter.value === '')
  ), false);
});

test('missing read-state index falls back to one recipient query', async () => {
  const notification = {
    NotificationId: notificationDocumentId('read-fallback'),
    Audience: 'Staff',
    TargetRoles: ['Super Admin'],
    BranchId: 'main',
    SchoolSection: 'secondary',
    CreatedAt: '2026-07-30T12:00:00.000Z'
  };
  const readCalls = [];
  const result = await listNotifications({}, {
    audience: 'Staff', recipientKey: 'admin', role: 'Super Admin',
    branchId: 'main', schoolSectionAccess: 'secondary'
  }, {
    queryCollection: async (_env, collection, options) => {
      if (collection === 'notifications') {
        const section = options.filters.find((filter) => filter.field === 'SchoolSection')?.value;
        return section === '' ? [] : [notification];
      }
      readCalls.push(options);
      if (options.filters.some((filter) => filter.field === 'NotificationId')) {
        const error = new Error('The query requires an index.');
        error.upstreamCode = 'FAILED_PRECONDITION';
        throw error;
      }
      return [{ NotificationId: notification.NotificationId, RecipientKey: 'admin', ReadAt: '2026-07-30T13:00:00.000Z' }];
    }
  });
  assert.equal(readCalls.length, 2);
  assert.deepEqual(readCalls[1].filters, [{ field: 'RecipientKey', op: '==', value: 'admin' }]);
  assert.equal(result.notifications[0].Read, true);
});

test('missing scoped indexes fall back without limiting before authorization filtering', async () => {
  const calls = [];
  const rows = [
    ...Array.from({ length: 150 }, (_, index) => ({
      NotificationId: notificationDocumentId(`west:${index}`),
      Audience: 'Staff',
      TargetRoles: ['Super Admin'],
      BranchId: 'west',
      SchoolSection: 'secondary',
      CreatedAt: `2026-07-30T10:${String(index % 60).padStart(2, '0')}:00.000Z`
    })),
    {
      NotificationId: notificationDocumentId('main:scoped'),
      Audience: 'Staff',
      TargetRoles: ['Super Admin'],
      BranchId: 'main',
      SchoolSection: 'secondary',
      CreatedAt: '2026-07-30T12:00:00.000Z'
    }
  ];
  const result = await listNotifications({}, {
    audience: 'Staff',
    recipientKey: 'admin',
    role: 'Super Admin',
    branchId: 'main',
    schoolSectionAccess: 'secondary'
  }, {
    queryCollection: async (_env, collection, options) => {
      calls.push({ collection, options });
      if (collection === 'notificationReads') return [];
      if (options.filters.length === 1) return rows;
      const error = new Error('The query requires an index.');
      error.upstreamCode = 'FAILED_PRECONDITION';
      throw error;
    }
  });
  assert.deepEqual(result.notifications.map((row) => row.NotificationId), [
    notificationDocumentId('main:scoped')
  ]);
  const broad = calls.find((call) =>
    call.collection === 'notifications' && call.options.filters.length === 1
  );
  assert.ok(broad);
  assert.equal(Object.hasOwn(broad.options, 'limit'), false);
});

test('read-state queries use the exact visible notification ids in bounded chunks', async () => {
  const rows = Array.from({ length: 31 }, (_, index) => ({
    NotificationId: notificationDocumentId(`visible:${index}`),
    Audience: 'Staff',
    TargetRoles: ['Super Admin'],
    BranchId: 'main',
    SchoolSection: 'secondary',
    CreatedAt: `2026-07-30T12:${String(index).padStart(2, '0')}:00.000Z`
  }));
  const readCalls = [];
  const result = await listNotifications({}, {
    audience: 'Staff',
    recipientKey: 'admin',
    role: 'Super Admin',
    branchId: 'main',
    schoolSectionAccess: 'secondary'
  }, {
    limit: 31,
    queryCollection: async (_env, collection, options) => {
      if (collection === 'notifications') {
        const section = options.filters.find((filter) => filter.field === 'SchoolSection')?.value;
        return section === '' ? [] : rows;
      }
      readCalls.push(options);
      const ids = options.filters.find((filter) => filter.field === 'NotificationId')?.value || [];
      return ids.map((NotificationId) => ({
        NotificationId,
        RecipientKey: 'admin',
        ReadAt: '2026-07-30T13:00:00.000Z'
      }));
    }
  });
  assert.equal(readCalls.length, 2);
  assert.deepEqual(readCalls.map((options) =>
    options.filters.find((filter) => filter.field === 'NotificationId').value.length
  ), [30, 1]);
  assert.equal(result.notifications.every((row) => row.Read), true);
});

test('staff and parent notification interfaces are wired to protected APIs', async () => {
  const [adminHtml, parentHtml, notificationJs, notificationCss, parentDashboardJs, styleCss, staffApi, parentApi, backendApi, indexes] = await Promise.all([
    readFile(new URL('../admin.html', import.meta.url), 'utf8'),
    readFile(new URL('../parent-dashboard.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/notifications.css', import.meta.url), 'utf8'),
    readFile(new URL('../js/parent-dashboard.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/staff-notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/parent-dashboard.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/backend.js', import.meta.url), 'utf8'),
    readFile(new URL('../firestore.indexes.json', import.meta.url), 'utf8')
  ]);
  assert.match(adminHtml, /js\/notifications\.js/);
  assert.match(notificationJs, /\/api\/staff-notifications/);
  assert.match(notificationCss, /\.notification-trigger \.notification-badge\{[^}]*height:20px[^}]*font-size:11px[^}]*line-height:1/);
  assert.match(notificationCss, /@media \(max-width:680px\)[\s\S]*?\.notification-trigger>span:first-child\{display:block/);
  assert.match(notificationCss, /\.notification-trigger \.notification-badge:not\(\[hidden\]\)\{display:grid\}/);
  assert.match(notificationCss, /\.staff-identity \.notification-popover \.notification-item-copy,[\s\S]*?\.notification-item-dot\{display:block\}/);
  assert.match(notificationJs, /data-notification-enable-push/);
  assert.match(notificationJs, /data-delete-notification/);
  assert.match(notificationJs, /update\('archive', \{ notificationId: item\.dataset\.notificationId \}\)/);
  assert.match(notificationJs, /Tap once to receive alerts even when this page is closed/);
  assert.match(notificationCss, /\.notification-push-prompt\{display:flex/);
  assert.match(notificationCss, /\.notification-delete-action\{/);
  assert.match(notificationCss, /@media \(max-width:720px\)[\s\S]*?\.notification-settings-form label\{[^}]*font-size:9px/);
  assert.match(notificationCss, /\.notification-category-grid\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(notificationJs, /class="notification-device-delete"[^>]*data-remove-push-device/);
  assert.doesNotMatch(notificationJs, /data-remove-push-device="[^\n]*">Remove</);
  assert.match(notificationJs, /Church.*School.*settings & devices|settings & devices/);
  assert.match(notificationJs, /Delivery channels/);
  assert.match(notificationJs, /Notification types/);
  assert.match(notificationJs, /audience === 'Parent'[\s\S]*?filter\(\(category\) => category !== 'Requisitions'\)/);
  assert.match(notificationJs, /data-policy-audience="\$\{audience\}"/);
  assert.match(notificationJs, /AudiencePolicies: audiencePolicies/);
  assert.match(notificationCss, /\.notification-audience-policy-grid\{/);
  assert.match(notificationCss, /\.notification-settings-form input\[type=checkbox\]\{[^}]*width:16px[^}]*height:16px/);
  assert.match(notificationCss, /\.notification-audience-policy label\{[^}]*grid-template-columns:16px minmax\(0,1fr\)/);
  assert.match(notificationCss, /\.notification-push-card button,\.notification-settings-form>button\{[^}]*width:fit-content!important/);
  assert.match(notificationCss, /\.notification-settings-form>button\{justify-self:start\}/);
  assert.doesNotMatch(parentHtml, /id="parentNotificationCategory"[\s\S]*?<option>Requisitions<\/option>[\s\S]*?<\/select>/);
  assert.doesNotMatch(parentHtml, /Preferences & devices|parentNotificationSettingsForm|disableParentPush/);
  assert.doesNotMatch(parentDashboardJs, /saveNotificationSettings|data-remove-parent-push-device/);
  assert.match(parentApi, /action === 'archiveNotification'/);
  assert.match(parentDashboardJs, /new Date\(dateValue\)/);
  assert.match(styleCss, /\.parent-notification-item strong\{font-size:12px/);
  assert.match(styleCss, /\.parent-notification-item>span>span\{[^}]*font-size:10px/);
  assert.match(staffApi, /requireStaffSession/);
  assert.match(staffApi, /audience === 'Parent' && category === 'Requisitions'/);
  assert.match(staffApi, /AudiencePolicies: audiencePolicies/);
  assert.match(parentApi, /action === 'getNotifications'/);
  assert.match(parentApi, /action === 'markNotificationRead'/);
  assert.doesNotMatch(parentApi, /saveNotificationSettings/);
  assert.match(backendApi, /notifyParentPaymentReceived\(env, payment\)/);
  assert.match(backendApi, /invoiceReminderFields\(invoicePayload, notificationSettings\)/);
  assert.doesNotMatch(parentApi, /notifyParentPayment(?:Due|Received)/);
  assert.doesNotMatch(backendApi, /notifyParentPaymentDue\(env, invoicePayload\)/);
  assert.doesNotMatch(parentApi, /BranchId:\s*body\.branchId/);
  assert.doesNotMatch(parentApi, /SchoolSection:\s*body\.schoolSection/);
  assert.match(indexes, /"fieldPath": "TargetRoles", "arrayConfig": "CONTAINS"/);
  assert.match(indexes, /"fieldPath": "TargetAccountRefs", "arrayConfig": "CONTAINS"/);
  assert.match(indexes, /"collectionGroup": "notificationReads"/);
  assert.match(indexes, /"fieldPath": "BranchId", "order": "ASCENDING"/);
  assert.match(indexes, /"fieldPath": "SchoolSection", "order": "ASCENDING"/);
});
