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

For deposits and remittances, also configure separate active **Liability** accounts for **Patient deposits** and **HMO advances**. These two mappings are optional for existing invoice/payment workflows, but required before receiving the corresponding advance. Older clients that omit these fields preserve the saved mappings. Existing account codes are not changed and no accounts are silently created.

Corporate billing additionally uses **Corporate receivables (Asset)** and, for company advances/remittances, **Corporate advances (Liability)**. These are separate optional mappings: existing patient and HMO workflows continue without them. A corporate posting requires its relevant mapping. Invoice and credit postings validate and read only the accounts used by their non-zero payer amounts.

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

The ordinary invoice payment action records one receipt against one invoice. For one bank remittance spanning several invoices, use **Deposits and HMO / corporate remittances** as described below. The original bank reference must be entered only once; allocations are not new cash receipts. Direct insurer connections, external submission delivery and automatic eligibility checks are not included in this increment.

## Corporate accounts and sponsored visits

1. An administrator opens **Billing and HMO → Corporate accounts and statements → New company**. Save a permanent company code, name, billing address/contact, payment terms and optional credit limit. A blank limit means no configured cap; zero stops new company credit. Deactivate an account to stop future sponsored billing while retaining its outstanding invoices, receipts and correction workflows. Company codes are immutable; changing a name does not change the company identity or past invoice snapshots.
2. Open the patient's visit, expand **Verified corporate visit coverage** and load any saved coverage before editing. Verify the company code, record the employee/beneficiary number, employer authorisation, valid dates, company share percentage and verification note. Explicitly choose all recorded services or up to 40 covered service codes. This records staff verification; it does not contact the employer. Only administrators configure accounts/coverage; cashiers can load the saved coverage and bill it.
3. The cashier loads the saved coverage explicitly and chooses **Use the loaded verified corporate coverage** when issuing selected charges. Covered charges use the recorded service amount and the authorised company percentage; the patient owes the remainder. Uncovered services remain self-pay. HMO and corporate sponsorship cannot be combined on the same invoice. Company-specific negotiated tariffs and automatic recurring employee eligibility are separate future work.
4. The invoice stores the company identity/name, coverage terms, authorisation, service split, account mapping and due date based on the verified payment terms. Later company or coverage changes do not rewrite existing invoices. Current active status and any company credit limit are checked again. The invoice, source charges, company balance, account movement, shared journal, audit and retry receipt commit together. Competing invoices cannot exceed a configured credit limit through a race.
5. Record a confirmed single-invoice payment with payer **Corporate**, or receive one **Corporate remittance / advance** and allocate it to up to 20 invoices for the same company in the selected branch. Verify the company code/name before receiving a remittance. Matching uses the permanent company ID, so renaming the company does not prevent paying earlier invoices. The original receipt reference shares the existing payment duplicate guard.
6. Existing medicine-return credits, administrator service credits, credited-overpayment refunds, allocation returns and unused-advance refunds work with the corporate share. Company receivable counters and accounting journals update in the same commit. Corrections retain original records and their original account mappings. They may reopen debt above a lowered credit limit; the limit controls new billing, not corrections to history.
7. Find a company by code to view its current receivable balance without reading its invoices. This balance is billed minus credited and net paid amounts. **Unallocated advances remain separate liabilities** until applied to invoices. They are visible in the date-selected advance register and receipt details.
8. Choose dates and load **Invoices** or **Events** in the company statement. Each page has at most 30 records; loaded pages are reused, and Refresh explicitly requests newer data. Invoice pages show the patient/hospital number, original company charge, credits, remaining balance and due date, without clinical notes or itemised treatment lines. Print the loaded page without additional reads. The screen distinguishes the current company balance from a selected page; this is not a full-period opening/closing balance or an automatically delivered statement.

Corporate accounts, verified coverage, versions and account movements are branch-scoped and included in backup discovery. Cashiers cannot edit authorisations, credit limits or company settings. HMO-only staff do not acquire company-account or corporate-remittance access. No company/employer emails are sent by these actions.

## Deposits, prepayments and multi-invoice remittances

1. A cashier opens **Billing and HMO → Deposits and HMO / corporate remittances → Receive a deposit or remittance**. A patient deposit needs the verified hospital number; no visit or invoice is required yet. For an HMO remittance, enter the insurer's name as saved on its insured invoices. For a corporate remittance, verify the permanent company code first.
2. Record the confirmed cash/bank amount and original receipt/transfer reference. The original receipt records the full amount, payer, branch and account mappings. Bank references share the same duplicate guard as ordinary invoice payments, across the hospital workspace's branches; cash references are branch-specific. A transfer cannot be recorded again by switching payment workflows.
3. Open **Apply this receipt to invoices**. Find each invoice using its printed invoice number, add it to the batch, and enter the amount to apply. Patient deposits pay only that patient's share, including across visits. HMO receipts pay only approved/partially settled claims with the same saved insurer name. The server compares normalised names against the immutable invoice coverage snapshot; it does not query an external insurer registry.
4. A batch contains 1–20 distinct invoices in the receipt's branch. Record a stable allocation reference, such as the remittance schedule reference, and confirm the selected amounts. Any unused money stays available for a later batch. Amounts cannot exceed either the invoice's outstanding payer balance or the receipt's available money.
5. The server validates all invoices, balances, claim states and revisions before committing the whole batch. One stale/conflicting invoice prevents that entire batch from posting. Refresh and review the changed balance before retrying. Same-request retries return the original result; reusing an allocation reference with identical invoice/amount pairs makes no duplicate entries, and a different set is rejected.
6. The original receipt shows **received, applied, refunded and available**. Choose dates to load receipt history or invoice allocations. The HMO Officer can view HMO receipts/allocations but cannot collect money or refund it. Cashiers cannot authorise refunds or allocation corrections.
7. To correct an allocation, an administrator opens its dated allocation list and chooses **Review allocation return**. Enter the correction amount, unique reference and reason. The correction reopens that part of the invoice balance and returns the amount to the source receipt's available balance; it does not issue a cash refund. It cannot exceed the unreturned allocation. Original payment and invoice amounts remain intact.
8. To return unused money, an administrator records **Refund unused money**, with the confirmed refund reference and reason. Allocated money must first be returned to the receipt. The refund uses the original receipt account and cannot exceed the unused balance. This records a confirmed refund; it does not initiate a bank/provider transfer.

Allocations, corrections and refunds retain source links, immutable event records and balanced journals. A corrected HMO allocation updates net settlement and reopens an approved claim when appropriate; a claim already requiring adjustment keeps that state. Existing submissions and approvals are preserved. Printing the advance receipt or an allocation record uses the loaded snapshot without a database request. An allocation printout identifies the original receipt and does not represent a second cash receipt.

## Payments, credits and refunds

- Record only confirmed **Cash** or **Bank transfer** receipts, with the original receipt/bank reference. The server checks the payer's current outstanding balance and rejects excess payments. Part payments are supported.
- Payment reference claims prevent the same receipt from being used twice, including when a retry has a fresh request ID. Bank-transfer references are unique across all branches in the hospital workspace; cash receipt references are unique within their branch. The same reference with different invoice, payer or amount is rejected.
- Pharmacy returns remain in quarantine. In billing, load the dated charges/credits register and apply the return credit to the invoice containing the original dispensing charge. Credits follow the original tariff and payer split, including cumulative rounding. A credit cannot exceed the original source amount.
- If a credit creates an overpayment, an administrator loads the original receipt and records a refund with its reference and reason. Refunds cannot exceed either the credited overpayment for that payer or the unrefunded part of that receipt. Recording a refund does not send money through a bank/provider.
- Print invoices and receipts from the loaded records. They use readable patient identifiers and omit clinical notes. Printing itself makes no database request.
- Original charges, invoice lines, receipts, dispense records and journals are preserved. Credit notes, refund records, financial events and claim versions record subsequent changes. Posted Hospital journals cannot be separately reversed through the generic journal editor, because that would leave the patient/HMO balances inconsistent; use Hospital credits/refunds.

## Accounting and record controls

Invoices debit patient/HMO receivables and credit the configured hospital revenue account. Receipts debit cash/bank and credit the relevant receivable. Credits reverse revenue and receivables; refunds debit receivables and credit the original receipt account. The original receivable/revenue mapping is retained on each invoice, so later configuration changes do not redirect historical credits or payments.

Advance receipts debit cash/bank and credit the corresponding advance liability. Allocations debit that original liability and credit each invoice's original patient/HMO receivable. Allocation returns reverse that movement; unused advance refunds debit the liability and credit the original cash/bank account. These actions do not recognise invoice revenue again. Receipt counters supply available funds without scanning past allocations, and invoice net-paid calculations include allocation returns without rewriting original receipts.

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
| Receive advance | Exact duplicate-reference, optional patient, mappings and relevant accounts; two bounded period queries. Six writes including the operation receipt, balanced journal and audit, in one commit. |
| Find invoice for an allocation | Branch and exact printed invoice number; query limited to two records to detect ambiguity. Optional linked HMO claim lookup; no invoice history scan. |
| Allocate advance | 1–20 exact invoices plus their distinct patients and, for HMO, linked claims. Each distinct account is fetched once. Two bounded period queries for the whole batch. One atomic commit: `4 × invoice count + 5` writes for patient deposits, `5 × invoice count + 5` for HMO claims. No payment or allocation history scan. |
| Load advance receipts/history/allocations | Required dates, maximum 93 days, branch-scoped and receipt-scoped where applicable; fetch 31/display 30. Previous loaded pages are reused. |
| Find company | One exact company-code lookup with current receivable counters; no invoice scan or mutation. |
| Load saved corporate coverage | Only requested visit, patient and coverage records; one access audit. No company/history scan and no automatic coverage request when opening a visit. |
| Corporate statement | Required dates (maximum 93 days), one company summary read and one company/branch-filtered 31-row query; one access audit. No per-invoice patient or journal lookups. |
| Corporate financial posting | Adds one company summary update and one account movement to the existing atomic posting. Multi-invoice allocations read/update the company once for the entire batch: `4 × invoice count + 7` writes, including the operation receipt. |
| Retry a completed write with the same request ID | One operation receipt read, zero writes or history queries. |
| Save unchanged mappings, plan or verified eligibility | Current record/revision checks, zero writes. |
| Load a period/page already loaded in this session | Reused from memory; explicit Refresh requests newer data. Mutations invalidate financial caches. Branch change, access refresh or session expiry clears them. |

Accounting period checks query periods whose EndDate can still contain today, including the shared ledger’s legacy lower-case endDate field. Each of the two indexed queries is capped at 101 records. More than 100 matches for either schema requires configuration review instead of an unbounded scan. Cached screens are not used as authority for new postings: fresh revisions and duplicate reference claims are required. Synthetic operation counts are not a statement of Google Cloud billed reads; authentication, infrastructure and index charges are outside the fixture.

## Verification and remaining scope

Backend coverage: `tests/hospital-billing.test.mjs`, `tests/hospital-funds.test.mjs` and `tests/hospital-corporate.test.mjs`, alongside the Hospital foundation, clinical, pharmacy, storage/audit and data-usage tests. Browser coverage: `scripts/verify-hospital-billing-ui.mjs`, `scripts/verify-hospital-funds-ui.mjs` and `scripts/verify-hospital-corporate-ui.mjs`, using synthetic records and the actual service. Existing Hospital browser checks also remain in place. New collections participate in backup discovery, and corresponding query indexes are defined but not deployed.

H10 and H11 remain partial. Cross-branch remittance transfers, company-specific negotiated tariffs/recurring eligibility, full-period opening/closing statements, claim attachments/exports tailored to specific insurers, direct insurer/provider APIs, live bank reconciliation, inventory costing, configurable general service catalogues, desktop/offline parity and practitioner/finance validation remain on the saved checklist. The implementation does not initiate real payments, contact an insurer/employer or change production records.
