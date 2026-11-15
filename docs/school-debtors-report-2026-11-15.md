# School fee debtors report — 15 November 2026

School Insights keeps its Top 10 Fee-Payment Defaulters summary and adds **View all debtors** immediately above it. Accounts-authorised school staff can open the full report for their permitted branch and school section, search by name/admission number, filter class and student type, and sort by balance/name/class.

The screen displays 100 rows per page. **Preview / print** includes every matching debtor, irrespective of the current screen page, with count, expected/paid/outstanding totals, school and scope headings, and the snapshot time in WAT. The preview provides **Print / save PDF** and **Back to list**. It uses a contained preview without opening a popup.

The source is the existing Accounts overview used by School Insights, including its recorded balances and configured expected fees. This feature neither rebills accounts nor changes the existing balance calculation. Only positive outstanding balances appear; paid accounts and credit balances are excluded. Amounts are presented in NGN, matching the existing school dashboard. The academic session is labelled as the snapshot's session context, not an invented term filter.

The server projects only the report's allowed fields from the already branch/section-scoped account rows. It performs no additional collection read and no write. The complete report is retained in the existing in-memory dashboard snapshot. Searching, filtering, paging, reopening and printing do not request data or write browser storage. Use School Insights **Refresh** explicitly for newer balances. Unavailable account data is marked unavailable and cannot be printed as a misleading zero-debt report. Sign-out and branch changes close the report; workspace replacement removes the contained preview.

Validation:

- Full repository suite: 5,145 passed, zero failures.
- Functional tests exercise the actual School Insights handler with synthetic inputs, all 215 debtor rows, unchanged collection-read count, branch/section isolation, Accounts permission, same admission number across branches, unavailable overview, exact totals, credit/paid exclusion, escaping and immutable inputs.
- Browser verification uses the actual School Insights entry renderer and report module at 1366px and 390px: 100-row paging, 215-row full preview, filtered 105-row preview, print dispatch, mobile fit, close/reopen, workspace cleanup, zero extra requests, zero browser-storage writes and zero JavaScript errors.
- Script: `scripts/verify-school-debtors-ui.mjs`; local screenshots and aggregate evidence: `tmp/school-debtors-ui/`.
- Starting live school assets matched the tested baseline after normalising Windows newlines. Hospital changes were not used as the school deployment source.

Web marker: `dynamax-v562-school-debtors-report`. No desktop build, installer release, real account edit or payment operation is part of this pass.

Deployment evidence will be appended after verification.
