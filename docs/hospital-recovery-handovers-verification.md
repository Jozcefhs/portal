# Hospital recovery handover verification

Verified 13 November 2026. Source: `d3580827565b63f51a44e58e24306df698f544af` on `codex/hospital-edition`, pushed to `Jozcefhs/portal`. Isolated web deployment: [570b5499](https://570b5499.dynamax-hospital-review.pages.dev), serving [the Hospital Owner Demo](https://dynamax-hospital-review.pages.dev/hospital.html?task=theatre). No other edition was deployed.

## Automated and browser checks

- `node --test tests/*.test.mjs`: **4,746 passed**, zero failures, zero skipped.
- Ten recipient handover tests plus the existing 23 theatre tests cover identity/branch/module/read-only guards, immutable history, simultaneous responses, lost-response retries, amendments invalidating earlier responses, legacy routing, completed-visit preservation, exact operation budgets and bounded equal-time pagination.
- Synthetic theatre, inpatient and nursing browser workflows passed. The theatre flow completed recovery, requested clarification, amended the note, acknowledged its new version, displayed retained history, previewed/printed without requests and checked escaped text, cache reuse, branch/session clearing and desktop/phone layouts.
- `git diff --check` passed. GitHub's status connector returned no status entries for this source; these results are completed local and live checks, not a claim that a separate hosted CI run passed.

## Live deployment checks

- The single additive `hospitalProcedureCases` index on BranchId, RecoveryRecipient, RecoveryPending, RecoverySentAt and document ID is READY. No index was removed and no record migration/backfill was performed.
- Release marker: `dynamax-v535-hospital-recovery-handovers`. SHA-256 comparisons after newline normalization matched eight public assets to the source commit: admin, Hospital page/style, theatre, inpatient, nursing, main Hospital script and service worker.
- Hospital settings identify workspace `dynamax-hospital-review` and edition `hospital`.
- Owner, Medical Director and Nurse demo sign-ins passed. Incoming clinical queues return 200 to clinical accounts and 403 to the administrative owner. Anonymous access returns 401. An incomplete clinical response returns 400 before any write.
- Opening Theatre requests `state` only. Clicking Load pending handovers twice produces one queue request. The live empty queue returns successfully through the new index. Mobile width 390 pixels has no page overflow or script errors.
- The three original sample visits are identical in bounded before/after queries. Verification sent no clinical, stock or financial mutation request and no emails. Login sessions and explicit clinical-read audit entries are normal verification side effects.

Local evidence: `tmp/hospital-handover-regression.log`, `tmp/hospital-handover-index-status.json`, `tmp/hospital-handover-live/verification.json`, and desktop/phone screenshots in `tmp/hospital-handover-live/`. These local artifacts and private demo credentials are not included in the deployment.

The wider Hospital roadmap remains incomplete. This increment adds receiving-officer confirmation, not automatic transfer/discharge, treatment advice, stock usage, charges or external notifications. No desktop compilation or installer release occurred. NFC patient identity remains supported; card-terminal payments remain disabled.
