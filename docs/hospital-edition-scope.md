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

