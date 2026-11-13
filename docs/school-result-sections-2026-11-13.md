# School result layout and stage policy — 13 November 2026

The six report requests in this pass are implemented in the shared web result renderer and policy calculation helpers. No business-data migration, score rewrite, result publication or policy activation is performed by deployment. No desktop compilation or installer release is part of this pass.

## Report changes

- Nursery and primary reports show Grade key / Progression criteria instead of Junior / Senior columns.
- Assessment cells show only the earned contribution (for example, `7.8`), without the maximum denominator. Mid-term totals are explicitly labelled Total (%).
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

Production deployment and source SHA are recorded after deployment verification. Hospital development remains paused for this school pass.
