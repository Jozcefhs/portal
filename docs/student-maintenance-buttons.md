# Students maintenance actions

The shared staff portal and installed web/PWA companion use the same Students
maintenance handlers. School finance actions remain School-only; Church and
Other Organisation editions do not acquire school billing permissions.

## Review all student billing

- Opens a read-only window immediately and shows checked/total progress.
- Loads the authorized roster once, then reviews ten profiles per request using
  indexed, paginated invoice and account-summary queries. It does not scan the
  complete school invoice history.
- Existing billing rules, including full scholarship and acceptance deposits,
  are unchanged. Incomplete and ambiguous profiles cannot be posted.
- A profile changed since the roster was loaded, newly incomplete, missing from
  the authorised scope or ambiguous is flagged **Recheck required**. It has no
  financial totals or posting token. Other profiles and later batches continue.
  Profile rechecks are counted separately from finance conflicts; open that
  student's profile and preview billing again, or use **Run a fresh review**.
- Changed fee settings, incomplete database reads and overflowing identity
  queries still stop the review rather than exposing unreliable totals.
- Closing the window cancels remaining reads. Each request has a finite timeout.
- Only a completed review may expose the separate reconciliation action, and
  only for a writable account. Posting still revalidates each preview token and
  retains the existing audited financial workflow.
- Every posting request resolves the current account again, compares its fresh
  preview token and revision, and applies atomic revision guards. A change after
  review (including just before commit) cannot post against an outdated profile.

### Post valid missing charges

- A completed account can have valid missing charges and conflicting existing
  charges at the same time. Only `eligibleMissing` components are posted.
- `postingTotal` is the sum of those new charges, not the net difference between
  the current fee setup and old invoices. Confirmation displays the full amount.
- Cancelled/legacy invoices for the same component, ambiguous fee definitions,
  and existing zero-value or duplicate invoices are never automatically rebilled.
  Unrelated valid missing components may still be posted.
- Posting requires a fresh, versioned preview, explicit `missing-only-v2` client
  acknowledgement, source revision guards and create-only deterministic invoice
  and journal IDs. Double-clicks and repeated submissions cannot add them twice.
- Existing invoice amounts and payments are not replaced. When conflicts or
  blocked components remain, no existing allocations or journals are repaired:
  only the missing charges and their audit/journals are created, followed by a
  branch-scoped balance-summary refresh. Credit allocation is deferred, and the
  remaining conflicts stay visible; balances remain provisional.
- Clean bills retain their existing credit preflight and allocation workflow.
  A refresh/allocation warning after posting is not a failed charge creation:
  run a fresh preview rather than re-entering payments or blindly retrying.
- Eligible and needs-review account counts can overlap. Posting does not mean
  that all issues on the account have been resolved.

## Review obsolete textbook / yearbook charges

In **Students**, a School Super Admin with Accounts and Students access can use
**Review obsolete textbook / yearbook charges**, then **Prepare correction for
all affected students**. Check the per-student preview, enter an approval reason,
and explicitly approve posting. Select each working branch in turn as needed.

- Reviews all classes and permitted school sections, including profiles whose
  unrelated onboarding fields are incomplete. Required billing classifications
  must still be saved and verifiable. Changed or ambiguous profiles are flagged
  for rechecking without stopping the other students.
- Only current-period textbook/yearbook charges confirmed by an active,
  matching Returning-only rule on a New Intake student's account qualify.
  Valid charges, other components and other periods are untouched. Duplicate
  invoices, missing or changed fee rules, amount/currency mismatches and gaps in
  payment/journal evidence remain blocked for individual finance review.
- Preparation performs read-only receipt and journal checks. The preview shows
  the exact invoice references, charges before/after and existing allocations
  to release. Candidate previews cannot authorize posting.
- Each approval freshly validates the account, fee setup and sources. One
  atomic, revision-guarded commit marks obsolete invoices as reversed, posts
  balancing journals and audit records, and refreshes the account summary.
  Gross invoice values and original payments, receipts and journals are kept.
  Missing baseline journals can be created only in open accounting periods.
- Paid amounts are released from the obsolete charges for valid school fees.
  This is not a new receipt, refund or wallet top-up. Remaining legitimate fees
  are not deleted, and other conflicts remain for review.
- Deterministic create-only reversal IDs and invoice revision checks prevent
  duplicate corrections. Results are reported per account; confirmed and
  unconfirmed submissions are never retried automatically. After a lost
  response or changed records, close the window and start a fresh review.

Example regression: a bill of ₦1,616,915 containing obsolete textbooks of
₦118,030 and a yearbook of ₦10,000 becomes ₦1,488,885. School-fee receipts of
₦1,502,885 are preserved; their net excess is ₦14,000, excluding wallet and
optional-service funds. This feature does not itself apply live corrections.

## Save missing profile defaults

- Reports progress and completion immediately below the toolbar.
- Clearly reports when nothing is missing instead of appearing to do nothing.
- Fills only missing canonical BillingCategory/AcademicProgress fields using
  the existing rules; explicit categories and Repeating choices are preserved.
- Saves remain revision-guarded, audited and batched. A failed/uncertain save is
  not automatically retried. A subsequent user action first rechecks remaining
  defaults, so already saved records are not posted again.
- Does not change invoices, receipts, allocations or balances. A refresh button
  appears when confirmed saved records need to be reloaded.

Both actions reject stale branch/session responses and ignore duplicate clicks.
An older cached billing client receives a refresh instruction rather than an
incorrect empty report. The admin asset version and offline shell are refreshed.

Regression coverage: `tests/student-maintenance.test.mjs`,
`tests/student-billing-review.test.mjs`, existing profile/defaults/reconciliation
tests, `tests/obsolete-school-charge-reversal.test.mjs`, and isolated browser
checks with simulated responses only.
