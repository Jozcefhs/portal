# Advance credit, focused loading and vendor sales

This pass follows the decisions retained in `user-request-tracker.json`. Desktop compilation and installer release are not part of this pass.

## Parent advances

Parents can open Payments and enter a school-fee advance. A verified Paystack payment or accountant-approved direct transfer records the receipt, credit liability, ledger entries and any current due-invoice allocation atomically. Current due school fees are paid first; the remainder stays as school-fee credit, separate from the spending wallet. Future invoices are allocated when due.

The server binds the payment intent to the canonical learner document, branch and school section. Duplicate settlement callbacks return the existing receipt without another financial write. Concurrent credit actions, invoice allocations and payments use revision guards. Existing billing conflicts hold allocation for finance review; a fresh, clean billing review can explicitly clear that hold without creating another receipt or charge.

The daily workflow completes bounded credit-only pages before starting notifications. It resumes from its saved cursor; a completed-day retry reads its checkpoint and performs no queries or writes. Held accounts and accounts with no due invoice avoid financial-history reads. No real payment or live notification run was used in testing.

## Loading and purchase audit

| Path | Behavior in this pass |
| --- | --- |
| Academic setup | Classroom/catalogue/assignment setup opens directly. Memberships, marks and history are requested only by their relevant record actions. |
| Classroom details | Opening a classroom requests its class/arm. Other classroom definitions remain available and unloaded counts are labelled rather than shown as zero. |
| Record views | Class, period and history loads remain where they bound substantial reads. Changing period clears the previous record selection. |
| Optional module history | Current registers open normally. Date controls appear inside **History by date**; opening the disclosure performs no request. |
| Pending finance queues | Submitted and waiting requests remain available without choosing dates; completed history remains date selected. |
| Read-only previews/lookups | Stay fresh without clearing unrelated cached workspaces. Mutating actions still invalidate caches. |
| Tuck-shop sale | One authoritative wallet-history scan rather than two; point reads for the selected stock rather than the entire catalogue. The response uses the balance from the successful guarded commit. |
| Vendor identity | Day/Boarding is included in the existing scoped scan/search response; no additional student lookup is added. |
| Vendor payment request | Up to 2,000 sales, reserved atomically. Detailed immutable report rows are stored in bounded chunks and fetched only for a full preview. |
| Vendor payment/cancellation | Batch reads only the selected claim lots. Partial payment updates only the lots it uses. A replay creates no second payment or reservation. |
| Vendor date reports | Three composite indexes support vendor-and-date filtering. No fallback to an entire-history scan is allowed if an index is unavailable. |

The 2,000-sale test fixture uses 2,024 writes for reservation, 2,006 for a full payment, and 2,004 for cancellation. Most are necessary per-sale reservation/payment guards. Report chunks avoid putting 2,000 detailed snapshots in one request document. The existing REST commit helper checks payload and document sizes before sending one atomic commit. Firestore removed its previous 500-write Commit limit in 2023; request-size limits still apply. See [Firestore release notes](https://docs.cloud.google.com/firestore/docs/release-notes) and [transaction limits](https://firebase.google.com/docs/firestore/manage-data/transactions).

## Remaining cost considerations

The authoritative wallet scan grows with the account's lifetime activity. A future verified balance checkpoint can reduce that cost; it must be introduced with reconciliation and concurrency tests, not a blind replacement of the ledger. The vendor-bootstrap follow-up is addressed below. Fuzzy student-name search still needs the permitted branch roster; recent repeated suggestions now reuse a short-lived local result, while wallet selection and checkout remain authoritative.

Unrestricted offline wallet spending is not enabled. Multiple terminals could spend the same funds while disconnected. Any future offline mode needs a centrally reserved device allowance, a signed local journal, retry-safe synchronization and reconciliation. The current pass keeps authoritative balance and stock checks online.

## Delivery evidence

Release: `dynamax-v552-advance-credit-focused-loading-vendor-sales`.

The issue tracker records the final test and deployment status. Synthetic tests cover duplicate callbacks, concurrent changes, branch collisions, reviewed credit holds, selected-period queries, 2,000-sale requests and responsive parent/history screens. No existing business records are deleted or rewritten as a migration.

Final pre-deployment validation: **4,898 tests passed, zero failures**. Synthetic Chrome parent/history checks passed at 390px and 1280px. The three school vendor period indexes were verified READY before query activation; the new snapshot Rows field is exempt from automatic indexing.

Production verified at https://destinychristianacademy.pages.dev (deployment https://eb546361.destinychristianacademy.pages.dev), source commit 0c23a397aa5fb36f254da3c8cbe0b18094c31f87. Seven public asset hashes match committed files. Missing-credential payment input is rejected and parent/vendor endpoints deny anonymous access. Desktop source e173f80 was pushed after 36 Tk/unit tests; restricted-vendor student type and large-report printing require a future installer. The published installer remains 3.1.63.

## 10 November follow-up: pending queues and measured read costs

This follow-up is tested locally; the parent release task records its commit, index readiness and deployment separately. The owner's later instruction authorizes compilation/release after release checks. The historical delivery above remains unchanged.

Vendor bootstrap and statements now query actionable `PaymentStatus` values at the database: Awaiting approval, Awaiting payment, Part-paid and legacy Unpaid. Paid, Rejected and Cancelled requests appear only under **Payment requests → Completed request history**, after choosing a vendor and request-date range. An older pending request remains visible regardless of its submission date. Switching tabs and repeating the same completed-history selection reuses the loaded snapshot; Refresh clears it. Opening the disclosure itself issues no request. These reads are explicitly classified as read-only, so they neither open saved-action dialogs nor invalidate unrelated workspace caches.

Three additive indexes are supplied in the school, church and organisation profiles: `ScopeKey + PaymentStatus`, `ScopeKey + VendorId + PaymentStatus`, and `ScopeKey + VendorId + PaymentStatus + RequestedAt`. There is no unbounded fallback when an index is unavailable. The pre-activation school audit inspected 16 request documents: 10 Paid, five Awaiting approval and one Cancelled; none lacked status, scope, vendor or request date. Other deployment index readiness remains a release verification responsibility.

| Synthetic operation | Small fixture | Large fixture | Writes |
| --- | --- | --- | --- |
| Former vendor bootstrap request query: four pending plus completed history | 6 returned documents with 2 completed | 2,004 returned documents with 2,000 completed | 0 |
| New vendor bootstrap request query, identical records | 4 returned documents | 4 returned documents | 0 |
| Completed history selected for one vendor and month | Only matching Paid/Rejected/Cancelled documents | Same predicate excludes other vendors, branches and dates before returning documents | 0 |
| Fuzzy name suggestion, new query | 2 permitted pupil documents | 2,000 permitted pupil documents | 0 |
| Repeating a recently loaded suggestion in the same mounted workspace | 0 new query | 0 new query | 0 |
| Authoritative wallet lookup | One query returning 2 ledger entries | One query returning 2,000 ledger entries | 0 |

These counts measure returned fixture documents and handler calls, not a claim about measured production billing or index-entry charges. Suggestion results are names/references only, capped at 30 cached query results and 30 seconds, cleared on refresh/unmount. A selected suggestion still goes through live identity, balance, limits and checkout validation. Different new name queries still read the permitted roster; improving that requires indexed search fields with an explicit compatibility/backfill plan, so no pupil is silently omitted.

Wallet lookup still uses the account-reference ledger query and then verifies branch/section. Because older rows are not uniformly categorized, this may also return the same account's non-wallet ledger entries (and same-reference entries in another branch before filtering); no foreign branch balance is returned or used. Replacing it with a category-only or date-only query would lose historical refunds or late imports. The 2,000-entry test preserves an older deposit and refund and makes zero writes. Existing purchase tests verify one live wallet scan, stock point reads, atomic revision checks, and retry-safe ledger/journal/stock posting.

Checkpoint decision: retain the ledger as authority in this release. A later checkpoint must have a canonical branch/section/account identity, a verified opening balance, a replay-safe ledger cursor, and one concurrency version shared by **every** deposit, purchase, refund, correction, transfer and import writer. It also needs a bounded reconciliation path for historical corrections. Updating only the purchase writer would allow stale credit or overspending. No checkpoint is claimed as implemented.

Offline decision: keep financial posting online. A disconnected terminal cannot verify another terminal's wallet or stock use. A viable later design needs server-reserved device allowances, stock reservations, signed durable local operations, deterministic replay and reconciliation of revoked devices/late imports. The measured lifetime cost justifies checkpoint planning, not enabling unreserved offline spending.

Validation: 223 vendor API/UI/cache tests and 31 wallet/cost tests passed. The synthetic Edge browser check passed at 390px and 1280px: automatic pending requests, collapsed completed history, explicit date loading, retained navigation and no horizontal page overflow. Screenshots remain private under `tmp/vendor-request-history-ui/`; no live sales, payments, requests or records were changed.

## Historical finance evidence review

272 focused existing finance tests passed across revenue-sync checkpoints, billing categories/total discounts, total-fee payment plans, manual corrections, pending finance queues, attachments, final approvals, revenue-account renaming, organisation terminology and club registers. These are source regression checks, not evidence that every historical live correction was applied.

Prior private artifacts confirm four reconciled Paystack transactions totalling NGN 55,000 net; the repaired missing receipt has one payment, one deposit ledger row, one journal and one gateway-charge record, with zero changes on replay. Prior club-rule proof confirms Chess, Graphic and Photography changed from Grade 9 to All Main Branch classes in First Term, preserving other fields and requiring zero writes on repeat. The prior wallet audit found 249 display mismatches, including 54 false negatives, zero actual negative ledger balances and 255 refunds without session metadata; lifetime wallet calculation tests preserve those refunds without manufactured top-ups.

The initially missing posted proof for the duplicated NGN 13,600 bank-transfer top-up was resolved by the release owner's targeted live check: the earlier receipt remains Paid without a correction; the later receipt retains its original amount with `CorrectionTotal: 13600` and `CorrectionStatus: Reversed`. That verification read two documents and made zero writes. The code's guarded compensating-reversal tests also preserve receipt/review history and prevent replay from restoring removed credit. No receipt was reversed again as part of this read-cost audit.
