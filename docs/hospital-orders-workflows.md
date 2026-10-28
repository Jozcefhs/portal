# Hospital prescriptions, pharmacy and investigations

Development branch: `codex/hospital-edition`. These workflows are implemented in the web companion and shared backend. Deployment, desktop parity and practitioner validation remain pending. Patient NFC identification continues to use the existing registration workflow.

## Role access

| Role | Workflow |
| --- | --- |
| Doctor / Medical Director | Issue prescriptions and investigation requests for active patient visits; view released results; cancel remaining orders; acknowledge critical results. |
| Nurse | Read orders and released results when the Prescriptions and investigations module is enabled. No prescribing, dispensing or result verification. |
| Pharmacist | Review prescriptions; receive and quarantine batch stock; dispense full or partial quantities; record patient returns; inspect stock and dispensing history. |
| Laboratory Scientist | Handle labelled specimens; enter reports; independently verify another officer's report; release verified laboratory results. |
| Radiographer | Enter, independently verify and release imaging reports. |
| Super Admin / Hospital Administrator | Configure laboratory and imaging catalogues when those modules are enabled; this does not grant patient order/report access. |
| Reception / Finance | Existing administrative access does not grant access to these clinical workflows. |

Each role also needs the relevant enabled module and branch assignment. Subscription read-only mode permits viewing but prevents writes. Pharmacy and investigation roles can identify patients without receiving general access to consultation notes.

## Issue an order

1. In **Reception visits**, select dates and load the relevant visit.
2. Choose **Prescribe / request investigation**. Check the displayed patient identity and current allergy information.
3. For a prescription, enter the medicine, strength, form, dispensing unit, dose, route, frequency, duration, quantity and any instructions. These are the clinician's entries; the software does not recommend doses or infer drug-allergy compatibility.
4. For an investigation, choose Laboratory or Imaging, then **Choose from catalogue** or **Use custom investigation**. Review the saved preparation/handling instructions and enter clinical indication and urgency. Laboratory requests also identify the required specimen. An issued order retains its catalogue version even if the service is later renamed or made inactive.
5. Confirm the identity/information check and choose **Sign and issue order**.

Issued instructions remain part of the original order. To change an order, the prescriber or Medical Director cancels the remaining work with a reason and issues a new order. Existing dispensing, specimen events and reports are retained. Fully dispensed prescriptions use the return workflow; released reports use report corrections.

## Pharmacy

1. Open **Pharmacy**, select dates and load prescriptions. Open the required order.
2. Review the patient, allergies and prescription; enter review findings and approve it or place it on hold. A changed allergy record requires another pharmacy review before dispensing.
3. Under **Pharmacy inventory**, receive stock using medicine, strength, form and dispensing unit, manufacturer batch, expiry date, supplier, invoice/receipt reference and line reference. The same supplier receipt line cannot be entered twice. Selling prices are entered per dispensing unit.
4. Choose **Load matching batches** on the prescription. Select the batch and quantity. The server checks expiry, branch, matching medicine details, available stock, remaining prescribed quantity and record revisions when dispensing is saved.
5. Partial quantities leave the remainder outstanding. A successful action updates the loaded order row immediately. Stock displays are invalidated after stock movements; reload matching batches to obtain current balances.
6. For a return, choose dates in **Dispensing history and returns**, load the original dispensing entry and record the returned quantity and reason. Returned medicines go into quarantine, without replenishing usable stock or reopening the prescription.
7. For damaged, recalled or incorrectly received stock, find the batch and use **Move stock to quarantine** with a reason. The receipt and all earlier movements remain available through dated stock history.

Dispensing and returns create linked charge/credit events marked **Awaiting billing**. They do not issue invoices, record payments, post journals or initiate refunds. Patient returns cannot create credit above the original dispensing charge. Card-terminal payments remain disabled.

The subsequent [Hospital billing workflow](hospital-billing-workflows.md) now consumes those events explicitly, preserving their original amounts and stock links. New medicine charges include their service code, description and quantity for agreed HMO tariff matching.

## Laboratory and imaging

### Reusable services

Open **Laboratory and imaging catalogue** in the investigation workspace. Choose a type and load services for the current branch; optional name-prefix and inactive-service filters narrow the list. Opening the workspace does not fetch catalogue records. Loaded pages are retained, and **Refresh catalogue** explicitly checks for changes.

Laboratory Scientists and Radiographers configure their own type. Super Admin, Hospital Administrator and Medical Director can configure enabled investigation modules. **New service** records a permanent code, name, specimen (laboratory), preparation and handling instructions. Codes cannot be renamed. Editing requires the current revision and a reason for an actual change; earlier versions remain available under **Edit / history** with selected dates. Deactivating a service prevents new catalogue-based orders without changing issued orders or reports. Unchanged saves make no writes. Catalogue services do not create or alter billing tariffs.

### Specimens and reports

1. Select dates in the relevant workspace and open an order.
2. For new laboratory orders, use **Print specimen label**, check patient identity and scan/type the label reference. Record **Collected**, then **Received** when the laboratory receives it, or **Rejected** with details. Reporting requires receipt. Each recollection uses a fresh numbered label; the earlier attempt remains in history. Optional actual handling time uses WAT and cannot precede the order or preceding handling event, or be in the future. Earlier orders retain their original collection/report workflow without migration.
3. Enter the report, including findings, units and applicable reference ranges. Mark critical results explicitly. Saving creates a report version for verification.
4. A second authorised officer of the relevant investigation role reviews the report and chooses **Verify latest report**. The report author cannot verify their own version.
5. Release the verified report. For critical results, record who was contacted, how and when. This records a staff communication; it does not claim that an automatic message was sent.
6. The clinician opens the order, loads pending critical results, reviews the relevant report and records acknowledgement and follow-up. Each critical report retains its own acknowledgement record, including when a correction has since been released.
7. Corrections require a reason and create another report version. They must be independently verified and released. The previous released version stays visible while the correction is pending. Choose dates in **Order history** and select **Load released reports for these dates** to review earlier releases.

Draft and unverified reports are not returned to the clinician's result view. Laboratory staff cannot handle imaging orders and imaging staff cannot handle laboratory orders. This implementation does not provide a patient portal or publish reports to patients.

## Record integrity and loading

- Patient, visit, order, branch, batch, dispensing, return and report references remain linked. Signed content and released report snapshots are retained.
- Mutations commit their relevant records, stock movements, charge events, operation receipt and audit event together. Retrying the same request after a lost response does not duplicate the operation.
- Concurrent changes require a refresh. Unsaved form content is protected when changing records or branches; branch changes and session expiry clear clinical content from the screen.
- History requires a selected date range, with a maximum 93-day query period and pages of 30 records. Exact matching stock and pending critical results are bounded operational lookups. Opening the workspace and switching between loaded tasks do not scan history.
- Unchanged patient, consultation draft, pharmacy review and report form saves make no writes and do not trigger another details refresh. Distinct clinical observations and real stock movements remain separate events; only retries or unchanged form saves are suppressed.
- Current/released views reuse the same report read when both reference it. Pending critical alerts carry the immutable released content needed for acknowledgement, avoiding a separate report lookup for every row. Stock matching uses medicine details already loaded on the prescription instead of reading the patient again; dispensing still checks fresh stock, order and allergy records before committing.
- Hospital backup discovery includes all new collections. Tests verify reference retention through serialization; no production migration or record deletion is part of this change.

### Application data-operation budgets

`tests/hospital-data-usage.test.mjs` enforces these limits with the actual services and instrumented storage. These count Hospital service operations, not Google Cloud billed reads: authentication/settings access, index charges, and transport behaviour are outside this fixture.

| Requested operation | Hospital data reads | Writes |
| --- | --- | --- |
| Open access/settings screen | No patient/order/stock query | None |
| Invalid or missing history dates | No history query | None |
| Load an order page | One branch/type/date query, at most 31 fetched documents for 30 displayed records | One access audit |
| Find matching stock | One branch/medicine query; no patient read | One access audit |
| View an investigation whose latest report is also released | At most five document reads, including one report read; no history query | One access audit |
| Load pending critical results | At most four identity/order document reads and one bounded alert query; new alerts need no per-row report lookup | One access audit |
| Issue an order | At most four document reads; no history query | Six linked writes in one atomic commit, including its operation receipt and audit |
| Select catalogue service when issuing | One additional exact catalogue read | No additional writes; instructions are saved in the order |
| Load a catalogue page | One branch/type/name query; fetch 31, display 30 | None; configuration browsing adds no clinical audit |
| Save a catalogue change | Two exact document reads | Four atomic writes: current item, immutable version, audit and operation receipt |
| Save an unchanged catalogue item | Two exact document reads | None |
| Handle an outpatient specimen | Five exact document reads | Four atomic writes; inpatient changes additionally protect discharge state |
| Retry a completed catalogue/specimen request | One operation receipt read | None |
| Retry that completed issue request | One operation receipt read | None |
| Save an unchanged form | Current record/revision checks | None |

Future Hospital work must retain these tests and add a bounded query and mutation plan for each new register or workflow. Required clinical, stock and financial consistency checks take precedence over serving an indefinitely stale cache.

## Remaining Hospital scope

The complete checklist remains in [hospital-edition-scope.md](hospital-edition-scope.md). Billing/HMO workflows are documented separately. Remaining investigation/pharmacy work includes a reusable medicine catalogue, procurement and supplier-payable integration, inventory costing, patient access, structured lab panels/reference intervals, analyser integration, report attachments/PACS, specimen transport/accession beyond collection/receipt/rejection, automatic communication delivery, desktop/offline integration, and practitioner validation. The existence of a working order workflow does not mark the whole Pharmacy, Laboratory or Imaging module complete.

## Verification

- Backend: `tests/hospital-orders.test.mjs`, `tests/hospital-investigations.test.mjs`, alongside the Hospital foundation, clinical and backup/audit tests.
- Browser: `scripts/verify-hospital-orders-ui.mjs`, `scripts/verify-hospital-clinical-ui.mjs`, `scripts/verify-hospital-ui.mjs`, using synthetic records and isolated local servers.
- CI: `.github/workflows/hospital-readiness.yml`; test execution only, with no compile, deployment or installer release steps.
