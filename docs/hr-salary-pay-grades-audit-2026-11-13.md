# HR salary and pay-grade completion audit — 13 November 2026

The owner requested verification of the HR work completed on 12 November. The shared web implementation is complete. The isolated Hospital owner demo had missed that rollout; this audit brought it up to date. All changes remain web companion only.

## Verified functions

| Request | Result and location |
| --- | --- |
| Reusable allowances and deductions | In HR salary structure, select saved items by checkbox and enter employee-specific amounts. Templates can be renamed or deleted without changing saved salaries or past payroll. |
| Compact layout and blank new salary | Dialogs fit desktop and mobile; a new unsaved basic salary starts blank. An explicitly saved zero remains valid. |
| Pay grades and levels before selecting staff | Open **HR → Pay grades & levels** to create a grade/level and its basic salary, allowances and deductions. |
| Edit/delete grades and levels | Saved staff salary snapshots and previous payroll remain intact. |
| Assign staff without changing pay | Assign grade/level separately. Assignment does not write a salary profile. |
| Apply salary to multiple staff | Preview and apply to selected staff, including selection by grade/level. Batches are bounded to 50 with continuation for larger selections. |
| Staff-list grade/level columns and filters | Assigned grade and level appear in HR. Filters operate on the loaded directory without further requests. |
| Accounts payroll connection | Salary saves use the existing payroll profiles. Bank, pension, tax and other payroll settings are preserved; salary changes do not rewrite completed payroll runs. |
| Employment-letter workflow | Existing PDF preview/download and explicit email action continue to pass scope, history and duplicate-send checks. No live employee email was sent during this audit. |

## Verification

- Shared HR/payroll tests: **180 passed** across the focused HR, employment, PDF, payroll and email-scope test sets.
- Hospital focused HR/payroll/cache/release tests: **100 passed**.
- Hospital full top-level regression suite: **4,724 passed, zero failed**. An outdated source-text assertion was resolved by retaining its established callback parameter spelling; the complete suite was then rerun successfully.
- Synthetic browser checks passed on both checkouts: desktop and mobile, reusable-item editing, grade/level management, assignment-only behavior, salary batches, directory filtering, cached views and role restrictions. No real staff records were used.
- Code and tests verify no-op/retry guards, stale-preview checks and unchanged saved salary/payroll snapshots after template edits. These are regression checks, not a claim that production traffic was metered.
- Public HR scripts matched tested shared source on School, Faith and all 11 managed subscriber portals. Successful shared deployment runs: `43419669272` and `43419669483`; deployed source `0ebb97258b33268b6ef380f695d60f25793adb1e` includes the 12 November HR commits ending in `a7efbf79`.
- Hospital deployment: [f1d0dc1e](https://f1d0dc1e.dynamax-hospital-review.pages.dev), live at [Hospital owner demo](https://dynamax-hospital-review.pages.dev/admin). Release marker: `dynamax-v532-hospital-hr-pay-grades`.
- Hospital source push: `bd323c7c825f81b32c206b28fe990c124f017cc4`. Its source tree `77aeaf250bf00d748994e5cbf4e7315212a3c89a` is identical to local tested/deployed commit `de84a27ab6024b6cf297a0791129043d9068c33f`; the GitHub connector was used because normal Git HTTPS connections timed out.
- Six Hospital live assets matched the committed source. Isolated Hospital workspace/edition verified. A synthetic owner could read the demo salary structure; a synthetic doctor received 403; an anonymous request received 401. No business records changed and no emails were sent.

## Preserved boundaries

No salary, payroll run, employee record, payment or historical document was migrated or rewritten by this audit. No desktop app was compiled or released. Live staff password-recovery testing remains deferred at the owner's request; it is separate from the HR feature completion check.
