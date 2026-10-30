# Open finance requests and completed history

Finance Requests & Imprest now opens its pending queues immediately. The date selector is used only by the separate Completed history view. Pending records are not restricted by age or by previously selected history dates.

The open queues include draft/submitted requisitions, confirmation and approval stages, approved requests awaiting posting/payment, posted unpaid supplier bills, and imprests awaiting issue or retirement. Rejected requisitions remain accessible for correction/resubmission; rejected imprests are closed. Paid/posted requisitions, paid supplier bills and retired/closed imprests belong in completed history. This classification changes no stored statuses, records, approvals, payments or journals.

Each queue loads at most 50 visible rows per request, with Load more for additional rows. Historical queries require valid dates and query only terminal statuses in that range. Current branch, section and officer permissions still apply. Legacy branch coverage retains those permission checks and uses a maximum 250-row scan per response with continuation. Missing indexes and database errors are reported rather than treated as empty results.

Pages use immutable database snapshots, bound to the user, queue, branch and view. Loaded rows survive navigation and switching between open work and completed history. Refresh and mutations invalidate saved data; sign-out and branch changes prevent reuse across access scopes. The browser keeps no persistent copy of staff records. Counts and totals are explicitly for loaded records.

The common route and UI support school, faith, organisation and Hospital editions. The index definitions for the three established edition profiles include the nine additive queue/history indexes. No desktop build or installer release is part of this repair.

Validation: 4,383 repository tests passed. Queue tests cover old open requests, unpaid supplier invoices, unretired advances, date validation, cursor boundaries, permissions, retry-safe pagination, query failures and record preservation across editions. The synthetic browser check covers automatic opening, date-gated completed history, cached navigation, refresh, branch isolation and phone layout. See [deployment verification](finance-open-request-queues-verification.md) for the DCA rollout and live browser checks.
