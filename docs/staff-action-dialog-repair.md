# QR previews and transfer-verification feedback

The shared staff feedback layer previously treated reusable QR generation as a saved action. It also treated each HTTP 202 stage of direct-transfer verification as a completed payment. The dialog queue consequently required several Close clicks for one approval.

Reusable admission, store and giving QR requests now remain read-only in feedback and workspace-cache classification. They open their existing preview without a success modal or eviction of loaded records. QR errors remain visible through the existing handler.

Successful responses with `continueApproval: true` show their existing inline progress only. The final verified response opens one completion dialog. Failed and uncertain responses still report their outcome. Authentication, confirmation, verification stages, payment posting, receipts and idempotency logic are unchanged. No record migration is needed.

Validation:

- 4,491 Node regression tests passed.
- `tests/staff-action-dialog-browser.mjs` uses the production handlers, request wrapper and shared dialogs with intercepted synthetic responses. It verifies QR-only preview, progress and final one-click dismissal for all four transfer contexts, mobile dismissal, failure handling and exact continuation-call counts. It does not approve any real payment.
- Workspace-cache tests verify that repeated QR requests do not reload unrelated saved snapshots, while real approvals still invalidate them.

Web release marker: `dynamax-v530-action-dialogs`. No desktop compilation or installer release.
