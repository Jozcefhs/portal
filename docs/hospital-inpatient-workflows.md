# Hospital wards, admissions and discharge

Development increment: 27 October 2026. Web companion and shared backend on `codex/hospital-edition`. Test and push only: no deployment, compilation or installer release. All verification uses synthetic records.

## Staff workflow

1. Enable **Wards and admissions** for the Hospital subscription and relevant staff. It requires patient registration and reception. It is included in the Hospital Standard default module set and above; other editions do not gain this module.
2. A Hospital Administrator or Super Admin creates wards and beds. Codes are permanent within their branch/ward; names and availability can be edited. Occupied wards/beds cannot be deactivated. Setup versions are retained.
3. Register or find the patient, including by NFC, and check in through Reception. Select **Ward admission** on the visit. Choose a ward, select an available bed, record the responsible clinician and confirm the patient/hospital number. Admission uses the existing visit; it does not duplicate registration, invoices or clinical entries.
4. Open current occupants from their ward, or choose admission dates in the register. Historical requests are limited to 93 days and 30 visible rows per page. Ward occupancy remains available for patients admitted before that range. Transfers use the same admission and visit and require an available destination and a recorded reason.
5. A Doctor or Medical Director opens the admission, reviews the care record and medicines/investigations, and signs a discharge summary with disposition, diagnosis, course, treatment and follow-up instructions. This is a clinician-entered summary, not automatically generated medical advice. Nurses can read and print the signed summary; administrative and finance staff cannot read its clinical content.
6. Registration/Front Desk, a Nurse or a Hospital Administrator confirms departure/handover and completes discharge. This requires a signed summary and no unsigned consultation work. Further clinical/order changes before departure invalidate discharge approval and require a new clinician review. The earlier signed summary remains intact. Replacements require a reason and preserve the previous version.
7. Discharge releases the bed and closes the open visit/admission together. A released bed, including a bed vacated on transfer, shows **Needs preparation**. Staff must explicitly confirm **Mark bed ready** before it can be allocated again. A future admission needs a new check-in visit.

Financial records remain independent: discharge does not mark an invoice paid, waive a balance, delete charges or cancel orders/reports. Bed charges can use the existing explicit service-charge workflow and its reference guards. This increment does not automatically calculate per-night charges or claim that discharge itself creates a charge. Card-terminal payments remain disabled.

## Permissions and record integrity

- Access checks enforce Hospital edition, subscription, module, active branch and patient identity. Administrative admission rights do not grant access to clinical summary content. Read-only subscriptions cannot mutate wards, beds or admissions.
- One deterministic open-admission record per patient prevents simultaneous admissions across branches. Each bed contains its current occupant reference. Admission, transfer and discharge use atomic conditional commits, including bed occupancy, ward counters, visit/admission references, immutable movement events, audit and operation receipt. A competing allocation or stale edit fails without partially moving a patient.
- A visit keeps its original admission reference after discharge. Admission records are retained with final state, dates, original patient/visit references and the latest signed summary reference. Earlier assignments and summary versions remain available in date-selected history. No collection is purged or rewritten in bulk.
- The operation receipt deduplicates a retried request before workflow reads. A completed retry needs one document lookup and no writes. Fresh repeated clicks are also constrained by unique ward/bed codes, current revisions, one open admission and existing bed occupancy. Changed payloads cannot reuse a completed request ID.
- Bed readiness is a recorded staff confirmation; it does not represent an automatic assessment of clinical suitability, infection-control requirements or physical preparation.
- Signing and completion serialize against visit updates. Triage/consultation changes and new or changed orders during an active admission invalidate earlier discharge approval. Practitioner review of outstanding investigations and follow-up remains explicit; the software does not decide that a patient is medically fit for discharge.
- Backup discovery includes Wards, WardVersions, Beds, BedVersions, Admissions, OpenAdmissions, AdmissionEvents and DischargeSummaries. Existing clinical and financial collections are unchanged.

## Reads, writes and freshness

- Opening the workspace or switching to the inpatient tab does not load wards, beds or history. Ward loading is explicit; opening a ward queries only that branch/ward's first 31 beds and displays 30. Occupancy includes saved identity labels, avoiding a patient lookup per bed.
- Admission and movement/summary history requires dates. Queries include branch and, for history, the selected admission. Cursor ordering uses timestamp/code plus document ID, including equal timestamps. No full-history totals or scans are performed.
- Loaded pages are retained in a bounded in-memory cache. Refresh explicitly reloads; successful mutations invalidate related snapshots. Admission details use exact document reads. Branch/access/session changes clear records, form contents and print content. Unsaved form changes require a discard decision.
- Availability snapshots do not authorise allocation: the server reads and conditionally updates the current bed, admission and ward. No polling is added. Unchanged setup/summary saves create no receipt, audit or version writes. Clinical/order changes add a visit synchronization write only for an active inpatient encounter where it protects discharge approval.
- One access audit records each actual patient/occupancy/history request. Cached navigation does not issue another request or audit. Meaningful actions have their own audit entries; retries do not duplicate them.
- Index definitions are included in `firestore.hospital.indexes.json`. They have not been deployed in this test-and-push pass.

## Verification and remaining scope

`tests/hospital-inpatients.test.mjs` covers permissions, unique codes, no-op writes, replay and lost responses, competing admissions/beds, cross-branch duplicate prevention, atomic transfers/discharge, preparation, clinical approval invalidation, privacy, original financial/clinical record preservation, bounded date queries, equal-timestamp pagination and backup relationships. `scripts/verify-hospital-inpatients-ui.mjs` exercises the real service against synthetic fixtures in a browser, including role switching, unsaved changes, cache reuse, printing, expiry and phone layout. Existing Hospital browser and full repository regression suites are run as well.

H08 remains partial on the master checklist: inpatient nursing charts, medication administration records, broader handover workflows, post-discharge summary amendments, desktop/offline parity and practitioner validation remain future work. Cross-branch inpatient transfers and automatic recurring bed billing are not implemented here. The existing outpatient triage, signed clinical entries, orders and billing remain linked to the same visit. This increment is not a claim that the entire Hospital edition is complete or ready for live patient care.
