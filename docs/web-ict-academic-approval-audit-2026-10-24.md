# Web ICT academic approval audit

The authenticated web ICT account can complete Academic Management operations without requiring a second staff member's approval. The desktop and other roles retain their existing approval rules. The web authority comes from the staff session's server-side marker, never from request JSON.

Remaining approval blocks repaired:

- Subject editing now accepts pending-request rows in the web form and applies ICT's revised choices directly, retaining the original request in Movement history as superseded.
- Initial arm allocation can complete an assessed student's placement without sending ICT to a separate approval process.
- Subject-only membership changes, withdrawal and reinstatement can supersede outdated pending requests in the same save.
- Approving a transfer can archive duplicate memberships even when those copies have pending requests. The selected transfer remains Approved; only obsolete duplicate requests become Superseded.
- Reconciling a stale student profile with its already-correct membership no longer requires ICT to cancel that membership's pending request. It keeps that current request and records resolutions for any retired duplicates separately.

Audited permissions already available to ICT include attendance correction and review, timetable approval/publication, score submission/approval/locking/reopening, term and cumulative result review/publication, promotion decisions, transcripts, teaching diary entry/compilation/approval/return, deadlines and financial clearance within the configured academic policy. These workflows do not require a different approving user. Their deliberate status transitions remain available to the same ICT user.

Every changed request is preserved in full with actor, reason, time and a link to the replacing movement. Membership/profile updates, duplicate archival and request-resolution history commit atomically with revision checks. No existing marks, attendance entries, payments or old history are rewritten by this repair. Unchanged subject choices leave the current pending request intact. Initial-allocation impact checks use scoped student queries; no broad collection scan was added.

Data protection remains enforced: school/branch/section scope, active periods, valid destinations and curriculum, complete scores before submission, existing-score protection, published-result snapshots and stale-write checks. ICT can use the existing controlled reopen/withdraw actions themselves; the permission change does not automatically unpublish or rewrite results. School deadline/payment rules remain unchanged. Organisation setup permissions are outside this Academic Management approval change.

Validation: all 3,853 Node tests passed, including 75 focused request, membership, profile and web-ICT tests. The new web subject controls are exercised for both ICT and ordinary users. Tests cover atomic failure under concurrent edits, original request snapshots, unchanged marks, duplicate archival and preservation of the retained membership's pending request. The production Pages Functions worker compiled successfully.
