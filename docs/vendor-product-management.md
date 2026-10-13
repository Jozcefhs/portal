# Vendor product management

Vendor Users reuse **Vendor Sales & Settlements → Product ownership** to add products individually or by CSV, edit their own product details and prices, and record stock deliveries. Only active vendor records linked to the signed-in username in the current branch / school section are available. Ownership transfers and organisation-owned stock remain under school / organisation control.

## Counts and stock

- **Products** counts distinct live stock records, not units. Products awaiting approval are shown separately and are not yet available for sale.
- The POS search shows the catalogue count and, while searching, the matching count.
- Completed sales reduce the relevant stock quantity in the same atomic operation as the receipt, payment and vendor earnings. Retrying the same sale does not deduct stock twice; insufficient stock blocks completion.
- A stock delivery adds units to the latest remaining quantity. Approval does not restore stock already sold while a delivery or detail change was pending.
- Changes do not rewrite historical sale ownership, receipts, wallets or journals.

## School / organisation controls

Approval is required by default for new products, product details / selling prices, and deliveries. Go to **Vendor Sales & Settlements → Approval settings** (also linked from Product ownership). Accounts Officers, Directors and Super Admins can independently choose **Approval required** or **No approval — apply immediately** for adding new items (including batch uploads), restocking, and editing details / prices. Save the choices with **Save approval settings**. The desktop edition has the same tab with **Change approval settings**.

Settings apply to every vendor in the current branch. For schools, the editor needs **All school sections** access; section-limited reviewers can see the current choices and an explanation. Defaults remain approval-required. Saving records the actor and time without changing financial settlement rules or approving existing pending requests.

Authorised school / organisation reviewers approve or reject requests in **Product change requests**. Vendor Users cannot approve their own requests or transfer another owner's stock. Conflicting detail changes or a removed vendor-login link require rejection and a fresh submission.

## Revoking a live item

In **Product ownership**, Accounts Officers, Directors and Super Admins can choose **Revoke item**, enter a reason and confirm. Desktop users first select one product. This withdraws a vendor-owned product from new sales without deleting it or changing its stock quantity, past receipts, earnings or payment claims. The product remains listed as **Revoked by Accounts**, with the reason visible on the web.

Revocation is server-enforced at checkout, including stale carts and student-wallet purchases. Vendors cannot reactivate the item through edits, imports or restocking, even with approval disabled. Existing pending product edits cannot clear the revocation. Accounts can explicitly **Restore for sale**, with a reason, after review. Both actions are version-checked, atomic, audited and safe to retry; they do not post money or stock movements. Organisation-owned items are not changed by these actions.

## Release status

Implemented in the shared web/backend and desktop source. Tests use local fixtures and do not change production records. Desktop source updates do not include a newly compiled installer.

The statement screen automatically loads the selected vendor on a vendor switch, preserving the selected dates. Obsolete responses cannot replace the latest selection. Changing dates clears the old statement until a fresh statement is loaded.
