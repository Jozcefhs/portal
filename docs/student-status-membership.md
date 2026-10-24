# Student status and academic membership

Status edits in the web student profile, desktop profile and Accounts share the
student writer. For an existing student, a changed status is saved in one atomic
commit with its active-period memberships, movement history and audit record.

- Active / Enrolled: restores a uniquely identified, previously status-managed
  placement in the profile's saved session and term. Never creates a membership
  or revives an archived/superseded copy. Missing placements still require allocation.
- On Leave / Suspended / Inactive: membership becomes Inactive; class, arm and
  subject selections remain available for reinstatement.
- Withdrawn / Expelled / Graduated / Transferred / Left School / Deceased:
  membership becomes Withdrawn and leaves active classroom lists/counts.

The student profile remains in Students and Accounts. Membership IDs, class/arm,
subject selections, scores (including zero), answers, payments, attendance and
historical movements are not deleted or rewritten. Closed/archived or ended terms
retain their historical rosters. Current classroom registers hide the memberships
paused or withdrawn by this feature; movement history retains the events.

Changes take effect on save. Effective dates may be today or earlier; future dates
are rejected because no future-status scheduler exists. Save class/arm transfers
separately from a status change. Inactive students cannot be allocated, transferred
or promoted into an active membership until returned to Active.

The profile revision fences concurrent allocations/transfers/promotions; membership,
period and reinstatement class/arm revisions are also checked. Failure is atomic,
not reported as success. Restoring ambiguous previous placements fails safely.
Scope is the exact school database, branch, section and admission/account reference.
The original profile document ID is retained, including legacy IDs.

This is not a bulk repair of pre-existing inactive profiles or a deletion workflow.
It does not revoke already downloaded offline CBT rosters or erase completed exams.
