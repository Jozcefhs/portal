# Dynamax platform Firestore

Dynamax has one control-plane Firestore project for subscriber administration. It must not be an organisation's school, church or other-organisation project.

## Provisioned platform project

The dedicated control plane was provisioned with these non-secret identifiers:

- Firebase/Google Cloud project: `Dynamax Platform`
- Project ID: `dynamax-platform-504906`
- Project number: `665142705074`
- Firestore database: `(default)`, Standard edition, production mode
- Firestore location: `africa-south1` (Johannesburg)
- Runtime service account: `dynamax-platform-runtime@dynamax-platform-504906.iam.gserviceaccount.com`
- Runtime role: `Cloud Datastore User`
- Central Cloudflare Pages project: `dynamaxms`
- Production platform variables: configured on 2026-08-08
- Legacy central proxy variables for `digc-suite`: removed
- One-time migration: completed and idempotency-verified on 2026-08-08

Use `dynamax-platform-504906` for `DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID`. The project named `dynamax-platform` is not this control-plane database and must not be substituted.

## Data boundary

The central project owns only Dynamax commercial and onboarding data:

- `tenantRegistrations`: subscriber organisations, contacts, selected plans and activation state.
- `subscriptionPayments`: Dynamax subscription-payment intents and confirmations.
- `settings/dynamaxPlanCatalog`: central plan prices, limits, feature lists and Paystack plan codes.
- `requestIdempotency`: temporary retry protection created by registration requests.

Each organisation project continues to own its operational records: people, attendance, finance, donations or fees, HR, documents, notifications and organisation settings. Central subscriber APIs now fail closed when the Dynamax project credentials are absent; they never fall back to `FIREBASE_*`.

## Central Pages project

The dedicated Google Cloud/Firebase project, Firestore `(default)` database and least-privilege runtime service account are provisioned. On the central Dynamax Cloudflare Pages project, add:

- `DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID=dynamax-platform-504906`
- `DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL=dynamax-platform-runtime@dynamax-platform-504906.iam.gserviceaccount.com`
- `DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY` as an encrypted secret
- `PAYSTACK_SECRET_KEY` as an encrypted secret for Dynamax subscription billing
- `ADMIN_WEB_PASSWORD` as an encrypted secret for plan administration

Do not set `FIREBASE_PROJECT_ID` to a subscriber project on the central deployment. If both project IDs are present, the API rejects a configuration where they are equal.

Cloudflare supports production and preview Variables and Secrets separately. Configure the central values in both environments only when preview is intentionally allowed to reach the platform database. See [Cloudflare Pages bindings and secrets](https://developers.cloudflare.com/pages/functions/bindings/).

The platform index manifest is `firebase.platform.json`. The current subscriber queries use Firestore's automatic single-field indexes, so `firestore.platform.indexes.json` intentionally has no composite indexes.

## Creating the runtime credential yourself

Repeat these steps when a new central platform project needs its own credential:

1. Open Google Cloud Console and select the platform project.
2. Go to **IAM & Admin → Service Accounts → Create service account**.
3. Use a clear name such as `Dynamax Platform Runtime` and an ID such as `dynamax-platform-runtime`.
4. Under **Permissions**, select **Cloud Datastore User**. This permits document reads and writes without granting project administration.
5. Finish creating the account, open it, and select **Keys → Add key → Create new key → JSON → Create**.
6. Keep the downloaded JSON outside the source repository. Never commit it, email it or paste it into a public issue.
7. In the JSON, use `project_id` as `DYNAMAX_PLATFORM_FIREBASE_PROJECT_ID`, `client_email` as `DYNAMAX_PLATFORM_FIREBASE_CLIENT_EMAIL`, and `private_key` as the encrypted `DYNAMAX_PLATFORM_FIREBASE_PRIVATE_KEY` secret.
8. After the secret is configured and verified, store the JSON in a protected credential vault or delete the local copy. If it is ever exposed, delete that key in the service account's **Keys** tab and create a replacement.

The runtime accepts either real line breaks or escaped `\n` sequences in the private-key value.

## Organisation Pages projects

Keep the existing organisation-specific `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`. Do not copy the platform service-account private key into subscriber Pages projects.

To expose registration, pricing and subscription payment from an organisation-branded portal, proxy only those routes to the central Dynamax deployment:

- `ALLOW_CANONICAL_API_PROXY=true`
- `CANONICAL_PORTAL_URL=https://<central-dynamax-host>`
- `CANONICAL_API_PROXY_SCOPE=platform-subscriptions`

The middleware gives the central route priority even when the organisation has its own local Firestore backend. Staff and operational APIs continue to use the organisation database and cannot pass through the restricted proxy.

## One-time migration from `digc-suite`

The migration utility is non-destructive and runs as a dry run unless `--apply` is supplied. Provide the old project credentials through `SOURCE_FIREBASE_*` and the new central credentials through `DYNAMAX_PLATFORM_FIREBASE_*`, then run:

```powershell
npm run migrate:dynamax-platform
npm run migrate:dynamax-platform -- --apply
```

It copies the plan catalog, registrations and subscription payments only when the target document does not already exist. It never deletes or changes the source project. After verifying counts and payment records in the central Firestore console, remove the obsolete platform collections from the subscriber project in a separate, explicitly approved cleanup.

The completed migration copied one plan catalog, one tenant registration and one subscription payment. A second apply run created zero documents and skipped the three existing target documents, confirming that the target records are present without duplicates. The source records remain untouched.

## Deployment order

1. Create the central Firebase/Google Cloud project and Firestore database.
2. Apply `firebase.platform.json` to that project.
3. Configure the central Pages project variables and secrets.
4. Run and verify the dry-run migration, then apply it once.
5. Deploy the central Pages source and verify `/api/plan-catalog` and the pricing-book download.
6. Point each subscriber Pages project at the central host with the restricted proxy variables.
7. Verify registration, Paystack callback and webhook delivery before removing old records.
