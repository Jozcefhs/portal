# Mandatory Firestore index deployment

Every production web deployment is gated by the checked-in Firestore index
definition. The school and church Cloudflare Pages jobs start only after
`firestore.indexes.json` has been accepted by their respective Firebase
projects.

## GitHub repository variables

Create these non-secret variables under **Settings > Secrets and variables >
Actions > Variables** in `Jozcefhs/portal`:

| Deployment | Project ID | Workload Identity provider | Index service account |
| --- | --- | --- | --- |
| School | `SCHOOL_FIREBASE_PROJECT_ID` | `SCHOOL_GCP_WIF_PROVIDER` | `SCHOOL_GCP_INDEX_SERVICE_ACCOUNT` |
| Church | `CHURCH_FIREBASE_PROJECT_ID` | `CHURCH_GCP_WIF_PROVIDER` | `CHURCH_GCP_INDEX_SERVICE_ACCOUNT` |

The provider value is the full resource name, for example
`projects/123456789/locations/global/workloadIdentityPools/github/providers/portal`.
The service-account value is its email address. Do not store a service-account
JSON key in the repository.

## Required Google Cloud access

For each Firebase project:

1. Create or select a service account dedicated to index deployment.
2. Grant it `roles/datastore.indexAdmin` on that Firebase project.
3. Allow only the `Jozcefhs/portal` GitHub repository to impersonate it through
   the configured Workload Identity provider by granting
   `roles/iam.workloadIdentityUser`.
4. Put the project-specific provider and service-account values in the GitHub
   variables listed above.

The workflow uses GitHub's short-lived OpenID Connect identity and Google
Application Default Credentials. It does not require `FIREBASE_TOKEN` or a
downloaded private key.

## Deployment behavior

The reusable `.github/workflows/deploy-firestore-indexes.yml` workflow validates
both JSON files and runs:

```text
npx --yes firebase-tools@15.24.0 deploy --only firestore:indexes --project PROJECT_ID --non-interactive
```

Both Cloudflare workflows declare `needs: firestore-indexes`. Missing variables,
authentication errors, invalid JSON, or a rejected index deployment therefore
stop the website deployment.

## Adding another organisation

Create a dedicated deployment workflow for the organisation, add a
`firestore-indexes` job that calls the reusable workflow with that Firebase
project's three variables, and make its Pages deploy job depend on the index
job. This makes index provisioning part of onboarding instead of a manual
afterthought.

For repository merge protection, also make the organisation's Firestore index
job a required status check for `main` in the GitHub branch ruleset.
