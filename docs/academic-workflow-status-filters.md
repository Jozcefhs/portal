# Academic review status filters

The web companion groups loaded academic records by status without moving or
deleting any Firestore documents. Filtering has no request, write or audit side
effect. Normal approval and publication actions retain their server-side
permissions, revision checks, history and parent-access rules.

## Subject review

In **Scorebook → Review and approval**, select the assessment test (for example,
CA1) or **Full-term sheets**, then a loaded classroom and status. Status buttons
show subject-sheet counts for the loaded class/classroom. **Load branch-wide arm
counts** adds distinct arm counts across every class in the selected branch,
school section, session and term. The class/classroom selector and batch search
do not narrow these branch totals; the selected test and status do.

An arm with saved subject sheets is counted once per matching status, even when
several subjects match. The same reusable arm in different classes counts
separately. Arms with no saved sheets are not represented, and missing arm IDs
do not invent an extra classroom. Mixed-status arms can appear in several groups;
these counts do not certify that every subject in an arm is complete.

The explicit load checks reviewer permissions and the selected period, then pages
through projected sheet metadata for that branch and term. It does not fetch
student marks, rosters or history, and creates no database writes or successful
load audit entries. The in-memory snapshot survives class/filter changes and
incorporates newer local approvals. **Refresh branch-wide arm counts** requests
new statuses from other officers. Branch/section/period/account changes clear the
snapshot. Unloaded or failed counts display a dash, never a misleading zero.
Filtering itself makes no additional requests. An approved
test does not imply full-term approval. Locked sheets belong to Approved;
changed/reopened test reviews belong to Draft. Fresh review checks override older
saved badges. Partial approvals retain their pending-student annotation.

## Result publication

In **Results → Review and publish**, choose the classroom, report type and status.
**Submitted / reviewed** corresponds to the saved Reviewed stage. Published also
includes Locked results. Missing assessments or required recalculation appear in
Pending and do not block other students. Counts describe loaded student results
in the chosen scope; they do not certify that a whole class is complete.

Individual-test and batch dialogs use the same colours, filters and counts.
When an approval/publication succeeds, the item leaves the previous status view.
Changing a batch filter drops selections that are no longer visible or eligible.
Completed stages cannot be selected again for the same batch action. An explicit
refresh is still required to see changes made by other officers.

## Verification

- Pure status tests cover fresh/stale reviews, full-term versus test approval,
  pending students, exclusive counts, locked states and escaped labels.
- Browser checks exercise the actual workflow bindings and batch dialogs,
  immediate status changes, retained filters, classroom/report scope, no filter
  requests, duplicate-click protection and desktop/mobile layouts.
- Existing academic review, partial-results, parent access and release-freshness
  regression tests remain applicable. No production records are modified by tests.
