Dynamax Web Portal
==================

This folder is the canonical static Cloudflare Pages portal plus its Pages
Functions backend. The deployed product supports school, religious-
organization and other-organization workspaces.

Architecture
------------

- HTML, CSS, JavaScript, images, icons, fonts and the manifest are static
  Cloudflare Pages assets.
- Only /api and /api/* invoke Pages Functions. See _routes.json.
- Firestore is the primary application database.
- Paystack, Brevo and Google document services are called only from backend
  Functions; private credentials must never be put in browser JavaScript.
- The Windows desktop suite uses /api/backend as an authenticated bridge.

Main public flows
-----------------

- index.html: Dynamax landing/workspace selection and general preferences.
- buy-form.html: admission-form purchase.
- verify.html and application.html: application verification/submission.
- upload-documents.html: controlled parent document uploads.
- payments.html and payment-success.html: Paystack fee/wallet/store payments.
- parent-dashboard.html: family/child dashboard.
- register-organization.html: organization registration/subscription.
- admin.html: secured staff web companion.

Required Cloudflare variables
-----------------------------

Core:

- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY (encrypted)
- BACKEND_SHARED_SECRET (encrypted)
- STAFF_SESSION_SECRET (encrypted)
- ADMIN_WEB_PASSWORD (encrypted)
- ADMIN_WEB_USERNAME (optional; defaults to admin)

Feature-specific:

- PAYSTACK_SECRET_KEY
- BREVO_API_KEY
- BREVO_SENDER_EMAIL
- BREVO_SENDER_NAME
- GOOGLE_APPS_SCRIPT_URL or GOOGLE_DOCUMENTS_URL
- GOOGLE_APPS_SCRIPT_SECRET
- TURNSTILE_SITE_KEY
- TURNSTILE_SECRET_KEY
- TURNSTILE_ALLOWED_HOSTNAMES
- CANONICAL_PORTAL_URL
- WEBAUTHN_RP_ID
- WEBAUTHN_ORIGIN
- WEBAUTHN_RP_NAME
- DATA_BACKEND_MODE (only for an intentional legacy Google backend)

Set production and preview values separately. Encrypt all private values. Do
not commit .dev.vars, .env files, Firebase service-account JSON, private keys,
Paystack secrets, Brevo keys, shared secrets, passwords or session secrets.

Payment setup
-------------

- Configure the Paystack secret as PAYSTACK_SECRET_KEY.
- Configure the Paystack webhook:
  https://<production-host>/api/paystack-webhook
- The webhook signature is verified before processing.
- Form purchases, general/student payments and church donations are
  classified and checked against saved payment intent/metadata.
- Initialization and verification are idempotent; retries repair deterministic
  accounting records instead of creating a second transaction.

Turnstile
---------

Turnstile remains disabled when both keys are absent. When enabled, both keys
must be configured and the verified action must match. Add the production and
approved preview/custom domains to TURNSTILE_ALLOWED_HOSTNAMES.

Caching and request behavior
----------------------------

- Static files do not invoke Functions.
- HTML revalidates; service-worker/version files are no-store.
- CSS/JS use bounded revalidation and images use a longer static cache.
- Public settings and class lists have short browser/HTTP TTLs and reuse
  pending requests.
- Authenticated and user-specific API responses are no-store.
- Staff modules load on selection; inactive modules do not poll.
- Desktop Applications auto-refresh is off by default and visible-only if the
  user enables it.

Firestore maintenance
---------------------

Enable TTL policies for ExpiresAt in:

- requestIdempotency
- staffLoginAttempts
- staffPasskeyOptionAttempts
- staffPasskeyChallenges
- documentUploadOperations
- outbound-email operation records that expose ExpiresAt

Large collections must use page tokens. Unpaginated compatibility calls stop
after a bounded number of pages and fail rather than silently truncating.
Desktop backup export follows the returned cursor and page token.

Verification
------------

Source verification may be run without compiling the desktop application:

- node --check on changed JavaScript files
- JSON parsing for _routes.json, manifest and configuration
- Python ast.parse on changed .py files
- node --test tests/*.test.mjs tests/payroll/*.test.mjs

Do not build/package/compile the desktop app, deploy, or push unless the user
explicitly requests it.

Full assessment
---------------

See CLOUDFLARE_FREE_PLAN_OPTIMIZATION.md for:

- route inventory and frontend callers
- request/read estimates
- changes implemented
- Cloudflare dashboard actions
- remaining risks
- verification/deployment procedure
