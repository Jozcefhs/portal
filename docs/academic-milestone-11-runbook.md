# Academic Milestone 11 release and recovery runbook

This runbook is the production gate for the Academic Management phase. It does
not compile the desktop application. A school deployment may proceed only when
the automated gates pass and the site-specific checks below are recorded.

## 1. Migration readiness

Open **Academic Management → Release readiness** as Super Admin, Admin or
Management. The report is read-only: it does not silently repair or delete
school data.

Deployment is blocked while an error exists, including:

- an arm whose reusable class no longer exists;
- a department whose Core subject no longer exists;
- an offering with a missing period, class, arm or subject;
- a student membership with a missing or mismatched period, class or arm;
- a membership without a matching student profile; or
- two active memberships for the same student and academic period.

Warnings identify records that require an administrator decision, including
legacy Senior offerings, a missing Senior department or Trade subject, and an
incomplete Senior subject selection. Correct the source record in the normal
Academic Management workspace and rerun readiness; do not alter Firestore
documents manually.

Before migrating live data:

1. Download and verify an organisation backup.
2. Record the branch, school section, active session and term.
3. Run Release readiness and export or screenshot its issue list.
4. Correct every error and approve the remaining warnings explicitly.
5. Run the complete academic release test command.
6. Deploy one pilot branch, verify it, then continue branch by branch.

## 2. Finance result-clearance administration

Accounts Officers (and the supported Finance Officer role alias) now receive a
least-privilege **Result clearances** workspace.
They can approve or revoke a student's period-scoped manual clearance, but
cannot enter scores, review score sheets, publish results or view another
school section.

A clearance can be granted only when the active inherited academic policy uses
**Manual clearance** or explicitly allows manual exemptions. A reason is
mandatory, expiry is optional, reapproval is revision-checked and revocation
requires a separate reason. All actions enter the protected academic audit
trail. The parent result endpoint still rechecks publication, current-period
visibility and the clearance policy for every view and print.

## 3. Automated portal release gate

From the portal repository:

```powershell
npm run test:academic-release
node --test tests/*.test.mjs
git diff --check
```

The focused gate verifies authorization, edition/branch/section isolation,
policy activation, timetable/attendance, scorebook, CBT authoring and login,
term and cumulative results, promotion/transcripts, parent access, backups,
migration readiness, response headers and current browser cache identifiers.
The full suite remains the final regression gate.

## 4. Local CBT load and recovery drill

Use the project's dependency-ready Python runtime and run:

```powershell
python tools\run_local_cbt_readiness.py --candidates 200 --safety-margin 20 --workers 24
```

Run this command from the desktop-source repository. It uses a temporary local
CBT workspace and removes it afterward. It provisions the planned capacity plus
the safety margin, signs in every simulated student with admission number and
personal-password challenge proof, saves responses concurrently, verifies
SQLite integrity after restart, creates an encrypted backup, mutates the test
database and restores the exact pre-mutation state.

The 2026-08-17 baseline passed 220 of 220 simulated candidates. The concurrent
login-and-save phase took 9.253 seconds, the database retained 220 attempts and
220 responses, `PRAGMA quick_check` returned `ok`, and encrypted restore
reproduced the original record counts. This synthetic result validates the
application and database path; each school must still test its actual server,
router, tablets and ICT-lab computers.

## 5. Site-specific acceptance drill

Before each school's first live CBT:

- record server CPU, memory, storage and power-backup details;
- record router/access-point capacity and stable local server address;
- test the supported Android and Windows browser versions;
- test touch, keyboard/mouse, rotation and one large PDF examination;
- interrupt Wi-Fi briefly and confirm buffered answers synchronize once;
- restart the local server and confirm candidates resume at the last checkpoint;
- transfer one attempt from a tablet to an ICT-lab computer and prove the old
  device can no longer continue; and
- synchronize an approved test batch online twice and prove the retry is
  idempotent and remains a draft until academic approval.

Record the date, devices, candidate target, result and responsible officer.
Any failure blocks that school's rollout even when the synthetic drill passes.

## 6. Deployment and smoke checks

Deploy the version already accepted by the release gate. Do not introduce code
changes during deployment. After Cloudflare Pages reports success:

1. Open the production portal in a clean browser session.
2. Confirm the login page and `admin.html` load with the current service worker.
3. Confirm API responses include request IDs, `Cache-Control: no-store`,
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a restrictive
   `Referrer-Policy` and `Permissions-Policy`.
4. Open Academic Management as an academic administrator and as a Finance
   Officer; confirm each sees only its permitted workspaces.
5. Run Release readiness against the pilot branch.
6. Grant then revoke one authorized test clearance and verify the audit trail.
7. Verify a permitted parent result view and a deliberately blocked result.

Use Cloudflare Pages deployment status, Functions logs and request IDs to trace
failed requests. Review invocation errors, duration and subrequest usage after
the pilot; the Scorebook must keep using collection-scoped bootstrap reads.

## 7. Rollback

If a production smoke check fails:

1. Stop further branch rollout and preserve the failing request ID and time.
2. Roll back the Pages deployment to the last accepted Git commit/deployment.
3. Do not restore data merely to roll back code.
4. If data integrity is affected, put academic writes into an administrative
   freeze, preserve a fresh backup, inspect the migration-readiness report and
   restore only the verified pre-deployment organisation backup.
5. Rerun migration readiness and parent-access denial tests before reopening.
6. Document the incident, affected branches, recovery evidence and new test.

Never delete current or historical memberships, movements, score events,
result events, clearances or audit records as a shortcut to recovery.

## 8. Evidence retained for handoff

Retain the accepted Git commit, full and focused test output, load-drill JSON,
production deployment URL, smoke-check time, request IDs, migration-readiness
result, backup identifier and site-specific device checklist. A release is
complete only when this evidence belongs to the exact deployed revision.
