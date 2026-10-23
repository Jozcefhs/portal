# Controlled changes to assessed subjects

Web: **Academic Management → Students / My students & subjects → Student subjects**.
Desktop: **Academic Management → Student memberships → Arm Subjects / Subject Changes**.

## Web companion ICT access

An authenticated ICT user with Academic Management access can transfer students
and apply assessed subject changes directly on the web, without another person's
approval. ICT can also approve, reject or cancel existing pending requests,
including its own. A specific reason, the actual ICT actor and before/after
selections remain recorded in the audit and movement history.

This exception is attached by the authenticated web endpoint, not by a client
flag. Desktop ICT and other roles retain the independent-review rules below.
School, branch, section, subscription, curriculum, capacity and revision checks
still apply. Original scores are never rewritten, moved or copied. Finalised
results must still be reopened through the existing result workflow; affected
drafts are flagged for recalculation in the same atomic commit as the change.
Deploying the update does not transfer any student or automatically apply pending
requests.

## Standard controlled workflow

- A classroom's assigned Form Teacher or an allocation manager can submit revised Core, Trade and Optional selections. Curriculum requirements still apply.
- After a transfer or curriculum change, outdated selections do not block their
  own correction. The server validates the proposed choices against the current
  classroom curriculum, while keeping the old choices for score-impact checks
  and movement history. The register flags unavailable/reclassified subjects;
  choose replacements and save. Existing selections stay active until a scored
  change is approved. Older clients that omit Core choices retain the saved Core
  choices rather than silently discarding obsolete ones.
- An unassessed change applies immediately. If an affected subject has a score record (including zero, absent, exempt or incomplete), or the student has a result in that term, the server requires a specific reason of 5–1000 characters and stores a pending request. The existing selections remain active.
- A different authorised academic administrator must approve or reject it, except for web ICT as described above. Approvers are Super Admin, Principal, Vice Principal Academics, Vice Principal Administration, Head Teacher, Assistant Head Teacher, Management and ICT, with Academic Management access in the correct branch and section. Admissions officers and teachers cannot approve. The requester may cancel their own request.
- The review shows the old/new subjects, affected score subjects, requester, reason and existing-result warning. Every decision also needs a reason. Request and decision history is retained in student movements, including both sets of subject selections and identities.
- Web subject-selection errors open a modal dialog as well as the inline status. Missing Core/Trade choices return focus to the affected student's selection. A separate confirmation explains when requests are awaiting approval rather than already applied.
- Approval never deletes, reassigns or copies marks. The original score documents remain attached to their original subjects. A newly selected subject needs its own assessments (existing valid scores for that same subject remain its own history).
- Reviewed, Approved, Published, Locked or Withdrawn results must first return to Calculated Draft through the existing controlled result lifecycle. Approval marks existing drafts as requiring recalculation. Such drafts cannot progress to review/publication until recalculated. Existing annual results are not automatically recalculated.
- A pending request must be resolved before transferring/withdrawing/changing that membership. Direct membership edits/imports cannot bypass the guard. A transfer may reset subject choices for the destination; assessed transfers become pending requests for independent approval. Destination subject choices can then be completed in Student subjects without deleting historical scores.
- Subject approval and manual/spreadsheet/CBT score writes use membership revision preconditions. A concurrent change fails without partially applying the batch; reload before retrying. Prepared CBT batches created before this update must be prepared again.

Requests use server-owned `PendingSubjectChange` / `LastSubjectChange` fields on the existing membership collection. Normal membership payloads cannot set these fields. Existing scores need no migration. Evidence queries are branch/session/term/student scoped and fail closed on errors or oversize responses. No production academic data is rewritten by deploying this feature.

Run `npm run test:academic-release`, including `tests/academic-subject-change.test.mjs`. Desktop regression: `python -m unittest tests.test_academic_management`.

Do not deploy an older backend that ignores pending subject changes while requests are awaiting review. Resolve the requests or freeze academic writes before an emergency code rollback.
