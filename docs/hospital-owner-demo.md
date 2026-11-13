# Hospital Owner's Demo

Review site: https://dynamax-hospital-review.pages.dev/admin.html

This is a separate Hospital workspace and Firestore project, not a school/faith/organisation tenant conversion. The profile uses **Owner Demo**, with an explicit synthetic-data notice. No existing organisation records or staff credentials were copied. The database has deletion protection enabled. Card-terminal payments remain disabled. No installer compilation or desktop release is included.

The owner account manages administration. Separate demo roles allow review of clinical, nursing, reception, pharmacy, laboratory, imaging, cashier and HMO workflows without giving Super Admin access to private clinical notes. Credentials are supplied privately in a local access file, never committed to this repository. Change the demo passwords through account settings if sharing access with staff.

Synthetic examples include three labelled patients and reception visits, a signed referral to North Clinic, a ward with two beds, a procedure room and a next-day appointment. Search surname **DEMO**, or use Reception visits for **28 October 2026**. The appointment is dated **29 October 2026**. For the receiving referral, sign in as the demo clinician, switch to North Clinic and load Incoming referrals for 28 October.

The web modules cover patient/NFC records, appointments, clinical encounters, prescriptions/investigations, pharmacy, billing, HMO/corporate payments and advances, inpatient beds/discharge, nursing, theatre and referrals. This is a working development demo; remaining specialist workflows, desktop/offline parity, direct insurer integrations and practitioner validation remain tracked in `hospital-edition-scope.md`.

The investigation update adds branch-based laboratory/imaging catalogues. From the owner's **Laboratory** or **Imaging** workspace, expand **Laboratory and imaging catalogue**, then **Load catalogue** or **New service**. The owner configures services without gaining access to clinical results. Doctors can choose these services when issuing an investigation; laboratory staff record collection, receipt and rejection with separate recollection labels. Catalogue and history loading is explicit, and existing orders keep their original instructions and workflow. See [hospital-orders-workflows.md](hospital-orders-workflows.md).

The medicine update adds **Pharmacy → Medicine catalogue**. The owner can create medicine definitions, edit handling/storage notes and availability, and inspect dated versions. Doctors choose these definitions while prescribing; pharmacists use them for stock receipts and batch searches. This does not grant the owner access to prescriptions or dispensing. Catalogue selection never supplies a patient's dose or treatment directions. Existing prescriptions, stock movements and financial records are retained.

## Deployment isolation

### Discharge summary amendments

Open [Wards and admissions](https://dynamax-hospital-review.pages.dev/hospital.html?task=inpatients) using the demo clinician account. Load admissions for the relevant admission dates, open a discharged admission and choose **Amend discharge summary**. Enter the correction and reason, verify the patient and clinical review, then sign. Nurses can preview/print the latest summary and earlier versions under **Admission history → Signed summaries**. The owner retains administrative access without gaining clinical editing or summary-reading rights.

All earlier signed versions, completed visits, original departure dates, bed assignments and billing records are preserved. A correction cannot reopen a bed or create a charge. Live verification does not create discharge/amendment examples automatically; complete workflow testing uses synthetic in-memory records. See [the inpatient guide](hospital-inpatient-workflows.md).

### Supplier payment remittances

Deployed and verified on 30 October 2026: [Hospital demo](https://dynamax-hospital-review.pages.dev/hospital.html?task=procurement), [verification](hospital-remittances-verification.md).

In **Pharmacy procurement**, the owner can inspect **Bills**, **Payments** and **Remittances** for a chosen date range. Use the separate demo cashier to select approved invoices from **Bills → Pay selected supplier invoices**. One confirmed payment can cover up to 20 invoices for one supplier. Each allocation remains traceable, and the remittance has preview/print and reversal history. No example payments are automatically posted to the demo; end-to-end payment checks use synthetic in-memory records. Card terminals remain disabled.

### Deployment target

`deploy/hospital-owner-demo.json` identifies the sole destination. It is deliberately separate from the organisation deployment registry, so routine DCA/faith deployments do not include this demo. Deploy from `codex/hospital-edition` after tests. Publish the ordinary web assets/functions to the named Pages project with production branch `main`, and apply `firebase.hospital.json` only to the named Firebase project. Never deploy this development branch to DCA or other active edition projects.

Deployment secrets are project-specific. Runtime database access uses a dedicated service account limited to this project's datastore user role. Demo sign-in accounts have newly generated passwords. Public access does not bypass staff authentication. No payment-provider or notification-provider credentials are configured for the demo.

Standalone Owner Demo profiles receive the edition's implemented module entitlements when no explicit entitlement list exists. Explicit disabled-module preferences and clinical role boundaries still apply. The demo uses `CANONICAL_API_PROXY_SCOPE=public-catalog` for credential-free GET access to the central public plan catalogue only. It is not enrolled in the paid subscription bridge, and this scope cannot proxy platform mutations.

## Initial verified deployment — 28 October 2026

The isolated Owner's Demo is deployed with Hospital indexes and separate document storage. Live checks confirmed Hospital/workspace identity, public catalogue availability, all nine role sign-ins, owner/clinical permission separation, three example visits and the signed referral. Unauthenticated Hospital requests return HTTP 401. Eleven Hospital assets and fifteen shared web assets matched the source. The final regression suite passed 4,503 tests; all eleven synthetic Hospital browser workflows and the pushed Hospital CI passed. No desktop application or installer was compiled or released.

## Investigation update verification — 28 October 2026

Web commit `b8c848a9` is deployed to this demo, including investigation catalogues and specimen receipt/recollection. All three additional indexes are READY. The full regression suite passed 4,646 tests, all eleven synthetic Hospital browser workflows passed, and GitHub checks passed. Live checks confirmed all nine demo roles can sign in, owner/doctor/laboratory/imaging catalogue access works, repeated catalogue loads reuse the loaded page, and unauthenticated access remains blocked. Eleven Hospital assets and nineteen shared assets match the tested source. The three existing example visits and signed referral remain available; no patient, clinical, stock or financial records were changed by the deployment verification. No desktop application or installer was compiled or released.

## Medicine catalogue verification — 29 October 2026

Web commit `ca7327c2` is deployed to the isolated demo. All three medicine indexes are READY. The full top-level suite passed 4,558 tests, all eleven synthetic Hospital browser workflows passed, and Hospital CI succeeded. Twelve deployed Hospital assets match the tested source. Live checks confirmed all nine demo role sign-ins, catalogue configuration/read boundaries, date-selected version history, no catalogue request on workspace entry and cached repeated loads. The demo clinician account is a Medical Director; the Nurse demonstrates catalogue viewing without edit permission. Unauthenticated access remains blocked.

Open **Pharmacy → Medicine catalogue → Load medicines**, or [open the catalogue directly](https://dynamax-hospital-review.pages.dev/hospital.html?task=pharmacy). One explicitly synthetic entry, **DEMO training medicine**, was added for review. No prescriptions, stock receipts, payments or clinical entries were created from it. The three original example visits and signed referral remain available. No desktop application or installer was compiled or released.


### Pharmacy procurement and supplier billing

The Hospital workspace now includes **Pharmacy procurement**, also reachable at `/hospital.html?task=procurement`. Suppliers, purchase approvals, partial stock receiving and supplier invoices have separate role-controlled steps. The owner can configure suppliers, review/approve purchases and bills, and review corrections; pharmacists receive stock; cashiers record confirmed supplier payments. Existing clinical permissions are unchanged.

Use the supplier directory or choose a register and dates before loading. Open a purchase/bill for its workflow and preview/print. Supplier invoices require the two new optional billing mappings (Pharmacy purchases expense and Pharmacy supplier payable liability) before posting. No actual payments are initiated. See [the workflow guide](hospital-pharmacy-procurement.md) for the safeguards and remaining pharmacy scope.

Local verification for this increment: 4,583 repository tests passed, including 25 procurement cases; all 12 Hospital browser workflows passed. All 17 new Firestore indexes are READY before the web deployment.

Deployment verified: source commit `d24fc828f913f5d9b20bf127601b90d0e143e520` is live at https://dynamax-hospital-review.pages.dev (deployment https://007ea998.dynamax-hospital-review.pages.dev). Hospital CI run `40845929075` passed. Six deployed web assets match source; unauthenticated Hospital access returns 401; all nine demo roles passed their expected procurement/financial access checks. Owner desktop/phone views, document preview and cached repeat loads passed. A bounded before/after comparison confirmed the three existing demo visits and the unchanged invoice register. Only a clearly labelled synthetic supplier and purchase draft were added; no stock, patient charge, supplier invoice or payment was created. Live evidence is retained locally in `tmp/hospital-procurement-live/verification.json` and its screenshots. No desktop compilation or installer release occurred.

### Pharmacy stock control

Use [Pharmacy stock control](https://dynamax-hospital-review.pages.dev/hospital.html?task=stock-control) to inspect batches by expiry dates and counts by recorded dates/status. The demo pharmacist records physical quantities and evidence for an existing batch; the owner reviews and approves/rejects them. The counter cannot approve their own count, and changed stock requires a new count. Preview/print uses the loaded snapshot. No live demo stock adjustments are automatically posted. See [the workflow guide](hospital-stock-control.md).

### Quarantined stock disposal

Open [Quarantined stock disposal](https://dynamax-hospital-review.pages.dev/hospital.html?task=stock-disposal). The pending queue loads when this task opens; the completed register waits for dates. The pharmacist records batch-specific physical disposal evidence, and another authorised officer confirms witnessing it. Only confirmed disposal reduces quarantined stock. Shelf stock, patient returns and all financial records remain unchanged. Preview/print and retained decision history are available. No example disposals are posted automatically; full lifecycle checks use synthetic in-memory stock. See [the workflow guide](hospital-stock-disposal.md).

Deployed and verified on 4 November 2026: source `8ce4629c`, deployment `41f8dffa`. All 4,738 repository tests and 14 Hospital browser workflows passed. All three additive indexes are READY. Live checks confirmed permissions, bounded/cached loading, preview/print, desktop/phone layouts, matching deployed assets and unchanged sampled records, with zero business mutations. No desktop build or installer release occurred. See [the verification record](hospital-stock-disposal-verification.md).


### Recovery handover acknowledgement

Open [Theatre and procedures](https://dynamax-hospital-review.pages.dev/hospital.html?task=theatre). The clinical demo accounts can view **My recovery handovers** and load their named pending handovers. Complete recovery with a different receiving officer's staff username; that recipient can acknowledge or request clarification. Authors/Medical Directors can correct or redirect the handover. Each version and response remains in dated history with preview/print. The owner retains room configuration without access to private clinical records.

Local verification passed 4,746 automated tests and theatre/inpatient/nursing browser workflows with synthetic data. Live deployment verification is recorded below after the additive index and web update. The feature creates no automatic example clinical records, stock movements or financial entries. No desktop compilation or installer release.


Deployed and verified on 13 November 2026: source `d3580827565b63f51a44e58e24306df698f544af`, deployment [570b5499](https://570b5499.dynamax-hospital-review.pages.dev). The additive recipient/pending index is READY. Eight deployed assets match the tested commit. Owner, Medical Director and Nurse demo sign-ins passed; clinical recipients can load their queue, while owner-only administrative access and unauthenticated requests cannot read it. Required-note validation rejects incomplete responses before any mutation. Workspace entry requests state only; two explicit pending-list loads issue one queue request. Desktop and 390-pixel phone checks passed without browser errors. Bounded before/after checks found the three original sample visits unchanged. Live verification performed no clinical, stock or financial mutations and sent no emails; ordinary sign-in sessions and clinical-read audit entries are expected. Local mutation tests used synthetic in-memory records. No desktop compilation or installer release. See [verification evidence](hospital-recovery-handovers-verification.md).

### Appointment waitlist

Open [Appointments](https://dynamax-hospital-review.pages.dev/hospital.html?task=appointments), then **Appointment waitlist**. Waiting requests use a bounded current queue; Booked/Cancelled requests and request history require dates. Find a patient under **Patients and NFC cards → Book appointment → Add to waitlist** to create a request. Open it to adjust preferences, book a suitable clinic, cancel or preview/print. Reception and authorised appointment users can make changes; read-only users can view permitted requests.

The workflow preserves patient identities and earlier snapshots, rejects duplicate active requests, and converts a waiting request and its appointment atomically. Full synthetic lifecycle/browser tests passed; no example bookings or clinical/financial records are added automatically. See [the appointment guide](hospital-appointments-workflows.md). Live deployment verification is recorded below after deployment. No desktop compilation or installer release is included.
