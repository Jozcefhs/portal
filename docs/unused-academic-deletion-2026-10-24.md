# Unused academic catalogue deletion

Delete now removes an unused catalogue document permanently. Classrooms no longer silently archive when Delete is selected. Bulk removal from classroom setup uses the same permanent deletion path. An empty class can remove its empty classroom children atomically.

Only current use blocks catalogue deletion. Archived, superseded, transferred, exited and closed-period references and movement history do not block it. Current classroom students and active profiles without a membership still prevent deletion; stale profile labels do not override a confirmed transfer. Subjects still configured in current curricula, allocations, memberships, tests or timetables must first be removed from those current uses.

Each removed definition and its original revision are copied into the deletion audit entry in the same atomic commit. Scores, answers, attendance, diaries, payments, memberships and movement history are never deleted or rewritten by this operation. Branch permissions and revision checks remain enforced. No production records were deleted as part of this rollout.

Validation: 3,874 Node tests passed, including permanent deletion, closed-period history, empty-classroom occupancy, stale revisions, current-use checks and history preservation. Cloudflare Pages worker build passed.
