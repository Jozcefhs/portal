# Resolve competing classroom marks

Academic Management → Classroom score register → load a classroom. Authorised score-correction officers can click **Resolve duplicate** in a conflicting test cell. Teachers with read-only classroom access continue to see the conflict without a correction button.

The dialog shows each saved mark, its classroom, creation/update dates, officer and source. Nothing is selected automatically. Choose the verified mark, enter a reason, then save. The classroom refresh keeps the selected test, subjects and filters.

Keeping the current mark preserves its reviews and published results. Changing it requires a Draft full-term sheet and no published/locked result for that student. The changed student must follow normal review and result recalculation; classmates keep their valid approvals. No result is published by this action.

The original versions and decision are retained in Academic Audit Log. Neither score records nor student records are deleted or archived. New or changed competing source marks cause a fresh conflict instead of silently reusing an old decision. Identical retries return the original receipt without another write.

This resolves competing marks with one current membership and one current-classroom score record. Ambiguous memberships, duplicate current-classroom records, missing matching sheets or incompatible assessment scales require their structural correction first; the dialog explains the issue and makes no change.

Reads are limited to the selected student's subject and academic period. Peers in the affected sheet are read only when a mark changes, to preserve valid reviews. Preview is live and does not write an audit event. Save atomically checks record versions and matching query sets, including new results or competing marks, before applying the correction and audit receipt.
