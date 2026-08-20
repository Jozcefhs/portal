# Dynamax Project Handoff

Last updated: 2026-08-17

This is the starting point for continuing the project from another Codex
account, computer or task. Read this file together with
`docs/academic-management-phase.md`; that document remains the authoritative
academic product and engineering specification.

## 1. Resume safely

1. Open `C:\Users\DYNAMAX\Documents\New project`.
2. Read this file and `portal\docs\academic-management-phase.md` completely.
3. Inspect both repositories before editing:

   ```powershell
   git -C portal status --short
   git -C suite status --short
   ```

4. Preserve every existing desktop change. Never use `git reset --hard`,
   `git checkout --`, or any cleanup command against the dirty desktop tree.
5. Do not compile or package the desktop application yet. The user explicitly
   wants all academic milestones finished before compilation.
6. Continue the next unfinished academic item, verify it proportionately, and
   update the authoritative specification when academic behaviour changes.

No passwords, API tokens, private keys or student secrets belong in this file.

## 2. Repositories and deployment

### Web companion

- Local path: `C:\Users\DYNAMAX\Documents\New project\portal`
- Repository: `https://github.com/Jozcefhs/portal.git`
- Branch: `main`
- Production: `https://destinychristianacademy.pages.dev`
- Deployment: pushing `main` deploys the Cloudflare Pages application.
- Milestone 11 is committed locally as `dd65342f`
  (`Complete academic production readiness milestone`). Its GitHub push and
  resulting Cloudflare deployment were blocked only by the exhausted Codex
  account usage allowance. Push the current local `main` from the next account,
  then perform the production smoke checks in the Milestone 11 runbook.

### Desktop and local CBT

- Local path: `C:\Users\DYNAMAX\Documents\New project\suite`
- Repository: `https://github.com/Jozcefhs/Dynamax-Desktop.git`
- Branch: `main`
- Current local committed revision: `c5561a5`
  (`Complete academic outcomes and local CBT readiness`). Its GitHub push was
  blocked only by the exhausted Codex account usage allowance; push this exact
  commit from the next account before adding new desktop changes.
- Do not build an installer until all remaining milestones are complete.

The connected academic/CBT source change in `c5561a5` contains:

- `README.md`
- `modules/academic_management.py`
- `modules/local_cbt.py`
- `modules/local_cbt_identity.py`
- `modules/students.py`
- `tests/test_academic_management.py`
- `tests/test_local_cbt.py`
- `tools/run_local_cbt_readiness.py`

The local desktop tree was clean after that commit. Do not reset it to the
older remote branch; push `c5561a5` first, then rerun the desktop tests in one
Python environment with `requirements.txt` installed.

## 3. Product editions and scope

The product has three editions: School, Church and Other Organisation.

- Academic Management, student results and CBT are School-edition features.
- Shared account, settings, storage, notification, authentication and UI
  changes must continue to work in all three editions where the feature is
  applicable.
- Never expose School academic navigation or data inside Church or Other
  Organisation editions.
- Every online record remains isolated by organisation/workspace, branch and
  school section. Direct API or URL access must fail closed.

Relevant cross-edition decisions already made:

- Organisation-wide settings are the default editing context.
- An organisation default is inherited by all branches that have no override.
- A branch override affects only that branch and takes precedence there.
- While branch mode is selected, organisation-wide controls must be visibly
  locked so a user cannot mistake a local change for a global one.
- Show success only after online synchronization has actually succeeded.
- A newly saved Google Apps Script Web App URL must replace the previous
  organisation or branch value in every companion that inherits that scope.
- Drive-uploaded files intended for permitted portal viewers must be shared by
  the Apps Script with an appropriate view permission so users do not reach a
  Google Drive “Request access” screen. Never grant edit permission merely to
  make viewing work.
- Read-aloud audio is limited to random-presence confirmation notifications
  and should use the device/browser speech engine without a paid service. This
  applies to all three editions where random-presence confirmation exists.
- Clinic visits can optionally verify a student by face.

## 4. Non-negotiable UX conventions

- Keep interfaces task-focused. Tabs show one focused task instead of every
  form and table at once.
- Primary action buttons use compact, content-width sizing. Do not stretch a
  normal action button across the whole card or page. Follow the existing
  button-size policy consistently on web and desktop.
- Desktop modal instructions appear above their input, never beside a tall
  text area.
- Multiple selections use checkboxes, show a live selected count and support
  Shift-click range selection where a long list is presented.
- If bulk selection can handle one record, do not duplicate it with a separate
  single-record form.
- Lists offer useful sorting such as A-Z, Z-A, date created and date modified.
  Do not ask users to maintain arbitrary manual display-order numbers.
- Table headers do not wrap when the table can scroll horizontally.
- Student names use the smaller established table/register typography.
- Provide edit and delete actions for trial or mistaken records wherever
  integrity rules permit. If historical or active references make deletion
  unsafe, explain the dependency and offer archive/deactivate instead.
- Errors must name the failed action and corrective step. Never expose raw
  JavaScript errors such as “X is not defined” to the user.
- Refresh visible lists immediately after a confirmed online mutation.

## 5. Academic structure decisions

### Reusable catalogues and classrooms

- Classes, arms and subjects are reusable catalogues.
- A reusable subject contains only its code, name and status. “Core”, “Trade”
  and “Optional” belong to curriculum assignments, not to the global subject
  record.
- Users can create catalogue records in bulk and delete unused records.
- Deletion is blocked when active or historical references exist.
- Creating a classroom must remain straightforward:
  1. choose a reusable class;
  2. choose one reusable arm;
  3. for Senior Secondary, choose an academic department;
  4. assign students; and
  5. assign a form teacher and optional assistant.
- An arm selector that asks for a reusable arm shows each arm once. It must not
  display every class/arm combination.
- Existing classrooms are opened from the classroom list; selecting a
  class/arm combination that already exists must not silently create or
  preassign unrelated staff.

### Junior and Senior Secondary

- Secondary is divided into Junior Secondary and Senior Secondary.
- Junior Secondary has no elective subjects. Every subject configured for a
  Junior class is compulsory for all its students.
- Senior Secondary departments such as Sciences, Arts and Social Sciences are
  configurable. Each department owns its Core subject set.
- Shared subjects such as Mathematics, English, Computer Studies and CRS may
  be Junior compulsory and independently Senior Core, Trade or Optional. A
  Junior assignment must never globally turn the subject into a Senior Core
  subject.
- Trade subjects are school-wide Senior choices, not department-based. A
  Senior student must choose at least one Trade subject irrespective of
  department.
- Optional subjects are also selected from a school-wide Senior list.
- From the reusable subject catalogue, administrators choose which subjects
  are available as Senior Trade and which are available as Senior Optional.
- At the classroom/arm student-choice screen, department Core subjects are
  already checked and locked for each student. Trade and Optional choices are
  editable per student.
- Show per-student counts for Core, Trade, Optional and Total subjects.
- A subject already selected as Core in the relevant context cannot also be
  selected as Trade or Optional in that same context.
- Legacy or mistaken subject offerings must have a safe delete action. This is
  essential for cleaning assignments created by earlier discarded interfaces.

### Students and staff

- Students already carry a class from admission or import. When assigning an
  arm, show only students in the selected class who are still unassigned for
  the selected period.
- Example: if Grade 7 has 200 students and 30 are assigned to Grade 7 /
  Excellence, another Grade 7 arm must show the remaining 170.
- Batch student allocation is atomic, capacity checked and limited to 100 per
  request. Withdraw, reinstate, transfer and reassign retain movement history.
- Student import matches the exact branch, section and admission number and
  must report a helpful row error when it cannot resolve a student.
- A teacher may teach different subjects in different classes and arms.
- A form teacher or assistant in one classroom may also be a subject teacher
  in other classrooms.
- Form teacher and assistant assignments belong inside the classroom flow and
  do not belong in the Subject Teachers form.
- Subject-teacher assignment chooses one teacher, one subject and the exact
  classrooms taught. Multiple class/arm combinations can be saved at once;
  repeat for another subject.
- Admin, Management and Department Users whose department is `Academics` may
  access Academic Management as authorized and appear in relevant staff
  allocation lists.

## 6. Academic policy: configurable, never hardcoded

The following are administrator choices with organisation defaults and branch
overrides. Their historical active revisions must remain reproducible:

- result visibility and which published terms parents may see;
- whether fee clearance uses any balance, a payment percentage, selected fee
  categories or an exemption;
- whether position is hidden, exact or banded;
- assessment components, maximum scores, weights and allowed entry sources;
- grade bands, classifications, remarks and optional grade points; and
- Junior and Senior promotion criteria.

Grade bands must cover 0 through 100 without gaps or overlaps. Decimal
boundaries are required for policies such as 49.4/49.5 and 54.4/54.5. “Point”
is optional numeric grade-point metadata for GPA, cumulative calculations and
transcripts; it is not the student's raw score.

The school's currently supplied promotion rules are policy defaults to enter,
not constants to bake into code:

- Junior Promoted: 54.5% and above.
- Junior Probation: 49.5% through 54.4%.
- Junior Not Promoted: 49.4% and below.
- Senior Promoted: at least three credits among the five department Core
  subjects, including credits in Mathematics and English.
- Senior Probation: two credits among the five Core subjects, with at least a
  credit in either Mathematics or English.
- Senior Not Promoted: the configured rule covers failure to earn the required
  Core credits and failure of the Mathematics/English credit condition.

The production organisation policy for 2026/2027 First Term has been observed
with these active components: Test 1, Test 2 and Test 3 at 10 marks/10% each,
Exam (OBJ) at 100 marks/30%, and Exam (Theory) at 100 marks/40%. Treat the live
active revision as the source of truth if an administrator changes it.

## 7. Results, attendance and parents

- Parents view and print only eligible published results for their linked
  children and the configured current term/session.
- Result access is blocked or allowed by the active financial-clearance policy;
  do not assume that every non-zero balance must always block access.
- The server rechecks access before printing and audits view, denial,
  exemption and print decisions without copying ledger details.
- Attendance supports Daily, Period and Subject registers with Present,
  Absent, Late, Excused and Left Early states.
- Teacher corrections to saved attendance become approval requests with a
  required reason; an authorized academic administrator approves or rejects.
- Device-local attendance drafts are recoverable and success is shown only
  after online synchronization.
- Parent progress, subjects to watch, attendance and recommendations derive
  only from released results that pass the same linked-child and clearance
  gate.

## 8. Timetable decisions

- Days and periods are configurable and each day may override a period's start
  and end time. Monday Period 1 may therefore differ from Tuesday Period 1.
- Lessons are created against a Draft timetable version by choosing the exact
  classroom, allocated subject/teacher, day, starting period, length, type,
  room and notes.
- The server rejects classroom, teacher and room overlaps.
- Teacher availability supports unavailable day/period slots and optional
  maximum daily and weekly teaching loads; zero means unlimited.
- Published versions retain immutable timing snapshots.
- Copy, substitution, preview and print operations must revalidate conflicts
  and preserve history.

## 9. CBT decisions

### Teacher authoring

A subject teacher creates a test with a simple two-step flow.

Step 1 collects:

- Test Type from the active assessment components;
- exact allocated classroom;
- allocated subject and responsible teacher;
- overall mark from the selected component policy;
- scheduled date and local start time;
- duration in minutes;
- number of questions; and
- answer style such as ABC, ABCD, ABCDE, ABCDEF or True/False.

Step 2 uploads a JPEG, PNG or PDF paper and lets the teacher select the correct
answer for every objective question. Native questions and mapped-document
questions remain supported. The original PDF and answer key stay only on the
workspace-local CBT server.

### Candidate login and clients

- There is no examination-code field in the candidate login.
- A student signs in with admission number plus personal password, or admission
  number plus approved face verification.
- A student personal password has a minimum length of 6 characters.
- New local CBT password verifiers use PBKDF2 with 120,000 iterations and are
  encrypted with the Windows-account-protected workspace vault. Never store or
  sync the plaintext password.
- A successful student-profile password save in Dynamax Desktop also updates
  the reusable encrypted local CBT login registry. Test creation and the
  **Apply Local Logins** action read that registry only; they never request a
  student identity package from the web.
- **Local Login Vault** in the desktop CBT console can set or reset the local
  password directly when the workstation is disconnected; it stores only the
  encrypted verifier and makes no online request.
- The same responsive local candidate client supports Android tablets and
  Windows ICT-lab computers.
- Device failure can be recovered through an authorized transfer from tablet
  to a school lab computer without losing confirmed answers.

### Offline and synchronization model

- The school can run CBT over its local network using the desktop host and a
  workspace-scoped SQLite database in WAL mode.
- Android tablets and lab computers connect to the local LAN server. CBT test
  creation, candidate login, question papers, timing, answers and marking do
  not use public Internet, Cloudflare, Firestore or Google Drive.
- Answers checkpoint locally and replay idempotently after a brief connection
  interruption.
- Objective answers are marked automatically; subjective answers wait for
  manual marking.
- Approved batches follow Draft -> Reviewed -> Approved -> Synchronized. An
  authorized staff member must first stop the local server and then explicitly
  confirm **Push Approved Scores Online**; this is the only online built-in CBT
  operation.
- External CBT CSV/XLSX imports use exact roster, component, maximum mark,
  digest and idempotency validation. A provider-specific API/webhook adapter
  still requires the existing CBT platform's contract.

## 10. Delivery status

The authoritative 11-milestone plan is in
`docs/academic-management-phase.md`. As of this handoff:

| Milestone | Deliverable | Status |
| --- | --- | --- |
| 1 | Configurable academic policy | In progress; core effective-dated policy and activation are operational |
| 2 | Structure and allocation management | In progress; main vertical slice is operational |
| 3 | Secure parent result access | Operational baseline |
| 4 | Timetable and attendance | Operational |
| 5 | Assessment, grading, scorebook and imports | Operational baseline |
| 6 | Local CBT server/database and Android/Windows client | Operational in source |
| 7 | Native/image/PDF/mapped examination authoring | Operational in source |
| 8 | CBT marking, recovery, adapters and synchronization | Operational baseline in source |
| 9 | Term results, publication and parent progress | Operational baseline |
| 10 | Cumulative results, promotion and transcripts | Operational baseline in web and desktop source |
| 11 | Migration, security/load/recovery hardening and production rollout | Operational baseline; site-specific physical drill required per school |

Remaining work is not only a number: finish the incomplete hardening and UX
edges in Milestones 1 and 2 and any outstanding acceptance tests. Milestone 11
now supplies Accounts/Finance Officer clearance administration, migration readiness,
security and release gates, a 220-candidate load/restart/encrypted-restore drill
and staged production/rollback instructions. Each school still must complete
the site-specific Android, Windows, router, power and device-transfer checklist
before its first live CBT. OCR-assisted question suggestions are also pending
and must remain review-gated.

## 11. Latest production incident and fix

The Scorebook and former Web Companion CBT authoring flow previously showed Cloudflare's
“Too many subrequests by single Worker invocation” error because a bootstrap
loaded the entire academic state and CBT paper submission validated the same
schedule twice before doing another full refresh. The fixes now:

- restricts Scorebook reads to the 11 relevant academic collections;
- replaces Web Companion CBT authoring with a local-only operating guide and
  performs no academic collection or candidate reads when that CBT view opens;
- rejects legacy online CBT creation and Drive-upload requests with
  `ACADEMIC_CBT_LOCAL_ONLY` before any paper upload or Firestore write;
- keeps question papers and candidate examination traffic on the local school
  network, with only the approved-score receiver remaining online;
- returns partial scorebook state and merges it client-side; and
- performs post-mutation refresh as a separate Worker invocation.

Production was verified after deployment: the Scorebook loaded the active
assessment components without the subrequest error. Current cache identifiers
are:

- admin script: `20260820-local-offline-cbt`
- service worker: `dynamax-v248-local-offline-cbt`

If the error returns, first verify that the browser has these current assets,
then inspect the specific API response. Do not “fix” it by raising a Worker
limit or returning the full academic database again.

The School staff-account option `Allow student face-enrollment management` is
an explicit per-user grant, not a role whitelist. It now authorizes enrollment
for any School staff role and adds the Records Desk entry point required to
select the student. The face API still enforces the saved grant, School edition,
workspace, branch and school-section scope, encrypted templates and audit logs.

## 12. Verification commands

### Portal

```powershell
cd "C:\Users\DYNAMAX\Documents\New project\portal"
node --check functions/lib/academic-management.js
node --check js/admin.js
node --test tests/*.test.mjs
git diff --check
git status --short
```

The Milestone 11 focused release gate passed all 108 tests and the final full
portal regression run passed all 945 tests on 2026-08-17.
After the edition-aware staff-attendance storage correction, the full portal
regression run passed all 1,013 tests on 2026-08-20. School attendance now
writes under `schoolBranches`; Faith and Organization attendance writes under
`organisationBranches` with generic collection names. Staff Attendance → Data
storage provides the Super-Administrator-only copy, verification and cleanup
workflow for the former `churchStaffAttendance...` paths. Finalization writes a
marker that disables legacy fallback reads for that branch.

### Desktop source

```powershell
cd "C:\Users\DYNAMAX\Documents\New project\suite"
python -m unittest discover -s tests
git diff --check
git status --short
```

For a narrower CBT/academic check:

```powershell
python -m unittest tests.test_local_cbt tests.test_academic_management
```

The application-level local CBT readiness drill passed 220 simulated candidates
(200 target plus 20 safety margin), with 220 attempts and responses surviving a
restart and encrypted restore. Run it again with:

```powershell
python tools\run_local_cbt_readiness.py --candidates 200 --safety-margin 20 --workers 24
```

During the final handoff verification, desktop discovery reached 248 tests: 245
passed and three modules could not import because the available verification
runtimes split the pinned dependencies (`cryptography` in one runtime and
`requests` in the other). The attempt to download the missing pinned test
dependency was blocked by the Codex account usage limit. Install
`suite\requirements.txt` into one Python environment, then rerun the full
desktop command; do not treat those import errors as executed test failures.

Do not run `tools\build_release.ps1` and do not compile an installer yet.

## 13. Working rules for the next account

- Diagnose from current code and live responses; do not reconstruct behaviour
  from screenshots alone.
- Use `rg`/`rg --files` to locate code and `apply_patch` for hand edits.
- Preserve unrelated or pre-existing user changes.
- Apply shared fixes to all relevant editions, but retain edition boundaries.
- Keep organisation and branch settings synchronized and display the effective
  source clearly.
- Never report success before the online write and refresh complete.
- Update tests and this handoff/specification when a decision or milestone
  materially changes.
- Push portal changes only after verification. Do not compile desktop.

## 14. Copy/paste continuation prompt

Use this prompt in a new Codex account:

> Open `C:\Users\DYNAMAX\Documents\New project`. Read
> `portal\PROJECT_HANDOFF.md` and
> `portal\docs\academic-management-phase.md` completely. Inspect the Git
> status of both `portal` and `suite`. Preserve the existing dirty desktop
> changes and do not reset, overwrite or compile the desktop application.
> Continue the next unfinished Academic Management milestone or the specific
> issue I give you. Keep the three edition boundaries, configurable policies,
> branch/organisation inheritance and established UI conventions intact. Run
> the relevant tests, update the specification when behaviour changes, and
> clearly report what was verified.
