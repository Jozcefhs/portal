# Academic submission deadlines and surcharges

Implemented locally for the School edition (all branches, primary and secondary). Deployment and a desktop installer are separate release steps. No live deadline or fee is enabled by installing the code.

## Setup

Web: **Academic Management → Submission deadlines & surcharges**.

Desktop: **Academic Management → Deadlines / surcharges**.

Select the branch, school section, session and term first. Authorised academic reviewers can add rules, set the deadline and amount in NGN, and enable/disable the feature. Teachers can read the settings and see their own payment register; reviewers can see the selected scope's register. Changes are revision-checked and audited.

Supported records:

- CBT test-paper uploads (not completed CBT score synchronization).
- Subject teachers' weekly work submissions.
- Class teachers' compiled weekly diaries.
- Schemes of work (the existing Save scheme action is the submission boundary).
- Scorebooks transitioning from Draft to Submitted, not draft score entry.
- Attendance register posting, not local attendance drafts.

Rules may target a class, subject, diary week or CBT assessment-component ID. Blank means all. A more specific matching rule overrides a general one. Equally specific overlapping rules are rejected. Deadline inputs are explicitly WAT (UTC+01:00); the backend stores UTC and uses server time, not the staff device clock. Exactly at the deadline is still on time.

## Teacher payment and submission

After the deadline the submit control shows **Pay charges**. The server still validates authority, required content, record completeness and revisions before creating a pending submission. The pending record contains the validated snapshot and is not yet published. Opening checkout is an explicit teacher action; it uses the email on the staff login account and the school's configured Paystack secret.

Paystack checkout opens in the browser. The existing `/api/paystack-webhook` must be configured in that school's Paystack dashboard. A signed `charge.success` webhook triggers independent server verification and automatic submission, even when the desktop/browser is closed. The open checkout screen also polls and offers **Check payment / submission**, so a lost browser redirect does not lose the payment. The teacher can reopen the pending reference from the register; do not create a new payment after a timeout.

Only a successful verified transaction with the exact stored reference, amount, currency and test/live mode can submit. The receipt, academic record writes and consumed-payment status are one optimistic atomic commit. Duplicate webhooks/checks do not create duplicate submissions or receipts. Existing student payments, receipts, wallets, answers and scores are not repurposed for these staff charges. Surcharge receipts are stored separately in `academicSubmissionReceipts` and displayed in the submission register.

Payment submits the reserved version, not edits made after reservation, and does not grant academic approval. Concurrent work by another subject teacher is merged into the same weekly diary only if the paying teacher's subject entry is unchanged. Any incompatible record change or deactivated/unauthorised account produces **Paid — review required**; it does not overwrite newer records or report success. Management must reconcile that paid record before asking the teacher to submit again. Do not pay again for an unresolved paid reservation.

## Operational limits and verification

Pending snapshots are bounded to 500 KB and 497 writes; oversized submissions are rejected before checkout. The register is projected and paginated (100 records/page), excluding papers and stored write plans. Unpaid reserved CBT papers remain in storage so checkout can resume; no existing paper is deleted when payment is requested. Their cleanup is a separate, reviewed operation.

Academic Management remains an online workflow. The new controls do not require internet during students' exams, and no surcharge gate is placed on CBT result/credential synchronization.

Tests use synthetic records and mocked Paystack transactions, including duplicate delivery, wrong amount/reference/currency/mode, lost commit responses and concurrent diary work. A real Paystack test-mode checkout/webhook acceptance test is still required in the intended deployment before enabling real charges. Do not switch a live school's Paystack secret to test mode for this check; use an isolated test deployment.

Backend/web: `node --test tests/academic-*.test.mjs tests/desktop-*.test.mjs tests/paystack-*.test.mjs`.

Browser: `tests/academic-submissions-browser.mjs`, using `SUBMISSION_PLAYWRIGHT_MODULE` to point to an installed Playwright module. All network requests are intercepted.

Desktop: `python -m unittest tests.test_academic_submissions tests.test_academic_diary tests.test_academic_management` (or the repository's test PYTHONPATH).
