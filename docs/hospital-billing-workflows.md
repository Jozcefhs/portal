# Hospital billing and HMO workflows

Development branch: `codex/hospital-edition`. This increment implements web-companion and shared-backend billing. It is not deployed or released. The complete scope remains in [hospital-edition-scope.md](hospital-edition-scope.md).

## Access and setup

| Role | Enabled module and responsibilities |
| --- | --- |
| Hospital Cashier | Billing and payments: service charges, invoices, pharmacy-return credits, confirmed cash/bank receipts and HMO settlements. |
| HMO Officer | HMO and insurance: plans, tariffs, staff-verified visit eligibility, claims, rejection/resubmission and recorded insurer decisions. |
| Hospital Administrator / Super Admin | Configure billing accounts, administer HMO workflows, void unbilled service charges, authorise service credit notes and record refunds. These roles do not automatically receive cashier collection permission. |
| Clinical and pharmacy roles | Their existing clinical workflows continue. They do not gain billing or HMO access. |

Enabled modules, subscription and assigned branches are checked server-side. Finance roles have administrative patient/visit identification; they do not acquire consultation notes or draft/released clinical reports. Card terminal payments remain disabled. NFC patient identification is unchanged.

Before posting, an administrator opens **Billing and HMO → Billing account mappings**, loads the mappings, and selects existing chart-of-account codes for patient receivables, HMO receivables, hospital revenue, cash and bank. The four balance-sheet accounts must be active Asset accounts; hospital revenue must be an active Revenue account. Each mapping uses a separate code. Account names/codes and existing chart records are not rewritten. Mapping changes retain a version.

## Service charges and invoices

1. In Reception visits, choose dates, load the relevant visit and select **Open billing / HMO**.
2. Record consultation, procedure, bed or other service charges using a stable service reference. Laboratory/imaging charges also require their existing investigation order reference. An investigation order can be charged once. The software records the fee; it does not assert the clinical service was performed.
3. Medicine dispensing already produces its own charge. Do not enter that charge again as a service. New dispensing events include the medicine description, quantity and service code needed for tariff matching. Older events without a service code remain self-pay unless a separately authorised future migration provides that code.
4. Choose dates and **Load visit charges**. Select up to 30 unbilled positive charges. Each invoice covers one patient visit. Further charges can be issued on another invoice for that visit.
5. If applicable, select **Use the displayed verified HMO plan**. The estimate separates patient and insurer liability. Review the patient and totals, then issue the invoice.
6. The server checks all selected charges and coverage again. It stores immutable original invoice lines, the source amounts and the agreed eligibility/tariff snapshot, then claims those charge events and posts a balanced accounting journal in the same atomic commit.

For a covered service, the insurer tariff is the **total agreed unit fee**, multiplied by quantity. The configured co-payment percentage determines the patient share; the insurer owes the remainder. There is no automatic balance billing of the difference between the source fee and the agreed tariff. Uncovered services remain self-pay. Money is calculated in integer minor units, including cumulative return credits.

Use **Void mistaken charge** for an unbilled service entry; a reason is required and the original entry remains. An invoiced service requires an administrator's **Credit an invoiced service** action. Original lines, amounts and prior events remain available. Dispensed medicines use the pharmacy return process instead of service adjustments.

## HMO eligibility and claims

1. The HMO Officer creates a branch-specific plan with its insurer, plan code and up to 40 covered service tariffs. Exact plan-code lookup avoids scanning the plan collection. Existing plan versions and invoice snapshots are preserved when the plan changes.
2. Open the patient visit, find the active plan, and record membership, eligibility dates, insurer authorisation reference and how/when verification was performed. This is **staff-recorded verification**; no insurer API is contacted.
3. Eligibility is specific to that patient visit and branch. A valid date window and the current eligibility revision are required when issuing an insured invoice. The saved authorisation uses the tariff version staff verified; later plan edits do not silently replace it.
4. Issuing an invoice with an insurer share prepares one linked claim. Print the claim for the insurer. The officer records submission and the insurer's approval or rejection, with references and notes. Each transition keeps a snapshot and event history.
5. Rejected claims can be resubmitted. Rejection does not silently transfer insurer debt to the patient or write it off.
6. A cashier records confirmed insurer payments only after approval. Partial settlements retain the remainder; the last payment marks the claim settled. Posting uses the HMO receivable account and does not recognise the same revenue again.
7. A return or service credit that reduces a submitted claim marks it **Adjustment required**. Another settlement is blocked until the adjusted claim has been submitted and approved. Prior claim submissions are retained. Refunds update net settlement totals without erasing the original payment.

One recorded receipt applies to one invoice. A single bank remittance spanning several invoices needs a future allocation workflow; do not reuse that bank reference as several separate receipts. Direct insurer connections, external submission delivery, automatic eligibility checks and corporate accounts are not included in this increment.

## Payments, credits and refunds

- Record only confirmed **Cash** or **Bank transfer** receipts, with the original receipt/bank reference. The server checks the payer's current outstanding balance and rejects excess payments. Part payments are supported.
- Payment reference claims prevent the same receipt from being used twice, including when a retry has a fresh request ID. Bank-transfer references are unique across all branches in the hospital workspace; cash receipt references are unique within their branch. The same reference with different invoice, payer or amount is rejected.
- Pharmacy returns remain in quarantine. In billing, load the dated charges/credits register and apply the return credit to the invoice containing the original dispensing charge. Credits follow the original tariff and payer split, including cumulative rounding. A credit cannot exceed the original source amount.
- If a credit creates an overpayment, an administrator loads the original receipt and records a refund with its reference and reason. Refunds cannot exceed either the credited overpayment for that payer or the unrefunded part of that receipt. Recording a refund does not send money through a bank/provider.
- Print invoices and receipts from the loaded records. They use readable patient identifiers and omit clinical notes. Printing itself makes no database request.
- Original charges, invoice lines, receipts, dispense records and journals are preserved. Credit notes, refund records, financial events and claim versions record subsequent changes. Posted Hospital journals cannot be separately reversed through the generic journal editor, because that would leave the patient/HMO balances inconsistent; use Hospital credits/refunds.

## Accounting and record controls

Invoices debit patient/HMO receivables and credit the configured hospital revenue account. Receipts debit cash/bank and credit the relevant receivable. Credits reverse revenue and receivables; refunds debit receivables and credit the original receipt account. The original receivable/revenue mapping is retained on each invoice, so later configuration changes do not redirect historical credits or payments.

Each financial action atomically commits the invoice counters, linked source/reference records, balanced shared `accountingJournals` entry, Hospital financial event, access/change audit and operation receipt. Failed or conflicting commits leave none of that action partially saved. Fresh account checks and a bounded check of potentially applicable accounting periods precede posting; a closed period blocks it. No source payment is copied to the school payment collections or processed through school revenue synchronization.

Invoice counters provide current balances without scanning payment history. The shared ledger and Hospital balances are updated together. This is not a bank-statement reconciliation or a migration of historical financial records.

## Read and write limits

| Operation | Data usage |
| --- | --- |
| Open Hospital / switch loaded task | Branch/access settings only on open; no automatic financial history query. Switching a loaded task reuses the view. |
| Load invoices, charges, claims, receipts or financial history | Required From/To dates; at most 93 days per request; branch-scoped; fetch 31 records to display 30. Invoice/visit-specific history is additionally filtered. |
| Find a plan / load account mappings | One exact document lookup; no catalogue scan. |
| Open patient billing context | Specific visit, patient and eligibility documents only; one access audit. No consultation/order history is loaded. |
| Open an invoice | Invoice, patient and at most one claim document; one access audit. No payment or journal scan. |
| Issue an invoice | At most 30 selected charge documents plus exact patient/visit, optional eligibility, configuration/account and operation checks. Two bounded accounting-period queries. |
| Record payment | Exact invoice, patient, payment-reference, settings and relevant account reads; optional linked claim; two bounded accounting-period queries. No payment/transaction history scan. |
| Retry a completed write with the same request ID | One operation receipt read, zero writes or history queries. |
| Save unchanged mappings, plan or verified eligibility | Current record/revision checks, zero writes. |
| Load a period/page already loaded in this session | Reused from memory; explicit Refresh requests newer data. Mutations invalidate financial caches. Branch change, access refresh or session expiry clears them. |

Accounting period checks query periods whose EndDate can still contain today, including the shared ledger’s legacy lower-case endDate field. Each of the two indexed queries is capped at 101 records. More than 100 matches for either schema requires configuration review instead of an unbounded scan. Cached screens are not used as authority for new postings: fresh revisions and duplicate reference claims are required. Synthetic operation counts are not a statement of Google Cloud billed reads; authentication, infrastructure and index charges are outside the fixture.

## Verification and remaining scope

Backend coverage: `tests/hospital-billing.test.mjs`, alongside the Hospital foundation, clinical, pharmacy, storage/audit and data-usage tests. Browser coverage: `scripts/verify-hospital-billing-ui.mjs`, using synthetic records and the actual service. Existing Hospital browser checks also remain in place. New collections participate in backup discovery, and corresponding query indexes are defined but not deployed.

H10 and H11 remain partial. Deposits/prepayments, corporate accounts, insurer remittance allocation across invoices, claim attachments/exports tailored to specific insurers, direct insurer/provider APIs, live bank reconciliation, inventory costing, configurable general service catalogues, desktop/offline parity and practitioner/finance validation remain on the saved checklist. The implementation does not initiate real payments, contact an insurer or change production records.
