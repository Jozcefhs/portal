# Staff security history: bounded loading

Staff & Permissions previously read the complete `staffSecurityAudit` collection
before taking its newest 80 rows. Above the shared collection read limit (5,000
documents), that read failed and the combined directory request failed with it.

## Repair

- The staff directory requests `list` with `includeAudit: false`. Security
  activity loads separately; its failure cannot replace the staff controls.
- `list-security-audit` requires the same authenticated Super Admin access as
  staff management. Each request reads at most four pages of up to 80 documents
  each, returning at most 80 visible rows, with an opaque continuation token.
- Firestore orders by `Timestamp desc, __name__ desc`. A fixed `readTime` across
  pages prevents new events shifting an in-progress history view. Refresh
  starts a new snapshot. Continuations expire after 50 minutes and are bound
  to the current project, branch scope and edition.
- Branch visibility is checked for every row, including legacy missing/lowercase
  branch fields. Sparse branches may require more than one “Load older activity”
  click; an empty filtered batch with a continuation never claims empty history.
- Failures and timeouts are explicit and retryable. Previously loaded rows stay
  visible after a failed next-page request. Late responses cannot populate a
  different user/branch/workspace. Refresh and pagination do not open action
  result popups or modify records.
- Older clients still get a bounded first-page `audit` preview, with
  `auditWarning` and `auditNextCursor` for clients able to display them.

No audit records, staff permissions, invoices, payments or balances are changed.
The shared full-collection limit and required staff-directory error handling
remain intact. No database migration or new composite index is required.

## Verification

Run `npm run test:staff-security-history`. Synthetic fixtures cover 6,005 audit
records, timestamp ties, new insertions, branch isolation, stale cursors, database
failures and authorization. UI-function tests cover independent loading, retry,
timeouts, duplicate clicks, older-page appends, and stale-response rejection.

## Separate follow-up

Similar full-history reads were found in `church-membership`, `church-offerings`,
`church-payments`, `church-funds` and `church-services`. Those callers currently
suppress audit read failures rather than failing staff management. They are not
changed by this focused repair and should receive their own paginated-history
work and regression coverage. The dedicated Security Audit Log already uses
bounded ordered queries; this change is for the Staff & Permissions panel.
