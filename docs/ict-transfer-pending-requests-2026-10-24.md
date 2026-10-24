# ICT transfers with pending subject requests

Web ICT can transfer a student to another class or arm while a subject-change or earlier transfer request is pending. This also applies to class/arm changes in Edit Student Profile. The pending request is superseded by the new transfer; its proposed subject changes are not approved or applied.

The original request is preserved in full in an append-only Movement history event. The resolution records the ICT user, reason, time, source membership and the transfer that superseded it. Earlier history entries remain unchanged. Pending requests on duplicate current memberships are resolved the same way when those copies are archived, leaving one active membership. Other students and academic periods are unaffected.

The transfer, profile update, request resolutions, duplicate archival and audit entries commit together with revision checks. Invalid destinations, concurrent edits or protected result states leave requests pending and save no partial transfer. Existing scores, attendance, payments and historical records are not rewritten. No additional collection reads were added.

This permission applies only to the server-authenticated web ICT actor. Desktop ICT and other roles retain their existing approval rules. Unrelated profile edits and subject-only changes do not supersede a request.

Validation: all 3,843 Node tests passed, including 54 focused subject-change/profile tests, and the Cloudflare Pages Functions worker compiled successfully. Coverage includes pending requests on duplicate memberships, both transfer entry points, stale revisions, concurrent profile/membership/result edits, protected results, access scope, request history and score preservation.

After deployment, refresh the web companion and retry the intended transfer. Review superseded requests under Academic Management → Student records → Movement history. No desktop installer or live student-data migration is needed for this change.
