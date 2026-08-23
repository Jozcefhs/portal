import { createDocumentIfAbsent, listCollection, queryCollection, upsertDocument } from './firestore.js';
import { createNotification, loadNotificationSettings } from './notifications.js';
import { CHURCH_COLLECTIONS, churchCollectionPath } from './church-foundation.js';
import { resolveMembershipBranch } from './church-membership.js';
import { staffRecordMatchesEdition } from './records-desk.js';

const ANNOUNCEMENT_ROLES = new Set([
  'super admin', 'pastor', 'senior pastor', 'head minister', 'church administrator'
]);
const MAX_TARGETS_PER_NOTIFICATION = 100;
const MAX_SCHEDULED_DELIVERY_ATTEMPTS = 5;
const SCHEDULED_RETRY_DELAY_MS = 5 * 60 * 1000;

const clean = (value) => String(value ?? '').trim();
const lower = (value) => clean(value).toLowerCase();
const uniqueLower = (values = []) => [...new Set(values.map(lower).filter(Boolean))];
const selected = (value) => value === true || ['yes', 'true', '1', 'on'].includes(lower(value));

function activeMember(row = {}) {
  return !['inactive', 'deceased', 'transferred', 'deleted', 'former member'].includes(
    lower(row.MembershipStatus || row.Status)
  );
}

function activeStaff(row = {}) {
  if (row.Active === false) return false;
  return !['no', 'false', '0', 'inactive', 'disabled'].includes(lower(row.Active || 'YES'));
}

function chunks(values = [], size = MAX_TARGETS_PER_NOTIFICATION) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function branchFor(row = {}) {
  const explicit = clean(row.BranchId || row.branchId);
  if (explicit && lower(explicit) !== 'all') return resolveMembershipBranch({}, explicit);
  const scoped = clean(row.__scopePath).match(/organisationBranches\/([^/]+)/i)?.[1];
  return resolveMembershipBranch({}, scoped || 'main');
}

export function canManageChurchAnnouncements(user = {}) {
  const edition = lower(user.edition || user.OrganisationEdition || user.OrganizationEdition);
  const churchEdition = ['church', 'faith', 'organization', 'organisation'].includes(edition) ||
    user.featureFlags?.members === true;
  return churchEdition && ANNOUNCEMENT_ROLES.has(lower(user.role || user.Role));
}

export function normalizeChurchAnnouncementInput(input = {}, options = {}) {
  const title = clean(input.Title || input.title).slice(0, 160);
  const message = clean(input.Message || input.message).slice(0, 2000);
  if (!title || !message) {
    throw Object.assign(new Error('Enter both a notification title and message.'), { status: 400 });
  }
  const suppliedRecipients = input.Recipients || input.recipients || {};
  const recipients = {
    Members: selected(suppliedRecipients.Members),
    Staff: selected(suppliedRecipients.Staff)
  };
  if (!recipients.Members && !recipients.Staff) {
    throw Object.assign(new Error('Select at least one recipient group.'), { status: 400 });
  }
  const suppliedChannels = input.Channels || input.channels || {};
  const channels = {
    InApp: selected(suppliedChannels.InApp),
    Push: selected(suppliedChannels.Push)
  };
  if (!channels.InApp && !channels.Push) {
    throw Object.assign(new Error('Select in-app, browser push, or both delivery channels.'), { status: 400 });
  }
  const scheduledText = clean(input.ScheduledAt || input.scheduledAt);
  const scheduledDate = scheduledText ? new Date(scheduledText) : null;
  if (scheduledText && Number.isNaN(scheduledDate.getTime())) {
    throw Object.assign(new Error('Choose a valid delivery date and time.'), { status: 400 });
  }
  const createdAt = clean(options.now) || new Date().toISOString();
  return {
    AnnouncementId: clean(input.AnnouncementId || input.announcementId) ||
      `CH-ANN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    Edition: 'church',
    Title: title,
    Message: message,
    Recipients: recipients,
    Channels: channels,
    ScheduledAt: scheduledDate ? scheduledDate.toISOString() : '',
    CreatedAt: createdAt,
    CreatedBy: clean(options.createdBy || input.CreatedBy || input.createdBy),
    SchoolId: lower(options.workspaceId || input.SchoolId || input.schoolId),
    Status: scheduledDate && scheduledDate.getTime() > new Date(createdAt).getTime() ? 'Scheduled' : 'Sending'
  };
}

export function buildChurchAnnouncementAudienceGroups(members = [], staffUsers = [], recipients = {}) {
  const memberBranches = new Map();
  if (recipients.Members) {
    (members || []).filter(activeMember).forEach((member) => {
      const email = lower(member.Email || member.email);
      if (!email) return;
      const branchId = branchFor(member);
      if (!memberBranches.has(branchId)) memberBranches.set(branchId, new Set());
      memberBranches.get(branchId).add(email);
    });
  }
  const memberGroups = [];
  memberBranches.forEach((emails, branchId) => {
    chunks([...emails]).forEach((batch, index) => memberGroups.push({
      audience: 'Member', branchId, chunk: index + 1, targetEmails: batch, recipientCount: batch.length
    }));
  });

  const staffBranches = new Map();
  if (recipients.Staff) {
    (staffUsers || []).filter(activeStaff)
      .filter((staff) => staffRecordMatchesEdition(staff, { edition: 'church' }))
      .forEach((staff) => {
        const username = lower(staff.Username || staff.username || staff.__id);
        if (!username) return;
        const branchId = branchFor(staff);
        if (!staffBranches.has(branchId)) staffBranches.set(branchId, new Set());
        staffBranches.get(branchId).add(username);
      });
  }
  const staffGroups = [];
  staffBranches.forEach((usernames, branchId) => {
    chunks([...usernames]).forEach((batch, index) => staffGroups.push({
      audience: 'Staff', branchId, chunk: index + 1, targetUsernames: batch, recipientCount: batch.length
    }));
  });
  return {
    groups: [...memberGroups, ...staffGroups],
    summary: {
      Members: memberGroups.reduce((total, group) => total + group.recipientCount, 0),
      Staff: staffGroups.reduce((total, group) => total + group.recipientCount, 0)
    }
  };
}

async function saveAnnouncement(env, record) {
  await upsertDocument(env, 'notificationAnnouncements', record.AnnouncementId, record);
  return record;
}

async function queuePush(env, announcement, notification) {
  const now = new Date().toISOString();
  const pushJobId = `ANN-PUSH-${clean(notification.NotificationId)}`.slice(0, 180);
  const record = {
    PushJobId: pushJobId,
    SchoolId: lower(env.DYNAMAX_WORKSPACE_ID),
    Edition: 'church',
    AnnouncementId: announcement.AnnouncementId,
    NotificationId: notification.NotificationId,
    Status: 'Pending', AttemptCount: 0, FailureCount: 0, Offset: 0,
    CreatedAt: now, UpdatedAt: now
  };
  const result = await createDocumentIfAbsent(env, 'notificationAnnouncementPushJobs', pushJobId, record);
  return result?.document || record;
}

export async function sendChurchAnnouncement(env, announcement, options = {}) {
  const branchId = resolveMembershipBranch({}, announcement.BranchId || 'main');
  const [members, staffUsers] = await Promise.all([
    announcement.Recipients.Members
      ? listCollection(env, churchCollectionPath(CHURCH_COLLECTIONS.members, branchId)).catch(() => [])
      : Promise.resolve([]),
    announcement.Recipients.Staff ? listCollection(env, 'staffUsers').catch(() => []) : Promise.resolve([])
  ]);
  const audience = buildChurchAnnouncementAudienceGroups(
    members,
    staffUsers.filter((staff) => branchFor(staff) === branchId),
    announcement.Recipients
  );
  if (!audience.groups.length) {
    throw Object.assign(new Error('No active church recipients with notification contact details were found.'), { status: 409 });
  }
  const channelNames = Object.entries(announcement.Channels).filter(([, enabled]) => enabled).map(([name]) => name);
  const results = [];
  const pushJobs = [];
  for (const group of audience.groups) {
    const result = await createNotification(env, {
      EventKey: `church-announcement:${lower(announcement.AnnouncementId)}:${lower(group.audience)}:${group.branchId}:${group.chunk}`,
      Type: 'Church Announcement', Category: 'Announcements', Audience: group.audience,
      Channels: channelNames,
      TargetEmails: group.targetEmails || [], TargetUsernames: group.targetUsernames || [],
      Title: announcement.Title, Message: announcement.Message,
      ActionUrl: group.audience === 'Staff' ? 'admin.html?section=notifications' : 'index.html',
      RecordType: 'ChurchAnnouncement', RecordId: announcement.AnnouncementId,
      BranchId: group.branchId, SchoolSection: '',
      CreatedAt: announcement.ScheduledAt || announcement.CreatedAt,
      ScheduledAt: announcement.ScheduledAt,
      SentAt: clean(options.now) || new Date().toISOString(),
      CreatedBy: announcement.CreatedBy, ActorType: 'Staff', ActorId: announcement.CreatedBy
    }, { retryDelivery: false, deliver: false });
    results.push(result);
    if (announcement.Channels.Push) pushJobs.push(await queuePush(env, announcement, result.notification));
  }
  const queuedPushJobs = pushJobs.filter((job) => !lower(job.Status).startsWith('completed'));
  return saveAnnouncement(env, {
    ...announcement, Status: 'Sent', SentAt: clean(options.now) || new Date().toISOString(),
    RecipientSummary: audience.summary, NotificationCount: results.length,
    PushQueued: queuedPushJobs.length,
    PushDelivered: pushJobs.reduce((total, job) => total + Number(job.Delivered || 0), 0),
    PushFailed: pushJobs.reduce((total, job) => total + Number(job.Failed || 0), 0),
    Error: ''
  });
}

export async function createChurchAnnouncement(env, user, input = {}, options = {}) {
  if (!canManageChurchAnnouncements(user)) {
    throw Object.assign(new Error('Only authorised church leaders can send church announcements.'), { status: 403 });
  }
  const announcement = normalizeChurchAnnouncementInput(input, {
    now: options.now, createdBy: user.username, workspaceId: env.DYNAMAX_WORKSPACE_ID
  });
  announcement.BranchId = resolveMembershipBranch(user, input.BranchId || input.branchId);
  const settings = await loadNotificationSettings(env).catch(() => null);
  const blocked = [];
  if (announcement.Recipients.Members && settings?.AudiencePolicies?.Member?.Categories?.Announcements === false) {
    blocked.push('church members');
  }
  if (announcement.Recipients.Staff && settings?.AudiencePolicies?.Staff?.Categories?.Announcements === false) {
    blocked.push('church staff');
  }
  if (blocked.length) {
    throw Object.assign(new Error(`Announcements are disabled for ${blocked.join(' and ')} in Church settings.`), { status: 409 });
  }
  await saveAnnouncement(env, announcement);
  if (announcement.Status === 'Scheduled') return announcement;
  try {
    return await sendChurchAnnouncement(env, announcement, options);
  } catch (error) {
    await saveAnnouncement(env, {
      ...announcement, Status: 'Failed', Error: clean(error?.message || error), UpdatedAt: new Date().toISOString()
    }).catch(() => {});
    throw error;
  }
}

export async function listChurchAnnouncements(env, options = {}) {
  const workspaceId = lower(env.DYNAMAX_WORKSPACE_ID);
  const limit = Math.min(100, Math.max(1, Number(options.limit || 40)));
  const scanLimit = Math.min(100, Math.max(50, limit));
  const rows = await queryCollection(env, 'notificationAnnouncements', {
    orderBy: [{ field: 'CreatedAt', direction: 'DESCENDING' }],
    limit: scanLimit
  }).catch(() => []);
  return rows.filter((row) => lower(row.Edition) === 'church')
    .filter((row) => !workspaceId || !clean(row.SchoolId) || lower(row.SchoolId) === workspaceId)
    .slice(0, limit);
}

export async function processScheduledChurchAnnouncements(env, options = {}) {
  const now = clean(options.now) || new Date().toISOString();
  const limit = Math.min(100, Math.max(1, Number(options.limit || 100)));
  const workspaceId = lower(env.DYNAMAX_WORKSPACE_ID);
  const scheduledGroups = await Promise.all(['Scheduled', 'Failed'].map((status) => queryCollection(
    env,
    'notificationAnnouncements',
    { filters: [{ field: 'Status', op: '==', value: status }], limit }
  )));
  const scheduled = scheduledGroups.flat();
  const due = scheduled.filter((row) => lower(row.Edition) === 'church')
    .filter((row) => !workspaceId || !clean(row.SchoolId) || lower(row.SchoolId) === workspaceId)
    .filter((row) => scheduledChurchAnnouncementIsDue(row, now));
  const results = [];
  for (const announcement of due) {
    try {
      results.push(await sendChurchAnnouncement(env, { ...announcement, Status: 'Sending' }, { now }));
    } catch (error) {
      const attemptCount = Number(announcement.AttemptCount || 0) + 1;
      const retryable = attemptCount < MAX_SCHEDULED_DELIVERY_ATTEMPTS;
      await saveAnnouncement(env, {
        ...announcement,
        Status: retryable ? 'Scheduled' : 'Failed',
        AttemptCount: attemptCount,
        LastAttemptAt: now,
        NextAttemptAt: retryable ? new Date(new Date(now).getTime() + SCHEDULED_RETRY_DELAY_MS).toISOString() : '',
        Error: clean(error?.message || error),
        UpdatedAt: now
      }).catch(() => {});
      results.push({
        AnnouncementId: announcement.AnnouncementId,
        Status: retryable ? 'Scheduled' : 'Failed',
        AttemptCount: attemptCount,
        Error: clean(error?.message || error)
      });
    }
  }
  return {
    processed: results.length,
    sent: results.filter((row) => lower(row.Status).startsWith('sent')).length,
    failed: results.filter((row) => ['failed', 'scheduled'].includes(lower(row.Status))).length
  };
}

export function scheduledChurchAnnouncementIsDue(row = {}, now = new Date().toISOString()) {
  const status = lower(row.Status);
  const attempts = Math.max(0, Number(row.AttemptCount || 0));
  if (status !== 'scheduled' && !(status === 'failed' && attempts < MAX_SCHEDULED_DELIVERY_ATTEMPTS)) return false;
  const scheduledAt = clean(row.ScheduledAt);
  if (!scheduledAt || scheduledAt > clean(now)) return false;
  const nextAttemptAt = clean(row.NextAttemptAt);
  return !nextAttemptAt || nextAttemptAt <= clean(now);
}
