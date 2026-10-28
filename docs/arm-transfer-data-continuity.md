# Same-class arm transfers

A transfer between arms of the same class and academic term updates the existing active membership. The student's saved Core, Trade and Optional selections are retained, including when an older desktop client requests a subject reset. The destination arm determines the classroom department but does not replace the student's saved subjects.

The transfer moves current-term score records, results and attendance to the destination in the same atomic commit as the membership and student profile. Score, result and attendance IDs stay unchanged. Published results retain their status, marks, publication date and parent reference. Their original assessed arm is retained alongside the saved result snapshot; positions are not silently recalculated. Subsequent draft recalculation reuses the retained result ID.

Scores join the destination's subject sheets. Existing assessment definitions are reused when creating a missing destination sheet. Different layouts use the existing lossless layout migration checks; the exact original score records are retained in the movement audit. A layout that would discard recorded components or a conflicting destination record stops the entire transfer without partial changes.

Prior approvals follow unchanged individual marks without approving destination classmates. Carried approvals become invalid if marks or their assessment revision change, or the destination sheet is reopened. Existing source and destination component reviews remain valid for unchanged classmates. A transferred unreviewed score remains pending in an already approved destination sheet.

The transfer does not create an archived student. Pre-existing duplicate current membership documents, if present, become inactive aliases linked to the retained membership; they are excluded from current and archived classroom registers. Their original fields and references remain in storage. Existing historical archives are not deleted or automatically restored.

Approval permissions, branch isolation, term validity and capacity checks still apply. Pending, rejected and cancelled transfers leave the current placement and data unchanged. Concurrent marks, attendance and result calculations use the membership revision, so an old form cannot write new records back into the former arm after a transfer. Retrying cannot create a second membership or duplicate movement.

Reads are restricted to the student's selected period and the affected subject sheets. There are no whole-school history scans. No previous session, financial entry, CBT attempt or unrelated student's marks are rewritten. Class changes and new-session promotion retain their separate existing workflows.

Validation includes same-class transfers in nursery, primary, junior and senior secondary; profile and independently approved transfers; unchanged marks and parent links; destination conflicts; assessment migration; approval retention; concurrent edits; scoped reads; and retry protection. No live student was moved as part of these tests.
