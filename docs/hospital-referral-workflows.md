# Hospital referrals and care transfers

Implemented for the Hospital web companion. Clinical referrals use the existing consultation permission: Doctors and Medical Directors can prepare, sign and review them. Administrative and financial roles do not gain access to clinical letters.

## Working flow

1. Reception visits → choose dates → **Refer patient** on an active visit.
2. Choose an internal branch/clinician/department or an external facility. Enter the reason, approved clinical summary, urgency and follow-up instructions. Review the patient identity and allergy snapshot before signing.
3. Referrals and care transfers → choose dates and Incoming/Outgoing → open the signed referral. Print the letter when needed; no email or other external message is sent automatically.
4. Only the named receiving clinician can acknowledge an internal referral. They explicitly confirm receiving care. Acceptance shares the patient registration with that branch and opens one receiving visit, or explicitly links the existing open visit displayed on screen.
5. For an external referral, the source clinician records actual acknowledgement, who acknowledged it and when. This does not create a receiving visit in the hospital database.
6. Record completion/outcome after acknowledgement. A pending referral can be declined by its recipient or cancelled by its source branch. Events preserve the signed original content. Linked receiving visits support follow-up appointments.

Care transfer does not move an inpatient bed, discharge the original visit, rewrite prior consultations, create a new patient identity or post charges. Those remain explicit workflows. The receiving branch initially sees only the approved referral snapshot; source-branch private drafts and unrelated history are not copied. Cross-organisation electronic sharing and attachments are not implemented.

## Integrity and data use

- An exact visit/destination/clinician guard prevents another open referral to the same destination. Request receipts protect lost responses/retries; current revisions and atomic preconditions protect concurrent signing, acceptance, cancellation and patient/visit changes.
- Signing validates the reviewed visit and allergy revisions. Signed summary fields stay unchanged through all workflow states. Changing a signed pending referral requires cancellation with a reason and signing a replacement.
- An invalid receiving open-visit reference blocks acceptance for review. Acceptance never silently replaces a missing or closed visit.
- Registers require a date range of at most 93 days, fetch 31/display 30, and carry saved names without per-row patient lookups. Incoming queries include the designated recipient. Registers/history use bounded in-memory page caches; Refresh and mutations handle freshness. Session/branch changes clear private state.
- Signing uses five exact reads, one clinician lookup limited to two records, and seven atomic writes in the tested new-referral path. Acceptance with a new receiving visit uses four exact reads and seven writes. Completed retries require one receipt read and zero writes. These are synthetic application-operation budgets, not measured cloud bills.
- Referral collections are included in backup discovery and have scoped index definitions. Existing patient, clinical, financial and NFC records are preserved.

Evidence: `tests/hospital-referrals.test.mjs` and `scripts/verify-hospital-referrals-ui.mjs`, covering permissions, branch boundaries, explicit sharing, duplicate prevention, races, retries, clinical snapshots, printing, caching, follow-up and phone layouts.
