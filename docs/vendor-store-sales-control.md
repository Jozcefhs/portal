# Vendor products in the organisation store

Vendor assignment changes ownership of the existing inventory record. Both the
vendor counter and the organisation store use the same quantity. Past receipts
and settlement snapshots keep their original owner.

In **Vendor Sales & Settlements → Vendors & balances**, management can use
**Enable/Disable church store sales** (faith), **organisation store sales**
(other organisations), or **school store sales**. The same setting is in Edit
Vendor. It is independent of the existing vendor-login POS switch.

- Enabled: the organisation and the linked vendor can both sell vendor products.
- Disabled: new organisation POS/public-store checkouts are blocked; the linked
  vendor may still sell when its own POS permission is enabled.
- Existing vendors default to enabled, preserving their current arrangement.
- Inventory management retains all items. No quantities, balances, payments,
  ownership, historical sales or settlement rules are rewritten by the toggle.
- Already-issued Paystack payments, paid-sale retries and stock-review completion
  retain the original sale snapshot. A pending bank-transfer request is rechecked
  on approval; re-enable organisation sales to approve it if needed.

The server checks the current vendor policy at checkout, independently of client
cart state and supplied collection mode. Only existing vendor-management roles
may change it, within their branch/edition/section, using a revision precondition
and an atomic audit entry. Vendor users cannot enable organisation selling.

POS/public product cards identify vendor-owned stock. Faith and organisation
collection labels use the correct wording while retaining the legacy internal
`School collected` value so accounting records and old receipts remain compatible.
Owner labels are loaded once per distinct vendor in the selected inventory;
unrelated vendors and branches are not scanned. Stock without vendors adds no reads.

Validation: synthetic checkout/replay/payment tests for school, faith and
organisation; branch/role/stale-revision tests; owner-label/read-count tests;
browser tests at 390px and 1280px for all three editions. Production inspection
was read-only and verified the four reported faith products have the same vendor.
