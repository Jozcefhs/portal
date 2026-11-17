# First-time subscriber bank transfers

Paid registration now offers the configured Dynamax direct bank transfer alongside Paystack card checkout. The former client exclusion and first-time card-only rejection prevented enabled transfers from appearing or completing.

Submitted transfers remain Awaiting Verification. Authenticated platform administration must verify the actual bank credit. Approval claims the normalized bank reference uniquely, then supplies separate verified-bank evidence to workspace allocation. It does not fabricate card verification or enable recurring card charges. Free trials still require card verification; prorated Flex upgrades retain the card route.

Validation: 84 focused tests passed. The mocked full registration/approval flow verifies pending state, zero-write initialization retries, unauthorized approval rejection, one receipt and one provisioning request, unchanged paid-through date on repeated approval, and rejection of a second subscriber using the same bank reference. No live payments were created, approved or modified during testing.

Web deployment only; no desktop compilation or release.

Live verification completed on dynamax.cc, destinychristianacademy.pages.dev and dynamax-tenant-001.pages.dev. Registration HTML and both checkout scripts match the isolated deployment sources after normalizing line endings and Cloudflare's injected analytics script. Each site reports direct transfer enabled and rejects unauthenticated approval with HTTP 401. The live Dynamax browser chooser displays both payment routes; selecting direct transfer shows configured bank details, the selected plan amount and the pending-verification notice. No registration or bank evidence was submitted.

Deployment commits: central `86fe8595`, school `b82efc25`, tenant `102b9f25`. Aliases: https://d17aeca4.dynamaxms.pages.dev, https://6e0e1464.destinychristianacademy.pages.dev, https://5dfa36f1.dynamax-tenant-001.pages.dev. Each deployment starts from that site's existing production commit and includes only this fix.
