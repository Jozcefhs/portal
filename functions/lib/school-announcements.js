import { getDocument, listCollection, queryCollection, upsertDocument } from './firestore.js';
import { createNotification, dispatchNotificationPush, loadNotificationSettings } from './notifications.js';
import { listSchoolCollection, safeScopeId } from './school-scope.js';

const ANNOUNCEMENT_ROLES = new Set(['super admin', 'management']);
const RECIPIENT_KEYS = ['DayStudents', 'BoardingStudents', 'Staff'];
const MAX_TARGETS_PER_NOTIFICATION = 100;
const MAX_PUSH_RECIPIENTS_PER_INVOCATION = 8;

function clean(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function uniqueLower(values = []) {
  return [...new Set(values.map(lower).filter(Boolean))];
}

function selected(value) {
  return value === true || ['yes', 'true', '1', 'on'].includes(lower(value));
}

function activeRecord(row = {}) {
  if (row.Active === false) return false;
  if (['no', 'false', '0', 'inactive', 'disabled'].includes(lower(row.Active))) return false;
  return !['inactive', 'withdrawn', 'graduated', 'left', 'deleted', 'rejected'].includes(
    lower(row.Status || row.EnrollmentStatus || row.StudentStatus)
  );
}

function boardingStudent(row = {}) {
  const value = lower(
    row.StudentType || row.studentType || row.BoardingPreference || row.boardingPreference ||
    row.ResidencyType || row.residencyType || row.Tags
  );
  return /board(ing|er)?|hostel|resident/.test(value) && !/non[- ]?boarding/.test(value);
}

function branchFor(row = {}) {
  const explicit = clean(row.BranchId || row.branchId);
  if (explicit && lower(explicit) !== 'all') return safeScopeId(explicit);
  const scoped = clean(row.__scopePath).match(/schoolBranches\/([^/]+)/i)?.[1];
  return safeScopeId(scoped || 'main');
}

function studentReferences(row = {}) {
  return uniqueLower([
    row.AccountRef,
    row.AdmissionNo,
    row.AdmissionNumber,
    row.ApplicationReference,
    row.__id
  ]);
}

function parentEmails(row = {}) {
  return uniqueLower([
    ...(Array.isArray(row.ParentEmails) ? row.ParentEmails : []),
    row.ParentEmail,
    row.VerificationEmail,
    row.GuardianEmail,
    row.FatherEmail,
    row.MotherEmail,
    row.Email
  ]);
}

function chunks(values = [], size = MAX_TARGETS_PER_NOTIFICATION) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export function canManageSchoolAnnouncements(user = {}) {
  const schoolEdition = lower(user.edition) === 'school' || user.featureFlags?.students === true;
  return schoolEdition && ANNOUNCEMENT_ROLES.has(lower(user.role));
}

export function normalizeSchoolAnnouncementInput(input = {}, options = {}) {
  const title = clean(input.Title || input.title).slice(0, 160);
  const message = clean(input.Message || input.message).slice(0, 2000);
  if (!title || !message) {
    const error = new Error('Enter both a notification title and message.');
    error.status = 400;
    throw error;
  }
  const suppliedRecipients = input.Recipients || input.recipients || {};
  const recipients = Object.fromEntries(RECIPIENT_KEYS.map((key) => [key, selected(suppliedRecipients[key])]));
  if (!Object.values(recipients).some(Boolean)) {
    const error = new Error('Select at least one recipient group.');
    error.status = 400;
    throw error;
  }
  const suppliedChannels = input.Channels || input.channels || {};
  const channels = {
    InApp: selected(suppliedChannels.InApp),
    Push: selected(suppliedChannels.Push)
  };
  if (!channels.InApp && !channels.Push) {
    const error = new Error('Select in-app, browser push, or both delivery channels.');
    error.status = 400;
    throw error;
  }
  const scheduledText = clean(input.ScheduledAt || input.scheduledAt);
  const scheduledDate = scheduledText ? new Date(scheduledText) : null;
  if (scheduledText && Number.isNaN(scheduledDate.getTime())) {
    const error = new Error('Choose a valid delivery date and time.');
    error.status = 400;
    throw error;
  }
  const createdAt = clean(options.now) || new Date().toISOString();
  const announcementId = clean(input.AnnouncementId || input.announcementId) ||
    `ANN-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    AnnouncementId: announcementId,
    Title: title,
    Message: message,
    Recipients: recipients,
    Channels: channels,
    ScheduledAt: scheduledDate ? scheduledDate.toISOString() : '',
    CreatedAt: createdAt,
    CreatedBy: clean(options.createdBy || input.CreatedBy || input.createdBy),
    SchoolId: lower(options.schoolId || input.SchoolId || input.schoolId),
    Status: scheduledDate && scheduledDate.getTime() > new Date(createdAt).getTime() ? 'Scheduled' : 'Sending'
  };
}

export function buildSchoolAnnouncementAudienceGroups(students = [], staffUsers = [], recipients = {}) {
  const parentGroups = new Map();
  let dayStudents = 0;
  let boardingStudents = 0;
  const uniqueStudents = new Map();
  (students || []).filter(activeRecord).forEach((student, index) => {
    const references = studentReferences(student);
    const identity = references[0] || clean(student.__id) ||
      `${parentEmails(student)[0] || 'student'}:${lower(student.DisplayName || student.StudentName || index)}`;
    if (!uniqueStudents.has(identity)) uniqueStudents.set(identity, student);
  });
  [...uniqueStudents.values()].forEach((student) => {
    const boarding = boardingStudent(student);
    if ((boarding && !recipients.BoardingStudents) || (!boarding && !recipients.DayStudents)) return;
    if (boarding) boardingStudents += 1;
    else dayStudents += 1;
    const references = studentReferences(student);
    const emails = parentEmails(student);
    if (!references.length && !emails.length) return;
    const branchId = branchFor(student);
    if (!parentGroups.has(branchId)) parentGroups.set(branchId, new Map());
    const identityKey = emails[0] ? `email:${emails[0]}` : `ref:${references[0]}`;
    const identities = parentGroups.get(branchId);
    if (!identities.has(identityKey)) identities.set(identityKey, { emails: new Set(), references: new Set() });
    const identity = identities.get(identityKey);
    emails.forEach((email) => identity.emails.add(email));
    references.forEach((reference) => identity.references.add(reference));
  });

  const parent = [];
  parentGroups.forEach((identities, branchId) => {
    chunks([...identities.values()]).forEach((batch, index) => parent.push({
      audience: 'Parent',
      branchId,
      chunk: index + 1,
      targetEmails: uniqueLower(batch.flatMap((identity) => [...identity.emails])),
      targetAccountRefs: uniqueLower(batch.flatMap((identity) => [...identity.references])),
      recipientCount: batch.length
    }));
  });

  const staffGroups = new Map();
  if (recipients.Staff) {
    (staffUsers || []).filter(activeRecord).forEach((staff) => {
      const username = lower(staff.Username || staff.username || staff.__id);
      if (!username) return;
      const branchId = branchFor(staff);
      if (!staffGroups.has(branchId)) staffGroups.set(branchId, new Set());
      staffGroups.get(branchId).add(username);
    });
  }
  const staff = [];
  staffGroups.forEach((usernames, branchId) => {
    chunks([...usernames]).forEach((batch, index) => staff.push({
      audience: 'Staff',
      branchId,
      chunk: index + 1,
      targetUsernames: batch,
      recipientCount: batch.length
    }));
  });

  return {
    groups: [...parent, ...staff],
    summary: {
      DayStudents: dayStudents,
      BoardingStudents: boardingStudents,
      ParentAccounts: parent.reduce((total, group) => total + group.recipientCount, 0),
      Staff: staff.reduce((total, group) => total + group.recipientCount, 0)
    }
  };
}

async function saveAnnouncement(env, record) {
  await upsertDocument(env, 'notificationAnnouncements', record.AnnouncementId, record);
  return record;
}

function pushJobId(notificationId) {
  return `ANN-PUSH-${clean(notificationId)}`.slice(0, 180);
}

async function queueAnnouncementPush(env, announcement, notification) {
  const now = new Date().toISOString();
  const record = {
    PushJobId: pushJobId(notification.NotificationId),
    SchoolId: lower(env.DYNAMAX_WORKSPACE_ID),
    AnnouncementId: announcement.AnnouncementId,
    NotificationId: notification.NotificationId,
    Status: 'Pending',
    AttemptCount: 0,
    FailureCount: 0,
    Offset: 0,
    CreatedAt: now,
    UpdatedAt: now
  };
  await upsertDocument(env, 'notificationAnnouncementPushJobs', record.PushJobId, record);
  return record;
}

export async function sendSchoolAnnouncement(env, announcement, options = {}) {
  const [students, staffUsers] = await Promise.all([
    announcement.Recipients.DayStudents || announcement.Recipients.BoardingStudents
      ? listSchoolCollection(env, 'students')
      : Promise.resolve([]),
    announcement.Recipients.Staff ? listCollection(env, 'staffUsers') : Promise.resolve([])
  ]);
  const audience = buildSchoolAnnouncementAudienceGroups(students, staffUsers, announcement.Recipients);
  if (!audience.groups.length) {
    const error = new Error('No active recipients were found in the selected groups.');
    error.status = 409;
    throw error;
  }
  const channelNames = Object.entries(announcement.Channels).filter(([, enabled]) => enabled).map(([name]) => name);
  const results = [];
  for (const group of audience.groups) {
    const result = await createNotification(env, {
      EventKey: `school-announcement:${lower(announcement.AnnouncementId)}:${lower(group.audience)}:${group.branchId}:${group.chunk}`,
      Type: 'School Announcement',
      Category: 'Announcements',
      Audience: group.audience,
      Channels: channelNames,
      TargetEmails: group.targetEmails || [],
      TargetAccountRefs: group.targetAccountRefs || [],
      TargetUsernames: group.targetUsernames || [],
      Title: announcement.Title,
      Message: announcement.Message,
      ActionUrl: group.audience === 'Parent' ? 'parent-dashboard.html' : 'admin.html',
      RecordType: 'NotificationAnnouncement',
      RecordId: announcement.AnnouncementId,
      BranchId: group.branchId,
      SchoolSection: '',
      CreatedAt: announcement.ScheduledAt || announcement.CreatedAt,
      ScheduledAt: announcement.ScheduledAt,
      SentAt: clean(options.now) || new Date().toISOString(),
      CreatedBy: announcement.CreatedBy,
      ActorType: 'Staff',
      ActorId: announcement.CreatedBy
    }, { retryDelivery: false, deliver: false });
    results.push(result);
    if (announcement.Channels.Push) await queueAnnouncementPush(env, announcement, result.notification);
  }
  return saveAnnouncement(env, {
    ...announcement,
    Status: 'Sent',
    SentAt: clean(options.now) || new Date().toISOString(),
    RecipientSummary: audience.summary,
    NotificationCount: results.length,
    PushQueued: announcement.Channels.Push ? results.length : 0,
    PushDelivered: 0,
    PushFailed: 0,
    Error: ''
  });
}

export async function createSchoolAnnouncement(env, user, input = {}, options = {}) {
  if (!canManageSchoolAnnouncements(user)) {
    const error = new Error('Only authorised school management can send announcements.');
    error.status = 403;
    throw error;
  }
  const announcement = normalizeSchoolAnnouncementInput(input, {
    now: options.now,
    createdBy: user.username,
    schoolId: env.DYNAMAX_WORKSPACE_ID
  });
  const settings = await loadNotificationSettings(env).catch(() => null);
  const blocked = [];
  if ((announcement.Recipients.DayStudents || announcement.Recipients.BoardingStudents) &&
      settings?.AudiencePolicies?.Parent?.Categories?.Announcements === false) blocked.push('parent portal users');
  if (announcement.Recipients.Staff &&
      settings?.AudiencePolicies?.Staff?.Categories?.Announcements === false) blocked.push('staff app users');
  if (blocked.length) {
    const error = new Error(`Announcements are disabled for ${blocked.join(' and ')} in School settings.`);
    error.status = 409;
    throw error;
  }
  await saveAnnouncement(env, announcement);
  if (announcement.Status === 'Scheduled') return announcement;
  try {
    return await sendSchoolAnnouncement(env, announcement, options);
  } catch (error) {
    await saveAnnouncement(env, {
      ...announcement,
      Status: 'Failed',
      Error: clean(error?.message || error),
      UpdatedAt: new Date().toISOString()
    }).catch(() => {});
    throw error;
  }
}

export async function listSchoolAnnouncements(env, options = {}) {
  const schoolId = lower(env.DYNAMAX_WORKSPACE_ID);
  const limit = Math.min(100, Math.max(1, Number(options.limit || 40)));
  const rows = await listCollection(env, 'notificationAnnouncements').catch(() => []);
  return rows
    .filter((row) => !schoolId || !clean(row.SchoolId) || lower(row.SchoolId) === schoolId)
    .sort((left, right) => clean(right.CreatedAt).localeCompare(clean(left.CreatedAt)))
    .slice(0, limit);
}

export async function processScheduledSchoolAnnouncements(env, options = {}) {
  const now = clean(options.now) || new Date().toISOString();
  const limit = Math.min(100, Math.max(1, Number(options.limit || 100)));
  const scheduled = await queryCollection(env, 'notificationAnnouncements', {
    filters: [{ field: 'Status', op: '==', value: 'Scheduled' }], limit
  }).catch(() => []);
  const schoolId = lower(env.DYNAMAX_WORKSPACE_ID);
  const due = scheduled
    .filter((row) => !schoolId || !clean(row.SchoolId) || lower(row.SchoolId) === schoolId)
    .filter((row) => lower(row.Status) === 'scheduled' && clean(row.ScheduledAt) && row.ScheduledAt <= now);
  const results = [];
  for (const announcement of due) {
    try {
      results.push(await sendSchoolAnnouncement(env, { ...announcement, Status: 'Sending' }, { now }));
    } catch (error) {
      await saveAnnouncement(env, {
        ...announcement,
        Status: 'Failed',
        Error: clean(error?.message || error),
        UpdatedAt: now
      }).catch(() => {});
      results.push({ AnnouncementId: announcement.AnnouncementId, Status: 'Failed', Error: clean(error?.message || error) });
    }
  }
  return {
    processed: results.length,
    sent: results.filter((row) => lower(row.Status).startsWith('sent')).length,
    failed: results.filter((row) => lower(row.Status) === 'failed').length
  };
}

export async function processSchoolAnnouncementPushQueue(env, options = {}) {
  const schoolId = lower(env.DYNAMAX_WORKSPACE_ID);
  const now = clean(options.now) || new Date().toISOString();
  const limit = Math.min(5, Math.max(1, Number(options.limit || 1)));
  const [pendingJobs, failedJobs, processingJobs] = await Promise.all([
    queryCollection(env, 'notificationAnnouncementPushJobs', {
      filters: [{ field: 'Status', op: '==', value: 'Pending' }], limit: 100
    }).catch(() => []),
    queryCollection(env, 'notificationAnnouncementPushJobs', {
      filters: [{ field: 'Status', op: '==', value: 'Failed' }], limit: 100
    }).catch(() => []),
    queryCollection(env, 'notificationAnnouncementPushJobs', {
      filters: [{ field: 'Status', op: '==', value: 'Processing' }], limit: 100
    }).catch(() => [])
  ]);
  const staleBefore = new Date(new Date(now).getTime() - 10 * 60 * 1000).toISOString();
  const eligible = [...pendingJobs, ...failedJobs, ...processingJobs.filter((row) => clean(row.UpdatedAt) < staleBefore)]
    .filter((row) => !schoolId || !clean(row.SchoolId) || lower(row.SchoolId) === schoolId)
    .filter((row) => ['pending', 'failed'].includes(lower(row.Status)) && Number(row.FailureCount || 0) < 5)
    .sort((left, right) => clean(left.CreatedAt).localeCompare(clean(right.CreatedAt)));
  const jobs = eligible.slice(0, limit);
  let delivered = 0;
  let failed = 0;
  let completedJobs = 0;
  for (const job of jobs) {
    const jobId = clean(job.PushJobId || job.__id);
    try {
      await upsertDocument(env, 'notificationAnnouncementPushJobs', jobId, {
        ...job, Status: 'Processing', UpdatedAt: now
      }, clean(job.__updateTime) ? { updateTime: job.__updateTime } : {});
    } catch (error) {
      if ([409, 412].includes(Number(error?.status))) continue;
      throw error;
    }
    const notification = await getDocument(env, 'notifications', clean(job.NotificationId)).catch(() => null);
    if (!notification) {
      failed += 1;
      await upsertDocument(env, 'notificationAnnouncementPushJobs', jobId, {
        ...job, Status: 'Abandoned', AttemptCount: Number(job.AttemptCount || 0) + 1,
        FailureCount: Number(job.FailureCount || 0) + 1,
        LastError: 'Notification record was not found.', UpdatedAt: now
      });
      completedJobs += 1;
      continue;
    }
    try {
      const audience = lower(notification.Audience);
      const recipientKeys = audience === 'staff'
        ? uniqueLower(notification.TargetUsernames || [])
        : uniqueLower(notification.TargetEmails || []);
      const offset = Math.max(0, Number(job.Offset || 0));
      const recipientBatch = recipientKeys.slice(offset, offset + MAX_PUSH_RECIPIENTS_PER_INVOCATION);
      const nextOffset = offset + recipientBatch.length;
      const completed = nextOffset >= recipientKeys.length;
      const scopedNotification = audience === 'staff'
        ? { ...notification, TargetUsernames: recipientBatch, TargetRoles: [], TargetDepartments: [] }
        : { ...notification, TargetEmails: recipientBatch };
      const results = recipientBatch.length ? await dispatchNotificationPush(env, scopedNotification) : [];
      delivered += results.filter((result) => result.status === 'Delivered').length;
      const deliveryFailures = results.filter((result) => !['Delivered', 'Suppressed'].includes(result.status)).length;
      failed += deliveryFailures;
      await upsertDocument(env, 'notificationAnnouncementPushJobs', jobId, {
        ...job,
        Status: completed ? (Number(job.Failed || 0) + deliveryFailures ? 'Completed with errors' : 'Completed') : 'Pending',
        AttemptCount: Number(job.AttemptCount || 0) + 1,
        FailureCount: Number(job.FailureCount || 0),
        Offset: nextOffset,
        TargetCount: recipientKeys.length,
        Delivered: Number(job.Delivered || 0) + results.filter((result) => result.status === 'Delivered').length,
        Failed: Number(job.Failed || 0) + deliveryFailures,
        LastError: results.find((result) => result.error)?.error || '',
        CompletedAt: completed ? now : '',
        UpdatedAt: now
      });
      if (completed) completedJobs += 1;
      const announcement = await getDocument(env, 'notificationAnnouncements', clean(job.AnnouncementId)).catch(() => null);
      if (announcement) {
        await saveAnnouncement(env, {
          ...announcement,
          Status: Number(announcement.PushFailed || 0) + deliveryFailures ? 'Sent with push errors' : 'Sent',
          PushQueued: Math.max(0, Number(announcement.PushQueued || 0) - (completed ? 1 : 0)),
          PushDelivered: Number(announcement.PushDelivered || 0) + results.filter((result) => result.status === 'Delivered').length,
          PushFailed: Number(announcement.PushFailed || 0) + deliveryFailures,
          UpdatedAt: now
        });
      }
    } catch (error) {
      failed += 1;
      await upsertDocument(env, 'notificationAnnouncementPushJobs', jobId, {
        ...job,
        Status: 'Failed',
        AttemptCount: Number(job.AttemptCount || 0) + 1,
        FailureCount: Number(job.FailureCount || 0) + 1,
        LastError: clean(error?.message || error),
        UpdatedAt: now
      }).catch(() => {});
    }
  }
  return { inspected: jobs.length, delivered, failed, remaining: Math.max(0, eligible.length - completedJobs) };
}
