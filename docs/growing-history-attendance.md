# Growing histories and separate-day attendance

## Data-growth repair

The shared `listCollection` adapter used to stop after five 1,000-document pages.
This made ordinary module loads fail at 5,000 records; optional loaders could
even catch that error and display an empty list. The compatibility adapter now
traverses cursor pages using one read snapshot, validates cursor progress and
rejects repeated records. Existing complete-array callers retain all their rows;
their sums, validation, print and CSV logic is not fed a truncated history window.

Complete reads are still resource-bounded: 16 MiB of serialized records,
100,000 rows and 200 page requests, or a caller's smaller explicit budget.
Exceeding these budgets fails without returning partial records. This is a
compatibility repair, not a claim that every full-collection consumer can scale
indefinitely. Very large complete reports still need a narrower period or an
indexed/streaming report implementation. The separate finance report/query
budgets are unchanged.

Clinic, Kitchen, Restaurant and Tuck Shop no longer load all movements/visits/
commerce sales merely to display a small initial list. Their module bootstrap
also skips the redundant historic scans. Shared cursor history reads use at
most four database pages per HTTP request and return at most 100 authorized
rows. `Browse all history` provides next/previous pages for movements, clinic
records, wallet purchases and sales; store workspaces also expose orders/sales.
Store order fulfillment retains its existing complete-list and authorization
behavior. All editions use the same underlying helpers.

History cursors are tied to project, account, role, branch, school section,
edition, history kind and collection. Every page reapplies the existing access
predicate. Snapshots expire after 50 minutes; refresh starts a new snapshot.
Empty filtered pages retain a continuation cursor. Ordering by document name
includes legacy rows without date fields. Search/sorting is page-local, and
loaded-page summary amounts are explicitly labelled, not presented as complete
financial totals. History browsing does not clear an unsaved operational form.

## Attendance repair

Attendance previously truncated the composite register ID to 80 characters
before appending the pupil reference. With generated session/term IDs this
removed the date, causing different days to collide. New records use a SHA-256
ID over the complete branch, section, session, term, date, class, arm, mode,
subject/period and student identity.

An existing record is matched by its complete stored identity and keeps its
original ID/revision. No migration, deletion or historical rewrite runs. Repeated
saves are idempotent; new records use create-only writes. Ambiguous duplicates
fail for review. Genuine corrections still require a reason and authorized
approval. Old cross-day correction requests cannot be approved against another
day, but may be rejected. Missing days caused by the old bug cannot safely be
reconstructed automatically and should be checked against the class register.

## Verification

- `node --test tests/workspace-growth.test.mjs`: multi-page completeness, read
  budgets, snapshot reuse, legacy rows, scope binding, expiry and cursor errors.
- `npm run test:academic-release`: includes long-ID consecutive-day, legacy
  history, genuine correction approval, duplicate-save and stale-revision tests.
- Full repository test run compared with an unchanged HEAD archive: 20
  pre-existing failures in account-credit-actions, requisition-edit-permission,
  staff-account-list-controls, staff-attendance-groups-ui, vendor-registration-form,
  vendor-statement-switch and wallet-card-setup-ui. These are not hidden or fixed
  as part of this repair.
- Pages Functions bundle compiled; synthetic browser preview verified next/
  previous, end of history, page search, history selection and one-click close
  without clearing a draft. No live records were altered during testing.
