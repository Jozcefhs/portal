# Branch historical payments and pupil billing categories

Area 1's import reused local receipt labels already recorded by The Lord's Garden. The historical importer treated those labels as organisation-wide provider transaction references and rejected every colliding row.

New historical imports derive a stable reference from branch, school section and normalized source reference. The original CSV reference remains in HistoricalImportReference and payment metadata. Existing same-branch payments keep their original references. Changed account, fee, amount or currency fails validation; real provider transaction references remain organisation-wide. Failed reads cannot be interpreted as an absent payment. Standard receipt, ledger, invoice allocation and journal reconciliation remain responsible for posting and retry recovery.

The preflight now distinguishes pupils by collection path plus document identity, allowing different billing categories for different pupils in one five-row batch. Category changes on branch-paired desktops are permitted through the existing verified-actor gate and finance-role check. Student lookup uses the authorised branch and section; no foreign pupil or financial record can be changed through that action.

Validation: 162 focused tests passed. Real recorder tests intercepted every network request and verified a branch-local import, repeat replay with exactly one deposit, original branch receipt preservation, conflicting amount rejection, mixed pupil categories, scoped scholarship updates, unauthorised role/foreign-pupil rejection, invoice/payment preservation, and existing scholarship exemptions. Production investigation read only the three receipt references shown in the screenshot. No real payments were posted or pupil categories changed during this fix.

Server deployment only. Installed desktop clients can retry the same CSV and category action after deployment without recompilation. Rollout details will be recorded after verification.
