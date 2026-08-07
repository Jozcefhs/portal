# Multi-organisation deployment

The portal uses one source repository and one deployment workflow while keeping every organisation in its own Firebase project and Cloudflare Pages project. Dynamax subscriber registrations, plan pricing and subscription payments live in a separate central platform Firestore project; see `docs/dynamax-platform-firestore.md`.

## Registry

`deploy/organisations.json` is the non-secret deployment registry. Add one object for each organisation. The `indexProfile` controls which authoritative Firestore index manifest is deployed:

- `school` uses `firebase.school.json` and `firestore.school.indexes.json`.
- `church` uses `firebase.church.json` and `firestore.church.indexes.json`.

Do not put private keys, API tokens, payment credentials or email credentials in the registry.

Validate the registry locally with:

```powershell
npm run validate:organisations
```

## Shared repository configuration

Create these repository-level GitHub Actions values:

### Variables

- `GCP_WIF_PROVIDER`: full Workload Identity provider resource name. The same provider can serve every registered organisation.
- `MULTI_ORG_DEPLOY_ENABLED`: keep this `false` while configuring the first environments, then set it to `true` to deploy every enabled registry entry after a push to `main`.

### Secret

- `CLOUDFLARE_API_TOKEN`: token allowed to deploy the registered Pages projects. Override this with an environment secret when an organisation uses a separate Cloudflare account or restricted token.

No Google service-account JSON key is required.

## Per-organisation GitHub environment

Create the `githubEnvironment` named in the registry, for example `production-digc-suite`. Add these environment variables:

- `FIREBASE_PROJECT_ID`: exact Firebase/Google Cloud project ID.
- `GCP_INDEX_SERVICE_ACCOUNT`: service-account email for this Firebase project.

The repository-level `GCP_WIF_PROVIDER` remains visible unless the environment overrides it. The non-secret Cloudflare account ID belongs in the organisation registry, allowing future organisations to use another Cloudflare account. The deployment service account must have `roles/datastore.indexAdmin` on its own Firebase project and must trust the shared GitHub Workload Identity provider.

## Cloudflare Pages runtime configuration

Create the `cloudflareProject` named in the registry and configure its production Variables and Secrets. At minimum the Functions backend requires:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` as an encrypted secret
- `DYNAMAX_WORKSPACE_ID`, exactly matching `workspaceId` in the registry
- `ORGANISATION_EDITION`, exactly matching `edition` in the registry

Add the organisation-specific Paystack, email, notification and document-storage secrets needed by its enabled modules. Runtime secrets belong to the Pages project, not GitHub and not the registry.

Do not add `DYNAMAX_PLATFORM_FIREBASE_*` credentials to organisation projects. Configure the restricted subscription proxy to the central Dynamax host instead. This prevents a compromised subscriber deployment from gaining direct database access to every subscriber record.

## Deployment

Every push to `main` validates the registry. When `MULTI_ORG_DEPLOY_ENABLED` is `true`, it deploys every enabled organisation, with at most three deployments running together. A failure in one matrix entry does not cancel the other organisations.

Use **Actions → Deploy organisations → Run workflow** to deploy one organisation by its registry `id`, or enter `all`. Manual deployment remains available while automatic deployment is disabled.

Each deployment:

1. Loads configuration from the organisation's GitHub environment.
2. Authenticates to Google Cloud with short-lived Workload Identity credentials.
3. Applies the edition-specific Firestore indexes.
4. Uploads the shared application to the organisation's Cloudflare Pages project.
5. Verifies that `/api/settings` reports the expected workspace and edition.

## Adding an organisation

1. Create its Firebase project and Firestore database.
2. Create a project-specific index deployment service account.
3. Grant that account `roles/datastore.indexAdmin` and Workload Identity access for `Jozcefhs/portal`.
4. Create its Cloudflare Pages project and runtime variables/secrets.
5. Create its GitHub environment and the two required environment variables.
6. Add the organisation to `deploy/organisations.json` with `enabled: false`.
7. Validate locally and push the registry change.
8. Manually verify the environment, then set `enabled: true` and deploy only that organisation.

For the initial migration, configure and manually deploy `destinychristianacademy` and `digc-suite`. Set `MULTI_ORG_DEPLOY_ENABLED` to `true` only after both succeed.

## Rollback and index safety

Redeploy an earlier application commit to roll back application code. Firestore index deletion is not an application rollback: add required indexes before deploying dependent code, and remove obsolete indexes only in a later reviewed release after all organisations have migrated.
