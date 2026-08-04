# Mandatory Firestore index deployment

Every production deployment is gated by the index definition selected in `deploy/organisations.json`. The shared deployment workflow applies the correct index set before uploading the website to the organisation's Cloudflare Pages project.

| Index profile | Firebase CLI configuration | Index definition |
| --- | --- | --- |
| School | `firebase.school.json` | `firestore.school.indexes.json` |
| Church | `firebase.church.json` | `firestore.church.indexes.json` |

The school set contains payment, invoice, store, accounting and scoped notification composites. The church set contains shared accounting and payment-intent composites plus church staff/member notification composites. The church profile intentionally excludes school-only `SchoolSection` and `TargetAccountRefs` indexes.

## Deployment configuration

The shared `GCP_WIF_PROVIDER` repository variable contains the full provider resource name, for example:

```text
projects/123456789/locations/global/workloadIdentityPools/github/providers/portal
```

Each organisation's GitHub environment supplies:

- `FIREBASE_PROJECT_ID`
- `GCP_INDEX_SERVICE_ACCOUNT`

Do not store a service-account JSON key in the repository. See `docs/multi-organisation-deployment.md` for the complete registry, GitHub environment and Cloudflare Pages configuration.

## Required Google Cloud access

For each Firebase project:

1. Create or select a service account dedicated to index deployment.
2. Grant it `roles/datastore.indexAdmin` on that Firebase project.
3. Allow only the `Jozcefhs/portal` GitHub repository to impersonate it through the shared Workload Identity provider by granting `roles/iam.workloadIdentityUser`.
4. Add its project ID and service-account email to the organisation's GitHub environment.

The workflow uses GitHub's short-lived OpenID Connect identity and Google Application Default Credentials. It does not require `FIREBASE_TOKEN` or a downloaded private key.

## Deployment behavior

`.github/workflows/deploy-organisation.yml` validates the organisation environment and runs:

```text
npx --yes firebase-tools@15.24.0 deploy --only firestore:indexes --project PROJECT_ID --config EDITION_CONFIG --force --non-interactive
```

Missing environment variables, authentication errors, invalid JSON, or rejected indexes stop only that organisation's website deployment. Other entries in the deployment matrix continue because the coordinator uses `fail-fast: false`.

`--force` makes the selected edition manifest authoritative. Firebase can remove deployed composite indexes that are absent from the checked-in edition file. Add new indexes before deploying code that requires them. Remove obsolete indexes only in a later reviewed release after every organisation using the edition has migrated.

## Adding another organisation

Use the onboarding procedure in `docs/multi-organisation-deployment.md`. A new organisation reuses the school or church index profile; it does not need a duplicated index manifest or workflow.
