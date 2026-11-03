# Reviewed billing-category charge corrections

The student billing conflict review can reverse obsolete tuition or textbook
invoices left behind after a billing-category change. This is an explicitly
approved finance correction, not an automatic consequence of viewing an account.

Approval requires a saved category and the classifications used by the fee rule,
one active rule proving the mismatch, and one verified replacement for the same
named component in the current period. A missing replacement can be created in
the same atomic correction, using the standard deterministic profile-invoice ID.
An existing, cancelled, ambiguous or differently dated replacement is never
silently recreated. A correct-class textbook can be created on the same basis.
Missing, ambiguous, changed, foreign-currency or out-of-scope evidence remains
blocked. Existing receipt and accounting-journal reconciliation also applies.

The original invoice amounts and payments remain intact. Reversal metadata,
create-only adjustment records, balanced journals and audit entries record the
correction. Released payment allocations can move only to undisputed, due school
fees in the same academic period, capped by the allocations actually released.
Any unused allocation remains account credit. Wallet transactions are unaffected.

Explicit Full Scholarship exemptions are recognised for tuition and textbooks;
fees explicitly assigned to scholarship students still apply. An optional list of
invoice IDs limits a review to the selected conflicts. The list is part of the
preview token, and posting cannot expand it or act on a no-longer-eligible invoice.
Other fee conflicts remain visible and unchanged.

Category-specific prices override the same named applicable standard component
even when the category rule covers all classes and the standard rule covers one
class. Branch, academic period, currency and different named components remain
separate. This fixes the cause of duplicate standard/category textbook charges
without rewriting historical invoices during ordinary account viewing.

The preview token covers the exact correction and allocation plan. Atomic source
revision checks reject concurrent edits. Deterministic reversal IDs and create-only
journals prevent duplicate posting after retries or lost responses. Reads are scoped
to the selected account; additional journal reads cover only correction targets.

Validation: `tests/obsolete-school-charge-reversal.test.mjs` covers conservation of
payments and original records, exact balances, journal reconciliation, ambiguous
rules, replacement evidence, future/other-period fees, stale sources, closed periods,
duplicate adjustment/replacement IDs, cross-branch summary collisions and lost responses.
The billing conflict browser test covers
review navigation, single submission, read-only access and workspace changes.
