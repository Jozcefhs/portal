# Academic navigation and stale staff pages — 26 October 2026

## Findings

- The school server and `main` had the current class-register controls, but the open staff tab still referenced the October 18 assets. Reloading restored the subject and score filters, formatted table, printing and class snapshot cache. A live Grade 8 → Grade 7 → Grade 8 check restored the loaded Grade 8 snapshot without another request. This was a stale page, not evidence that records or server repairs had been rolled back.
- Scorebook's on-demand mark loader was present, but its initial bootstrap still loaded memberships, staff, sheets and import history. Rendering also opened an invisible score-entry context while the class register was selected.
- Results downloaded raw scores, attendance and history before presenting its controls. Other large Academic Areas similarly loaded their entire workspace bundle merely on navigation.

## Repair

- The class-register opening reads only sessions, terms and classes. Its existing explicit class report action, filters, display and per-class cache remain intact.
- Other large Academic Areas open their settings/selectors first. A visible Load records form lets the user request one class or explicitly select all classes in the working branch. Small catalogues remain directly available; catalogue navigation no longer reads memberships for counts.
- Explicit reads narrow compatible record collections by branch, session, term and selected class. Annual results use session/class scope, retaining all their terms. Collections without that schema retain their existing compatibility contract. This does not claim that every explicit operation is a single-class query: directory selection, timetable integrity and cross-period transcript work can still require broader authorised data.
- Results display requests no longer download raw score sheets, marks, attendance or calendars. Calculation and mutation actions retain the evidence and conflict checks needed to preserve records.
- Hidden score-entry panels make no context requests. Concurrent requests for the same context are coalesced, and a late context response cannot replace a newly selected class register.
- Submission-deadline settings are requested only when a visible submission control needs them.
- Academic audit log is available to score-reviewing administrators in Academic Area. Opening it loads no history. Explicit WAT dates query only the working branch's academic change log, with 50-row pages, section isolation, page caching and bounded name resolution. It shows saved academic changes; the Security log retains broader request failures and access events. Existing history is not rewritten. Successful audit reads create no audit noise.
- The shared staff shell detects newer releases through the static service-worker file, at most once per five minutes in a visible tab, with no database query. It offers an explicit reload; it never discards unfinished work automatically.
- Deployment workflows verify the actual published HTML, JavaScript and stylesheet hashes. Offline versioned scripts cannot silently fall back to a different cached query version.

## Preservation and validation

No bulk migration, record deletion, score calculation, payment posting or historical audit rewrite is part of this release. A separately authorised single-student subject recovery was performed with a verified backup and revision-guarded transaction; its private verification files are excluded from Git. It restored the archived subject selection to the retained membership, superseded a conflicting pending request with full history and verified all ten score documents unchanged and visible in the class register. Existing mutation validation and older desktop protocols remain available. Card terminal payments remain disabled; Hospital development remains paused and is excluded from this release.

Validation covers navigation query traces, no writes on reads, branch/section/period boundaries, legacy and teacher behavior, class-cache browser interactions, prior read-cost repairs and audit idempotency. Live billing savings need subsequent comparable usage measurements; this change does not retroactively reduce billed reads.
