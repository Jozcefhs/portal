# Vendor Sales and Settlements Implementation Checklist

Agreed scope as of 8 October 2026: link vendor-owned tuck-shop products and confirmed sales to vendor balances, requisitions, approvals and recorded payments. Include optional school commissions or charges and an explicit full-payment choice for each vendor.

Status: implemented in the shared web backend, responsive web workspace and desktop source. Web publication is authorised with vendor sales disabled. Desktop remains tested only; no installer is authorised. Checked items below indicate implemented behaviour verified with local fixtures, not approval of live vendor balances or accounting mappings.

## Vendor registration and product ownership

- [x] Register vendors with permanent IDs, contact details, protected payment details, active status and permitted branches.
- [x] Reuse the existing supplier register where suitable while distinguishing sales vendors from suppliers of school-owned stock.
- [x] Assign each product to a vendor or to the school. Keep similar products from different vendors as separate stock records.
- [x] Preserve vendor ownership on each sale line; subsequent product reassignment must not change earlier earnings.
- [x] Keep historical or unassigned stock out of automatic vendor settlement until its ownership has been reviewed.

## Optional school commissions and charges

- [x] Provide an organisation default settlement rule with individual vendor overrides.
- [x] Full payment means 100 percent of confirmed eligible sales less refunds, with no school commission or charge. An explicit full-payment override must defeat any default deduction.
- [x] Percentage commission retains a configured percentage for the school. Validate the rate and clearly identify the sales amount on which it is calculated.
- [x] Fixed charge retains a configured amount with an explicit basis, such as per sale or per settlement period. Prevent a period charge from being deducted repeatedly across several requisitions.
- [x] Show the agreed rule, deductions and net vendor entitlement on statements and requisitions. Do not apply undisclosed or inferred charges.
- [x] Give rules an effective date and preserve the applicable rule on each sale. Changes apply prospectively, not to money already earned.
- [x] Define and validate refund and fixed-charge treatment before enabling each rule; do not silently produce an invalid or negative payment request.

## Sales and vendor balances

- [x] Attribute every confirmed eligible sale item to its recorded vendor, including student-wallet and supported cash, transfer and card sales.
- [x] Split a mixed-vendor basket into the correct vendor earnings while retaining one customer receipt and the existing stock and wallet controls.
- [x] Accrue vendor payables only for money collected by the school. Record payments collected directly by a vendor separately, without creating a school payable.
- [x] Exclude failed, pending or cancelled payments. Reverse relevant earnings and deductions through linked refund records rather than editing the original sale.
- [x] Track earned amounts, refunds, school deductions, payments, pending request reservations, approved unpaid amounts and the available amount to request.
- [x] Record sale, stock, wallet, vendor earnings and accounting effects consistently. Repeated requests, double taps and concurrent checkouts must not duplicate earnings or debits.

## Statements and payment requisitions

- [x] Provide a date-filtered vendor statement with products, quantities, sales, refunds, deductions, previous payments and amounts already claimed by pending requests.
- [x] Allow a vendor, or an authorised tuck-shop officer acting for that vendor, to request payment against an eligible balance.
- [x] Generate a requisition linked to the vendor, statement and underlying earnings. Include the requested amount and net entitlement.
- [x] Reserve claimed amounts on submission so overlapping requests cannot claim the same earnings twice, including concurrent requests.
- [x] Release reservations after rejection or cancellation. Revalidate available funds and approvals when a request is revised and resubmitted.
- [x] Preserve statement and rule snapshots. Show subsequent refunds or adjustments explicitly rather than silently changing an approved request.
- [x] Provide printable or downloadable statements and requisitions.

## Approval and recorded payment

- [x] Reuse the existing sequence: submission, Accounts confirmation, Admin review, Director or Super Admin approval, then Accounts records payment.
- [x] Keep approval separate from payment. Approved requests remain awaiting payment until a payment is recorded.
- [x] Support part-paid and paid settlements, with payment date, amount, method, reference and supporting evidence.
- [x] Prevent payments above the approved unpaid amount and duplicate recording of the same settlement.
- [x] Link each recorded payment to its accounting entry and reduce the correct vendor liability and unpaid balance together.
- [x] The initial feature records payments made outside the application; it does not initiate bank transfers automatically.

## Accounting and reconciliation

- [ ] Obtain the accountant's confirmation of the vendor arrangement and account mappings before enabling the accounting treatment.
- [x] Where the school merely collects on the vendor's behalf, track vendor money as a payable and the agreed school commission or charge separately as school income.
- [x] Vendor settlement clears an existing payable; it must not be posted again as a new ordinary expense. Extend the requisition posting path accordingly rather than reusing its expense posting unchanged.
- [x] Preserve the existing treatment for school-owned retail stock and unrelated requisitions.
- [x] Reconcile vendor statements, the payable control account, school deductions and recorded payments, without counting wallet funding as another vendor sale.
- [x] Do not automatically rewrite historical journals, financial transactions or student balances.

## Access and audit

- [x] Vendors can access only their own products, statements and requisitions within authorised branches.
- [x] Vendor access must not expose student financial records, wallet credentials or another vendor's information.
- [x] Accounts can review vendor balances, approvals, outstanding payments and payment history. Preserve the existing approval role separation.
- [x] Restrict and mask bank details appropriately, and audit changes to vendor ownership, payment details and settlement rules.
- [x] Preserve the actor, timestamps, revisions, approvals, deductions, refunds and payment references in an audit trail. Corrections use linked adjustments, not deletion of financial history.
- [x] Enforce organisation, branch, edition and relevant section restrictions on the shared backend, not only in interface controls.

## Editions and interfaces

- [x] Use shared settlement and accounting rules for School, Church or Faith, and Other Organisation editions, with appropriate module terminology and feature access.
- [x] Provide equivalent workflows in web, mobile web and desktop; avoid separate client-side implementations of money calculations.
- [x] Keep forms, vendor summaries, statements and request actions usable on mobile.
- [x] Do not build or publish a desktop installer while the user's tested-only instruction remains in force. A future desktop release requires renewed direction.

## Historical setup and rollout

- [ ] Review existing product ownership, historical vendor sales, prior vendor payments and opening balances with Accounts before importing or assigning them.
- [x] Provide a preview and reconciliation of historical setup; require authorised confirmation before any financial adjustment.
- [ ] Pilot the workflow with reviewed vendor data before enabling it more widely.
- [ ] Publish only after the relevant tests and accounting reconciliation pass and the applicable release authority is confirmed.

## Acceptance tests

- [x] Full-payment overrides work even when the organisation default charges a commission.
- [x] Percentage and fixed-charge calculations are correct, including rounding, period boundaries, refunds and effective-date changes.
- [x] Mixed-vendor baskets, identical product names and later ownership changes preserve correct historical attribution.
- [x] School-collected and vendor-collected payments have distinct settlement effects; pending or failed payments earn no payable.
- [x] Retries, double taps, concurrent requests, stock changes and stale records cannot duplicate sales, earnings, claims or payments.
- [x] Overlapping requests, rejection, cancellation, revision and partial payment leave balances and reservations consistent.
- [x] Every approval stage is enforced; approval alone does not mark a vendor paid, and a paid amount is not posted twice as an expense.
- [x] Refunds after a request or payment remain traceable and cannot silently rewrite a completed settlement.
- [x] Vendor, role, organisation, branch, edition and section access restrictions are enforced.
- [x] Statements, vendor balances, journals and payment history reconcile across all three editions and web and desktop workflows.

## Business details to confirm before rollout

The available rule choices are agreed, but no actual commission rate or fixed amount has been selected. Accounts must confirm each vendor's rule, any fixed-charge basis and schedule, collection arrangements, opening balances and accounting mappings before live settlement begins.

## Operating the vendor workspace

1. Accounts reviews the branch and school section, creates vendors and assigns separate product records. Leave existing unassigned stock unchanged until ownership is established.
2. Choose the organisation default and each vendor's override. Full payment retains nothing; Percentage applies to confirmed sales after refunds; Fixed charge uses an explicit per-sale or Daily, Weekly or Monthly period basis. Do not backdate new rules.
3. Accounts confirms active payable, income and direct-collection receivable accounts. Vendor checkout remains blocked while either Enabled or AccountingConfirmed is false.
4. Once a controlled pilot is approved, record organisation-collected or direct-vendor-collected sales accurately. Online and student-wallet payments are organisation-collected. Pending or failed payments cannot create vendor earnings.
5. Load a vendor statement, select the period and submit an eligible payment request. Submission reserves earnings. Follow Accounts confirmation, Admin review and Director or Super Admin approval; Accounts then records the payment with evidence. This application does not initiate transfers.
6. Use linked refunds and receipts for corrections. Bank-detail changes require withdrawal and fresh approval of unpaid claims. Paid online orders with an unissued stock movement are held from settlement until Accounts completes the original stock issue. Orders already refunded require a separate physical-quantity review.
7. Historical opening balances require the preview, evidence, a reviewed accounting offset and authorised confirmation. They do not rewrite earlier journals or post another cash receipt.

### Batch products and owner assignments

Use **Product ownership → Batch products & owners**. The workflow is shared across School, Faith and Organisation editions; desktop source uses the same backend actions.

- For products already registered, choose **Assign owners to existing products**, download the existing-products CSV, and change only `Owner` to a registered vendor ID or unique vendor name. `ORGANISATION` explicitly selects organisation-owned stock. Keep `InventoryId`, `Store`, and the identifying product columns unchanged. Assignment preserves stock, prices, category, unit, active status and school section; it does not recreate the product or rewrite earlier sales / earnings.
- For new products, choose **Create new products** and download the blank template. Required columns are `ItemCode`, `ItemName`, `Owner`, `Quantity` and `Price`. Optional columns are `Store`, `Category`, `Unit`, `Active` and `SchoolSection`. Stock must be a non-negative integer; price must be positive with at most two decimal places. Item codes are normalised to uppercase. Store choices follow the edition: `tuckShop`, or `organizationStore` / `restaurant`. School vendors and products must have the same Primary / Secondary section.
- Download the vendor ID reference for registered active owners. Register missing vendors first; the product import does not create vendor accounts, alter commission rules, or enable vendor sales.
- Maximum 1,000 rows / 512 KB per file. All rows are previewed before saving. Unknown / ambiguous owners, duplicate stock references and identity / scope errors block import. Existing matching new-product records are skipped, never overwritten.
- Review and confirm the preview, which shows the current owner, new owner, stock and proposed action. Saving uses atomic batches of at most 20 rows with progress. If a later batch fails, earlier completed batches remain saved; retry the interrupted batch with its retained reference. If stock or vendor details changed, close the dialog, download a fresh list if needed, and preview again. Re-uploading completed rows keeps them unchanged.
- Only authorised stock operators may import. Branch, edition, school section, read-only subscription, fresh-record versions, idempotency and audit controls are enforced by the backend. Stock ownership changes do not post journals, wallet movements or historical vendor earnings. Desktop remains source-tested only until a new installer is authorised.

## Verification and release controls

### Original customer lookup in the vendor counter

School vendors use the original Tuck Shop customer layout and shared NFC / face adapters: **Find student**, a collapsed manual card / admission panel, and **Find wallet**, **Scan card** and **Use face**. Enter in the lookup form identifies a customer only; it cannot submit a sale. Staff can be selected for cash, transfer or POS sales. Payment controls appear only after a customer is identified.

Customer searches and face matches are restricted by the active branch and the Primary / Secondary sections of this login's linked, active selling vendors. Returned information contains identity details only, not wallet balances, credentials or contact details. Vendors cannot enrol or revoke faces, use Records Desk face lookup, or access general student / wallet administration. Admission-number formatting differences resolve only to an exact normalised saved reference; partial or ambiguous references cannot silently select a wallet.

Direct phone NFC uses the original Android Chrome Web NFC flow. Unsupported browsers retain USB-reader / manual entry, with a visible explanation instead of a stuck scan button. Scan cancellation, no-card timeouts and navigation stop the reader. Face lookup uses the original camera selector and quick-match flow; navigation closes the dialog and camera. Changing a customer clears the previous identity, PIN and checkout preview. Server pricing, wallet authorisation, duplicate-sale protection and financial posting remain authoritative.

Verification on 9 October 2026 for this repair: 1,926 top-level web / backend tests and 64 payroll tests passed; the Pages Functions bundle compiled successfully. Tests execute the original NFC reader lifecycle, the vendor admission / directory actions, the real staff-session guard and scoped face-match endpoint, including blocked access outside the linked branch / section. Local desktop and 390-pixel mobile checks confirmed the original three-button layout, Enter-to-lookup, inline errors and camera selector. Physical NFC cards and live biometric capture still require an on-device check; no live sale or wallet debit was used for verification.

The automated acceptance suite covers all three editions, actual checkout paths, partial and full payment, retries and conflicts, fixed-charge redistribution after refunds, direct collection, bank changes, data isolation and historical openings. Desktop tests cover shared request handling, role access, form construction and stale-workspace protection. Responsive web checks use sample records only.

Verification on 8 October 2026: 1,832 top-level web tests, 64 payroll tests and 588 desktop tests passed; the Pages Functions bundle compiled successfully. The vendor acceptance suite contains 41 tests, and the desktop vendor suite contains ten tests, including stale statement protection when filters change.

Batch-upload verification on 9 October 2026: 1,897 top-level web tests, 64 payroll tests and 607 desktop tests passed; the Pages Functions bundle compiled successfully. The focused vendor / CSV suite contains 65 tests, and the desktop vendor / CSV suite contains 19 tests. Local browser checks confirmed invalid-owner blocking, preview-before-save, unchanged stock and prices, and safe replay after a response was lost following a successful second batch. CSV templates use direct browser download links, with serialization / parser roundtrip checks; the connected Chrome automation cannot retrieve Blob downloads, so an automated browser download-file check is unavailable. No live inventory or financial records were changed for verification.

Live product ownership, vendor rules, account mappings and opening balances still require Accounts review and a controlled pilot. Leave vendor sales disabled during this review. Existing financial records and student wallets are not migrated or altered by publishing the feature.
