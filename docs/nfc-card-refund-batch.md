# Reviewed NFC card refunds

The finite campaign `NFC-S70-20261016-v1` covers 255 verified purchases of
**4k RFID S70 NFC Card**, NGN 3,500 each: **NGN 892,500**, 249 students.
Six students bought twice and receive NGN 7,000 each. A server-side digest freezes
the reviewed purchase identities; later sales are not automatically included.

## Operator steps

1. Open **Vendor Sales & Settlements → DMS-OS → Statement & request → Review NFC card refunds**.
2. Review the complete student register and unpaid vendor requests. Super Admin
   and Director can review/print; only **Accounts Officer** can approve or post.
3. Accounts enters the decision/evidence reference, reason and current password,
   checks the confirmation and selects **Approve and post all**.
4. Keep the dialog open. **Pause after current refund** and **Resume approved refunds**
   are safe. After an uncertain response use **Refresh review / status** first.
5. Print / Save PDF shows the full register, posted amounts and reversal status.

Approval atomically cancels only wholly unpaid requests containing solely the
reviewed purchases, releases their reservations, saves the approval and places a
hold on further vendor settlements. Original request amounts, allocations and
history remain, with the cancellation appended. Paid/mixed/inconsistent requests
block approval. The currently reviewed request is NGN 406,000 / 116 purchases.

Each purchase then has an independent atomic commit: wallet refund, balanced
vendor-payable debit / student-wallet-liability credit, vendor refund entry,
lot/balance adjustments, batch progress and audit entry. Original sales, wallet
debits, payments, receipts and stock are not rewritten. Read-write transaction
checks lock the original evidence without updating its revision. Deterministic
refund IDs, create-only records and revision preconditions prevent duplicates.
The parent portal's existing Wallet Activity and balance include the new credit,
labelled **Refund: 4k RFID S70 NFC Card - sales approval under review**.

The hold is released only when every approved refund is committed. Changed
evidence, prior refunds, vendor payments, stock holds or a closed accounting
period stop posting; earlier committed refunds remain intact. Do not clear the
hold manually or substitute new top-ups. Review the flagged source record and
resume after correcting the underlying issue. There is no background auto-posting
on deployment, preview, login or page load.

## Verification

`node --test tests/card-refund-batch.test.mjs tests/firestore-checked-commit.test.mjs tests/vendor-settlements.test.mjs tests/staff-action-results.test.mjs`

The local browser fixture runs with `node tests/helpers/card-refund-preview-server.mjs`.
It uses invented student data in memory, not the live database.
