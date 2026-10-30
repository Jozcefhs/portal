# Pharmacy expiry registers and physical stock counts

The deployed Owner Demo and completed checks are recorded in [the verification report](hospital-stock-control-verification.md).

Requirements: H05, H13, H14, F01, F02, F05 and F06. Web/backend increment, 30 October 2026.

Open **Hospital workspace → Pharmacy stock control**, or `/hospital.html?task=stock-control`.

## Workflow

1. Select an expiry date range and load the branch's batches. Expired batches remain visibly marked; their existing dispensing restriction is unchanged. Counts use separate shelf and quarantined quantities.
2. A pharmacist selects **Record physical count**. This fetches the current batch once. Enter a permanent count reference, actual count time (WAT), both physical quantities and supporting evidence. Submission creates a pending count without changing stock.
3. Another Pharmacist, Hospital Administrator, Medical Director or Super Admin with Pharmacy access opens the dated **Physical stock counts** register. They review the original recorded quantities, physical quantities, differences and evidence before approving or rejecting. An officer cannot review their own count. Its submitting pharmacist can cancel a pending count.
4. Approval atomically records the decision and applies the stock differences. Earlier receipts, dispensing, returns and supplier documents retain their original content. A matching count records verification without creating a zero-quantity movement. Rejection/cancellation leaves stock unchanged.
5. If a receipt, dispensing or other movement changes the batch after counting, approval is blocked. Reject/cancel the pending count and record a fresh count. Patient-care operations are not frozen while a count awaits review.

Stock counts cannot reclassify quantities between shelf and quarantine. Patient-return handling and expiry restrictions remain in force. This records inventory discrepancies; it is not a perpetual valuation/COGS system and creates no patient charge, supplier payment or accounting journal. Controlled-drug witness procedures and practitioner validation remain pending.

## Preservation and database usage

- One pending-count guard per batch prevents overlapping proposals. Permanent branch/batch/reference identities and atomic request receipts prevent duplicate submissions, decisions, adjustments and audit entries, including lost responses and concurrent reviewers.
- Proposals retain their original quantities, medicine/unit/batch snapshot, author, timestamp and reason. Decisions add their officer/time/reason; immutable event history and original stock movements remain available. Closed references cannot be reused to resurrect a count.
- Register and history reads require dates, with a maximum 93-day interval. Pages fetch 31/display 30 rows with stable cursors. Workspace entry requests no inventory or count history; navigation, repeat loads and previews reuse bounded memory caches. Branch/session changes clear the data; explicit Refresh checks newer records. Changes invalidate affected snapshots.
- Browsing writes no stock-control audit entries and performs no per-row lookups. New submissions use four exact reads/five writes; discrepancy approvals use four exact reads/seven writes, in one atomic commit. Matching-count approvals use six writes. Completed retries use one receipt read/zero writes; a fresh request repeating an identical permanent reference uses two reads/zero writes. These are tested service budgets, excluding staff authentication/branch configuration and explicit detail reloads, not cloud billing measurements.
- Four additive indexes support expiry dates, count dates/status and selected count history. StockCounts, StockCountEvents and StockCountGuards are included in Hospital backup discovery. No record migration, cleanup or deletion is required.

## Verification

`tests/hospital-stock-control.test.mjs` exercises the complete lifecycle, role/module/branch/read-only controls, concurrent proposals and approvals, lost responses, duplicate references, zero and fractional quantities, expired batches, stale counts after receipts and actual dispensing, immutable histories, pagination, backup inclusion and fixed read/write budgets.

`scripts/verify-hospital-stock-control-ui.mjs` uses real services against synthetic in-memory data. It verifies pharmacist submission, failed-save retention, independent owner approval, retained register pages, preview/print without reads, mobile forms, branch clearing and inaccessible controls for a Nurse. The broader Hospital browser suite also exercises the existing clinical, pharmacy, billing, procurement, inpatient, nursing, theatre, referral and appointment workflows.

Deploy only to the isolated Hospital Owner's Demo. Patient cards remain NFC; card terminals remain disabled. No desktop compilation or installer release is part of this increment.
