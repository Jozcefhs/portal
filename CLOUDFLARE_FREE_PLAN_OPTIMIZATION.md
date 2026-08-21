# Cloudflare Free-plan optimization and security review

Date: 2026-07-28  
Scope: the canonical `portal` and its desktop `suite` callers  
Deployment target: Cloudflare Pages project `digc-suite`

## Executive summary

The original Pages middleware was eligible to run for HTML, JavaScript, CSS, images, the manifest, and every API request. A normal page load could therefore spend roughly 7-15 Function invocations before the user performed a business action. The new `_routes.json` limits Pages Functions to `/api` and `/api/*`; static files are served directly by Pages.

The review also found repeated public settings/class requests, broad dashboard collection reads, optimistic read-modify-write flows, weak retry semantics around payments and uploads, unbounded request bodies, mutable desktop role claims, login/passkey race conditions, and credentials that could fall back to less safe storage. The source changes address the high-risk items without replacing the existing application architecture.

The largest remaining Free-plan risk is a role with access to the full accounting/admin overview. That view still combines many logical collections in one request. It is now role-gated and avoids duplicate preload reads, but a very large collection requiring multiple Firestore pages could approach Cloudflare's external-subrequest limit. Large tables should continue moving to explicit page-token APIs as their data grows.

Relevant current limits:

- Pages Functions use Workers quotas. The Workers Free plan currently permits 100,000 requests per day and 50 external subrequests per invocation.
- Static Pages asset requests that do not invoke Functions do not consume the Functions request allowance.
- Firestore's no-cost quota currently includes 50,000 document reads and 20,000 document writes per day.

Official references:

- <https://developers.cloudflare.com/pages/functions/pricing/>
- <https://developers.cloudflare.com/workers/platform/limits/>
- <https://developers.cloudflare.com/pages/functions/routing/>
- <https://cloud.google.com/firestore/pricing>

## Baseline findings

### Highest priority

1. There was no committed `_routes.json`, so the root Pages middleware could run for static assets.
2. Payment/form-payment verification paths could process the wrong transaction class if metadata and saved intent data disagreed.
3. Ambiguous external side effects could lose their idempotency claim and be repeated.
4. Payment and form-sale markers could say “already recorded” while dependent accounting records remained incomplete.
5. Upload retries could leave an unresolved claim or duplicate an external Drive upload.
6. Staff session GET trusted the session payload without always rechecking the live staff record.
7. Passkey challenges and counters had concurrent reuse windows.
8. Password throttling could become a global username lockout rather than a source-partitioned control.
9. Desktop financial actions could trust a caller-supplied role when an authoritative staff actor was available.
10. Desktop secret storage could fall back to a plaintext-like settings path.

### Request and data efficiency

- Public settings were requested independently by multiple pages and returned more fields than a public client needed.
- Admission classes and document settings were repeatedly fetched across navigation.
- The admin dashboard loaded collection groups that a limited staff role could not use.
- Accounts overview could reread applications, students, payments, invoices, and ledger data already loaded by the parent admin request.
- Parent activity/payable data used broad collection reads in several paths.
- The desktop Applications workspace had a one-minute auto-refresh scheduler. It is now off by default, single-flight, and only calls the backend when the workspace is visible and the user opts in.
- Records Desk search could fire while the user was still typing. It now requires three characters, waits 450 ms, and aborts superseded requests.
- Browser retries did not consistently retain the same idempotency key after a network/429/5xx response.

### Concurrency and integrity

- Important creates now use deterministic document IDs, create-if-absent semantics, Firestore update-time preconditions, batched commits, and durable idempotency leases.
- Payment, invoice allocation, form-sale accounting, passkey challenge consumption, passkey counters, payroll decisions, uploads, applications, emails, and organization registration received targeted duplicate/race protection.
- Full backup export no longer tries to read every collection in one Function invocation. It returns one Firestore page at a time with a continuation cursor and page token; the desktop client joins those parts.

## Existing Pages Function inventory

Every function below is genuinely dynamic and remains under `/api/*`.

| Route | Methods | Main caller / purpose |
|---|---|---|
| `/api/admin` | POST | Staff dashboard summary; role-gated module groups |
| `/api/admission-classes` | GET | Admission application and form-purchase class choices |
| `/api/admission-document-settings` | GET | Parent upload requirements |
| `/api/backend` | GET, POST | Authenticated desktop bridge, backup/import/accounting and operational actions |
| `/api/finance-workflow` | POST | Web requisitions, bills, review and accounts decisions |
| `/api/firestore-health` | GET | Public shallow readiness; shared-secret protected deep diagnostic |
| `/api/import-firestore` | GET, POST | Controlled desktop migration/import batches |
| `/api/income-analytics` | POST | Authorized income report aggregates |
| `/api/init-church-payment` | POST | Authorized Paystack donation-link initialization |
| `/api/init-form-payment` | POST | Public admission-form Paystack initialization |
| `/api/init-payment` | POST | Parent fee, wallet and store Paystack initialization |
| `/api/parent-dashboard` | POST | Family login, child activity/payable data and parent actions |
| `/api/passport-photo` | POST | Authorized child/application passport retrieval |
| `/api/payment-options` | POST | Parent account and payable-fee lookup |
| `/api/paystack-webhook` | POST | Signed Paystack `charge.success` processing |
| `/api/register-organization` | POST | Subscription/organization registration |
| `/api/settings` | GET, POST | Minimal public configuration; protected settings management |
| `/api/staff-approval-profile` | GET, POST | Officer signature/stamp and approval preferences |
| `/api/staff-church-payments` | POST | Donation listing/status/receipt actions |
| `/api/staff-correspondence` | GET, POST | Principal/senior-pastor official correspondence |
| `/api/staff-departments` | POST | School operational department workspaces |
| `/api/staff-document` | GET, POST | Authorized protected document view/download/delete |
| `/api/staff-funds` | POST | Religious-organization funds and mappings |
| `/api/staff-members` | POST | Organization member records |
| `/api/staff-offerings` | POST | Offering recording, approval, remittance and posting |
| `/api/staff-organization-departments` | POST | Department/member/meeting/program CRUD |
| `/api/staff-passkey` | POST | Passkey registration, sign-in and approval proof |
| `/api/staff-payroll` | GET | Authorized payroll summary and payslip PDF |
| `/api/staff-records` | POST | Debounced universal record search and details |
| `/api/staff-services` | POST | Services, attendance and related activity |
| `/api/staff-session` | GET, POST | Login, live-session validation, profile/password and logout |
| `/api/staff-stores` | POST | Store/clinic/kitchen/tuck-shop/restaurant actions |
| `/api/staff-students` | POST | Student list/profile actions |
| `/api/staff-users` | POST | Staff account and permission management |
| `/api/submit-application` | POST | Admission application submission |
| `/api/upload-document` | POST | Parent document upload and replacement |
| `/api/verify` | POST | Admission verification-code check |
| `/api/verify-form-payment` | POST | Admission-form Paystack verification |
| `/api/verify-payment` | POST | Parent/church/general Paystack verification |
| `/api/web-logo` | GET | Public configured logo response |

No other backend route family exists outside `functions/api`, so the API-only routing rule matches the actual project.

## Frontend request map and normal sessions

| Screen / flow | Normal dynamic requests after optimization | Main data work |
|---|---:|---|
| Landing page | 0-1 | Public settings; browser cache TTL is five minutes |
| Buy admission form | 0-1 class read, then 1 initialization | Admission classes are browser/edge cacheable |
| Admission application | 0-1 class read, then 1 submit | One application transaction plus notifications |
| Document upload | 0-1 requirement read, then 1 request per deliberately selected file | Each file is independently idempotent |
| Parent payment page | 1 options read, 1 initialization, 1 verification/webhook | Targeted account/fee/payment-intent work |
| Parent dashboard sign-in | 2 parallel calls | Payable summary and recent activity are split so the active tab can refresh narrowly |
| Parent child/tab switch | 0 when cached; otherwise 1-2 | Per-child memory cache plus abort of superseded requests |
| Staff sign-in + dashboard | 1 session/login and 1 role-gated dashboard request | Only the signed-in role's collection groups are loaded |
| Staff module selection | 1 request for the selected module | Other module contents are not loaded or rendered |
| Records Desk search | 1 after 450 ms | Three-character minimum; prior request is aborted |
| Desktop Applications | 0 automatic requests by default | Manual refresh; optional one-minute refresh only while visible |

Representative request estimate:

- Before: a cold landing/admin shell commonly caused 7-15 Function invocations because HTML and its static assets crossed the root middleware, plus 1-3 actual API calls.
- After: those static requests cost zero Function invocations. A landing view is 0-1 API call; a staff dashboard is normally 2 API calls; an active module adds one request.
- For a representative 10-request shell plus one settings call, the routing change reduces Function invocations from about 11 to 1 (about 91%). On a cached settings visit it falls to zero.
- Five page views within the five-minute public-settings TTL save four Function requests and up to twelve Firestore document reads, because a settings miss reads the school, organization, and branding documents.

These are source-derived estimates, not production analytics. Cloudflare Web Analytics/Workers logs should be used to establish real user percentiles.

## Database request review

| Major backend screen | Current shape | Control added |
|---|---|---|
| Public settings | Three direct settings documents | Five-minute browser cache, in-flight request sharing, minimal public field allowlist |
| Admission classes | One small settings subcollection | Browser and HTTP caching; no repeated in-flight fetch |
| Staff dashboard | Up to 17 logical data groups | Role-gated groups and scoped school branch/section reads |
| Accounts overview | Accounts/payments/invoices/fees/ledger plus student identity | Reuses preloaded arrays and scoped students/applications; avoids duplicate reads |
| Parent dashboard | Child-specific queries plus a bounded set of summaries/store records | Child cache, request abort, targeted account-summary documents |
| Records Desk | Filtered permitted record types | Minimum query length, limit 30, debounce and abort |
| Backups | Previously broad, potentially more than 50 external calls | One collection page per API call with opaque continuation |
| Bulk imports/writes | Previously long individual loops | Maximum request sizes and Firestore commit batches (up to 400 application writes per batch) |
| Settings/staff lookup | Previously collection scans in places | Direct document lookup and limited queries |

`listCollectionPage()` exposes `nextPageToken`. Legacy unpaginated callers are capped at five pages/5,000 rows and fail with `FIRESTORE_PAGINATION_REQUIRED` instead of silently truncating. New large-table work should expose this token to the UI rather than increasing that cap.

## Implemented changes

### Routing and caching

- Added API-only `_routes.json`.
- Added `_headers` for revalidated HTML, no-store service worker/version metadata, and bounded static-asset caching.
- Updated the service worker to bypass `/api/*`, use network-first navigation, and cache only static assets.
- Added public-settings and class-list TTL caches with in-flight promise sharing.
- Kept all authenticated/user-specific API responses `no-store`.

### Request reduction

- Removed repeated public settings/class/document-option requests during the cache lifetime.
- Role-gated admin data groups and scoped school reads by authenticated branch/section.
- Reused admin preload data inside Accounts Overview.
- Added per-child parent cache and `AbortController` cancellation.
- Increased Records Desk search threshold/debounce and cancels stale searches.
- Desktop auto-refresh is opt-in, visible-only, and single-flight.

### Input, abuse and session protection

- Replaced raw `request.json()` calls with bounded JSON parsing; endpoint limits range from 64 KB to 16 MB according to payload type.
- Turnstile is optional when completely unset, but fails closed if only one key is configured; action and optional hostname must match.
- Password failure limits are partitioned by username and request source.
- Public passkey-option creation has source-wide and username/source limits and returns `429` plus `Retry-After`.
- Staff session GET reloads the live active account and current access fields; disabled/deleted accounts have their cookies cleared.
- Logout and Switch User clear both cookies and the in-memory bearer token.

### Idempotency and concurrency

- Browser submit keys remain stable after network failures, 408/425/429, 5xx, malformed responses, and unresolved in-progress responses.
- Durable request records have a conditional ownership lease, fingerprint, status, replay payload and TTL field.
- Ambiguous 5xx/external outcomes are marked `Uncertain`; their claim is not deleted and automatic duplicate side effects are suppressed.
- Definite non-retryable failures are recorded as `Failed`.
- Applications, payment initialization/verification, organization registration, uploads, finance decisions and outbound email actions use idempotency controls.
- Form and general Paystack transaction classes are cross-checked against both Paystack metadata and the saved payment intent.
- Payment/form-sale retries repair deterministic dependent records rather than returning before ledger, journal, invoice or gateway-charge work is complete.
- Passkey challenges are consumed conditionally and credential counters use Firestore update-time preconditions.
- Inventory/payment/accounting writes use deterministic identifiers, conditional writes or batched commits where supported.

### Credentials and privacy

- Public settings now return an explicit field allowlist.
- Brevo API keys are read from `BREVO_API_KEY`; new submitted API keys are not written to Firestore.
- No Paystack secret, Firebase private key, staff-session secret or backend shared secret is placed in browser JavaScript.
- New desktop credential saves require Windows DPAPI and fail closed instead of creating a new plaintext fallback. Startup migration is deliberately loss-averse: if an existing plaintext settings value cannot first be written to DPAPI storage, the legacy value remains in the settings file until migration can be retried and verified.
- Structured request metrics omit bodies, passwords, tokens and payment authorization data.

### Monitoring

The API middleware emits one structured `api_request` record with:

- request ID / `CF-Ray`
- method and route
- response status
- execution duration
- Cloudflare colo
- local versus canonical-proxy backend

Selected bulk operations add received/processed counts. Firestore and other
external-call counts still need Cloudflare trace/native observability rather
than being asserted by the application logger. Logs never intentionally include
passwords, secret keys, passkey data, payment authorization material or
uploaded document content.

## Final `_routes.json`

```json
{
  "version": 1,
  "include": [
    "/api",
    "/api/*"
  ],
  "exclude": []
}
```

HTML, CSS, JavaScript, images, icons, fonts, the manifest, service worker and favicon are therefore static Pages requests.

## Environment variables and secrets

### Required core secrets/variables

- `DYNAMAX_WORKSPACE_ID` — use `school`, `faith`, or `organization` for the current desktop workspace
- `ORGANISATION_EDITION` — `school`, `faith`, or `organization` (`church` is accepted as a `faith` alias)
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` — encrypted secret
- `BACKEND_SHARED_SECRET` — encrypted secret used by the desktop bridge
- `STAFF_SESSION_SECRET` — encrypted secret
- `MFA_ENCRYPTION_SECRET` — recommended separate encrypted secret for staff authenticator seeds and recovery codes; new tenant-pool deployments generate it automatically
- `ADMIN_WEB_PASSWORD` — encrypted secret
- `ADMIN_WEB_USERNAME` — optional; defaults to `admin`

The central Dynamax Pages project additionally requires its own subscriber
database credentials. These must point to a Firebase project that is not used
by any subscriber organisation:

- `DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID`
- `DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL`
- `DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY` (encrypted secret)

### Enable only the features in use

- `PAYSTACK_SECRET_KEY`
- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL`
- `BREVO_SENDER_NAME`
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_ALLOWED_HOSTNAMES` — comma-separated hostnames
- `ALLOW_CANONICAL_API_PROXY` — must be explicitly enabled for an intentional API bridge
- `CANONICAL_PORTAL_URL` — required only when `ALLOW_CANONICAL_API_PROXY` is enabled
- `CANONICAL_API_PROXY_SCOPE` — set to `platform-subscriptions` on subscriber projects that proxy pricing and subscription routes to the central Dynamax project
- `WEBAUTHN_RP_ID`
- `WEBAUTHN_ORIGIN`
- `WEBAUTHN_RP_NAME`

Every deployment also requires the `DYNAMAX_DOCUMENTS` R2 bucket binding. It is
a binding rather than an environment variable and is created by the deployment
workflow for each Pages project.

Cloudflare Pages currently limits configured variables per environment. The source recognizes compatibility aliases, but the dashboard should contain only the canonical names above and the enabled feature set.

## Cloudflare dashboard configuration

1. Pages project:
   - Project: the subscriber's own Pages project; `digc-suite` is one subscriber, not the Dynamax control plane
   - Production branch: the repository's release branch
   - Build command: none for this static source deployment
   - Build output directory: repository/portal root as used by the existing deployment
2. Add production and preview variables separately. Use **Encrypt** for every secret.
3. Never configure only one Firebase variable. All three service-account values are required.
   School and faith deployments must use different Firebase projects. For the
   current desktop workspace registry, configure the canonical values
   `DYNAMAX_WORKSPACE_ID=school` and `DYNAMAX_WORKSPACE_ID=faith` respectively.
   The central Dynamax project uses all three `DYNAMAX_PLATFORM_FIREBASE_*`
   values and must not reuse either subscriber project ID. Subscriber projects
   must not receive the central service-account private key.
4. If Turnstile is enabled:
   - create a widget for the production/custom hostnames;
   - set both Turnstile keys;
   - include every permitted hostname in `TURNSTILE_ALLOWED_HOSTNAMES`.
5. Configure Paystack's webhook as:
   - `https://<production-host>/api/paystack-webhook`
6. Enable Firestore TTL policies for:
   - `requestIdempotency.ExpiresAt`
   - `staffLoginAttempts.ExpiresAt`
   - `staffPasskeyOptionAttempts.ExpiresAt`
   - `staffPasskeyChallenges.ExpiresAt`
   - any email/upload operation-claim collection exposing `ExpiresAt`
7. Add Cloudflare rate-limit/WAF rules for:
   - `/api/staff-session`
   - `/api/staff-passkey`
   - `/api/settings` (protected setup POST)
   - `/api/backend` and `/api/import-firestore`
   - `/api/verify`
   - `/api/payment-options`
   - `/api/init-payment`
   - `/api/init-form-payment`
   - `/api/register-organization`
   - `/api/upload-document`
   - `/api/parent-dashboard`
8. Watch Workers/Pages Functions logs for status, duration, external subrequests and `429` events.
9. Do not add a broad public Cache Rule for `/api/*`. Only the allowlisted GET endpoints already emitting public cache headers should be edge-cache candidates.

## Remaining risks and follow-up work

1. Full accounting/admin overview can still approach 50 external subrequests when several collections exceed one Firestore page. Continue converting large tables to explicit page-token endpoints.
2. Firestore reads/writes can exceed Google's free quota even while Cloudflare remains inside the Workers Free allowance.
3. API proxying is fail-closed by default. If a preview/custom-domain bridge is
   intentionally enabled, keep preview access restricted and configure both
   `ALLOW_CANONICAL_API_PROXY` and `CANONICAL_PORTAL_URL`.
4. Paystack webhook processing is synchronous. A durable queue/outbox would provide better retry isolation if webhook volume grows.
5. Browser idempotency keys other than payment verification are memory-based and do not survive a full page reload. Normal retry clicks are protected; persistent form recovery would need payload-fingerprint storage and cleanup rules.
6. Legacy payment rows created before repair markers may have one historical allocation ambiguity. New transactions close that crash window.
7. Stateless bearer tokens cannot be centrally revoked before expiry. Disabling the account blocks subsequent live checks, but a server-side session registry would enable immediate token revocation everywhere.
8. Distributed authentication attacks from many addresses still require Cloudflare WAF/rate limiting; application limits alone are not a substitute.
9. Never opt a test environment into a production `CANONICAL_PORTAL_URL` when testing mutations.
10. Existing Google Drive document references are migration-only records. The live runtime does not fetch them; migrate their bytes into the correct deployment's R2 bucket before removing the old Drive deployment.
11. The authoritative desktop-actor check is an explicit action allowlist, not a universal mutation gate. Some intentionally lower-risk, nonfinancial desktop mutations remain protected by the desktop shared secret and their local endpoint checks without reloading the staff actor. They must not be described as having authoritative role enforcement; any such action that begins making privilege-bearing, financial or security-sensitive changes should first be added to the authoritative gate and its role policy.
12. DPAPI prevents new plaintext credential saves, but it cannot guarantee removal of credentials written by older builds. If one-time DPAPI migration fails, the desktop intentionally leaves the legacy plaintext settings fields in place to avoid losing backend access. Operators must treat that file as sensitive, correct DPAPI access, rerun migration, confirm the legacy keys were removed, and rotate any credential that may have been exposed.
13. Source review and local tests cannot prove the production deployment matches this report. They do not establish the active Pages branch/artifact, `_routes.json`, encrypted-variable values, WAF/rate-limit rules, Firestore TTL policies, provider-side configuration, real quota use or live retry behavior. Those controls require an approved deployment, production-dashboard inspection and non-destructive log/trace evidence.

## Verification and deployment procedure

### Completed local verification

The canonical source was checked without compiling, packaging, deploying or pushing the desktop app:

- `_routes.json` and the available JSON configuration parsed successfully.
- `git diff --check` reported no whitespace errors.
- No merge-conflict markers were found in the scoped portal or desktop source.
- 128 JavaScript modules passed `node --check`.
- 29 desktop Python source files passed `ast.parse` with no bytecode or build output.
- The portal regression suite passed **302/302** tests.
- The desktop regression suite passed **44/44** tests using the existing Miniconda runtime with bytecode writing disabled.
- Scoped searches found no raw `request.json()` calls, application `setInterval()` polling, or private environment-variable names in browser JavaScript, HTML or JSON.

These checks validate the source contracts and pure/local behavior. They do not prove the active Cloudflare artifact, production secrets, WAF rules, provider integrations, actual Function routing, live payment callbacks, or real concurrent traffic behavior.

### Production verification runbook

The remaining production behavior may be verified without compiling the desktop app. Record the command output, deployed artifact/version and dashboard/log observations when each step is actually performed:

1. Parse `_routes.json`, manifests and other JSON configuration.
2. Run `node --check` on changed JavaScript files.
3. Parse changed Python files with `ast.parse`; do not package or compile.
4. Run the Node test suite, including routing, payment, idempotency, passkey, organization, accounting and payroll tests.
5. Confirm `rg "request\\.json\\(\\)" functions` returns no unbounded endpoint parser.
6. Scan browser source for private environment names and key-like literals.
7. Exercise static HTML/CSS/JS/image requests and confirm no Pages Function log entry is created.
8. Exercise login, a payment test transaction, a duplicate submit/retry, upload retry, paged backup and role-scoped dashboards in a non-production environment.
9. Simulate concurrent identical submissions and verify one completed operation plus replay responses.
10. After explicit approval, deploy the exact verified canonical source and inspect production logs.

No desktop compilation, installer packaging, production deployment or push is part of this review unless explicitly requested.
