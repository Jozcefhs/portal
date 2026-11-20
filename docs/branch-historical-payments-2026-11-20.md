# Branch historical payments and pupil billing categories

Area 1's import reused local receipt labels already recorded by The Lord's Garden. The historical importer treated those labels as organisation-wide provider transaction references and rejected every colliding row.

New historical imports derive a stable reference from branch, school section and normalized source reference. The original CSV reference remains in HistoricalImportReference and payment metadata. Existing same-branch payments keep their original references. Changed account, fee, amount or currency fails validation; real provider transaction references remain organisation-wide. Failed reads cannot be interpreted as an absent payment. Standard receipt, ledger, invoice allocation and journal reconciliation remain responsible for posting and retry recovery.

The preflight now distinguishes pupils by collection path plus document identity, allowing different billing categories for different pupils in one five-row batch. Category changes on branch-paired desktops are permitted through the existing verified-actor gate and finance-role check. Student lookup uses the authorised branch and section; no foreign pupil or financial record can be changed through that action.

Validation: 162 focused tests passed. Real recorder tests intercepted every network request and verified a branch-local import, repeat replay with exactly one deposit, original branch receipt preservation, conflicting amount rejection, mixed pupil categories, scoped scholarship updates, unauthorised role/foreign-pupil rejection, invoice/payment preservation, and existing scholarship exemptions. Production investigation read only the three receipt references shown in the screenshot. No real payments were posted or pupil categories changed during this fix.

Server deployment only. Installed desktop clients can retry the same CSV and category action without recompilation. Both production backends returned HTTP 200 with the expected school/workspace identities after deployment.

Rollout on 20 November 2026:

- Destiny Christian Academy: https://cb0b3baf.destinychristianacademy.pages.dev; source branch `codex/school-insights-qr-deploy`, remote commit `ebd7a79145a46912c6ea69818efaeb959fad2061`.
- Tenant 001: https://c2883cfc.dynamax-tenant-001.pages.dev; source branch `codex/custom-domain-payment-checks`, remote commit `9205ea94ec070f74449d795591f3815efe3c184a`.
- Shared source branch `codex/school-score-register-release`: remote commit `e2882c9cbe6a84349736f68860ac8d1673ca567b`.

The pushed trees matched the tested and deployed trees. No desktop installer was compiled or released.
