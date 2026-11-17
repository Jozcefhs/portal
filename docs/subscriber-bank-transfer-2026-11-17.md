# First-time subscriber bank transfers

Paid registration now offers the configured Dynamax direct bank transfer alongside Paystack card checkout. The former client exclusion and first-time card-only rejection prevented enabled transfers from appearing or completing.

Submitted transfers remain Awaiting Verification. Authenticated platform administration must verify the actual bank credit. Approval claims the normalized bank reference uniquely, then supplies separate verified-bank evidence to workspace allocation. It does not fabricate card verification or enable recurring card charges. Free trials still require card verification; prorated Flex upgrades retain the card route.

Validation: 84 focused tests passed. The mocked full registration/approval flow verifies pending state, zero-write initialization retries, unauthorized approval rejection, one receipt and one provisioning request, unchanged paid-through date on repeated approval, and rejection of a second subscriber using the same bank reference. No live payments were created, approved or modified during testing.

Web deployment only; no desktop compilation or release. Live rollout evidence follows verification.
