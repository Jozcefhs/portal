# Firestore production setup

## Billing and indexes

1. Upgrade the Firebase project to the Blaze plan.
2. Configure the mandatory GitHub index-deployment gate described in
   `docs/firestore-index-deployment.md`.
3. For an exceptional manual deployment, install and authenticate the Firebase
   CLI, then run from this portal directory:

   `firebase deploy --only firestore:indexes --project YOUR_PROJECT_ID`

The application uses automatic single-field indexes for direct equality and `IN`
queries. `firestore.indexes.json` contains the compound indexes used by payment,
invoice, store-order, accounting, and health views.

## One-time data optimization

After deployment, sign in to the desktop app as Super Admin and invoke the backend
action `optimizeFirestoreData` once. It preserves all records and adds normalized
lookup fields to payments, ledger rows, invoices, form sales, applications, students,
store orders, and clinic records. The action is safe to run again.

New payments do not depend on this migration: they use deterministic Paystack
references immediately.

## Monitoring

In Google Cloud Console, open Monitoring > Alerting and create policies for the
Firestore database:

- Document reads: warning at 25,000/day and critical at 40,000/day.
- Document writes: warning at 10,000/day and critical at 16,000/day.
- HTTP 429 errors: critical when the count is greater than zero for five minutes.
- Cloudflare backend 5xx rate: warning above 1% for five minutes.

When billing is enabled, replace the free-tier percentages with operational budgets
that fit the school's expected traffic. Configure email/SMS notification channels
before enabling the policies.

The protected backend action `getSystemHealth` checks pending payment intents,
payments left in processing, and recent payments without accounting journals.

## Payment guarantees

- Every checkout creates `paymentIntents/{paystackReference}`.
- Verification checks the expected amount and student identity.
- `payments/{paystackReference}` is created only once.
- Ledger, store order, gateway-charge, and accounting-journal IDs are deterministic.
- Repeated Paystack callbacks return the existing payment instead of crediting twice.
- Application-form revenue is posted immediately to account 4010 using the net
  settlement, while gross collection and Paystack charges remain separately auditable.
   
