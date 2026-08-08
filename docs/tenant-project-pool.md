# Dynamax tenant project pool

Dynamax can keep isolated School, Church and Other Organisation deployments ready before a subscriber arrives. The pool removes most onboarding delay without sharing operational data between organisations.

## Permanent architecture

- The Dynamax control plane owns the pool inventory, provisioning queue and subscriber-to-project assignment.
- Every pool slot has its own Google Cloud/Firebase project, Firestore database, runtime service account and Cloudflare Pages project.
- A ready project uses a permanent generic project ID such as `dynamax-tenant-sch-...`. Firebase project IDs cannot be renamed.
- A subscriber that requires its name in the project ID must use **Branded project ID** mode and wait while that new project is provisioned.
- The source application remains shared, but subscriber data and service-account credentials never are.

The default target is two ready projects for each edition. Change the targets under **Dynamax administration -> Plans and pricing -> Ready project pool -> Pool settings**.

## Assignment rules

1. A Free registration receives a ready project when its seven-day trial activates.
2. A paid registration receives a ready project only after Paystack confirms the payment.
3. Assignment updates the pool slot and subscriber registration in one conditional Firestore commit. Two simultaneous registrations cannot claim the same project.
4. When capacity is empty, the subscription remains valid, the registration is marked **Waiting for ready project**, and a replenishment request is queued. Payment confirmation is never lost.
5. Assigned projects cannot be released while the related subscriber is paid, active or trialling.
6. Each successful assignment checks the saved target and queues replacement capacity when necessary.

## First administrator activation

When a ready project is assigned, Dynamax creates a 48-hour, single-use activation link for the registered contact. The link opens on the assigned tenant URL, never on a different subscriber's portal.

1. The central platform saves only the SHA-256 hash of the activation token in `tenantActivations`; the raw token is present only in the returned/email link fragment.
2. The subscriber chooses the first administrator's display name, username and password on the assigned portal.
3. The password is posted only to `/api/complete-tenant-activation` on that tenant. It is hashed there and never sent to or stored in the Dynamax control-plane database.
4. One atomic tenant Firestore commit creates `settings/firstAdministrator`, the `staffUsers` Super Administrator, the organisation profile and its audit record. The non-overwrite precondition prevents simultaneous links from creating multiple owners.
5. After local creation, the tenant marks the central activation used. Any other pending link for that registration stops working because the registration now has `AdminActivatedAt`.
6. The administrator then signs in at `admin.html` with the username and password just created. A signed-in Super Administrator can open organisation settings even when that tenant has no legacy `ADMIN_WEB_PASSWORD` variable.

The activation link is displayed immediately after Free registration or confirmed Paystack payment when the project is ready. If capacity was pending, it is emailed when assignment completes. Repeating the same organisation registration safely issues a new link if the first administrator has not yet been created.

To email delayed activation links, configure these on the central `dynamaxms` Pages project (not on every tenant):

- `BREVO_API_KEY` as an encrypted secret.
- `DYNAMAX_SENDER_EMAIL` as a verified Brevo sender address; `BREVO_SENDER_EMAIL` is accepted as a fallback.
- `DYNAMAX_SENDER_NAME`, normally `Dynamax`.

Email failure never loses the subscription or project assignment. The central registration records the delivery status, and the registrant can repeat the same registration to obtain a fresh activation button.

## Central Firestore records

- `tenantProjectPool`: ready, assigned, provisioning and failed project slots.
- `tenantProvisioningRequests`: manual, branded and automatic replenishment requests.
- `tenantActivations`: hashed, expiring first-administrator activation challenges and their used state.
- `settings/tenantPoolPolicy`: edition targets, default Firestore region and project prefix.
- `tenantRegistrations`: receives `WorkspaceId`, `FirebaseProjectId`, `CloudflareProject`, `PortalUrl` and provisioning state after assignment.

These records contain identifiers, status and hashed activation challenges only. They do not contain tenant Firebase private keys, Cloudflare tokens, administrator passwords or subscriber operational data.

## One-time GitHub configuration

The workflow is `.github/workflows/provision-tenant-pool.yml`. Add the following repository variables:

- `DYNAMAX_PLATFORM_URL`: central Dynamax Pages URL; current value is `https://dynamaxms.pages.dev`.
- `CLOUDFLARE_ACCOUNT_ID`: account that will own the ready Pages projects.
- `GCP_WIF_PROVIDER`: full GitHub Workload Identity provider resource name.
- `DYNAMAX_PROVISION_SERVICE_ACCOUNT`: service-account email used only by the provisioner.
- `DYNAMAX_PROVISION_PROJECT_ID`: Google project that owns the Workload Identity configuration.
- `DYNAMAX_GCP_BILLING_ACCOUNT`: billing account linked to new tenant projects.
- `DYNAMAX_GCP_PARENT`: optional `folders/123...` or `organizations/123...` parent.
- `DYNAMAX_TENANT_REGION`: Firestore region, for example `eur3`.
- `DYNAMAX_TENANT_PROJECT_PREFIX`: short lowercase prefix; default is `dynamax-tenant`.
- `TENANT_POOL_AUTOMATION_ENABLED`: keep `false` until a dry run and one live project both succeed; set `true` to let the scheduled worker process queued requests.
- `TENANT_POOL_FLEET_DEPLOY_ENABLED`: set `true` after the pool is verified to deploy future `main` updates to all Ready and Assigned pool projects.

Add these repository secrets:

- `DYNAMAX_ADMIN_WEB_PASSWORD`: same administrator secret configured as `ADMIN_WEB_PASSWORD` on the central Dynamax Pages project.
- `CLOUDFLARE_API_TOKEN`: account-scoped token with **Pages Write**. Do not use the Global API key.

The GitHub provisioner identity needs permission to create projects under the chosen parent, link the billing account, enable services, add Firebase, create Firestore databases and indexes, manage the tenant runtime service account and create its key. A practical initial role set is Project Creator on the parent, Billing Account User on the billing account, plus Service Usage Admin, Firebase Admin, Cloud Datastore Owner, Project IAM Admin, Service Account Admin and Service Account Key Admin in the provisioning boundary. Reduce this to a reviewed custom role after the first successful rollout.

The runtime service account created inside each tenant receives only Cloud Datastore User and Firebase Cloud Messaging Admin. Its private key is written directly to that tenant's Pages encrypted variables and the temporary workflow file is deleted.

## First controlled run

1. Open **Actions -> Provision Dynamax tenant pool -> Run workflow**.
2. Leave **dry run** checked. The run shows the next queued request and proposed project IDs without creating resources.
3. Review the edition, count, region and billing account.
4. Run it again with **dry run** unchecked.
5. Confirm the new project appears as **Ready** in the project-pool table and that its Pages URL loads.
6. Repeat until the saved targets are filled.
7. Set `TENANT_POOL_AUTOMATION_ENABLED=true` only after the live result is verified.

The scheduled workflow checks twice an hour but processes nothing unless that repository variable is true. Only one provisioning run can execute at a time.

Use **Actions -> Deploy tenant project pool** to update one pooled Firebase project or all of them. When `TENANT_POOL_FLEET_DEPLOY_ENABLED=true`, each push to `main` also updates the complete pooled fleet with at most three deployments at once.

## What the worker creates

For each requested project, the worker:

1. Creates and bills the Google Cloud project.
2. Enables Firebase, Firestore, Identity Toolkit, Cloud Messaging, IAM and Service Usage APIs.
3. Adds Firebase, creates the `(default)` Firestore database and a Firebase web app.
4. Creates a tenant-only runtime service account.
5. Applies `firebase.school.json`, `firebase.church.json` or `firebase.organization.json` indexes.
6. Creates or updates the Cloudflare Pages project with encrypted runtime credentials and the restricted central subscription bridge.
7. Direct-uploads the existing application files without compiling them.
8. Registers the completed slot in the Dynamax pool and completes the queue request.

Paystack, organisation email, document storage, custom domains and other subscriber-owned integrations are intentionally not copied from another organisation. Configure them after assignment when that subscriber enables the relevant service.

## Capacity and cost controls

Ready projects are real billable resources, so do not create an unlimited inventory. Keep a small warm target and replenish as projects are assigned. Firebase quotas are isolated per Google project; Cloudflare Pages usage remains governed by the Cloudflare account and plan that owns the projects.

Project deletion is deliberately not automated. Failed or obsolete projects must be reviewed in Google Cloud and Cloudflare before any manual removal.
