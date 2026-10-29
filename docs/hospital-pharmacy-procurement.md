# Hospital pharmacy procurement and supplier billing

Implemented on the Hospital development branch, with web deployment restricted to the isolated Hospital Owner's Demo. Patient cards remain NFC. Card-terminal payments remain disabled. No desktop build or installer release is included.

## Workflow

1. An administrator maintains the branch supplier directory. Permanent codes, retained name aliases and revision checks prevent accidental duplicate suppliers. Name/contact changes retain history and do not rewrite earlier documents.
2. A pharmacist requests up to 20 medicine-catalogue lines with quantities and agreed supplier unit costs. Submit the draft for an authorised purchase approver. The requester cannot approve their own purchase unless acting as Super Admin; approval requires a recorded reason.
3. A pharmacist receives an approved purchase in partial deliveries, identifying the supplier delivery reference and line, medicine batch, future expiry, accepted quantity and selling price. Purchase cost and selling price are separate. Receipt, batch, stock movement and purchase counters commit together. Direct stock intake and purchase receiving share the existing supplier receipt-line guard.
4. A cashier selects received, unbilled goods for one supplier, enters the actual invoice reference/date/due date and total, and explains any variance from received cost. A draft atomically claims its receipts. The invoice cannot be approved until submitted and checked by a different authorised officer (Super Admin exception with reason).
5. Approval posts one balanced expense/payable journal to the shared accounting ledger. A cashier separately records a verified cash or bank payment, including partial payments. This records money already paid; it does not initiate an external transfer. A supplier bill settles when payments and credits cover its value.
6. Corrections preserve originals: cancel/reopen drafts, close unreceived purchase balances, return unused usable stock, record supplier credit notes and record verified payment refunds/reversals. A paid bill must have an actual payment reversal before crediting the paid portion. Supplier stock returns do not silently reverse financial records.

Open **Hospital workspace → Pharmacy procurement**. Supplier/medicine directories load only on request. Purchase, receipt, return, bill, payment and history registers require dates (maximum 93 days). Cached pages are retained while navigating; Refresh requests newer data. Registers and documents include preview/print. Branch/session changes clear the cache and forms.

## Permissions and accounting

| Role | Procurement responsibility |
| --- | --- |
| Super Admin / Hospital Administrator | Supplier configuration, purchase request/approval, invoice preparation/approval and financial corrections |
| Medical Director | Purchase requests/approval; no supplier invoice/payment authority |
| Pharmacist | Purchase requests, approved stock intake and unused stock returns |
| Hospital Cashier | Supplier invoice preparation and confirmed supplier payments; no purchase receiving or invoice approval |

Each capability also requires its Pharmacy or Billing module entitlement and assigned working branch. Administration does not grant prescribing, dispensing or cashier payment authority. Read-only subscriptions cannot mutate records.

Before invoice approval, configure **Pharmacy purchases (Expense)** and **Pharmacy supplier payable (Liability)** in the existing Hospital billing account settings. Payment uses the configured Cash/Bank asset account. Used accounts must be active, have the expected type, and be permitted for Hospital. Closed accounting periods block posting. Bills retain their original expense/payable account snapshot for subsequent payment/credit postings; later mapping changes do not reinterpret earlier balances. Older clients omitting the new optional mappings preserve saved values.

This increment uses purchase-expense accounting. It does not introduce a perpetual-inventory valuation or COGS engine. Received quantities and agreed purchase costs are retained for the later costing work. Hospital supplier documents have their own register; their posted entries participate in the shared accounting ledger. Existing general-store procurement and supplier documents remain unchanged. Do not enter the same Hospital invoice again in general supplier billing.

## Data integrity and read/write boundaries

- All mutations use request fingerprints, exact operation receipts and conditional atomic commits. A retry returns the saved result; a stale editor cannot overwrite concurrent receiving, payment or supplier balance updates.
- Permanent supplier/purchase/invoice identities, supplier delivery-line references, atomic receipt claims and payment/credit/reversal references prevent duplicates within this workflow. No patient charge is created by a purchase, supplier receipt or supplier bill.
- Integer cents and cumulative quantity calculations avoid fractional delivery/return rounding drift. Received amounts cannot exceed approved quantities; returns cannot exceed original quantities or available usable stock; payments/credits cannot exceed outstanding balances.
- New collections are added to Hospital backup discovery. No migration, cleanup, deletion or rewriting of existing patient/clinical/financial records is performed.
- Workspace opening and tab changes perform no procurement query. Each dated page fetches at most 31 records and displays 30, with stable cursors. Exact details and supplier-code lookups do not scan collections. Browsing adds no procurement audit writes; mutations retain their audit and business history.
- An unchanged purchase save uses only the operation and purchase lookups and writes nothing. Catalogue validation deduplicates medicine IDs and uses bounded parallel exact reads. Financial posting checks only the affected account codes and bounded accounting-period configurations; it never loads the complete ledger.
- Supplier aliases remain reserved after renaming, preventing an accidental second supplier under an earlier name. Existing document snapshots preserve the supplier identity used when created.

## Verification

`tests/hospital-procurement.test.mjs` covers the full lifecycle, permissions, branch isolation, read-only mode, duplicate and concurrent actions, lost responses, source claims, variance approval, partial payments, closed periods, corrections, rounding, retained snapshots, pagination, backup discovery and no-op read/write budgets.

`scripts/verify-hospital-procurement-ui.mjs` exercises pharmacist → owner → pharmacist → cashier → owner → cashier using synthetic data: medicine selection, purchase approval, partial batch receiving, invoice approval, partial payment, history, cached reads, preview/print, phone layout and branch clearing. It makes no real payment or patient charge.

Remaining pharmacy work includes perpetual costing/valuation, controlled-drug witness workflows, broader multi-invoice supplier remittances, desktop/offline parity and practitioner validation. Continue the complete Hospital scope checklist.
