# Reviewed billing-category charge corrections

The student billing conflict review can reverse obsolete tuition or textbook
invoices left behind after a billing-category change. This is an explicitly
approved finance correction, not an automatic consequence of viewing an account.

Approval requires a saved category and complete billing classifications, one
active rule proving that category is the only mismatch, and one correctly billed
replacement invoice for the same named fee component in the current period.
Missing, ambiguous, changed, foreign-currency or out-of-scope evidence remains
blocked. Existing receipt and accounting-journal reconciliation also applies.

The original invoice amounts and payments remain intact. Reversal metadata,
create-only adjustment records, balanced journals and audit entries record the
correction. Released payment allocations can move only to undisputed, due school
fees in the same academic period, capped by the allocations actually released.
Any unused allocation remains account credit. Wallet transactions are unaffected.

The preview token covers the exact correction and allocation plan. Atomic source
revision checks reject concurrent edits. Deterministic reversal IDs and create-only
journals prevent duplicate posting after retries or lost responses. Reads are scoped
to the selected account; additional journal reads cover only correction targets.

Validation: `tests/obsolete-school-charge-reversal.test.mjs` covers conservation of
payments and original records, exact balances, journal reconciliation, ambiguous
rules, replacement evidence, future/other-period fees, stale sources, closed periods,
duplicate adjustment IDs and lost responses. The billing conflict browser test covers
review navigation, single submission, read-only access and workspace changes.
