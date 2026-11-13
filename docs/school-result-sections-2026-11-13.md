# School result layout and stage policy — 13 November 2026

The six report requests in this pass are implemented in the shared web result renderer and policy calculation helpers. No business-data migration, score rewrite, result publication or policy activation is performed by deployment. No desktop compilation or installer release is part of this pass.

## Report changes

- Nursery and primary reports show Grade key / Progression criteria instead of Junior / Senior columns.
- Assessment cells show only the earned contribution (for example, `7.8`), without the maximum denominator. Mid-term totals are explicitly labelled Total (%).
- Follow-up: the contribution maximum now appears once in the heading, for example `CA1 (10)` and `Exam (70)`. It comes from saved result components, not today's settings. Where exemptions give subjects different maxima, the heading says `(varies)` instead of mislabelling the scores. This is presentation only and adds no reads or writes.
- Sample reports use Alex Sample and an inert Sample signature illustration; they do not fetch the real signatory image or a verification QR record.
- PDF capture accommodates unwrapped names/subjects and draws all four outer borders on every page, including continuation pages. Access is rechecked before exporting; PDF libraries load only on demand.
- Mid-term component display uses the original full-term weights in the result's saved policy snapshot. Published percentage totals and grades remain unchanged. End-of-term components retain exemption-aware weighting. Incomplete historical snapshots are not used to invent marks.
- Report criteria come from the result's saved policy snapshot, while current access restrictions continue to control whether the parent can view it.

For CA1 maximum 100 / weight 10, a mark of 95 contributes 9.5. CA2 8/10 contributes 8, CA3 7/10 contributes 7, and Exam 56/70 contributes 56: the end-of-term total is 80.5. A mid-term using CA1 alone retains its 95% total while showing the 9.5 contribution.

## Nursery and primary policy

Settings → Academic policy → Nursery and primary provides independent decision methods and optional minimum average, maximum failed subjects and minimum attendance. These settings use the existing branch/period policy lifecycle. Existing policies inherit their general criteria; a secondary division/Core-credit policy defaults early-years decisions to head-teacher review rather than applying secondary rules. Authorised staff must save and activate any desired new criteria. Assessment schemes, grading, cumulative terms and parent-access rules retain their existing configuration.

## Verification

- Full shared Node suite: 5,124 passed, zero failures.
- Policy browser check: nursery/primary round trip, valid zero retained, desktop/mobile fit, no network requests.
- Report browser check: sample/parent geometry, two-by-four identity layout, unwrapped subjects, desktop/mobile/A4 print, sample identity and early-years footer, parent access recheck.
- PDF browser check: single-page and long two-page downloads, long learner/subject names, repeated table heading, rendered pixel assertions for all continuation-page borders, access denial and lazy loading.
- Release metadata: `dynamax-v559-section-result-layout`.

## Delivery

Implementation commit: `ad8e00669f3532582dcda697d311faf021c86937`, pushed to `codex/school-score-register-release`.

Production: https://destinychristianacademy.pages.dev

Deployment: https://2761d753.destinychristianacademy.pages.dev

School/workspace identity and subscription bridge passed live checks. Twenty-seven served assets, including the settings form/script, report renderer, PDF exporter and previously delivered HR/academic interfaces, matched tested source. Installer metadata remains 3.1.64; no installer was compiled or released. No authenticated parent record was opened or altered during this pass. Generated PDF verification used synthetic fixtures.

The isolated `codex/school-result-sections` worktree contains this tested source. The original school checkout has unrelated pending edits and was deliberately not overwritten; future deployments must include the pushed implementation above. Hospital development remains paused for this school pass.

## Saved Trade selection follow-up

The branch's saved curriculum setting was read correctly but discarded by `sortAcademicState`, so the response defaulted to compulsory Trade selection even after Optional was saved. The sorted response now preserves that setting. Senior subject choices also show the active saved value separately from an unsaved selection. No data migration, policy change, pupil placement change or score rewrite is performed by this repair, and no additional database requests are introduced.

Verification: 84 targeted academic tests passed, including actual save-response/reload/branch-switch coverage, an unchanged-save retry with zero writes, and protection of existing pupil and score records. A browser check passed for the actual form renderer and payload at desktop/mobile widths, including the active label during an unsaved edit and zero network requests. Web marker: `dynamax-v561-active-trade-selection`. No desktop compilation or installer release.
