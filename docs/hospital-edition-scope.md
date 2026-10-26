# Hospital edition scope and delivery checklist

Scope confirmed: 26 October 2026, Africa/Lagos.

The user wants Hospital to become the fourth Dynamax edition, alongside School, Faith and Other Organisations, and wants every feature in the proposed Hospital scope included. This document is the implementation checklist for that full scope, covering the web companion, desktop and shared backend.

All items below are pending implementation and verification for Hospital. Existing shared capabilities may be reused, but reuse alone does not establish that Hospital integration is complete. This document records scope; it does not claim a hospital release is ready.

## Scope decisions

- Include every core module, specialist module, foundation and edition integration listed below.
- Specialist modules are optional for each hospital or branch to enable. They remain part of the product delivery scope.
- Delivery phases determine order, not exclusions. An initial release does not complete the full Hospital edition.
- Keep one patient identity within a hospital organisation, connected to visits, prescriptions, investigations, admissions and payments. Branch access remains controlled; different organisations remain isolated.
- Preserve clinical, stock, financial and audit history through transfers, corrections, retries and controlled patient merges.
- Reuse the existing finance, procurement, staff, payroll, branch and identity capabilities where appropriate, with Hospital-specific permissions and wording.
- Keep card terminal payments disabled, as previously instructed. Future hardware integrations do not authorise enabling this payment method.
- Patient identity cards must be NFC cards, as confirmed by the user on 26 October 2026. Include tap-to-find, assignment, revocation and replacement. An NFC identifier locates the patient; it does not grant access to medical records or authorise payments. Clinical data stays in the protected system.

## How to maintain this checklist

Read this file before starting or resuming Hospital work. Use the requirement IDs in implementation notes, tests and release evidence. Append new requests here so they are not left only in chat history.

Keep an item unchecked while any of its stated capabilities remains pending. Record partial progress, dependencies and blockers in the delivery log. Mark an item complete only when its acceptance evidence is recorded. Do not silently remove requirements or count an unavailable external integration as working.

At the end of each Hospital work session, update the delivery log with completed work, verification, outstanding requirements and the next step. If work continues in another chat, provide this file as the handoff reference.

## Core modules

- [ ] **H01 Patient registration.** Unique hospital numbers; demographics; photographs; emergency contacts; guardians; insurance details; NFC patient cards with printable layouts, tap-to-find, assignment, lost-card revocation and replacement; duplicate detection; controlled merging that retains all linked records and an audit trail. A merge must not rely on a name match alone. NFC lookup still requires staff authentication and the appropriate branch and patient-access permissions; card identifiers must not contain clinical records.
- [ ] **H02 Appointments and reception.** Doctor schedules; bookings; walk-ins; arrival and check-in; queues; cancellations; referrals; follow-up appointments and reminders.
- [ ] **H03 Triage and nursing.** Vital signs; allergies; presenting complaints; staff-recorded urgency; nursing notes; shift handovers linked to the correct patient and encounter.
- [ ] **H04 Consultation and medical records.** Patient history; diagnoses; clinical notes; treatment plans; investigation requests; prescriptions; referrals; signed consultation records. Signed entries retain their original content, with attributable amendments.
- [ ] **H05 Pharmacy.** Prescription review; full and partial dispensing; medicine batches; expiry tracking; stock balances; supplier purchases; returns. Prescribing, dispensing and administration are distinct events, with stock and billing linked to the correct event.
- [ ] **H06 Laboratory.** Configurable test catalogue; requests; specimen labels; specimen tracking; result entry; verification; release; critical-result notification and acknowledgement. Unverified results are distinguishable from released results.
- [ ] **H07 Radiology and imaging.** Requests; appointments; reports; attachments; connections or links to an imaging archive where available. Record external integration readiness separately from the report workflow.
- [ ] **H08 Admissions, wards and beds.** Admission; bed allocation; ward transfers; nursing charts; medication administration records; discharge summaries; bed availability. Transfers keep the same patient and encounter history and prevent conflicting bed allocations.
- [ ] **H09 Emergency department.** Rapid registration; temporary unidentified patients; triage; treatment records; emergency orders; controlled reconciliation with the correct patient when identity becomes available.
- [ ] **H10 Billing and payments.** Charges for consultations, investigations, medicines, procedures and beds; deposits; invoices; part payments; refunds; corporate accounts; accounting reconciliation. Retries must not duplicate charges, receipts or ledger postings.
- [ ] **H11 HMO and insurance.** Insurer-specific tariffs; patient eligibility records; authorisation references; covered services; co-payments; claims; rejected claims; settlement tracking. Support configurable workflows first and direct insurer connections where interfaces and credentials are available. Do not imply automated verification where staff verification is required.
- [ ] **H12 Patient portal.** Appointment requests; invoices; receipts; released results; discharge documents; secure communication; explicitly authorised guardian access. Patient access must not expose another patient's records or internal-only notes.
- [ ] **H13 Hospital administration.** Staff records; duty rosters; attendance; payroll; purchasing; departmental inventory; assets; equipment maintenance; supplier payments. Integrate the existing approvals and accounting capabilities without duplicate financial posting.
- [ ] **H14 Reports and dashboards.** Patient attendance; waiting times; bed occupancy; outstanding investigations; medicine usage; expiring stock; revenue; unpaid bills; insurance claims. Apply branch and period filters, and distinguish partial-page figures from complete totals.

## Specialist modules included in the full scope

Each module can be enabled per hospital or branch. Detailed clinical workflows must be defined with the relevant practitioners during implementation; the module remains pending until that workflow is implemented and validated.

- [ ] **S01 Maternity and antenatal care.** Connected antenatal and maternity records, visits and care workflows, linked to the patient's broader history.
- [ ] **S02 Immunisation.** Immunisation records, schedules and follow-up workflows with appropriate patient and guardian access.
- [ ] **S03 Theatre and surgery.** Theatre scheduling, procedure records and the associated clinical, stock and billing workflows.
- [ ] **S04 Dental care.** Dental appointments, clinical records, treatment and billing workflows.
- [ ] **S05 Physiotherapy.** Referrals, treatment plans, appointments, session records and progress tracking.
- [ ] **S06 Blood bank.** Traceable blood-bank inventory and issue workflows, with practitioner-defined verification and clinical controls.
- [ ] **S07 Dialysis.** Dialysis scheduling, session records and associated clinical, consumable and billing workflows.
- [ ] **S08 Ambulance services.** Service requests, dispatch, trip records and patient handover workflows.
- [ ] **S09 Mortuary.** Identification, custody, storage and authorised-release records with controlled access.
- [ ] **S10 Teleconsultation.** Remote appointment and consultation workflows, identity checks, appropriate consent and documentation connected to the patient record.

## Foundations required throughout

- [ ] **F01 Role and branch permissions.** Define appropriate access for doctors, nurses, pharmacists, laboratory staff, receptionists, cashiers, records officers and administrators. Financial access does not automatically grant access to confidential clinical notes. Support users assigned to one or several branches and hospital-wide users. Check permissions on the server as well as in the interface.
- [ ] **F02 Record integrity and traceability.** Preserve signed originals and attributable corrections. Retain relationships through transfers and merges. Audit meaningful access and changes with readable names; prevent retry-generated duplicate audit entries without suppressing distinct clinical events or legitimate access history.
- [ ] **F03 Clinical safety and workflow validation.** Prominent patient identification and allergies; authorised prescribing; verified results; acknowledged handovers. Test the clinical workflows with practising hospital staff before live patient use and retain their validation evidence.
- [ ] **F04 Privacy, retention and recovery.** Protected attachments; access auditing; controlled exports; appropriate retention and deletion policies; verified backups; tested restoration; assessment against applicable Nigerian data-protection requirements. Keep required clinical history and apply access controls to backup and offline copies as well as live records.
- [ ] **F05 Database usage and freshness.** Load only the selected branch and department. Require date ranges for historical registers; paginate; cache and reuse loaded results; avoid full-collection summary reads. Active clinical queues, medication records and changing stock require suitable freshness checks and invalidation rather than indefinite reuse of stale data.
- [ ] **F06 Retry and synchronisation reliability.** Repeated clicks, lost responses and synchronisation retries must not duplicate payments, dispensing, investigations or admissions. Handle concurrent edits and allocations explicitly and expose unresolved conflicts.
- [ ] **F07 Web, desktop and offline operation.** Responsive layouts; readable names; accessible actions on small screens; defined offline capabilities; clear online/offline and pending-sync status; protected local data; conflict handling. Document exactly which workflows can operate offline and validate them before claiming support.
- [ ] **F08 Healthcare interoperability.** Design patient and encounter data for HL7 FHIR exchange. Document supported resources and integrations and test actual exchange behaviour. A data model prepared for integration is not a completed external connection.

## Fourth edition integration

- [ ] **E01 Subscription and onboarding.** Hospital edition selection, plans, module entitlements, provisioning and onboarding. Existing editions continue to operate under their own entitlements.
- [ ] **E02 Hospital and branch setup.** Configurable services, departments, catalogues, tariffs, enabled specialist modules and branch settings. Support facilities with different services without hardcoding a single hospital structure.
- [ ] **E03 Navigation and terminology.** Hospital-specific web and desktop workspaces, role-appropriate navigation, labels, printed documents and branding. Remove school and faith wording from Hospital workflows.
- [ ] **E04 Tutorials and operational guidance.** Hospital setup, everyday workflows, permissions, patient access, offline limitations, recovery and support instructions, with usable examples.
- [ ] **E05 Deployment and releases.** Hospital deployment identity, tenant provisioning, configuration and release checks; regression checks for the three existing editions; web deployment verification; updated desktop build and installer release when Hospital desktop changes are ready.

## Delivery order

1. Establish Hospital identity, module settings, permissions, patient/encounter models, privacy, audit, recovery and efficient data-loading foundations.
2. Deliver the everyday care pathway: registration, reception, triage, consultation, laboratory, pharmacy and billing, together with basic wards, admission, discharge, insurance tracking and shared administration. This is the proposed initial operational release, subject to the applicable clinical and recovery checks.
3. Complete patient portal, reporting and remaining foundation/integration capabilities, and deliver every specialist module S01-S10. Validate integrations and offline capabilities according to their documented scope.
4. Reconcile every requirement against evidence and release the full edition. The initial operational release does not close this checklist.

## Acceptance and release evidence

For each completed requirement, record the following in the delivery log or link to a supporting test/release report:

- User-visible behaviour and the applicable web, desktop and backend changes.
- Meaningful verification, including relevant authorisation, branch isolation, integrity, retry, conflict and performance checks.
- Clinical validation where the workflow affects patient care.
- Commit/build references, deployment verification and installer version where applicable.
- Any external dependencies or remaining limitations; leave incomplete requirements unchecked.

The full edition is complete only when all requirements above have evidence, all required releases are verified, and any scope changes have been explicitly recorded with the user's decision.

## Delivery log

| Date | Requirements | Status and evidence | Next action |
| --- | --- | --- | --- |
| 2026-10-26 | H01-H14, S01-S10, F01-F08, E01-E05 | Full scope recorded following the user's request to include everything. No Hospital implementation is marked complete. | Begin with edition foundations and patient/encounter design when implementation starts. |
| 2026-10-26 | H01, F01, F06, E01-E03 | Implementation started on an isolated feature branch. The user confirmed that patient identity cards must be NFC. | Implement and test patient registration, NFC card lifecycle and reception with branch and retry controls. |

## Reference material from the feature proposal

- [NHIA resources](https://www.nhia.gov.ng/other-resources/): insurance workflow reference.
- [WHO patient safety](https://www.who.int/news-room/fact-sheets/detail/patient-safety): clinical workflow and safety context.
- [Nigeria Data Protection Commission guidance](https://ndpc.gov.ng/faqs/): privacy requirements reference.
- [HL7 FHIR overview](https://hl7.org/fhir/overview.html): healthcare information-exchange reference.

These references informed the proposal. Implementation must verify the requirements and integration specifications applicable at that time.

### Paused for score-register regression — 26 October 2026

Hospital work paused at the user's request. Uncommitted foundation work is preserved on codex/hospital-edition: edition/roles, registration, NFC assignment/lookup/replacement/revocation, reception visits, backup discovery and audit integration. Verification: 24 Hospital tests and 4,101 top-level regression tests passed; synthetic desktop/phone browser checks and a Worker build passed. Physical NFC hardware, Hospital desktop integration, live deployment, clinical validation and the remaining checklist are still pending. No Hospital release or production data changes were made.

### Resumed: triage and consultation records — 26 October 2026

The user asked to resume Hospital work. The latest delivery restriction remains test and push only, with no deployment, compilation or installer release. The NFC patient-card requirement remains unchanged, and card-terminal payments remain disabled.

- Foundation preserved in `662c03ea`; merge `f95ad070` brings in the completed school repairs through `35803379`. Hospital development continues on `codex/hospital-edition`, preserving the International Studies Officer role and all school changes.
- H03/H04 implementation now includes web/backend triage observations with explicit units and unknown allergy status, a current allergy summary, private consultation drafts, clinician signing, and attributed amendments that preserve signed originals. No diagnosis or treatment is generated automatically. Prescriptions, dispensing, investigation orders, referrals and handover workflows are still pending; the current plan/referral fields are notes only.
- F01/F02/F05/F06 implementation covers clinical-role and module permissions, patient/visit/branch identity checks, record revisions, atomic operation receipts and audit events, concurrent-edit rejection, safe retries, dated and paginated history, unsaved-entry prompts, and clearing clinical data on branch change or session expiry. Administrative and finance roles cannot read clinical notes. Signing requires review of patient identity, allergies and the saved draft.
- The existing Hospital backup discovery includes encounters, allergy summaries, consultation drafts, signed clinical entries and amendments. Tests verify reference preservation through serialization. Hospital history has a matching database index definition; it has not been deployed.
- Verification: **4,229 top-level regression tests passed**, including **35 Hospital tests**. Synthetic browser checks passed for registration, NFC lifecycle, triage, draft/sign/amend, cancellation of unsaved-entry discards, dated history, retained navigation data, branch isolation and session expiry. Desktop-width and phone-width layouts were inspected. Physical NFC-reader validation remains pending.
- Evidence sources: `tests/hospital-foundation.test.mjs`, `tests/hospital-clinical.test.mjs`, `tests/hospital-storage-audit.test.mjs`, `scripts/verify-hospital-ui.mjs` and `scripts/verify-hospital-clinical-ui.mjs`. `.github/workflows/hospital-readiness.yml` runs Hospital and shared-edition tests without building or deploying.

No full H03/H04 requirement is marked complete. Clinical workflow validation with practising staff, Hospital desktop parity, patient photographs/merging, appointments, clinical orders, pharmacy, laboratory, imaging, wards, billing/HMO, patient portal and specialist modules remain on the checklist. This is development work, not a hospital release ready for live care.

Next implementation milestone: explicit clinical order and prescription states with pharmacy/laboratory roles, record-preserving fulfilment and billing links; then complete the remaining reception/clinical workflows and desktop integration. Continue using this checklist rather than replacing it with a shorter feature list.

### Prescriptions, pharmacy and investigations — 26 October 2026

The user authorised continued implementation with all records preserved, tests and push only. No compilation, installer release or deployment is included in this pass.

- **H04:** Clinician-issued prescriptions and Laboratory/Imaging requests now connect to the existing patient visit. Issued instructions and allergy snapshots are retained; cancellation records a reason and preserves completed work. Nurses have order/result reading access when their module is enabled, without prescribing rights.
- **H05:** Pharmacist approval/hold, supplier receipt-line deduplication, medicine/strength/form/unit matching, batch expiry checks, full/partial dispensing, stock quarantine and patient returns are implemented. Stock, dispensing, return, charge/credit event, operation receipt and audit writes commit atomically. Charge events await the later billing workflow; no invoice, payment, refund or accounting journal is posted here. Integer arithmetic prevents rounding drift across fractional quantities and cumulative returns.
- **H06/H07:** Laboratory specimen labels, collection/rejection, report versions, independent verification, release and corrections are implemented. Clinicians see released reports; earlier releases remain accessible through dated history. Critical results require recorded staff communication and individual clinician acknowledgement. A later correction cannot silently clear an earlier unacknowledged critical result. This records human communication; automatic external notification delivery is still pending.
- **F01/F02/F04-F06:** Backend permissions, edition and branch boundaries, patient references, revision checks, no-store responses, retry receipts, bounded queries, date-first history and backup discovery include the new workflows. Changes update already loaded order rows without another query. Stock views are invalidated after movements. Signed/released originals and stock histories are retained; no production records were changed or deleted.
- **Verification:** **4,251 top-level automated tests passed**, including **57 Hospital tests**. All three synthetic Hospital browser checks passed, covering NFC/reception, clinical notes, prescriptions, pharmacy, quarantine returns, stock history, specimens, report verification/release, critical acknowledgement, released history, stale-list prevention, unchanged saves, unsaved content, branch/session clearing and desktop/phone layouts. No clinical decisions or real medication doses are generated in these tests.
- **Evidence:** `tests/hospital-orders.test.mjs`, `tests/helpers/hospital-orders-fixture.mjs` and `scripts/verify-hospital-orders-ui.mjs`, alongside the earlier Hospital tests and browser scripts. Matching Firestore index definitions and the test-only CI workflow are included. Usage and limits are recorded in [hospital-orders-workflows.md](hospital-orders-workflows.md).

H04-H07 remain unchecked because the broader requirements include work still pending: configurable medicine/test catalogues, procurement/payables, inventory costing, broader specimen tracking, attachments/PACS, patient access and practitioner validation. Full billing/HMO, wards/administration, remaining Hospital modules and desktop/offline parity remain on the original checklist. Card-terminal payments remain disabled.

Next: connect the prepared charge/credit events to Hospital billing and HMO workflows without duplicate posting; complete configurable catalogues and the remaining operational integrations, then continue the saved Hospital checklist.

### Foundation rule: controlled reads and writes

During this pass the user explicitly required read/write management from the foundation onward. Every subsequent Hospital module must use explicit, branch-scoped loading; bounded pages and date ranges for history; reuse of already loaded views; and revision checks before clinically or financially significant mutations. Do not add whole-collection scans, background refresh loops or repeated audit writes as a shortcut.

`tests/hospital-data-usage.test.mjs` now enforces data-operation budgets. Unchanged registration, consultation draft, pharmacy review and report saves make no writes. Shared report references are fetched once per details request; pending critical results use their immutable release snapshot instead of per-row document reads. Stock matching reuses the medicine fields already loaded, while dispensing still revalidates live order, stock and allergy data. Retry receipts prevent repeated mutations without suppressing distinct clinical events.

The workflow guide records the measured application-operation limits and their exclusions. These synthetic checks do not claim a live Google Cloud billing measurement. Preserve and extend these checks with future Hospital changes.

### Billing and HMO integration — 26 October 2026

The user authorised Hospital billing and HMO work with preservation of all records, duplicate-charge prevention and controlled reads/writes. Test and push only; no compilation, release or deployment.

- **H10:** Patient-visit service charges and existing pharmacy charge events feed invoices. Stable source references and atomic source claims prevent duplicate invoicing. Invoices retain their original lines and patient/HMO split. Part payments, confirmed cash/bank receipts, medicine-return credits, administrator service credit notes, credited-overpayment refunds and printable invoices/receipts are implemented. Unbilled service errors can be voided with a reason; history remains. Card-terminal payments stay disabled.
- **H11:** Branch-specific insurer plans and tariffs, staff-verified visit eligibility/authorisation, covered-service co-payments, prepared claims, recorded submission, rejection/resubmission, approval and partial/final settlement are implemented. Invoice snapshots preserve the verified tariff version. Credits flag submitted claims for adjustment rather than erasing submissions or shifting debt to patients. This is a configurable staff workflow; no direct insurer API or automatic verification is claimed.
- **H13/F02:** Invoice, source claim, receivable/payment counters, shared accounting journal, reference-deduplication record, financial event, audit and retry receipt commit atomically. Account mappings and prior versions are retained; active account and current/legacy closed-period checks are bounded. Generic journal reversals cannot detach Hospital balances from their postings. Tests reconcile the patient/HMO receivables to ledger amounts after credits and refunds.
- **F01/F04-F06:** Dedicated cashier/HMO roles, branch and module permissions, no clinical-note access for finance, date-first 30-row financial pages, exact plan lookup, retained views, no-op form saves, request receipts, stable business references and fresh financial revision checks are included. Billing context loads only requested patient/visit/eligibility records. Branch/session changes clear financial data. Backup discovery includes all new records; matching index definitions are prepared but not deployed.
- **Verification:** **4,269 top-level tests passed**, including **75 Hospital tests** (18 new billing/HMO tests). All four synthetic Hospital browser checks passed: patient/NFC/reception, clinical notes, pharmacy/investigations, and billing/HMO. The billing check includes tariff setup, eligibility, invoice split, payment, rejection/resubmission/approval/settlement, service credits/refunds, unchanged settings, cache reuse, printing and phone layouts. The broader tests cover concurrency, lost responses, duplicate references, expired coverage, closed periods, historical mappings and backup relationships.
- **Evidence and usage:** [hospital-billing-workflows.md](hospital-billing-workflows.md), `tests/hospital-billing.test.mjs`, `tests/helpers/hospital-billing-fixture.mjs`, `scripts/verify-hospital-billing-ui.mjs` and the existing Hospital checks. No live patient, clinical, stock or financial records were edited in this pass.

H10/H11 remain unchecked: deposits/prepayments, corporate accounts, insurer remittance allocation across invoices, insurer-specific exports/attachments, direct provider connections, live bank reconciliation, broader catalogues, desktop/offline parity and finance/practitioner validation remain pending. The full Hospital checklist above remains intact.

Next: continue the remaining billing/HMO scope and service catalogues, then the wards/admissions and other saved Hospital modules. Keep financial histories immutable, posting atomic and data-usage tests in force. Do not compile, deploy or release without a new user instruction.

### Deposits, prepayments and HMO remittance allocations — 27 October 2026

The user authorised this increment with record preservation, duplicate prevention and efficient reads/writes. Test and push only; do not compile, deploy or release. This entry supersedes the previous entry's pending status for deposits and multi-invoice remittances, while preserving the full checklist and delivery history.

- **H10:** Patient deposits/prepayments can be received before a visit or invoice exists, after verifying the hospital number. Cashiers can apply a receipt across the patient's invoices, including different visits. Each receipt retains the original amount, payer, reference, accounts and branch; applied/refunded counters provide its available balance. Administrators can return a mistaken allocation to the receipt with a reason and record refunds of unused money. Original invoices, payments and journals remain intact.
- **H11:** One HMO remittance can cover approved invoices for different patients with the same saved insurer name in one branch. Batches support 1–20 invoices, partial allocations and retained excess funds. The claim's net settled amount and state update with allocations and corrections. Prior claim submissions/approvals are preserved. This remains a staff-recorded insurer workflow, without an external provider connection.
- **H13/F02:** Advance receipt accounting uses separate patient/HMO liability mappings. Applying funds moves liability to receivables, without recognising revenue a second time. Corrections and refunds retain original account mappings. Receipts share the ordinary-payment reference guard; refunds share the existing refund guard. Stable allocation/correction references, request receipts and current-document preconditions prevent duplicate or conflicting financial postings. The batch commits completely or not at all.
- **F01/F04-F06:** Cashier, HMO and administrator permissions remain separate; branch, module, tenant and read-only checks apply. No clinical-note access is added. Opening the workspace loads no financial history. Date-selected history pages fetch 31/display 30, exact invoice-number lookup is capped at two rows, loaded views are reused and branch/session changes clear them. Each allocation reads distinct accounting codes once and checks accounting periods twice for the entire batch. Full 20-invoice patient batches use 85 writes; equivalent HMO batches use 105, including all linked records, audit and operation receipt. Completed write retries need one receipt lookup and no writes.
- **Verification:** **4,292 top-level tests passed**, including **98 Hospital tests** and **23 new advance/remittance tests**. All five synthetic Hospital browser checks pass. Coverage includes multi-patient HMO settlement, partial allocations, wrong patient/insurer/branch rejection, whole-batch failures, concurrent payment/allocation/refund conflicts, lost responses, historical account mappings, ledger reconciliation, backup relationships, 20-invoice limits, equal-timestamp pagination, retained views, printing, role controls and phone layout.
- **Evidence:** [hospital-billing-workflows.md](hospital-billing-workflows.md), `tests/hospital-funds.test.mjs`, `tests/helpers/hospital-funds-fixture.mjs` and `scripts/verify-hospital-funds-ui.mjs`. Corresponding indexes and backup collection discovery are prepared. No production patient or financial records were changed; indexes are not deployed. NFC patient identity is unchanged and card-terminal payments remain disabled.

H10/H11 remain partial because corporate accounts, cross-branch remittance transfers, insurer-specific exports/attachments, direct provider connections, bank reconciliation, broader catalogues, desktop/offline parity and finance/practitioner validation remain pending. Continue from this checklist for the remaining Hospital work; no compilation, deployment or release without a new instruction.

