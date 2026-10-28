# Hospital Owner's Demo

Review site: https://dynamax-hospital-review.pages.dev/admin.html

This is a separate Hospital workspace and Firestore project, not a school/faith/organisation tenant conversion. The profile uses **Owner Demo**, with an explicit synthetic-data notice. No existing organisation records or staff credentials were copied. The database has deletion protection enabled. Card-terminal payments remain disabled. No installer compilation or desktop release is included.

The owner account manages administration. Separate demo roles allow review of clinical, nursing, reception, pharmacy, laboratory, imaging, cashier and HMO workflows without giving Super Admin access to private clinical notes. Credentials are supplied privately in a local access file, never committed to this repository. Change the demo passwords through account settings if sharing access with staff.

Synthetic examples include three labelled patients and reception visits, a signed referral to North Clinic, a ward with two beds, a procedure room and a next-day appointment. Search surname **DEMO**, or use Reception visits for **28 October 2026**. The appointment is dated **29 October 2026**. For the receiving referral, sign in as the demo clinician, switch to North Clinic and load Incoming referrals for 28 October.

The web modules cover patient/NFC records, appointments, clinical encounters, prescriptions/investigations, pharmacy, billing, HMO/corporate payments and advances, inpatient beds/discharge, nursing, theatre and referrals. This is a working development demo; remaining specialist workflows, desktop/offline parity, direct insurer integrations and practitioner validation remain tracked in `hospital-edition-scope.md`.

The investigation update adds branch-based laboratory/imaging catalogues. From the owner's **Laboratory** or **Imaging** workspace, expand **Laboratory and imaging catalogue**, then **Load catalogue** or **New service**. The owner configures services without gaining access to clinical results. Doctors can choose these services when issuing an investigation; laboratory staff record collection, receipt and rejection with separate recollection labels. Catalogue and history loading is explicit, and existing orders keep their original instructions and workflow. See [hospital-orders-workflows.md](hospital-orders-workflows.md).

## Deployment isolation

`deploy/hospital-owner-demo.json` identifies the sole destination. It is deliberately separate from the organisation deployment registry, so routine DCA/faith deployments do not include this demo. Deploy from `codex/hospital-edition` after tests. Publish the ordinary web assets/functions to the named Pages project with production branch `main`, and apply `firebase.hospital.json` only to the named Firebase project. Never deploy this development branch to DCA or other active edition projects.

Deployment secrets are project-specific. Runtime database access uses a dedicated service account limited to this project's datastore user role. Demo sign-in accounts have newly generated passwords. Public access does not bypass staff authentication. No payment-provider or notification-provider credentials are configured for the demo.

Standalone Owner Demo profiles receive the edition's implemented module entitlements when no explicit entitlement list exists. Explicit disabled-module preferences and clinical role boundaries still apply. The demo uses `CANONICAL_API_PROXY_SCOPE=public-catalog` for credential-free GET access to the central public plan catalogue only. It is not enrolled in the paid subscription bridge, and this scope cannot proxy platform mutations.

## Verified deployment — 28 October 2026

The isolated Owner's Demo is deployed with Hospital indexes and separate document storage. Live checks confirmed Hospital/workspace identity, public catalogue availability, all nine role sign-ins, owner/clinical permission separation, three example visits and the signed referral. Unauthenticated Hospital requests return HTTP 401. Eleven Hospital assets and fifteen shared web assets matched the source. The final regression suite passed 4,503 tests; all eleven synthetic Hospital browser workflows and the pushed Hospital CI passed. No desktop application or installer was compiled or released.
