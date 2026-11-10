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
