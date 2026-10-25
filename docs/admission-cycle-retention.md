# Close admission cycle

Available in the web companion under **Applications → Close admission cycle / retention & history**, for school-wide Super Administrators. It applies across the school's branches and sections to one explicit academic session and term. It is not a school-wide reset.

## Workflow

1. Save a school retention policy: keep indefinitely (the default), or 0–36,500 days after closure. Zero does not run cleanup automatically.
2. Enter a session and term and preview. Applicants without an explicit valid term are excluded; do not infer their term from today's settings.
3. Type the displayed `CLOSE` confirmation. Closure stops new applications for the cycle, blocks new public form checkouts when that is the branch's current intake, and hides those applications from active admissions lists. Already initiated payments are still recorded if they settle later; closing never discards a payment. Nothing is deleted at closure. The retention policy is captured for this cycle; later policy changes affect future closures only.
4. After retention expires, preview again. Review the exact applicant references and fields. Type the displayed `CLEAN` confirmation to process a maximum of 20 applicants. Review subsequent batches separately.
5. Download the verified backups and keep them securely. History and backup downloads remain available by selecting the closed cycle.

## What cleanup removes and preserves

Cleanup deletes only the explicitly listed personal form fields from eligible live application documents, including residential, parent occupation, medical, background-question and previous-school details. It uses Firestore field masks: retained values are not rewritten or converted.

Application references, names, scores (including zero), answers, admission decisions, payment/receipt references, authentication links, uploaded document references and history, and unknown/custom fields remain in the original document at the same path. Student records, academic records, payments, receipts, invoices and ledgers are not touched. Existing uploaded files remain in their current storage; this feature frees eligible database fields, not all object storage.

Applicants with student links, enrollment/admission/offer indicators, assigned admission numbers, acceptance payments or retention holds are protected in full. Cleaned applications become read-only admission history. Existing documents and scores remain available through their original references.

## Backup and concurrency guarantees

Each cleanup batch creates a complete JSON snapshot of the original application documents (not just the removed fields), source paths, document IDs and revisions. It is written to the existing private R2 binding under a school-specific `private-admission-backups/` prefix, outside the live database and the generic document URL namespace. There is no public backup URL.

The server reads the saved object back, checks byte length and SHA-256, parses and checks its identity/count, and rechecks eligibility before writing. Failure prevents cleanup. Application revisions and the cycle revision are preconditions of the atomic cleanup/audit commit. A concurrent enrollment, edit or cleanup invalidates the affected batch; a fresh preview is required. The submission's cycle revision is committed atomically with application creation, so closing cannot race a previously approved submission.

Backup downloads require a current school-wide Super Administrator session and matching school and cycle; they are checksum-verified again. The browser cannot assert that a backup exists or supply deletion targets. No automatic cleanup job is installed.

## Recovery

The downloaded JSON contains `documents[].collectionPath`, `documentId`, `revision` and the original `data`. Recovery should be performed by support as a reviewed, revision-checked merge of the removed fields into those same documents, never by overwriting newer scores/history or importing the whole archive as current data. Keep the original backup and its SHA-256 receipt. No one-click bulk restore is provided by this feature.

Backups and existing uploaded documents are deliberately not expired by the applicant-detail retention setting. A separate backup-retention policy would need its own review; this feature must not delete its own recovery copy.
