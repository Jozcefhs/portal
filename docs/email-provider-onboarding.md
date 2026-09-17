# Organisation email providers

Dynamax supports an organisation-wide transactional email provider. Existing
deployments remain on Brevo unless a Super Administrator explicitly connects a
Google Workspace or Gmail account.

## One-time Dynamax platform setup

Google email onboarding uses one central OAuth application. Tenant users never
enter a Gmail password or create their own Google Cloud project.

1. In Google Cloud, enable the Gmail API for the Dynamax OAuth project.
2. Configure the OAuth consent screen. The public SaaS application must be
   prepared for Google's production verification because `gmail.send` is a
   sensitive scope. Test users may be used while the app remains in testing.
3. Create a Web application OAuth client.
4. Add this exact authorised redirect URI:

   `https://dynamaxms.pages.dev/api/google-email-callback`

5. Add these repository secrets in GitHub:

   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`

6. Run **Deploy Dynamax platform**, or push the release to `main`. The platform
   workflow synchronises both values to the central Cloudflare Pages project as
   encrypted secrets. If neither secret exists, deployment still succeeds and
   Brevo remains available. Supplying only one is treated as a configuration
   error.

Do not put the OAuth client secret, tenant refresh tokens, or Gmail passwords in
source files, Firestore documents, GitHub variables, browser storage, logs, or
support messages.

## Organisation connection flow

1. A tenant Super Administrator opens **Settings → Documents → Email delivery**
   while editing **Organisation defaults**.
2. Choose **Connect Google Workspace / Gmail**.
3. Google shows its consent page. The administrator should connect a dedicated
   organisation mailbox rather than a personal employee mailbox.
4. After consent, the central callback validates the one-use state, installs
   the refresh token and connected address directly into that tenant's
   Cloudflare Pages encrypted secrets, and queues only that tenant for
   deployment.
5. The deployment scheduler normally applies the provider within five minutes.
   Reload Settings and send one test email before relying on the connection.

Branches inherit the organisation provider. They may retain branch-specific
sender names and reply-to addresses, but cannot replace organisation
credentials. A Google message is delivered from the connected mailbox; a
different configured sender address becomes Reply-To unless Google has approved
that identity for the connected account.

Choosing **Use Brevo** first creates a durable tenant deployment outbox, then
stages `EMAIL_PROVIDER=brevo` and removes the tenant Gmail secrets from the next
Pages deployment. Dynamax does **not** revoke the live Google grant during this
transition because the current production deployment may still need it until
Brevo readiness is verified. After the Brevo deployment is live, an
administrator may revoke the old Dynamax grant manually in the Google account's
security settings. Existing `BREVO_API_KEY` secrets and working legacy
server-side Brevo credentials are not removed.

Google callback completion also writes its non-secret pending metadata and
deployment outbox before staging encrypted Pages secrets. Consequently, once a
Pages credential update succeeds, a later metadata or one-use OAuth-state write
cannot strand the credential without a deployment request. Those final writes
are retried and may remain pending without reporting a false failure to the
administrator. Dynamax never forces a Brevo rollback after staging Google, so a
Google-to-Google reconnect cannot delete the previously working provider. A
A failure before Pages staging, or an authoritative Cloudflare rejection,
cancels only that exact queued transition and revokes the newly issued, unused
Google grant on a best-effort basis. An ambiguous network outcome remains
queued for verification and is not revoked. The authorization code is claimed
before exchange and can never be exchanged twice.

Before a queued provider deployment is marked complete, the deployment worker
calls `/api/email-provider-readiness`. That endpoint returns only the effective
provider, a readiness boolean, and the staged deployment timestamp. The worker
requires all three values to match the queue; credentials and connected email
addresses are never returned.

## Delivery boundaries

- Google Workspace / Gmail is intended for normal-volume receipts, admissions,
  parent notices, clinic reports, and official correspondence.
- Brevo remains the supported provider for bulk campaigns and newsletters.
- Dynamax platform activation and subscription messages always use the central
  platform sender; they never fall back to a tenant mailbox.
- There is no automatic provider failover after an uncertain network result,
  because sending the same message again through another provider can create a
  duplicate.

Changing the email provider does not change a subscription plan or enable a
module that the plan does not include.

## Runtime variables

The tenant deployment receives these encrypted variables after a successful
connection:

- `EMAIL_PROVIDER=gmail`
- `EMAIL_PROVIDER_DEPLOYMENT_REQUESTED_AT`
- `GMAIL_OAUTH_CLIENT_ID`
- `GMAIL_OAUTH_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `GMAIL_CONNECTED_EMAIL`

Legacy tenants without `EMAIL_PROVIDER` continue to resolve to Brevo. This is
intentional for a no-downtime migration.
