# Dynamax v3.1.55

- Session Movement now updates the student profile and destination academic membership together. It retains previous-session scores, answers, attendance, payments and history, and safely recognises repeated requests without creating duplicate memberships or promotion history.
- Session Movement and the entrance-exam console keep their action buttons visible on smaller screens. The class score register shows readable class names without internal IDs.
- Entrance examinations support each school's configurable subjects, school-network sittings through the desktop CBT server, and remote sittings through the web companion. Access cards, timers, answer recovery, marking and verified result posting are included.
- Enrolled students can be explicitly registered for remote examinations, including separate Objective and Theory papers. Existing recorded marks remain protected.
- Close admission cycle adds school-specific retention, protected admission history and verified private backups before eligible application-field cleanup. Enrolled students, scores, payments and other records are preserved.
- Unchanged remote-exam polling avoids redundant status writes and throttles browser heartbeats.

Verification: 4,085 web tests and 1,061 desktop tests passed, with additional final window and class-selector checks. Browser checks covered admission-cycle controls and examination authoring, access cards, mobile layout, disconnect recovery, submission and result posting. The installer passes the packaged application self-test.

No live student movement, examination sitting, score posting or admission cleanup is performed by installing this release.

Guides: [Entrance and remote examinations](entrance-and-remote-exams.md), [Session Movement](session-movement.md).
