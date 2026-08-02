import {
  createDocumentIfAbsent,
  getDocument,
  listCollection,
  queryCollection,
  upsertDocument
} from './firestore.js';
import {
  deliverPushNotification,
  publicMessagingConfig
} from './firebase-messaging.js';

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

export const NOTIFICATION_CATEGORIES = Object.freeze([
  'Fees', 'Payments', 'Requisitions', 'Attendance', 'Academics', 'Announcements', 'System'
]);

export const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
  Timezone: 'Africa/Lagos',
  FeeDueIntervals: [14, 7, 3, 1, 0],
  FeeOverdueIntervals: [1, 7, 14, 30],
  QuietHoursEnabled: false,
  QuietHoursStart: '21:00',
  QuietHoursEnd: '06:00',
  Channels: { InApp: true, Push: true },
  Categories: Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, true])),
  Templates: {}
});

function category(value) {
  const wanted = lower(value);
  return NOTIFICATION_CATEGORIES.find((item) => lower(item) === wanted) || 'System';
}

function channels(value) {
  const requested = values(value).map(lower);
  if (!requested.length) return ['InApp', 'Push'];
  const result = [];
  if (requested.some((item) => ['inapp', 'in-app'].includes(item))) result.push('InApp');
  if (requested.includes('push')) result.push('Push');
  return result.length ? result : ['InApp'];
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
    Category: category(input.Category || input.category || input.Type || input.type),
    Channels: channels(input.Channels || input.channels),
    Severity: clean(input.Severity || input.severity || 'Normal'),
    Audience: audience === 'staff' ? 'Staff' : 'Parent',
    TargetRoles: values(input.TargetRoles || input.targetRoles),
    TargetUsernames: lowerValues(input.TargetUsernames || input.targetUsernames),
    TargetDepartments: lowerValues(input.TargetDepartments || input.targetDepartments),
    TargetEmails: lowerValues(input.TargetEmails || input.targetEmails),
    TargetAccountRefs: lowerValues(input.TargetAccountRefs || input.targetAccountRefs),
    Title: title,
    Message: message,
    Body: message,
    ActionUrl: clean(input.ActionUrl || input.actionUrl),
    Route: clean(input.Route || input.route || input.ActionUrl || input.actionUrl),
    RecordType: clean(input.RecordType || input.recordType),
    RecordId: clean(input.RecordId || input.recordId),
    RelatedEntityType: clean(input.RelatedEntityType || input.relatedEntityType || input.RecordType || input.recordType),
    RelatedEntityId: clean(input.RelatedEntityId || input.relatedEntityId || input.RecordId || input.recordId),
    DueDate: clean(input.DueDate || input.dueDate),
    ScheduleStage: clean(input.ScheduleStage || input.scheduleStage),
    TemplateKey: clean(input.TemplateKey || input.templateKey),
    TemplateVersion: clean(input.TemplateVersion || input.templateVersion || '1'),
    ActorType: clean(input.ActorType || input.actorType || 'System'),
    ActorId: clean(input.ActorId || input.actorId || input.CreatedBy || input.createdBy || 'System'),
    SchoolId: lower(input.SchoolId || input.schoolId),
    BranchId: lower(input.BranchId || input.branchId || 'main') || 'main',
    SchoolSection: lower(input.SchoolSection || input.schoolSection),
    CreatedAt: clean(input.CreatedAt || input.createdAt || createdAt),
    ScheduledAt: clean(input.ScheduledAt || input.scheduledAt),
    SentAt: clean(input.SentAt || input.sentAt || input.CreatedAt || input.createdAt || createdAt),
    CreatedBy: clean(input.CreatedBy || input.createdBy || 'System'),
    ExpiresAt: clean(input.ExpiresAt || input.expiresAt),
    DeliveryStatus: clean(input.DeliveryStatus || input.deliveryStatus || 'Created'),
    ReadStatus: 'Per recipient'
  };
}

export async function createNotification(env, input, options = {}) {
  let prepared = { ...input };
  const templateKey = clean(input?.TemplateKey || input?.templateKey);
  if (templateKey) {
    const settings = await loadNotificationSettings(env).catch(() => DEFAULT_NOTIFICATION_SETTINGS);
    const template = settings.Templates?.[templateKey];
    if (template && typeof template === 'object') {
      const data = input.TemplateData && typeof input.TemplateData === 'object' ? input.TemplateData : {};
      const interpolate = (value) => clean(value).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => data[key] === undefined ? match : clean(data[key]));
      prepared = {
        ...prepared,
        Title: interpolate(template.Title || prepared.Title),
        Message: interpolate(template.Message || prepared.Message),
        TemplateVersion: clean(template.Version || prepared.TemplateVersion || '1')
      };
    }
  }
  const record = normalizeNotification({
    ...prepared,
    SchoolId: clean(prepared?.SchoolId || prepared?.schoolId || env?.DYNAMAX_WORKSPACE_ID)
  }, options.now || nowIso());
  const create = options.createDocumentIfAbsent || createDocumentIfAbsent;
  const result = await create(env, 'notifications', record.NotificationId, record);
  let pushDeliveries = [];
  if ((result?.created || options.retryDelivery !== false) && publicMessagingConfig(env).enabled && record.Channels.includes('Push') && options.deliver !== false) {
    const dispatch = options.dispatchNotificationPush || dispatchNotificationPush;
    pushDeliveries = await dispatch(env, record, options).catch((error) => [{
      status: 'Failed',
      error: clean(error?.message || error || 'Push delivery failed.')
    }]);
  }
  return {
    created: Boolean(result?.created),
    notification: result?.document ? { ...result.document, ...record } : record,
    pushDeliveries
  };
}

function notificationSettingsId(audience, recipientKey) {
  const key = `${lower(audience)}:${lower(recipientKey)}`;
  return `PREF-${safeId(key).slice(0, 130)}-${shortHash(key)}`;
}

function notificationAudiencePolicies(system = {}) {
  const configured = system.AudiencePolicies && typeof system.AudiencePolicies === 'object'
    ? system.AudiencePolicies
    : {};
  return Object.fromEntries(['Parent', 'Staff'].map((audience) => {
    const policy = configured[audience] && typeof configured[audience] === 'object'
      ? configured[audience]
      : {};
    const categories = {
      ...DEFAULT_NOTIFICATION_SETTINGS.Categories,
      ...(system.Categories || {}),
      ...(policy.Categories || {})
    };
    if (audience === 'Parent') categories.Requisitions = false;
    return [audience, {
      Channels: {
        ...DEFAULT_NOTIFICATION_SETTINGS.Channels,
        ...(system.Channels || {}),
        ...(policy.Channels || {})
      },
      Categories: categories
    }];
  }));
}

export function notificationSettingsForAudience(system = {}, user = {}, audience = '') {
  const audiencePolicies = notificationAudiencePolicies(system);
  const managedAudience = ['Parent', 'Staff'].find((name) => lower(name) === lower(audience));
  const managedPolicy = managedAudience ? audiencePolicies[managedAudience] : null;
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...system,
    ...user,
    AudiencePolicies: audiencePolicies,
    ManagedByOrganisation: Boolean(managedPolicy),
    Channels: managedPolicy?.Channels || { ...DEFAULT_NOTIFICATION_SETTINGS.Channels, ...(system.Channels || {}), ...(user.Channels || {}) },
    Categories: managedPolicy?.Categories || { ...DEFAULT_NOTIFICATION_SETTINGS.Categories, ...(system.Categories || {}), ...(user.Categories || {}) },
    Templates: { ...(system.Templates || {}), ...(user.Templates || {}) },
    FeeDueIntervals: values(user.FeeDueIntervals || system.FeeDueIntervals || DEFAULT_NOTIFICATION_SETTINGS.FeeDueIntervals).map(Number).filter(Number.isFinite),
    FeeOverdueIntervals: values(user.FeeOverdueIntervals || system.FeeOverdueIntervals || DEFAULT_NOTIFICATION_SETTINGS.FeeOverdueIntervals).map(Number).filter(Number.isFinite)
  };
}

export async function loadNotificationSettings(env, audience = '', recipientKey = '') {
  const [system, user] = await Promise.all([
    getDocument(env, 'notificationSettings', 'system').catch(() => null),
    recipientKey ? getDocument(env, 'notificationSettings', notificationSettingsId(audience, recipientKey)).catch(() => null) : null
  ]);
  return notificationSettingsForAudience(system || {}, user || {}, audience);
}

export async function saveNotificationSettings(env, audience, recipientKey, input = {}) {
  const key = lower(recipientKey);
  if (!key) throw new Error('A notification settings recipient is required.');
  const existing = await loadNotificationSettings(env, audience, key);
  const allowedCategories = Object.fromEntries(NOTIFICATION_CATEGORIES.map((name) => [name, input.Categories?.[name] !== undefined ? Boolean(input.Categories[name]) : existing.Categories[name] !== false]));
  const record = {
    SettingsId: notificationSettingsId(audience, key),
    SchoolId: lower(env.DYNAMAX_WORKSPACE_ID),
    Audience: clean(audience),
    RecipientKey: key,
    Timezone: clean(input.Timezone || existing.Timezone || DEFAULT_NOTIFICATION_SETTINGS.Timezone),
    QuietHoursEnabled: input.QuietHoursEnabled === true,
    QuietHoursStart: /^\d{2}:\d{2}$/.test(clean(input.QuietHoursStart)) ? clean(input.QuietHoursStart) : existing.QuietHoursStart,
    QuietHoursEnd: /^\d{2}:\d{2}$/.test(clean(input.QuietHoursEnd)) ? clean(input.QuietHoursEnd) : existing.QuietHoursEnd,
    Channels: {
      InApp: input.Channels?.InApp !== false,
      Push: input.Channels?.Push !== false
    },
    Categories: allowedCategories,
    UpdatedAt: nowIso()
  };
  await upsertDocument(env, 'notificationSettings', record.SettingsId, record);
  return notificationSettingsForAudience({}, record, audience);
}

function timeInZone(timezone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
    return Number(parts.find((item) => item.type === 'hour')?.value || 0) * 60 + Number(parts.find((item) => item.type === 'minute')?.value || 0);
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

export function quietHoursActive(settings, date = new Date()) {
  if (!settings.QuietHoursEnabled) return false;
  const minutes = (value) => {
    const [hour, minute] = clean(value).split(':').map(Number);
    return hour * 60 + minute;
  };
  const current = timeInZone(settings.Timezone, date);
  const start = minutes(settings.QuietHoursStart);
  const end = minutes(settings.QuietHoursEnd);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

async function staffRecipientsForNotification(env, notification) {
  const recipients = new Set(lowerValues(notification.TargetUsernames));
  const roles = lowerValues(notification.TargetRoles);
  const departments = lowerValues(notification.TargetDepartments);
  if (roles.length || departments.length) {
    const users = await listCollection(env, 'staffUsers').catch(() => []);
    users.filter((user) => user.Active !== false && lower(user.Active || 'YES') !== 'no')
      .filter((user) => roles.includes(lower(user.Role)) || departments.includes(lower(user.Department)))
      .filter((user) => sameScope(notification, { branchId: user.BranchId, schoolSectionAccess: user.SchoolSectionAccess || user.SchoolSection }))
      .forEach((user) => recipients.add(lower(user.Username || user.__id)));
  }
  return [...recipients].filter(Boolean);
}

export async function dispatchNotificationPush(env, notification, options = {}) {
  const recipients = lower(notification.Audience) === 'staff'
    ? await staffRecipientsForNotification(env, notification)
    : lowerValues(notification.TargetEmails);
  const results = [];
  for (const recipientKey of recipients) {
    const settings = await loadNotificationSettings(env, notification.Audience, recipientKey);
    if (!options.ignorePreferences && (settings.Channels.Push === false || settings.Categories[category(notification.Category)] === false)) continue;
    if (!options.ignorePreferences && quietHoursActive(settings, options.date || new Date()) && lower(notification.Severity) !== 'urgent') continue;
    results.push(...await deliverPushNotification(env, notification, recipientKey, { deviceId: clean(options.deviceId) }));
  }
  return results;
}

function sameScope(notification, recipient = {}) {
  const wantedSchool = lower(recipient.schoolId || recipient.SchoolId);
  const notificationSchool = lower(notification.SchoolId);
  if (wantedSchool && notificationSchool && wantedSchool !== notificationSchool) return false;
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
  let scopes = Array.isArray(lookup.scopes) && lookup.scopes.length
    ? lookup.scopes
    : audience === 'parent'
      ? parentScopeBindings(recipient)
      : [staffScopeBinding(recipient)];
  if (audience === 'parent' && lookup.field === 'TargetAccountRefs') {
    const accountRefs = new Set(lowerValues(lookup.value));
    scopes = scopes.filter((scope) => accountRefs.has(lower(scope.accountRef)));
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
    const department = lower(recipient.department || recipient.Department);
    const usernames = lowerValues(notification.TargetUsernames);
    const roles = lowerValues(notification.TargetRoles);
    const departments = lowerValues(notification.TargetDepartments);
    return Boolean((username && usernames.includes(username)) || (role && roles.includes(role)) || (department && departments.includes(department)));
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
    const department = lower(recipient.department || recipient.Department);
    if (username) lookups.push({ field: 'TargetUsernames', value: username });
    if (role) lookups.push({ field: 'TargetRoles', value: role });
    if (department) lookups.push({ field: 'TargetDepartments', value: department });
  } else if (audience === 'parent') {
    const email = lower(recipient.email || recipient.ParentEmail || recipient.Email);
    if (email) lookups.push({ field: 'TargetEmails', value: email });
    const scopedReferences = new Map();
    parentScopeBindings(recipient).forEach((scope) => {
      const key = `${scope.branchId}::${scope.schoolSection}`;
      if (!scopedReferences.has(key)) scopedReferences.set(key, { scope, references: [] });
      if (scope.accountRef) scopedReferences.get(key).references.push(scope.accountRef);
    });
    scopedReferences.forEach(({ scope, references }) => {
      chunks(lowerValues(references), 30).forEach((referenceGroup) => {
        if (!referenceGroup.length) return;
        lookups.push({
          field: 'TargetAccountRefs',
          op: 'array-contains-any',
          value: referenceGroup,
          scopes: [scope]
        });
      });
    });
  }
  if (!lookups.length) return [];
  const perTargetLimit = Math.max(25, Math.min(200, Number(limit || 50) * 2));
  const plans = [];
  lookups.forEach((lookup) => {
    const { field, value, op } = lookup;
    const scopes = notificationQueryScopes(recipient, audience, lookup);
    scopes.forEach((scope) => {
      const sectionFilters = scope.schoolSection ? [scope.schoolSection, ''] : [null];
      sectionFilters.forEach((schoolSectionFilter) => {
        plans.push({ field, value, op, ...scope, schoolSectionFilter });
      });
    });
  });
  if (!plans.length) return [];
  const uniquePlans = [...new Map(plans.map((plan) => [
    [
      plan.field,
      plan.op || 'array-contains',
      lowerValues(plan.value).join('|'),
      plan.branchId,
      plan.schoolSectionFilter === null ? '*' : plan.schoolSectionFilter
    ].join('::'),
    plan
  ])).values()];
  const broadTargetQueries = new Map();
  const broadRows = async (field, value, op = 'array-contains') => {
    const key = `${field}::${op}::${lowerValues(value).join('|')}`;
    if (!broadTargetQueries.has(key)) {
      broadTargetQueries.set(key, query(env, 'notifications', {
        filters: [{ field, op, value }]
      }));
    }
    return broadTargetQueries.get(key);
  };
  const groups = await Promise.all(uniquePlans.map(async (plan) => {
    const filters = [{ field: plan.field, op: plan.op || 'array-contains', value: plan.value }];
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
      const rows = await broadRows(plan.field, plan.value, plan.op);
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

async function readStatesForNotifications(env, recipientKey, notificationIds, query) {
  let broadReadStates;
  const readAllRecipientStates = () => {
    if (!broadReadStates) {
      broadReadStates = query(env, 'notificationReads', {
        filters: [{ field: 'RecipientKey', op: '==', value: recipientKey }]
      });
    }
    return broadReadStates;
  };
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
      return readAllRecipientStates();
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
  recipient = {
    ...(recipient || {}),
    schoolId: lower(recipient?.schoolId || recipient?.SchoolId || env?.DYNAMAX_WORKSPACE_ID)
  };
  const recipientKey = lower(
    recipient.recipientKey || recipient.RecipientKey ||
    recipient.username || recipient.Username ||
    recipient.email || recipient.ParentEmail || recipient.Email
  );
  if (!recipientKey) throw new Error('A notification recipient is required.');
  const query = options.queryCollection || queryCollection;
  const preferences = options.preferences || (options.respectPreferences === false
    ? DEFAULT_NOTIFICATION_SETTINGS
    : await loadNotificationSettings(env, recipient.audience || recipient.Audience, recipientKey));
  const requestedLimit = Math.max(1, Math.min(100, Number(options.limit || 50)));
  const rows = await queryTargetedNotifications(env, recipient, query, Math.min(100, requestedLimit + 1));
  const visible = rows
    .filter((row) => notificationTargetsRecipient(row, recipient))
    .filter((row) => !values(row.Channels).length || values(row.Channels).map(lower).includes('inapp'))
    .filter((row) => preferences.Channels?.InApp !== false && preferences.Categories?.[category(row.Category || row.Type)] !== false)
    .filter((row) => !options.category || lower(row.Category || row.Type) === lower(options.category))
    .filter((row) => !options.before || clean(row.CreatedAt) < clean(options.before))
    .sort((left, right) => clean(right.CreatedAt).localeCompare(clean(left.CreatedAt)))
    .slice(0, requestedLimit + 1);
  const reads = visible.length
    ? await readStatesForNotifications(
        env,
        recipientKey,
        visible.map((row) => clean(row.NotificationId || row.__id)).filter(Boolean),
        query
      )
    : [];
  const readById = new Map(reads.map((row) => [clean(row.NotificationId), row]));
  let notifications = visible.map((row) => ({
      ...row,
      Read: readById.has(clean(row.NotificationId)),
      ReadAt: clean(readById.get(clean(row.NotificationId))?.ReadAt),
      Archived: Boolean(clean(readById.get(clean(row.NotificationId))?.ArchivedAt)),
      ArchivedAt: clean(readById.get(clean(row.NotificationId))?.ArchivedAt)
    }));
  notifications = notifications.filter((row) => options.archived === true ? row.Archived : !row.Archived);
  if (options.unread === true) notifications = notifications.filter((row) => !row.Read);
  const hasMore = notifications.length > requestedLimit;
  notifications = notifications.slice(0, requestedLimit);
  return {
    notifications,
    unreadCount: notifications.filter((row) => !row.Read).length,
    hasMore,
    nextCursor: hasMore ? clean(notifications[notifications.length - 1]?.CreatedAt) : ''
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
  const existing = await get(env, 'notificationReads', notificationReadDocumentId(id, key)).catch(() => null);
  const read = {
    ...(existing || {}),
    NotificationId: id,
    RecipientKey: key,
    ReadAt: readAt
  };
  await upsert(env, 'notificationReads', notificationReadDocumentId(id, key), read);
  return read;
}

export async function archiveNotification(env, notificationId, recipientKey, archived = true, options = {}) {
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
  const documentId = notificationReadDocumentId(id, key);
  const existing = await get(env, 'notificationReads', documentId).catch(() => null);
  const state = {
    ...(existing || {}),
    NotificationId: id,
    RecipientKey: key,
    ReadAt: clean(existing?.ReadAt || nowIso()),
    ArchivedAt: archived ? nowIso() : ''
  };
  await upsert(env, 'notificationReads', documentId, state);
  return state;
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
  return notifyStaffRequisitionEvent(env, requisition, 'Submitted', submittedBy, options);
}

function requisitionEventText(requisition, event) {
  const id = clean(requisition.ExpenseNo || requisition.BillNo || requisition.RequisitionNo || requisition.RecordId);
  const department = clean(requisition.Department) || 'A department';
  const notes = clean(requisition.ReviewNotes || requisition.AccountsReviewNotes);
  const descriptions = {
    Submitted: `${department} submitted ${id || 'a requisition'} for ${money(requisition.Amount)}.`,
    Approved: `${id || 'The requisition'} was approved for ${money(requisition.Amount)}.`,
    Rejected: `${id || 'The requisition'} was rejected${notes ? `: ${notes}` : '.'}`,
    Pushed: `${id || 'The requisition'} was pushed to Accounts for desktop processing.`,
    Posted: `${id || 'The requisition'} was posted to accounting${clean(requisition.JournalNo) ? ` as ${clean(requisition.JournalNo)}` : ''}.`,
    Updated: `${id || 'The requisition'} has an important workflow update.`
  };
  return descriptions[event] || descriptions.Updated;
}

function requisitionEventRecipients(requisition, event, settings) {
  const configured = settings.WorkflowRecipients || {};
  const configuredSubmitted = values(configured.SubmittedRoles);
  const configuredProcessing = values(configured.ProcessingRoles);
  const configuredManagement = values(configured.ManagementRoles);
  const submittedRoles = configuredSubmitted.length ? configuredSubmitted : ['Super Admin', 'Accounts Officer', 'Management'];
  const processingRoles = configuredProcessing.length ? configuredProcessing : ['Super Admin', 'Accounts Officer'];
  const managementRoles = configuredManagement.length ? configuredManagement : ['Super Admin', 'Management'];
  const requester = clean(requisition.RequestedByUsername || requisition.SubmittedByUsername || requisition.CreatedByUsername);
  if (event === 'Submitted') return { roles: submittedRoles, usernames: [] };
  if (event === 'Approved') return { roles: processingRoles, usernames: [requester].filter(Boolean) };
  if (event === 'Rejected') return { roles: [], usernames: [requester].filter(Boolean) };
  if (event === 'Pushed') return { roles: processingRoles, usernames: [requester].filter(Boolean) };
  if (event === 'Posted') return { roles: managementRoles, usernames: [requester].filter(Boolean) };
  return { roles: managementRoles, usernames: [requester].filter(Boolean) };
}

export async function notifyStaffRequisitionEvent(env, requisition = {}, event = 'Updated', actorName = '', options = {}) {
  const settings = await loadNotificationSettings(env);
  return createNotification(env, staffRequisitionEventNotification(requisition, event, actorName, settings), options);
}

export function staffRequisitionEventNotification(requisition = {}, event = 'Updated', actorName = '', settings = DEFAULT_NOTIFICATION_SETTINGS) {
  const normalizedEvent = ['Submitted', 'Approved', 'Rejected', 'Pushed', 'Posted'].includes(clean(event)) ? clean(event) : 'Updated';
  const recordId = clean(requisition.ExpenseNo || requisition.BillNo || requisition.RequisitionNo || requisition.RecordId);
  const eventMoment = clean(
    normalizedEvent === 'Submitted' ? (requisition.ResubmittedAt || requisition.RequestedAt) :
    normalizedEvent === 'Approved' ? requisition.ApprovedAt :
    normalizedEvent === 'Rejected' ? requisition.RejectedAt :
    normalizedEvent === 'Pushed' ? requisition.AccountsReviewedAt :
    normalizedEvent === 'Posted' ? requisition.PostedAt : requisition.UpdatedAt
  ) || clean(requisition.UpdatedAt || nowIso());
  const recipients = requisitionEventRecipients(requisition, normalizedEvent, settings);
  return {
    EventKey: `requisition-${lower(normalizedEvent)}:${lower(requisition.BranchId || 'main')}:${lower(requisition.SchoolSection || 'all')}:${recordId}:${eventMoment}`,
    Type: `Requisition ${normalizedEvent}`,
    Category: 'Requisitions',
    Channels: ['InApp', 'Push'],
    Audience: 'Staff',
    TargetRoles: recipients.roles,
    TargetUsernames: recipients.usernames,
    Title: `Requisition ${lower(normalizedEvent)}`,
    TemplateKey: `requisition_${lower(normalizedEvent)}`,
    TemplateData: {
      recordId,
      amount: money(requisition.Amount),
      department: clean(requisition.Department),
      status: normalizedEvent,
      notes: clean(requisition.ReviewNotes || requisition.AccountsReviewNotes)
    },
    Message: requisitionEventText(requisition, normalizedEvent),
    ActionUrl: 'admin.html?section=financeRequests',
    RecordType: clean(requisition.BillNo) ? 'Supplier Bill' : 'Requisition',
    RecordId: recordId,
    BranchId: requisition.BranchId || 'main',
    SchoolSection: requisition.SchoolSection,
    ActorType: 'Staff',
    ActorId: actorName,
    CreatedAt: eventMoment,
    CreatedBy: actorName || 'System'
  };
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
    TargetEmails: [...values(payment.ParentEmails), payment.ParentEmail || payment.VerificationEmail || payment.Email].filter(Boolean),
    Category: 'Payments',
    Channels: ['InApp', 'Push'],
    TargetAccountRefs: [accountRef].filter(Boolean),
    Title: 'Payment received',
    TemplateKey: 'payment_received',
    TemplateData: {
      amount: money(payment.Amount || payment.Credit, payment.Currency),
      fee: clean(payment.FeeName || payment.Description || 'your child account'),
      reference
    },
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
    EventKey: `payment-due:${lower(invoice.BranchId || 'main')}:${lower(invoice.SchoolSection || 'all')}:${lower(invoiceId)}:${period}:${lower(invoice.DueDate)}:${lower(accountRef)}:${lower(invoice.ScheduleStage || 'due')}`,
    Type: 'Payment Due',
    Category: 'Fees',
    Channels: ['InApp', 'Push'],
    Audience: 'Parent',
    TargetEmails: [...values(invoice.ParentEmails), invoice.ParentEmail || invoice.VerificationEmail || invoice.Email].filter(Boolean),
    TargetAccountRefs: [accountRef].filter(Boolean),
    Title: 'Payment due date',
    TemplateKey: lower(invoice.ScheduleStage).startsWith('overdue') ? 'fee_overdue' : 'fee_due',
    TemplateData: {
      amount: money(invoice.Balance || invoice.Amount, invoice.Currency),
      fee: clean(invoice.FeeName || invoice.Description || 'A school charge'),
      dueDate: clean(invoice.DueDate),
      stage: clean(invoice.ScheduleStage)
    },
    Message: clean(invoice.NotificationMessage) || `${clean(invoice.FeeName || invoice.Description || 'A school charge')} of ${money(invoice.Balance || invoice.Amount, invoice.Currency)} ${lower(invoice.ScheduleStage).startsWith('overdue') ? `was due on ${clean(invoice.DueDate)}` : clean(invoice.DueDate) ? `is due on ${clean(invoice.DueDate)}` : 'is due soon'}.`,
    ActionUrl: 'parent-dashboard.html?tab=payments',
    RecordType: 'Invoice',
    RecordId: invoiceId,
    DueDate: invoice.DueDate,
    ScheduleStage: invoice.ScheduleStage,
    BranchId: invoice.BranchId || 'main',
    SchoolSection: invoice.SchoolSection,
    CreatedAt: invoice.NotificationCreatedAt || (clean(invoice.ScheduleStage) ? nowIso() : (invoice.CreatedAt || invoice.Date)),
    CreatedBy: invoice.RecordedBy || 'Accounts Office'
  };
}

export async function notifyParentPaymentDue(env, invoice, options = {}) {
  if (!clean(invoice?.DueDate) || amount(invoice?.Balance ?? invoice?.Amount) <= 0) {
    return { created: false, skipped: true, notification: null };
  }
  return createNotification(env, parentPaymentDueNotification(invoice), options);
}
