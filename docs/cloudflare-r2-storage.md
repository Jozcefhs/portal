# Cloudflare R2 document storage

## Live architecture

Firestore remains the system of record. Cloudflare R2 stores private binary
files that do not belong in Firestore documents, including:

- parent admission uploads;
- generated admission documents;
- finance receipts and attachments;
- staff-protected admission documents and passport originals;
- optional online CBT question papers that teachers later pull onto the local
  offline CBT server.

The local CBT examination server remains LAN-only. Student questions, answers
and exam traffic do not use R2; only a teacher's optional online package and
the later approved score synchronization cross the Internet.

## Isolation model

Every Cloudflare Pages project has its own R2 bucket, bound to Pages Functions
as `DYNAMAX_DOCUMENTS`. Object keys are also namespaced as:

```text
v1/<edition>/<workspace>/<category>/<branch>/<school-section>/<owner>/<type>/<operation>.<extension>
```

The application stores an opaque `r2://dynamax-documents/...` reference in
Firestore. Browsers and desktop clients never receive an R2 credential or a
public bucket URL. Authenticated API endpoints verify the current deployment,
record scope and staff/parent permission before streaming an object.

## Deployment

The organisation, tenant-pool and new-project provisioning workflows call:

```text
node scripts/ensure-r2-storage.mjs --project <cloudflare-pages-project>
```

This creates `<cloudflare-pages-project>-documents` when absent and binds it to
both production and preview. The Cloudflare API token used by GitHub Actions
must have Pages Write and Workers R2 Storage Write permissions for the account.

The same code supports School, Religious Organisation and Other Organisation
editions. Dedicated projects/buckets prevent one subscriber's object namespace
from becoming another subscriber's availability or security boundary.

## Legacy Drive records

Google Apps Script and Google Drive are not runtime fallbacks. A stored
`drive.google.com` reference produces `LEGACY_DOCUMENT_NOT_MIGRATED` rather
than contacting the retired transport. Keep the previous Drive data available
only until verified copies have been imported into the correct R2 bucket and
their Firestore references updated. Do not delete the old files before that
verification.

## Operational checks

After a deployment:

1. Open Settings and confirm **Cloudflare R2 — Connected by deployment**.
2. Upload and view one test document through its normal authenticated flow.
3. Confirm the object appears in the expected project's bucket and under the
   expected edition/workspace prefix.
4. Delete the test document through the application and confirm both the R2
   object and Firestore metadata are removed.
5. Repeat for each independently deployed edition/project.
