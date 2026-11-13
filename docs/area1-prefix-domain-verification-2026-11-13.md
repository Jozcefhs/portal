# Area 1 retained register and domain verification — 13 November 2026

## Authorised scope

Keep the 351 current Area 1 Primary pupil profiles, remove older entries outside that register, and replace their admission prefix `DCA/` with `DCAP1/`. Keep suffix digits, pupil placements, scores and other retained records. Other branches are excluded.

## Applied and verified in production

- Retained all 351 profiles and their 351 academic memberships.
- Removed 108 older memberships and 114 older movement entries with no retained pupil association.
- Merged three movement references using an extra leading zero into the matching retained pupil histories. These history records were not deleted.
- Changed the prefix on 351 profiles and linked references in 351 memberships, 699 movements and 154 score records.
- Set the Area 1 branch school code to `DCAP1` for future admissions.
- Kept all 154 score records, marks, assessment locks and placements. The 11 score sheets remain unchanged. No payment records were changed.
- Verified all 1,555 changed documents against their planned values and checked that replaced profile keys no longer exist. A fresh prefix plan requires zero changes. The retained collection total is 1,566 documents.

The cleanup used version checks and a transaction; prefix updates grouped each pupil and linked records into the same atomic commit. Deterministic audit records identify both operations. Complete before/after backups are private and excluded from Git by `.area1-prefix-repair/.gitignore`.

The committed helpers are plan-only and deliberately limited to this project, branch and reviewed collection set. They do not run on application startup. Future repairs require a fresh inventory and reviewed plan; do not reuse a saved plan after records have changed.

## Custom-domain review

- Root and subdomain setup remain implemented in subscriber Settings, with DNS records, root nameserver guidance and provider status.
- Production configuration contains the central Pages and zone credentials and the subscriber control-plane settings for the inspected tenant deployments.
- `https://dynamax.cc/admin.html`, `https://dynamax.cc/setup.html` and the corresponding tenant-001 pages returned HTTP 200 over HTTPS. Setup includes the custom-domain controls.
- The existing root DNS zone is active. No DNS records, nameservers or primary portal addresses were changed by this review.
- Automated checks cover staff sign-in on the chosen HTTPS origin; same-origin requests; completed payment origin, current credential and 24-hour freshness; signed workspace identity; exact root zone/account matching; provider activation; no duplicate activation writes; and no attachment writes on status checks or provider failures.

Live limitation: the direct Cloudflare domain-status read returned HTTP 503 during the final probe. A real subscriber custom-domain sign-in and checkout return were not performed. Public-page availability and automated tests are not evidence of a completed live subscriber checkout. Those checks remain mandatory in the application before making a new address primary. The existing platform root domain was not moved into a subscriber workspace.

## Validation

`node --test tests/area1-admission-prefix.test.mjs tests/area1-orphan-cleanup.test.mjs tests/tenant-custom-domain.test.mjs`

No application runtime change or installer build is required for this data correction. Private backups and operational scripts are not part of the pushed change.
