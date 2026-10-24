# Firestore read-cost review — 24 October 2026

## Evidence

Read-only Google Cloud Monitoring queries for `school-management-suite-27064` showed 21,991,828 QUERY document reads, 51,400 LOOKUP reads and 32,934 NOT_FOUND reads in the 24-hour alignment window ending 2026-10-24 14:12 UTC. Query reads account for approximately 99.6% of these reads. This window differs from the screenshot's calendar-day counter.

Low-cost Firestore aggregation queries returned 12,633 student score documents, 601 score sheets, 1,121 upload receipts, 1,164 memberships and 1,030 teacher allocations for the main branch. These diagnostics did not download student records or change any data.

The deployed code loaded all branch student scores when opening the web scorebook, before separately fetching the selected sheet. Subject requests fetched the entire grade's scores and filtered subject/session/term locally. Class reports also fetched unused upload histories, staff profiles and summary records. These are confirmed sources of avoidable reads; the aggregate monitoring metrics do not identify each request or apportion the whole invoice to a particular feature.

## Repair

- The web scorebook requests its marks on demand. Existing desktop clients retain their original response contract.
- Score queries apply class, subject, session and term constraints at Firestore. Arm is intentionally excluded so earlier-arm marks still prevent duplicate uploads.
- Selected-class membership and teacher-allocation reads use the selected class and period. Form teachers and subject-choice arrays remain supported.
- Opening a selected sheet does not fetch import/upload history. The all-arm class report still fetches all required marks, but omits unrelated history, staff, assessment-policy and summary reads.
- No scores, answers, memberships, payments or audit records are deleted or rewritten by this repair. Verification after uploads remains in place. No periodic background queries or extra Firestore writes were added.

Google's read-only Query Explain confirmed the narrower equality queries use existing merged indexes; no index migration is required. A regression fixture reduces a representative subject's score reads from 3,000 grade marks to 150 relevant marks, while retaining prior-arm duplicate evidence and zero marks. This is a query-level example, not a promised percentage reduction in the monthly bill.

## Remaining cost considerations

Opening students/academic workspaces still requires roster records. Notification checks are bounded and the desktop CBT console's ten-second refresh reads its local SQLite store. Summary counts for ordinary academic workspaces still read projected documents, which remain billable; those counts are not used by the class report after this repair. Financial posting, security audits and saved-score confirmation must remain accurate.

Compare subsequent complete days in Cloud Monitoring against comparable school activity. Historical charges will not decrease, and savings cannot be measured until the deployed repair is used. Firestore document reads, index-entry reads, storage and network charges are separate; the billing chart alone cannot establish the exact contribution of each.

References: [Firestore billing](https://firebase.google.com/docs/firestore/pricing), [aggregation queries](https://firebase.google.com/docs/firestore/query-data/aggregation-queries).
