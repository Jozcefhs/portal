# Billing conflict resolution

Release: `dynamax-v531-billing-conflict-resolution`.

The missing-charge reconciliation view had no direct action for conflicting
invoices. Its existing textbook/yearbook reversal service only supported
returning-only fees on New Intake profiles. A Grade 10 Returning student with
a Grade 11-only charge therefore had no supported correction path.

The billing review now offers **Review / resolve conflicts** for each affected
account. It loads that student's evidence only, displays the conflict and
eligible correction, and requires a reason and explicit approval. The existing
school-wide obsolete-charge review also recognises class mismatches. These
previews remain live without invalidating unrelated loaded workspace records;
actual corrections still invalidate the cache.

Eligibility uses the actual active fee rule, not the fee-code suffix. Class must
be the only mismatch, with one matching rule and no competing applicable rule.
Saved classifications, scope, amount, currency, duplicate invoice checks,
payment/journal evidence, approval permissions and closed-period protections
remain enforced. Original invoice amounts, payments and receipts are preserved
using the existing atomic, revision-guarded compensating journals. Deterministic
reversal IDs prevent duplicate postings. Older preview tokens are invalidated.

The screenshot shows a charge difference of 143,880 for TXT_SNR_11. It does not
establish when or why the original charge was created; profile changes, fee-rule
changes and original posting errors require inspecting their historical evidence.
No live financial correction was performed by this implementation.

Validation: 4,495 Node tests passed. Synthetic browser checks cover direct row
access, selected-account requests, desktop/mobile layout, required reason,
confirmation/cancellation, one submission, fresh recheck, lost responses,
read-only access and branch changes. Backend tests cover unpaid/partly-paid/paid
class mismatches, preserved source records, stale previews, legitimate charges,
ambiguous rules, scope/currency/amount mismatches and duplicate prevention.

No desktop compilation or installer release.
