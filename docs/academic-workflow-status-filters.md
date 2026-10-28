# Academic review status filters

The web companion groups loaded academic records by status without moving or
deleting any Firestore documents. Filtering has no request, write or audit side
effect. Normal approval and publication actions retain their server-side
permissions, revision checks, history and parent-access rules.

## Subject review

In **Scorebook → Review and approval**, select the assessment test (for example,
CA1) or **Full-term sheets**, then a loaded classroom and status. Status buttons
show counts of subject sheets and distinct arms using the same selected test,
classroom and academic scope. An arm is counted once per matching status, even
when several subject sheets match. The same reusable arm in different classes
counts separately; sheets without an arm do not invent an extra classroom.
Mixed-status arms can appear in several status groups. These counts do not certify
that every subject in an arm is complete. The batch approval dialog uses the same
arm counts and also respects its search filter. All counts come from already-loaded
records, without additional database reads or writes. An approved
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
