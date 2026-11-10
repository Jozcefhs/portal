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

The authoritative wallet scan is limited to that wallet's history but grows with its lifetime activity. A future verified balance checkpoint can reduce that cost; it must be introduced with reconciliation and concurrency tests, not a blind replacement of the ledger. Vendor request bootstrap still reads that vendor's request register, and fuzzy student-name search still needs the permitted branch roster. These are retained as explicit follow-ups rather than described as eliminated.

Unrestricted offline wallet spending is not enabled. Multiple terminals could spend the same funds while disconnected. Any future offline mode needs a centrally reserved device allowance, a signed local journal, retry-safe synchronization and reconciliation. The current pass keeps authoritative balance and stock checks online.

## Delivery evidence

Release: `dynamax-v552-advance-credit-focused-loading-vendor-sales`.

The issue tracker records the final test and deployment status. Synthetic tests cover duplicate callbacks, concurrent changes, branch collisions, reviewed credit holds, selected-period queries, 2,000-sale requests and responsive parent/history screens. No existing business records are deleted or rewritten as a migration.

Final pre-deployment validation: **4,898 tests passed, zero failures**. Synthetic Chrome parent/history checks passed at 390px and 1280px. The three school vendor period indexes were verified READY before query activation; the new snapshot Rows field is exempt from automatic indexing.

Production verified at https://destinychristianacademy.pages.dev (deployment https://eb546361.destinychristianacademy.pages.dev), source commit 0c23a397aa5fb36f254da3c8cbe0b18094c31f87. Seven public asset hashes match committed files. Missing-credential payment input is rejected and parent/vendor endpoints deny anonymous access. Desktop source e173f80 was pushed after 36 Tk/unit tests; restricted-vendor student type and large-report printing require a future installer. The published installer remains 3.1.63.
