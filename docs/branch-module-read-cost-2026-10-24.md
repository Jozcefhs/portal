# Branch and workspace read reduction — 24 October 2026

This release changes read paths shared by the school, faith and organisation editions, including their web workspaces and desktop backend routes. No migration, deletion, score recalculation or production data rewrite is performed.

## Changes

- Academic workspace counters use only the data already loaded for that workspace. Opening Catalogues no longer fetches student memberships and teacher allocations solely to count them. Unloaded counters are distinct from zero; the web omits unloaded summary cards.
- Shared staff lookups in Academics and the Records Desk, root legacy school lists, operational inventory, clinic/store records and HR collections use a branch-aware reader. Existing role, edition, section and record visibility checks still run after the query.
- Main Branch finance reads use the same compatibility-aware reader. Explicit all-branch reports remain available; report pagination and complete-total error handling are preserved.
- Operational history reads use the selected branch index where coverage is complete. Continuation tokens remain bound to the user, edition, collection, branch and snapshot. The compatibility proof is reused within one request, never across snapshots.
- Bookstore, Uniform Store and Organisation Store queries include the selected store type after checking that stored type labels are canonical. Differently formatted legacy labels keep the existing display predicate so valid items cannot disappear. Viewing a catalogue, or resolving a category for an item, no longer performs category migration writes. Explicit category management still checks affected items across the shared catalogue.
- Timetable-copy finalization reads versions for its selected branch rather than every branch.

## Legacy compatibility and necessary shared reads

Firestore cannot retrieve missing fields with an ordinary equality query. Scalar aggregation counts check whether every document has a recognised, nonblank canonical BranchId at a fixed snapshot. Only then is the document query narrowed. Missing, blank, null, differently cased or mixed legacy branch fields retain the previous compatibility read and caller filtering. Coverage is not cached across requests, so a new untagged record from an older client cannot disappear. Aggregations have index-read costs, but do not download all document bodies.

Some reads are intentionally shared: category definitions, the chart of accounts, account-integrity/subscription checks, and the HR staff map used to resolve legacy employment history. Faith-module collections already use branch-specific paths and hotel queries already filter their branch. Personal history, backups, cross-branch reports and data-integrity checks retain the data required for completeness. These are not replaced with incomplete totals or guessed zeroes.

## Validation

- Full Node suite: all 3,868 tests passed after the final report-compatibility and request-local proof refinements.
- New behavioural tests cover all three editions, Main and other branches, no writes on reads, branch coverage, legacy/alias fields, old-client inserts, zero counts, failed counts, more than 30 branches, module filters and snapshot-bound history pagination.
- Existing payment, score, student, HR, procurement and vendor tests continue to verify record preservation, branch access and transactional behaviour. VM fixtures were updated to inject the new reader; its actual query logic is tested separately.
- Pages Functions worker builds successfully.
- Live read-only aggregation checks returned 178 staff records (167 explicitly tagged Main), no root legacy students, 1,773 payments explicitly tagged Main and 49 store items explicitly tagged Main. No student or payment document bodies were downloaded for these checks.
- Read-only Query Explain confirmed the Main Branch query and the branch-plus-session finance query, and the branch-plus-store-type queries use existing indexes without executing the document queries.

The school billing screenshot includes historical usage. This change cannot remove prior charges; savings must be assessed over subsequent comparable days. It does not guarantee zero reads outside a selected branch where legacy compatibility or an explicitly shared operation requires them.
