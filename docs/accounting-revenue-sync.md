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
