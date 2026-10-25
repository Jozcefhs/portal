# Resumable accounting revenue synchronization

Refresh reads the existing accounting overview and reports. Synchronize Revenue
reconciles source records into accounting journals and retains the existing
legacy net-payment, gateway-charge and form-sale repair rules. It remains an
explicit finance mutation, not an automatic part of Refresh.

## Cause and repair

The old action collected all invoices, payments, journals and ledger entries
before doing any work. An invoice collection exceeding the finance report's
40-page safety bound failed with `FIRESTORE_REPORT_LIMIT` / HTTP 413. Report
date filters did not constrain that synchronization query.

The repaired action uses document-name cursors and persisted checkpoints in
`accountingRevenueSyncRuns`. Requests inspect at most 50 source rows; any row
requiring detailed reconciliation ends that request's page. Invoice journals
already posted can be checked in groups of ten business IDs. Dependencies use
indexed source/account reference queries, not whole financial collections.
More than 200 related records for one source stops that record for finance
review instead of silently treating a truncated slice as complete.

Stages are invoice charges, payment receipts, School invoice-credit baselines,
wallet-purchase ledger entries, form sales and configured non-School donations.
Receipts must complete before invoice-credit baselines. School sync does not
read church donation paths. Existing finance-role and branch restrictions apply
to every request. Each run is bound to the authenticated officer, edition and
selected branch.

Each source's accounting writes and the next checkpoint are one Firestore
atomic commit. New records require `exists: false`; updates/deletions require
the version read. Changed sources receive a version-fenced
`AccountingSyncCheckedAt` metadata patch when no source normalization is
already planned. Lost responses and concurrent runs cannot commit the same
new journal twice or advance past an uncommitted write. Conflicting posted
journals require an approved finance correction; they are not overwritten.
Closed-period, active-account and balanced-journal validation is retained.

This is a live cursor pass, not a historical snapshot. Source records inserted
behind a cursor after it has advanced are handled by normal transaction posting
or the next explicit pass. A connection failure pauses the run, preserving its
completed batches. Clicking Synchronize Revenue again resumes that officer's
unfinished run. Completion is only reported after all stages finish; a paused
run is not rolled back and must not be presented as a complete reconciliation.
Report date filters still do not restrict synchronization.

## Client compatibility and rollout

### Numeric-reference lookup repair — 25 October 2026

A payment with a long numeric bank reference repeatedly stopped in the payments
stage with HTTP 400. Scalar reference fields were stored as text, but the shared
Firestore encoder discarded the field name when encoding an array for an `IN`
query. It converted reference strings into numbers, rounding long values and
producing an invalid INT64. Short numeric references could also miss an existing
text reference, so bypassing the failed payment would not have been a safe fix.

Array elements now retain their field's scalar encoding rules. References and
other configured identifiers remain exact text; monetary arrays remain numeric.
Firestore HTTP error streams also retain the upstream reason instead of reporting
only a generic 400. No source data, journal, or checkpoint migration is required.

Planning-only checks of the ten dependency queries for the reported payment
returned HTTP 200 after the repair; five had returned HTTP 400 before it. No
financial record was written during this verification. All 4,011 regression
tests and the Pages Functions build passed, including exact-reference replay,
checkpoint resumption, branch scope and balanced-posting checks.

The repair is shared server code for every edition. Existing resumable desktop
clients receive it without a new installer: click **Synchronize Revenue** again
to resume the existing run. A completed deployment does not itself execute the
financial synchronization or declare the unfinished run complete.

The updated desktop starts/resumes using `SyncVersion: 1`, then sends the
returned `RunId` and `Step` until `complete: true`. It displays progress,
prevents duplicate clicks, stops on a workspace change and refreshes reports
only after confirmed completion. An older backend response without checkpoint
metadata is not accepted as success.

Deploy the backend and distribute an updated desktop together. Old desktop
clients receive HTTP 426 with an update instruction; they cannot continue
batches and must not falsely report that a partial sync completed. No report
read cap was raised and no live synchronization is required during deployment.

## Verification

`tests/accounting-revenue-sync.test.mjs` exercises a 40,051-invoice pass,
atomic checkpoint/retry behavior, concurrent commits, branch/edition isolation,
stage completion, dependency limits, all reconciliation stages and journal
validation. Desktop tests are in `suite/tests/test_accounting_revenue_sync.py`.
These tests use sample records and mocked storage, not live financial data.

## Manual payment corrections

School Accounts users can open **Accounts → Correct manual payment** on web
or desktop. Accounts Officer, Director and Super Admin roles with Accounts
access can reduce an overstated manual wallet/school-fee receipt, reverse its
remaining amount, or move a mistaken wallet credit to another student in the
authorised branch/section. Online gateway payments and admission/earmarked
service receipts are excluded.

Enter the original reference, choose the correction, explain the mistake,
preview the affected names and balances, then confirm with the current staff
password. For a receipt of NGN 14,000 that should be NGN 10,000, retain 10,000;
the system posts a linked 4,000 adjustment. Wallet funds must still be available.
School-fee corrections use unallocated credit first, then release invoice
allocations and reopen their outstanding balances as necessary.

Original receipt amounts and journal lines are retained. Correction annotations,
compensating ledger/journal entries, invoice changes and an audit record commit
atomically with version checks. Wallet moves do not create another receipt or
change cash. Reductions/reversals correct recorded cash/bank and liabilities;
they do not initiate a bank transfer or send a refund. Do not record a second
adjustment for the same error.

Retries retain the same operation ID. A changed preview must be reviewed again;
on an uncertain response, retry the same instruction before starting another.
Revenue synchronization recognises the linked invoice-credit release, so it
does not recreate that credit. Parent payment history retains the original
school-fee receipt alongside its correction; wallet activity shows its linked
debit/credit. Legacy inconsistent records fail closed for reconciliation.

Coverage: `tests/manual-payment-corrections.test.mjs`, the correction cases in
`tests/manual-payment-branch-scope.test.mjs`, isolated UI fixture
`tests/fixtures/payment-corrections.html`, and desktop
`suite/tests/test_manual_payment_corrections.py`.
