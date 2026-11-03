# Payment correction totals

Release: `dynamax-v532-payment-correction-totals`.

The Accounts overview counted payment-correction and account-credit withdrawal
debits as new billed fees, leaving gross receipts in Fees Paid. A synthetic
14,000 payment reduced to 10,000 reproduced Fees Due increasing to 18,000 while
Fees Paid stayed 14,000. The outstanding balance happened to be correct, but the
two headline totals were wrong. Fee-setup fallback could also hide the reduction
when an invoice had not yet been created.

Corrections, refunds, wallet transfers, sibling transfers and manual credit
deductions now reduce available fee credit without increasing Fees Due. Audited
payment corrections also reduce the displayed receipt total; gross historical
receipt and credit totals remain available separately. Refunds and transfers
preserve the historical receipts total. The existing account snapshot and full
overview use this same calculation, so installed desktop clients receive the
repair on Accounts refresh without a new installer.

An additional posting defect was reproduced: an unchanged, previously reversed
invoice was revision-guarded by writing its normalized effective Credit (zero)
over the saved gross credit. Guards now use an unchanged raw source field.
Original invoice amounts, original payments and their correction history remain
intact. Existing atomic commits, preview checks and operation IDs still protect
against stale or duplicate posting.

No migration, deletion, invoice recreation or live payment correction is part of
this release. The user's manual Firebase correction is left untouched. No new
database reads or extra writes are added. Account refresh remains scoped.

Validation: 4,504 Node tests passed, including actual correction posting followed
by the desktop overview calculation, full reversal, lost-response retry,
concurrent failure, original record preservation, repeated refresh, realistic
586,660 / 128,000 balances, the fee-setup fallback and separation of students,
academic periods, wallet balances and optional receipts.

No desktop compilation or installer release.
