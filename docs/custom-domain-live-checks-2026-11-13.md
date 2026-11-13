# Custom-domain verification follow-up — 13 November 2026

## Scope

Finish subscriber HTTPS, staff sign-in and checkout verification before hospital work resumes. Push and deploy repairs; do not compile or release the desktop application.

The owner selected `dynamax-tenant-001.pages.dev` for testing. No separate root domain is available. `dynamax.cc` currently serves the central platform and must remain connected there. A temporary subdomain can exercise the tenant's custom-host flows without moving the central root domain. Do not make that test address primary or retain it after testing.

## Repair and regression evidence

The general payment verifier recorded custom-host return evidence for ordinary payments, but advance school-fee settlement used a separate atomic completion path. Its first successful browser callback therefore left out the evidence required by domain activation. The verifier now reads the completed advance intent only on a same-origin HTTPS custom-host return and conditionally patches the three verification fields. It does not change receipts, allocations, charges or balances.

A future-dated return proof could also be rejected by activation while the callback considered it fresh and skipped repair. Callback freshness now uses the same non-future, finite timestamp requirement.

38 targeted tests passed across:

- `custom-domain-payment-return.test.mjs`
- `tenant-custom-domain.test.mjs`
- `school-fee-advance.test.mjs`
- `payment-confirmation-null-intent.test.mjs`
- `tenant-activation.test.mjs`

Behavioral checks cover the first advance callback, webhook-first verification followed by a browser return, repeated callbacks without another receipt or proof write, invalid/old/future/rotated-key proof recovery, cross-origin rejection and no additional proof reads or writes for pages.dev advances. Existing tests retain signed tenant ownership, active root-zone/HTTPS requirements and the authenticated-session/payment gate before a primary switch.

## Live evidence and outstanding checks

The Cloudflare dashboard showed tenant 001's current production deployment and its default pages.dev address. The custom-domain panel repeatedly failed to load. Authenticated Cloudflare REST reads returned HTTP 503 with `no healthy upstream`. No temporary domain, DNS record or primary-address change was made during these attempts.

Actual authenticated sign-in and successful checkout on the temporary custom host remain unverified. Automated regression tests are not evidence of a completed live checkout. Resume only after Cloudflare domain controls are available, attach a temporary subdomain to tenant 001, validate HTTPS, use an authorized tenant account and payment route, verify the return and replay behavior, then remove the temporary connection. Never redirect the central root domain for this test.
