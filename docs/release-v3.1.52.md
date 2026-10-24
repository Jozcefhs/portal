# Dynamax Desktop v3.1.52

## Included in this release

- **Archived memberships:** web companion → Academic Management → Student records → Archived memberships. Desktop → Academic Management → Students → Archived memberships.
- The read-only register shows archived class entries alongside the linked membership's current class/arm, status, academic period and archive reason. Missing or ambiguous links are labelled as unverified rather than guessed.
- Archived duplicate memberships no longer appear in the desktop's current membership register.
- **Remove empty classrooms:** past transfers, scores, attendance, diaries and historical student memberships no longer prevent archival. Current students in open academic periods still protect an occupied classroom from removal.
- Desktop Classrooms includes **Remove Empty**. Classroom Delete requests from older clients also use safe archival, never permanent deletion.
- Transfers keep one current membership, preserve the student's records and retain historical audit context. Past links do not block removal of an empty classroom.
- Corrected the public installer fallback link and checked the archived-membership screen on mobile and desktop.

Scores, exam answers, attendance, payments and admission history are not deleted or rewritten by this update. It includes the previous CBT upload, student-status and profile-transfer repairs.
The unfinished admission-cycle cleanup and configurable entrance-subject work are not part of this release.

## Verification

- 3,832 web regression tests passed on the isolated release source.
- 1,028 desktop tests passed in 120 isolated test modules.
- Archived-membership browser checks passed for navigation, filtering, sorting, read-only behavior and compact desktop/mobile layouts.
- Packaged application self-test, TLS certificate bundle, CBT client build and bundled Android installer integrity checks passed.
- The published installer was downloaded back and verified: 42,642,614 bytes with the SHA-256 below.

## Updating both CBT servers

Back up each server and close Dynamax between examinations, then run `Dynamax_Setup_v3.1.52.exe` on each server. Confirm **v3.1.52** in the title bar after reopening. Do not delete tests or re-pull schedules just to install this update.

Installer SHA-256: `8f10e0a418e858bf21536f412c34fe384aaf2ccffe01c55bec0ce78c0c339154`
