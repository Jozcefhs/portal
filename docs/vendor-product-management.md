# Vendor product management

Vendor Users reuse **Vendor Sales & Settlements → Product ownership** to add products individually or by CSV, edit their own product details and prices, and record stock deliveries. Only active vendor records linked to the signed-in username in the current branch / school section are available. Ownership transfers and organisation-owned stock remain under school / organisation control.

## Counts and stock

- **Products** counts distinct live stock records, not units. Products awaiting approval are shown separately and are not yet available for sale.
- The POS search shows the catalogue count and, while searching, the matching count.
- Completed sales reduce the relevant stock quantity in the same atomic operation as the receipt, payment and vendor earnings. Retrying the same sale does not deduct stock twice; insufficient stock blocks completion.
- A stock delivery adds units to the latest remaining quantity. Approval does not restore stock already sold while a delivery or detail change was pending.
- Changes do not rewrite historical sale ownership, receipts, wallets or journals.

## School / organisation controls

Approval is required by default for new products, product details / selling prices, and deliveries. A branch-wide authorised manager can separately enable immediate updates under **Product ownership → Product approval controls**. This setting does not change financial settlement rules; existing pending requests still require review.

Authorised school / organisation reviewers approve or reject requests in **Product change requests**. Vendor Users cannot approve their own requests or transfer another owner's stock. Conflicting detail changes or a removed vendor-login link require rejection and a fresh submission.

## Release status

Implemented in the shared web/backend and desktop source. Tests use local fixtures and do not change production records. Desktop source updates do not include a newly compiled installer.

The statement screen automatically loads the selected vendor on a vendor switch, preserving the selected dates. Obsolete responses cannot replace the latest selection. Changing dates clears the old statement until a fresh statement is loaded.
