# Notification and reminder system

## Architecture

The web application uses one server-owned notification engine for staff and parent audiences. Cloudflare Pages Functions authenticate the caller, enforce workspace/branch/section scope, read and write Firestore through the service account, and send browser push through Firebase Cloud Messaging (FCM) HTTP v1.

The browser never receives a service-account private key or an FCM server credential. It receives only Firebase's public web application identifiers and public VAPID key after successful staff or parent authentication. Firestore is not accessed directly from browser code.

Notification categories are Fees, Payments, Requisitions, Attendance, Academics, Announcements, and System. Supported channels are InApp and Push.

## Firestore collections

### `notifications`

One immutable event record. Important fields include `SchoolId`, `NotificationId`, `EventKey`, `Category`, `Type`, `Audience`, `Channels`, `Severity`, `TargetRoles`, `TargetUsernames`, `TargetDepartments`, `TargetEmails`, `TargetAccountRefs`, `Title`, `Message`, `ActionUrl`, `RecordType`, `RecordId`, `DueDate`, `ScheduleStage`, `TemplateKey`, `TemplateVersion`, `ActorType`, `ActorId`, `BranchId`, `SchoolSection`, `CreatedAt`, `CreatedBy`, `ExpiresAt`, and `DeliveryStatus`.

`EventKey` produces a deterministic document ID. Creating the same business event twice therefore returns the existing document instead of creating a duplicate.

### `notificationReads`

Per-recipient state. `NotificationId` plus `RecipientKey` produces a deterministic document ID. `ReadAt` records read status and `ArchivedAt` records archive status. One user's state cannot change another user's notification state.

### `notificationSubscriptions`

One active FCM registration per recipient/device. It stores audience, recipient key, device ID/name/platform, token, activity state, and timestamps. API responses remove the token before returning device lists. Re-registering a browser token to a different account removes the prior binding.

### `notificationDeliveries`

One idempotent delivery record per notification/channel/recipient/device. Status is Pending, Delivered, Failed, Invalid subscription, or Suppressed. It also records attempt count, provider message ID, delivery time, and a bounded last error.

### `notificationSettings`

The `system` document contains organisation defaults: timezone, fee reminder intervals, templates, and workflow recipient rules. `PREF-*` documents contain per-user category/channel preferences and quiet hours.

Invoice documents now contain `ReminderEligible`, `NextReminderDate`, `NextReminderStage`, `SentReminderStages`, `LastReminderStage`, `LastReminderAt`, and `ReminderBalance`.

## Event flows

### Verified payment

Paystack is verified before `recordManualPayment` completes. After ledger/invoice allocation and final `ProcessingStatus: Completed`, one Payment Received event is created. Its recipients are the student account reference and every known parent/guardian email stored on the student/payment. Replaying payment verification uses the same payment reference and notification event key.

### Fee reminders

Invoice generation calculates the next reminder from the configured due-date schedule. Payment allocation immediately recalculates eligibility and the remaining balance. Paid invoices are not queried by the scheduler.

The daily scheduler uses bounded indexed queries for eligible `NextReminderDate` values and a 44-day due-date window for legacy invoices that predate reminder metadata. Default stages are:

- Before due: 14, 7, 3, 1, and 0 days.
- After due: 1, 7, 14, and 30 days.

School-fee components for the same student, period, currency, due date, and stage are combined into one parent notification. The event key includes the stage, so retries are safe while distinct stages remain distinct.

### Requisitions

Notifications are emitted when a requisition or supplier bill is submitted/resubmitted, approved, rejected, pushed to Accounts for desktop processing, or posted to accounting. Recipient resolution supports explicit usernames, roles, departments, branch/section scope, the original requester, and configurable workflow roles.

## Web interfaces

Staff and parent portals provide:

- Notification bell, unread badge, latest items, timestamps, and deep links.
- Full history with category, unread, archived, and cursor-based older-item filtering.
- Mark one or all as read, archive, and restore.
- Category/channel preferences, timezone, and quiet hours.
- Browser push opt-in, current-device status, device removal, and staff test notification.
- Super Admin settings for reminder intervals and templates.

Browser permission is requested only after the user selects **Enable on this device**. Denial leaves in-app notifications operating normally.

## Firebase and Cloudflare configuration

1. In the Firebase project, enable **Firebase Cloud Messaging API (V1)**.
2. Register a Firebase web application for the deployed portal.
3. In Firebase **Project settings → Cloud Messaging → Web configuration**, create or import a Web Push certificate and retain its public VAPID key.
4. Keep the existing service-account variables in Cloudflare Pages:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY` as an encrypted secret
5. Add the public web configuration variables in Cloudflare Pages:
   - `FIREBASE_WEB_API_KEY`
   - `FIREBASE_APP_ID`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FCM_VAPID_KEY`
6. Add a long random `NOTIFICATION_SCHEDULER_SECRET` as a Cloudflare encrypted secret.
7. Deploy the indexes in `firestore.indexes.json` to the same Firebase project. The reminder query requires the `ReminderEligible` + `NextReminderDate` composite index.
8. In the GitHub repository, configure Actions secrets:
   - `NOTIFICATION_SCHEDULER_URL`: the full deployed URL ending in `/api/notification-scheduler`
   - `NOTIFICATION_SCHEDULER_SECRET`: the same value configured in Cloudflare

The `Notification reminders` workflow runs daily at 05:15 UTC (06:15 Africa/Lagos). It is also manually runnable with an optional processing date. The endpoint accepts only a Bearer token matching the encrypted scheduler secret.

For existing invoices, run the reminder metadata migration first in dry-run mode with the four required Firebase/workspace environment variables loaded in the shell:

```powershell
npm run migrate:notification-reminders
```

Review the counts, then apply the same bounded, optimistic-concurrency-safe writes:

```powershell
npm run migrate:notification-reminders -- --apply
```

## Security rules and indexes

No browser code reads or writes Firestore. Consequently, this implementation does not add permissive Firestore client rules; the existing rules should continue to deny untrusted client access. Staff authorization is enforced by the signed staff session, parent authorization is revalidated with the existing parent email/login code and owned-child scope, scheduler authorization uses its dedicated secret, and every returned record is checked against workspace, branch, section, audience, and recipient targeting.

The index file adds the scheduler composite index on `invoices(ReminderEligible, NextReminderDate)`. Existing notification target indexes cover role, username, email, and account-reference delivery; new equivalents cover department targeting. `notificationReads(RecipientKey, NotificationId)` remains the per-recipient state index. Single-field token and subscription queries use Firestore's automatic indexes.

## Templates

Super Admin can edit templates as a JSON object. Missing templates use the tested built-in text. Supported template keys include `payment_received`, `fee_due`, `fee_overdue`, and `requisition_submitted`, `requisition_approved`, `requisition_rejected`, `requisition_pushed`, or `requisition_posted`.

Example:

```json
{
  "fee_due": {
    "Version": "2",
    "Title": "Fee reminder",
    "Message": "{fee} of {amount} is due on {dueDate}."
  },
  "requisition_rejected": {
    "Version": "1",
    "Title": "Requisition update",
    "Message": "{recordId} was rejected. {notes}"
  }
}
```

Template substitutions are plain text. The application escapes notification content before placing it in HTML.

## Validation

Run the notification suites with:

```powershell
node --test tests/notifications.test.mjs tests/notification-system.test.mjs
```

The suites cover central metadata, event idempotency, recipient isolation, unread/read state, payment confirmation, all default fee stages, paid and part-paid invoices, overdue processing, every requisition transition, per-device identity, push denial, invalid-token cleanup, protected APIs, and the absence of portal-open notification side effects.

## Monitoring and troubleshooting

- Scheduler output reports the processing date, invoices inspected, groups processed, events created or deduplicated, and invoice documents updated.
- The same daily run retries failed push deliveries up to five attempts. Delivered and invalid-subscription records are never resent.
- Inspect `notificationDeliveries` for provider message IDs, failures, and attempt counts.
- `Invalid subscription` means FCM rejected a stale token; the subscription is removed automatically and the user can enable push again.
- If in-app works but push is unavailable, confirm all four public Firebase web variables and that FCM API v1 is enabled.
- If reminders do not run, confirm both scheduler secrets match and that the Firestore indexes are deployed.
- Quiet hours suppress non-urgent push only; the in-app history remains available.

## Rollback

The existing `notifications` and `notificationReads` fields remain compatible. A code rollback can ignore the additional collections and invoice fields without data migration. Disable the scheduled GitHub workflow to stop new reminders, then roll back the web deployment. Existing invoices, payments, requisitions, and accounting records are not deleted or renamed.

## Assumptions

- Each deployed school workspace has a stable `DYNAMAX_WORKSPACE_ID`; the deployment identity and branch/section scope are authoritative.
- A parent/guardian is reachable when a supported email field is present on the validated student/payment record. Duplicate addresses are collapsed.
- GitHub Actions is the scheduler for the current Cloudflare Pages architecture. The HTTP scheduler remains provider-neutral and may instead be called by another trusted daily scheduler with the same Bearer secret.
- Browser push requires HTTPS, except for browser-supported localhost development. In-app notifications remain available when FCM is not configured or permission is denied.
