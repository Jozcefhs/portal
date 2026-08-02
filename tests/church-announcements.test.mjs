import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildChurchAnnouncementAudienceGroups,
  canManageChurchAnnouncements,
  normalizeChurchAnnouncementInput
} from '../functions/lib/church-announcements.js';
import { normalizeNotification, notificationTargetsRecipient } from '../functions/lib/notifications.js';

test('church announcement management is restricted to church leadership roles', () => {
  assert.equal(canManageChurchAnnouncements({ edition: 'church', role: 'Super Admin' }), true);
  assert.equal(canManageChurchAnnouncements({ edition: 'faith', role: 'Pastor' }), true);
  assert.equal(canManageChurchAnnouncements({ edition: 'church', role: 'Church Administrator' }), true);
  assert.equal(canManageChurchAnnouncements({ edition: 'church', role: 'Treasurer' }), false);
  assert.equal(canManageChurchAnnouncements({ edition: 'school', role: 'Super Admin' }), false);
});

test('church announcement input uses church recipients and preserves scheduling', () => {
  assert.throws(() => normalizeChurchAnnouncementInput({
    Title: 'Notice', Message: 'Message', Recipients: {}, Channels: { InApp: true }
  }), /Select at least one recipient group/);
  const result = normalizeChurchAnnouncementInput({
    AnnouncementId: 'CH-ANN-1', Title: 'Workers meeting', Message: 'Please arrive by 5pm.',
    Recipients: { Members: true, Staff: true }, Channels: { InApp: true, Push: true },
    ScheduledAt: '2026-08-04T16:00:00.000Z'
  }, { now: '2026-08-02T08:00:00.000Z', createdBy: 'pastor', workspaceId: 'church-a' });
  assert.equal(result.Edition, 'church');
  assert.equal(result.Status, 'Scheduled');
  assert.deepEqual(result.Recipients, { Members: true, Staff: true });
});

test('church recipients come only from active members and church-edition staff', () => {
  const result = buildChurchAnnouncementAudienceGroups([
    { MemberId: 'MEM-1', Email: 'member@example.com', BranchId: 'main', MembershipStatus: 'Active' },
    { MemberId: 'MEM-2', Email: 'member@example.com', BranchId: 'main', MembershipStatus: 'Active' },
    { MemberId: 'MEM-3', Email: 'former@example.com', BranchId: 'main', MembershipStatus: 'Inactive' },
    { MemberId: 'MEM-4', BranchId: 'main', MembershipStatus: 'Active' }
  ], [
    { Username: 'pastor', OrganisationEdition: 'church', BranchId: 'main', Active: 'YES' },
    { Username: 'school-admin', OrganisationEdition: 'school', BranchId: 'main', Active: 'YES' },
    { Username: 'disabled', OrganisationEdition: 'church', BranchId: 'main', Active: 'NO' }
  ], { Members: true, Staff: true });
  const member = result.groups.find((group) => group.audience === 'Member');
  const staff = result.groups.find((group) => group.audience === 'Staff');
  assert.deepEqual(result.summary, { Members: 1, Staff: 1 });
  assert.deepEqual(member.targetEmails, ['member@example.com']);
  assert.deepEqual(staff.targetUsernames, ['pastor']);
});

test('member notification records are email-targeted and branch-isolated', () => {
  const notification = normalizeNotification({
    EventKey: 'church-announcement:1', Audience: 'Member', Category: 'Announcements',
    TargetEmails: ['member@example.com'], BranchId: 'main',
    Title: 'Service update', Message: 'The service begins at 9am.'
  });
  assert.equal(notification.Audience, 'Member');
  assert.equal(notificationTargetsRecipient(notification, {
    audience: 'Member', email: 'member@example.com', branchId: 'main'
  }), true);
  assert.equal(notificationTargetsRecipient(notification, {
    audience: 'Member', email: 'member@example.com', branchId: 'west'
  }), false);
});

test('church notification UI and protected API are edition aware', async () => {
  const [ui, api, scheduler, notifications] = await Promise.all([
    readFile(new URL('../js/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/staff-notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/notification-scheduler.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/lib/notifications.js', import.meta.url), 'utf8')
  ]);
  assert.match(ui, /CHURCH ANNOUNCEMENT/);
  assert.match(ui, /Church notification policy/);
  assert.match(ui, /name="Members"/);
  assert.match(ui, /churchCategories = \['Offerings', 'Donations', 'Services', 'Funds', 'Attendance', 'Announcements', 'System'\]/);
  assert.match(api, /createChurchAnnouncement/);
  assert.match(api, /listChurchAnnouncements/);
  assert.match(scheduler, /processScheduledChurchAnnouncements/);
  assert.match(notifications, /'staff', 'parent', 'member'/);
});
