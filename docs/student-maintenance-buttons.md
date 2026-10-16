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
- Changed profile revisions or fee settings stop the review. A failed batch
  never exposes a partial report or reconciliation controls.
- Closing the window cancels remaining reads. Each request has a finite timeout.
- Only a completed review may expose the separate reconciliation action, and
  only for a writable account. Posting still revalidates each preview token and
  retains the existing audited financial workflow.

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
tests, and isolated browser checks with simulated responses only.
