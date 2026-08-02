import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildSchoolAnnouncementAudienceGroups,
  canManageSchoolAnnouncements,
  normalizeSchoolAnnouncementInput
} from '../functions/lib/school-announcements.js';

test('only authorised school management can compose announcements', () => {
  assert.equal(canManageSchoolAnnouncements({ edition: 'school', role: 'Super Admin' }), true);
  assert.equal(canManageSchoolAnnouncements({ edition: 'school', role: 'Management' }), true);
  assert.equal(canManageSchoolAnnouncements({ edition: 'school', role: 'Accounts Officer' }), false);
  assert.equal(canManageSchoolAnnouncements({ edition: 'church', role: 'Super Admin' }), false);
});

test('announcement input requires recipients and delivery channels', () => {
  assert.throws(() => normalizeSchoolAnnouncementInput({
    AnnouncementId: 'ANN-1', Title: 'Notice', Message: 'Message', Recipients: {}, Channels: { InApp: true }
  }), /Select at least one recipient group/);
  assert.throws(() => normalizeSchoolAnnouncementInput({
    AnnouncementId: 'ANN-1', Title: 'Notice', Message: 'Message', Recipients: { Staff: true }, Channels: {}
  }), /Select in-app, browser push/);
});

test('future announcements are scheduled and immediate announcements are ready to send', () => {
  const scheduled = normalizeSchoolAnnouncementInput({
    AnnouncementId: 'ANN-FUTURE', Title: 'Resumption', Message: 'School resumes soon.',
    Recipients: { DayStudents: true }, Channels: { InApp: true, Push: true },
    ScheduledAt: '2026-08-04T08:00:00.000Z'
  }, { now: '2026-08-02T08:00:00.000Z', createdBy: 'admin', schoolId: 'school-a' });
  const immediate = normalizeSchoolAnnouncementInput({
    AnnouncementId: 'ANN-NOW', Title: 'Resumption', Message: 'School resumes soon.',
    Recipients: { Staff: true }, Channels: { InApp: true }
  }, { now: '2026-08-02T08:00:00.000Z', createdBy: 'admin', schoolId: 'school-a' });
  assert.equal(scheduled.Status, 'Scheduled');
  assert.equal(immediate.Status, 'Sending');
  assert.deepEqual(scheduled.Channels, { InApp: true, Push: true });
});

test('day and boarding audiences route to linked parents while staff stay separate', () => {
  const result = buildSchoolAnnouncementAudienceGroups([
    { AccountRef: 'DAY-1', StudentType: 'Day Student', ParentEmail: 'parent@example.com', BranchId: 'main', Status: 'Active' },
    { AccountRef: 'DAY-1', StudentType: 'Day Student', ParentEmail: 'parent@example.com', BranchId: 'main', Status: 'Active', __scopePath: 'schoolBranches/main/sections/secondary/students' },
    { AccountRef: 'BOARD-1', StudentType: 'Boarding Student', ParentEmail: 'parent@example.com', BranchId: 'main', Status: 'Active' },
    { AccountRef: 'OLD-1', StudentType: 'Day Student', ParentEmail: 'old@example.com', BranchId: 'main', Status: 'Withdrawn' }
  ], [
    { Username: 'admin', BranchId: 'main', Active: 'YES' },
    { Username: 'disabled', BranchId: 'main', Active: 'NO' }
  ], { DayStudents: true, BoardingStudents: true, Staff: true });
  const parent = result.groups.find((group) => group.audience === 'Parent');
  const staff = result.groups.find((group) => group.audience === 'Staff');
  assert.deepEqual(result.summary, { DayStudents: 1, BoardingStudents: 1, ParentAccounts: 1, Staff: 1 });
  assert.deepEqual(parent.targetEmails, ['parent@example.com']);
  assert.deepEqual(parent.targetAccountRefs.sort(), ['board-1', 'day-1']);
  assert.deepEqual(staff.targetUsernames, ['admin']);
});

test('composer, protected endpoint and scheduler are wired together', async () => {
  const [ui, css, api, scheduler, library, workflow] = await Promise.all([
    readFile(new URL('../js/notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/notifications.css', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/staff-notifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/api/notification-scheduler.js', import.meta.url), 'utf8'),
    readFile(new URL('../functions/lib/school-announcements.js', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/school-announcement-delivery.yml', import.meta.url), 'utf8')
  ]);
  assert.match(ui, /Compose notification message/);
  assert.match(ui, /name="DayStudents"/);
  assert.match(ui, /name="BoardingStudents"/);
  assert.match(ui, /name="Staff"/);
  assert.match(ui, /update\('sendAnnouncement'/);
  assert.match(ui, /Sent and scheduled messages/);
  assert.match(css, /\.notification-compose-form\{/);
  assert.match(css, /\.notification-announcement-history\{/);
  assert.match(api, /action === 'sendannouncement'/);
  assert.match(api, /action === 'processannouncementpush'/);
  assert.match(api, /canComposeAnnouncements/);
  assert.match(scheduler, /processScheduledSchoolAnnouncements/);
  assert.match(scheduler, /announcementsOnly/);
  assert.match(library, /Category: 'Announcements'/);
  assert.match(library, /AudiencePolicies\?\.Parent\?\.Categories\?\.Announcements === false/);
  assert.match(library, /TargetAccountRefs: group\.targetAccountRefs/);
  assert.match(library, /TargetUsernames: group\.targetUsernames/);
  assert.match(library, /notificationAnnouncementPushJobs/);
  assert.match(workflow, /\*\/15 \* \* \* \*/);
  assert.match(workflow, /"announcementsOnly":true/);
});
