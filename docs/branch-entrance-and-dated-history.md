# Branch entrance subjects and explicit history periods

## Entrance exams

In Settings, select **Branch settings**, choose the branch and edit **Entrance-exam subjects**. Each line is `Subject name | maximum mark`. Save separately for each branch. The organisation-wide field is read-only; unconfigured branches inherit the previous definitions until configured. Explicitly saving the same subjects still creates an independent branch choice.

Exam creation, result posting and desktop application refresh use the applicant/exam branch. This release performs no migration of saved exam answers, marks or applicant results.

## Web history loading

Security Audit opens its date controls without querying audit history. Load audit log and Refresh require valid From/To dates. Loading retains the controls, supports stopping further batches, and reuses completed snapshots on return. Changing staff session or branch discards the previous scope.

The shared date control covers form purchases, finance requests/imprest, My Payroll, donations, offerings, service attendance, member/department history, fund audit, Human Resources history, hotel history and store orders in the editions where those modules are enabled. Income Analytics and External Audit also wait for a selected period. Current catalogues, people and room registers remain available without a history query. Already bounded/paged operational screens retain their existing navigation.

Date predicates run in Firestore, not only in the browser. Invalid dates and query errors never fall back to a full collection scan. Selected periods are bounded to 10,000 history rows; exceeding the query limit reports an error and requires a shorter period, rather than presenting incomplete totals. Periods use each record's stored date field. Payroll selects whole months and reads only the signed-in person's year-to-date items and their referenced runs. Hotel balances include every charge/payment linked to the selected reservations, including transactions outside the reservation creation period.

No payment, revenue, student, score, membership or audit records are deleted or rewritten by this change. There is no data migration. Older desktop/internal history callers keep their existing contracts; the new date controls are in the web companion. Desktop receives branch-specific entrance definitions through its existing backend refresh.

## Validation and deployment

Unit/regression coverage includes branch isolation, legacy inheritance, saved-result preservation, zero history reads before date selection, malformed ranges, bounded queries, branch restrictions, request/cache scope, hotel balances and private payroll year-to-date totals. Isolated Edge checks exercise the production date toolbar and audit renderer at 390px and 1366px, including stop/retry and cached return; no live records are used.

All edition index manifests add the required branch/date and username/month composites without removing existing definitions. Deploy indexes before the web code and verify readiness. The service-worker shell version includes the new history-control script.
