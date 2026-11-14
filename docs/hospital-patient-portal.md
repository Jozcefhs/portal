# Hospital patient and guardian financial portal

Scope: H12 patient/guardian financial access, H07 billing and F01/F02/F03/F05 security, isolation, audit and efficient data access. Web companion only in this increment. Patient NFC cards remain staff identity lookup; they do not authenticate the portal.

## Reception workflow

1. Open **Patients and NFC cards**, find the patient and open the saved registration.
2. Select **Patient / guardian portal access**. This explicitly loads up to 30 recipients for that patient and branch.
3. Choose Patient or Guardian; enter the recipient's name, contact, relationship where relevant, expiry and reason. Verify identity and authority before checking both confirmations. Emergency contact status alone does not authorise access.
4. Create the invitation and share the private link with that recipient. This action does not send email. The activation link is valid for seven days, or until the earlier access expiry.
5. The recipient sets a password of at least 12 characters. Thereafter they use their portal access code and password at `/hospital-portal.html`. Each grant covers one patient in one branch; a guardian with multiple patients needs a separate grant for each.

**Replace invitation** invalidates the old invitation, password and all sessions for that grant. Use it after identity verification for forgotten passwords or a compromised device. **Revoke** ends access immediately on subsequent server requests and retains the access record and audit history. Previously viewed/downloaded documents cannot be recalled. Grants may last up to one year and are never inferred from names, admission numbers, NFC cards or appointment booking links.

## Patient documents

Sign-in retrieves identity and permissions only. Choose document type and a date range of up to 93 days, then load. Pages contain at most 30 documents. Repeated loads and previous-page navigation reuse a bounded in-memory cache; Refresh explicitly requests newer data. Printing or saving the browser's print output as PDF uses the document already loaded.

- **Invoices:** original patient share, credit adjustments, net payments/allocations and remaining patient balance. HMO/corporate shares are shown separately and are not presented as patient debt.
- **Payments and deposit allocations:** original received/allocated amount, refunds and amounts returned to deposits. Deposit allocations are clearly labelled as allocations rather than additional cash receipts.
- **Advance deposits:** receipt amount, refunds, applied amount and unused balance.

The portal reads existing billing documents; it does not create copies, invoices, payments, refunds, deposits or ledger entries. It does not initiate online payments. Clinical records, investigations and discharge documents require a separate future release/consent workflow and are not exposed here.

## Security and record preservation

Access is checked on every server request against the live grant, session, patient registration, branch and Hospital subscription. Public callers cannot choose a patient/branch or retrieve another patient's document by guessing its identifier. Only patient payments and patient deposits are exposed; HMO/corporate remittances are excluded.

Invitations and sessions are stored as hashes, not plaintext bearer links. Passwords use a random salt, versioned PBKDF2-SHA256 and a server-side HMAC pepper. Password verification uses constant-time comparison. The secret is `HOSPITAL_PORTAL_SECRET`, falling back to the existing staff/backend session secret; it is never sent to the browser. Authentication has persisted per-recipient and per-IP limits. HTTPS cookies are host-only, Secure, HttpOnly and SameSite=Strict; POST Origin is checked. The response excludes the session token.

Sessions expire after 30 minutes without rolling writes; the page also closes after ten idle minutes. Sign-out, page exit, expiry and restored browser pages clear private UI/cache. No patient data or credentials are saved to browser local/session storage or the service-worker cache. Invitation fragments are removed from the address bar before API calls. Access replacement, revocation and password changes invalidate existing sessions without scanning every session document.

Grant changes use existing operation receipts, deterministic recipient identities, revision checks and conditional commits. Concurrent or retried requests cannot create duplicate recipient grants. Authentication retains attributable events, while financial viewing/printing does not write per-document audit records. Login counters and access/session events are security writes. Auth/access commits also conditionally rewrite unchanged registration fields to guard concurrent patient-scope changes. No clinical or financial fields are modified. Expired sessions and audit records are retained; a retention policy is future work, not an implied deletion.

## Query and verification evidence

Four additive indexes support patient/branch grant lookup and dated patient invoices, receipts and deposits. No existing index is removed. Financial list queries request at most 31 rows to show 30 and determine continuation. Cursors are bound to recipient, document type and dates. Document access is a direct scoped lookup. No polling, background history scan, per-row patient fetch or print request is used.

Local verification on 14 November 2026: **4,959 repository tests passed**. Eight portal backend cases cover branch/patient isolation, guardian authority, concurrent activation, retries, permission/entitlement changes, revocation, password change, expiry, rate limits, pagination, financial field whitelisting and unchanged billing records. The patient portal browser flow covers desktop/390-pixel layout, activation, password sign-in/change, invoices/receipts/deposits, cached loads, printing without reads/writes and clearing in-flight responses on sign-out. Existing billing, patient self-booking and clinic queue browser checks also passed. Live deployment evidence is recorded in the owner-demo guide after rollout.

No desktop compilation or installer release is part of this increment.
