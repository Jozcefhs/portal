# Fee rules for several classes — 10 November 2026

The owner reported that Area 1 Primary tuition selected for Grades 3, 4, 5 and 6 appeared only in Grade 3 fee lookup.

## Cause and repair

The desktop batch form sent the correct comma-separated `ClassName` list. Both backend fee-save handlers passed the whole list to a single-class alias matcher. Its first grade match replaced the entire selection with Grade 3. The `GRADE_3_TO_GRADE_6` text in the fee code was a generated label, not the eligibility rule.

Fee saves now canonicalize each explicitly selected class separately and retain the complete CSV rule. Single-class and All rules remain supported. Fee codes are not used to infer membership: a selection such as Grades 3, 5 and 6 must not silently include Grade 4. Names-only fee saves do not fetch arm definitions.

The desktop source also preserves selections when reopening/editing a multi-class fee and sends explicit selections alongside the compatible CSV field. No installer compilation/release is included.

## Requested existing rules

The targeted live read found exactly three affected `TUITION123_GRADE_3_TO_GRADE_6_*` fee rules in `area-1-primary`, all stored as Grade 3:

| Term | Existing amount to preserve |
| --- | ---: |
| First Term | ₦123,000.00 |
| Second Term | ₦321,000.00 |
| Third Term | ₦432,000.00 |

The prepared correction changes only class eligibility and update metadata on these existing documents, with exact saved-version checks and one deterministic audit entry. It does not recreate fees, alter amounts, generate/recalculate invoices, or change payments. Preview verification confirms all four selected grades match one tuition rule per term, while Grades 2/7 and other branches do not.

Final execution, retry verification, tests and deployment evidence are retained in `user-request-tracker.json`. Private snapshots/repair plans remain in ignored `tmp/`.

Validation before deployment: **4,939 web tests passed** and **50 focused desktop tests passed**. The desktop source fix is commit `e9b6dba`; it has not been compiled into a new installer. The server repair accepts the comma-separated selections already sent by the current installer.

## Verified delivery

Web commit `101ca616ee89dcbef841f02a73628cd80d28a8d9` is deployed as `dynamax-v554-multiclass-fee-rules`. Production served files match the pushed Git blobs (Linux LF line endings).

The three reviewed Area 1 tuition records now retain the exact class list Grade 3, Grade 4, Grade 5, Grade 6. Their original IDs, codes, amounts (NGN 123000, 321000, 432000 by term), and other fields were verified unchanged. No invoice or payment was written. One deterministic maintenance audit records the correction. A second application performed zero changes. Grades 2, 7 and other branches remain excluded.

Desktop source `e9b6dba` is pushed only; no new installer was compiled or released.

## School-wide scope and audit

The fix is in the shared single and batch fee-save handlers, not an Area 1 exception. Regression coverage exercises Main Branch, Area 1 Primary and The Lord's Garden Primary, every term, exact selected classes and cross-branch exclusion.

A read-only audit checked all 94 school fee rules (Main Branch 86, Area 1 Primary 3, The Lord's Garden Primary 5). Existing Main Branch multi-class selections remain intact, including intentionally non-contiguous selections. The owner stated that they will delete the three Lord's Garden tuition rules whose generated codes say Grade 4 to Grade 6 but whose saved class is Grade 4. Those rules were left untouched; their intended selection was not guessed from the code. No additional invoices, payments or fee amounts were changed by this audit.
