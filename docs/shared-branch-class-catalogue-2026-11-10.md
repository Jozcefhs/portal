# Shared branch classes and arms — 10 November 2026

## Request and scope

Settings → Classes & Arms and Academic Management must use the same branch-specific definitions, preserving pupil placements, subjects, scores and history. Test, push and deploy the web/backend changes; keep desktop source ready without compiling or releasing an installer.

## Result

- Operational Settings reads project `academicClasses` and `academicArms`, retaining their existing IDs, section, status and revision. Changes through either screen now address these same records.
- Branches never fall back to the organisation or legacy branch class snapshots. These historical snapshots remain stored but cannot resurrect removed arms. Names-only consumers skip arm queries.
- Settings saves retain identities and unknown metadata. Omitted classes are not deleted. Unchanged saves perform no writes. Duplicate names/aliases are rejected within the relevant branch and section.
- Structural changes use a branch revision guard in the same atomic batch as changed definitions and audit evidence. Stale updates fail without partial writes. Admission-setting field patches preserve this guard.
- Settings additions, progression and formatting edits use the shared definitions. Removal or deactivation is directed to Academic Management's existing review workflow; the new saver does not add a second destructive path. Material class renames require a separately reviewed migration because fee/admission rules still refer to names; formatting-equivalent names remain supported. Rename an existing occupied classroom using its Edit action in Academic Management so its stable ID remains linked.
- Pupil editing/import, stock setup/import and correspondence now use the branch catalogue rather than the global template.
- Desktop source retains catalogue IDs and revisions, shows school section, hides the obsolete organisation-default reset in shared mode, and keeps the action footer visible.

No pupil, membership, score, payment or financial-history migration is part of this change. A future branch containing only legacy settings needs an explicit reviewed import; automatic global fallback is deliberately excluded.

## Verification

Read-only live catalogue audit:

| Branch | Classes | Arms |
| --- | ---: | ---: |
| Main | 6 | 59 |
| Area 1 Primary | 11 | 21 |
| The Lord's Garden Primary | 11 | 23 |

All 28 current class definitions already exist in Academic Management. Projecting and submitting the existing setup to the pure planner produces **zero changes and zero removals** for each branch. Old Area 1 settings list extra arms that do not exist as current academic classrooms; these were not recreated.

- Final full web suite: **4,930 passed, 0 failed**.
- Tests include branch isolation, existing ID preservation, no-op/retry behavior, stale/concurrent writes, pupil and membership dependencies, alias duplicates, removal safety, and name-based billing protection.
- Desktop: **37 focused tests passed**, including small-window footer visibility. Source commit `59ffdd2` pushed; no installer compilation or release.
- Live audit export and test logs stay in ignored `tmp/`; no credentials or private pupil exports are committed.

## Related payment setup question

The user asked whether the fee editor's part-payment fields are still needed. The prior accepted requirement explicitly retains per-item rules. Separate total-fee plans govern the total school-fee balance and take precedence when configured. `Existing fee-item rules` uses eligible saved component rules; individual optional charges continue to use item rules. No payment setting or finance UI was changed in this catalogue pass.

A possible later UI improvement is to group these fields under “Individual item payment rules” and explain the total-plan precedence, without deleting existing rules.

## Assignment and removal concurrency verification

The follow-up now guards allocation, import, transfer, promotion and profile-only placement against concurrent class/arm removal. Each real placement mutation checks the destination revisions in the same atomic batch; several pupils assigned together share one guard per destination. Existing session movement and reactivation guards remain in place. Unchanged retries and score-only edits add no placement writes.

Generic pupil imports preserve existing scoped identities and reject status or placement changes that require the reviewed workflow. Metadata optimization updates only normalized fields with a revision check, so it cannot overwrite a concurrent placement or status change.

Both commit orders are tested: either assignment commits first and removal must recheck dependencies, or removal commits first and assignment fails without changing pupil records. The affected academic checks passed 151 tests, and the final import/race checks passed 56 tests. No live pupil, score or payment records were altered for these checks. The latest owner instruction authorizes an installer build after the remaining release checks pass.
