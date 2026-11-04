# Hospital quarantined-stock disposal

See the [deployment and verification record](hospital-stock-disposal-verification.md).

This increment extends H05, H13 and F01/F02/F05/F06. It records disposal evidence and independent confirmation for stock already in quarantine. It does not initiate physical disposal, provide disposal instructions, or complete the separate controlled-drug workflow.

## Workflow

Open **Hospital workspace → Quarantined stock disposal**. The pending review queue loads a bounded page when this task is opened. Completed records require a chosen date range. Previous pages are retained; Refresh checks for newer records.

1. A pharmacist loads the relevant batch expiry period and selects a batch with quarantined stock. Shelf stock must first go through the existing quarantine workflow; patient returns remain quarantined.
2. Record the quantity, permanent reference, disposal time, method and evidence. Submission retains the batch snapshot without changing stock.
3. A different authorised officer opens the pending record and records their witness confirmation. Approval atomically reduces only the quarantined quantity and retains the disposal decision, stock movement and audit entry. Rejection or cancellation retains the original proposal without changing stock.
4. If the batch changed since submission, refresh the record, reject or cancel the stale proposal and record current evidence under a new reference. A stale proposal cannot overwrite subsequent receipts, returns, dispensing or stock-count adjustments.
5. Preview/print uses loaded records and makes no additional database queries.

## Preservation and data usage

- Existing patient returns, dispenses, supplier receipts, invoices, payments and clinical records are unchanged. No accounting journals or financial adjustments are generated.
- Permanent branch/batch/reference identities, one pending proposal per batch, version preconditions and atomic operation receipts prevent duplicate stock deductions and repeated audit entries. References remain reserved after cancellation or rejection.
- A proposer cannot approve or reject their own record. Only its submitting pharmacist can cancel it. Branch, module and subscription permissions are checked on the server.
- Queues fetch 31/display 30 records. Dated history uses a maximum 93-day period with stable pagination. There is no whole-register scan or per-row lookup; browsing creates no stock audit entries.
- Branch/session changes clear loaded data. Mutations invalidate affected stock snapshots. Failed submissions retain entered evidence and their retry identity.
- Disposal collections are included in Hospital backup discovery. Deployment adds indexes only; no historical migration or deletion is required.

Service tests enforce exact operation budgets, excluding staff authentication and branch configuration: submission uses four document reads and five atomic writes; witnessed approval uses four reads and seven writes; rejection/cancellation uses three reads and five writes. A completed identical request retry uses one receipt read and zero writes; identical permanent-reference or completed-decision retries with a fresh request use two reads and zero writes. Register browsing adds no audit writes.

## Verification

The 24 service tests cover independent review, roles, branches, disabled modules, read-only subscriptions, concurrent proposals/reviewers, interrupted responses, permanent references, fractional quantities, invalid timestamps, stale batches after real patient returns and physical counts, retained financial records, pagination, backups and operation budgets.

The synthetic browser workflow exercises pharmacist submission, independent owner review, failed-response retries, form retention, pending-page caching, explicit refresh, dated history, print previews, branch/session clearing and phone/desktop layouts. These tests use in-memory demonstration records; live verification does not submit disposal or financial transactions.

## Delivery boundary

Deploy only to the isolated [Hospital Owner's Demo](https://dynamax-hospital-review.pages.dev/hospital.html?task=stock-disposal). Patient cards remain NFC and card-terminal payments remain disabled. No desktop compilation or installer release is part of this increment.

Perpetual inventory costing, controlled-drug classification/witness registers, practitioner validation and the rest of the Hospital roadmap remain tracked in [the full scope](hospital-edition-scope.md).
